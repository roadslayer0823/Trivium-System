/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI, Type } from "@google/genai";
import { 
  ShieldAlert, 
  Cpu, 
  User, 
  FileText, 
  Send, 
  RefreshCcw, 
  CheckCircle2, 
  XCircle,
  AlertTriangle,
  Upload,
  Terminal
} from 'lucide-react';

// Initialize Gemini
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

type TriviumIdentity = {
  name: string;
  perspective: string;
  description: string;
};

type TriviumResponse = {
  vote: 'YES' | 'NO';
  reasoning: string;
  confidence: number;
};

type TriviumState = 'IDLE' | 'THINKING' | 'DECIDED';
type AppStep = 'LANDING' | 'CONFIG' | 'RESULTS' | 'REASONING';

interface SessionParams {
  code: string;
  file: string;
  extension: string;
  exMode: string;
  priority: string;
}

type Message = {
  role: 'user' | 'model';
  parts: { text: string }[];
};

const DEFAULT_IDENTITIES: TriviumIdentity[] = [
  { name: 'CLOTHO-1', perspective: 'Scientist', description: 'Logical, objective, data-driven analysis.' },
  { name: 'LACHESIS-2', perspective: 'Mother', description: 'Empathetic, nurturing, long-term well-being.' },
  { name: 'ATROPOS-3', perspective: 'Woman', description: 'Intuitive, emotional, personal values and desires.' },
];

