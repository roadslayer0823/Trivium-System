import Foundation
import Capacitor
import MediaPipeTasksGenAI

/**
 * MAGI Native LLM Plugin
 * 
 * Provides native on-device LLM inference using Google MediaPipe (LiteRT).
 * Downloads a LiteRT task model on first launch and caches it locally for reuse.
 */
@objc(MagiNativeLLMPlugin)
public final class MagiNativeLLMPlugin: CAPPlugin, CAPBridgedPlugin, URLSessionDownloadDelegate {
    public let identifier = "MagiNativeLLMPlugin"
    public let jsName = "MagiNativeLLM"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "initialize", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "generate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "checkModelExists", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getFreeDiskSpace", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "checkDeviceCompatibility", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "retryDownload", returnType: CAPPluginReturnPromise)
    ]

    private var inference: LlmInference?
    private var isReady = false
    private var lastError: String?
    
    // Sampling parameters stored from initialization
    private var modelTopK: Int = 40
    private var modelTemperature: Float = 0.8
    private var modelMaxTokens: Int = 256
    private var modelPath: String?
    private var modelUrl: String?
    private let modelCacheDirectory = "MagiModels"
    private var currentStage = "IDLE"
    private var progress: Double = 0
    private var pendingInitializeCall: CAPPluginCall?
    private var downloadDestinationURL: URL?
    private var downloadSession: URLSession?
    private var downloadStartTime: CFAbsoluteTime?
    private var downloadSpeedMbps: Double = 0
    private var lastDownloadError: String?
    private var canRetryDownload: Bool = false
    private var downloadResumeData: Data?

    private func logTrace(_ step: String, _ details: String) {
        print("⚡️ [MAGI TRACE] \(step) | \(details)")
    }

    private func timestamp() -> CFAbsoluteTime {
        CFAbsoluteTimeGetCurrent()
    }

    private func elapsedMs(since start: CFAbsoluteTime) -> String {
        String(format: "%.0fms", (timestamp() - start) * 1000)
    }

    private func setStatus(stage: String, progress: Double? = nil) {
        currentStage = stage
        if let progress {
            self.progress = min(max(progress, 0), 1)
        }
    }

    private func statusPayload(stage: String? = nil, isReady: Bool? = nil, lastError: String? = nil) -> [String: Any] {
        [
            "stage": stage ?? currentStage,
            "isReady": isReady ?? self.isReady,
            "progress": progress,
            "modelPath": modelPath ?? "",
            "modelUrl": modelUrl ?? "",
            "lastError": lastError ?? self.lastError ?? "",
            "downloadSpeedMbps": downloadSpeedMbps,
            "canRetryDownload": canRetryDownload
        ]
    }

    private func applicationSupportDirectory() throws -> URL {
        let fileManager = FileManager.default
        var directory = try fileManager.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        ).appendingPathComponent(modelCacheDirectory, isDirectory: true)

        if !fileManager.fileExists(atPath: directory.path) {
            try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        }

        var resourceValues = URLResourceValues()
        resourceValues.isExcludedFromBackup = true
        try? directory.setResourceValues(resourceValues)
        return directory
    }

    private func cachedModelURL(fileName: String, fileExtension: String) throws -> URL {
        try applicationSupportDirectory().appendingPathComponent("\(fileName).\(fileExtension)")
    }

    private func getMemoryUsage() -> String {
        var taskInfo = mach_task_basic_info()
        var count = mach_msg_type_number_t(MemoryLayout<mach_task_basic_info>.size) / 4
        let kerr: kern_return_t = withUnsafeMutablePointer(to: &taskInfo) {
            $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
                task_info(mach_task_self_, task_flavor_t(MACH_TASK_BASIC_INFO), $0, &count)
            }
        }
        if kerr == KERN_SUCCESS {
            let usedMB = taskInfo.resident_size / (1024 * 1024)
            return "\(usedMB) MB"
        } else {
            return "Unknown"
        }
    }
    
    private var isSimulator: Bool {
        #if targetEnvironment(simulator)
        return true
        #else
        return false
        #endif
    }
    
    private var isPhysicalDevice: Bool {
        !isSimulator
    }
    
    private var architecture: String {
        #if arch(arm64)
        return "ARM64"
        #elseif arch(x86_64)
        return "x86_64"
        #else
        return "UNKNOWN"
        #endif
    }
    
    private var isAffectedDevice: Bool {
        // Check for Metal 3 support (available on iPhone 15+)
        // This automatically supports future devices without code updates
        guard let device = MTLCreateSystemDefaultDevice() else {
            return true // No Metal support
        }
        
        // Metal 3 features: ray tracing, mesh shaders, etc.
        // Check if device supports ray tracing (Metal 3 feature)
        let supportsRayTracing = device.supportsFamily(.apple7) || device.supportsFamily(.apple8)
        
        return !supportsRayTracing
    }

    private func initializeInference(at localURL: URL, call: CAPPluginCall) {
        print("⚡️ [MAGI NATIVE] Initializing LlmInference. Device: \(isSimulator ? "SIMULATOR" : "PHYSICAL"). Architecture: \(architecture). RAM usage: \(getMemoryUsage())")
        setStatus(stage: "INITIALIZING", progress: 0.9)
        let startedAt = timestamp()

        let maxTokens = call.getInt("maxTokens", 256)
        self.modelMaxTokens = maxTokens
        self.modelTopK = call.getInt("topK", 40)
        self.modelTemperature = call.getFloat("temperature", 0.8)
        logTrace("INIT_START", "device=\(isSimulator ? "SIMULATOR" : "PHYSICAL") arch=\(architecture) path=\(localURL.lastPathComponent) maxTokens=\(maxTokens) topK=\(self.modelTopK) temperature=\(self.modelTemperature)")
        
        // Use .userInitiated on physical devices to prevent thread termination causing null pointer crashes
        // .background QoS was causing the thread to be killed during MediaPipe operations
        let qos: DispatchQoS.QoSClass = isPhysicalDevice ? .userInitiated : .utility
        print("⚡️ [MAGI NATIVE] Using QoS: \(qos == .userInitiated ? "USER_INITIATED (physical device)" : "UTILITY (simulator)")")
        
        DispatchQueue.global(qos: qos).async {
            do {
                self.inference = nil 
                
                let options = LlmInference.Options(modelPath: localURL.path)
                options.maxTokens = maxTokens
                options.maxTopk = 40 // Define the maximum TopK allowed for all sessions
                
                self.inference = try LlmInference(options: options)
                
                self.isReady = true
                self.lastError = nil
                self.modelPath = localURL.path
                self.setStatus(stage: "READY", progress: 1)

                print("⚡️ [MAGI NATIVE] LlmInference READY. RAM: \(self.getMemoryUsage()) (T:\(self.modelTemperature) K:\(self.modelTopK))")
                self.logTrace("INIT_READY", "elapsed=\(self.elapsedMs(since: startedAt)) ram=\(self.getMemoryUsage())")
                
                DispatchQueue.main.async {
                    call.resolve(self.statusPayload(stage: "READY", isReady: true))
                }
            } catch {
                let errorMsg = "MediaPipe initialization failed: \(error.localizedDescription)"
                print("❌ [MAGI NATIVE] \(errorMsg)")
                self.logTrace("INIT_ERROR", "elapsed=\(self.elapsedMs(since: startedAt)) error=\(errorMsg)")
                self.lastError = errorMsg
                self.isReady = false
                self.setStatus(stage: "ERROR", progress: 1)
                DispatchQueue.main.async {
                    call.resolve(self.statusPayload(stage: "ERROR", isReady: false, lastError: errorMsg))
                }
            }
        }
    }

    private func downloadModel(from remoteURL: URL, to localURL: URL, call: CAPPluginCall) {
        print("⚡️ [MAGI NATIVE] Starting public model download from: \(remoteURL)")
        logTrace("DOWNLOAD_START", "url=\(remoteURL.absoluteString) dest=\(localURL.lastPathComponent)")
        
        setStatus(stage: "DOWNLOADING", progress: 0.1)
        pendingInitializeCall = call
        downloadDestinationURL = localURL
        downloadSession?.invalidateAndCancel()
        
        let config = URLSessionConfiguration.default
        config.httpAdditionalHeaders = [
            "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1"
        ]
        
        let session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
        downloadSession = session
        
        var request = URLRequest(url: remoteURL)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        
        print("⚡️ [MAGI NATIVE] Request initiated with Browser User-Agent.")
        session.downloadTask(with: request).resume()
    }

    @objc func initialize(_ call: CAPPluginCall) {
        let initializeStartedAt = timestamp()
        let modelFileName = call.getString("modelFileName", "gemma-4-E2B-it")
        let modelFileExtension = call.getString("modelFileExtension", "litertlm")
        let remoteModelURLString = call.getString("modelUrl", "")
        let forceRedownload = call.getBool("forceRedownload", false)
        var requestedMaxTokens = call.getInt("maxTokens", 256)
        let requestedTopK = call.getInt("topK", 40)
        let requestedTemperature = call.getFloat("temperature", 0.8)
        let modelTopP = call.getFloat("topP") ?? 1.0

        self.modelUrl = remoteModelURLString
        self.lastError = nil
        setStatus(stage: "CHECKING_CACHE", progress: 0.05)
        print("⚡️ [MAGI NATIVE] Initialize called for: \(modelFileName).\(modelFileExtension). Device: \(isSimulator ? "SIMULATOR" : "PHYSICAL")")
        logTrace("BOOT_REQUEST", "device=\(isSimulator ? "SIMULATOR" : "PHYSICAL") model=\(modelFileName).\(modelFileExtension) forceRedownload=\(forceRedownload)")
        
        // Reduce maxTokens on physical devices to reduce memory pressure
        if isPhysicalDevice && requestedMaxTokens > 256 {
            requestedMaxTokens = 256
            print("⚡️ [MAGI NATIVE] Reduced maxTokens to 256 for physical device to reduce memory pressure")
            logTrace("MAX_TOKENS_REDUCED", "original=\(call.getInt("maxTokens", 256)) reduced=256")
        }

        guard let remoteModelURL = URL(string: remoteModelURLString) else {
            let error = "The configured model URL is empty or invalid."
            print("❌ [MAGI NATIVE] \(error)")
            self.lastError = error
            setStatus(stage: "ERROR", progress: 1)
            call.resolve(statusPayload(stage: "ERROR", isReady: false, lastError: error))
            return
        }

        do {
            let localURL = try cachedModelURL(fileName: modelFileName, fileExtension: modelFileExtension)

            let requestedModelPath = localURL.path
            if
                self.isReady,
                self.inference != nil,
                self.modelPath == requestedModelPath,
                self.modelMaxTokens == requestedMaxTokens
            {
                self.modelTopK = requestedTopK
                self.modelTemperature = requestedTemperature
                self.setStatus(stage: "READY", progress: 1)
                print("⚡️ [MAGI NATIVE] Reusing existing LlmInference instance.")
                logTrace("BOOT_REUSE", "source=memory elapsed=\(elapsedMs(since: initializeStartedAt))")
                call.resolve(self.statusPayload(stage: "READY", isReady: true))
                return
            }
            

            print("⚡️ [MAGI NATIVE] Strategy 2: Checking local cache at: \(localURL.path)")
            self.modelPath = localURL.path
            let exists = FileManager.default.fileExists(atPath: localURL.path)
            
            if exists, !forceRedownload {
                let attributes = try? FileManager.default.attributesOfItem(atPath: localURL.path)
                let fileSize = attributes?[.size] as? Int64 ?? 0
                print("⚡️ [MAGI NATIVE] Cache file found. Size: \(fileSize) bytes")
                logTrace("BOOT_SOURCE", "cache path=\(localURL.path) size=\(fileSize)")
                
                if fileSize > 2 * 1024 * 1024 * 1024 { // 2GB minimal check for 2.58GB model
                    print("⚡️ [MAGI NATIVE] Cache hit! Size valid. Initializing...")
                    self.isReady = false
                    setStatus(stage: "CACHE_HIT", progress: 0.7)
                    initializeInference(at: localURL, call: call)
                    return
                }
            }
            
            print("⚡️ [MAGI NATIVE] Strategy 3: No local file found. Attempting download...")
            logTrace("BOOT_SOURCE", "remote-download path=\(localURL.path)")
            self.isReady = false
            self.inference = nil
            downloadModel(from: remoteModelURL, to: localURL, call: call)
        } catch {
            let errorMsg = "Failed to prepare local model cache: \(error.localizedDescription)"
            print("❌ [MAGI NATIVE] \(errorMsg)")
            self.lastError = errorMsg
            setStatus(stage: "ERROR", progress: 1)
            call.resolve(statusPayload(stage: "ERROR", isReady: false, lastError: errorMsg))
        }
    }

    private func resolvePendingDownloadError(_ message: String) {
        print("❌ [MAGI NATIVE] \(message)")
        logTrace("DOWNLOAD_ERROR", message)
        lastError = message
        isReady = false
        setStatus(stage: "ERROR", progress: 1)
        pendingInitializeCall?.resolve(statusPayload(stage: "ERROR", isReady: false, lastError: message))
        pendingInitializeCall = nil
        
        // Only clear destination if we can't retry, otherwise we need it for retryDownload()
        if !canRetryDownload {
            downloadDestinationURL = nil
        }
        
        downloadSession?.finishTasksAndInvalidate()
        downloadSession = nil
    }

    public func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        guard totalBytesExpectedToWrite > 0 else {
            return
        }

        let fraction = Double(totalBytesWritten) / Double(totalBytesExpectedToWrite)
        let scaledProgress = 0.1 + (fraction * 0.75)
        
        // Calculate download speed
        if downloadStartTime == nil {
            downloadStartTime = timestamp()
        }
        
        if let startTime = downloadStartTime, totalBytesWritten > 0 {
            let elapsedSeconds = timestamp() - startTime
            if elapsedSeconds > 0 {
                let bytesPerSecond = Double(totalBytesWritten) / elapsedSeconds
                let megabytesPerSecond = bytesPerSecond / 1_000_000
                downloadSpeedMbps = megabytesPerSecond
            }
        }
        
        setStatus(stage: "DOWNLOADING", progress: scaledProgress)
        if totalBytesWritten == bytesWritten || totalBytesWritten == totalBytesExpectedToWrite {
            logTrace("DOWNLOAD_PROGRESS", "\(totalBytesWritten)/\(totalBytesExpectedToWrite) speed=\(downloadSpeedMbps)Mbps")
        }
    }

    public func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        guard let call = pendingInitializeCall, let localURL = downloadDestinationURL else {
            return
        }

        // Reset download tracking
        downloadStartTime = nil
        downloadSpeedMbps = 0
        downloadResumeData = nil
        canRetryDownload = false

        if let httpResponse = downloadTask.response as? HTTPURLResponse, !(200...299).contains(httpResponse.statusCode) {
            resolvePendingDownloadError("Model download failed with HTTP status \(httpResponse.statusCode).")
            return
        }

        do {
            let fileManager = FileManager.default
            let attributes = try fileManager.attributesOfItem(atPath: location.path)
            let fileSize = (attributes[.size] as? NSNumber)?.int64Value ?? 0
            print("⚡️ [MAGI NATIVE] Download complete. File size: \(fileSize) bytes")
            logTrace("DOWNLOAD_COMPLETE", "tempSize=\(fileSize)")

            if fileSize < 50_000_000 {
                resolvePendingDownloadError("Downloaded file is too small to be a valid model (\(fileSize) bytes).")
                return
            }

            setStatus(stage: "STORING", progress: 0.88)
            if fileManager.fileExists(atPath: localURL.path) {
                try fileManager.removeItem(at: localURL)
            }
            try fileManager.moveItem(at: location, to: localURL)
            print("⚡️ [MAGI NATIVE] Model moved to cache: \(localURL.path)")

            pendingInitializeCall = nil
            downloadDestinationURL = nil
            downloadSession?.finishTasksAndInvalidate()
            downloadSession = nil

            initializeInference(at: localURL, call: call)
        } catch {
            resolvePendingDownloadError("Failed to store downloaded model: \(error.localizedDescription)")
        }
    }

    public func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let error else {
            return
        }

        // Check if it's a network error
        let nsError = error as NSError
        let isNetworkError = nsError.domain == NSURLErrorDomain && (
            nsError.code == NSURLErrorNotConnectedToInternet ||
            nsError.code == NSURLErrorNetworkConnectionLost ||
            nsError.code == NSURLErrorTimedOut
        )
        
        if isNetworkError {
            lastDownloadError = "Network connection lost"
            canRetryDownload = true
            // Save resume data for retry from error userInfo
            if let resumeData = nsError.userInfo[NSURLSessionDownloadTaskResumeData] as? Data {
                downloadResumeData = resumeData
            }
        } else {
            lastDownloadError = error.localizedDescription
            canRetryDownload = false
            downloadResumeData = nil
        }

        if pendingInitializeCall != nil {
            resolvePendingDownloadError("Model download failed: \(error.localizedDescription)")
        }
    }

    @objc func generate(_ call: CAPPluginCall) {
        guard let inference = self.inference, isReady else {
            call.resolve([
                "text": "[SYSTEM]|0|LLM engine not initialized."
            ])
            return
        }

        let prompt = call.getString("prompt", "")
        if prompt.isEmpty {
            call.resolve([
                "text": "[SYSTEM]|0|Prompt is empty."
            ])
            return
        }

        print("⚡️ [MAGI NATIVE] Starting inference for prompt length: \(prompt.count). Device: \(isSimulator ? "SIMULATOR" : "PHYSICAL"). Architecture: \(architecture)")
        let preview = prompt.replacingOccurrences(of: "\n", with: " ").prefix(140)
        logTrace("GENERATE_REQUEST", "device=\(isSimulator ? "SIMULATOR" : "PHYSICAL") arch=\(architecture) promptChars=\(prompt.count) preview=\(preview)")
        
        // WORKAROUND: Run inference on main thread for physical devices to prevent MediaPipe ARM64 memory corruption bug
        // MediaPipe LiteRT has null pointer dereference issue on ARM64 background threads
        let runOnMainThread = isPhysicalDevice
        print("⚡️ [MAGI NATIVE] Running inference on \(runOnMainThread ? "MAIN THREAD (physical device workaround)" : "BACKGROUND QUEUE (simulator)")")
        
        let inferenceBlock = {
            let generationStartedAt = self.timestamp()
            
            // Add safety check for prompt length
            if prompt.count > 10000 {
                print("⚡️ [MAGI NATIVE] Prompt too long: \(prompt.count) characters, truncating")
                self.logTrace("GENERATE_WARNING", "promptTooLong=\(prompt.count)")
            }
            
            do {
                // Create strong reference to prevent deallocation during operation
                guard let inference = self.inference else {
                    throw NSError(domain: "MAGI", code: 1, userInfo: [NSLocalizedDescriptionKey: "Inference Engine not initialized"])
                }
                
                // Double-check inference is still valid (not deallocated)
                let inferenceCheck = inference
                print("⚡️ [MAGI NATIVE] Inference object reference validated")
                
                // Check memory pressure before inference on physical devices
                if self.isPhysicalDevice {
                    let memoryBefore = self.getMemoryUsage()
                    print("⚡️ [MAGI NATIVE] Memory before inference: \(memoryBefore)")
                    self.logTrace("MEMORY_CHECK", "before=\(memoryBefore)")
                    
                    // Parse memory value for warning
                    if let memoryMB = Int(memoryBefore.replacingOccurrences(of: " MB", with: "")), memoryMB > 1500 {
                        print("⚡️ [MAGI NATIVE] WARNING: High memory usage before inference: \(memoryMB) MB")
                        self.logTrace("MEMORY_WARNING", "highUsage=\(memoryMB)MB")
                    }
                }
                
                self.logTrace("INFERENCE_START", "promptLength=\(prompt.count) ram=\(self.getMemoryUsage())")
                
                // Session Insulation
                let sessionOptions = LlmInference.Session.Options()
                sessionOptions.topk = self.modelTopK
                sessionOptions.temperature = self.modelTemperature
                sessionOptions.randomSeed = 0
                self.logTrace("SESSION_OPTIONS", "topK=\(self.modelTopK) temperature=\(self.modelTemperature)")
                
                let session: LlmInference.Session
                do {
                    session = try LlmInference.Session(llmInference: inference, options: sessionOptions)
                    self.logTrace("SESSION_CREATED", "elapsed=\(self.elapsedMs(since: generationStartedAt))")
                } catch {
                    print("❌ [MAGI NATIVE] Session creation failed: \(error.localizedDescription)")
                    self.logTrace("SESSION_CREATE_ERROR", "error=\(error.localizedDescription)")
                    throw error
                }
                
                // Session API requires adding query chunks first
                do {
                    try session.addQueryChunk(inputText: prompt)
                    self.logTrace("QUERY_ADDED", "elapsed=\(self.elapsedMs(since: generationStartedAt))")
                } catch {
                    print("❌ [MAGI NATIVE] addQueryChunk failed: \(error.localizedDescription)")
                    self.logTrace("QUERY_ERROR", "error=\(error.localizedDescription)")
                    throw error
                }
                
                // Early stop detection variables
                var fullResponse = ""
                var chunkCount = 0
                var didEarlyStop = false
                var isCallResolved = false
                
                // Streaming generation with early stop
                try session.generateResponseAsync(progress: { partialText, error in
                    if let error = error {
                        print("❌ [MAGI NATIVE] Generation Error: \(error.localizedDescription)")
                    }
                    
                    if let text = partialText, !text.isEmpty && !didEarlyStop {
                        chunkCount += 1
                        fullResponse += text
                        
                        // Early stop detection: check for repetition patterns
                        let responseLower = fullResponse.lowercased()
                        
                        // Check for identity name repetition
                        let identityNames = ["clotho-1", "lachesis-2", "atropos-3"]
                        for identityName in identityNames {
                            let parts = responseLower.components(separatedBy: identityName)
                            if parts.count > 3 {
                                print("🛑 [MAGI NATIVE] EARLY_STOP detected repetition of \(identityName) (occurrences=\(parts.count - 1))")
                                self.logTrace("EARLY_STOP", "reason=repetition identity=\(identityName) chunk=\(chunkCount)")
                                didEarlyStop = true
                                
                                // Truncate at second occurrence
                                if let firstRange = fullResponse.range(of: identityName, options: .caseInsensitive),
                                   let secondRange = fullResponse.range(of: identityName, options: .caseInsensitive, range: firstRange.upperBound..<fullResponse.endIndex) {
                                    let truncated = String(fullResponse[..<secondRange.lowerBound]).trimmingCharacters(in: .whitespacesAndNewlines)
                                    if !isCallResolved {
                                        isCallResolved = true
                                        DispatchQueue.main.async {
                                            call.resolve(["text": truncated])
                                        }
                                    }
                                }
                                return
                            }
                        }
                        
                        // Check for full pattern repetition (IDENTITY|VOTE|)
                        for identityName in identityNames {
                            let pattern1 = "\(identityName)|yes|"
                            let pattern2 = "\(identityName)|no|"
                            for pattern in [pattern1, pattern2] {
                                let parts = responseLower.components(separatedBy: pattern)
                                if parts.count > 2 {
                                    print("🛑 [MAGI NATIVE] EARLY_STOP detected pattern repetition of \(pattern) (occurrences=\(parts.count - 1))")
                                    self.logTrace("EARLY_STOP", "reason=patternRepetition pattern=\(pattern) chunk=\(chunkCount)")
                                    didEarlyStop = true
                                    
                                    if let firstRange = fullResponse.range(of: pattern, options: .caseInsensitive),
                                       let secondRange = fullResponse.range(of: pattern, options: .caseInsensitive, range: firstRange.upperBound..<fullResponse.endIndex) {
                                        let truncated = String(fullResponse[..<secondRange.lowerBound]).trimmingCharacters(in: .whitespacesAndNewlines)
                                        if !isCallResolved {
                                            isCallResolved = true
                                            DispatchQueue.main.async {
                                                call.resolve(["text": truncated])
                                            }
                                        }
                                    }
                                    return
                                }
                            }
                        }
                        
                        // Check for special token repetition
                        let stopTokens = ["<eos>", "<turn|>", "<end_of_turn>"]
                        for stopToken in stopTokens {
                            let tokenCount = fullResponse.components(separatedBy: stopToken).count - 1
                            
                            // IMMEDIATE STOP: <turn|> after content signals model confusion
                            // Skip leading <turn|> tokens at the start of response
                            if stopToken == "<turn|>" && tokenCount >= 1 {
                                let stripped = fullResponse.replacingOccurrences(of: "^(\\s*<turn\\|>\\s*)+", with: "", options: [.regularExpression])
                                if stripped.contains("<turn|>") {
                                    print("🛑 [MAGI NATIVE] EARLY_STOP detected <turn|> after content — model confusion")
                                    self.logTrace("EARLY_STOP", "reason=turnTokenAfterContent chunk=\(chunkCount)")
                                    didEarlyStop = true
                                    
                                    if let range = stripped.range(of: "<turn|>") {
                                        let truncated = String(stripped[..<range.lowerBound]).trimmingCharacters(in: .whitespacesAndNewlines)
                                        if !isCallResolved {
                                            isCallResolved = true
                                            DispatchQueue.main.async {
                                                call.resolve(["text": truncated])
                                            }
                                        }
                                    }
                                    return
                                }
                            }
                            
                            if tokenCount > 2 {
                                print("🛑 [MAGI NATIVE] EARLY_STOP detected repetition of \(stopToken) (occurrences=\(tokenCount))")
                                self.logTrace("EARLY_STOP", "reason=stopToken token=\(stopToken) chunk=\(chunkCount)")
                                didEarlyStop = true
                                
                                if let range = fullResponse.range(of: stopToken, options: .backwards) {
                                    let truncated = String(fullResponse[..<range.lowerBound]).trimmingCharacters(in: .whitespacesAndNewlines)
                                    if !isCallResolved {
                                        isCallResolved = true
                                        DispatchQueue.main.async {
                                            call.resolve(["text": truncated])
                                        }
                                    }
                                }
                                return
                            }
                        }
                        
                        // Check for pipe character runaway (model stuck generating | forever)
                        let pipeCount = fullResponse.filter { $0 == "|" }.count
                        if pipeCount > 10 {
                            // Count how many pipes are consecutive at the end
                            let trailingPipes = fullResponse.reversed().prefix(while: { $0 == "|" || $0.isWhitespace }).filter { $0 == "|" }.count
                            if trailingPipes >= 3 || pipeCount > 15 {
                                print("🛑 [MAGI NATIVE] EARLY_STOP detected pipe runaway (total=\(pipeCount), trailing=\(trailingPipes))")
                                self.logTrace("EARLY_STOP", "reason=pipeRunaway pipes=\(pipeCount) trailing=\(trailingPipes) chunk=\(chunkCount)")
                                didEarlyStop = true
                                
                                // Truncate at the last non-pipe character
                                let trimmed = fullResponse.trimmingCharacters(in: CharacterSet(charactersIn: "| \n\r\t"))
                                if !isCallResolved {
                                    isCallResolved = true
                                    DispatchQueue.main.async {
                                        call.resolve(["text": trimmed])
                                    }
                                }
                                return
                            }
                        }
                        
                        // Log progress every 10 chunks
                        if chunkCount % 10 == 0 {
                            let elapsed = self.elapsedMs(since: generationStartedAt)
                            let preview = text.replacingOccurrences(of: "\n", with: " ").prefix(50)
                            print("⚡️ [MAGI NATIVE] GENERATING chunk=\(chunkCount) elapsed=\(elapsed)ms preview=\"\(preview)\"")
                            self.logTrace("GENERATING", "chunk=\(chunkCount) elapsed=\(elapsed)")
                        }
                    }
                }, completion: {
                    if isCallResolved { return }
                    
                    do {
                        let result = try session.generateResponse()
                        let elapsed = self.elapsedMs(since: generationStartedAt)
                        let preview = result.replacingOccurrences(of: "\n", with: " ").prefix(180)
                        print("✅ [MAGI NATIVE] Inference complete in \(elapsed)ms. RAM: \(self.getMemoryUsage())")
                        self.logTrace("GENERATE_COMPLETE", "elapsed=\(elapsed) responseChars=\(result.count) preview=\(preview)")
                        
                        if !isCallResolved {
                            isCallResolved = true
                            DispatchQueue.main.async {
                                call.resolve(["text": result])
                            }
                        }
                    } catch {
                        if !isCallResolved {
                            print("❌ [MAGI NATIVE] Completion failed: \(error.localizedDescription)")
                            isCallResolved = true
                            DispatchQueue.main.async {
                                call.resolve(["text": "[SYSTEM]|0|Generation failed: \(error.localizedDescription)"])
                            }
                        }
                    }
                })
                
                // Wait for early stop or completion
                while !isCallResolved {
                    Thread.sleep(forTimeInterval: 0.01)
                }

                // CRITICAL: Recreate LlmInference object after each generation to clear internal state
                // LlmInference tracks state across all sessions, so we need a fresh instance
                if let modelPath = self.modelPath {
                    do {
                        let options = LlmInference.Options(modelPath: modelPath)
                        options.maxTokens = self.modelMaxTokens
                        options.maxTopk = 40
                        self.inference = try LlmInference(options: options)
                        print("⚡️ [MAGI NATIVE] LlmInference recreated for next generation. RAM: \(self.getMemoryUsage())")
                    } catch {
                        print("❌ [MAGI NATIVE] Failed to recreate LlmInference: \(error.localizedDescription)")
                    }
                }

                print("⚡️ [MAGI NATIVE] Inference complete. RAM: \(self.getMemoryUsage())")
            } catch {
                print("❌ [MAGI NATIVE] Inference failed: \(error.localizedDescription)")
                self.logTrace("GENERATE_ERROR", "elapsed=\(self.elapsedMs(since: generationStartedAt)) error=\(error.localizedDescription)")
                DispatchQueue.main.async {
                    call.resolve([
                        "text": "[SYSTEM]|0|Inference failed on the native model: \(error.localizedDescription)"
                    ])
                }
            }
        }
        
        if runOnMainThread {
            // Run synchronously on main thread for physical devices (workaround for MediaPipe ARM64 bug)
            inferenceBlock()
        } else {
            // Run on background queue for simulator
            DispatchQueue.global(qos: .utility).async(execute: inferenceBlock)
        }
    }

    @objc func getStatus(_ call: CAPPluginCall) {
        call.resolve(statusPayload(stage: isReady ? "READY" : (lastError != nil ? "ERROR" : currentStage), isReady: isReady))
    }
    
    @objc func checkModelExists(_ call: CAPPluginCall) {
        let modelFileName = call.getString("modelFileName", "gemma-4-E2B-it")
        let modelFileExtension = call.getString("modelFileExtension", "litertlm")
        
        do {
            let localURL = try cachedModelURL(fileName: modelFileName, fileExtension: modelFileExtension)
            let cacheExists = FileManager.default.fileExists(atPath: localURL.path)
            if cacheExists {
                let attributes = try? FileManager.default.attributesOfItem(atPath: localURL.path)
                let fileSize = attributes?[.size] as? Int64 ?? 0
                
                // If it exists but is too small (partial download), treat as not existing
                if fileSize < 1024 * 1024 * 1024 { // Less than 1GB is definitely partial
                    call.resolve([
                        "exists": false,
                        "path": localURL.path,
                        "fileSize": fileSize
                    ])
                    return
                }
                
                call.resolve([
                    "exists": true,
                    "path": localURL.path,
                    "fileSize": fileSize
                ])
                return
            }
            
            call.resolve([
                "exists": false,
                "path": localURL.path,
                "fileSize": 0
            ])
        } catch {
            call.resolve([
                "exists": false,
                "path": "",
                "fileSize": 0
            ])
        }
    }
    
    @objc func getFreeDiskSpace(_ call: CAPPluginCall) {
        do {
            let fileURL = try applicationSupportDirectory()
            let attributes = try FileManager.default.attributesOfFileSystem(forPath: fileURL.path)
            
            if let freeSpace = attributes[.systemFreeSize] as? UInt64 {
                let freeGB = Double(freeSpace) / (1024.0 * 1024.0 * 1024.0)
                call.resolve([
                    "freeGB": freeGB,
                    "freeBytes": freeSpace
                ])
            } else {
                call.resolve([
                    "freeGB": 0,
                    "freeBytes": 0
                ])
            }
        } catch {
            call.resolve([
                "freeGB": 0,
                "freeBytes": 0
            ])
        }
    }
    
    @objc func checkDeviceCompatibility(_ call: CAPPluginCall) {
        var size: Int = 0
        sysctlbyname("hw.machine", nil, &size, nil, 0)
        var machine = [CChar](repeating: 0, count: size)
        sysctlbyname("hw.machine", &machine, &size, nil, 0)
        let model = String(cString: machine)
        
        // Check for Metal 3 support (ray tracing capability)
        guard let device = MTLCreateSystemDefaultDevice() else {
            call.resolve([
                "isSupported": false,
                "deviceModel": model,
                "reason": "Metal support not available. Gemma 4 requires Metal 3 (iPhone 15 or later)."
            ])
            return
        }
        
        // A17 Pro (iPhone 15 Pro) and newer are Apple 9 family
        // These chips have the required performance and memory for Gemma 4
        let isA17OrNewer = device.supportsFamily(.apple9)
        
        call.resolve([
            "isSupported": isA17OrNewer,
            "deviceModel": model,
            "reason": isA17OrNewer ? nil : "This device is not supported. Requires A17 Pro chip or newer (iPhone 15 Pro or later)."
        ])
    }
    
    @objc func retryDownload(_ call: CAPPluginCall) {
        guard canRetryDownload, let url = modelUrl else {
            call.resolve([
                "success": false,
                "error": "Cannot retry download. No download in progress or not a network error."
            ])
            return
        }
        
        guard let localURL = downloadDestinationURL else {
            call.resolve([
                "success": false,
                "error": "Download destination not set."
            ])
            return
        }
        
        // Reset download tracking
        downloadStartTime = nil
        downloadSpeedMbps = 0
        canRetryDownload = false
        lastDownloadError = nil
        
        // Retry with resume data if available
        if let resumeData = downloadResumeData {
            resumeDownload(with: resumeData, call: call)
        } else {
            // Start fresh download if no resume data
            guard let remoteURL = URL(string: url) else {
                call.resolve([
                    "success": false,
                    "error": "Invalid model URL"
                ])
                return
            }
            downloadModel(from: remoteURL, to: localURL, call: call)
        }
    }
    
    private func resumeDownload(with resumeData: Data, call: CAPPluginCall) {
        print("⚡️ [MAGI NATIVE] Resuming download with resume data")
        logTrace("DOWNLOAD_RESUME", "using_resume_data")
        
        setStatus(stage: "DOWNLOADING", progress: 0.1)
        pendingInitializeCall = call
        downloadSession?.invalidateAndCancel()
        
        let config = URLSessionConfiguration.default
        config.httpAdditionalHeaders = [
            "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1"
        ]
        
        let session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
        downloadSession = session
        
        // Create download task with resume data
        let downloadTask = session.downloadTask(withResumeData: resumeData)
        downloadTask.resume()
        
        print("⚡️ [MAGI NATIVE] Download resumed")
    }
}
