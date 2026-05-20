import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export type NativeLLMStatus = {
  stage: string;
  isReady: boolean;
  progress?: number;
  modelPath?: string;
  lastError?: string;
  downloadSpeedMbps?: number;
  canRetryDownload?: boolean;
  modelUrl?: string;
  backend?: string;
  hardwareModel?: string;
};

export type NativeLLMInitializeOptions = {
  modelFileName?: string;
  modelFileExtension?: string;
  modelUrl?: string;
  llamaModelFileName?: string;
  llamaModelFileExtension?: string;
  llamaModelUrl?: string;
  forceRedownload?: boolean;
  maxTokens?: number;
  topK?: number;
  temperature?: number;
  topP?: number;
};

export type NativeLLMGenerateOptions = {
  prompt: string;
};

export type NativeLLMGenerateResult = {
  text: string;
};

export interface NativeLLMPlugin {
  initialize(options?: NativeLLMInitializeOptions): Promise<NativeLLMStatus>;
  generate(options: NativeLLMGenerateOptions): Promise<NativeLLMGenerateResult>;
  getStatus(): Promise<NativeLLMStatus>;
  checkModelExists(options?: { modelFileName?: string; modelFileExtension?: string }): Promise<{ exists: boolean; path: string; fileSize: number }>;
  getFreeDiskSpace(): Promise<{ freeGB: number; freeBytes: number }>;
  checkDeviceCompatibility(): Promise<{ isSupported: boolean; deviceModel: string; reason?: string }>;
  retryDownload(): Promise<{ success: boolean; error?: string }>;

  /**
   * Listen for real-time token generation (streaming)
   */
  addListener(
    eventName: 'onTokenGenerated',
    listenerFunc: (data: { text: string }) => void
  ): Promise<PluginListenerHandle>;
}

export const NativeLLM = registerPlugin<NativeLLMPlugin>('MagiNativeLLM');

let cachedInitializeKey: string | null = null;
let cachedInitializePromise: Promise<NativeLLMStatus> | null = null;
let cachedReadyStatus: NativeLLMStatus | null = null;

const buildInitializeKey = (options?: NativeLLMInitializeOptions) =>
  JSON.stringify({
    modelFileName: options?.modelFileName ?? '',
    modelFileExtension: options?.modelFileExtension ?? '',
    modelUrl: options?.modelUrl ?? '',
    llamaModelFileName: options?.llamaModelFileName ?? '',
    llamaModelFileExtension: options?.llamaModelFileExtension ?? '',
    llamaModelUrl: options?.llamaModelUrl ?? '',
    forceRedownload: options?.forceRedownload ?? false,
    maxTokens: options?.maxTokens ?? 0,
    temperature: options?.temperature ?? 0,
    topP: options?.topP ?? 0,
    topK: options?.topK ?? 0,
  });

export const ensureNativeLLMInitialized = async (options?: NativeLLMInitializeOptions): Promise<NativeLLMStatus> => {
  const key = buildInitializeKey(options);

  console.log('🧪 [DEBUG] NativeLLM Initialization Params:', JSON.stringify(options, null, 2));

  if (cachedReadyStatus?.isReady && cachedInitializeKey === key) {
    console.log('🧪 [DEBUG] Using cached LLM status');
    return cachedReadyStatus;
  }

  if (cachedInitializePromise && cachedInitializeKey === key) {
    return cachedInitializePromise;
  }

  cachedInitializeKey = key;
  cachedInitializePromise = NativeLLM.initialize(options)
    .then((status) => {
      if (status.isReady) {
        cachedReadyStatus = status;
      } else {
        cachedReadyStatus = null;
        cachedInitializePromise = null;
      }
      return status;
    })
    .catch((error) => {
      cachedReadyStatus = null;
      cachedInitializePromise = null;
      throw error;
    });

  return cachedInitializePromise;
};

export const resetNativeLLMInitializationCache = () => {
  cachedInitializeKey = null;
  cachedInitializePromise = null;
  cachedReadyStatus = null;
};
