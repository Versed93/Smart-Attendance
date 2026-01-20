import React, { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { CheckCircleIcon } from './icons/CheckCircleIcon';
import { GlobeIcon } from './icons/GlobeIcon';
import { MapPinIcon } from './icons/MapPinIcon';
import { QrCodeIcon } from './icons/QrCodeIcon';
import type { PreRegisteredStudent } from '../studentList';
import { LockClosedIcon } from './icons/LockClosedIcon';

interface StudentViewProps {
  markAttendance: (name: string, studentId: string, email: string) => { success: boolean, message: string };
  token: string;
  courseName?: string;
  geoConstraints?: { lat: number; lng: number; radius: number };
  bypassRestrictions?: boolean;
  onExit?: () => void;
  isSyncing?: boolean;
  isOnline?: boolean;
  syncStatus?: string;
  isOfflineScan?: boolean;
  onRetry?: () => void;
  knownStudents: PreRegisteredStudent[];
}

type Status = 'validating' | 'validating-gps' | 'form' | 'success' | 'error' | 'show-student-qr' | 'device-locked';

const STUDENT_PROFILE_KEY = 'attendance-student-profile-v1';
const DEVICE_LOCK_KEY = 'attendance-device-lock-v1';

// Haversine formula
const getDistanceFromLatLonInM = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 6371e3; // metres
  const φ1 = lat1 * Math.PI/180;
  const φ2 = lat2 * Math.PI/180;
  const Δφ = (lat2-lat1) * Math.PI/180;
  const Δλ = (lon2-lon1) * Math.PI/180;

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c;
};

