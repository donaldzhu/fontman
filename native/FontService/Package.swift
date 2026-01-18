// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "FontService",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "FontService", targets: ["FontService"])
    ],
    targets: [
        .executableTarget(
            name: "FontService",
            path: "Sources/FontService"
        )
    ]
)
