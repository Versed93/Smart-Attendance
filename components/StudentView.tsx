import React, { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { CheckCircleIcon } from './icons/CheckCircleIcon';
import { MapPinIcon } from './icons/MapPinIcon';
import type { PreRegisteredStudent } from '../studentList';
import { LockClosedIcon } from './icons/LockClosedIcon';
import { ExclamationTriangleIcon } from './icons/ExclamationTriangleIcon';
import { QrScanner } from './QrScanner';
import { CameraIcon } from './icons/CameraIcon';
import { ShieldCheckIcon } from './icons/ShieldCheckIcon';
import { FIREBASE_CONFIG } from '../firebaseConfig';
import { UserIcon } from './icons/UserIcon';

interface StudentViewProps {
  markAttendance: (name: string, studentId: string, email: string) => Promise<{ success: boolean, message: string }>;
  token: string;
  courseName?: string;
  geoConstraints?: { lat: number; lng: number; radius: number };
  bypassRestrictions?: boolean;
  onExit?: () => void;
  isOfflineScan?: boolean;
  knownStudents: PreRegisteredStudent[];
  onSwitchToTeacher?: () => void;
}

type Status = 'landing' | 'validating' | 'validating-gps' | 'form' | 'submitting' | 'success' | 'error' | 'show-student-qr' | 'device-locked' | 'checking-firebase';

const STUDENT_PROFILE_KEY = 'attendance-student-profile-v1';
const SESSION_ID = new Date().toISOString().slice(0, 10);

const getDistanceFromLatLonInM = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 6371e3;
  const φ1 = lat1 * Math.PI/180;
  const φ2 = lat2 * Math.PI/180;
  const Δφ = (lat2-lat1) * Math.PI/180;
  const Δλ = (lon2-lon1) * Math.PI/180;
  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
};

