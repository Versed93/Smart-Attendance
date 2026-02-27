
import React, { useState, useEffect, useRef, useMemo } from 'react';
import type { Student } from '../types';
import type { PreRegisteredStudent } from '../studentList';
import QRCode from 'qrcode';
import { ShieldCheckIcon } from './icons/ShieldCheckIcon';
import { PencilSquareIcon } from './icons/PencilSquareIcon';
import { CameraIcon } from './icons/CameraIcon';
import { LockClosedIcon } from './icons/LockClosedIcon';
import { QrScanner } from './QrScanner';
import { QrCodeIcon } from './icons/QrCodeIcon';
import { AdjustmentsHorizontalIcon } from './icons/AdjustmentsHorizontalIcon';
import { MagnifyingGlassIcon } from './icons/MagnifyingGlassIcon';
import { XCircleIcon } from './icons/XCircleIcon';
import { GoogleSheetIntegrationInfo } from './GoogleSheetIntegrationInfo';
import { ArrowDownTrayIcon } from './icons/ArrowDownTrayIcon';
import { CheckIcon } from './icons/CheckIcon';
import { XMarkIcon } from './icons/XMarkIcon';
import { ExclamationTriangleIcon } from './icons/ExclamationTriangleIcon';
import { PlusIcon } from './icons/PlusIcon';
import { EyeIcon } from './icons/EyeIcon';
import { TrashIcon } from './icons/TrashIcon';
import { HistoryIcon } from './icons/HistoryIcon';
import { ListBulletIcon } from './icons/ListBulletIcon';

interface TeacherViewProps {
  attendanceList: Student[];
  onRemoveStudents: (studentIds: string[], courseName: string) => void;
  onBulkStatusUpdate: (studentIds:string[], status: string, courseName: string, absenceReason?: string) => void;
  onNewSession: () => void;
  scriptUrl: string;
  onScriptUrlChange: (url: string) => void;
  onOpenKiosk: () => void;
  onManualAdd: (name: string, id: string, email: string, status: string, courseName: string, reason?: string) => Promise<{success: boolean, message: string}>;
  addStudent: (name: string, studentId: string, email: string, status: string, courseName: string, overrideTimestamp?: number, reason?: string) => Promise<{ success: boolean, message: string }>;
  onLogout: () => void;
  knownStudents: PreRegisteredStudent[];
  onSendTestRecord: (courseName: string) => Promise<{ success: boolean; message: string }>;
  onCheckPendingRecords: () => Promise<{ success: boolean; message: string; count: number }>;
  onForceSync: () => Promise<{ success: boolean; message: string; syncedCount: number; errorCount: number; total: number; }>;
  onUpdateKnownStudents: (students: PreRegisteredStudent[]) => void;
}

