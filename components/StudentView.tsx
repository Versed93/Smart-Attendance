
import React, { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { CheckCircleIcon } from './icons/CheckCircleIcon';
import { MapPinIcon } from './icons/MapPinIcon';
import type { PreRegisteredStudent } from '../studentList';
import { LockClosedIcon } from './icons/LockClosedIcon';
import { ExclamationTriangleIcon } from './icons/ExclamationTriangleIcon';

interface StudentViewProps {
  markAttendance: (name: string, studentId: string, email: string) => Promise<{ success: boolean, message: string }>;
  token: string;
  courseName?: string;
  geoConstraints?: { lat: number; lng: number; radius: number };
  bypassRestrictions?: boolean;
  onExit?: () => void;
  isOfflineScan?: boolean;
  knownStudents: PreRegisteredStudent[];
}

type Status = 'validating' | 'validating-gps' | 'form' | 'submitting' | 'success' | 'error' | 'show-student-qr' | 'device-locked';

const STUDENT_PROFILE_KEY = 'attendance-student-profile-v1';

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
  token, 
  courseName, 
  geoConstraints, 
  bypassRestrictions = false, 
  onExit, 
  isOfflineScan = false,
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
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  
  useEffect(() => {
      const savedProfile = localStorage.getItem(STUDENT_PROFILE_KEY);
      if (savedProfile) {
          try {
              const { name: sName, studentId: sId, email: sEmail } = JSON.parse(savedProfile);
              if (sName) setName(sName);
              if (sId) setStudentId(sId);
              if (sEmail) setEmail(sEmail);
          } catch (e) {}
      }
      
      const lockKey = `attendance-device-lock-v1-${new Date().toISOString().slice(0, 10)}-${courseName || 'general'}`;
      if (!bypassRestrictions && localStorage.getItem(lockKey)) {
        setStatus('device-locked');
      }
  }, [bypassRestrictions, courseName]);

  useEffect(() => {
    if (status !== 'validating') return;
    if (bypassRestrictions) { setStatus('form'); return; }
    if (!token) { setStatus('error'); setMessage('Session link invalid. Please re-scan.'); return; }
    
    const qrTime = parseInt(token, 10);
    const now = Date.now();
    const isValid = !isNaN(qrTime) && (now - qrTime < 60000); 
    
    if (isValid) {
        if (geoConstraints) {
            setStatus('validating-gps');
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    const dist = getDistanceFromLatLonInM(geoConstraints.lat, geoConstraints.lng, pos.coords.latitude, pos.coords.longitude);
                    if (dist - pos.coords.accuracy <= geoConstraints.radius) setStatus('form');
                    else { setStatus('error'); setMessage(`Location Mismatch: ${Math.round(dist)}m away.`); }
                },
                (err) => { setStatus('error'); setMessage('GPS access is required for verification.'); },
                { enableHighAccuracy: true, timeout: 15000 }
            );
        } else setStatus('form');
    } else { setStatus('error'); setMessage('QR Code expired. Scan the newest code.'); }
  }, [token, bypassRestrictions, geoConstraints, status]);

  useEffect(() => {
    if (status === 'show-student-qr' && canvasRef.current && studentQrData) {
        QRCode.toCanvas(canvasRef.current, studentQrData, { width: 320, margin: 2 });
    }
  }, [status, studentQrData]);
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    if (!name.trim() || !studentId.trim()) { setFormError('Please fill in required fields.'); return; }
    if (!/^[A-Z]{3}\d{8}$/.test(studentId)) { setFormError('ID Format: FIA24001006'); return; }

    localStorage.setItem(STUDENT_PROFILE_KEY, JSON.stringify({ name, studentId, email }));

    const lockKey = `attendance-device-lock-v1-${new Date().toISOString().slice(0, 10)}-${courseName || 'general'}`;

    if (isOfflineScan) {
      if (!bypassRestrictions) localStorage.setItem(lockKey, 'true');
      setStudentQrData(JSON.stringify({ name, studentId, email, timestamp: Date.now(), status: 'P' }));
      setStatus('show-student-qr');
    } else {
      setStatus('submitting');
      const result = await markAttendance(name, studentId, email);
      setMessage(result.message);
      if (result.success) {
        setStatus('success');
        if (!bypassRestrictions) localStorage.setItem(lockKey, 'true');
      } else setStatus('error');
    }
  };

  const handleIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value.toUpperCase();
      setStudentId(val);
      const matched = knownStudents.find(s => s.id === val);
      if (matched) { setName(matched.name); setIsNewStudent(false); } 
      else { if (!isNewStudent && name) setName(''); setIsNewStudent(true); }
      if (/^[A-Z]{3}\d{8}$/.test(val)) setEmail(`${val}@STUDENT.UTS.EDU.MY`);
  };

  if (status === 'device-locked') return (
     <div className="text-center py-12 px-4 animate-in fade-in duration-500">
        <div className="bg-red-50 rounded-full p-6 w-20 h-20 mx-auto mb-6 flex items-center justify-center border-2 border-red-100 shadow-sm"> 
           <LockClosedIcon className="w-10 h-10 text-red-500" /> 
        </div>
        <h3 className="text-xl font-black text-gray-900 mb-2">Device Restricted</h3>
        <p className="text-sm text-gray-500 max-w-xs mx-auto mb-4">You have already checked in for this session. Only one check-in per device is allowed.</p>
        <div className="inline-flex items-center gap-2 px-3 py-1 bg-amber-50 text-amber-700 rounded text-[10px] font-bold border border-amber-200">
           <ExclamationTriangleIcon className="w-3.5 h-3.5" />
           <span>Security Lock Active</span>
        </div>
     </div>
  );

  if (status === 'validating' || status === 'submitting') return <div className="text-center py-12"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-brand-primary mx-auto"></div><p className="mt-4 text-gray-500 font-bold uppercase text-[10px] tracking-widest">{status === 'submitting' ? 'RECORDING...' : 'VERIFYING...'}</p></div>;
  if (status === 'validating-gps') return <div className="text-center py-12"><MapPinIcon className="w-10 h-10 text-brand-primary mx-auto animate-pulse" /><p className="mt-4 text-gray-500 font-bold text-[10px] uppercase tracking-widest">Checking Location...</p></div>;

  return (
    <div className="relative">
        {bypassRestrictions && onExit && ( <button onClick={onExit} className="absolute -top-3 -right-3 text-[10px] bg-gray-100 hover:bg-gray-200 rounded-full p-2 transition-colors">✕ Exit Kiosk</button> )}

        {status === 'form' && (
            <form onSubmit={handleSubmit} className="space-y-4">
                <div className="text-center mb-4">
                    <h3 className="text-lg font-black text-gray-800 tracking-tight uppercase mb-2">Student Attendance</h3>
                    <div className="flex flex-wrap justify-center gap-2">
                        <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-green-50 text-green-700 rounded-full text-[10px] font-bold border border-green-200"><CheckCircleIcon className="w-3.5 h-3.5" /><span>Session Verified</span></div>
                        {geoConstraints && (<div className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-[10px] font-bold border border-blue-200"><MapPinIcon className="w-3.5 h-3.5" /><span>Location Locked</span></div>)}
                    </div>
                </div>

                {courseName && (
                    <div className="bg-brand-primary/5 border-2 border-brand-primary/10 rounded-xl p-3 text-center">
                        <p className="text-[9px] font-black text-brand-primary uppercase tracking-widest mb-0.5 opacity-60">Active Session</p>
                        <p className="text-sm text-gray-900 font-extrabold truncate">{decodeURIComponent(courseName)}</p>
                    </div>
                )}
                
                <div className="space-y-3">
                    <div>
                        <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 ml-1">Student ID</label>
                        <input type="text" value={studentId} placeholder="FIA25..." onChange={handleIdChange} className="block w-full bg-gray-50 border-2 border-gray-100 focus:border-brand-primary rounded-xl py-3 px-4 text-gray-900 uppercase font-mono font-black transition-all" required />
                    </div>
                    <div>
                        <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 ml-1">Full Name</label>
                        <input type="text" value={name} placeholder="AS PER REGISTRATION" onChange={(e) => setName(e.target.value.toUpperCase())} readOnly={!isNewStudent && name.length > 0} className={`block w-full border-2 rounded-xl py-3 px-4 text-gray-900 uppercase font-bold transition-all ${!isNewStudent && name.length > 0 ? 'bg-gray-100 border-transparent text-gray-400' : 'bg-gray-50 border-gray-100 focus:border-brand-primary'}`} required />
                    </div>
                </div>
                
                {formError && <p className="text-xs text-red-500 font-bold text-center bg-red-50 py-2 rounded-lg border border-red-100">{formError}</p>}
                
                <button type="submit" className="w-full py-4 px-4 rounded-xl shadow-lg shadow-brand-primary/20 text-sm font-black text-white bg-brand-primary hover:bg-brand-secondary active:scale-[0.98] transition-all mt-2">
                    {isOfflineScan ? 'GENERATE QR PASS' : 'CONFIRM ATTENDANCE'}
                </button>
            </form>
        )}

        {status === 'show-student-qr' && (
            <div className="text-center py-4 animate-in zoom-in duration-300">
                <h3 className="text-lg font-black text-gray-800 mb-2">QR Passcode</h3>
                <p className="text-xs text-gray-500 mb-4 px-4">Show this to the lecturer. Your device is now locked for this session.</p>
                <div className="bg-white p-4 rounded-2xl shadow-inner border-4 border-double border-brand-primary/20 flex items-center justify-center mx-auto mb-6">
                    <canvas ref={canvasRef} className="max-w-full" />
                </div>
                <div className="p-4 bg-indigo-50 rounded-xl border-2 border-indigo-100 inline-block min-w-[200px]">
                    <p className="font-black text-indigo-900">{name}</p>
                    <p className="text-xs font-mono text-indigo-500 mt-1">{studentId}</p>
                </div>
            </div>
        )}

        {(status === 'success' || status === 'error') && (
            <div className="text-center py-10 animate-in fade-in duration-500">
                <div className={`mx-auto flex items-center justify-center h-20 w-20 rounded-full ${status === 'success' ? 'bg-green-100 border-green-200' : 'bg-red-100 border-red-200'} mb-6 border-4 shadow-sm`}>
                    {status === 'success' ? <CheckCircleIcon className="h-12 w-12 text-green-600 animate-in zoom-in duration-700" /> : <p className="text-4xl">❌</p>}
                </div>
                <h3 className={`text-2xl font-black ${status === 'success' ? 'text-green-800' : 'text-red-600'} mb-2`}>
                    {status === 'success' ? 'Checked In!' : 'Submission Failed'}
                </h3>
                <p className="text-xs font-bold text-gray-400 mb-6 uppercase tracking-wider">{message}</p>
                {status === 'success' && (
                   <div className="space-y-4">
                      <div className="bg-green-50 rounded-2xl p-6 border-2 border-green-100 shadow-sm animate-in slide-in-from-bottom-4 duration-1000">
                         <p className="text-lg font-black text-green-900">Thank you for checked-in!</p>
                         <p className="text-[11px] text-green-700 mt-2 font-medium">Attendance for <strong>{decodeURIComponent(courseName || 'General Session')}</strong> has been recorded. Have a great class!</p>
                      </div>
                      <div className="flex items-center justify-center gap-2 text-[10px] text-gray-400 font-bold uppercase tracking-[0.2em] pt-4">
                         <LockClosedIcon className="w-3.5 h-3.5" />
                         <span>Session Locked</span>
                      </div>
                   </div>
                )}
            </div>
        )}
    </div>
  );
};
