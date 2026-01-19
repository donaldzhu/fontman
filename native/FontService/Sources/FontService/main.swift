import AppKit
import CoreServices
import CoreText
import Foundation

// MARK: - Data Models

struct JsonRpcRequest: Decodable {
    let jsonrpc: String
    let id: JsonRpcId
    let method: String
    let params: JsonRpcParams?
}

struct JsonRpcParams: Decodable {
    let path: String?
    let paths: [String]?
    let index: Int?
    let text: String?
    let size: Double?
    let features: [String]?
    let variations: [String: Double]?
}

enum JsonRpcId: Codable {
    case string(String)
    case number(Int)

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let stringValue = try? container.decode(String.self) {
            self = .string(stringValue)
        } else {
            self = .number(try container.decode(Int.self))
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value):
            try container.encode(value)
        case .number(let value):
            try container.encode(value)
        }
    }
}

struct JsonRpcResponse<Result: Encodable>: Encodable {
    let jsonrpc = "2.0"
    let id: JsonRpcId
    let result: Result
}

struct JsonRpcErrorResponse: Encodable {
    let jsonrpc = "2.0"
    let id: JsonRpcId?
    let error: JsonRpcErrorDetail
}

struct JsonRpcErrorDetail: Encodable {
    let code: Int
    let message: String
}

struct PingResult: Encodable {
    let ok: Bool
    let version: String
}

struct ScanFileFace: Encodable {
    let index: Int
    let familyName: String
    let fullName: String
    let postScriptName: String
    let styleName: String
    let weight: Double?
    let width: Double?
    let slant: Double?
    let isItalic: Bool
    let isVariable: Bool
}

struct ScanFileResult: Encodable {
    let path: String
    let faces: [ScanFileFace]
}

struct WatchSourcesResult: Encodable {
    let watching: Bool
    let paths: [String]
}

struct UnregisterFontResult: Encodable {
    let ok: Bool
}

struct RegisterFontResult: Encodable {
    let ok: Bool
}

struct IsFontRegisteredResult: Encodable {
    let registered: Bool
}

struct FontFeature: Encodable {
    let tag: String
    let name: String
    let enabledByDefault: Bool
}

struct FontVariationAxis: Encodable {
    let tag: String
    let name: String
    let min: Double
    let max: Double
    let defaultValue: Double
}

struct FaceFeaturesResult: Encodable {
    let path: String
    let index: Int
    let features: [FontFeature]
    let axes: [FontVariationAxis]
}

struct RenderPreviewResult: Encodable {
    let ok: Bool
    let pngBase64: String?
}

struct SourceChange: Encodable {
    let path: String
    let flags: [String]?
}

struct HelperEvent: Encodable {
    let event: String
    let changes: [SourceChange]?
    let path: String?
}

// MARK: - Source Watcher

final class SourceWatcher {
    private var stream: FSEventStreamRef?
    private let queue = DispatchQueue(label: "com.fontman.sourcewatcher")
    private let handler: ([SourceChange], [String]) -> Void

    init(handler: @escaping ([SourceChange], [String]) -> Void) {
        self.handler = handler
    }

    func update(paths: [String]) {
        stop()
        guard !paths.isEmpty else { return }

        var context = FSEventStreamContext(
            version: 0,
            info: UnsafeMutableRawPointer(Unmanaged.passUnretained(self).toOpaque()),
            retain: nil,
            release: nil,
            copyDescription: nil
        )

        let callback: FSEventStreamCallback = {
            _, clientCallBackInfo, numEvents, eventPathsPointer, eventFlagsPointer, _ in
            guard let clientCallBackInfo else { return }
            let watcher = Unmanaged<SourceWatcher>.fromOpaque(clientCallBackInfo)
                .takeUnretainedValue()

            // Cast eventPathsPointer to NSArray -> [String]
            let paths = unsafeBitCast(eventPathsPointer, to: NSArray.self) as? [String] ?? []

            // eventFlagsPointer is a C-pointer to UInt32 (FSEventStreamEventFlags).
            // We wrap it in a buffer pointer to convert to a Swift array.
            let flags = Array(UnsafeBufferPointer(start: eventFlagsPointer, count: numEvents))

            var changes: [SourceChange] = []
            var missingPaths: [String] = []

            for index in 0..<paths.count {
                let flagValue = flags.count > index ? flags[index] : 0
                changes.append(
                    SourceChange(path: paths[index], flags: watcher.flagStrings(flagValue)))

                // Check for removal
                if (flagValue & FSEventStreamEventFlags(kFSEventStreamEventFlagItemRemoved)) != 0 {
                    missingPaths.append(paths[index])
                }
            }
            if !changes.isEmpty || !missingPaths.isEmpty {
                watcher.handler(changes, missingPaths)
            }
        }

        let stream = FSEventStreamCreate(
            nil,
            callback,
            &context,
            paths as CFArray,
            FSEventStreamEventId(kFSEventStreamEventIdSinceNow),
            0.2,
            FSEventStreamCreateFlags(
                kFSEventStreamCreateFlagFileEvents | kFSEventStreamCreateFlagUseCFTypes)
        )

        guard let stream else { return }
        self.stream = stream

        // Use modern Dispatch Queue instead of RunLoop
        FSEventStreamSetDispatchQueue(stream, queue)
        FSEventStreamStart(stream)
    }