export const TeacherView: React.FC<TeacherViewProps> = ({ 
  attendanceList, 
  onRemoveStudents,
  onBulkStatusUpdate,
  onNewSession,
  onOpenKiosk, 
  onManualAdd,
  addStudent,
  onLogout,
  knownStudents,
  onSendTestRecord,
  onCheckPendingRecords,
  onForceSync,
  onUpdateKnownStudents,
}) => {
  const [baseUrl] = useState<string>(() => window.location.origin + window.location.pathname);
  const [qrData, setQrData] = useState<string>('');
  const [courseName, setCourseName] = useState(() => localStorage.getItem('attendance-course-name') || '');
  const [showSettingsModal, setShowSettingsModal] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<'teacher' | 'classroom'>('teacher');
  const [isOfflineMode, setIsOfflineMode] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [scanResult, setScanResult] = useState<{ type: 'success' | 'error' | 'duplicate', message: string} | null>(null);
  const [isGeoEnabled, setIsGeoEnabled] = useState(false);
  const [teacherLocation, setTeacherLocation] = useState<{lat: number, lng: number} | null>(null);
  const [locationStatus, setLocationStatus] = useState<'idle' | 'fetching' | 'success' | 'error' | 'denied'>('idle');
  const [showManualModal, setShowManualModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'attendance' | 'history'>('attendance');
  const [teacherHistory, setTeacherHistory] = useState<Student[]>(() => {
    const saved = localStorage.getItem('attendance-teacher-history-v1');
    return saved ? JSON.parse(saved) : [];
  });
  const [manualId, setManualId] = useState('');
  const [manualName, setManualName] = useState('');
  const [manualStatus, setManualStatus] = useState('P');
  const [manualReason, setManualReason] = useState('');
  const [manualError, setManualError] = useState('');
  const [manualIsNew, setManualIsNew] = useState(false);
  const [isQrLoading, setIsQrLoading] = useState(true);
  const qrErrorCorrection = (localStorage.getItem('qr-error-correction') as 'L' | 'M' | 'Q' | 'H') || 'M';
  const qrMargin = parseInt(localStorage.getItem('qr-margin') || '2', 10);
  const [listSearchTerm, setListSearchTerm] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const [confirmation, setConfirmation] = useState<{ action: 'P' | 'A' | null, count: number, reason?: string }>({ action: null, count: 0 });
  const [showNewSessionModal, setShowNewSessionModal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => localStorage.setItem('attendance-course-name', courseName), [courseName]);

  const handleScanResult = (data: string) => {
      setShowScanner(false);
      try {
        const studentData = JSON.parse(data);
        addStudent(studentData.name, studentData.studentId, studentData.email, 'P', courseName, studentData.timestamp)
            .then(result => {
                if (result.success) setScanResult({ type: 'success', message: `${studentData.name} checked-in! Thank you.` });
                else setScanResult({ type: 'duplicate', message: result.message });
            });
      } catch { setScanResult({ type: 'error', message: 'Invalid QR format.' }); }
      setTimeout(() => setScanResult(null), 2500);
  };
  
  useEffect(() => {
    const updateQR = () => {
        let params = `t=${Date.now()}`;
        if (courseName) params += `&c=${encodeURIComponent(courseName)}`;
        if (isOfflineMode) params += `&offline=true`;
        if (isGeoEnabled && teacherLocation) params += `&lat=${teacherLocation.lat.toFixed(6)}&lng=${teacherLocation.lng.toFixed(6)}&rad=150`;
        setQrData(`${baseUrl}?${params}`);
    };
    updateQR();
    const interval = setInterval(updateQR, 1000);
    return () => clearInterval(interval);
  }, [baseUrl, courseName, isGeoEnabled, teacherLocation, isOfflineMode]);

  useEffect(() => {
    if (attendanceList.length > 0) {
      const newHistory = [...attendanceList];
      // Use a timeout to avoid synchronous setState in effect
      const timer = setTimeout(() => {
        setTeacherHistory(prev => {
          const combined = [...newHistory, ...prev];
          const unique = combined.filter((item, index, self) =>
            index === self.findIndex((t) => (
              t.studentId === item.studentId && t.timestamp === item.timestamp
            ))
          ).slice(0, 200); // Keep last 200
          localStorage.setItem('attendance-teacher-history-v1', JSON.stringify(unique));
          return unique;
        });
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [attendanceList]);

  useEffect(() => {
    if (canvasRef.current && qrData) {
      QRCode.toCanvas(canvasRef.current, qrData, { 
          width: viewMode === 'classroom' ? 500 : 320,
          margin: qrMargin, 
          errorCorrectionLevel: qrErrorCorrection.toLowerCase() as 'low' | 'medium' | 'quartile' | 'high',
      }, (err) => {
        if (err) console.error(err);
        setIsQrLoading(false);
      });
    }
  }, [qrData, qrErrorCorrection, qrMargin, viewMode]);

  const stats = useMemo(() => {
      const present = attendanceList.filter(s => s.status.toUpperCase() === 'P').length;
      const absent = attendanceList.filter(s => s.status.toUpperCase() === 'A').length;
      const total = attendanceList.length;
      const pct = total > 0 ? Math.round((present / total) * 100) : 0;
      return { present, absent, total, pct };
  }, [attendanceList]);

  const filteredList = useMemo(() => {
    return attendanceList.filter(s => s.name.toLowerCase().includes(listSearchTerm.toLowerCase()) || s.studentId.toLowerCase().includes(listSearchTerm.toLowerCase()));
  }, [attendanceList, listSearchTerm]);

  const handleExportCSV = () => {
      if (filteredList.length === 0) return alert("No data to export.");
      const headers = ["Student ID", "Name", "Status", "Reason", "Timestamp", "Date", "Time"];
      const rows = [headers.join(',')];
      filteredList.forEach(s => {
          const ts = new Date(s.timestamp);
          const name = `"${s.name.replace(/"/g, '""')}"`;
          const reason = `"${(s.absenceReason || '').replace(/"/g, '""')}"`;
          rows.push([s.studentId, name, s.status, reason, s.timestamp, ts.toLocaleDateString(), ts.toLocaleTimeString()].join(','));
      });
      const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `attendance_${(courseName || 'session').toLowerCase().replace(/\s+/g, '_')}.csv`;
      link.click();
  };

  const handleMarkAll = (status: 'P' | 'A') => {
    if (filteredList.length === 0) return;
    setConfirmation({ action: status, count: filteredList.length, reason: status === 'A' ? 'Bulk update' : '' });
  };
  
  const handleNewSession = () => {
    onNewSession();
    setCourseName('');
    setShowNewSessionModal(false);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (!text) return;

      const lines = text.split(/\r?\n/);
      const newStudents: PreRegisteredStudent[] = [];
      
      lines.forEach(line => {
        const parts = line.split(',').map(p => p.trim());
        if (parts.length >= 2) {
          const id = parts[0].toUpperCase();
          const name = parts[1].toUpperCase();
          if (id && name && id !== 'ID' && id !== 'STUDENT ID') {
            newStudents.push({ id, name });
          }
        }
      });

      if (newStudents.length > 0) {
        onUpdateKnownStudents(newStudents);
        alert(`Successfully imported ${newStudents.length} students.`);
      } else {
        alert("No valid student records found. Please ensure the CSV format is: StudentID, Name");
      }
      
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    reader.readAsText(file);
  };

  const submitManualAdd = async () => {
      if (!manualId || !manualName) { setManualError('ID and Name required.'); return; }
      const result = await onManualAdd(manualName, manualId, `${manualId}@student.edu.my`, manualStatus, courseName, manualReason);
      if (result.success) { setShowManualModal(false); setManualId(''); setManualName(''); setManualError(''); } 
      else setManualError(result.message);
  };

  const handleManualIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.toUpperCase().trim();
    setManualId(val);
    const matched = knownStudents.find(s => s.id === val);
    if (matched) { setManualName(matched.name); setManualIsNew(false); setManualError(''); } 
    else { if (!manualIsNew) setManualName(''); setManualIsNew(true); }
  };

  const handleGeoToggle = (enabled: boolean) => {
    setIsGeoEnabled(enabled);
    if (enabled) {
        setLocationStatus('fetching');
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                setTeacherLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
                setLocationStatus('success');
            },
            (err) => {
                console.error("Geolocation error:", err);
                setIsGeoEnabled(false);
                setTeacherLocation(null);
                if (err.code === err.PERMISSION_DENIED) {
                    setLocationStatus('denied');
                    alert("Location access was denied. Please enable it in your browser settings to use this feature.");
                } else {
                    setLocationStatus('error');
                    alert("Could not get location. Please ensure location services are enabled.");
                }
            },
            { enableHighAccuracy: true, timeout: 10000 }
        );
    } else {
        setTeacherLocation(null);
        setLocationStatus('idle');
    }
  };

  const getStatusBadge = (status: string) => {
    const s = status.toUpperCase();
    if (s === 'P') return <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-green-100 text-green-800 border border-green-200">PRESENT</span>;
    if (s === 'A') return <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-red-100 text-red-800 border border-red-200">ABSENT</span>;
    return <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-yellow-100 text-yellow-800 border border-yellow-200">{s}</span>;
  };

  if (viewMode === 'classroom') {
    return (
        <div className="fixed inset-0 bg-gray-900/95 backdrop-blur-lg z-[100] flex flex-col items-center justify-center p-4 animate-in fade-in duration-300">
            <div className="w-full max-w-2xl text-center text-white mb-8">
                <p className="text-sm font-bold text-brand-light uppercase tracking-[0.3em] mb-2 opacity-60">Join Session</p>
                <h2 className="text-3xl sm:text-5xl font-bold mb-4 truncate px-4">{courseName || 'General Session'}</h2>
                <div className="flex items-center justify-center gap-3 bg-white/5 py-2 px-6 rounded-full border border-white/10 w-fit mx-auto">
                    <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>
                    <p className="font-mono text-xl sm:text-2xl font-bold tracking-tight">{currentTime.toLocaleTimeString([], { hour12: false })}</p>
                </div>
            </div>
            <div className="bg-white p-4 rounded-[2.5rem] shadow-2xl w-full max-w-sm sm:max-w-md aspect-square flex items-center justify-center relative border-8 border-brand-primary/10">
                 <canvas ref={canvasRef} className="max-w-full max-h-full rounded-3xl" />
            </div>
            <button onClick={() => setViewMode('teacher')} className="mt-10 bg-white/10 border border-white/20 text-white font-bold py-4 px-12 rounded-2xl hover:bg-white/20 active:scale-95 transition-all text-sm uppercase tracking-widest">Close Classroom View</button>
        </div>
    );
  }

  return (
    <div className="w-full max-w-[1600px] mx-auto p-3 sm:p-6 space-y-6 pb-24 sm:pb-6 animate-in fade-in duration-500">
       <div className="relative z-10 flex flex-col xl:flex-row justify-between items-stretch xl:items-center bg-white p-4 rounded-2xl shadow-sm border border-gray-100 gap-4">
         <div className="flex items-center gap-4">
            <div className="flex items-center justify-center w-12 h-12 bg-gradient-to-br from-brand-primary to-brand-secondary text-white rounded-2xl shadow-lg shrink-0"><ShieldCheckIcon className="w-7 h-7" /></div>
            <div className="min-w-0"><h1 className="text-xl sm:text-2xl font-black text-gray-900 tracking-tight leading-none">SMART ATTENDANCE</h1><p className="text-[10px] text-gray-400 font-bold tracking-[0.2em] mt-1.5 uppercase">Lecturer Dashboard</p></div>
         </div>
         <div className="flex items-center gap-2 overflow-x-auto pb-2 sm:pb-0 no-scrollbar w-full xl:w-auto">
            <button onClick={() => setShowNewSessionModal(true)} className="flex items-center justify-center w-11 h-11 bg-gray-900 text-white rounded-xl border border-gray-800 hover:bg-black transition-all shrink-0 active:scale-90" title="Clear Session"><PlusIcon className="w-5 h-5" /></button>
            <button onClick={() => { setShowManualModal(true); setManualId(''); setManualName(''); setManualError(''); }} className="flex items-center justify-center w-11 h-11 bg-brand-primary/5 text-brand-primary rounded-xl border-2 border-brand-primary/10 hover:bg-brand-primary/10 transition-all shrink-0 active:scale-90" title="Manual Entry"><PencilSquareIcon className="w-5 h-5" /></button>
            <button onClick={() => setShowSettingsModal(true)} className="flex items-center justify-center w-11 h-11 rounded-xl border-2 border-gray-100 bg-gray-50 text-gray-500 hover:bg-gray-100 transition-all shrink-0 active:scale-90" title="Settings"><AdjustmentsHorizontalIcon className="w-5 h-5" /></button>
            <button onClick={() => setViewMode('classroom')} className="flex group items-center gap-4 px-5 py-2.5 rounded-xl font-bold transition-all shrink-0 bg-gray-900 text-white hover:bg-black active:scale-95 shadow-lg shadow-gray-200">
                <div className="text-right hidden sm:block"><span className="block text-[9px] uppercase opacity-60 tracking-widest">Launch</span><span className="block text-xs uppercase tracking-widest">Classroom View</span></div>
                <EyeIcon className="w-5 h-5" />
            </button>
            <div className="w-[1px] h-8 bg-gray-100 mx-2 shrink-0"></div>
            <button onClick={onLogout} className="flex items-center justify-center w-11 h-11 bg-red-50 text-red-600 rounded-xl border-2 border-red-100 hover:bg-red-100 shrink-0 active:scale-90" title="Log Out"><LockClosedIcon className="w-5 h-5" /></button>
         </div>
       </div>

       <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex flex-col">
             <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Total Enrolled</span>
             <span className="text-2xl font-bold text-gray-900 tabular-nums leading-none">{stats.total}</span>
          </div>
          <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex flex-col">
             <span className="text-[10px] font-bold text-green-500 uppercase tracking-widest mb-1">Present</span>
             <span className="text-2xl font-bold text-green-600 tabular-nums leading-none">{stats.present}</span>
          </div>
          <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex flex-col">
             <span className="text-[10px] font-bold text-red-500 uppercase tracking-widest mb-1">Absent</span>
             <span className="text-2xl font-bold text-red-600 tabular-nums leading-none">{stats.absent}</span>
          </div>
          <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex flex-col">
             <span className="text-[10px] font-bold text-indigo-500 uppercase tracking-widest mb-1">Attendance Rate</span>
             <span className="text-2xl font-bold text-indigo-600 tabular-nums leading-none">{stats.pct}%</span>
          </div>
       </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 flex flex-col items-center justify-center">
            <div className="w-full text-center mb-6">
                <span className="text-[10px] font-bold text-brand-primary uppercase tracking-widest bg-brand-primary/5 px-4 py-1.5 rounded-full border border-brand-primary/10">Active Session Config</span>
                <input 
                    type="text"
                    value={courseName}
                    onChange={(e) => setCourseName(e.target.value)}
                    placeholder="Enter Course Name (e.g. CDM9999)"
                    className="text-2xl font-bold text-gray-800 text-center w-full border-none focus:ring-0 p-3 bg-transparent placeholder-gray-300 mt-2"
                />
            </div>
            <div className="mb-6 max-w-[320px] w-full aspect-square p-3 border-4 border-dashed border-gray-100 rounded-[2.5rem] relative flex items-center justify-center overflow-hidden">
                {isQrLoading && <div className="absolute inset-0 flex items-center justify-center bg-white/80 z-10"><div className="animate-spin h-8 w-8 border-4 border-brand-primary border-t-transparent rounded-full"></div></div>}
                <canvas ref={canvasRef} className="max-w-full max-h-full rounded-2xl" />
                <div className="absolute top-2 right-2 flex items-center gap-1.5 bg-green-500 text-white px-3 py-1 rounded-full text-[9px] font-bold animate-pulse"><div className="w-1.5 h-1.5 bg-white rounded-full"></div>LIVE</div>
            </div>
             <div className="flex items-center justify-center gap-3 flex-wrap">
                <button onClick={() => onOpenKiosk()} className="flex items-center gap-2.5 bg-gray-100 text-gray-700 text-[11px] font-bold uppercase px-5 py-3 rounded-xl hover:bg-gray-200 transition-all active:scale-95"><QrCodeIcon className="w-4 h-4" /> Tablet Mode</button>
                <button onClick={() => setShowScanner(true)} className="flex items-center gap-2.5 bg-indigo-600 text-white text-[11px] font-bold uppercase px-5 py-3 rounded-xl hover:bg-indigo-700 transition-all active:scale-95 shadow-lg shadow-indigo-100"><CameraIcon className="w-4 h-4" /> Scan Student</button>
            </div>
        </div>

        <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 flex flex-col">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
                <div className="flex bg-gray-100 p-1 rounded-xl shrink-0">
                    <button 
                        onClick={() => setActiveTab('attendance')}
                        className={`px-4 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all ${activeTab === 'attendance' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                    >
                        Live List
                    </button>
                    <button 
                        onClick={() => setActiveTab('history')}
                        className={`px-4 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all ${activeTab === 'history' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                    >
                        History
                    </button>
                </div>
                <div className="flex items-center gap-2 w-full">
                    <div className="relative w-full">
                        <MagnifyingGlassIcon className="w-4 h-4 text-gray-300 absolute top-1/2 left-3.5 -translate-y-1/2" />
                        <input type="text" placeholder="Search students..." value={listSearchTerm} onChange={(e) => setListSearchTerm(e.target.value)} className="w-full pl-10 pr-4 py-2.5 text-xs font-bold border-2 border-gray-50 bg-gray-50/50 rounded-xl focus:ring-0 focus:border-brand-primary focus:bg-white transition-all" />
                    </div>
                    <button onClick={handleExportCSV} className="flex items-center justify-center w-11 h-11 bg-gray-900 text-white rounded-xl shadow-lg shadow-gray-200 hover:bg-black transition-all shrink-0 active:scale-90" title="Export CSV"><ArrowDownTrayIcon className="w-4 h-4" /></button>
                </div>
            </div>

            {activeTab === 'attendance' && (
              <div className="flex items-center justify-between gap-3 mb-6 bg-brand-primary/5 p-3 rounded-2xl border border-brand-primary/10">
                  <p className="text-[10px] font-bold text-brand-primary uppercase tracking-[0.2em] ml-2">Bulk Update</p>
                  <div className="flex items-center gap-2">
                      <button onClick={() => handleMarkAll('P')} className="flex items-center gap-2 bg-white text-green-600 text-[10px] font-bold px-4 py-2 rounded-xl hover:shadow-md transition-all disabled:opacity-30 active:scale-95 uppercase border border-green-100" disabled={filteredList.length === 0}><CheckIcon className="w-3.5 h-3.5" /> All Present</button>
                      <button onClick={() => handleMarkAll('A')} className="flex items-center gap-2 bg-white text-red-600 text-[10px] font-bold px-4 py-2 rounded-xl hover:shadow-md transition-all disabled:opacity-30 active:scale-95 uppercase border border-red-100" disabled={filteredList.length === 0}><XMarkIcon className="w-3.5 h-3.5" /> All Absent</button>
                  </div>
              </div>
            )}

            <div className="overflow-y-auto h-[440px] pr-2 custom-scrollbar">
                {activeTab === 'attendance' ? (
                    filteredList.length > 0 ? (
                        <ul className="space-y-3">
                            {filteredList.map(s => (
                                <li key={s.studentId} className="flex flex-col gap-2 p-4 bg-gray-50/50 rounded-2xl border-2 border-transparent hover:border-gray-100 transition-all group">
                                    <div className="flex items-center gap-4">
                                        <input type="checkbox" checked={selectedIds.has(s.studentId)} onChange={(e) => {
                                            const next = new Set(selectedIds);
                                            if(e.target.checked) next.add(s.studentId); else next.delete(s.studentId);
                                            setSelectedIds(next);
                                        }} className="w-5 h-5 rounded-md border-2 border-gray-200 text-brand-primary focus:ring-0 transition-all cursor-pointer" />
                                        <div className="flex-1 min-w-0">
                                            <p className="font-bold text-sm text-gray-900 truncate leading-tight mb-0.5">{s.name}</p>
                                            <div className="flex items-center gap-2">
                                                <span className="text-[10px] font-mono font-bold text-gray-400 bg-white px-2 rounded-md border border-gray-100">{s.studentId}</span>
                                                <span className="text-[10px] font-bold text-gray-300 tabular-nums">{new Date(s.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}</span>
                                            </div>
                                        </div>
                                        <div className="flex flex-col items-end gap-1 shrink-0">
                                            {getStatusBadge(s.status)}
                                        </div>
                                    </div>
                                    {s.absenceReason && (
                                        <div className="ml-9 flex flex-wrap items-center gap-3 mt-1 pt-3 border-t border-gray-100/50">
                                            <div className="flex items-center gap-2 px-2.5 py-1 bg-white rounded-lg border border-gray-100 shadow-sm flex-1 min-w-0">
                                                <span className="text-[9px] font-bold text-gray-300 uppercase tracking-tighter shrink-0">Note</span>
                                                <span className="text-[10px] font-bold text-gray-600 truncate italic" title={s.absenceReason}>"{s.absenceReason}"</span>
                                            </div>
                                        </div>
                                    )}
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <div className="flex flex-col items-center justify-center h-full text-center p-8">
                            <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mb-4 text-gray-200"><ListBulletIcon className="w-8 h-8" /></div>
                            <p className="text-sm font-bold text-gray-300 uppercase tracking-widest">Waiting for check-ins...</p>
                        </div>
                    )
                ) : (
                    teacherHistory.length > 0 ? (
                        <ul className="space-y-3">
                            {teacherHistory
                                .filter(s => s.name.toLowerCase().includes(listSearchTerm.toLowerCase()) || s.studentId.toLowerCase().includes(listSearchTerm.toLowerCase()))
                                .map((s, idx) => (
                                <li key={`${s.studentId}-${s.timestamp}-${idx}`} className="flex flex-col gap-2 p-4 bg-gray-50/50 rounded-2xl border-2 border-transparent hover:border-gray-100 transition-all group">
                                    <div className="flex items-center gap-4">
                                        <div className="w-10 h-10 bg-indigo-50 text-indigo-400 rounded-xl flex items-center justify-center font-bold text-xs shrink-0">{s.name.charAt(0)}</div>
                                        <div className="flex-1 min-w-0">
                                            <p className="font-bold text-sm text-gray-900 truncate leading-tight mb-0.5">{s.name}</p>
                                            <div className="flex items-center gap-2">
                                                <span className="text-[10px] font-mono font-bold text-gray-400 bg-white px-2 rounded-md border border-gray-100">{s.studentId}</span>
                                                <span className="text-[10px] font-bold text-gray-300 tabular-nums">
                                                    {new Date(s.timestamp).toLocaleDateString()} {new Date(s.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="flex flex-col items-end gap-1 shrink-0">
                                            {getStatusBadge(s.status)}
                                        </div>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <div className="flex flex-col items-center justify-center h-full text-center p-8">
                            <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mb-4 text-gray-200"><HistoryIcon className="w-8 h-8" /></div>
                            <p className="text-sm font-bold text-gray-300 uppercase tracking-widest">No history recorded yet</p>
                        </div>
                    )
                )}
            </div>
            {selectedIds.size > 0 && (
                <div className="mt-4 flex items-center justify-between p-3 bg-red-50 rounded-2xl border-2 border-red-100 animate-in slide-in-from-bottom-4">
                    <span className="text-xs font-bold text-red-600 ml-2">{selectedIds.size} STU SELECTED</span>
                    <button onClick={() => { onRemoveStudents(Array.from(selectedIds), courseName); setSelectedIds(new Set()); }} className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-xl text-[10px] font-bold uppercase hover:bg-red-700 transition-all shadow-md active:scale-95"><TrashIcon className="w-3.5 h-3.5" /> Remove</button>
                </div>
            )}
        </div>
      </div>
       
      {showSettingsModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-[110] flex items-center justify-center p-4 animate-in fade-in duration-300">
            <div className="bg-white w-full max-w-2xl rounded-[2.5rem] shadow-2xl max-h-[90vh] overflow-hidden flex flex-col">
                <div className="p-8 border-b border-gray-50 flex justify-between items-center bg-gray-50/50">
                    <div className="flex items-center gap-4">
                        <div className="w-10 h-10 bg-indigo-600 text-white rounded-xl flex items-center justify-center shadow-lg"><AdjustmentsHorizontalIcon className="w-6 h-6" /></div>
                        <h2 className="text-2xl font-bold text-gray-900 tracking-tight">System Settings</h2>
                    </div>
                    <button onClick={() => setShowSettingsModal(false)} className="w-10 h-10 bg-white border border-gray-200 text-gray-400 hover:text-gray-900 transition-all rounded-full flex items-center justify-center active:scale-90"><XCircleIcon className="w-6 h-6" /></button>
                </div>
                <div className="p-8 space-y-8 overflow-y-auto custom-scrollbar">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-4">
                            <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em] ml-1">QR Generation</h3>
                            <div className="bg-gray-50 p-5 rounded-3xl space-y-4 border border-gray-100">
                                <div>
                                    <label className="block text-xs font-bold text-gray-600 mb-2 ml-1">Error Correction</label>
                                    <select value={qrErrorCorrection} onChange={e => {
                                        const val = e.target.value as 'L' | 'M' | 'Q' | 'H';
                                        localStorage.setItem('qr-error-correction', val);
                                        window.location.reload(); // Simple way to update since we removed state
                                    }} className="w-full text-sm font-bold rounded-xl border-gray-200 bg-white p-3 shadow-sm focus:ring-0 focus:border-brand-primary">
                                        <option value="L">Level L (7%)</option>
                                        <option value="M">Level M (15%)</option>
                                        <option value="Q">Level Q (25%)</option>
                                        <option value="H">Level H (30%)</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-600 mb-2 ml-1">QR Padding ({qrMargin}px)</label>
                                    <input type="range" min="0" max="10" value={qrMargin} onChange={e => {
                                        const val = e.target.value;
                                        localStorage.setItem('qr-margin', val);
                                        window.location.reload();
                                    }} className="w-full h-2 bg-white rounded-lg appearance-none cursor-pointer accent-brand-primary border border-gray-200" />
                                </div>
                            </div>
                        </div>
                        <div className="space-y-4">
                            <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em] ml-1">Session Protocol</h3>
                            <div className="bg-gray-50 p-5 rounded-3xl space-y-4 border border-gray-100">
                                <label className="flex items-center justify-between cursor-pointer p-3 bg-white rounded-xl border border-gray-100 shadow-sm active:scale-[0.98] transition-all">
                                    <div className="flex flex-col">
                                        <span className="text-xs font-bold text-gray-800">Geolocation</span>
                                        <div className="flex items-center gap-2 mt-1">
                                            <span className="text-[9px] font-bold text-gray-400 uppercase">Proximity Check</span>
                                            {locationStatus === 'fetching' && <span className="text-[9px] font-bold text-blue-500 uppercase">FETCHING...</span>}
                                            {locationStatus === 'success' && <span className="text-[9px] font-bold text-green-500 uppercase flex items-center gap-1"><CheckIcon className="w-3 h-3"/>LOCKED</span>}
                                            {locationStatus === 'denied' && <span className="text-[9px] font-bold text-red-500 uppercase">DENIED</span>}
                                            {locationStatus === 'error' && <span className="text-[9px] font-bold text-red-500 uppercase">ERROR</span>}
                                        </div>
                                    </div>
                                    <input 
                                        type="checkbox" 
                                        checked={isGeoEnabled} 
                                        onChange={(e) => handleGeoToggle(e.target.checked)} 
                                        className="w-6 h-6 rounded-md border-2 border-gray-100 text-brand-primary focus:ring-0 transition-all" 
                                    />
                                </label>
                                <label className="flex items-center justify-between cursor-pointer p-3 bg-white rounded-xl border border-gray-100 shadow-sm active:scale-[0.98] transition-all">
                                    <div className="flex flex-col"><span className="text-xs font-bold text-gray-800">Reverse Scan</span><span className="text-[9px] font-bold text-gray-400 uppercase">Lecturer Scans Stu</span></div>
                                    <input type="checkbox" checked={isOfflineMode} onChange={(e) => setIsOfflineMode(e.target.checked)} className="w-6 h-6 rounded-md border-2 border-gray-100 text-brand-primary focus:ring-0 transition-all" />
                                </label>
                            </div>
                        </div>
                    </div>
                    <div className="space-y-4">
                        <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em] ml-1">Cloud Synchronization</h3>
                        <GoogleSheetIntegrationInfo onSendTestRecord={() => onSendTestRecord(courseName)} onCheckPendingRecords={onCheckPendingRecords} onForceSync={onForceSync} />
                    </div>
                    <div className="space-y-4">
                        <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em] ml-1">Student Management</h3>
                        <div className="bg-gray-50 p-5 rounded-3xl border border-gray-100 flex flex-col gap-4">
                            <div className="flex items-center justify-between">
                                <div className="flex flex-col">
                                    <span className="text-xs font-bold text-gray-800">Import Student List</span>
                                    <span className="text-[9px] font-bold text-gray-400 uppercase">CSV Format: StudentID, Name</span>
                                </div>
                                <button 
                                    onClick={() => fileInputRef.current?.click()}
                                    className="flex items-center gap-2 bg-white text-indigo-600 text-[10px] font-bold px-4 py-2 rounded-xl hover:shadow-md transition-all active:scale-95 uppercase border border-indigo-100"
                                >
                                    <ArrowDownTrayIcon className="w-3.5 h-3.5 rotate-180" />
                                    Upload CSV
                                </button>
                                <input 
                                    type="file" 
                                    ref={fileInputRef} 
                                    onChange={handleFileUpload} 
                                    accept=".csv" 
                                    className="hidden" 
                                />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
      )}

      {showManualModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-[120] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-[2.5rem] shadow-2xl p-8 relative overflow-y-auto max-h-[90vh]">
            <button onClick={() => setShowManualModal(false)} className="absolute top-6 right-6 text-gray-300 hover:text-gray-900 transition-all active:scale-90"><XCircleIcon className="w-8 h-8"/></button>
            <h2 className="text-2xl font-bold text-gray-900 mb-6 tracking-tight">Manual Entry</h2>
            <div className="space-y-5">
               <div><label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 ml-1">Student ID</label><input type="text" value={manualId} onChange={handleManualIdChange} placeholder="Enter Student ID" className="w-full border-2 border-gray-50 bg-gray-50/50 rounded-2xl p-4 font-mono font-bold uppercase focus:bg-white focus:border-brand-primary transition-all outline-none placeholder:font-sans placeholder:text-gray-400 placeholder:text-xs placeholder:normal-case" /></div>
               <div><label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 ml-1">Full Name</label><input type="text" value={manualName} onChange={(e) => setManualName(e.target.value.toUpperCase())} placeholder="Enter Full Name" className="w-full border-2 border-gray-50 bg-gray-50/50 rounded-2xl p-4 font-bold uppercase focus:bg-white focus:border-brand-primary transition-all outline-none placeholder:text-gray-400 placeholder:text-xs placeholder:normal-case" /></div>
               <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 ml-1">Status</label>
                  <select value={manualStatus} onChange={(e) => setManualStatus(e.target.value)} className="w-full border-2 border-gray-50 bg-gray-50/50 rounded-2xl p-4 font-bold focus:bg-white focus:border-brand-primary transition-all outline-none appearance-none">
                      <option value="P">Present</option>
                      <option value="A">Absent</option>
                      <option value="M">Medical</option>
                      <option value="E">Exempt</option>
                  </select>
               </div>
               <div><label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 ml-1">Note / Reason</label><textarea value={manualReason} onChange={(e) => setManualReason(e.target.value)} className="w-full border-2 border-gray-50 bg-gray-50/50 rounded-2xl p-4 font-bold text-xs min-h-[80px] focus:bg-white focus:border-brand-primary transition-all outline-none" placeholder="Reason for status..."></textarea></div>
               {manualError && <p className="text-xs text-red-500 font-bold bg-red-50 p-3 rounded-xl border border-red-100 text-center">{manualError}</p>}
               <button onClick={submitManualAdd} className="w-full bg-indigo-600 text-white font-bold py-4 rounded-2xl hover:bg-indigo-700 transition-all active:scale-95 shadow-lg shadow-indigo-100 uppercase tracking-widest text-xs mt-2">Add Entry</button>
            </div>
          </div>
        </div>
      )}

      {showNewSessionModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-[200] flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-sm rounded-[2.5rem] shadow-2xl p-10 text-center border-t-8 border-indigo-600">
                <div className="w-16 h-16 bg-indigo-50 text-indigo-600 rounded-3xl flex items-center justify-center mx-auto mb-6"><PlusIcon className="w-10 h-10" /></div>
                <h2 className="text-2xl font-bold text-gray-900 mb-2 tracking-tight">New Session?</h2>
                <p className="text-sm text-gray-400 font-bold mb-8 uppercase tracking-widest">This clears all current entries.</p>
                <div className="flex gap-3">
                    <button onClick={() => setShowNewSessionModal(false)} className="flex-1 px-4 py-4 font-bold text-gray-400 bg-gray-100 rounded-2xl hover:bg-gray-200 transition-all uppercase text-[10px] tracking-widest">Cancel</button>
                    <button onClick={handleNewSession} className="flex-1 px-4 py-4 font-bold text-white bg-indigo-600 rounded-2xl hover:bg-indigo-700 transition-all uppercase text-[10px] tracking-widest shadow-lg shadow-indigo-100">Proceed</button>
                </div>
            </div>
        </div>
      )}

      {confirmation.action && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-[200] flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-md rounded-[2.5rem] shadow-2xl p-8">
                <div className="text-center mb-6">
                    <div className="w-16 h-16 bg-amber-50 text-amber-500 rounded-3xl flex items-center justify-center mx-auto mb-4"><ExclamationTriangleIcon className="w-10 h-10" /></div>
                    <h2 className="text-2xl font-bold text-gray-900 mb-2">Update {confirmation.count} Students</h2>
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Action: Set to {confirmation.action === 'P' ? 'Present' : 'Absent'}</p>
                </div>
                {confirmation.action === 'A' && (
                    <div className="mb-6">
                        <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 ml-1">Reason for Absence</label>
                        <input type="text" value={confirmation.reason} onChange={(e) => setConfirmation({...confirmation, reason: e.target.value})} className="w-full border-2 border-gray-50 bg-gray-50/50 rounded-2xl p-4 text-xs font-bold outline-none focus:bg-white focus:border-brand-primary" placeholder="Reason (Optional)" />
                    </div>
                )}
                <div className="flex gap-4">
                    <button onClick={() => setConfirmation({action:null, count:0})} className="flex-1 px-4 py-4 font-bold text-gray-400 bg-gray-100 rounded-2xl hover:bg-gray-200 transition-all uppercase text-[10px]">Cancel</button>
                    <button onClick={() => { onBulkStatusUpdate(filteredList.map(s=>s.studentId), confirmation.action!, courseName, confirmation.reason); setConfirmation({action:null, count:0}); }} className="flex-1 px-4 py-4 font-bold text-white bg-indigo-600 rounded-2xl hover:bg-indigo-700 transition-all uppercase text-[10px] shadow-lg shadow-indigo-100">Confirm</button>
                </div>
            </div>
        </div>
      )}

      {scanResult && (
        <div className="fixed top-8 left-1/2 -translate-x-1/2 z-[300] animate-in slide-in-from-top-10 duration-500">
            <div className={`px-8 py-4 rounded-3xl shadow-2xl flex items-center gap-4 border-4 ${scanResult.type === 'success' ? 'bg-green-600 border-green-500 text-white' : 'bg-red-600 border-red-500 text-white'}`}>
                <div className="bg-white/20 p-2 rounded-xl">{scanResult.type === 'success' ? <CheckIcon className="w-6 h-6" /> : <XMarkIcon className="w-6 h-6" />}</div>
                <p className="font-bold text-sm uppercase tracking-tight">{scanResult.message}</p>
            </div>
        </div>
      )}

      {showScanner && <QrScanner onScan={handleScanResult} onClose={() => setShowScanner(false)} />}
    </div>
  );
};
