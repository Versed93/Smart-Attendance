import React, { useState, useEffect, useRef, useMemo } from 'react';
import QRCode from 'qrcode';
import { CheckCircleIcon } from './icons/CheckCircleIcon';
import { LockClosedIcon } from './icons/LockClosedIcon';
import { ExclamationTriangleIcon } from './icons/ExclamationTriangleIcon';
import { QrScanner } from './QrScanner';
import { CameraIcon } from './icons/CameraIcon';
import { BrandLogoIcon } from './icons/BrandLogoIcon';
import { HistoryIcon } from './icons/HistoryIcon';
import { TrashIcon } from './icons/TrashIcon';
import { MapPinIcon } from './icons/MapPinIcon';
import { PWAInstallButton } from './PWAInstallButton';
import type { PreRegisteredStudent } from '../studentList';

const QR_REFRESH_INTERVAL = 15;

export interface ScanHistory {
  id: string;
  courseName: string;
  timestamp: number;
  type: 'online' | 'offline';
  qrData?: string;
}

interface StudentViewProps {
  markAttendance: (
    name: string,
    studentId: string,
    email: string,
    week?: string,
    courseName?: string,
    courseId?: string,
    checkinToken?: string,
    pin?: string
  ) => Promise<{ success: boolean; message: string; code?: string }>;
  token: string;
  qrSig?: string;
  pinRequired?: boolean;
  courseName?: string;
  courseId?: string;
  week?: string;
  geoConstraints?: { lat: number; lng: number; radius: number };
  bypassRestrictions?: boolean;
  isOfflineScan?: boolean;
  isDemoMode?: boolean;
  knownStudents: PreRegisteredStudent[];
  onSwitchToTeacher?: () => void;
  onSessionScanned?: (session: { courseName?: string; courseId?: string; week?: string; checkinToken?: string }) => void;
}

type Status = 'landing' | 'validating' | 'validating-gps' | 'gps-prompt' | 'form' | 'submitting' | 'success' | 'error' | 'show-student-qr' | 'device-locked' | 'checking-firebase' | 'history';

const STUDENT_PROFILE_KEY = 'attendance-student-profile-v1';
const STUDENT_HISTORY_KEY = 'attendance-student-history-v1';
const getSessionDateId = () => new Date().toISOString().slice(0, 10);

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

const isIosDevice = () => {
  if (typeof navigator === 'undefined') return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
};

