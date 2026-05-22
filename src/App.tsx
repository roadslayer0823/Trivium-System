/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import { Network } from '@capacitor/network';
import { AdMob, RewardAdPluginEvents } from '@capacitor-community/admob';
import { motion, AnimatePresence } from 'motion/react';
import {
  ShieldAlert,
  Cpu,
  FileText,
  Send,
  RefreshCcw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Upload,
  Terminal,
  Download,
  Wifi,
  Search,
} from 'lucide-react';
import { NativeLLM, ensureNativeLLMInitialized, resetNativeLLMInitializationCache } from './native-llm';
import { DownloadConfirmation } from './DownloadConfirmation';

const MODEL_LABEL = 'Gemma-4 E2B';
const DEFAULT_MODEL_RUNTIME = 'Native MediaPipe';
const MODEL_FILE_NAME = 'gemma-4-E2B-it';
const MODEL_FILE_EXTENSION = 'litertlm';
const MODEL_REMOTE_URL =
  'https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/08ca8d1009c97dd9a7d2be053860cb03c0d186a5/gemma-4-E2B-it.litertlm?download=true';
const LOCAL_MODEL_FILE = `${MODEL_FILE_NAME}.${MODEL_FILE_EXTENSION}`;
const LLAMA_MODEL_FILE_NAME = 'gemma-4-e2b-it-edited-q4_0';
const LLAMA_MODEL_FILE_EXTENSION = 'gguf';
const LLAMA_MODEL_REMOTE_URL =
  'https://huggingface.co/gguf-org/gemma-4-e2b-it-gguf/resolve/main/gemma-4-e2b-it-edited-q4_0.gguf?download=true';

type TriviumIdentity = {
  name: string;
  perspective: string;
  description: string;
};

type TriviumResponse = {
  vote: 'YES' | 'NO';
  reasoning: string;
  confidence: number;
  description?: string;
};

type Message = {
  role: 'user' | 'assistant';
  content: string;
};

type TriviumState = 'IDLE' | 'THINKING' | 'DECIDED';
type AppStep = 'LANDING' | 'CONFIG' | 'RESULTS' | 'REASONING';
type LoadPhase = 'loading' | 'ready' | 'error' | 'confirming';

interface SessionParams {
  code: string;
  file: string;
  extension: string;
  exMode: string;
  priority: string;
}

const DEFAULT_IDENTITIES: TriviumIdentity[] = [
  { name: 'CLOTHO-1', perspective: 'Scientist', description: 'Logical/Objective.' },
  { name: 'LACHESIS-2', perspective: 'Mother', description: 'Empathetic/Ethics.' },
  { name: 'ATROPOS-3', perspective: 'Woman', description: 'Intuitive/Emotional.' },
];

const getLimit = (text: string, baseLimit: number) => {
  return /[\u4e00-\u9fa5]/.test(text) ? baseLimit : baseLimit * 2;
};

const MAX_PROBLEM_CHARS = 100;
const MAX_FOLLOWUP_CHARS = 80;

const loadTextForStage = (stage: string) => {
  switch (stage) {
    case 'CHECKING_CACHE':
      return `CHECKING LOCAL ${LOCAL_MODEL_FILE.toUpperCase()} CACHE...`;
    case 'CACHE_HIT':
      return `FOUND CACHED ${MODEL_LABEL.toUpperCase()} MODEL...`;
    case 'DOWNLOADING':
      return `DOWNLOADING ${MODEL_LABEL.toUpperCase()}...`;
    case 'STORING':
      return 'STORING MODEL IN LOCAL CACHE...';
    case 'INITIALIZING':
      return 'INITIALIZING MEDIAPIPE...';
    case 'READY':
      return `${MODEL_LABEL.toUpperCase()} READY FOR LOCAL INFERENCE`;
    case 'ERROR':
      return 'MODEL LOAD FAILED';
    default:
      return 'INITIALIZING MEDIAPIPE...';
  }
};

