
import React, { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { CheckCircleIcon } from './icons/CheckCircleIcon';
import { GlobeIcon } from './icons/GlobeIcon';
import { MapPinIcon } from './icons/MapPinIcon';
import { QrCodeIcon } from './icons/QrCodeIcon';
import type { PreRegisteredStudent } from '../studentList';
import { LockClosedIcon } from './icons/LockClosedIcon';

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
          } catch (e) { console.error("Failed to load profile", e); }
      }
      
      if (!bypassRestrictions) {
          const lockData = localStorage.getItem(DEVICE_LOCK_KEY);
          if (lockData) {
              const twelveHours = 12 * 60 * 60 * 1000;
              if (Date.now() - parseInt(lockData, 10) < twelveHours) {
                  setStatus('device-locked');
              }
          }
      }
  }, [bypassRestrictions]);

  useEffect(() => {
    if (status === 'device-locked' || status !== 'validating') return;
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
                    if (dist - position.coords.accuracy <= geoConstraints.radius) {
                        setStatus('form');
                    } else {
                        setStatus('error');
                        setMessage(`GPS Mismatch. Dist: ${Math.round(dist)}m. Please move closer.`);
                    }
                },
                (err) => {
                    setStatus('error');
                    setMessage(err.code === 1 ? 'Location Access Denied.' : 'Location Error.');
                },
                { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
            );
        } else {
            setStatus('form');
        }
    } else {
        setStatus('error');
        setMessage('QR Code has expired.');
    }
  }, [token, bypassRestrictions, geoConstraints, status]);

  useEffect(() => {
    if (status === 'show-student-qr' && canvasRef.current && studentQrData) {
        QRCode.toCanvas(canvasRef.current, studentQrData, { width: 350, margin: 2, errorCorrectionLevel: 'H' }, (err) => {
            if (err) console.error("QR Error", err);
        });
    }
  }, [status, studentQrData]);
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (!name.trim() || !studentId.trim() || !email.trim()) {
      setFormError('All fields required.');
      return;
    }
    const studentIdRegex = /^[A-Z]{3}\d{8}$/;
    if (!studentIdRegex.test(studentId)) {
      setFormError('ID Format: FIA24001006');
      return;
    }

    localStorage.setItem(STUDENT_PROFILE_KEY, JSON.stringify({ name, studentId, email }));

    if (isOfflineScan) {
      setStudentQrData(JSON.stringify({ name, studentId, email, timestamp: Date.now(), status: 'P' }));
      setStatus('show-student-qr');
    } else {
      setStatus('submitting');
      const result = await markAttendance(name, studentId, email);
      setMessage(result.message);
      if (result.success) {
        setStatus('success');
        if (!bypassRestrictions) localStorage.setItem(DEVICE_LOCK_KEY, Date.now().toString());
      } else {
        setStatus('error');
      }
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
     <div className="text-center py-12 px-4 animate-in fade-in">
        <div className="bg-gray-100 rounded-full p-4 w-20 h-20 mx-auto mb-4 flex items-center justify-center"> <LockClosedIcon className="w-10 h-10 text-gray-400" /> </div>
        <h3 className="text-xl font-black text-gray-800 mb-2">Device Already Used</h3>
        <p className="text-sm text-gray-600">Attendance submitted from this device.</p>
     </div>
  );

  if (status === 'validating' || status === 'submitting') return <div className="text-center py-12"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-primary mx-auto"></div><p className="mt-4 text-gray-500 font-bold tracking-tight">{status === 'submitting' ? 'RECORDING...' : 'VERIFYING...'}</p></div>;
  if (status === 'validating-gps') return <div className="text-center py-12"><MapPinIcon className="w-12 h-12 text-brand-primary mx-auto animate-bounce" /><p className="mt-4 text-gray-500 font-bold">CHECKING GPS...</p></div>;

  return (
    <div className="relative">
        {bypassRestrictions && onExit && ( <button onClick={onExit} className="absolute -top-2 -right-2 text-xs text-gray-400 hover:text-gray-600 p-2">✕ Exit</button> )}

        {status === 'form' && (
            <form onSubmit={handleSubmit} className="space-y-4">
                <div className="text-center mb-4">
                    <h3 className="text-xl font-black text-gray-800 tracking-tight">Student Details</h3>
                    <div className="flex flex-col items-center gap-1 mt-2">
                        <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-green-50 text-green-700 rounded-full text-[10px] font-bold border border-green-200"><CheckCircleIcon className="w-3.5 h-3.5" /><span>Secure Link Verified</span></div>
                        {geoConstraints && (<div className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-[10px] font-bold border border-blue-200"><MapPinIcon className="w-3.5 h-3.5" /><span>Location Verified</span></div>)}
                    </div>
                </div>

                {courseName && (
                    <div className="bg-brand-primary/5 border border-brand-primary/10 rounded-lg p-3 text-center">
                        <p className="text-[10px] font-bold text-brand-primary uppercase tracking-widest mb-0.5">Session</p>
                        <p className="text-sm text-gray-900 font-bold truncate">{decodeURIComponent(courseName)}</p>
                    </div>
                )}
                
                <div className="space-y-3">
                    <div>
                        <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">Student ID</label>
                        <input type="text" value={studentId} placeholder="FIA..." onChange={handleStudentIdChange} className="block w-full bg-gray-50 border-2 border-gray-100 focus:border-brand-primary rounded-xl py-3 px-4 text-gray-900 uppercase font-mono font-black transition-all" required />
                    </div>
                    <div>
                        <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">Full Name</label>
                        <input type="text" value={name} placeholder="NAME ON IC" onChange={(e) => setName(e.target.value.toUpperCase())} readOnly={!isNewStudent && name.length > 0} className={`block w-full border-2 rounded-xl py-3 px-4 text-gray-900 uppercase font-bold transition-all ${!isNewStudent && name.length > 0 ? 'bg-gray-100 border-transparent text-gray-500' : 'bg-gray-50 border-gray-100 focus:border-brand-primary'}`} required />
                    </div>
                    <div>
                        <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">University Email</label>
                        <input type="email" value={email} readOnly className="block w-full bg-gray-100 border-transparent rounded-xl py-3 px-4 text-gray-400 uppercase font-medium" />
                    </div>
                </div>
                
                {formError && <p className="text-xs text-red-500 font-bold text-center bg-red-50 py-2 rounded-lg">{formError}</p>}
                
                <button type="submit" className="w-full py-4 px-4 rounded-xl shadow-lg shadow-brand-primary/20 text-sm font-black text-white bg-brand-primary hover:bg-brand-secondary active:scale-[0.98] transition-all mt-2">
                    {isOfflineScan ? 'GENERATE MY QR' : 'SUBMIT ATTENDANCE'}
                </button>
            </form>
        )}

        {status === 'show-student-qr' && (
            <div className="text-center py-4 animate-in zoom-in duration-300">
                <h3 className="text-lg font-black text-gray-800 mb-2">Your Personal QR</h3>
                <p className="text-xs text-gray-500 mb-4">Show this to the lecturer for scanning.</p>
                <div className="bg-white p-4 rounded-2xl shadow-inner border-2 border-dashed border-brand-primary/20 flex items-center justify-center mx-auto">
                    <canvas ref={canvasRef} className="max-w-full" />
                </div>
                <div className="mt-6 p-4 bg-indigo-50 rounded-xl border border-indigo-100">
                    <p className="font-bold text-indigo-900">{name}</p>
                    <p className="text-xs font-mono text-indigo-600 mt-1">{studentId}</p>
                </div>
                <button onClick={() => setStatus('form')} className="mt-6 text-sm font-bold text-brand-primary hover:underline">Edit Details</button>
            </div>
        )}

        {(status === 'success' || status === 'error') && (
            <div className="text-center py-10 animate-in fade-in">
                <div className={`mx-auto flex items-center justify-center h-24 w-24 rounded-full ${status === 'success' ? 'bg-green-100' : 'bg-red-100'} mb-6 shadow-sm`}>
                    {status === 'success' ? <CheckCircleIcon className="h-14 w-14 text-green-600" /> : <p className="text-5xl">😟</p>}
                </div>
                <h3 className={`text-3xl font-black ${status === 'success' ? 'text-green-800' : 'text-red-600'} mb-2`}>
                    {status === 'success' ? 'Verified!' : 'Failed'}
                </h3>
                <p className="text-sm font-bold text-gray-500 mb-4">{message}</p>
                {status === 'success' && courseName && (
                   <p className="text-xs text-gray-400 font-medium">Session: {decodeURIComponent(courseName)}</p>
                )}
            </div>
        )}
    </div>
  );
};