    func stop() {
        if let stream {
            FSEventStreamStop(stream)
            FSEventStreamInvalidate(stream)
            FSEventStreamRelease(stream)
        }
        stream = nil
    }

    private func flagStrings(_ flags: FSEventStreamEventFlags) -> [String] {
        var values: [String] = []
        if flags & FSEventStreamEventFlags(kFSEventStreamEventFlagItemCreated) != 0 {
            values.append("created")
        }
        if flags & FSEventStreamEventFlags(kFSEventStreamEventFlagItemRemoved) != 0 {
            values.append("removed")
        }
        if flags & FSEventStreamEventFlags(kFSEventStreamEventFlagItemModified) != 0 {
            values.append("modified")
        }
        if flags & FSEventStreamEventFlags(kFSEventStreamEventFlagItemRenamed) != 0 {
            values.append("renamed")
        }
        if flags & FSEventStreamEventFlags(kFSEventStreamEventFlagItemInodeMetaMod) != 0 {
            values.append("inode-meta")
        }
        if flags & FSEventStreamEventFlags(kFSEventStreamEventFlagItemFinderInfoMod) != 0 {
            values.append("finder-info")
        }
        if flags & FSEventStreamEventFlags(kFSEventStreamEventFlagItemChangeOwner) != 0 {
            values.append("owner")
        }
        if flags & FSEventStreamEventFlags(kFSEventStreamEventFlagItemXattrMod) != 0 {
            values.append("xattr")
        }
        return values
    }
}

// MARK: - Server

final class JsonRpcServer {
    private let decoder = JSONDecoder()
    private let encoder = JSONEncoder()

    // Implicitly unwrapped optional to allow initialization after self is available
    private var watcher: SourceWatcher!

    init() {
        self.watcher = SourceWatcher { [weak self] changes, missingPaths in
            guard let self = self else { return }
            if !changes.isEmpty {
                self.emitEvent(HelperEvent(event: "sourceChanged", changes: changes, path: nil))
            }
            for path in missingPaths {
                self.emitEvent(HelperEvent(event: "fileMissing", changes: nil, path: path))
            }
        }
    }

    func start() {
        while let line = readLine() {
            handle(line: line)
        }
    }

    private func handle(line: String) {
        guard let data = line.data(using: .utf8) else {
            return
        }
        do {
            let request = try decoder.decode(JsonRpcRequest.self, from: data)
            switch request.method {
            case "ping":
                respond(result: PingResult(ok: true, version: "0.3.0"), id: request.id)
            case "scanFile":
                guard let path = request.params?.path else {
                    respondError(id: request.id, code: -32602, message: "Missing path param")
                    return
                }
                let result = scanFile(path: path)
                respond(result: result, id: request.id)
            case "watchSources":
                let paths = request.params?.paths ?? []
                watcher.update(paths: paths)
                respond(
                    result: WatchSourcesResult(watching: !paths.isEmpty, paths: paths),
                    id: request.id)
            case "unregisterFont":
                guard let path = request.params?.path else {
                    respondError(id: request.id, code: -32602, message: "Missing path param")
                    return
                }
                let result = unregisterFont(path: path)
                respond(result: result, id: request.id)
            case "registerFont":
                guard let path = request.params?.path else {
                    respondError(id: request.id, code: -32602, message: "Missing path param")
                    return
                }
                let result = registerFont(path: path)
                respond(result: result, id: request.id)
            case "isFontRegistered":
                guard let path = request.params?.path else {
                    respondError(id: request.id, code: -32602, message: "Missing path param")
                    return
                }
                let result = isFontRegistered(path: path)
                respond(result: result, id: request.id)
            case "getFeaturesForFace":
                guard let path = request.params?.path else {
                    respondError(id: request.id, code: -32602, message: "Missing path param")
                    return
                }
                guard let index = request.params?.index else {
                    respondError(id: request.id, code: -32602, message: "Missing index param")
                    return
                }
                let result = getFeaturesForFace(path: path, index: index)
                respond(result: result, id: request.id)
            case "renderPreview":
                guard let path = request.params?.path else {
                    respondError(id: request.id, code: -32602, message: "Missing path param")
                    return
                }
                guard let index = request.params?.index else {
                    respondError(id: request.id, code: -32602, message: "Missing index param")
                    return
                }
                guard let text = request.params?.text else {
                    respondError(id: request.id, code: -32602, message: "Missing text param")
                    return
                }
                guard let size = request.params?.size else {
                    respondError(id: request.id, code: -32602, message: "Missing size param")
                    return
                }
                let features = request.params?.features ?? []
                let variations = request.params?.variations ?? [:]
                let result = renderPreview(
                    path: path,
                    index: index,
                    text: text,
                    size: size,
                    features: features,
                    variations: variations)
                respond(result: result, id: request.id)
            default:
                respondError(id: request.id, code: -32601, message: "Method not found")
            }
        } catch {
            respondParseError()
        }
    }