export default function App() {
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
  const [logs, setLogs] = useState<string[]>(["SYSTEM READY", "WAITING FOR INPUT..."]);
  const [theme, setTheme] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const addLog = (msg: string) => {
    setLogs(prev => [...prev.slice(-10), `> ${new Date().toLocaleTimeString()}: ${msg}`]);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFiles = e.target.files;
    if (!uploadedFiles) return;

    Array.from(uploadedFiles).forEach((file: File) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const base64 = event.target?.result?.toString().split(',')[1] || "";
        setFiles(prev => [...prev, { name: file.name, data: base64, type: file.type }]);
        addLog(`FILE ATTACHED: ${file.name}`);
      };
      reader.readAsDataURL(file);
    });
  };

  const runAnalysis = async (isFollowUp = false) => {
    const input = isFollowUp ? followUp : problem;
    if (!input.trim()) {
      addLog("ERROR: NO INPUT PROVIDED");
      return;
    }

    setState('THINKING');
    setStep('RESULTS'); // Shift to visualization immediately
    setResults({}); // Clear results to show nodes in "thinking" state
    
    if (!isFollowUp) {
      setHistory({});
      // Generate new session params for a fresh analysis
      const fileName = files.length > 0 ? files[0].name.substring(0, 5).toUpperCase() : "NONE";
      const randomPriority = ["+", "++", "+++"][Math.floor(Math.random() * 3)];
      setSessionParams({
        code: Math.floor(100 + Math.random() * 900).toString(),
        file: fileName,
        extension: Math.floor(1000 + Math.random() * 9000).toString(),
        exMode: "LOCAL",
        priority: randomPriority
      });
    }
    addLog(isFollowUp ? "INITIATING FOLLOW-UP ANALYSIS..." : "INITIATING TRIVIUM ANALYSIS...");
    addLog("DISTRIBUTING DATA TO NODES...");

    const analysisPromises = identities.map(async (identity) => {
      try {
        addLog(`${identity.name} STARTING ANALYSIS...`);
        
        const systemInstruction = `
          You are ${identity.name}, acting from the perspective of a ${identity.perspective}.
          Your core values are: ${identity.description}.
          
          Analyze the following problem and provide a decision (YES or NO) with a brief reasoning.
          
          Respond ONLY in JSON format:
          {
            "vote": "YES" or "NO",
            "reasoning": "Your brief explanation",
            "confidence": 0.0 to 1.0
          }
        `;

        const userMessage: Message = {
          role: 'user',
          parts: [{ text: isFollowUp ? input : `Problem: ${input}\n${files.length > 0 ? "Attached documents are provided as context." : ""}` }]
        };

        // Add files to the first message if it's the initial analysis
        if (!isFollowUp && files.length > 0) {
          files.forEach(f => {
            if (f.type.startsWith('image/')) {
              userMessage.parts.push({ inlineData: { data: f.data, mimeType: f.type } } as any);
            } else {
              userMessage.parts[0].text += `\n[Document attached: ${f.name}]`;
            }
          });
        }

        const currentHistory = history[identity.name] || [];
        const contents = [...currentHistory, userMessage];

        const response = await genAI.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: contents as any,
          config: {
            systemInstruction,
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                vote: { type: Type.STRING, enum: ["YES", "NO"] },
                reasoning: { type: Type.STRING },
                confidence: { type: Type.NUMBER }
              },
              required: ["vote", "reasoning", "confidence"]
            }
          }
        });

        const result = JSON.parse(response.text || "{}") as TriviumResponse;
        
        // Update history
        const modelMessage: Message = {
          role: 'model',
          parts: [{ text: response.text || "" }]
        };
        
        setHistory(prev => ({
          ...prev,
          [identity.name]: [...contents, modelMessage]
        }));

        addLog(`${identity.name} ANALYSIS COMPLETE: ${result.vote}`);
        return { name: identity.name, result };
      } catch (error) {
        console.error(error);
        addLog(`ERROR IN ${identity.name}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        return { name: identity.name, result: { vote: 'NO', reasoning: 'System failure during analysis.', confidence: 0 } as TriviumResponse };
      }
    });

    const allResults = await Promise.all(analysisPromises);
    const resultsMap: Record<string, TriviumResponse> = {};
    allResults.forEach(r => {
      resultsMap[r.name] = r.result;
    });

    setResults(resultsMap);
    setState('DECIDED');
    if (isFollowUp) {
      setFollowUp('');
    }
    setStep('RESULTS');
    addLog("ALL NODES REPORTED. FINAL DECISION REACHED.");
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
    addLog("SYSTEM RESET. STANDBY.");
  };

  const handleShowReasoning = () => {
    setIsAdLoading(true);
    addLog("INITIALIZING REWARD AD SEQUENCE...");
    // Simulate reward ad delay
    setTimeout(() => {
      setIsAdLoading(false);
      setStep('REASONING');
      addLog("AD SEQUENCE COMPLETE. ACCESS GRANTED.");
    }, 2000);
  };

  return (
    <div className="min-h-screen p-4 md:p-8 flex flex-col gap-6 max-w-2xl mx-auto bg-trivium-dark text-trivium-orange font-sans selection:bg-trivium-orange selection:text-trivium-dark transition-colors duration-500">
      {/* Header - Simplified for multi-step */}
      <header className="flex justify-between items-center border-b-2 border-trivium-orange pb-4">
        <div className="flex items-center gap-3">
          <ShieldAlert className="w-8 h-8 trivium-text-glow" />
          <div>
            <h1 className="text-2xl font-bold tracking-tighter leading-none trivium-text-glow">TRIVIUM SYSTEM</h1>
            <p className="text-[10px] opacity-50 uppercase tracking-widest mt-1">Strategic Decision v1.0</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex gap-1">
            {themes.map((t, i) => (
              <button
                key={t.name}
                onClick={() => setTheme(i)}
                className={`w-4 h-4 border transition-all ${theme === i ? 'border-trivium-orange scale-110' : 'border-trivium-orange/30 opacity-50 hover:opacity-100'}`}
                style={{ backgroundColor: t.primary }}
                title={t.name}
              />
            ))}
          </div>
          {step !== 'LANDING' && (
            <button 
              onClick={reset}
              className="p-2 border border-trivium-orange/30 hover:bg-trivium-orange/10 transition-colors"
              title="Reset System"
            >
              <RefreshCcw className="w-4 h-4" />
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 flex flex-col relative overflow-hidden">
        <AnimatePresence mode="wait">
          {/* STEP 1: LANDING */}
          {step === 'LANDING' && (
            <motion.div
              key="landing"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="flex-1 flex flex-col justify-center items-center text-center gap-8 py-12"
            >
              <div className="space-y-4">
                <h2 className="text-5xl font-black tracking-tighter trivium-text-glow">TRIVIUM SYSTEM</h2>
                <p className="text-xl opacity-80 font-mono">v1.0</p>
              </div>

              <div className="trivium-panel max-w-md text-sm leading-relaxed space-y-6 p-8">
                <div className="scanline" />
                <p className="font-black text-2xl border-b border-trivium-orange/30 pb-2">DISCLAIMER</p>
                <p className="font-mono">
                  STRATEGIC DECISION SYSTEM for the INDECISIVE.
                </p>
                <p className="opacity-80">
                  Trivium uses three digital personalities to play devil’s advocate. It’s basically a high-tech brainstorm in a box.
                </p>
                <p className="text-trivium-orange font-bold">
                  Please remember: AI provides the perspective, but humans provide the pulse. Use your own brain for best results.
                </p>
              </div>

              <button
                onClick={() => setStep('CONFIG')}
                className="w-full max-w-xs py-4 bg-trivium-orange text-trivium-dark font-black text-xl hover:opacity-90 transition-all transform hover:scale-105 active:scale-95"
              >
                I UNDERSTAND
              </button>
            </motion.div>
          )}

          {/* STEP 2: CONFIG & INPUT */}
          {step === 'CONFIG' && (
            <motion.div
              key="config"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="flex-1 flex flex-col gap-6"
            >
              {/* Node Config */}
              <section className="trivium-panel">
                <div className="scanline" />
                <h2 className="text-sm font-bold mb-4 flex items-center gap-2 border-b border-trivium-orange/30 pb-1">
                  <Cpu className="w-4 h-4" /> NODE CONFIGURATION
                </h2>
                <div className="grid grid-cols-1 gap-3">
                  {identities.map((id, idx) => (
                    <div key={idx} className="flex flex-col gap-1">
                      <div className="flex justify-between text-[10px] opacity-50">
                        <span>{id.name}</span>
                        <span>PERSPECTIVE</span>
                      </div>
                      <input
                        type="text"
                        value={id.perspective}
                        onChange={(e) => {
                          const newIds = [...identities];
                          newIds[idx].perspective = e.target.value;
                          setIdentities(newIds);
                        }}
                        className="w-full bg-trivium-dark/50 border border-trivium-orange/30 p-2 text-sm focus:outline-none focus:border-trivium-orange"
                      />
                    </div>
                  ))}
                </div>
              </section>

              {/* Problem Input */}
              <section className="trivium-panel flex-1 flex flex-col">
                <div className="scanline" />
                <h2 className="text-sm font-bold mb-4 flex items-center gap-2 border-b border-trivium-orange/30 pb-1">
                  <FileText className="w-4 h-4" /> PROBLEM DESCRIPTION
                </h2>
                <textarea
                  value={problem}
                  onChange={(e) => setProblem(e.target.value)}
                  placeholder="ENTER PROBLEM PARAMETERS..."
                  className="flex-1 min-h-[150px] bg-trivium-dark/50 border border-trivium-orange/30 p-3 text-sm focus:outline-none focus:border-trivium-orange resize-none font-mono"
                />
                
                <div className="mt-4 space-y-4">
                  <div className="flex gap-2">
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="flex-1 flex items-center justify-center gap-2 border border-trivium-orange/30 p-2 text-xs hover:bg-trivium-orange/10 transition-colors"
                    >
                      <Upload className="w-3 h-3" /> ATTACH DOCS
                    </button>
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleFileUpload}
                      className="hidden"
                      multiple
                    />
                  </div>
                  
                  {files.length > 0 && (
                    <div className="text-[10px] space-y-1 max-h-20 overflow-y-auto border border-trivium-orange/20 p-2">
                      {files.map((f, i) => (
                        <div key={i} className="flex justify-between">
                          <span className="truncate max-w-[150px]">{f.name}</span>
                          <span className="text-trivium-orange/50">READY</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <button
                    onClick={() => runAnalysis(false)}
                    disabled={!problem.trim()}
                    className="w-full py-4 bg-trivium-orange text-trivium-dark font-black text-xl hover:opacity-90 transition-all disabled:opacity-50"
                  >
                    EXECUTE ANALYSIS
                  </button>
                </div>
              </section>
            </motion.div>
          )}

          {/* STEP 3: RESULTS & ANIMATION */}
          {step === 'RESULTS' && (
            <motion.div
              key="results"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.05 }}
              className="flex-1 flex flex-col gap-8 items-center justify-center py-8"
            >
              {/* The Trivium Nodes Visualization */}
              <div className="w-full relative flex flex-col items-center justify-center min-h-[500px]">
                {sessionParams && (
                  <>
                    {/* Upper Left: Metadata */}
                    <motion.div 
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="absolute top-0 left-0 text-left font-mono text-[8px] leading-tight text-trivium-orange pointer-events-none z-30 p-4"
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <div className="w-2 h-2 bg-trivium-orange animate-pulse" />
                        <div className="font-bold text-[10px]">CODE : {sessionParams.code}</div>
                      </div>
                      <div className="pl-4 space-y-0.5 opacity-80">
                        <div>FILE : {sessionParams.file}</div>
                        <div>EXTENTION : {sessionParams.extension}</div>
                        <div>EX_MODE : {sessionParams.exMode}</div>
                        <div>PRIORITY : {sessionParams.priority}</div>
                      </div>
                    </motion.div>

                    {/* Upper Right: Status Labels */}
                    <motion.div 
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="absolute top-0 right-0 text-right font-mono text-[8px] leading-tight text-trivium-orange pointer-events-none z-30 p-4"
                    >
                      <div className="flex flex-col items-end gap-1">
                        <div className="border border-trivium-orange px-1 py-0.5 text-[7px] inline-block bg-trivium-orange/10">
                          防壁展開 [FIREWALL]
                        </div>
                        <div className="border border-trivium-orange px-1 py-0.5 text-[7px] inline-block bg-trivium-orange/10 animate-pulse">
                          修復作業中 [REPAIRING]
                        </div>
                      </div>
                    </motion.div>
                  </>
                )}

                {/* Background Grid/Lines */}
                <div className="absolute inset-0 flex items-center justify-center opacity-10 pointer-events-none">
                  <div className="w-full h-full border border-trivium-orange/30 rounded-full scale-110" />
                  <div className="absolute w-[1px] h-full bg-trivium-orange/30 rotate-0" />
                  <div className="absolute w-[1px] h-full bg-trivium-orange/30 rotate-120" />
                  <div className="absolute w-[1px] h-full bg-trivium-orange/30 rotate-240" />
                </div>

                <div className="flex flex-col items-center gap-20 relative z-10 w-full">
                  {/* Top Node: CLOTHO-1 */}
                  <div className="flex justify-center w-full relative">
                    <TriviumNode 
                      identity={identities[0]}
                      result={results[identities[0].name]}
                      isThinking={state === 'THINKING'}
                      hasResult={!!results[identities[0].name]}
                      hideLabels={true}
                    />
                  </div>
                  
                  {/* Bottom Row: LACHESIS-2 and ATROPOS-3 */}
                  <div className="flex justify-center gap-6 w-full">
                    <TriviumNode 
                      identity={identities[1]}
                      result={results[identities[1].name]}
                      isThinking={state === 'THINKING'}
                      hasResult={!!results[identities[1].name]}
                      hideLabels={true}
                    />
                    <TriviumNode 
                      identity={identities[2]}
                      result={results[identities[2].name]}
                      isThinking={state === 'THINKING'}
                      hasResult={!!results[identities[2].name]}
                      hideLabels={true}
                    />
                  </div>
                </div>

                {/* Central Status */}
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none z-20">
                  <AnimatePresence>
                    {state === 'THINKING' && (
                      <motion.div
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0, opacity: 0 }}
                        className="w-24 h-24 rounded-full border-2 border-trivium-orange border-t-transparent animate-spin flex items-center justify-center"
                      />
                    )}
                    {state === 'DECIDED' && (
                      <motion.div
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        className="text-center bg-trivium-dark/40 backdrop-blur-sm p-4 rounded-full border border-trivium-orange/20"
                      >
                        <div className="text-4xl font-black tracking-[0.2em] text-trivium-orange trivium-text-glow">
                          {Object.values(results).filter((r: TriviumResponse) => r.vote === 'YES').length >= 2 ? '通過' : '否決'}
                        </div>
                        <div className="text-[10px] font-mono mt-1 opacity-50">CONSENSUS REACHED</div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>

              {state === 'DECIDED' && !isAdLoading && (
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="w-full space-y-4"
                >
                  <button
                    onClick={handleShowReasoning}
                    className="w-full py-4 bg-trivium-orange text-trivium-dark font-black text-xl hover:opacity-90 transition-all"
                  >
                    VIEW REASONING
                  </button>
                  <button
                    onClick={reset}
                    className="w-full py-3 border border-trivium-orange/50 text-trivium-orange font-bold text-sm hover:bg-trivium-orange/10 transition-all"
                  >
                    RESET SYSTEM
                  </button>
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

          {/* STEP 4: REASONING & FOLLOW-UP */}
          {step === 'REASONING' && (
            <motion.div
              key="reasoning"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="flex-1 flex flex-col gap-6"
            >
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

              {/* Follow-up Input */}
              <section className="trivium-panel mt-4">
                <div className="scanline" />
                <h2 className="text-sm font-bold mb-4 flex items-center gap-2 border-b border-trivium-orange/30 pb-1">
                  <Terminal className="w-4 h-4" /> FOLLOW-UP QUERY
                </h2>
                <textarea
                  value={followUp}
                  onChange={(e) => setFollowUp(e.target.value)}
                  disabled={state === 'THINKING'}
                  placeholder="ENTER FOLLOW-UP QUESTION..."
                  className="w-full h-24 bg-trivium-dark/50 border border-trivium-orange/30 p-3 text-sm focus:outline-none focus:border-trivium-orange resize-none font-mono"
                />
                <div className="grid grid-cols-2 gap-3 mt-3">
                  <button
                    onClick={reset}
                    className="py-3 border border-trivium-orange/30 text-xs font-bold hover:bg-trivium-orange/10 transition-all"
                  >
                    NEW ANALYSIS
                  </button>
                  <button
                    onClick={() => runAnalysis(true)}
                    disabled={state === 'THINKING' || !followUp.trim()}
                    className="py-3 bg-trivium-orange text-trivium-dark font-black text-sm flex items-center justify-center gap-2 hover:opacity-90 transition-all disabled:opacity-50"
                  >
                    <Send className="w-4 h-4" /> SEND QUERY
                  </button>
                </div>
              </section>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* System Logs - Hidden on mobile landing, but useful elsewhere */}
      {step !== 'LANDING' && (
        <section className="trivium-panel h-24 overflow-hidden hidden sm:block">
          <div className="scanline" />
          <div className="text-[9px] font-mono space-y-1 opacity-60">
            {logs.slice(-5).map((log, i) => (
              <div key={i} className={log.includes('ERROR') ? 'text-red-500' : ''}>{log}</div>
            ))}
          </div>
        </section>
      )}

      {/* Footer Decoration */}
      <footer className="pt-4 border-t border-trivium-orange/30 flex flex-col sm:flex-row justify-between items-center gap-2 text-[9px] opacity-40">
        <div className="flex gap-3">
          <span>Inspired by MAGI</span>
          <span>HB TECH</span>
          <span>TRIVIUM_SYSTEM_V1</span>
        </div>
        <div>© 2026 TRIVIUM SYSTEM PROJECT</div>
      </footer>
    </div>
  );
}

interface TriviumNodeProps {
  key?: React.Key;
  identity: TriviumIdentity;
  result?: TriviumResponse;
  isThinking: boolean;
  hasResult: boolean;
  hideLabels?: boolean;
}

function TriviumNode({ identity, result, isThinking, hasResult, hideLabels }: TriviumNodeProps) {
  const isYes = result?.vote === 'YES';
  
  return (
    <motion.div 
      layout
      className="relative flex flex-col items-center"
    >
      {/* The Hexagon-ish Shape */}
      <div className="relative w-full aspect-square max-w-[140px] flex items-center justify-center">
        <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-[0_0_15px_rgba(255,107,0,0.2)]">
          <motion.path
            d="M 25 5 L 75 5 L 95 25 L 95 75 L 75 95 L 25 95 L 5 75 L 5 25 Z"
            fill={hasResult ? (isYes ? '#22c55e' : '#ef4444') : 'var(--theme-bg)'}
            stroke={isThinking ? 'var(--theme-primary)' : (hasResult ? (isYes ? '#166534' : '#991b1b') : 'var(--theme-primary)')}
            strokeWidth="2"
            animate={isThinking ? {
              fill: ['var(--theme-bg)', 'rgba(var(--theme-primary-rgb), 0.2)', 'var(--theme-bg)'],
              strokeOpacity: [0.5, 1, 0.5],
            } : {}}
            transition={{ repeat: Infinity, duration: 1.5 }}
          />
        </svg>
        
        {/* Content inside the shape */}
        <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center">
          <div className={`text-sm font-black mb-1 ${hasResult ? 'text-black' : 'text-trivium-orange'}`}>
            {identity.name}
          </div>
          <div className={`text-[10px] font-mono opacity-70 ${hasResult ? 'text-black/70' : 'text-trivium-orange/70'}`}>
            {identity.perspective.toUpperCase()}
          </div>
          
          <AnimatePresence mode="wait">
            {isThinking && (
              <motion.div
                key="thinking"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="mt-2"
              >
                <div className="flex gap-1">
                  {[0, 1, 2].map(i => (
                    <motion.div
                      key={i}
                      animate={{ opacity: [0.2, 1, 0.2] }}
                      transition={{ repeat: Infinity, duration: 0.6, delay: i * 0.2 }}
                      className="w-1 h-1 bg-trivium-orange"
                    />
                  ))}
                </div>
              </motion.div>
            )}
            
            {hasResult && (
              <motion.div
                key="result"
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="mt-2 flex flex-col items-center"
              >
                {isYes ? (
                  <CheckCircle2 className="w-8 h-8 text-black" />
                ) : (
                  <XCircle className="w-8 h-8 text-black" />
                )}
                <div className="text-xl font-black text-black mt-1 leading-none">{result.vote === 'YES' ? '贊成' : '否決'}</div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Decorative Labels */}
      {!hideLabels && (
        <div className="mt-4 text-center">
          <div className="text-[9px] opacity-40 tracking-widest mb-1">節點狀態</div>
          <div className={`text-[10px] font-bold px-2 py-0.5 border ${
            isThinking ? 'border-trivium-orange text-trivium-orange animate-pulse' : 
            hasResult ? (isYes ? 'border-green-500 text-green-500' : 'border-red-500 text-red-500') :
            'border-trivium-orange/30 text-trivium-orange/30'
          }`}>
            {isThinking ? '處理中' : hasResult ? '完成' : '待機'}
          </div>
        </div>
      )}
    </motion.div>
  );
}