export const StudentView: React.FC<StudentViewProps> = ({ 
  markAttendance, 
  token: initialToken, 
  qrSig: initialQrSig = '',
  pinRequired: initialPinRequired = false,
  courseName: initialCourseName, 
  courseId: initialCourseId,
  week: initialWeek,
  geoConstraints: initialGeoConstraints, 
  bypassRestrictions = false, 
  isOfflineScan: initialIsOfflineScan = false,
  isDemoMode = false,
  knownStudents,
  onSwitchToTeacher,
  onSessionScanned,
}) => {
  const [name, setName] = useState('');
  const [studentId, setStudentId] = useState('');
  const [status, setStatus] = useState<Status>('validating');
  const [message, setMessage] = useState('');
  const [gpsErrorCode, setGpsErrorCode] = useState<number | null>(null);
  const [formError, setFormError] = useState('');
  const [studentQrData, setStudentQrData] = useState('');
  const [showScanner, setShowScanner] = useState(false);
  const [isQrLoading, setIsQrLoading] = useState(false);
  const [qrRefreshSeconds, setQrRefreshSeconds] = useState(QR_REFRESH_INTERVAL);
  const [token, setToken] = useState(initialToken);
  const [qrSig, setQrSig] = useState(initialQrSig);
  const [checkinToken, setCheckinToken] = useState('');
  const [pinRequired, setPinRequired] = useState(initialPinRequired);
  const [classroomPinInput, setClassroomPinInput] = useState('');
  const [courseName, setCourseName] = useState(initialCourseName);
  const [courseId, setCourseId] = useState(initialCourseId);
  const [scannedWeek, setScannedWeek] = useState(initialWeek);
  const [geoConstraints, setGeoConstraints] = useState(initialGeoConstraints);
  const [isOfflineScan, setIsOfflineScan] = useState(initialIsOfflineScan);
  const [history, setHistory] = useState<ScanHistory[]>(() => {
    if (isDemoMode) return [];
    try {
      const saved = localStorage.getItem(STUDENT_HISTORY_KEY);
      const parsed = saved ? JSON.parse(saved) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const autoFillRef = useRef<{ id?: string; name?: string }>({});
  const courseNameRef = useRef<string | undefined>(courseName);
  const courseIdRef = useRef<string | undefined>(courseId);
  const scannedWeekRef = useRef<string | undefined>(scannedWeek);
  const [activeSuggestionField, setActiveSuggestionField] = useState<'id' | 'name' | null>(null);

  useEffect(() => {
    courseNameRef.current = courseName;
  }, [courseName]);

  useEffect(() => {
    courseIdRef.current = courseId;
  }, [courseId]);

  useEffect(() => {
    scannedWeekRef.current = scannedWeek;
  }, [scannedWeek]);

  const normalizeId = (val: string) => val.trim().replace(/\s+/g, '').toUpperCase();
  const normalizeName = (val: string) => val.trim().replace(/\s+/g, ' ').toUpperCase();
  
  useEffect(() => {
    if (!isDemoMode) {
      localStorage.removeItem(STUDENT_PROFILE_KEY);
    }
  }, [isDemoMode]);

  const requestGpsVerification = React.useCallback((constraints: { lat: number; lng: number; radius: number }) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGpsErrorCode(0);
      setStatus('gps-prompt');
      return;
    }

    setStatus('validating-gps');
    setGpsErrorCode(null);

    const handleGpsSuccess = (pos: GeolocationPosition) => {
      const dist = getDistanceFromLatLonInM(constraints.lat, constraints.lng, pos.coords.latitude, pos.coords.longitude);
      if (dist - pos.coords.accuracy <= constraints.radius) {
        setStatus('form');
      } else {
        setStatus('error');
        setMessage(`Location Mismatch: ${Math.round(dist)}m away. Move closer to the classroom.`);
      }
    };

    const handleGpsFailure = (err: GeolocationPositionError | null) => {
      setGpsErrorCode(err?.code ?? 1);
      setStatus('gps-prompt');
    };

    navigator.geolocation.getCurrentPosition(
      handleGpsSuccess,
      (err) => {
        if (err && (err.code === 2 || err.code === 3)) {
          navigator.geolocation.getCurrentPosition(
            handleGpsSuccess,
            (fallbackErr) => handleGpsFailure(fallbackErr),
            { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
          );
          return;
        }
        handleGpsFailure(err);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    const checkStatus = async () => {
        await Promise.resolve();
        if (cancelled) return;

        if (!token) {
            setStatus('landing');
            return;
        }

        const lockCourse = courseNameRef.current || 'general';
        const lockKey = `attendance-device-lock-v1-${getSessionDateId()}-${lockCourse}`;
        
        if (!bypassRestrictions && !isDemoMode && localStorage.getItem(lockKey)) {
          setStatus('device-locked');
          return;
        }

        if (!bypassRestrictions && !isOfflineScan && !isDemoMode) {
          try {
            const res = await fetch('/api/qr/verify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                sig: qrSig,
                t: token,
                courseName: courseNameRef.current || '',
                courseId: courseIdRef.current || '',
                week: scannedWeekRef.current || '',
              }),
            });
            const data = await res.json().catch(() => null);
            if (cancelled) return;
            if (!res.ok || !data?.success || !data?.checkinToken) {
              setCheckinToken('');
              setStatus('error');
              setMessage(data?.message || 'QR Code expired (15s limit). Scan the newest live code in class.');
              return;
            }
            setCheckinToken(data.checkinToken);
            setPinRequired(Boolean(data.pinRequired));
            if (data.courseName) {
              courseNameRef.current = data.courseName;
              setCourseName(data.courseName);
            }
            if (data.courseId) {
              courseIdRef.current = data.courseId;
              setCourseId(data.courseId);
            }
            if (data.week) {
              scannedWeekRef.current = data.week;
              setScannedWeek(data.week);
            }
            onSessionScanned?.({
              courseName: data.courseName || courseNameRef.current || undefined,
              courseId: data.courseId || courseIdRef.current || undefined,
              week: data.week || scannedWeekRef.current || undefined,
              checkinToken: data.checkinToken,
            });
          } catch {
            if (cancelled) return;
            setStatus('error');
            setMessage('Could not verify QR code with server. Please scan again.');
            return;
          }
        }

        if (geoConstraints && !bypassRestrictions) {
            requestGpsVerification(geoConstraints);
        } else {
            setStatus('form');
        }
    };

    void checkStatus();
    return () => { cancelled = true; };
  }, [bypassRestrictions, geoConstraints, isDemoMode, isOfflineScan, onSessionScanned, qrSig, requestGpsVerification, token]);

  useEffect(() => {
    if (status === 'show-student-qr' && canvasRef.current && studentQrData) {
        QRCode.toCanvas(canvasRef.current, studentQrData, { width: 220, margin: 2 }, (err) => {
            if (err) console.error(err);
            setIsQrLoading(false);
        });
    }
  }, [status, studentQrData]);

  useEffect(() => {
    if (status !== 'show-student-qr') return;

    const resetTimer = setTimeout(() => {
      setQrRefreshSeconds(QR_REFRESH_INTERVAL);
    }, 0);

    const interval = setInterval(() => {
      setQrRefreshSeconds((prev) => {
        if (prev <= 1) {
          setStudentQrData((currentData) => {
            try {
              const parsed = JSON.parse(currentData);
              return JSON.stringify({ ...parsed, timestamp: Date.now() });
            } catch {
              return JSON.stringify({
                name,
                studentId,
                email: `${studentId}@student.edu.my`,
                timestamp: Date.now(),
              });
            }
          });
          return QR_REFRESH_INTERVAL;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      clearTimeout(resetTimer);
      clearInterval(interval);
    };
  }, [status, name, studentId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = normalizeName(name);
    const cleanId = normalizeId(studentId);
    if (!cleanName || !cleanId) { setFormError('All fields required.'); return; }

    const registeredMatches = knownStudents.filter(
      (s) => normalizeName(s.name) === cleanName
    );
    if (registeredMatches.length === 0) {
      setFormError('Your name is not registered in the system. Please consult with your Lecturer.');
      return;
    }

    const exactIdMatch = registeredMatches.some(
      (s) => normalizeId(s.id) === cleanId
    );
    if (!exactIdMatch) {
      setFormError('Warning: Student ID does not match the registered student name. Please verify your details.');
      return;
    }
    
    const addHistory = (entry: Omit<ScanHistory, 'id'>) => {
      const newHistory = [{ ...entry, id: Date.now().toString() }, ...history];
      setHistory(newHistory);
      if (!isDemoMode) {
        localStorage.setItem(STUDENT_HISTORY_KEY, JSON.stringify(newHistory));
      }
    };

    if (isOfflineScan) {
        setIsQrLoading(true);
        const qrData = JSON.stringify({ name: cleanName, studentId: cleanId, email: `${cleanId}@student.edu.my`, timestamp: Date.now() });
        setStudentQrData(qrData);
        addHistory({ courseName: courseName || 'Offline Check-in', timestamp: Date.now(), type: 'offline', qrData });
        setStatus('show-student-qr');
        return;
    }

    if (pinRequired && !bypassRestrictions && !isOfflineScan) {
      const cleanPin = classroomPinInput.replace(/\D/g, '').slice(0, 4);
      if (cleanPin.length !== 4) {
        setFormError('Enter the 4-digit Classroom PIN from your lecturer.');
        return;
      }
    }

    setStatus('submitting');
    const result = await markAttendance(
      cleanName,
      cleanId,
      `${cleanId}@student.edu.my`,
      scannedWeek,
      courseName,
      courseId,
      checkinToken || undefined,
      pinRequired && !bypassRestrictions ? classroomPinInput.trim() : undefined
    );
    if (result.success) {
      setStatus('success');
      setClassroomPinInput('');
      setCheckinToken('');
      addHistory({ courseName: courseName || 'General Session', timestamp: Date.now(), type: 'online' });
      const lockKey = `attendance-device-lock-v1-${getSessionDateId()}-${courseName || 'general'}`;
      if (!bypassRestrictions && !isDemoMode) localStorage.setItem(lockKey, 'true');
    } else if (result.message === "You have already checked in for this session." || result.message === "Attendance already recorded for this student ID.") {
      setStatus('device-locked');
      const lockKey = `attendance-device-lock-v1-${getSessionDateId()}-${courseName || 'general'}`;
      if (!bypassRestrictions && !isDemoMode) localStorage.setItem(lockKey, 'true');
    } else if (
      result.code === 'INVALID_PIN' ||
      result.message.toLowerCase().includes('pin') ||
      result.message.toLowerCase().includes('not registered') ||
      result.message.toLowerCase().includes('does not match')
    ) {
      setFormError(result.message);
      setStatus('form');
    } else {
      setStatus('error');
      setMessage(result.message);
    }
  };

  const matchedStudent = useMemo(() => {
    const cleanId = normalizeId(studentId);
    const cleanName = normalizeName(name);
    if (!cleanId || !cleanName) return undefined;
    return knownStudents.find(
      (s) => normalizeId(s.id) === cleanId && normalizeName(s.name) === cleanName
    );
  }, [knownStudents, studentId, name]);

  const isNameRegistered = useMemo(() => {
    const cleanName = normalizeName(name);
    if (!cleanName) return false;
    return knownStudents.some((s) => normalizeName(s.name) === cleanName);
  }, [knownStudents, name]);

  const showUnregisteredNameWarning = useMemo(() => {
    const cleanName = normalizeName(name);
    if (cleanName.length < 3 || isNameRegistered) return false;
    if (activeSuggestionField === 'name') {
      return !knownStudents.some((s) => normalizeName(s.name).includes(cleanName));
    }
    return true;
  }, [knownStudents, name, isNameRegistered, activeSuggestionField]);

  const idSuggestions = useMemo(() => {
    const query = normalizeId(studentId);
    if (activeSuggestionField !== 'id' || query.length < 2) return [];
    return knownStudents
      .filter((s) => {
        const sId = normalizeId(s.id);
        return sId.includes(query) && sId !== query;
      })
      .sort((a, b) => {
        const aStarts = normalizeId(a.id).startsWith(query) ? 0 : 1;
        const bStarts = normalizeId(b.id).startsWith(query) ? 0 : 1;
        return aStarts - bStarts || a.id.localeCompare(b.id);
      })
      .slice(0, 6);
  }, [knownStudents, studentId, activeSuggestionField]);

  const nameSuggestions = useMemo(() => {
    const query = normalizeName(name);
    if (activeSuggestionField !== 'name' || query.length < 2) return [];
    const tokens = query.split(' ').filter(Boolean);
    return knownStudents
      .filter((s) => {
        const sName = normalizeName(s.name);
        if (sName === query && normalizeId(s.id) === normalizeId(studentId)) return false;
        return tokens.every((t) => sName.includes(t));
      })
      .sort((a, b) => {
        const aStarts = normalizeName(a.name).startsWith(query) ? 0 : 1;
        const bStarts = normalizeName(b.name).startsWith(query) ? 0 : 1;
        return aStarts - bStarts || a.name.localeCompare(b.name);
      })
      .slice(0, 6);
  }, [knownStudents, name, studentId, activeSuggestionField]);

  const selectSuggestedStudent = (student: PreRegisteredStudent) => {
    const cleanId = student.id.toUpperCase();
    const cleanName = student.name.toUpperCase();
    setStudentId(cleanId);
    setName(cleanName);
    autoFillRef.current = { id: cleanId, name: cleanName };
    setFormError('');
    setActiveSuggestionField(null);
  };

  const handleIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = normalizeId(e.target.value);
    setStudentId(val);
    setFormError('');
    setActiveSuggestionField(val.length >= 2 ? 'id' : null);

    const matched = knownStudents.find((s) => normalizeId(s.id) === val);
    if (matched) {
      const cleanId = matched.id.toUpperCase();
      const cleanName = matched.name.toUpperCase();
      setStudentId(cleanId);
      setName(cleanName);
      autoFillRef.current = { id: cleanId, name: cleanName };
      setFormError('');
      setActiveSuggestionField(null);
    } else {
      if (autoFillRef.current.name && normalizeName(name) === normalizeName(autoFillRef.current.name)) {
        setName('');
      }
      autoFillRef.current = {};
    }
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawUpper = e.target.value.toUpperCase();
    setName(rawUpper);
    setFormError('');
    const norm = normalizeName(rawUpper);
    setActiveSuggestionField(norm.length >= 2 ? 'name' : null);

    const exactMatches = norm
      ? knownStudents.filter((s) => normalizeName(s.name) === norm)
      : [];
    if (exactMatches.length === 1) {
      const matched = exactMatches[0];
      const cleanId = matched.id.toUpperCase();
      const cleanName = matched.name.toUpperCase();
      setStudentId(cleanId);
      autoFillRef.current = { id: cleanId, name: cleanName };
      setFormError('');
      setActiveSuggestionField(null);
    } else {
      if (autoFillRef.current.id && normalizeId(studentId) === normalizeId(autoFillRef.current.id)) {
        setStudentId('');
      }
      autoFillRef.current = {};
    }
  };

  const handleScanJoin = (data: string) => {
      setShowScanner(false);
      try {
          const url = new URL(data);
          const t = url.searchParams.get('t');
          const sig = url.searchParams.get('sig') || '';
          const pinFlag = url.searchParams.get('pin') === '1';
          const c = url.searchParams.get('c');
          const cid = url.searchParams.get('cid');
          const w = url.searchParams.get('w');
          const lat = url.searchParams.get('lat');
          const lng = url.searchParams.get('lng');
          const rad = url.searchParams.get('rad');
          const offline = url.searchParams.get('offline') === 'true';
          if (t && (sig || offline)) {
              setName('');
              setStudentId('');
              setFormError('');
              setClassroomPinInput('');
              setCheckinToken('');
              autoFillRef.current = {};
              setActiveSuggestionField(null);
              courseNameRef.current = c || undefined;
              courseIdRef.current = cid || undefined;
              scannedWeekRef.current = w || undefined;
              setQrSig(sig);
              setPinRequired(pinFlag);
              setToken(t);
              if (c) setCourseName(c);
              if (cid) setCourseId(cid);
              if (w) setScannedWeek(w);
              onSessionScanned?.({
                courseName: c || undefined,
                courseId: cid || undefined,
                week: w || undefined,
              });
              setIsOfflineScan(offline);
              if (lat && lng && !isNaN(parseFloat(lat)) && !isNaN(parseFloat(lng))) {
                setGeoConstraints({
                  lat: parseFloat(lat),
                  lng: parseFloat(lng),
                  radius: rad && !isNaN(parseFloat(rad)) ? parseFloat(rad) : 150,
                });
              } else {
                setGeoConstraints(undefined);
              }
              setStatus('validating');
          } else {
              setStatus('error');
              setMessage('Unverified or invalid session QR. Scan the live QR code in class.');
          }
      } catch {
          setStatus('error');
          setMessage('Invalid QR format. Please scan the official attendance code.');
      }
  };

  const handleDeleteHistory = (id: string) => {
    const newHistory = history.filter(h => h.id !== id);
    setHistory(newHistory);
    if (!isDemoMode) {
      localStorage.setItem(STUDENT_HISTORY_KEY, JSON.stringify(newHistory));
    }
  };

  if (status === 'landing') {
      return (
          <div className="text-center space-y-8 animate-in fade-in duration-500 py-4">
              <div className="flex flex-col items-center">
                  <div className="w-16 h-16 bg-brand-primary text-white rounded-2xl flex items-center justify-center shadow-xl shadow-brand-primary/10 mb-4 relative">
                      <BrandLogoIcon className="w-10 h-10" />
                  </div>
                  <h1 className="text-3xl font-bold text-gray-900 tracking-tight leading-tight">Attendance Portal</h1>
                  <p className="text-[10px] font-bold text-gray-400 mt-2 uppercase tracking-[0.3em]">Access Point</p>
              </div>

              <div className="space-y-4">
                  {/* MAIN ACTION: Student Scan (Now a bit smaller) */}
                  <button 
                      onClick={() => setShowScanner(true)}
                      className="w-full bg-indigo-600 text-white font-bold py-4 rounded-2xl hover:bg-black active:scale-95 transition-all shadow-xl shadow-indigo-100 flex items-center justify-center gap-3 uppercase tracking-[0.1em] text-xs"
                  >
                      <CameraIcon className="w-5 h-5" />
                      Scan Attendance QR
                  </button>

                  <div className="flex items-center gap-4 py-1">
                      <div className="h-[1px] flex-1 bg-gray-100"></div>
                      <span className="text-[9px] font-bold text-gray-300 uppercase tracking-widest">or</span>
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

                  <div className="empty:hidden">
                      <PWAInstallButton variant="card" />
                  </div>
              </div>

              <div className="bg-gray-50 border border-gray-100 p-5 rounded-2xl">
                  <p className="text-[9px] text-gray-400 font-bold leading-relaxed uppercase tracking-widest text-center opacity-70">
                      Authorized Credentials Required
                  </p>
              </div>

              {showScanner && <QrScanner onScan={handleScanJoin} onClose={() => setShowScanner(false)} />}
          </div>
      );
  }

  if (status === 'history') {
    return (
      <div className="animate-in fade-in duration-300 py-4">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-gray-900 tracking-tight">Previous Scans</h2>
          <button onClick={() => setStatus('landing')} className="text-xs font-bold text-indigo-600 uppercase tracking-widest hover:text-indigo-800">Back</button>
        </div>
        
        {history.length === 0 ? (
          <div className="text-center py-12 bg-gray-50 rounded-2xl border border-gray-100">
            <HistoryIcon className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-sm font-bold text-gray-500 uppercase tracking-widest">No previous scans found</p>
          </div>
        ) : (
          <div className="space-y-3">
            {history.map((entry) => (
              <div key={entry.id} className="bg-white border border-gray-200 p-4 rounded-xl shadow-sm flex items-center justify-between">
                <div>
                  <p className="font-bold text-gray-900 text-sm">{entry.courseName}</p>
                  <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest mt-1">
                    {new Date(entry.timestamp).toLocaleString()}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {entry.type === 'offline' && entry.qrData ? (
                    <button 
                      onClick={() => {
                        setStudentQrData(entry.qrData!);
                        setStatus('show-student-qr');
                      }}
                      className="bg-indigo-50 text-indigo-600 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-indigo-100 transition-colors"
                    >
                      View QR
                    </button>
                  ) : (
                    <span className="bg-green-50 text-green-600 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest">
                      Online
                    </span>
                  )}
                  <button 
                    onClick={() => handleDeleteHistory(entry.id)}
                    className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"
                    title="Delete Record"
                  >
                    <TrashIcon className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (status === 'device-locked') {
    return (
      <div className="text-center py-10 animate-in zoom-in duration-300">
        <div className="w-20 h-20 bg-green-50 text-green-500 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-sm"><CheckCircleIcon className="w-12 h-12" /></div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Record Verified</h2>
        <p className="text-sm text-gray-400 font-bold uppercase tracking-widest mb-8">Attendance already recorded</p>
        <div className="bg-gray-50 border border-gray-100 p-6 rounded-2xl">
             <p className="text-xs font-bold text-gray-500 leading-relaxed uppercase tracking-tight">One submission is permitted per student per session. Please see your lecturer if you believe this is an error.</p>
        </div>
        <button onClick={() => window.location.reload()} className="mt-8 text-xs font-bold text-brand-primary uppercase tracking-widest">Refresh Status</button>
      </div>
    );
  }

  if (status === 'validating' || status === 'validating-gps' || status === 'checking-firebase') {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="w-16 h-16 border-4 border-brand-primary border-t-transparent rounded-full animate-spin mb-6"></div>
        <p className="text-sm font-bold text-gray-900 uppercase tracking-widest">
            {status === 'validating-gps' ? 'Verifying Proximity...' : 
             status === 'checking-firebase' ? 'Retrieving Records...' : 
             'Securing Session...'}
        </p>
        <p className="text-xs text-gray-400 font-bold mt-2 uppercase">Please wait a moment</p>
      </div>
    );
  }

  if (status === 'gps-prompt') {
    const ios = isIosDevice();
    return (
      <div className="text-center py-8 animate-in fade-in duration-300">
        <div className="w-20 h-20 bg-amber-50 text-amber-600 rounded-3xl flex items-center justify-center mx-auto mb-5 border border-amber-100">
          <MapPinIcon className="w-11 h-11" />
        </div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Turn On &amp; Allow GPS</h2>
        <p className="text-xs text-gray-500 font-bold mb-6 px-2 leading-relaxed">
          {gpsErrorCode === 1
            ? 'Location permission is required to verify that you are in the classroom. Please turn on Location / GPS and allow access.'
            : 'Unable to detect your GPS signal. Please make sure Location / GPS is turned on and allow browser access.'}
        </p>

        <div className="bg-amber-50/70 border border-amber-200 rounded-2xl p-4 text-left mb-6 space-y-2">
          <p className="text-[11px] font-extrabold text-amber-900 uppercase tracking-wider">
            {ios ? 'How to enable GPS on iPhone:' : 'How to enable GPS:'}
          </p>
          {ios ? (
            <ol className="text-xs text-amber-900/90 font-semibold space-y-1.5 list-decimal list-inside">
              <li>Open <b>Settings → Privacy &amp; Security → Location Services</b> and turn it <b>ON</b>.</li>
              <li>Scroll down to <b>Safari Websites</b> (or your browser) and choose <b>While Using the App</b>.</li>
              <li>In Safari, tap <b>aA</b> / lock icon in the address bar → <b>Website Settings → Location → Allow</b>.</li>
            </ol>
          ) : (
            <ol className="text-xs text-amber-900/90 font-semibold space-y-1.5 list-decimal list-inside">
              <li>Turn on <b>Location (GPS)</b> in your phone&apos;s Quick Settings.</li>
              <li>Tap <b>Allow GPS &amp; Continue</b> below and select <b>Allow</b> on the popup.</li>
            </ol>
          )}
        </div>

        <button
          type="button"
          onClick={() => {
            if (geoConstraints) {
              requestGpsVerification(geoConstraints);
            } else {
              setStatus('form');
            }
          }}
          className="w-full bg-indigo-600 text-white font-bold py-4 rounded-xl hover:bg-indigo-700 transition-all active:scale-95 shadow-lg uppercase tracking-widest text-xs mb-3"
        >
          Allow GPS &amp; Continue
        </button>

        <button
          type="button"
          onClick={() => {
            window.history.replaceState({}, '', window.location.pathname);
            setToken('');
            setStatus('landing');
          }}
          className="text-xs font-bold text-gray-400 hover:text-gray-700 uppercase tracking-widest mt-2"
        >
          Back to Home
        </button>
      </div>
    );
  }

  if (status === 'success') {
    return (
      <div className="text-center py-10 animate-in zoom-in duration-300">
        <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-6"><CheckCircleIcon className="w-12 h-12" /></div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Check-in Complete</h2>
        <p className="text-sm text-gray-500 font-bold mb-8 px-4">Thank you, <b>{name}</b>. Your attendance for <b>{courseName || 'this session'}</b> has been successfully recorded.</p>
        <button
          type="button"
          onClick={() => {
            window.history.replaceState({}, '', window.location.pathname);
            setName('');
            setStudentId('');
            setFormError('');
            setToken('');
            setStatus('landing');
          }}
          className="w-full bg-gray-900 text-white font-bold py-4 rounded-xl hover:bg-black transition-all active:scale-95 shadow-lg uppercase tracking-widest text-xs"
        >
          Finish
        </button>
      </div>
    );
  }

  if (status === 'show-student-qr') {
    const radius = 22;
    const circumference = 2 * Math.PI * radius;
    const strokeDashoffset = circumference * (1 - qrRefreshSeconds / QR_REFRESH_INTERVAL);

    return (
        <div className="text-center py-6">
            <h2 className="text-xl font-bold text-gray-900 mb-2">Check-in Token</h2>
            <p className="text-xs text-gray-400 font-bold uppercase tracking-widest mb-6">Show this to your lecturer</p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-8">
                <div className="bg-white p-3 rounded-3xl border-4 border-gray-100 relative min-h-[228px] min-w-[228px] sm:min-h-[244px] sm:min-w-[244px] flex items-center justify-center shadow-sm">
                    {isQrLoading && <div className="absolute inset-0 flex items-center justify-center bg-white/80 z-10 rounded-xl"><div className="animate-spin h-8 w-8 border-4 border-indigo-600 border-t-transparent rounded-full"></div></div>}
                    <canvas ref={canvasRef} className="rounded-xl" />
                </div>
                <div
                  className="bg-indigo-50/80 border border-indigo-100 rounded-2xl px-4 py-3 flex sm:flex-col items-center justify-center gap-3 sm:gap-2 w-full max-w-[228px] sm:w-auto sm:min-w-[104px] shadow-sm"
                  aria-live="polite"
                  title={`QR code refreshes in ${qrRefreshSeconds} seconds`}
                >
                  <div className="relative w-14 h-14 flex items-center justify-center">
                    <svg className="w-14 h-14 -rotate-90" viewBox="0 0 56 56">
                      <circle
                        cx="28"
                        cy="28"
                        r={radius}
                        fill="none"
                        stroke="#e0e7ff"
                        strokeWidth="4.5"
                      />
                      <circle
                        cx="28"
                        cy="28"
                        r={radius}
                        fill="none"
                        stroke="#4f46e5"
                        strokeWidth="4.5"
                        strokeLinecap="round"
                        strokeDasharray={circumference}
                        strokeDashoffset={strokeDashoffset}
                        className="transition-all duration-1000 ease-linear"
                      />
                    </svg>
                    <span className="absolute text-sm font-black text-indigo-700 tabular-nums">
                      {qrRefreshSeconds}s
                    </span>
                  </div>
                  <div className="text-left sm:text-center">
                    <div className="flex items-center justify-start sm:justify-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                      <span className="text-[10px] font-bold text-indigo-900 uppercase tracking-wider">Refresh</span>
                    </div>
                    <p className="text-[9px] font-bold text-indigo-400 uppercase tracking-tight mt-0.5">
                      Every {QR_REFRESH_INTERVAL}s
                    </p>
                  </div>
                </div>
            </div>
            <div className="space-y-3">
                <p className="text-sm font-bold text-gray-900 leading-none">{name}</p>
                <p className="text-xs font-mono font-bold text-gray-400">{studentId}</p>
            </div>
            <button onClick={() => setStatus('landing')} className="mt-10 text-xs font-bold text-brand-primary uppercase tracking-widest hover:underline">Back to Home</button>
        </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="text-center py-10">
        <div className="w-20 h-20 bg-red-50 text-red-500 rounded-3xl flex items-center justify-center mx-auto mb-6"><ExclamationTriangleIcon className="w-12 h-12" /></div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Unable to Process</h2>
        <p className="text-sm text-gray-500 font-bold mb-8 px-6">{message}</p>
        <button onClick={() => { window.history.replaceState({}, '', window.location.pathname); setToken(''); setStatus('landing'); }} className="w-full bg-red-600 text-white font-bold py-4 rounded-xl hover:bg-red-700 transition-all active:scale-95 shadow-lg uppercase tracking-widest text-xs">Try Scanning Again</button>
      </div>
    );
  }

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between mb-8">
        <div className="text-left">
          <h2 className="text-2xl font-bold text-gray-900 tracking-tight leading-none mb-2">{courseName || 'Confirm Presence'}</h2>
          <div className="flex items-center gap-2">
              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Active Verification Flow</p>
          </div>
        </div>
        <button 
          onClick={() => {
            if (bypassRestrictions) {
              setName('');
              setStudentId('');
              onSwitchToTeacher?.();
            } else {
              setName('');
              setStudentId('');
              setToken('');
              setStatus('landing');
            }
          }}
          className={`text-[10px] font-bold uppercase tracking-widest transition-colors ${bypassRestrictions ? 'text-red-600 hover:text-red-800' : 'text-indigo-600 hover:text-black'}`}
        >
          {bypassRestrictions ? 'Exit' : 'Back'}
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="relative">
          <div className="flex items-center justify-between mb-1 ml-1">
            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest">Student ID</label>
            {matchedStudent && (
              <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                ✓ Profile Auto-Filled
              </span>
            )}
          </div>
          <input 
            type="text" 
            value={studentId} 
            onChange={handleIdChange}
            onFocus={() => { if (normalizeId(studentId).length >= 2 && !matchedStudent) setActiveSuggestionField('id'); }}
            onBlur={() => setTimeout(() => setActiveSuggestionField((prev) => (prev === 'id' ? null : prev)), 150)}
            className="w-full border-2 border-gray-100 bg-gray-50 rounded-2xl p-4 font-mono font-bold uppercase focus:bg-white focus:border-indigo-600 transition-all outline-none placeholder:font-sans placeholder:text-gray-400 placeholder:text-xs placeholder:normal-case" 
            placeholder="Enter Student ID (auto-fills name)"
            required
            autoComplete="off"
          />
          {idSuggestions.length > 0 && (
            <ul className="absolute z-20 left-0 right-0 mt-1.5 bg-white border-2 border-indigo-100 rounded-2xl shadow-xl max-h-48 overflow-y-auto divide-y divide-gray-50">
              {idSuggestions.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      selectSuggestedStudent(s);
                    }}
                    className="w-full text-left px-4 py-2.5 hover:bg-indigo-50 transition-colors flex items-center justify-between gap-2"
                  >
                    <span className="text-xs font-bold text-gray-900 truncate">{s.name}</span>
                    <span className="text-[11px] font-mono font-bold text-indigo-600 shrink-0">{s.id}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="relative">
          <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 ml-1">Full Name</label>
          <input 
            type="text" 
            value={name} 
            onChange={handleNameChange}
            onFocus={() => { if (normalizeName(name).length >= 2 && !matchedStudent) setActiveSuggestionField('name'); }}
            onBlur={() => setTimeout(() => setActiveSuggestionField((prev) => (prev === 'name' ? null : prev)), 150)}
            className="w-full border-2 border-gray-100 bg-gray-50 rounded-2xl p-4 font-bold uppercase focus:bg-white focus:border-indigo-600 transition-all outline-none placeholder:text-gray-400 placeholder:text-xs placeholder:normal-case" 
            placeholder="Enter Full Name (auto-fills Student ID)"
            required
            autoComplete="off"
          />
          {nameSuggestions.length > 0 && (
            <ul className="absolute z-20 left-0 right-0 mt-1.5 bg-white border-2 border-indigo-100 rounded-2xl shadow-xl max-h-48 overflow-y-auto divide-y divide-gray-50">
              {nameSuggestions.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      selectSuggestedStudent(s);
                    }}
                    className="w-full text-left px-4 py-2.5 hover:bg-indigo-50 transition-colors flex items-center justify-between gap-2"
                  >
                    <span className="text-xs font-bold text-gray-900 truncate">{s.name}</span>
                    <span className="text-[11px] font-mono font-bold text-indigo-600 shrink-0">{s.id}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {pinRequired && !bypassRestrictions && !isOfflineScan && (
          <div>
            <div className="flex items-center justify-between mb-1 ml-1">
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest">Classroom PIN</label>
              <span className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                4-Digit Session Code
              </span>
            </div>
            <input
              type="text"
              inputMode="numeric"
              maxLength={4}
              value={classroomPinInput}
              onChange={(e) => {
                setClassroomPinInput(e.target.value.replace(/\D/g, '').slice(0, 4));
                setFormError('');
              }}
              placeholder="••••"
              required
              autoComplete="off"
              className="w-full border-2 border-indigo-100 bg-indigo-50/40 rounded-2xl p-4 text-center font-mono text-2xl font-black tracking-[0.45em] text-indigo-900 focus:bg-white focus:border-indigo-600 transition-all outline-none placeholder:text-gray-300 placeholder:tracking-[0.45em] tabular-nums"
            />
          </div>
        )}

        <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100 flex items-start gap-3">
            <div className="p-2 bg-white rounded-xl text-gray-400 shrink-0"><LockClosedIcon className="w-4 h-4" /></div>
            <p className="text-[10px] text-gray-400 font-bold leading-relaxed uppercase">Only registered students in this course list can submit attendance. Please ensure your ID and Name match your registered profile.</p>
        </div>

        {showUnregisteredNameWarning && !formError && (
          <p className="text-xs text-amber-700 font-bold text-center bg-amber-50 p-3 rounded-xl border border-amber-200" role="alert">
            Your name is not registered in the system. Please consult with your Lecturer.
          </p>
        )}

        {formError && (
          <p className="text-xs text-red-600 font-bold text-center bg-red-50 p-3 rounded-xl border border-red-200" role="alert">
            {formError}
          </p>
        )}

        <button 
          type="submit" 
          disabled={status === 'submitting'}
          className="w-full bg-indigo-600 text-white font-bold py-5 rounded-2xl hover:bg-black active:scale-95 transition-all shadow-xl shadow-indigo-100 disabled:opacity-50 uppercase tracking-widest text-sm flex items-center justify-center gap-2"
        >
          {status === 'submitting' ? <div className="flex items-center gap-2"><div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div><span>Processing...</span></div> : (isOfflineScan ? 'Generate Check-in Pass' : 'Submit Attendance')}
        </button>
      </form>
    </div>
  );
};