export const StudentView: React.FC<StudentViewProps> = ({ 
  markAttendance, 
  token: initialToken, 
  courseName: initialCourseName, 
  geoConstraints, 
  bypassRestrictions = false, 
  onExit, 
  isOfflineScan = false,
  knownStudents,
  onSwitchToTeacher
}) => {
  const [name, setName] = useState('');
  const [studentId, setStudentId] = useState('');
  const [email, setEmail] = useState('');
  const [isNewStudent, setIsNewStudent] = useState(false);
  const [status, setStatus] = useState<Status>('validating');
  const [message, setMessage] = useState('');
  const [formError, setFormError] = useState('');
  const [studentQrData, setStudentQrData] = useState('');
  const [showScanner, setShowScanner] = useState(false);
  const [token, setToken] = useState(initialToken);
  const [courseName, setCourseName] = useState(initialCourseName);
  
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  
  useEffect(() => {
    const savedProfile = localStorage.getItem(STUDENT_PROFILE_KEY);
    if (savedProfile) {
        try {
            const { name: sName, studentId: sId } = JSON.parse(savedProfile);
            if (sName) setName(sName);
            if (sId) setStudentId(sId);
        } catch (e) {}
    }
  }, []);

  useEffect(() => {
    const checkStatus = async () => {
        const lockKey = `attendance-device-lock-v1-${SESSION_ID}-${courseName || 'general'}`;
        
        if (!bypassRestrictions && localStorage.getItem(lockKey)) {
          setStatus('device-locked');
          return;
        }

        if (!token) {
            setStatus('landing');
            return;
        }

        const qrTime = parseInt(token, 10);
        const now = Date.now();
        const isTokenValid = !isNaN(qrTime) && (now - qrTime < 60000); 
        
        if (!isTokenValid && !bypassRestrictions) {
            setStatus('error');
            setMessage('QR Code expired. Scan the newest code.');
            return;
        }

        if (geoConstraints && !bypassRestrictions) {
            setStatus('validating-gps');
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    const dist = getDistanceFromLatLonInM(geoConstraints.lat, geoConstraints.lng, pos.coords.latitude, pos.coords.longitude);
                    if (dist - pos.coords.accuracy <= geoConstraints.radius) {
                        setStatus('form');
                    } else {
                        setStatus('error');
                        setMessage(`Location Mismatch: ${Math.round(dist)}m away. Move closer to the classroom.`);
                    }
                },
                (err) => {
                    setStatus('error');
                    setMessage('GPS access is required for security verification.');
                },
                { enableHighAccuracy: true, timeout: 15000 }
            );
        } else {
            setStatus('form');
        }
    };

    checkStatus();
  }, [bypassRestrictions, courseName, geoConstraints, token]);

  useEffect(() => {
    if (status === 'show-student-qr' && canvasRef.current && studentQrData) {
        QRCode.toCanvas(canvasRef.current, studentQrData, { width: 320, margin: 2 }, (err) => {
            if (err) console.error(err);
        });
    }
  }, [status, studentQrData]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !studentId) { setFormError('All fields required.'); return; }
    
    localStorage.setItem(STUDENT_PROFILE_KEY, JSON.stringify({ name, studentId }));
    
    if (isOfflineScan) {
        setStudentQrData(JSON.stringify({ name, studentId, email: `${studentId}@STUDENT.UTS.EDU.MY`, timestamp: Date.now() }));
        setStatus('show-student-qr');
        return;
    }

    setStatus('submitting');
    const result = await markAttendance(name, studentId, `${studentId}@STUDENT.UTS.EDU.MY`);
    if (result.success) {
      setStatus('success');
      const lockKey = `attendance-device-lock-v1-${SESSION_ID}-${courseName || 'general'}`;
      if (!bypassRestrictions) localStorage.setItem(lockKey, 'true');
    } else if (result.message === "You have already checked in for this session." || result.message === "Attendance already recorded for this student ID.") {
      setStatus('device-locked');
      const lockKey = `attendance-device-lock-v1-${SESSION_ID}-${courseName || 'general'}`;
      if (!bypassRestrictions) localStorage.setItem(lockKey, 'true');
    } else {
      setStatus('error');
      setMessage(result.message);
    }
  };

  const handleIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.toUpperCase().trim();
    setStudentId(val);
    const matched = knownStudents.find(s => s.id === val);
    if (matched) { 
        setName(matched.name); 
        setIsNewStudent(false); 
        setFormError(''); 
    } else { 
        if (!isNewStudent) setName(''); 
        setIsNewStudent(true); 
    }
  };

  const handleScanJoin = (data: string) => {
      setShowScanner(false);
      try {
          const url = new URL(data);
          const t = url.searchParams.get('t');
          const c = url.searchParams.get('c');
          if (t) {
              setToken(t);
              if (c) setCourseName(c);
              setStatus('validating');
          } else {
              setStatus('error');
              setMessage('Invalid session QR.');
          }
      } catch (e) {
          setStatus('error');
          setMessage('Invalid QR format. Please scan the official attendance code.');
      }
  };

  if (status === 'landing') {
      return (
          <div className="text-center space-y-8 animate-in fade-in duration-500 py-4">
              <div className="flex flex-col items-center">
                  <div className="w-16 h-16 bg-brand-primary text-white rounded-2xl flex items-center justify-center shadow-xl shadow-brand-primary/10 mb-4 relative">
                      <ShieldCheckIcon className="w-10 h-10" />
                  </div>
                  <h1 className="text-3xl font-black text-gray-900 tracking-tight leading-tight">UTS Portal</h1>
                  <p className="text-[10px] font-black text-gray-400 mt-2 uppercase tracking-[0.3em]">Access Point</p>
              </div>

              <div className="space-y-4">
                  {/* MAIN ACTION: Student Scan (Now a bit smaller) */}
                  <button 
                      onClick={() => setShowScanner(true)}
                      className="w-full bg-indigo-600 text-white font-black py-4 rounded-2xl hover:bg-black active:scale-95 transition-all shadow-xl shadow-indigo-100 flex items-center justify-center gap-3 uppercase tracking-[0.1em] text-xs"
                  >
                      <CameraIcon className="w-5 h-5" />
                      Scan Attendance QR
                  </button>

                  <div className="flex items-center gap-4 py-1">
                      <div className="h-[1px] flex-1 bg-gray-100"></div>
                      <span className="text-[9px] font-black text-gray-300 uppercase tracking-widest">or</span>
                      <div className="h-[1px] flex-1 bg-gray-100"></div>
                  </div>

                  {/* COMPACT ACTION: Lecturer Portal */}
                  <button 
                      onClick={onSwitchToTeacher}
                      className="w-full bg-gray-900 text-white font-bold py-3 rounded-xl hover:bg-black active:scale-95 transition-all flex items-center justify-center gap-2.5 uppercase tracking-[0.1em] text-[10px] shadow-sm"
                  >
                      <LockClosedIcon className="w-4 h-4 text-brand-light" />
                      Lecturer Access
                  </button>
              </div>

              <div className="bg-gray-50 border border-gray-100 p-5 rounded-2xl">
                  <p className="text-[9px] text-gray-400 font-bold leading-relaxed uppercase tracking-widest text-center opacity-70">
                      Authorized UTS Credentials Required
                  </p>
              </div>

              {showScanner && <QrScanner onScan={handleScanJoin} onClose={() => setShowScanner(false)} />}
          </div>
      );
  }

  if (status === 'device-locked') {
    return (
      <div className="text-center py-10 animate-in zoom-in duration-300">
        <div className="w-20 h-20 bg-green-50 text-green-500 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-sm"><CheckCircleIcon className="w-12 h-12" /></div>
        <h2 className="text-2xl font-black text-gray-900 mb-2">Record Verified</h2>
        <p className="text-sm text-gray-400 font-bold uppercase tracking-widest mb-8">Attendance already recorded</p>
        <div className="bg-gray-50 border border-gray-100 p-6 rounded-2xl">
             <p className="text-xs font-bold text-gray-500 leading-relaxed uppercase tracking-tight">One submission is permitted per student per session. Please see your lecturer if you believe this is an error.</p>
        </div>
        <button onClick={() => window.location.reload()} className="mt-8 text-xs font-black text-brand-primary uppercase tracking-widest">Refresh Status</button>
      </div>
    );
  }

  if (status === 'validating' || status === 'validating-gps' || status === 'checking-firebase') {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="w-16 h-16 border-4 border-brand-primary border-t-transparent rounded-full animate-spin mb-6"></div>
        <p className="text-sm font-black text-gray-900 uppercase tracking-widest">
            {status === 'validating-gps' ? 'Verifying Proximity...' : 
             status === 'checking-firebase' ? 'Retrieving Records...' : 
             'Securing Session...'}
        </p>
        <p className="text-xs text-gray-400 font-bold mt-2 uppercase">Please wait a moment</p>
      </div>
    );
  }

  if (status === 'success') {
    return (
      <div className="text-center py-10 animate-in zoom-in duration-300">
        <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-6"><CheckCircleIcon className="w-12 h-12" /></div>
        <h2 className="text-2xl font-black text-gray-900 mb-2">Check-in Complete</h2>
        <p className="text-sm text-gray-500 font-medium mb-8 px-4">Thank you, <b>{name}</b>. Your attendance for <b>{courseName || 'this session'}</b> has been successfully recorded.</p>
        <button onClick={() => window.location.reload()} className="w-full bg-gray-900 text-white font-bold py-4 rounded-xl hover:bg-black transition-all active:scale-95 shadow-lg uppercase tracking-widest text-xs">Finish</button>
      </div>
    );
  }

  if (status === 'show-student-qr') {
    return (
        <div className="text-center py-6">
            <h2 className="text-xl font-black text-gray-900 mb-2">Check-in Token</h2>
            <p className="text-xs text-gray-400 font-bold uppercase tracking-widest mb-6">Show this to your lecturer</p>
            <div className="bg-white p-4 rounded-3xl border-4 border-gray-100 inline-block mb-8">
                <canvas ref={canvasRef} className="rounded-xl" />
            </div>
            <div className="space-y-3">
                <p className="text-sm font-black text-gray-900 leading-none">{name}</p>
                <p className="text-xs font-mono font-bold text-gray-400">{studentId}</p>
            </div>
            <button onClick={() => setStatus('form')} className="mt-10 text-xs font-black text-brand-primary uppercase tracking-widest hover:underline">Edit Info</button>
        </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="text-center py-10">
        <div className="w-20 h-20 bg-red-50 text-red-500 rounded-3xl flex items-center justify-center mx-auto mb-6"><ExclamationTriangleIcon className="w-12 h-12" /></div>
        <h2 className="text-2xl font-black text-gray-900 mb-2">Unable to Process</h2>
        <p className="text-sm text-gray-500 font-medium mb-8 px-6">{message}</p>
        <button onClick={() => { setToken(''); setStatus('landing'); }} className="w-full bg-red-600 text-white font-bold py-4 rounded-xl hover:bg-red-700 transition-all active:scale-95 shadow-lg uppercase tracking-widest text-xs">Try Scanning Again</button>
      </div>
    );
  }

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-black text-gray-900 tracking-tight leading-none mb-2">{courseName || 'Confirm Presence'}</h2>
        <div className="flex items-center justify-center gap-2">
            <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Active Verification Flow</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1 ml-1">Student ID</label>
          <input 
            type="text" 
            value={studentId} 
            onChange={handleIdChange}
            className="w-full border-2 border-gray-100 bg-gray-50 rounded-2xl p-4 font-mono font-black uppercase focus:bg-white focus:border-indigo-600 transition-all outline-none" 
            placeholder="FIA..."
            required
            autoComplete="off"
          />
        </div>

        <div>
          <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1 ml-1">Full Name</label>
          <input 
            type="text" 
            value={name} 
            onChange={(e) => setName(e.target.value.toUpperCase())}
            className="w-full border-2 border-gray-100 bg-gray-50 rounded-2xl p-4 font-black uppercase focus:bg-white focus:border-indigo-600 transition-all outline-none" 
            placeholder="YOUR NAME"
            required
            autoComplete="name"
          />
        </div>

        <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100 flex items-start gap-3">
            <div className="p-2 bg-white rounded-xl text-gray-400 shrink-0"><LockClosedIcon className="w-4 h-4" /></div>
            <p className="text-[10px] text-gray-400 font-bold leading-relaxed uppercase">Submission is permanent for this session. Please ensure your ID is correct before confirming.</p>
        </div>

        {formError && <p className="text-xs text-red-500 font-bold text-center bg-red-50 p-3 rounded-xl border border-red-100">{formError}</p>}

        <button 
          type="submit" 
          disabled={status === 'submitting'}
          className="w-full bg-indigo-600 text-white font-black py-5 rounded-2xl hover:bg-black active:scale-95 transition-all shadow-xl shadow-indigo-100 disabled:opacity-50 uppercase tracking-widest text-sm flex items-center justify-center gap-2"
        >
          {status === 'submitting' ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div> : (isOfflineScan ? 'Generate Check-in Pass' : 'Submit Attendance')}
        </button>
      </form>
    </div>
  );
};
