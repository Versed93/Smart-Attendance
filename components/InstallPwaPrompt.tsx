import React, { useState, useEffect } from 'react';
import { ArrowDownOnSquareIcon } from './icons/ArrowDownOnSquareIcon';
import { ShareIcon } from './icons/ShareIcon';
import { XCircleIcon } from './icons/XCircleIcon';

export const InstallPwaPrompt: React.FC = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [showIOSHelp, setShowIOSHelp] = useState(false);
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    // Check if already installed (Standalone mode)
    const isStandaloneMode = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone;
    setIsStandalone(isStandaloneMode);

    // Detect iOS
    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIosDevice = /iphone|ipad|ipod/.test(userAgent);
    setIsIOS(isIosDevice);

    // Capture the native install prompt for Android/Chrome
    const handleBeforeInstallPrompt = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  }, []);

  // Do not render if already installed or dismissed
  if (isStandalone || !isVisible) return null;

  // Do not render if not iOS and no prompt captured yet (e.g., Desktop Safari/Firefox)
  if (!isIOS && !deferredPrompt) return null;

  const handleInstallClick = () => {
    if (deferredPrompt) {
      // Trigger native Android/Chrome prompt
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then((choiceResult: any) => {
        if (choiceResult.outcome === 'accepted') {
          setDeferredPrompt(null);
        }
      });
    } else if (isIOS) {
      // Show instructions for iOS
      setShowIOSHelp(true);
    }
  };

  return (
    <>
        {/* Floating Install Button */}
        <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 z-[200] flex flex-col items-center gap-2 animate-in slide-in-from-bottom-4 duration-500 w-max">
            <button 
                onClick={handleInstallClick}
                className="flex items-center gap-3 bg-gray-900 text-white px-5 py-3 rounded-full shadow-2xl hover:bg-black transition-all active:scale-95 border border-gray-700 group"
            >
                <ArrowDownOnSquareIcon className="w-5 h-5 text-brand-primary group-hover:text-white transition-colors" />
                <span className="font-bold text-sm">Install App</span>
                
                {/* Dismiss Button */}
                <div 
                    onClick={(e) => { e.stopPropagation(); setIsVisible(false); }} 
                    className="ml-2 p-1 hover:bg-gray-700 rounded-full transition-colors"
                >
                    <XCircleIcon className="w-4 h-4 text-gray-500 group-hover:text-gray-400" />
                </div>
            </button>
        </div>

        {/* iOS Instructions Modal */}
        {showIOSHelp && (
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[250] flex items-end sm:items-center justify-center p-4 animate-in fade-in duration-200">
                <div className="bg-white w-full max-w-sm rounded-2xl p-6 shadow-2xl relative animate-in slide-in-from-bottom-10 sm:slide-in-from-bottom-0 sm:zoom-in-95 duration-300">
                    <button onClick={() => setShowIOSHelp(false)} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600">
                        <XCircleIcon className="w-6 h-6" />
                    </button>
                    <h3 className="text-lg font-black text-gray-900 mb-2">Install on iOS</h3>
                    <p className="text-sm text-gray-600 mb-4 leading-relaxed">iOS does not support one-click installation. Please follow these manual steps:</p>
                    <ol className="space-y-4 text-sm font-medium text-gray-800">
                        <li className="flex items-center gap-3">
                            <span className="flex items-center justify-center w-6 h-6 bg-gray-100 rounded-full text-xs font-bold shrink-0">1</span>
                            <span>Tap the <ShareIcon className="w-4 h-4 inline mx-1 text-blue-500" /> <span className="font-bold">Share</span> button in your browser's bottom bar.</span>
                        </li>
                        <li className="flex items-center gap-3">
                            <span className="flex items-center justify-center w-6 h-6 bg-gray-100 rounded-full text-xs font-bold shrink-0">2</span>
                            <span>Scroll down and select <span className="font-bold inline-flex items-center gap-1 mx-1 bg-gray-100 px-1 rounded"><ArrowDownOnSquareIcon className="w-3 h-3" /> Add to Home Screen</span>.</span>
                        </li>
                    </ol>
                </div>
            </div>
        )}
    </>
  );
};