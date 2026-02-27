import React, { useRef, useEffect, useState } from 'react';
import jsQR from 'jsqr';
import { XCircleIcon } from './icons/XCircleIcon';

interface QrScannerProps {
  onScan: (data: string) => void;
  onClose: () => void;
}

export const QrScanner: React.FC<QrScannerProps> = ({ onScan, onClose }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let animationFrameId: number;
    let stream: MediaStream | null = null;
    let isMounted = true;

    const tick = () => {
      if (videoRef.current && videoRef.current.readyState === videoRef.current.HAVE_ENOUGH_DATA && canvasRef.current) {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        
        if (ctx) {
            canvas.height = video.videoHeight;
            canvas.width = video.videoWidth;
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(imageData.data, imageData.width, imageData.height, {
              inversionAttempts: "dontInvert",
            });

            if (code) {
                onScan(code.data);
                return; // Stop scanning after a successful scan
            }
        }
      }
      animationFrameId = requestAnimationFrame(tick);
    };

    const startCamera = async () => {
      try {
        const newStream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: "environment" } 
        });

        if (!isMounted) {
            newStream.getTracks().forEach(track => track.stop());
            return;
        }
        
        stream = newStream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.setAttribute("playsinline", "true"); // Required for iOS
          videoRef.current.play().catch(e => {
              if (e.name !== 'AbortError') {
                  console.error("Video play error:", e);
              }
          });
          animationFrameId = requestAnimationFrame(tick);
        }
      } catch (err) {
        if (isMounted) {
            console.error("Camera Error:", err);
            setError("Could not access camera. Please check permissions.");
        }
      }
    };

    startCamera();

    return () => {
      isMounted = false;
      cancelAnimationFrame(animationFrameId);
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };
  }, [onScan]);

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true">
      <div className="relative w-full max-w-lg mx-auto bg-gray-900 rounded-2xl shadow-2xl overflow-hidden aspect-square">
        <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" playsInline />
        <canvas ref={canvasRef} className="hidden" />

        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <div className="w-2/3 h-2/3 border-4 border-white/50 rounded-2xl shadow-inner-strong" style={{ boxShadow: '0 0 0 999px rgba(0,0,0,0.5)' }}></div>
            <p className="mt-6 text-white font-bold bg-black/50 px-4 py-2 rounded-lg">Align QR code within the frame</p>
        </div>

        {error && <div className="absolute bottom-4 left-4 right-4 bg-red-500 text-white text-center p-3 rounded-lg text-sm font-bold">{error}</div>}
        
        <button onClick={onClose} className="absolute top-4 right-4 text-white bg-black/40 rounded-full p-2 hover:bg-black/60 transition-colors" aria-label="Close scanner">
            <XCircleIcon className="w-8 h-8"/>
        </button>
      </div>
    </div>
  );
};
