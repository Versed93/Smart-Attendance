import React, { useState } from 'react';
import { usePWAInstall } from '../utils/usePWAInstall';
import { BrandLogoIcon } from './icons/BrandLogoIcon';

interface PWAInstallButtonProps {
  variant?: 'compact' | 'card';
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ variant = 'compact' }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className={
          variant === 'card'
            ? 'w-full flex items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50/70 px-4 py-2.5 text-xs font-bold text-indigo-700 hover:bg-indigo-100 transition-all active:scale-[0.98]'
            : 'flex items-center gap-1.5 rounded-xl border-2 border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-bold text-indigo-700 hover:bg-indigo-100 transition-all shrink-0 active:scale-95'
        }
        title="Add Smart Attendance to Home Screen or Desktop"
      >
        <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2.2}
            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
          />
        </svg>
        <span>Install App</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className={
            variant === 'card'
              ? 'w-full flex items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50/70 px-4 py-2.5 text-xs font-bold text-indigo-700 hover:bg-indigo-100 transition-all active:scale-[0.98]'
              : 'flex items-center gap-1.5 rounded-xl border-2 border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-bold text-indigo-700 hover:bg-indigo-100 transition-all shrink-0 active:scale-95'
          }
          title="Add Smart Attendance to iPhone/iPad Home Screen"
        >
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2.2}
              d="M12 4v12m0-12l-4 4m4-4l4 4M5 17v2a2 2 0 002 2h10a2 2 0 002-2v-2"
            />
          </svg>
          <span>Add to Home Screen</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
            <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl border border-gray-100 text-left">
              <div className="flex items-center gap-3 mb-4">
                <div className="flex items-center justify-center w-12 h-12 rounded-2xl bg-gradient-to-br from-brand-primary to-brand-secondary text-white shadow-md shrink-0">
                  <BrandLogoIcon className="w-7 h-7" />
                </div>
                <div>
                  <h3 className="text-base font-black text-gray-900 leading-tight">Add to Home Screen</h3>
                  <p className="text-xs font-semibold text-gray-500">Smart QR Attendance</p>
                </div>
              </div>
              <ol className="space-y-2.5 text-xs font-semibold text-gray-600 leading-relaxed">
                <li>
                  1. Tap the <strong className="text-gray-900">Share</strong> button in your browser toolbar.
                </li>
                <li>
                  2. Scroll down and select <strong className="text-gray-900">Add to Home Screen</strong>.
                </li>
                <li>
                  3. Confirm to place the <strong className="text-gray-900">Smart Attend</strong> badge on your Home Screen.
                </li>
              </ol>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-5 w-full rounded-xl bg-gray-900 py-2.5 text-xs font-bold uppercase tracking-wider text-white hover:bg-black transition-all"
              >
                Got It
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