    private func respond<Result: Encodable>(result: Result, id: JsonRpcId) {
        do {
            let response = JsonRpcResponse(id: id, result: result)
            let payload = try encoder.encode(response)
            if let line = String(data: payload, encoding: .utf8) {
                print(line)
                fflush(stdout)
            }
        } catch {
            respondError(id: id, code: -32603, message: "Failed to encode response")
        }
    }

    private func respondError(id: JsonRpcId, code: Int, message: String) {
        do {
            let response = JsonRpcErrorResponse(
                id: id, error: JsonRpcErrorDetail(code: code, message: message))
            let payload = try encoder.encode(response)
            if let line = String(data: payload, encoding: .utf8) {
                print(line)
                fflush(stdout)
            }
        } catch {
            respondParseError()
        }
    }

    private func respondParseError() {
        do {
            let response = JsonRpcErrorResponse(
                id: nil, error: JsonRpcErrorDetail(code: -32700, message: "Parse error"))
            let payload = try encoder.encode(response)
            if let line = String(data: payload, encoding: .utf8) {
                print(line)
                fflush(stdout)
            }
        } catch {
            print(
                "{\"jsonrpc\":\"2.0\",\"id\":null,\"error\":{\"code\":-32700,\"message\":\"Parse error\"}}"
            )
            fflush(stdout)
        }
    }

    private func emitEvent(_ event: HelperEvent) {
        do {
            let payload = try encoder.encode(event)
            if let line = String(data: payload, encoding: .utf8) {
                print(line)
                fflush(stdout)
            }
        } catch {
            // ignore event encoding errors
        }
    }

    private func scanFile(path: String) -> ScanFileResult {
        let url = URL(fileURLWithPath: path)
        guard
            let descriptors = CTFontManagerCreateFontDescriptorsFromURL(url as CFURL)
                as? [CTFontDescriptor]
        else {
            return ScanFileResult(path: path, faces: [])
        }
        var faces: [ScanFileFace] = []
        for (index, descriptor) in descriptors.enumerated() {
            // 1. Extract Name Attributes
            let familyName =
                CTFontDescriptorCopyAttribute(descriptor, kCTFontFamilyNameAttribute) as? String
                ?? "Unknown"

            // Using literal strings "NSFullName" and "NSPostScriptName" to avoid Swift compiler issues
            let fullName =
                CTFontDescriptorCopyAttribute(descriptor, "NSFullName" as CFString) as? String
                ?? CTFontDescriptorCopyAttribute(descriptor, kCTFontDisplayNameAttribute) as? String
                ?? familyName

            let postScriptName =
                CTFontDescriptorCopyAttribute(descriptor, "NSPostScriptName" as CFString) as? String
                ?? CTFontDescriptorCopyAttribute(descriptor, kCTFontNameAttribute) as? String
                ?? fullName

            let styleName =
                CTFontDescriptorCopyAttribute(descriptor, kCTFontStyleNameAttribute) as? String
                ?? "Regular"

            // 2. Extract Traits
            let traits =
                CTFontDescriptorCopyAttribute(descriptor, kCTFontTraitsAttribute)
                as? [CFString: Any]
            let weight = traits?[kCTFontWeightTrait] as? Double
            let width = traits?[kCTFontWidthTrait] as? Double
            let slant = traits?[kCTFontSlantTrait] as? Double

            // 3. Handle Bitwise logic (fixing the Int vs UInt32 error)
            let symbolic = traits?[kCTFontSymbolicTrait] as? NSNumber
            let symbolicValue = UInt32(symbolic?.uint32Value ?? 0)
            let isItalic = (symbolicValue & CTFontSymbolicTraits.italicTrait.rawValue) != 0

            // 4. Variable Fonts
            let variation = CTFontDescriptorCopyAttribute(descriptor, kCTFontVariationAttribute)
            let isVariable = variation != nil

            faces.append(
                ScanFileFace(
                    index: index,
                    familyName: familyName,
                    fullName: fullName,
                    postScriptName: postScriptName,
                    styleName: styleName,
                    weight: weight,
                    width: width,
                    slant: slant,
                    isItalic: isItalic,
                    isVariable: isVariable
                )
            )
        }
        return ScanFileResult(path: path, faces: faces)
    }

