import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Download,
  Wifi,
  AlertTriangle,
  HardDrive,
  Info,
  Zap
} from 'lucide-react';
import { Network } from '@capacitor/network';
import { NativeLLM } from './native-llm';

interface DownloadConfirmationProps {
  modelName: string;
  requiredSpaceGB: number;
  onConfirm: () => void;
  onTestAd?: () => void;
}

export const DownloadConfirmation: React.FC<DownloadConfirmationProps> = ({
  modelName,
  requiredSpaceGB,
  onConfirm,
  onTestAd,
}) => {
  const [isChecking, setIsChecking] = useState(false);
  const [showStorageError, setShowStorageError] = useState(false);
  const [showCompatibilityError, setShowCompatibilityError] = useState(false);
  const [showNoConnectionError, setShowNoConnectionError] = useState(false);
  const [compReason, setCompReason] = useState('');

  const handleDownloadClick = async () => {
    setIsChecking(true);
    try {
      // Check network
      const network = await Network.getStatus().catch(() => ({ connectionType: 'wifi', connected: true }));
      if (!network.connected) {
        setShowNoConnectionError(true);
        return;
      }

      // Check device compatibility
      const compat = await NativeLLM.checkDeviceCompatibility().catch(() => ({ isSupported: false, deviceModel: 'unknown', reason: 'Unable to check device compatibility.' }));
      if (!compat.isSupported) {
        setCompReason('This device is not compatible with the required model.');
        setShowCompatibilityError(true);
        return;
      }

      // Check storage
      const diskSpace = await NativeLLM.getFreeDiskSpace().catch(() => ({ freeGB: 0, freeBytes: 0 }));
      const isEnough = diskSpace.freeGB >= requiredSpaceGB;
      if (!isEnough) {
        setShowStorageError(true);
        return;
      }

      onConfirm();
    } catch (error) {
      console.error("Check failed", error);
    } finally {
      setIsChecking(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col gap-6 p-4 md:p-0">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="trivium-panel space-y-6"
      >
        <div className="scanline" />

        {/* Header */}
        <div className="border-b border-trivium-orange/30 pb-4">
          <div className="flex items-center gap-3 mb-2">
            <Download className="w-6 h-6 text-trivium-orange" />
            <h2 className="text-xl font-black uppercase tracking-tighter italic">Download Confirmation</h2>
          </div>
          <p className="text-[10px] font-mono opacity-50 uppercase tracking-[0.2em]">Deployment Package: {modelName}</p>
        </div>

        {/* Model Stats */}
        <div className="bg-trivium-orange/5 border border-trivium-orange/20 p-3">
          <div className="text-[9px] font-mono opacity-50 uppercase mb-1">Package Size</div>
          <div className="text-2xl font-black text-trivium-orange">{requiredSpaceGB.toFixed(2)} GB</div>
        </div>

        {/* Footer info */}
        <div className="flex items-start gap-2 opacity-50">
          <Info className="w-3 h-3 mt-0.5" />
          <p className="text-[9px] font-mono uppercase leading-tight">
            This is a one-time download. The model will be stored locally for offline inference.
            Verification of package integrity will occur post-download.
          </p>
        </div>

        {/* Action Button */}
        <div className="mt-6 space-y-3">
          <button
            onClick={handleDownloadClick}
            disabled={isChecking}
            className="w-full py-3 bg-trivium-orange text-trivium-dark font-black text-sm flex items-center justify-center gap-2 uppercase transition-all hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed group"
          >
            <Zap className="w-4 h-4 group-hover:animate-pulse" />
            Start Download
          </button>

          {/* Temporary button for testing ads - commented out after verification */}
          {/* {onTestAd && (
            <button
              onClick={onTestAd}
              className="w-full py-2 border border-trivium-orange/30 text-trivium-orange font-mono text-[10px] flex items-center justify-center gap-2 uppercase transition-all hover:bg-trivium-orange/10"
            >
              [ DEBUG ] Test Ad System
            </button>
          )} */}
        </div>
      </motion.div>


      {/* Storage Error Popup */}
      <AnimatePresence>
        {showStorageError && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="trivium-panel max-w-sm w-full p-6 space-y-4"
            >
              <div className="flex items-center gap-3 text-orange-500">
                <HardDrive className="w-8 h-8" />
                <h3 className="text-xl font-black uppercase">Insufficient Space</h3>
              </div>
              <p className="text-sm opacity-80 leading-relaxed">
                Not enough space to download. Please clear extra space to continue.
              </p>
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => setShowStorageError(false)}
                  className="w-full py-4 bg-orange-500 text-black font-black uppercase text-sm hover:opacity-90"
                >
                  OK
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Compatibility Error Popup */}
      <AnimatePresence>
        {showCompatibilityError && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="trivium-panel max-w-sm w-full p-6 space-y-4"
            >
              <div className="flex items-center gap-3 text-orange-500">
                <AlertTriangle className="w-8 h-8" />
                <h3 className="text-xl font-black uppercase">Device Not Supported</h3>
              </div>
              <p className="text-sm opacity-80 leading-relaxed">
                {compReason || 'This device is not compatible with the required model.'}
              </p>
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => setShowCompatibilityError(false)}
                  className="w-full py-4 bg-orange-500 text-black font-black uppercase text-sm hover:opacity-90"
                >
                  OK
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* No Connection Error Popup */}
      <AnimatePresence>
        {showNoConnectionError && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="trivium-panel max-w-sm w-full p-6 space-y-4"
            >
              <div className="flex items-center gap-3 text-orange-500">
                <Wifi className="w-8 h-8" />
                <h3 className="text-xl font-black uppercase">No Connection</h3>
              </div>
              <p className="text-sm opacity-80 leading-relaxed">
                No internet connection detected. Please connect to WiFi or hotspot to download the model.
              </p>
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => setShowNoConnectionError(false)}
                  className="w-full py-4 bg-orange-500 text-black font-black uppercase text-sm hover:opacity-90"
                >
                  OK
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
