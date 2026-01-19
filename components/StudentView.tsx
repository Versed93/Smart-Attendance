import React, { useState, useEffect } from 'react';
import { CheckCircleIcon } from './icons/CheckCircleIcon';
import { GlobeIcon } from './icons/GlobeIcon';
import { MapPinIcon } from './icons/MapPinIcon';
import { PRE_REGISTERED_STUDENTS } from '../studentList';

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
}

type Status = 'validating' | 'validating-gps' | 'form' | 'success' | 'error' | 'cooldown';

const STUDENT_PROFILE_KEY = 'attendance-student-profile-v1';

// Haversine formula to calculate distance in meters
const getDistanceFromLatLonInM = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 6371; // Radius of the earth in km
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const d = R * c; // Distance in km
  return d * 1000; // Distance in meters
};

const deg2rad = (deg: number) => {
  return deg * (Math.PI / 180);
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
  syncStatus = "Connecting to Google Sheets..."
}) => {
  const [name, setName] = useState('');
  const [studentId, setStudentId] = useState('');
  const [email, setEmail] = useState('');
  const [isNewStudent, setIsNewStudent] = useState(false);
  const [status, setStatus] = useState<Status>('validating');
  const [message, setMessage] = useState('');
  const [formError, setFormError] = useState('');
  
  // Load saved profile on mount
  useEffect(() => {
      const savedProfile = localStorage.getItem(STUDENT_PROFILE_KEY);
      if (savedProfile) {
          try {
              const { name: sName, studentId: sId, email: sEmail } = JSON.parse(savedProfile);
              if (sName) setName(sName);
              if (sId) setStudentId(sId);
              if (sEmail) setEmail(sEmail);
          } catch (e) {
              console.error("Failed to load profile", e);
          }
      }
  }, []);

  useEffect(() => {
    if (bypassRestrictions) { setStatus('form'); return; }
    if (!token) { setStatus('error'); setMessage('Invalid link. Please scan the QR code again.'); return; }
    
    const qrTime = parseInt(token, 10);
    const now = Date.now();
    const isValid = !isNaN(qrTime) && (now - qrTime < 60000); 
    
    if (isValid) {
        // Check Geolocation if constraints exist
        if (geoConstraints) {
            setStatus('validating-gps');
            if (!navigator.geolocation) {
                setStatus('error');
                setMessage('Your browser does not support geolocation, which is required for this class.');
                return;
            }
            
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    const dist = getDistanceFromLatLonInM(
                        geoConstraints.lat, 
                        geoConstraints.lng, 
                        position.coords.latitude, 
                        position.coords.longitude
                    );
                    
                    // GPS ACCURACY FIX:
                    const accuracy = position.coords.accuracy || 0;
                    const effectiveDistance = Math.max(0, dist - accuracy);
                    
                    if (effectiveDistance <= geoConstraints.radius) {
                        setStatus('form');
                    } else {
                        setStatus('error');
                        setMessage(`GPS Location Mismatch.\n\nDistance: ${Math.round(dist)}m\nAccuracy: ±${Math.round(accuracy)}m\nAllowed Radius: ${geoConstraints.radius}m\n\nTry moving closer to the screen or near a window/door for better signal.`);
                    }
                },
                (err) => {
                    console.error(err);
                    setStatus('error');
                    let errMsg = 'Location permission is required.';
                    if (err.code === 1) errMsg = 'Please allow Location Access in your browser settings.';
                    else if (err.code === 2) errMsg = 'GPS signal unavailable. Please ensure GPS is ON.';
                    else if (err.code === 3) errMsg = 'GPS request timed out. Please refresh.';
                    setMessage(errMsg);
                },
                { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
            );
        } else {
            setStatus('form');
        }
        
    } else {
        setStatus('error');
        setMessage('This QR code has expired. Please scan the new code on the teacher\'s screen.');
    }
  }, [token, bypassRestrictions, geoConstraints]);
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !studentId.trim() || !email.trim()) { setFormError('All fields required.'); return; }
    const studentIdRegex = /^[A-Z]{3}\d{8}$/;
    if (!studentIdRegex.test(studentId)) { setFormError('Invalid ID (e.g. FIA24001006).'); return; }
    
    // Save profile for "Remember Me"
    localStorage.setItem(STUDENT_PROFILE_KEY, JSON.stringify({ name, studentId, email }));

    const result = markAttendance(name, studentId, email);
    if (result.success) {
      setStatus('success');
    } else {
      setStatus('error');
    }
    setMessage(result.message);
  };

  const handleStudentIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value.toUpperCase();
      setStudentId(val);
      const matched = PRE_REGISTERED_STUDENTS.find(s => s.id === val);
      if (matched) { setName(matched.name); setIsNewStudent(false); } 
      else { if (!isNewStudent && name) setName(''); setIsNewStudent(true); }
      if (/^[A-Z]{3}\d{8}$/.test(val)) setEmail(`${val}@STUDENT.UTS.EDU.MY`);
  };

  if (status === 'validating') {
      return (
        <div className="text-center py-12 flex flex-col items-center" role="status" aria-live="polite">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-primary mb-4" aria-hidden="true"></div>
            <p className="text-gray-600 font-medium">Verifying secure link...</p>
        </div>
      );
  }

  if (status === 'validating-gps') {
      return (
        <div className="text-center py-12 flex flex-col items-center px-6" role="status" aria-live="polite">
            <div className="animate-bounce rounded-full p-4 bg-blue-50 text-brand-primary mb-4" aria-hidden="true">
                <MapPinIcon className="w-8 h-8" />
            </div>
            <h3 className="text-lg font-bold text-gray-800 mb-2">Verifying Location</h3>
            <p className="text-gray-500 text-sm max-w-xs mx-auto mb-4">Please allow location access. This may take a moment to get a precise GPS fix.</p>
            <div className="w-full max-w-[200px] h-1 bg-gray-100 rounded-full overflow-hidden" role="progressbar" aria-label="Acquiring GPS Signal">
                <div className="h-full bg-brand-primary animate-progress"></div>
            </div>
        </div>
      );
  }

  return (
    <div className="relative">
        {bypassRestrictions && onExit && (
            <button 
                onClick={onExit} 
                className="absolute -top-2 -right-2 text-xs text-gray-400 hover:text-gray-600 p-2 focus:outline-none focus:ring-2 focus:ring-red-500 rounded"
                aria-label="Exit Admin Mode"
            >
                ✕ Exit Admin
            </button>
        )}

        {status === 'form' && (
            <form onSubmit={handleSubmit} className="space-y-5" aria-labelledby="form-title">
                <div className="text-center mb-6">
                    <h3 id="form-title" className="text-xl font-bold text-gray-800">Check-in Details</h3>
                    <div className="flex flex-col items-center gap-1 mt-2">
                        <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-green-50 text-green-700 rounded-full text-xs font-bold border border-green-200 shadow-sm">
                            <CheckCircleIcon className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>Secure Link Verified</span>
                        </div>
                        {geoConstraints && (
                            <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-xs font-bold border border-blue-200 shadow-sm">
                                <MapPinIcon className="w-3.5 h-3.5" aria-hidden="true" />
                                <span>Location Verified</span>
                            </div>
                        )}
                    </div>
                </div>

                {courseName && (
                    <div className="bg-brand-primary/5 border border-brand-primary/10 rounded-lg p-3 text-center mb-4">
                        <p className="text-xs font-bold text-brand-primary uppercase tracking-wider mb-1">Current Session</p>
                        <p className="text-gray-900 font-bold">{decodeURIComponent(courseName)}</p>
                    </div>
                )}

                <div>
                    <label htmlFor="student-id" className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Student ID</label>
                    <input 
                        id="student-id"
                        type="text" 
                        value={studentId} 
                        placeholder="FIA..." 
                        onChange={handleStudentIdChange} 
                        className="block w-full bg-base-100 border-2 border-base-200 focus:border-brand-primary rounded-lg py-3 px-4 text-gray-900 uppercase font-mono font-bold transition-all outline-none" 
                        aria-required="true"
                    />
                </div>
                <div>
                    <label htmlFor="full-name" className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Full Name</label>
                    <input 
                        id="full-name"
                        type="text" 
                        value={name} 
                        placeholder="AS PER IC" 
                        onChange={(e) => setName(e.target.value.toUpperCase())} 
                        readOnly={!isNewStudent && name.length > 0} 
                        className={`block w-full border-2 rounded-lg py-3 px-4 text-gray-900 uppercase font-bold transition-all outline-none ${!isNewStudent && name.length > 0 ? 'bg-gray-100 border-transparent text-gray-600' : 'bg-base-100 border-base-200 focus:border-brand-primary'}`} 
                        aria-required="true"
                        aria-readonly={!isNewStudent && name.length > 0}
                    />
                </div>
                <div>
                    <label htmlFor="email-address" className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Email Address</label>
                    <input 
                        id="email-address"
                        type="email" 
                        value={email} 
                        onChange={(e) => setEmail(e.target.value.toUpperCase())} 
                        className="block w-full bg-base-100 border-2 border-base-200 focus:border-brand-primary rounded-lg py-3 px-4 text-gray-900 uppercase font-medium transition-all outline-none" 
                        aria-required="true"
                    />
                </div>
                
                {formError && (
                    <p className="text-sm text-red-500 font-bold text-center bg-red-50 py-2 rounded" role="alert" aria-live="assertive">
                        {formError}
                    </p>
                )}
                
                <button 
                    type="submit" 
                    className="w-full flex justify-center items-center gap-2 py-4 px-4 rounded-xl shadow-lg shadow-brand-primary/30 text-base font-bold text-white bg-brand-primary hover:bg-brand-secondary active:scale-[0.98] transition-all mt-4 focus:ring-4 focus:ring-brand-primary/50 focus:outline-none"
                >
                    Submit Attendance
                </button>
                
                <p className="text-[10px] text-center text-gray-400">Details will be saved for next time.</p>
            </form>
        )}

        {(status === 'success' || status === 'error') && (
            <div className="text-center py-8" role={status === 'error' ? 'alert' : 'status'} aria-live="polite">
                <div className={`mx-auto flex items-center justify-center h-28 w-28 rounded-full ${status === 'success' ? 'bg-green-100' : 'bg-red-100'} mb-6 shadow-sm`} aria-hidden="true">
                    {status === 'success' ? (
                        isOnline && isSyncing ? (
                            <div className="relative">
                                {/* Spinner for syncing */}
                                <svg className="animate-spin h-14 w-14 text-brand-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                <div className="absolute -bottom-2 -right-2 bg-white rounded-full p-1.5 border-2 border-white shadow-sm">
                                    <GlobeIcon className="w-5 h-5 text-brand-primary" />
                                </div>
                            </div>
                        ) : (
                            <CheckCircleIcon className="h-16 w-16 text-green-600" />
                        )
                    ) : (
                        <p className="text-5xl">😟</p>
                    )}
                </div>

                <div className="mb-6 px-4">
                    <h3 className={`text-3xl font-extrabold ${status === 'success' ? (isOnline && isSyncing ? 'text-brand-primary' : 'text-green-800') : 'text-red-600'} mb-2`}>
                        {status === 'success' ? (isOnline && isSyncing ? 'Syncing...' : 'Verified!') : 'Failed'}
                    </h3>
                    {status === 'error' && <p className="text-sm text-red-600 font-medium">{message}</p>}
                </div>
                
                {status === 'success' && (
                    <div className={`max-w-sm mx-auto rounded-2xl border overflow-hidden transition-all duration-500 shadow-sm ${!isOnline ? 'bg-yellow-50 border-yellow-200' : (isSyncing ? 'bg-indigo-50 border-indigo-200' : 'bg-green-50 border-green-200')}`}>
                        
                        {/* HEADER OF BOX */}
                        <div className={`px-6 py-4 border-b ${!isOnline ? 'border-yellow-200 bg-yellow-100/50' : (isSyncing ? 'border-indigo-200 bg-indigo-100/50' : 'border-green-200 bg-green-100/50')}`}>
                            <p className={`font-bold text-lg ${!isOnline ? 'text-yellow-800' : (isSyncing ? 'text-indigo-800' : 'text-green-800')}`}>
                                {!isOnline ? 'OFFLINE MODE' : (isSyncing ? 'DATA SYNC IN PROGRESS' : 'ATTENDANCE RECORDED')}
                            </p>
                        </div>

                        {/* BODY OF BOX */}
                        <div className="p-6">
                            {isSyncing && isOnline ? (
                                 <div className="text-left space-y-4">
                                    <div className="flex items-center gap-3 opacity-50">
                                        <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center text-white text-xs font-bold" aria-hidden="true">✓</div>
                                        <span className="text-sm font-bold text-gray-500 line-through">Step 1: Save to Device</span>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <div className="relative flex items-center justify-center w-6 h-6" aria-hidden="true">
                                            <div className="absolute w-full h-full rounded-full bg-indigo-400 opacity-25 animate-ping"></div>
                                            <div className="w-2.5 h-2.5 bg-indigo-600 rounded-full"></div>
                                        </div>
                                        <div className="flex-1">
                                            <span className="text-sm font-bold text-indigo-900 block">Step 2: Uploading to Cloud</span>
                                            <span className="text-xs text-indigo-600">{syncStatus}</span>
                                        </div>
                                    </div>
                                    <div className="bg-white/60 rounded-lg p-3 text-xs text-indigo-800 leading-relaxed border border-indigo-100">
                                        <strong>⚠️ Do not close this tab yet.</strong><br/>
                                        We are ensuring your name appears on the lecturer's screen. This usually takes a few seconds.
                                    </div>
                                 </div>
                            ) : !isOnline ? (
                                 /* Offline details */
                                 <div className="text-left space-y-4">
                                     <div className="flex items-start gap-3">
                                        <div className="mt-0.5 min-w-[20px]" aria-hidden="true">
                                            <GlobeIcon className="w-5 h-5 text-yellow-600" />
                                        </div>
                                        <div>
                                            <p className="text-sm font-bold text-yellow-900">No Internet Connection</p>
                                            <p className="text-xs text-yellow-700 mt-1">Don't worry! Your attendance is safely stored on this phone.</p>
                                        </div>
                                     </div>
                                     <div className="bg-yellow-100/50 rounded-lg p-3 text-xs text-yellow-800 leading-relaxed border border-yellow-200">
                                        <strong>What to do:</strong><br/>
                                        You can close this tab. The app will automatically retry uploading when you have internet access again.
                                     </div>
                                 </div>
                            ) : (
                                 /* Success details */
                                 <div className="text-center space-y-4">
                                    <div className="flex justify-center" aria-hidden="true">
                                        <div className="bg-green-100 p-3 rounded-full">
                                            <CheckCircleIcon className="w-8 h-8 text-green-600" />
                                        </div>
                                    </div>
                                    <div>
                                        <p className="text-sm text-green-800 font-medium leading-relaxed">
                                            Your name has been successfully added to the class list.
                                        </p>
                                    </div>
                                    <div className="pt-2 border-t border-green-100">
                                        <p className="text-xs text-green-600">
                                            You can safely close this tab now.
                                        </p>
                                    </div>
                                 </div>
                            )}
                            
                            <button 
                                onClick={() => { setName(''); setStudentId(''); setEmail(''); setStatus('form'); }} 
                                className="mt-6 w-full py-3 bg-brand-primary text-white rounded-xl font-bold shadow-lg shadow-brand-primary/20 hover:scale-[1.02] active:scale-95 transition-all focus:ring-4 focus:ring-brand-primary/50 focus:outline-none"
                            >
                                Register Next Student
                            </button>
                        </div>
                    </div>
                )}
            </div>
        )}
    </div>
  );
};