    private func unregisterFont(path: String) -> UnregisterFontResult {
        let url = URL(fileURLWithPath: path)
        var error: Unmanaged<CFError>?
        let success = CTFontManagerUnregisterFontsForURL(url as CFURL, .user, &error)
        return UnregisterFontResult(ok: success)
    }

    private func registerFont(path: String) -> RegisterFontResult {
        let url = URL(fileURLWithPath: path)
        var error: Unmanaged<CFError>?
        let success = CTFontManagerRegisterFontsForURL(url as CFURL, .user, &error)
        return RegisterFontResult(ok: success)
    }

    private func isFontRegistered(path: String) -> IsFontRegisteredResult {
        let url = URL(fileURLWithPath: path)
        // FIX: Use CTFontManagerGetScopeForURL to check status
        let scope = CTFontManagerGetScopeForURL(url as CFURL)
        return IsFontRegisteredResult(registered: scope != .none)
    }

    private func getFeaturesForFace(path: String, index: Int) -> FaceFeaturesResult {
        let url = URL(fileURLWithPath: path)
        guard
            let descriptors = CTFontManagerCreateFontDescriptorsFromURL(url as CFURL)
                as? [CTFontDescriptor],
            index >= 0,
            index < descriptors.count
        else {
            return FaceFeaturesResult(path: path, index: index, features: [], axes: [])
        }

        let descriptor = descriptors[index]
        let font = CTFontCreateWithFontDescriptor(descriptor, 0, nil)

        // --- Features Logic ---
        var features: [FontFeature] = []
        if let featureList = CTFontCopyFeatures(font) as? [[CFString: Any]] {
            for typeDict in featureList {
                guard let tag = typeDict[kCTFontOpenTypeFeatureTag] as? String else {
                    continue
                }
                let name = typeDict[kCTFontFeatureTypeNameKey] as? String ?? tag
                let selectors = typeDict[kCTFontFeatureTypeSelectorsKey] as? [[CFString: Any]] ?? []
                var enabledByDefault = false
                for selector in selectors {
                    let isDefault = selector[kCTFontFeatureSelectorDefaultKey] as? Bool ?? false
                    let selectorId = selector[kCTFontFeatureSelectorIdentifierKey] as? Int ?? 0
                    // Selector ID 1 is usually "Enable" for boolean features
                    if isDefault && selectorId == 1 {
                        enabledByDefault = true
                        break
                    }
                }
                if features.contains(where: { $0.tag == tag }) {
                    continue
                }
                features.append(
                    FontFeature(tag: tag, name: name, enabledByDefault: enabledByDefault))
            }
        }

        // --- Axes Logic (Fixed) ---
        var axes: [FontVariationAxis] = []
        if let axisList = CTFontCopyVariationAxes(font) as? [[CFString: Any]] {
            for axis in axisList {
                // 1. Get values safely
                guard
                    let minValue = axis[kCTFontVariationAxisMinimumValueKey] as? Double,
                    let maxValue = axis[kCTFontVariationAxisMaximumValueKey] as? Double,
                    let defaultValue = axis[kCTFontVariationAxisDefaultValueKey] as? Double
                else {
                    continue
                }

                let name = axis[kCTFontVariationAxisNameKey] as? String ?? "Axis"

                // 2. FIX: Get the Identifier (Int) and convert to String
                let identifier = axis[kCTFontVariationAxisIdentifierKey] as? Int ?? 0
                let tag = intToTag(identifier)

                axes.append(
                    FontVariationAxis(
                        tag: tag,
                        name: name,
                        min: minValue,
                        max: maxValue,
                        defaultValue: defaultValue
                    ))
            }
        }

        return FaceFeaturesResult(path: path, index: index, features: features, axes: axes)
    }