export default function App() {
  const [bootNonce, setBootNonce] = useState(0);
  const [loadPhase, setLoadPhase] = useState<LoadPhase>('loading');
  const [loadProgress, setLoadProgress] = useState(0);
  const [loadText, setLoadText] = useState(loadTextForStage('INITIALIZING'));
  const [loadError, setLoadError] = useState('');
  const [engineReady, setEngineReady] = useState(false);
  const [loadStage, setLoadStage] = useState('INITIALIZING');
  const [downloadSpeedMbps, setDownloadSpeedMbps] = useState(0);
  const [canRetryDownload, setCanRetryDownload] = useState(false);
  const [showNetworkReconnect, setShowNetworkReconnect] = useState(false);

  const [identities, setIdentities] = useState<TriviumIdentity[]>(DEFAULT_IDENTITIES);
  const [step, setStep] = useState<AppStep>('LANDING');
  const [problem, setProblem] = useState('');
  const [files, setFiles] = useState<{ name: string; data: string; type: string }[]>([]);
  const [state, setState] = useState<TriviumState>('IDLE');
  const [results, setResults] = useState<Record<string, TriviumResponse>>({});
  const [history, setHistory] = useState<Record<string, Message[]>>({});
  const [followUp, setFollowUp] = useState('');
  const [isAdLoading, setIsAdLoading] = useState(false);
  const [sessionParams, setSessionParams] = useState<SessionParams | null>(null);

  const [logs, setLogs] = useState<string[]>(['SYSTEM INITIALIZED']);
  const [fullLogs, setFullLogs] = useState<string[]>([
    `=== MAGI TRIVIUM SYSTEM DEBUG LOG ===`,
    `Timestamp: ${new Date().toISOString()}`,
    `Platform: ${Capacitor.getPlatform()}`,
    `Model: ${MODEL_LABEL}`,
    `========================================`,
  ]);

  // AdMob Initialization
  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      AdMob.initialize({
        initializeForTesting: false,
      }).then(() => {
        addLog("ADMOB SUBSYSTEM ONLINE.");
      }).catch(e => console.error("AdMob Init Failed", e));
    }
  }, []);

  const logContainerRef = useRef<HTMLDivElement>(null);
  const [theme, setTheme] = useState(0);

  const themes = [
    { name: 'TRIVIUM', primary: '#ff6b00', bg: '#1a0a00', rgb: '255, 107, 0' },
    { name: 'NERV', primary: '#ef4444', bg: '#0a0a0a', rgb: '239, 68, 68' },
    { name: 'SEELE', primary: '#a855f7', bg: '#05000a', rgb: '168, 85, 247' },
    { name: 'GEHIRN', primary: '#06b6d4', bg: '#000a0a', rgb: '6, 182, 212' },
    { name: 'MARDUK', primary: '#f59e0b', bg: '#0a0800', rgb: '245, 158, 11' },
  ];

  useEffect(() => {
    const currentTheme = themes[theme];
    document.documentElement.style.setProperty('--theme-primary', currentTheme.primary);
    document.documentElement.style.setProperty('--theme-bg', currentTheme.bg);
    document.documentElement.style.setProperty('--theme-primary-rgb', currentTheme.rgb);
  }, [theme]);

  const addLog = useCallback((msg: string) => {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${msg}`;
    setLogs((prev) => [...prev.slice(-50), `> ${msg}`]);
    setFullLogs((prev) => [...prev, logEntry]);
  }, []);

  const addTraceLog = useCallback((msg: string) => {
    const timestamp = new Date().toISOString();
    const logEntry = `[TRACE][${timestamp}] ${msg}`;
    setFullLogs((prev) => [...prev, logEntry]);
  }, []);

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  useEffect(() => {
    addTraceLog(`DEVICE_INFO platform=${Capacitor.getPlatform()} isNative=${Capacitor.isNativePlatform()}`);
  }, []);

  useEffect(() => {
    setLoadPhase('loading');
    setLoadProgress(0);
    setLoadText(loadTextForStage('INITIALIZING'));
    setLoadError('');
    setEngineReady(false);

    let cancelled = false;
    let pollStatus: any;

    const bootNativeLLM = async () => {
      if (!Capacitor.isNativePlatform()) {
        const message = 'Native inference unavailable in browser.';
        setLoadPhase('error');
        setLoadError(message);
        return;
      }

      try {
        setLoadProgress(5);
        setLoadText(loadTextForStage('CHECKING_CACHE'));

        if ((window as any).skipModelCheck) {
          (window as any).skipModelCheck = false;
          await startInitialization();
          return;
        }

        // Check if model exists locally using native plugin
        const modelCheck = await NativeLLM.checkModelExists({
          modelFileName: MODEL_FILE_NAME,
          modelFileExtension: MODEL_FILE_EXTENSION
        });

        if (!modelCheck.exists) {
          setLoadPhase('confirming');
          return; // Stop here and wait for user confirmation
        }

        await startInitialization();
      } catch (error) {
        handleError(error);
      }
    };

    const startInitialization = async () => {
      try {
        setLoadPhase('loading');
        pollStatus = window.setInterval(() => {
          void NativeLLM.getStatus().then((status) => {
            if (cancelled) return;
            setLoadProgress(Math.max(0, Math.min(100, Math.round((status.progress ?? 0) * 100))));
            setLoadText(loadTextForStage(status.stage));
            setLoadStage(status.stage);
            if (status.downloadSpeedMbps !== undefined) {
              setDownloadSpeedMbps(status.downloadSpeedMbps);
            }
            if (status.canRetryDownload !== undefined) {
              setCanRetryDownload(status.canRetryDownload);
            }
            // Show reconnect popup if download failed with network error
            if (status.stage === 'ERROR' && status.canRetryDownload && !showNetworkReconnect) {
              setShowNetworkReconnect(true);
            }
          }).catch(() => { });
        }, 500);

        const status = await ensureNativeLLMInitialized({
          modelFileName: MODEL_FILE_NAME,
          modelFileExtension: MODEL_FILE_EXTENSION,
          modelUrl: MODEL_REMOTE_URL,
          llamaModelFileName: LLAMA_MODEL_FILE_NAME,
          llamaModelFileExtension: LLAMA_MODEL_FILE_EXTENSION,
          llamaModelUrl: LLAMA_MODEL_REMOTE_URL,
          forceRedownload: false,
          maxTokens: 2048,
          temperature: 0.7,
          topP: 0.9,
          topK: 20,
        });

        if (pollStatus !== undefined) window.clearInterval(pollStatus);
        if (cancelled) return;

        if (!status.isReady) throw new Error(status.lastError || 'Native model failed to initialize.');

        setLoadPhase('ready');
        setLoadProgress(100);
        setEngineReady(true);
        addLog(`${MODEL_LABEL.toUpperCase()} SYSTEM ONLINE`);
      } catch (error) {
        handleError(error);
      }
    };

    const handleError = (error: any) => {
      if (pollStatus !== undefined) window.clearInterval(pollStatus);
      if (cancelled) return;
      setLoadPhase('error');
      setLoadError(error instanceof Error ? error.message : String(error));
    };

    void bootNativeLLM();
    return () => {
      cancelled = true;
      if (pollStatus !== undefined) window.clearInterval(pollStatus);
    };
  }, [bootNonce, addLog, addTraceLog]);

  const buildInitialPrompt = (identities: TriviumIdentity[], input: string) => {
    const isChinese = /[\u4e00-\u9fa5]/.test(input);

    // A. 系統層級：優先級審查（不變）
    // System Content 減肥：移除具體罪名列舉，改用範疇定義
    const systemContent = isChinese
      ? '你是 Magi 決策模擬引擎。執行邏輯：\n1. 凡涉及非法技術、危險品、犯罪或純創作請求（故事/劇本），統一 VOTE: NO 並回覆 [REFUSE]。\n2. 僅分析真實決策。'
      : 'You are the Magi Decision Engine. Logic:\n1. If illegal, dangerous, criminal, or creative (story/script), MUST VOTE: NO and output [REFUSE].\n2. Analyze REAL decisions only.';

    // B. 角色定義
    const identityDetails = identities.map(id =>
      `${id.name}: [${id.perspective}]`
    ).join('\n');

    // C. 任務指令：重新加入「性格畫像」生成要求
    const missionLogic = isChinese
      ? '# 執行邏輯 (最優先)\n' +
      '1. **三行輸出**：必須依序輸出三行，分別對應三個視角。\n' +
      '2. **VOTE 規範**：你的 VOTE 必須【嚴格符合】你的 [perspective] 立場。\n' +
      '3. **分析理由**：嚴禁提及審查規則。REASONING 必須【嚴格支撐】VOTE 結果，並且 REASONING 必須從自身 [perspective] 出發。字數控制在 ~50 字。\n' +
      '4. **格式鎖定**：嚴格執行「NAME|VOTE|REASONING」。\n' +
      '5. **語言一致**：REASONING 必須使用與 <DATA> 相同的語言。'
      : '# MISSION LOGIC\n' +
      '1. **TRIAD OUTPUT**: You MUST output exactly three lines for the three perspectives.\n' +
      '2. **VOTE LOCK**: Your VOTE must [STRICTLY ALIGN] with your assigned [perspective].\n' +
      '3. **REASONING**: DO NOT mention safety rules. REASONING must [STRICTLY SUPPORT] your VOTE, around ~50 words.\n' +
      '4. **NO SELF-REFERENCE (CRITICAL)**: In "Your Reasoning", you must speak directly or analyze objectively. DO NOT mention your own code names (e.g., "Clotho-1", "Lachesis-2", "Atropos-3").\n' +
      '5. **STRICT FORMAT**: Each line must follow the exact syntax structure: "NAME|YES or NO|Your Reasoning".\n' +
      '6. **LANGUAGE**: REASONING must be in the same language as <DATA>.';

    // D. 拼接輸出
    return [
      `<|turn|>system\n${systemContent}<|turn|>`,
      `<|turn|>user\n# DATA\n<<<<<\n${input}\n>>>>>\n\n# PERSPECTIVES\n${identityDetails}\n\n${missionLogic}<|turn|>`,
      `<|turn|>model\n`
    ].join('\n');
  };

  // =================================================================
  // FOR DAVE: FOLLOW-UP ANALYSIS LOGIC (核心追問邏輯)
  // -----------------------------------------------------------------
  // 此函數負責構建「第二輪對話」的 Prompt。
  // 關鍵設計點：
  // 1. Context Slimming: 透過 .slice(-2) 只保留最近一輪對話，防止 Token 溢出。
  // 2. Data Sanitization: 使用 .substring(0, 200) 限制歷史長度，確保 SLM 運行穩定。
  // 3. Persona Lock: 強制要求模型沿用第一輪生成的 [ID_DESCRIPTION]，保證性格一致性。
  // 4. Token Economy: 將追問輸入限制在 80 字內，以獲得本地推理的最快響應速度。
  // =================================================================
  const buildFollowUpPrompt = (identities: TriviumIdentity[], input: string, conversationHistory: Message[]) => {
    const isChinese = /[\u4e00-\u9fa5]/.test(input);

    const systemContent = isChinese
      ? '你是 Magi 引擎。1. 非法/創作請求回覆 [REFUSE]。2. 參考歷史分析新問題。'
      : 'You are Magi. 1. Illegal/Creative -> [REFUSE]. 2. Analyze new input based on history.';

    // 簡化歷史：只取最近的一問一答，且只保留純文字
    const historyText = conversationHistory.slice(-2).map(msg => {
      const role = msg.role === 'user' ? 'User' : 'Magi';
      // 這裡可以考慮只存 reasoning 而非原始 response.text
      return `${role}: ${msg.content.substring(0, 200)}`;
    }).join('\n');

    const missionLogic = isChinese
      ? '三行輸出：NAME|VOTE|REASONING\n理由約~50字，禁提規則。'
      : 'Output 3 lines: Each line must follow the exact syntax structure: "NAME|YES or NO|Your Reasoning", around ～50 words. No rules talk.';

    return [
      `<|turn|>system\n${systemContent}<|turn|>`,
      `<|turn|>user\n# HISTORY\n${historyText}\n\n# PERSPECTIVES\n${identities.map(id => `${id.name}: [${id.perspective}] (${id.description})`).join('\n')}\n\n# NEW DATA\n${input}\n\n${missionLogic}<|turn|>`,
      `<|turn|>model\n`
    ].join('\n');
  };

  const parseBatchResponse = (rawText: string, identities: TriviumIdentity[], isChinese: boolean): Record<string, TriviumResponse> => {
    let cleanedText = rawText
      .replace(/<\/\|turn\|>/gi, '') // 過濾結尾的轉折標籤
      .replace(/<eos>/gi, '')        // 過濾 MediaPipe/Gemma 的結束符號
      .replace(/<\/?\|.*?>/gi, '')   // 移除任何殘留的特殊邊界符號
      .trim();
    const mappedResults: Record<string, TriviumResponse> = {};

    const isGlobalError = cleanedText.includes('SYSTEM ERROR');
    const isGlobalOutOfScope = cleanedText.includes('OUT_OF_SCOPE') || cleanedText.includes('REFUSE|');

    identities.forEach(identity => {
      if (isGlobalError || isGlobalOutOfScope) {
        mappedResults[identity.name] = {
          vote: 'NO',
          reasoning: isGlobalError
            ? (isChinese ? '該請求涉及非法或安全風險，已被系統攔截。' : 'Security Alert: Request intercepted due to safety risks.')
            : (isChinese ? 'Magi 僅處理決策分析，不提供創作或閒聊服務。' : 'Magi only processes decision analysis, not for storytelling or chat.'),
          confidence: 1.0, // 這裡設為 1.0，因為這是明確的攔截
          description: identity.description
        };
        return;
      }

      const escapedName = identity.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // 更加寬容的正則，確保即使 | 缺失也能抓到初步結果
      const pattern = new RegExp(
        `${escapedName}[\\|\\s\\.]+(?:VOTE:?\\s*)?(YES|NO|REJECT|REFUSE|APPROVE|OUT_OF_SCOPE|ERROR)\\s*[\\|\\:\\s]+(?:REASONING:?\\s*)?(.*)`,
        'i'
      );

      const lines = cleanedText.split('\n');
      let found = false;

      for (const line of lines) {
        const match = line.match(pattern);
        if (match) {
          const rawVote = match[1].toUpperCase();
          let reasoning = match[2].trim();

          // 1. 初始判定
          let finalVote: 'YES' | 'NO' = (rawVote.includes('YES') || rawVote.includes('APPROVE')) ? 'YES' : 'NO';

          // 2. 深度清洗理由
          reasoning = reasoning
            .replace(/^(Reasoning|Analysis|理由|說明|分析)[:：]\s*/i, '')
            .replace(/[\|\s]+$/, '')
            .replace(/(<\/\|turn|>|<eos>|---|\/\|turn\|)+$/gi, '')
            .replace(/[\|\s]+$/, '')
            .split(/[\n\r]+/)[0]
            .trim();

          // --- 核心改動：抓捕「落網之魚」 ---
          // 定義強烈的否定/危險訊號詞
          const safetySignals = ['HARMFUL', 'DANGEROUS', 'VIOLATE', 'ILLEGAL', 'OUT OF SCOPE', 'SAFETY', '危險', '有害', '違反', '非法', '不安全'];

          // 如果 VOTE 是 YES，但理由中出現了危險詞彙，強制翻轉為 NO
          if (finalVote === 'YES') {
            const hasDangerSignal = safetySignals.some(signal => reasoning.toUpperCase().includes(signal));
            if (hasDangerSignal) {
              finalVote = 'NO';
              // 修正理由，讓用戶知道這是一個安全判定
              if (reasoning.toUpperCase().includes('HARMFUL') || reasoning.includes('有害')) {
                reasoning = isChinese ? '內容包含有害資訊，已拒絕。' : 'Content contains harmful information, rejected.';
              }
            }
          }
          // --------------------------------
          // =================================================================
          // FOR DAVE: 
          // -----------------------------------------------------------------
          // 把 build intial prompt所生成的 description 存入在一個variable裡面，之後使用follow up prompt時把那個variable也傳進prompt裡面
          // =================================================================
          mappedResults[identity.name] = {
            vote: finalVote,
            reasoning: reasoning || (isChinese ? '拒絕回答。' : 'Refused to answer.'),
            confidence: 1.0
          };
          found = true;
          break;
        }
      }

      if (!found) {
        mappedResults[identity.name] = {
          vote: 'NO',
          reasoning: isChinese ? '分析失敗。' : 'Analysis failed.',
          confidence: 0
        };
      }
    });

    return mappedResults;
  };

  const runAnalysis = async (isFollowUp = false) => {
    if (!engineReady) {
      addLog('ERROR: ENGINE OFFLINE');
      return;
    }

    const currentText = isFollowUp ? followUp : problem;
    const baseLimit = isFollowUp ? MAX_FOLLOWUP_CHARS : MAX_PROBLEM_CHARS;
    const limit = getLimit(currentText, baseLimit);
    const input = currentText.trim().substring(0, limit);
    if (!input) {
      addLog('ERROR: NO INPUT');
      return;
    }

    setState('THINKING');
    setStep('RESULTS');

    if (!isFollowUp) {
      setResults({});
      setHistory({});
      setSessionParams({
        code: Math.floor(100 + Math.random() * 900).toString(),
        file: files.length > 0 ? files[0].name.substring(0, 5).toUpperCase() : 'NONE',
        extension: Math.floor(1000 + Math.random() * 9000).toString(),
        exMode: 'LOCAL',
        priority: ['+', '++', '+++'][Math.floor(Math.random() * 3)],
      });
    }

    addLog('INITIATING BATCH ANALYSIS...');

    try {
      // Use different prompt for initial vs follow-up queries
      const prompt = isFollowUp
        ? buildFollowUpPrompt(identities, input, history['shared'] || [])
        : buildInitialPrompt(identities, input);

      const response = await NativeLLM.generate({ prompt });
      const isChinese = /[\u4e00-\u9fa5]/.test(input);

      // DEBUG LOGS
      console.log("--- RAW MODEL OUTPUT ---");
      console.log(response.text);
      console.log("------------------------");
      addLog(`RAW LENGTH: ${response.text.length} chars`);
      if (response.text.length < 50) addLog(`PREVIEW: ${response.text}`);

      const mappedResults = parseBatchResponse(response.text, identities, isChinese);

      setIdentities(prev => prev.map(id => ({
        ...id,
        description: mappedResults[id.name]?.description || id.description
      })));

      setResults(mappedResults);
      setState('DECIDED');
      addLog('CONSENSUS REACHED.');

      // =================================================================
      // FOR DAVE: DATA PERSISTENCE & HISTORY SAVING (數據持久化邏輯)
      // -----------------------------------------------------------------
      // 此處負責將本輪的「分析結果」轉化為下一輪的「背景知識」。
      // 
      // 聯結點說明：
      // 1. 與 Initial Prompt 的關係：Initial Prompt 建立了輸出的「結構模板」。
      // 2. 存入內容：我們將 response.text (包含 NAME|VOTE|REASON) 原封不動存入。
      // 3. 目的：這是為了讓 Follow-up Prompt 讀取時，能透過 Few-shot 效應
      //    讓模型「記住」它應該保持的專業格式，避免在連續對話中脫軌。
      // =================================================================
      setHistory(prev => ({
        ...prev,
        shared: [
          { role: 'user' as const, content: input },
          { role: 'assistant' as const, content: response.text }
        ]
      }));
    } catch (error) {
      addLog(`FAILURE: ${error instanceof Error ? error.message : 'Unknown'}`);
      setState('IDLE');
    }

    if (isFollowUp) setFollowUp('');
  };

  const reset = () => {
    setState('IDLE');
    setResults({});
    setHistory({});
    setProblem('');
    setFollowUp('');
    setFiles([]);
    setSessionParams(null);
    setStep('CONFIG');
    addLog('SYSTEM RESET.');
  };

  const handleShowReasoning = async () => {
    addLog("ACCESSING REASONING DATA...");

    if (!Capacitor.isNativePlatform()) {
      setStep('REASONING');
      addLog("ACCESS GRANTED.");
      return;
    }

    try {
      setIsAdLoading(true);

      // Prepare Rewarded Ad with TEST ID (for development)
      await AdMob.prepareRewardVideoAd({
        adId: 'ca-app-pub-3940256099942544/5224354917',
      });

      const dismissalListener = await AdMob.addListener(RewardAdPluginEvents.Dismissed, () => {
        setIsAdLoading(false);
        setStep('REASONING');
        addLog("ACCESS GRANTED.");
        dismissalListener.remove();
      });

      const failedToShowListener = await AdMob.addListener(RewardAdPluginEvents.FailedToShow, (error) => {
        console.error("Ad Failed to Show:", error);
        setIsAdLoading(false);
        setStep('REASONING');
        addLog("AD SHOW FAILED - ACCESS GRANTED.");
        failedToShowListener.remove();
        dismissalListener.remove();
      });

      // Now show the rewarded ad
      await AdMob.showRewardVideoAd();

    } catch (error) {
      console.error("AdMob Error:", error);
      setIsAdLoading(false);
      setStep('REASONING');
      addLog("ACCESS GRANTED (ADS BYPASSED).");
    }
  };

  // Popups and Overlays
  const renderOverlays = () => (
    <AnimatePresence>
      {showNetworkReconnect && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/80 backdrop-blur-md"
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="trivium-panel max-w-sm w-full p-6 space-y-4 relative"
          >
            <div className="scanline" />
            <div className="flex items-center gap-3 text-orange-500">
              <Wifi className="w-8 h-8" />
              <h3 className="text-xl font-black uppercase">Network Lost</h3>
            </div>
            <p className="text-sm opacity-80 leading-relaxed">
              Network connection was lost during download. Please reconnect to WiFi or hotspot to continue downloading.
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={async () => {
                  if (loadPhase === 'confirming') {
                    setShowNetworkReconnect(false);
                    return;
                  }
                  const status = await Network.getStatus();
                  if (!status.connected) {
                    return;
                  }
                  setShowNetworkReconnect(false);
                  setBootNonce((n) => n + 1);
                }}
                className="w-full py-4 bg-orange-500 text-black font-black uppercase text-sm hover:opacity-90"
              >
                {loadPhase === 'confirming' ? 'Dismiss' : 'Retry Download'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}

      {loadPhase === 'error' && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[90] flex items-center justify-center p-6 bg-black/80 backdrop-blur-md"
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="trivium-panel max-w-sm w-full p-8 space-y-6 text-center relative"
          >
            <div className="scanline" />
            <AlertTriangle className="w-16 h-16 text-red-500 mx-auto" />
            <div className="space-y-2">
              <h2 className="text-2xl font-bold text-red-500 uppercase">Engine Failure</h2>
              <p className="text-xs opacity-60 font-mono uppercase break-words">{loadError}</p>
            </div>
            <button
              onClick={() => setBootNonce((n) => n + 1)}
              className="w-full flex items-center justify-center gap-2 border-2 border-red-500 px-6 py-3 text-red-500 font-bold hover:bg-red-500/10 uppercase"
            >
              <RefreshCcw className="w-4 h-4" /> Try Again
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  if (loadPhase === 'confirming') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-trivium-dark text-trivium-orange font-sans">
        <div className="w-full max-w-2xl px-4">
          <DownloadConfirmation
            modelName={MODEL_LABEL}
            requiredSpaceGB={2.58}
            onConfirm={async () => {
              const status = await Network.getStatus();
              if (!status.connected) {
                setShowNetworkReconnect(true);
                return;
              }
              setLoadPhase('loading');
              (window as any).skipModelCheck = true;
              setBootNonce((n) => n + 1);
            }}
          // onTestAd={handleTestAd}
          />
        </div>
        {renderOverlays()}
      </div>
    );
  }

  if (loadPhase === 'loading' || (loadPhase === 'error' && !engineReady)) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-8 p-8 bg-trivium-dark text-trivium-orange font-sans">
        <motion.div animate={{ opacity: [0.5, 1, 0.5] }} transition={{ repeat: Infinity, duration: 2 }} className="flex items-center gap-4">
          <ShieldAlert className="w-16 h-16 trivium-text-glow" />
          <h1 className="text-5xl font-black tracking-tighter trivium-text-glow uppercase">TRIVIUM</h1>
        </motion.div>
        <div className="w-full max-w-md space-y-4">
          <div className="w-full h-2 bg-trivium-orange/20 border border-trivium-orange/30 rounded-full overflow-hidden">
            <motion.div className="h-full bg-trivium-orange" animate={{ width: `${loadProgress}%` }} />
          </div>
          <div className="flex justify-between text-[10px] opacity-50 font-mono uppercase tracking-widest">
            <span>{loadText}</span>
            <span>{loadProgress}%</span>
          </div>
          {loadStage === 'DOWNLOADING' && (
            <div className="text-center text-[9px] opacity-40 font-mono uppercase tracking-widest">
              Est. Time: {downloadSpeedMbps > 0 ? `~${Math.ceil((2.58 * 1024) / downloadSpeedMbps / 60)} min` : 'Calculating...'}
            </div>
          )}
        </div>
        {renderOverlays()}
      </div>
    );
  }


  return (
    <div className="h-[100dvh] flex flex-col max-w-2xl mx-auto bg-trivium-dark text-trivium-orange font-sans selection:bg-trivium-orange selection:text-trivium-dark transition-colors duration-500 overflow-hidden">
      <header className="sticky top-0 z-50 bg-trivium-dark flex justify-between items-center border-b-2 border-trivium-orange p-4 pt-[calc(1rem+env(safe-area-inset-top))]">
        <div className="flex items-center gap-3">
          <ShieldAlert className="w-8 h-8 trivium-text-glow" />
          <div>
            <h1 className="text-2xl font-bold tracking-tighter leading-none trivium-text-glow uppercase">TRIVIUM SYSTEM</h1>
            <p className="text-[10px] opacity-50 uppercase tracking-widest mt-1">STRATEGIC DESICION v1.0</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex gap-1">
            {themes.map((t, i) => (
              <button key={t.name} onClick={() => setTheme(i)} className={`w-4 h-4 border transition-all ${theme === i ? 'border-trivium-orange scale-110' : 'border-trivium-orange/30 opacity-50 hover:opacity-100'}`} style={{ backgroundColor: t.primary }} />
            ))}
          </div>
          {step !== 'LANDING' && (
            <button onClick={reset} className="p-2 border border-trivium-orange/30 hover:bg-trivium-orange/10"><RefreshCcw className="w-4 h-4" /></button>
          )}
        </div>
      </header>

      <main className="flex-1 flex flex-col relative overflow-y-auto p-4 scroll-smooth">
        <AnimatePresence mode="wait">
          {step === 'LANDING' && (
            <motion.div key="landing" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="flex-1 flex flex-col justify-center items-center text-center gap-12 py-12">
              <div className="space-y-4">
                <h2 className="text-6xl font-black tracking-tighter trivium-text-glow uppercase">TRIVIUM SYSTEM</h2>
                <p className="text-xl opacity-60 font-mono tracking-widest uppercase">v1.0</p>
              </div>
              <div className="trivium-panel max-w-md text-sm leading-relaxed space-y-6 p-8">
                <div className="scanline" />
                <p className="font-black text-2xl border-b border-trivium-orange/30 pb-2 uppercase tracking-tighter">DISCLAIMER</p>
                <p className="font-mono">
                  STRATEGIC DECISION SYSTEM for the INDECISIVE.
                </p>
                <p className="opacity-80">
                  Trivium uses three digital personalities to play devil’s advocate. It’s basically a high-tech brainstorm in a box.
                </p>
                <p className="text-trivium-orange font-bold uppercase tracking-widest text-xs">
                  Please remember: AI provides the perspective, but humans provide the pulse. Use your own brain for best results.
                </p>
              </div>
              <button onClick={() => setStep('CONFIG')} className="w-full max-w-xs py-4 bg-trivium-orange text-trivium-dark font-black text-xl hover:opacity-90 transform hover:scale-105 active:scale-95 transition-all">
                I UNDERSTAND
              </button>
            </motion.div>
          )}

          {step === 'CONFIG' && (
            <motion.div key="config" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="flex-1 flex flex-col gap-6">
              <section className="trivium-panel">
                <div className="scanline" />
                <h2 className="text-[10px] font-bold mb-4 flex items-center gap-2 border-b border-trivium-orange/30 pb-1 uppercase tracking-widest">
                  <Cpu className="w-4 h-4" /> NODE CONFIGURATION
                </h2>
                <div className="grid grid-cols-1 gap-3">
                  {identities.map((id, idx) => (
                    <div key={idx} className="flex flex-col gap-1">
                      <div className="flex justify-between text-[10px] opacity-30 uppercase font-mono">
                        <span>{id.name}</span>
                        <span>PERSPECTIVE</span>
                      </div>
                      <input type="text" value={id.perspective} onChange={(e) => {
                        const newIds = [...identities];
                        newIds[idx].perspective = e.target.value;
                        setIdentities(newIds);
                      }} className="w-full bg-trivium-dark/50 border border-trivium-orange/30 p-2 text-sm focus:outline-none focus:border-trivium-orange font-mono" />
                    </div>
                  ))}
                </div>
              </section>

              <section className="trivium-panel flex-1 flex flex-col">
                <div className="scanline" />
                <h2 className="text-[10px] font-bold mb-4 flex items-center gap-2 border-b border-trivium-orange/30 pb-1 uppercase tracking-widest">
                  <FileText className="w-4 h-4" /> PROBLEM DESCRIPTION
                </h2>
                <textarea value={problem} onChange={(e) => setProblem(e.target.value)} maxLength={getLimit(problem, MAX_PROBLEM_CHARS)} placeholder="ENTER PROBLEM PARAMETERS..." className="flex-1 min-h-[150px] bg-trivium-dark/50 border border-trivium-orange/30 p-3 text-sm focus:outline-none focus:border-trivium-orange resize-none font-mono" />
                <div className={`text-[9px] text-right mt-1 font-mono ${problem.length >= getLimit(problem, MAX_PROBLEM_CHARS) ? 'text-red-500' : 'opacity-40'}`}> {problem.length} / {getLimit(problem, MAX_PROBLEM_CHARS)} CHARACTERS</div>
                <div className="mt-4 space-y-4">
                  <button onClick={() => runAnalysis(false)} disabled={!problem.trim()} className="w-full py-4 bg-trivium-orange text-trivium-dark font-black text-xl hover:opacity-90 disabled:opacity-50">
                    EXECUTE ANALYSIS
                  </button>
                </div>
              </section>
            </motion.div>
          )}

          {step === 'RESULTS' && (
            <motion.div key="results" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.05 }} className="flex-1 flex flex-col gap-8 items-center justify-center py-8">
              <div className="w-full relative flex flex-col items-center justify-center min-h-[500px]">
                {sessionParams && (
                  <>
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute top-0 left-0 text-left font-mono text-[8px] leading-tight text-trivium-orange pointer-events-none z-30 p-4">
                      <div className="font-bold text-[10px] mb-1">CODE : {sessionParams.code}</div>
                      <div className="pl-4 opacity-80">
                        <div>FILE : {sessionParams.file}</div>
                        <div>EXTENTION : {sessionParams.extension}</div>
                        <div>EX_MODE : {sessionParams.exMode}</div>
                        <div>PRIORITY : {sessionParams.priority}</div>
                      </div>
                    </motion.div>
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute top-0 right-0 text-right font-mono text-[8px] leading-tight text-trivium-orange pointer-events-none z-30 p-4">
                      <div className="border border-trivium-orange px-1 py-0.5 text-[7px] inline-block bg-trivium-orange/10 mb-1">防壁展開 [FIREWALL]</div>
                      <div className="border border-trivium-orange px-1 py-0.5 text-[7px] inline-block bg-trivium-orange/10 animate-pulse">修復作業中 [REPAIRING]</div>
                    </motion.div>
                  </>
                )}
                <div className="flex flex-col items-center gap-16 relative z-10 w-full">
                  <TriviumNode identity={identities[0]} result={results[identities[0].name]} isThinking={state === 'THINKING'} hasResult={!!results[identities[0].name]} hideLabels={true} />
                  <div className="flex justify-center gap-8 w-full">
                    <TriviumNode identity={identities[1]} result={results[identities[1].name]} isThinking={state === 'THINKING'} hasResult={!!results[identities[1].name]} hideLabels={true} />
                    <TriviumNode identity={identities[2]} result={results[identities[2].name]} isThinking={state === 'THINKING'} hasResult={!!results[identities[2].name]} hideLabels={true} />
                  </div>
                </div>
                {state === 'THINKING' && (
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30">
                    <RefreshCcw className="w-12 h-12 mx-auto animate-spin text-trivium-orange" />
                  </div>
                )}
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20 pointer-events-none">
                  {state === 'DECIDED' && (
                    <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="text-center bg-trivium-dark/60 backdrop-blur-md p-6 rounded-full border border-trivium-orange/30">
                      <div className="text-5xl font-black tracking-widest text-trivium-orange trivium-text-glow uppercase">
                        {Object.values(results).filter((r: TriviumResponse) => r.vote === 'YES').length >= 2 ? '通過' : '否決'}
                      </div>
                      <div className="text-[10px] font-mono mt-1 opacity-50">CONSENSUS REACHED</div>
                    </motion.div>
                  )}
                </div>
              </div>
              {state === 'DECIDED' && !isAdLoading && (
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full space-y-4">
                  <button onClick={handleShowReasoning} className="w-full py-4 bg-trivium-orange text-trivium-dark font-black text-xl hover:opacity-90 transition-all uppercase">VIEW REASONING</button>
                  <button onClick={reset} className="w-full py-3 border border-trivium-orange/50 text-trivium-orange font-bold text-sm hover:bg-trivium-orange/10 transition-all">RESET SYSTEM</button>
                </motion.div>
              )}
              {isAdLoading && (
                <div className="w-full trivium-panel p-8 text-center space-y-4">
                  <div className="scanline" />
                  <RefreshCcw className="w-8 h-8 mx-auto animate-spin" />
                  <p className="text-sm font-mono animate-pulse">LOADING REWARD SEQUENCE...</p>
                  <p className="text-[10px] opacity-50">Please wait while we process your access request.</p>
                </div>
              )}
            </motion.div>
          )}

          {step === 'REASONING' && (
            <motion.div key="reasoning" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="flex-1 flex flex-col gap-6">
              <div className="space-y-4">
                {identities.map((id, idx) => (
                  <div key={idx} className="trivium-panel text-xs leading-relaxed">
                    <div className="scanline" />
                    <div className="font-bold border-b border-trivium-orange/30 mb-2 pb-1 flex justify-between items-center">
                      <span className="flex items-center gap-2">
                        <Cpu className="w-3 h-3" /> {id.name}
                      </span>
                      <span className={`px-2 py-0.5 text-[10px] ${results[id.name]?.vote === 'YES' ? 'bg-green-900/30 text-green-500' : 'bg-red-900/30 text-red-500'}`}>
                        {results[id.name]?.vote === 'YES' ? '贊成' : '否決'}
                      </span>
                    </div>
                    <p className="opacity-90 italic">"{results[id.name]?.reasoning}"</p>
                    <div className="mt-3 flex items-center gap-3">
                      <div className="flex-1 h-1 bg-trivium-orange/10 rounded-full overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${(results[id.name]?.confidence || 0) * 100}%` }}
                          className="h-full bg-trivium-orange"
                        />
                      </div>
                      <span className="text-[9px] opacity-50">CONF: {Math.round((results[id.name]?.confidence || 0) * 100)}%</span>
                    </div>
                  </div>
                ))}
              </div>
              <section className="trivium-panel mt-4">
                <div className="scanline" />
                <h2 className="text-[10px] font-bold mb-4 flex items-center gap-2 border-b border-trivium-orange/30 pb-1 uppercase tracking-widest">
                  <Terminal className="w-4 h-4" /> FOLLOW-UP QUERY
                </h2>
                <textarea value={followUp} onChange={(e) => setFollowUp(e.target.value)} maxLength={getLimit(followUp, MAX_FOLLOWUP_CHARS)} placeholder="ENTER FOLLOW-UP QUESTION..." className="w-full h-24 bg-trivium-dark/50 border border-trivium-orange/30 p-3 text-sm focus:outline-none focus:border-trivium-orange resize-none font-mono" />
                <div className={`text-[9px] text-right mt-1 font-mono ${followUp.length >= getLimit(followUp, MAX_FOLLOWUP_CHARS) ? 'text-red-500' : 'opacity-40'}`}> {followUp.length} / {getLimit(followUp, MAX_FOLLOWUP_CHARS)} CHARACTERS </div>
                <div className="grid grid-cols-2 gap-3 mt-3">
                  <button onClick={reset} className="py-3 border border-trivium-orange/30 text-xs font-bold hover:bg-trivium-orange/10 transition-all uppercase">NEW ANALYSIS</button>
                  <button onClick={() => runAnalysis(true)} disabled={state === 'THINKING' || !followUp.trim()} className="py-3 bg-trivium-orange text-trivium-dark font-black text-sm flex items-center justify-center gap-2 uppercase transition-all hover:opacity-90 disabled:opacity-50"><Send className="w-4 h-4" /> SEND QUERY</button>
                </div>
              </section>
            </motion.div>
          )}
        </AnimatePresence>
        {step !== 'LANDING' && (
          <footer className="mt-8 border-t border-trivium-orange/20 pt-4">
            <div className="trivium-panel p-3 text-[10px] font-mono space-y-1">
              <div ref={logContainerRef} className="max-h-24 overflow-y-auto pr-2 scrollbar-none opacity-50">
                {logs.map((log, i) => (
                  <div key={i}>{log}</div>
                ))}
              </div>
            </div>
          </footer>
        )}

        <footer className="mt-8 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] border-t border-trivium-orange/30 text-[9px] opacity-40 uppercase tracking-widest font-mono text-center">
          <div className="flex flex-wrap gap-3 justify-center">
            <span>Inspired by MAGI | HB TECH | TRIVIUM SYSTEM V1 | <br />© 2026 TRIVIUM SYSTEM PROJECT</span>
          </div>
        </footer>
      </main>

      {renderOverlays()}
    </div>
  );
}