export const StudentView: React.FC<StudentViewProps> = ({ 
  markAttendance, 
  token, 
  courseName, 
  geoConstraints, 
  bypassRestrictions = false, 
  onExit, 
  isSyncing = false, 
  isOnline = true,
  syncStatus = "Connecting to Google Sheets...",
  isOfflineScan = false,
  onRetry,
  knownStudents
}) => {
  const [name, setName] = useState('');
  const [studentId, setStudentId] = useState('');
  const [email, setEmail] = useState('');
  const [isNewStudent, setIsNewStudent] = useState(false);
  const [status, setStatus] = useState<Status>('validating');
  const [message, setMessage] = useState('');
  const [formError, setFormError] = useState('');
  const [studentQrData, setStudentQrData] = useState('');
  const [showRetry, setShowRetry] = useState(false);
  
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
      const savedProfile = localStorage.getItem(STUDENT_PROFILE_KEY);
      if (savedProfile) {
          try {
              const { name: sName, studentId: sId, email: sEmail } = JSON.parse(savedProfile);
              if (sName) setName(sName);
              if (sId) setStudentId(sId);
              if (sEmail) setEmail(sEmail);
          } catch (e) { console.error("Failed to load profile", e); }
      }
      
      // Check for Device Lock
      if (!bypassRestrictions) {
          const lockData = localStorage.getItem(DEVICE_LOCK_KEY);
          if (lockData) {
              const lockTime = parseInt(lockData, 10);
              const twelveHours = 12 * 60 * 60 * 1000;
              if (Date.now() - lockTime < twelveHours) {
                  setStatus('device-locked');
              }
          }
      }
  }, [bypassRestrictions]);

  useEffect(() => {
    // Show retry button if syncing takes longer than 5 seconds
    let timeout: ReturnType<typeof setTimeout>;
    if (isSyncing && status === 'success') {
        setShowRetry(false);
        timeout = setTimeout(() => setShowRetry(true), 5000);
    } else {
        setShowRetry(false);
    }
    return () => clearTimeout(timeout);
  }, [isSyncing, status]);

  useEffect(() => {
    if (status === 'device-locked') return;
    if (bypassRestrictions) { setStatus('form'); return; }
    if (!token) { setStatus('error'); setMessage('Invalid link. Please scan the QR code again.'); return; }
    
    const qrTime = parseInt(token, 10);
    const now = Date.now();
    const isValid = !isNaN(qrTime) && (now - qrTime < 60000); 
    
    if (isValid) {
        if (geoConstraints) {
            setStatus('validating-gps');
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    const dist = getDistanceFromLatLonInM(geoConstraints.lat, geoConstraints.lng, position.coords.latitude, position.coords.longitude);
                    const accuracy = position.coords.accuracy || 0;
                    const effectiveDistance = Math.max(0, dist - accuracy);
                    
                    if (effectiveDistance <= geoConstraints.radius) {
                        setStatus('form');
                    } else {
                        setStatus('error');
                        setMessage(`GPS Location Mismatch. Distance: ${Math.round(dist)}m, Required: ${geoConstraints.radius}m. Please move closer.`);
                    }
                },
                (err) => {
                    let errMsg = 'Location permission is required.';
                    if (err.code === 1) errMsg = 'Please allow Location Access in your browser settings.';
                    else if (err.code === 2) errMsg = 'GPS signal unavailable. Please ensure GPS is ON.';
                    else if (err.code === 3) errMsg = 'GPS request timed out. Please refresh.';
                    setStatus('error');
                    setMessage(errMsg);
                },
                { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
            );
        } else {
            setStatus('form');
        }
    } else {
        setStatus('error');
        setMessage('This QR code has expired. Please scan the new code.');
    }
  }, [token, bypassRestrictions, geoConstraints, status]);

  useEffect(() => {
    if (status === 'show-student-qr' && canvasRef.current && studentQrData) {
        QRCode.toCanvas(canvasRef.current, studentQrData, { width: 400, margin: 1 }, (err) => {
            if (err) console.error("Could not generate student QR", err);
        });
    }
  }, [status, studentQrData]);
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !studentId.trim() || !email.trim()) { setFormError('All fields required.'); return; }
    const studentIdRegex = /^[A-Z]{3}\d{8}$/;
    if (!studentIdRegex.test(studentId)) { setFormError('Invalid ID (e.g. FIA24001006).'); return; }
    
    localStorage.setItem(STUDENT_PROFILE_KEY, JSON.stringify({ name, studentId, email }));

    if (isOfflineScan) {
        const dataToEncode = JSON.stringify({ name, studentId, email, timestamp: Date.now(), status: 'P' });
        setStudentQrData(dataToEncode);
        setStatus('show-student-qr');
    } else {
        const result = markAttendance(name, studentId, email);
        if (result.success) {
          setStatus('success');
          // Set Device Lock
          if (!bypassRestrictions) {
             localStorage.setItem(DEVICE_LOCK_KEY, Date.now().toString());
          }
        } else {
          setStatus('error');
        }
        setMessage(result.message);
    }
  };

  const handleStudentIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value.toUpperCase();
      setStudentId(val);
      const matched = knownStudents.find(s => s.id === val);
      if (matched) { setName(matched.name); setIsNewStudent(false); } 
      else { if (!isNewStudent && name) setName(''); setIsNewStudent(true); }
      if (/^[A-Z]{3}\d{8}$/.test(val)) setEmail(`${val}@STUDENT.UTS.EDU.MY`);
  };

  if (status === 'device-locked') return (
     <div className="text-center py-12 px-4" role="alert" aria-label="Device Locked">
        <div className="bg-gray-100 rounded-full p-4 w-24 h-24 mx-auto mb-4 flex items-center justify-center">
            <LockClosedIcon className="w-12 h-12 text-gray-500" />
        </div>
        <h3 className="text-xl font-black text-gray-800 mb-2">Device Already Used</h3>
        <p className="text-sm text-gray-600">Attendance has already been submitted from this device. To prevent fraud, you can only submit once per session.</p>
     </div>
  );

  if (status === 'validating') return <div className="text-center py-12" role="status" aria-label="Validating session"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-primary mx-auto"></div><p className="mt-4 text-gray-600">Verifying...</p></div>;
  if (status === 'validating-gps') return <div className="text-center py-12" role="status" aria-label="Validating location"><MapPinIcon className="w-12 h-12 text-brand-primary mx-auto animate-bounce" /><p className="mt-4 text-gray-600">Verifying Location...</p></div>;

  if (status === 'show-student-qr') {
    return (
        <div className="w-full text-center py-8 flex flex-col items-center justify-center">
            <h3 className="text-xl sm:text-2xl font-black text-gray-800 mb-2">Your Attendance Code</h3>
            <p className="text-xs sm:text-sm text-gray-500 mb-6 max-w-xs">Please present this QR code to the lecturer for scanning.</p>
            <div 
                className="bg-white p-2 rounded-xl shadow-lg border w-full aspect-square mx-auto flex items-center justify-center"
                style={{ width: '130px', height: '130px' }}
                role="img" 
                aria-label={`QR Code for ${name}`}
            >
                <canvas ref={canvasRef} className="w-full h-full object-contain" />
            </div>
            <div className="mt-6 text-center bg-gray-50 p-3 rounded-lg border w-full max-w-[250px] mx-auto">
                <p className="text-sm font-bold text-gray-900 break-words">{name}</p>
                <p className="text-xs text-gray-500 font-mono">{studentId}</p>
            </div>
        </div>
    );
  }

  // Helper to detect if status implies we are safe to leave
  const isBackgroundUpload = syncStatus?.toLowerCase().includes("background");

  return (
    <div className="relative">
        {bypassRestrictions && onExit && (
            <button 
              onClick={onExit} 
              className="absolute -top-2 -right-2 text-xs text-gray-400 hover:text-gray-600 p-2 focus:outline-none focus:text-gray-800" 
              aria-label="Exit Admin Kiosk Mode"
            >
              ✕ Exit
            </button>
        )}

        {status === 'form' && (
            <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5" aria-labelledby="form-title">
                <div className="text-center mb-4 sm:mb-6">
                    <h3 id="form-title" className="text-lg sm:text-xl font-bold text-gray-800">Check-in Details</h3>
                    <div className="flex flex-col items-center gap-1 mt-2">
                        <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-green-50 text-green-700 rounded-full text-[10px] sm:text-xs font-bold border border-green-200 shadow-sm">
                           <CheckCircleIcon className="w-3.5 h-3.5" aria-hidden="true" /><span>Secure Link Verified</span>
                        </div>
                        {geoConstraints && (
                            <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-[10px] sm:text-xs font-bold border border-blue-200 shadow-sm">
                                <MapPinIcon className="w-3.5 h-3.5" aria-hidden="true" /><span>Location Verified</span>
                            </div>
                        )}
                        {isOfflineScan && (
                             <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-purple-50 text-purple-700 rounded-full text-[10px] sm:text-xs font-bold border border-purple-200 shadow-sm">
                                <QrCodeIcon className="w-3.5 h-3.5" aria-hidden="true" /><span>Offline Mode</span>
                            </div>
                        )}
                    </div>
                </div>

                {courseName && (
                    <div className="bg-brand-primary/5 border border-brand-primary/10 rounded-lg p-3 text-center mb-4">
                        <p className="text-[10px] sm:text-xs font-bold text-brand-primary uppercase tracking-wider mb-1">Session</p>
                        <p className="text-sm sm:text-base text-gray-900 font-bold">{decodeURIComponent(courseName)}</p>
                    </div>
                )}
                
                <div>
                    <label htmlFor="student-id" className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Student ID</label>
                    <input id="student-id" type="text" value={studentId} placeholder="FIA..." onChange={handleStudentIdChange} className="block w-full bg-base-100 border-2 border-base-200 focus:border-brand-primary rounded-lg py-2.5 sm:py-3 px-4 text-gray-900 uppercase font-mono font-bold transition-all outline-none text-sm sm:text-base" required aria-required="true" />
                </div>
                <div>
                    <label htmlFor="full-name" className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Full Name</label>
                    <input id="full-name" type="text" value={name} placeholder="AS PER IC" onChange={(e) => setName(e.target.value.toUpperCase())} readOnly={!isNewStudent && name.length > 0} className={`block w-full border-2 rounded-lg py-2.5 sm:py-3 px-4 text-gray-900 uppercase font-bold transition-all outline-none text-sm sm:text-base ${!isNewStudent && name.length > 0 ? 'bg-gray-100 border-transparent text-gray-600' : 'bg-base-100 border-base-200 focus:border-brand-primary'}`} required aria-required="true" />
                </div>
                <div>
                    <label htmlFor="email-address" className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Email Address</label>
                    <input id="email-address" type="email" value={email} onChange={(e) => setEmail(e.target.value.toUpperCase())} className="block w-full bg-base-100 border-2 border-base-200 focus:border-brand-primary rounded-lg py-2.5 sm:py-3 px-4 text-gray-900 uppercase font-medium transition-all outline-none text-sm sm:text-base" required aria-required="true" />
                </div>
                
                {formError && <p className="text-sm text-red-500 font-bold text-center bg-red-50 py-2 rounded" role="alert">{formError}</p>}
                
                <button type="submit" className="w-full flex justify-center items-center gap-2 py-3.5 sm:py-4 px-4 rounded-xl shadow-lg shadow-brand-primary/30 text-sm sm:text-base font-bold text-white bg-brand-primary hover:bg-brand-secondary active:scale-[0.98] transition-all mt-4 focus:ring-4 focus:ring-brand-primary/50 focus:outline-none">
                    {isOfflineScan ? 'Generate My QR Code' : 'Submit Attendance'}
                </button>
                <p className="text-[10px] text-center text-gray-400">Details will be saved for next time.</p>
            </form>
        )}

        {(status === 'success' || status === 'error') && (
            <div className="text-center py-6 sm:py-8" role={status === 'error' ? 'alert' : 'status'}>
                <div className={`mx-auto flex items-center justify-center h-20 w-20 sm:h-28 sm:w-28 rounded-full ${status === 'success' ? 'bg-green-100' : 'bg-red-100'} mb-4 sm:mb-6 shadow-sm`}>
                    {status === 'success' ? ( isOnline && isSyncing ? <div className="animate-spin h-10 w-10 sm:h-14 sm:w-14 border-4 border-brand-primary border-t-transparent rounded-full" aria-label="Syncing"></div> : <CheckCircleIcon className="h-12 w-12 sm:h-16 sm:w-16 text-green-600" aria-hidden="true" />) : <p className="text-4xl sm:text-5xl" aria-hidden="true">😟</p>}
                </div>
                <h3 className={`text-2xl sm:text-3xl font-extrabold ${status === 'success' ? (isOnline && isSyncing && !isBackgroundUpload ? 'text-brand-primary' : (isBackgroundUpload ? 'text-orange-600' : 'text-green-800')) : 'text-red-600'} mb-2`}>
                    {status === 'success' ? (isOnline && isSyncing ? (isBackgroundUpload ? 'Saved' : 'Syncing...') : 'Verified!') : 'Failed'}
                </h3>
                {status === 'error' && <p className="text-xs sm:text-sm text-red-600 font-medium">{message}</p>}
                {status === 'success' && (
                    <div className={`max-w-sm mx-auto rounded-2xl border overflow-hidden shadow-sm mt-4 ${!isOnline ? 'bg-yellow-50 border-yellow-200' : (isSyncing ? (isBackgroundUpload ? 'bg-orange-50 border-orange-200' : 'bg-indigo-50 border-indigo-200') : 'bg-green-50 border-green-200')}`}>
                        <div className={`px-4 sm:px-6 py-3 sm:py-4 border-b ${!isOnline ? 'border-yellow-200 bg-yellow-100/50' : (isSyncing ? (isBackgroundUpload ? 'border-orange-200 bg-orange-100/50' : 'border-indigo-200 bg-indigo-100/50') : 'border-green-200 bg-green-100/50')}`}>
                            <p className={`font-bold text-sm sm:text-lg ${!isOnline ? 'text-yellow-800' : (isSyncing ? (isBackgroundUpload ? 'text-orange-800' : 'text-indigo-800') : 'text-green-800')}`}>
                                {!isOnline ? 'OFFLINE MODE' : (isSyncing ? (isBackgroundUpload ? 'UPLOAD PENDING' : 'DATA SYNC') : 'RECORDED')}
                            </p>
                        </div>
                        <div className="p-4 sm:p-6">
                            {isSyncing && isOnline && !isBackgroundUpload ? (
                                <div className="text-left space-y-4">
                                    <div className="flex items-center gap-3 opacity-50"><div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center text-white text-xs font-bold" aria-hidden="true">✓</div><span className="text-xs sm:text-sm font-bold text-gray-500 line-through">Step 1: Save to Device</span></div>
                                    <div className="flex items-center gap-3"><div className="relative w-6 h-6"><div className="absolute w-full h-full rounded-full bg-indigo-400 opacity-25 animate-ping"></div><div className="w-2.5 h-2.5 bg-indigo-600 rounded-full m-auto"></div></div><div className="flex-1"><span className="text-xs sm:text-sm font-bold text-indigo-900 block">Step 2: Uploading to Cloud</span><span className="text-[10px] sm:text-xs text-indigo-600">{syncStatus}</span></div></div>
                                    <div className="bg-white/60 p-3 text-[10px] sm:text-xs text-indigo-800 border border-indigo-100 rounded-lg"><strong>⚠️ Do not close this tab.</strong><br/>Sending data to class register...</div>
                                    {showRetry && onRetry && (
                                        <button 
                                          onClick={() => { onRetry(); }}
                                          className="w-full mt-2 py-2 px-3 bg-indigo-600 text-white text-xs font-bold rounded shadow hover:bg-indigo-700 transition-colors animate-in fade-in zoom-in"
                                        >
                                            Taking too long? Tap to Retry
                                        </button>
                                    )}
                                </div>
                            ) : (
                                (isSyncing || !isOnline) ? (
                                    <div className="text-left space-y-4">
                                        <div className="flex items-start gap-3"><GlobeIcon className="w-5 h-5 text-orange-500 mt-0.5" aria-hidden="true" /><div><p className="text-xs sm:text-sm font-bold text-orange-900">Upload Pending</p><p className="text-[10px] sm:text-xs text-orange-700 mt-1">Your attendance is saved and will upload automatically.</p></div></div>
                                        <div className="bg-orange-100/50 p-3 text-[10px] sm:text-xs text-orange-800 border border-orange-200 rounded-lg"><strong>You can safely close this tab now.</strong></div>
                                    </div>
                                ) : (
                                    <div className="text-left space-y-4">
                                         <div className="flex items-center gap-3">
                                            <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center text-white text-xs font-bold shrink-0" aria-hidden="true">✓</div>
                                            <div>
                                                <p className="text-xs sm:text-sm font-bold text-green-900">Successfully Recorded</p>
                                                <p className="text-[10px] sm:text-xs text-green-700 mt-1">Your name has been added to the class list.</p>
                                            </div>
                                         </div>
                                    </div>
                                )
                            )}
                        </div>
                    </div>
                )}
            </div>
        )}
    </div>
  );
};