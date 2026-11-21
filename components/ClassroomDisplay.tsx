import React, { useEffect, useRef, useState, useCallback } from 'react';
import QRCode from 'qrcode';
import { BrandLogoIcon } from './icons/BrandLogoIcon';
import { XMarkIcon } from './icons/XMarkIcon';
import {
  buildAttendanceQrUrl,
  getClassroomChannelName,
  getClassroomStorageKey,
  isDemoClassroomMode,
  postClassroomWindowClosed,
  readClassroomSyncState,
  requestAdaptiveFullscreen,
  type ClassroomSyncPayload,
} from '../utils/classroomWindow';

export interface ClassroomDisplayProps {
  courseName: string;
  selectedWeek: string;
  qrData: string;
  currentTime: Date;
  qrErrorCorrection?: 'L' | 'M' | 'Q' | 'H';
  qrMargin?: number;
  geoPending?: boolean;
  pinRequired?: boolean;
  classroomPin?: string;
  pinDisplayMode?: 'hidden' | 'flash' | 'visible';
  pinVisibleUntil?: number;
  onClose: () => void;
  onToggleFullscreen?: () => void;
  isFullscreen?: boolean;
}

export const ClassroomDisplay: React.FC<ClassroomDisplayProps> = ({
  courseName,
  selectedWeek,
  qrData,
  currentTime,
  qrErrorCorrection = 'M',
  qrMargin = 2,
  geoPending = false,
  pinRequired = false,
  classroomPin = '',
  pinDisplayMode = 'hidden',
  pinVisibleUntil = 0,
  onClose,
  onToggleFullscreen,
  isFullscreen = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const qrSlotRef = useRef<HTMLDivElement | null>(null);

  const [viewportHeight, setViewportHeight] = useState<number>(() =>
    typeof window !== 'undefined' ? window.innerHeight : 800
  );
  const [slotDims, setSlotDims] = useState<{ width: number; height: number }>({
    width: 480,
    height: 480,
  });

  useEffect(() => {
    const updateContainer = () => {
      const el = containerRef.current;
      if (el) {
        setViewportHeight(el.clientHeight || window.innerHeight);
      } else {
        setViewportHeight(window.innerHeight);
      }
      const slot = qrSlotRef.current;
      if (slot) {
        setSlotDims({
          width: slot.clientWidth,
          height: slot.clientHeight,
        });
      }
    };

    updateContainer();

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => {
        updateContainer();
      });
      if (containerRef.current) observer.observe(containerRef.current);
      if (qrSlotRef.current) observer.observe(qrSlotRef.current);
    }

    window.addEventListener('resize', updateContainer);
    window.addEventListener('orientationchange', updateContainer);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateContainer);
      window.removeEventListener('orientationchange', updateContainer);
    };
  }, []);

  const isTinyHeight = viewportHeight > 0 && viewportHeight < 460;
  const isCompactHeight = viewportHeight > 0 && viewportHeight < 620;

  const availableSide = Math.floor(Math.min(slotDims.width, slotDims.height));
  const qrCardSize = availableSide > 0 ? Math.max(112, Math.min(availableSide, 840)) : 320;
  const qrPadding = Math.max(6, Math.round(qrCardSize * 0.045));
  const qrBorderRadius = Math.max(14, Math.round(qrCardSize * 0.075));
  const qrInnerRadius = Math.max(8, qrBorderRadius - qrPadding);
  const qrBorderWidth = qrCardSize < 220 ? 4 : 8;

  useEffect(() => {
    if (!canvasRef.current || !qrData || geoPending) return;
    const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
    const renderSize = Math.min(Math.max(Math.round(qrCardSize * dpr), 480), 1200);

    QRCode.toCanvas(
      canvasRef.current,
      qrData,
      {
        width: renderSize,
        margin: qrMargin,
        errorCorrectionLevel: qrErrorCorrection.toLowerCase() as 'low' | 'medium' | 'quartile' | 'high',
      },
      (err) => {
        if (err) console.error(err);
      }
    );
  }, [qrData, qrErrorCorrection, qrMargin, qrCardSize, geoPending]);

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 h-[100dvh] w-screen overflow-hidden bg-gray-900/95 backdrop-blur-lg z-[100] flex flex-col justify-between px-3 py-2.5 sm:px-6 sm:py-4 select-none animate-in fade-in duration-300"
    >
      <div className="fixed top-3 right-3 sm:top-5 sm:right-5 z-20 flex items-center gap-2">
        {onToggleFullscreen && typeof document !== 'undefined' && document.fullscreenEnabled && (
          <button
            type="button"
            onClick={onToggleFullscreen}
            title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
            aria-label={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
            className="flex items-center justify-center w-9 h-9 sm:w-11 sm:h-11 bg-white/10 hover:bg-white/20 border border-white/15 text-white rounded-xl sm:rounded-2xl active:scale-95 transition-all"
          >
            {isFullscreen ? (
              <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9 3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5 5.25 5.25" />
              </svg>
            ) : (
              <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
              </svg>
            )}
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          title="Close Classroom View"
          aria-label="Close Classroom View"
          className="flex items-center justify-center w-9 h-9 sm:w-11 sm:h-11 bg-white/10 hover:bg-white/20 border border-white/15 text-white rounded-xl sm:rounded-2xl active:scale-95 transition-all"
        >
          <XMarkIcon className="w-5 h-5 sm:w-6 sm:h-6" />
        </button>
      </div>

      <header className="w-full flex items-center justify-center px-20 sm:px-28 pt-0.5 shrink-0">
        <div className="flex items-center justify-center gap-2.5 sm:gap-4 min-w-0">
          <div
            className={`flex items-center justify-center bg-gradient-to-br from-brand-primary to-brand-secondary text-white rounded-2xl shadow-lg shrink-0 transition-all ${
              isTinyHeight ? 'w-9 h-9 rounded-xl' : 'w-12 h-12'
            }`}
          >
            <BrandLogoIcon className={isTinyHeight ? 'w-5 h-5' : 'w-7 h-7'} />
          </div>
          <div className="min-w-0 text-left">
            <span
              className={`block font-black text-white tracking-tight leading-none truncate ${
                isTinyHeight ? 'text-sm sm:text-lg' : 'text-lg sm:text-2xl'
              }`}
            >
              SMART ATTENDANCE
            </span>
            <span
              className={`block text-[10px] font-bold text-white/55 uppercase tracking-[0.2em] truncate ${
                isTinyHeight ? 'mt-0.5' : 'mt-1.5'
              }`}
            >
              Classroom View
            </span>
          </div>
        </div>
      </header>

      <main
        className="flex-1 min-h-0 w-full flex flex-col items-center justify-center overflow-hidden"
        style={{
          gap: isTinyHeight ? '8px' : isCompactHeight ? '12px' : '18px',
          paddingTop: isTinyHeight
            ? '12px'
            : isCompactHeight
              ? 'clamp(18px, 4dvh, 36px)'
              : 'clamp(28px, 5.5dvh, 64px)',
          paddingBottom: isTinyHeight ? '4px' : '8px',
        }}
      >
        <div className="w-full max-w-5xl text-center text-white shrink-0 px-2">
          <p
            className="font-bold text-brand-light uppercase tracking-[0.28em] opacity-75 leading-none"
            style={{
              fontSize: 'clamp(0.625rem, min(2vw, 1.5dvh), 0.875rem)',
              marginBottom: isTinyHeight ? '2px' : '6px',
            }}
          >
            Join Session
          </p>
          <h2
            className="font-bold px-2 sm:px-4 line-clamp-2 break-words whitespace-normal leading-[1.12] max-w-4xl mx-auto"
            style={{
              fontSize: 'clamp(1.05rem, min(4.8vw, 4.4dvh), 3rem)',
              marginBottom: isTinyHeight ? '4px' : isCompactHeight ? '8px' : '12px',
            }}
          >
            {courseName || 'General Session'}
          </h2>
          <div className="flex items-center justify-center gap-2 sm:gap-2.5 flex-wrap">
            <div
              className="flex items-center gap-2 sm:gap-3 bg-white/5 rounded-full border border-white/10"
              style={{
                padding: isTinyHeight ? '3px 12px' : '6px 18px',
              }}
            >
              <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse shrink-0"></span>
              <p
                className="font-mono font-bold tracking-tight tabular-nums leading-none"
                style={{ fontSize: 'clamp(0.875rem, min(3.4vw, 2.5dvh), 1.5rem)' }}
              >
                {currentTime.toLocaleTimeString([], { hour12: false })}
              </p>
            </div>
            <span
              className="font-bold uppercase tracking-widest rounded-full bg-white/10 border border-white/15 text-amber-300 leading-none"
              style={{
                fontSize: 'clamp(0.625rem, min(2vw, 1.4dvh), 0.75rem)',
                padding: isTinyHeight ? '5px 12px' : '8px 16px',
              }}
            >
              {selectedWeek.replace(/^W(\d+)$/i, 'WEEK $1')}
            </span>
            {pinRequired && (() => {
              const nowMs = currentTime.getTime();
              const flashRemaining = pinDisplayMode === 'flash' ? Math.ceil((pinVisibleUntil - nowMs) / 1000) : 0;
              const isPinShown =
                Boolean(classroomPin) &&
                (pinDisplayMode === 'visible' || (pinDisplayMode === 'flash' && flashRemaining > 0));
              if (isPinShown) {
                return (
                  <span
                    className="font-mono font-black uppercase tracking-widest rounded-full bg-emerald-500/20 border border-emerald-400/50 text-emerald-200 leading-none tabular-nums"
                    style={{
                      fontSize: 'clamp(0.7rem, min(2.4vw, 1.7dvh), 1rem)',
                      padding: isTinyHeight ? '4px 12px' : '7px 16px',
                    }}
                  >
                    PIN: {classroomPin}{pinDisplayMode === 'flash' ? ` (${flashRemaining}s)` : ''}
                  </span>
                );
              }
              return (
                <span
                  className="font-bold uppercase tracking-widest rounded-full bg-amber-500/15 border border-amber-400/35 text-amber-200 leading-none"
                  style={{
                    fontSize: 'clamp(0.625rem, min(2vw, 1.4dvh), 0.75rem)',
                    padding: isTinyHeight ? '5px 12px' : '8px 16px',
                  }}
                >
                  PIN Required · Ask Lecturer
                </span>
              );
            })()}
          </div>
        </div>

        <div
          ref={qrSlotRef}
          className="flex-1 min-h-0 w-full flex items-center justify-center overflow-hidden px-2"
        >
          <div
            className="bg-white shadow-2xl aspect-square flex items-center justify-center relative border-brand-primary/10 shrink-0 transition-[width,height] duration-150"
            style={{
              width: `${qrCardSize}px`,
              height: `${qrCardSize}px`,
              padding: `${qrPadding}px`,
              borderRadius: `${qrBorderRadius}px`,
              borderWidth: `${qrBorderWidth}px`,
            }}
          >
            {geoPending ? (
              <div className="flex flex-col items-center justify-center text-center p-4 gap-3">
                <div className="animate-spin h-9 w-9 border-4 border-indigo-600 border-t-transparent rounded-full"></div>
                <p className="text-xs sm:text-sm font-bold text-gray-700">Locking classroom geolocation...</p>
              </div>
            ) : (
              <canvas
                ref={canvasRef}
                className="!w-full !h-full"
                style={{ borderRadius: `${qrInnerRadius}px` }}
              />
            )}
          </div>
        </div>
      </main>

      <footer className="w-full max-w-6xl mx-auto text-center pt-1 sm:pt-2 shrink-0">
        <p className="text-[10px] sm:text-xs font-semibold text-white/60 tracking-wide">
          Developed with <span className="text-rose-400" aria-label="love">♥</span> by{' '}
          <span className="font-bold text-white/85">VERSED PLT</span> · Copyright © {new Date().getFullYear()}
        </p>
      </footer>
    </div>
  );
};

export const StandaloneClassroomView: React.FC = () => {
  const [urlParams] = useState(() => new URLSearchParams(window.location.search));
  const [syncState, setSyncState] = useState<ClassroomSyncPayload>(() => {
    const stored = readClassroomSyncState();
    const urlCourse = urlParams.get('c') || '';
    const urlCid = urlParams.get('cid') || '';
    const urlWeek = urlParams.get('w') || 'W1';
    const urlOffline = urlParams.get('offline') === 'true';
    const latStr = urlParams.get('lat');
    const lngStr = urlParams.get('lng');
    const hasUrlGeo = Boolean(latStr && lngStr && !Number.isNaN(Number(latStr)) && !Number.isNaN(Number(lngStr)));

    if (stored && stored.active) {
      return stored;
    }

    return {
      active: true,
      geoPending: false,
      baseUrl: window.location.origin + window.location.pathname,
      courseName: urlCourse,
      courseId: urlCid || undefined,
      selectedWeek: urlWeek,
      isOfflineMode: urlOffline,
      isGeoEnabled: hasUrlGeo,
      teacherLocation: hasUrlGeo ? { lat: Number(latStr), lng: Number(lngStr) } : null,
      qrErrorCorrection: isDemoClassroomMode()
        ? 'M'
        : (localStorage.getItem('qr-error-correction') as 'L' | 'M' | 'Q' | 'H') || 'M',
      qrMargin: isDemoClassroomMode() ? 2 : parseInt(localStorage.getItem('qr-margin') || '2', 10),
      updatedAt: Date.now(),
    };
  });

  const [currentTime, setCurrentTime] = useState(() => new Date());
  const [fallbackToken, setFallbackToken] = useState<{
    qrToken?: string;
    qrTokenIat?: number;
    qrTokenExpiresAt?: number;
    pinRequired?: boolean;
    classroomPin?: string;
  }>({});
  const effectiveToken = syncState.qrToken || fallbackToken.qrToken;
  const effectiveIat = syncState.qrTokenIat || fallbackToken.qrTokenIat;
  const effectivePinRequired =
    syncState.pinRequired !== undefined ? syncState.pinRequired : fallbackToken.pinRequired;
  const effectivePin = syncState.classroomPin || fallbackToken.classroomPin;

  const [qrData, setQrData] = useState<string>(() =>
    buildAttendanceQrUrl({
      baseUrl: syncState.baseUrl,
      selectedWeek: syncState.selectedWeek,
      courseName: syncState.courseName,
      courseId: syncState.courseId,
      isOfflineMode: syncState.isOfflineMode,
      isGeoEnabled: syncState.isGeoEnabled,
      teacherLocation: syncState.teacherLocation,
      qrToken: effectiveToken,
      qrTokenIat: effectiveIat,
      pinRequired: effectivePinRequired,
    })
  );
  const [isFullscreen, setIsFullscreen] = useState<boolean>(() => Boolean(document.fullscreenElement));

  const handleCloseWindow = useCallback(() => {
    postClassroomWindowClosed();
    try {
      if (document.fullscreenElement && document.exitFullscreen) {
        void document.exitFullscreen().catch(() => { /* ignore */ });
      }
    } catch { /* ignore */ }
    window.close();
    // If browser prevented window.close() because tab wasn't opened by script, return to main route
    setTimeout(() => {
      if (!window.closed) {
        window.location.href = isDemoClassroomMode()
          ? `${window.location.pathname}?demo=1`
          : window.location.pathname;
      }
    }, 150);
  }, []);

  const handleToggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen?.().catch(() => { /* ignore */ });
    } else {
      void requestAdaptiveFullscreen();
    }
  }, []);

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFsChange);
    // Attempt automatic fullscreen when browser permissions/kiosk mode allow it on extended display open
    if (!document.fullscreenElement) {
      void requestAdaptiveFullscreen().catch(() => { /* ignore */ });
    }
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  useEffect(() => {
    const refreshFallbackTokenIfNeeded = async () => {
      const tokenAge = Date.now() - (syncState.qrTokenIat || 0);
      const fallbackAge = Date.now() - (fallbackToken.qrTokenIat || 0);
      if (syncState.qrToken && tokenAge < 7000) return;
      if (fallbackToken.qrToken && fallbackAge < 5000) return;
      if (new URLSearchParams(window.location.search).get('demo') === '1') {
        const now = Date.now();
        setFallbackToken({
          qrToken: `demo_qr_${now}`,
          qrTokenIat: now,
          qrTokenExpiresAt: now + 15000,
          pinRequired: Boolean(syncState.pinRequired),
          classroomPin: syncState.classroomPin || '4829',
        });
        return;
      }
      const authToken = localStorage.getItem('attendance-auth-token-v1') || '';
      if (!authToken) return;
      try {
        const res = await fetch('/api/qr/token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({
            courseName: syncState.courseName || 'General Session',
            courseId: syncState.courseId || '',
            week: syncState.selectedWeek || 'W1',
            requirePin: syncState.pinRequired,
          }),
        });
        const data = await res.json();
        if (res.ok && data?.success && data.qrToken) {
          setFallbackToken({
            qrToken: data.qrToken,
            qrTokenIat: data.iat,
            qrTokenExpiresAt: data.exp,
            pinRequired: Boolean(data.pinRequired),
            classroomPin: data.pin || '',
          });
        }
      } catch {
        // Ignore transient network errors
      }
    };

    const updateTick = () => {
      setCurrentTime(new Date());
      void refreshFallbackTokenIfNeeded();
      const activeTok =
        syncState.qrToken && (!fallbackToken.qrTokenIat || (syncState.qrTokenIat || 0) >= fallbackToken.qrTokenIat)
          ? syncState.qrToken
          : fallbackToken.qrToken;
      const activeIat =
        syncState.qrToken && (!fallbackToken.qrTokenIat || (syncState.qrTokenIat || 0) >= fallbackToken.qrTokenIat)
          ? syncState.qrTokenIat
          : fallbackToken.qrTokenIat;

      setQrData(
        buildAttendanceQrUrl({
          baseUrl: syncState.baseUrl,
          selectedWeek: syncState.selectedWeek,
          courseName: syncState.courseName,
          courseId: syncState.courseId,
          isOfflineMode: syncState.isOfflineMode,
          isGeoEnabled: syncState.isGeoEnabled,
          teacherLocation: syncState.teacherLocation,
          qrToken: activeTok,
          qrTokenIat: activeIat,
          pinRequired: effectivePinRequired,
        })
      );
    };
    updateTick();
    const timer = setInterval(updateTick, 1000);
    return () => clearInterval(timer);
  }, [syncState, fallbackToken.qrToken, fallbackToken.qrTokenIat, effectivePinRequired]);

  useEffect(() => {
    let channel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel(getClassroomChannelName());
      channel.onmessage = (event: MessageEvent<{ type?: string; payload?: ClassroomSyncPayload }>) => {
        if (!event?.data) return;
        if (event.data.type === 'CLASSROOM_STATE_UPDATE' && event.data.payload) {
          if (event.data.payload.active === false) {
            window.close();
            return;
          }
          setSyncState(event.data.payload);
        }
      };
    }

    const storageKey = getClassroomStorageKey();
    const onStorage = (e: StorageEvent) => {
      if (e.key === storageKey && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue) as ClassroomSyncPayload;
          if (parsed.active === false) {
            window.close();
            return;
          }
          setSyncState(parsed);
        } catch {
          // Ignore invalid JSON
        }
      }
    };

    const onBeforeUnload = () => {
      postClassroomWindowClosed();
    };

    window.addEventListener('storage', onStorage);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      channel?.close();
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, []);

  return (
    <ClassroomDisplay
      courseName={syncState.courseName}
      selectedWeek={syncState.selectedWeek}
      qrData={qrData}
      currentTime={currentTime}
      qrErrorCorrection={syncState.qrErrorCorrection}
      qrMargin={syncState.qrMargin}
      geoPending={Boolean(syncState.geoPending)}
      pinRequired={Boolean(effectivePinRequired)}
      classroomPin={effectivePin || ''}
      pinDisplayMode={syncState.pinDisplayMode || 'hidden'}
      pinVisibleUntil={syncState.pinVisibleUntil || 0}
      onClose={handleCloseWindow}
      onToggleFullscreen={handleToggleFullscreen}
      isFullscreen={isFullscreen}
    />
  );
};
