import Foundation

#if canImport(LLamaSwift)
import LLamaSwift
#endif

public enum MagiLlamaSupport {
    public static var isAvailable: Bool {
        #if canImport(LLamaSwift)
        true
        #else
        false
        #endif
    }
}

public actor MagiLlamaRuntime {
    public static let shared = MagiLlamaRuntime()

    #if canImport(LLamaSwift)
    private var loadedModelPath: String?
    private var model: Model?
    private var llama: LLama?
    #endif

    public func loadModel(at path: String) throws {
        #if canImport(LLamaSwift)
        if loadedModelPath == path, llama != nil {
            return
        }

        let nextModel = try Model(modelPath: path)
        let nextLlama = try LLama(model: nextModel)
        self.model = nextModel
        self.llama = nextLlama
        self.loadedModelPath = path
        #else
        throw NSError(
            domain: "MagiLlamaRuntime",
            code: 1,
            userInfo: [NSLocalizedDescriptionKey: "LLamaSwift is not available in this build."]
        )
        #endif
    }

    public func generate(prompt: String, maxTokens: Int) async throws -> String {
        #if canImport(LLamaSwift)
        guard let llama else {
            throw NSError(
                domain: "MagiLlamaRuntime",
                code: 2,
                userInfo: [NSLocalizedDescriptionKey: "Llama model is not loaded."]
            )
        }

        var output = ""
        for try await token in await llama.infer(prompt: prompt, maxTokens: maxTokens) {
            output += token
        }
        return output
        #else
        throw NSError(
            domain: "MagiLlamaRuntime",
            code: 1,
            userInfo: [NSLocalizedDescriptionKey: "LLamaSwift is not available in this build."]
        )
        #endif
    }
}
