import Foundation

struct JsonRpcRequest: Decodable {
    let jsonrpc: String
    let id: JsonRpcId
    let method: String
    let params: [String: String]?
}

enum JsonRpcId: Decodable {
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

    func encode() -> String {
        switch self {
        case .string(let value):
            return "\"\(value)\""
        case .number(let value):
            return String(value)
        }
    }
}

struct JsonRpcSuccess: Encodable {
    let jsonrpc: String
    let id: String
    let result: PingResult
}

struct PingResult: Encodable {
    let ok: Bool
    let version: String
}

final class JsonRpcServer {
    private let decoder = JSONDecoder()

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
                respondPing(id: request.id)
            default:
                respondError(id: request.id, code: -32601, message: "Method not found")
            }
        } catch {
            respondParseError()
        }
    }

    private func respondPing(id: JsonRpcId) {
        let result = PingResult(ok: true, version: "0.1.0")
        let response = "{\"jsonrpc\":\"2.0\",\"id\":\(id.encode()),\"result\":{\"ok\":true,\"version\":\"\(result.version)\"}}"
        print(response)
        fflush(stdout)
    }

    private func respondError(id: JsonRpcId, code: Int, message: String) {
        let response = "{\"jsonrpc\":\"2.0\",\"id\":\(id.encode()),\"error\":{\"code\":\(code),\"message\":\"\(message)\"}}"
        print(response)
        fflush(stdout)
    }

    private func respondParseError() {
        let response = "{\"jsonrpc\":\"2.0\",\"id\":null,\"error\":{\"code\":-32700,\"message\":\"Parse error\"}}"
        print(response)
        fflush(stdout)
    }
}

JsonRpcServer().start()