    private func intToTag(_ value: Int) -> String {
        let bytes: [UInt8] = [
            UInt8((value >> 24) & 0xFF),
            UInt8((value >> 16) & 0xFF),
            UInt8((value >> 8) & 0xFF),
            UInt8(value & 0xFF),
        ]
        return String(bytes: bytes, encoding: .ascii) ?? "????"
    }

    private func tagToInt(_ tag: String) -> Int? {
        let scalars = Array(tag.utf8)
        guard scalars.count == 4 else {
            return nil
        }
        let value =
            (Int(scalars[0]) << 24)
            | (Int(scalars[1]) << 16)
            | (Int(scalars[2]) << 8)
            | Int(scalars[3])
        return value
    }

    private func renderPreview(
        path: String,
        index: Int,
        text: String,
        size: Double,
        features: [String],
        variations: [String: Double]
    ) -> RenderPreviewResult {
        let url = URL(fileURLWithPath: path)
        guard
            let descriptors = CTFontManagerCreateFontDescriptorsFromURL(url as CFURL)
                as? [CTFontDescriptor],
            index >= 0,
            index < descriptors.count
        else {
            return RenderPreviewResult(ok: false, pngBase64: nil)
        }

        var descriptor = descriptors[index]
        var attributes: [CFString: Any] = [:]

        if !variations.isEmpty {
            var variationMap: [NSNumber: NSNumber] = [:]
            for (tag, value) in variations {
                guard let axisId = tagToInt(tag) else {
                    continue
                }
                variationMap[NSNumber(value: axisId)] = NSNumber(value: value)
            }
            if !variationMap.isEmpty {
                attributes[kCTFontVariationAttribute] = variationMap
            }
        }

        if !features.isEmpty {
            let settings: [[CFString: Any]] = features.map { tag in
                [
                    kCTFontOpenTypeFeatureTag: tag,
                    kCTFontOpenTypeFeatureValue: 1,
                ]
            }
            attributes[kCTFontFeatureSettingsAttribute] = settings
        }

        if !attributes.isEmpty {
            descriptor = CTFontDescriptorCreateCopyWithAttributes(
                descriptor,
                attributes as CFDictionary)
        }

        let font = CTFontCreateWithFontDescriptor(descriptor, CGFloat(size), nil)
        let attributed = NSAttributedString(
            string: text,
            attributes: [
                .font: font,
                .foregroundColor: NSColor.labelColor,
            ])
        let line = CTLineCreateWithAttributedString(attributed)

        var ascent: CGFloat = 0
        var descent: CGFloat = 0
        var leading: CGFloat = 0
        let lineWidth = CTLineGetTypographicBounds(line, &ascent, &descent, &leading)

        let padding: CGFloat = 8
        let width = max(1, ceil(CGFloat(lineWidth) + padding * 2))
        let height = max(1, ceil(ascent + descent + leading + padding * 2))

        let colorSpace = CGColorSpaceCreateDeviceRGB()
        let bitmapInfo = CGImageAlphaInfo.premultipliedLast.rawValue

        guard
            let context = CGContext(
                data: nil,
                width: Int(width),
                height: Int(height),
                bitsPerComponent: 8,
                bytesPerRow: 0,
                space: colorSpace,
                bitmapInfo: bitmapInfo)
        else {
            return RenderPreviewResult(ok: false, pngBase64: nil)
        }

        context.setFillColor(NSColor.clear.cgColor)
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))

        context.translateBy(x: 0, y: height)
        context.scaleBy(x: 1, y: -1)
        context.textPosition = CGPoint(x: padding, y: padding + descent)
        CTLineDraw(line, context)

        guard let image = context.makeImage() else {
            return RenderPreviewResult(ok: false, pngBase64: nil)
        }

        let bitmapRep = NSBitmapImageRep(cgImage: image)
        guard let pngData = bitmapRep.representation(using: .png, properties: [:]) else {
            return RenderPreviewResult(ok: false, pngBase64: nil)
        }
        return RenderPreviewResult(ok: true, pngBase64: pngData.base64EncodedString())
    }
}

// Start the server
JsonRpcServer().start()