interface TriviumNodeProps {
  identity: TriviumIdentity;
  result?: TriviumResponse;
  isThinking: boolean;
  hasResult: boolean;
  hideLabels?: boolean;
}

function TriviumNode({ identity, result, isThinking, hasResult, hideLabels }: TriviumNodeProps) {
  const isYes = result?.vote === 'YES';
  return (
    <motion.div layout className="relative flex flex-col items-center">
      <div className="relative w-full aspect-square max-w-[140px] flex items-center justify-center">
        <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-[0_0_15px_rgba(var(--theme-primary-rgb),0.2)]">
          <motion.path
            d="M 25 5 L 75 5 L 95 25 L 95 75 L 75 95 L 25 95 L 5 75 L 5 25 Z"
            fill={hasResult ? (isYes ? '#22c55e' : '#ef4444') : 'var(--theme-bg)'}
            stroke="var(--theme-primary)"
            strokeWidth="2"
            animate={isThinking ? { fill: ['var(--theme-bg)', 'rgba(var(--theme-primary-rgb),0.2)', 'var(--theme-bg)'], strokeOpacity: [0.5, 1, 0.5] } : {}}
            transition={{ repeat: Infinity, duration: 1.5 }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center">
          <div className={`text-sm font-black mb-1 ${hasResult ? 'text-black' : 'text-trivium-orange'} uppercase tracking-tight`}>{identity.name}</div>
          <div className={`text-[9px] font-mono opacity-70 ${hasResult ? 'text-black/70' : 'text-trivium-orange/70'} uppercase`}>{identity.perspective}</div>
          <AnimatePresence>
            {isThinking && (
              <motion.div key="thinking" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-1 mt-2">
                {[0, 1, 2].map(i => <motion.div key={i} animate={{ opacity: [0.2, 1, 0.2] }} transition={{ repeat: Infinity, duration: 0.6, delay: i * 0.2 }} className="w-1 h-1 bg-trivium-orange" />)}
              </motion.div>
            )}
            {hasResult && (
              <motion.div key="result" initial={{ scale: 0 }} animate={{ scale: 1 }} className="mt-2 text-black flex flex-col items-center">
                {isYes ? <CheckCircle2 className="w-6 h-6" /> : <XCircle className="w-6 h-6" />}
                <div className="text-lg font-black mt-1 leading-none">{isYes ? '贊成' : '否決'}</div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}
