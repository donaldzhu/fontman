import CoreText
import Foundation
import AppKit

struct JsonRpcRequest: Decodable {
    let jsonrpc: String
    let id: JsonRpcId
    let method: String
    let params: [String: String]?
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

final class JsonRpcServer {
    private let decoder = JSONDecoder()
    private let encoder = JSONEncoder()

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
                respond(result: PingResult(ok: true, version: "0.2.0"), id: request.id)
            case "scanFile":
                guard let path = request.params?["path"] else {
                    respondError(id: request.id, code: -32602, message: "Missing path param")
                    return
                }
                let result = scanFile(path: path)
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
            let response = JsonRpcErrorResponse(id: id, error: JsonRpcErrorDetail(code: code, message: message))
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
            let response = JsonRpcErrorResponse(id: nil, error: JsonRpcErrorDetail(code: -32700, message: "Parse error"))
            let payload = try encoder.encode(response)
            if let line = String(data: payload, encoding: .utf8) {
                print(line)
                fflush(stdout)
            }
        } catch {
            print("{\"jsonrpc\":\"2.0\",\"id\":null,\"error\":{\"code\":-32700,\"message\":\"Parse error\"}}")
            fflush(stdout)
        }
    }

    private func scanFile(path: String) -> ScanFileResult {
        let url = URL(fileURLWithPath: path)
        guard let descriptors = CTFontManagerCreateFontDescriptorsFromURL(url as CFURL) as? [CTFontDescriptor] else {
            return ScanFileResult(path: path, faces: [])
        }
        var faces: [ScanFileFace] = []
        for (index, descriptor) in descriptors.enumerated() {
            // 1. Extract Name Attributes
            let familyName = CTFontDescriptorCopyAttribute(descriptor, kCTFontFamilyNameAttribute) as? String ?? "Unknown"

            // Using literal strings "NSFullName" and "NSPostScriptName" to avoid Swift compiler issues
            // with kCTFontFullNameAttribute / kCTFontPostScriptNameAttribute
            let fullName = CTFontDescriptorCopyAttribute(descriptor, "NSFullName" as CFString) as? String
                ?? CTFontDescriptorCopyAttribute(descriptor, kCTFontDisplayNameAttribute) as? String
                ?? familyName

            let postScriptName = CTFontDescriptorCopyAttribute(descriptor, "NSPostScriptName" as CFString) as? String
                ?? CTFontDescriptorCopyAttribute(descriptor, kCTFontNameAttribute) as? String
                ?? fullName

            let styleName = CTFontDescriptorCopyAttribute(descriptor, kCTFontStyleNameAttribute) as? String ?? "Regular"

            // 2. Extract Traits
            let traits = CTFontDescriptorCopyAttribute(descriptor, kCTFontTraitsAttribute) as? [CFString: Any]
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
} // End of Class

// Start the server outside the class
JsonRpcServer().start()