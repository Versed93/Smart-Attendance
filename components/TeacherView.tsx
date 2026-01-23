
import React, { useState, useEffect, useRef, useMemo } from 'react';
import type { Student, SyncTask } from '../types';
import type { PreRegisteredStudent } from '../studentList';
import QRCode from 'qrcode';
import { DownloadIcon } from './icons/DownloadIcon';
import { EyeIcon } from './icons/EyeIcon';
import { UserIcon } from './icons/UserIcon';
import { TrashIcon } from './icons/TrashIcon';
import { ShieldCheckIcon } from './icons/ShieldCheckIcon';
import { PencilSquareIcon } from './icons/PencilSquareIcon';
import { ClockIcon } from './icons/ClockIcon';
import { CheckCircleIcon } from './icons/CheckCircleIcon';
import { XCircleIcon } from './icons/XCircleIcon';
import { GlobeIcon } from './icons/GlobeIcon';
import { MapPinIcon } from './icons/MapPinIcon';
import { CameraIcon } from './icons/CameraIcon';
import { LockClosedIcon } from './icons/LockClosedIcon';
import { SpeakerWaveIcon } from './icons/SpeakerWaveIcon';
import { SpeakerXMarkIcon } from './icons/SpeakerXMarkIcon';
import { ClipboardDocumentCheckIcon } from './icons/ClipboardDocumentCheckIcon';
import { MagnifyingGlassIcon } from './icons/MagnifyingGlassIcon';
import { GoogleSheetIntegrationInfo } from './GoogleSheetIntegrationInfo';
import { QrScanner } from './QrScanner';
import { QrCodeIcon } from './icons/QrCodeIcon';
import { ListBulletIcon } from './icons/ListBulletIcon';
import { DocumentTextIcon } from './icons/DocumentTextIcon';
import { UsersIcon } from './icons/UsersIcon';
import { AdjustmentsHorizontalIcon } from './icons/AdjustmentsHorizontalIcon';
import { ChartBarIcon } from './icons/ChartBarIcon';
import { ChevronDownIcon } from './icons/ChevronDownIcon';

interface TeacherViewProps {
  attendanceList: Student[];
  onTestAttendance: () => void;
  onClearAttendance: () => void;
  onRemoveStudents: (studentIds: string[]) => void;
  onBulkStatusUpdate: (studentIds: string[], status: string) => void;
  scriptUrl: string;
  onScriptUrlChange: (url: string) => void;
  onOpenKiosk: () => void;
  onManualAdd: (name: string, id: string, email: string, status: string) => {success: boolean, message: string};
  addStudent: (name: string, studentId: string, email: string, status: string, overrideTimestamp?: number) => { success: boolean, message: string };
  pendingSyncCount?: number;
  syncQueue?: SyncTask[];
  syncError?: string | null;
  onRetrySync?: () => void;
  isOnline?: boolean;
  onLogout: () => void;
  knownStudents: PreRegisteredStudent[];
}

export const TeacherView: React.FC<TeacherViewProps> = ({ 
  attendanceList, 
  onTestAttendance,
  onClearAttendance, 
  onRemoveStudents,
  onBulkStatusUpdate,
  scriptUrl, 
  onScriptUrlChange, 
  onOpenKiosk, 
  onManualAdd,
  addStudent,
  pendingSyncCount = 0,
  syncQueue = [],
  syncError = null,
  isOnline = true,
  onLogout,
  knownStudents
}) => {
  const [baseUrl] = useState<string>(() => {
    return window.location.origin + window.location.pathname;
  });
  const [qrData, setQrData] = useState<string>('');
  
  const [courseName, setCourseName] = useState(() => localStorage.getItem('attendance-course-name') || '');
  
  const [showSettingsModal, setShowSettingsModal] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<'teacher' | 'classroom' | 'checklist'>('teacher');
  const [isSoundEnabled, setIsSoundEnabled] = useState(true);
  
  const [isOfflineMode, setIsOfflineMode] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [scanResult, setScanResult] = useState<{ type: 'success' | 'error' | 'duplicate', message: string} | null>(null);

  const [isGeoEnabled, setIsGeoEnabled] = useState(false);
  const [teacherLocation, setTeacherLocation] = useState<{lat: number, lng: number} | null>(null);
  
  const [showManualModal, setShowManualModal] = useState(false);
  const [manualId, setManualId] = useState('');
  const [manualName, setManualName] = useState('');
  const [manualError, setManualError] = useState('');
  const [manualIsNew, setManualIsNew] = useState(false);

  const [isQrLoading, setIsQrLoading] = useState(true);
  
  // QR Customization State
  const [qrErrorCorrection, setQrErrorCorrection] = useState<'L' | 'M' | 'Q' | 'H'>(() => (localStorage.getItem('qr-error-correction') as any) || 'M');
  const [qrMargin, setQrMargin] = useState<number>(() => parseInt(localStorage.getItem('qr-margin') || '2', 10));
  const [qrDisplaySize, setQrDisplaySize] = useState<number>(() => parseInt(localStorage.getItem('qr-display-size') || '50', 10)); // Default 50vmin

  // Checklist Mode State
  const [checklistSearchTerm, setChecklistSearchTerm] = useState('');
  const [reasonModalStudent, setReasonModalStudent] = useState<PreRegisteredStudent | null>(null);
  const [reasonInput, setReasonInput] = useState('');
  
  // New List Controls State
  const [listFilter, setListFilter] = useState<'all' | 'present' | 'absent' | 'reason'>('present');
  const [listSort, setListSort] = useState<'time-desc' | 'time-asc' | 'name-asc' | 'name-desc'>('time-desc');
  const [listSearchTerm, setListSearchTerm] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkReasonModal, setShowBulkReasonModal] = useState(false);
  const [isListCollapsed, setIsListCollapsed] = useState(false);


  const [mobileTab, setMobileTab] = useState<'qr' | 'list'>('qr');

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const prevCountRef = useRef(attendanceList.length);

  const pendingIds = new Set(syncQueue.map(t => t.data.studentId));

  // Persist QR settings
  useEffect(() => localStorage.setItem('qr-error-correction', qrErrorCorrection), [qrErrorCorrection]);
  useEffect(() => localStorage.setItem('qr-margin', qrMargin.toString()), [qrMargin]);
  useEffect(() => localStorage.setItem('qr-display-size', qrDisplaySize.toString()), [qrDisplaySize]);

  const playSound = (type: 'success' | 'error' | 'duplicate') => {
    try {
        if (!isSoundEnabled) return;
        const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioContext) return;
        const ctx = new AudioContext();
        if (type === 'success') {
            const t = ctx.currentTime; const osc = ctx.createOscillator(); const gain = ctx.createGain(); osc.connect(gain); gain.connect(ctx.destination); osc.type = 'sine'; osc.frequency.setValueAtTime(500, t); osc.frequency.exponentialRampToValueAtTime(1000, t + 0.1); gain.gain.setValueAtTime(0, t); gain.gain.linearRampToValueAtTime(0.3, t + 0.05); gain.gain.exponentialRampToValueAtTime(0.01, t + 0.3); osc.start(t); osc.stop(t + 0.3);
        } else if (type === 'duplicate') {
             const beep = (startTime: number) => { const osc = ctx.createOscillator(); const gain = ctx.createGain(); osc.connect(gain); gain.connect(ctx.destination); osc.type = 'triangle'; osc.frequency.setValueAtTime(300, startTime); gain.gain.setValueAtTime(0.2, startTime); gain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.1); osc.start(startTime); osc.stop(startTime + 0.1); }; beep(ctx.currentTime); beep(ctx.currentTime + 0.15);
        } else { 
            const osc = ctx.createOscillator(); const gain = ctx.createGain(); osc.connect(gain); gain.connect(ctx.destination); osc.type = 'sawtooth'; osc.frequency.setValueAtTime(100, ctx.currentTime); osc.frequency.linearRampToValueAtTime(50, ctx.currentTime + 0.3); gain.gain.setValueAtTime(0.2, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3); osc.start(); osc.stop(ctx.currentTime + 0.3);
        }
    } catch (e) { console.error("Audio failed", e); }
  };

  useEffect(() => {
    if (attendanceList.length > prevCountRef.current) {
        playSound('success');
    }
    prevCountRef.current = attendanceList.length;
  }, [attendanceList.length]);

  useEffect(() => localStorage.setItem('attendance-course-name', courseName), [courseName]);

  const handleScanResult = (data: string) => {
      setShowScanner(false);
      try {
        const studentData = JSON.parse(data);
        if (studentData.studentId && studentData.name && studentData.email) {
            const result = addStudent(studentData.name, studentData.studentId, studentData.email, 'P', studentData.timestamp);
            if (result.success) { setScanResult({ type: 'success', message: `${studentData.name} checked in!` }); } 
            else { playSound('duplicate'); setScanResult({ type: 'duplicate', message: `${studentData.name} is already here.` }); }
        } else { throw new Error("Invalid student data structure"); }
      } catch (e) { playSound('error'); setScanResult({ type: 'error', message: 'Invalid QR code format.' }); }
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
    let isMounted = true;
    if (canvasRef.current && qrData) {
      // Note: We do NOT set isQrLoading(true) here to prevent flickering on every update
      QRCode.toCanvas(canvasRef.current, qrData, { 
          width: viewMode === 'classroom' ? 800 : 600, // Higher res for standard view (600) to ensure sharpness
          margin: qrMargin, 
          errorCorrectionLevel: qrErrorCorrection.toLowerCase() as any,
      }, (error) => {
        if (error) console.error(error);
        if (isMounted) setIsQrLoading(false);
      });
    }
    return () => { isMounted = false; };
  }, [qrData, qrErrorCorrection, qrMargin, viewMode]);

  const handleExportCSV = (studentIds?: string[]) => {
    const listToExport = studentIds ? attendanceList.filter(s => studentIds.includes(s.studentId)) : attendanceList;
    if (listToExport.length === 0) return;
    const headers = ['Timestamp', 'Student Name', 'Student ID', 'Email', 'Status', 'Sync Status'];
    const csvContent = [headers.join(','), ...listToExport.map(s => [ new Date(s.timestamp).toLocaleString(), `"${s.name}"`, `"${s.studentId}"`, `"${s.email}"`, `"${s.status}"`, pendingIds.has(s.studentId) ? 'PENDING' : 'SAVED' ].join(','))].join('\n');
    const blob = new Blob(["\ufeff" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `attendance-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
  };

  const handleManualIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.toUpperCase().trim();
    setManualId(val);
    const matched = knownStudents.find(s => s.id === val);
    if (matched) { setManualName(matched.name); setManualIsNew(false); setManualError(''); } 
    else { if (!manualIsNew) setManualName(''); setManualIsNew(true); }
  };

  const submitManualAdd = () => {
      if (!manualId || !manualName) { setManualError('Student ID and Name are required.'); return; }
      const result = onManualAdd(manualName, manualId, `${manualId}@STUDENT.UTS.EDU.MY`, 'P');
      if (result.success) { setShowManualModal(false); setManualId(''); setManualName(''); setManualError(''); } 
      else { setManualError(result.message); }
  };

  const filteredAndSortedList = useMemo(() => {
    const presentIds = new Set(attendanceList.map(s => s.studentId));
    let baseList: (Student & { isPresent: boolean })[] = [];

    switch (listFilter) {
      case 'present': baseList = attendanceList.map(s => ({ ...s, isPresent: true })); break;
      case 'absent': baseList = knownStudents.filter(s => !presentIds.has(s.id)).map(s => ({ studentId: s.id, name: s.name, email: `${s.id}@STUDENT.UTS.EDU.MY`, timestamp: 0, status: 'A', isPresent: false })); break;
      case 'reason': baseList = attendanceList.filter(s => s.status !== 'P').map(s => ({ ...s, isPresent: true })); break;
      default: // 'all'
        baseList = knownStudents.map(s => {
          const record = attendanceList.find(a => a.studentId === s.id);
          return record ? { ...record, isPresent: true } : { studentId: s.id, name: s.name, email: `${s.id}@STUDENT.UTS.EDU.MY`, timestamp: 0, status: 'A', isPresent: false };
        });
    }

    const searched = baseList.filter(s => s.name.toLowerCase().includes(listSearchTerm.toLowerCase()) || s.studentId.toLowerCase().includes(listSearchTerm.toLowerCase()));
    
    return searched.sort((a, b) => {
      switch (listSort) {
        case 'time-asc': return (a.timestamp || 0) - (b.timestamp || 0);
        case 'name-asc': return a.name.localeCompare(b.name);
        case 'name-desc': return b.name.localeCompare(a.name);
        default: return (b.timestamp || 0) - (a.timestamp || 0);
      }
    });
  }, [attendanceList, knownStudents, listFilter, listSort, listSearchTerm]);

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.checked) { setSelectedIds(new Set(filteredAndSortedList.map(s => s.studentId))); } 
      else { setSelectedIds(new Set()); }
  };

  const handleSelectOne = (id: string) => {
      setSelectedIds(prev => {
          const next = new Set(prev);
          if (next.has(id)) { next.delete(id); } else { next.add(id); }
          return next;
      });
  };

  const handleBulkRemove = () => {
      if (confirm(`Are you sure you want to remove ${selectedIds.size} students?`)) {
          onRemoveStudents(Array.from(selectedIds));
          setSelectedIds(new Set());
      }
  };
  
  const handleBulkMark = (status: string) => {
    onBulkStatusUpdate(Array.from(selectedIds), status);
    setSelectedIds(new Set());
    setShowBulkReasonModal(false);
  };
  
  // STATS
  const presentCount = attendanceList.length;
  const totalStudents = knownStudents.length;
  const attendanceRate = totalStudents > 0 ? Math.round((presentCount / totalStudents) * 100) : 0;
  const withReasonCount = attendanceList.filter(s => s.status !== 'P').length;
  const absentCount = totalStudents - presentCount;

  // CHECKLIST MODE (Separate Logic)
  const filteredChecklist = knownStudents.filter(s => s.name.toLowerCase().includes(checklistSearchTerm.toLowerCase()) || s.id.toLowerCase().includes(checklistSearchTerm.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name));
  const toggleStudentAttendance = (student: PreRegisteredStudent) => { if (attendanceList.some(a => a.studentId === student.id)) { onRemoveStudents([student.id]); } else { addStudent(student.name, student.id, `${student.id}@STUDENT.UTS.EDU.MY`, 'P'); } };
  const markAllVisiblePresent = () => { if (!confirm(`Mark all ${filteredChecklist.length} visible students as present?`)) return; let count = 0; filteredChecklist.forEach(s => { if (!attendanceList.some(a => a.studentId === s.id)) { addStudent(s.name, s.id, `${s.id}@STUDENT.UTS.EDU.MY`, 'P'); count++; } }); alert(`Marked ${count} students as present.`); };
  const openReasonModal = (student: PreRegisteredStudent, e: React.MouseEvent) => { e.stopPropagation(); setReasonModalStudent(student); setReasonInput(''); };
  const submitReason = (reason: string) => { if (!reasonModalStudent) return; addStudent(reasonModalStudent.name, reasonModalStudent.id, `${reasonModalStudent.id}@STUDENT.UTS.EDU.MY`, reason); setReasonModalStudent(null); };

  if (viewMode === 'classroom') {
    return (
      <div className="fixed inset-0 bg-gray-900 z-[200] flex flex-col items-center justify-between p-6 animate-in fade-in duration-300">
        
        <div className="text-center max-w-4xl shrink-0">
            {courseName ? (
                <>
                    <h1 className="text-3xl sm:text-5xl font-black text-white tracking-tight drop-shadow-xl mb-2">{courseName}</h1>
                    <p className="text-white/60 text-sm sm:text-lg font-bold tracking-widest uppercase">Scan to Check-in</p>
                </>
            ) : (
                <div className="flex flex-col items-center">
                    <h1 className="text-3xl sm:text-4xl font-black text-white tracking-tight drop-shadow-xl flex items-center gap-3">
                        <ShieldCheckIcon className="w-10 h-10 sm:w-12 sm:h-12 text-brand-primary" />
                        UTS ATTENDANCE
                    </h1>
                </div>
            )}
        </div>

        {/* Responsive Square Container for Classroom View */}
        <div className="flex-1 w-full flex items-center justify-center min-h-0 relative">
            <div 
              className="bg-white p-8 rounded-[2.5rem] shadow-[0_0_50px_-12px_rgba(0,0,0,0.5)] relative flex items-center justify-center transition-all duration-300"
              style={{ 
                width: `${qrDisplaySize}vmin`,
                maxWidth: '100%',
                maxHeight: '100%', 
                aspectRatio: '1/1'
              }} 
              role="img" 
              aria-label="Dynamic QR Code"
            >
              {isQrLoading && <div className="absolute inset-0 flex items-center justify-center bg-white/80 z-10"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-primary"></div></div>}
              <canvas ref={canvasRef} className="w-full h-full object-contain rounded-xl" />
              
              {/* Corner Accents for visual flair - Adjusted to be inside the card but framing the content */}
              <div className="absolute top-0 left-0 w-12 h-12 border-t-[6px] border-l-[6px] border-brand-primary rounded-tl-3xl -mt-1 -ml-1"></div>
              <div className="absolute top-0 right-0 w-12 h-12 border-t-[6px] border-r-[6px] border-brand-primary rounded-tr-3xl -mt-1 -mr-1"></div>
              <div className="absolute bottom-0 left-0 w-12 h-12 border-b-[6px] border-l-[6px] border-brand-primary rounded-bl-3xl -mb-1 -ml-1"></div>
              <div className="absolute bottom-0 right-0 w-12 h-12 border-b-[6px] border-r-[6px] border-brand-primary rounded-br-3xl -mb-1 -mr-1"></div>
            </div>
        </div>
        
        <div className="flex-shrink-0 flex items-center gap-4">
            <button
              onClick={() => setQrDisplaySize(s => Math.max(20, s - 5))}
              className="w-12 h-12 flex items-center justify-center bg-white/10 backdrop-blur-md text-white/90 rounded-full text-3xl font-light hover:bg-white/20 transition-all shadow-xl border border-white/20 disabled:opacity-50"
              disabled={qrDisplaySize <= 20}
              aria-label="Decrease QR Code Size"
            >
              -
            </button>
            
            <button 
              onClick={() => setViewMode('teacher')}
              className="flex items-center gap-2 bg-white/10 backdrop-blur-md text-white/90 px-6 py-3 rounded-full text-sm font-bold hover:bg-white/20 hover:text-white transition-all shadow-xl border border-white/20 group whitespace-nowrap"
            >
              <EyeIcon className="w-5 h-5 group-hover:scale-110 transition-transform" /> Exit Classroom View
            </button>

            <button
              onClick={() => setQrDisplaySize(s => Math.min(100, s + 5))}
              className="w-12 h-12 flex items-center justify-center bg-white/10 backdrop-blur-md text-white/90 rounded-full text-3xl font-light hover:bg-white/20 transition-all shadow-xl border border-white/20 disabled:opacity-50"
              disabled={qrDisplaySize >= 100}
              aria-label="Increase QR Code Size"
            >
              +
            </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[1600px] mx-auto p-2 sm:p-6 space-y-4 sm:space-y-6 pb-20 sm:pb-6">
       <div className="relative z-10 flex flex-col xl:flex-row justify-between items-stretch xl:items-center bg-white p-3 sm:p-4 rounded-2xl shadow-sm border border-gray-100 gap-4">
         <div className="flex items-center gap-3 sm:gap-4"><div className="flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 bg-gradient-to-br from-brand-primary to-brand-secondary text-white rounded-xl shadow-lg shrink-0"><ShieldCheckIcon className="w-6 h-6 sm:w-7 sm:h-7" /></div><div className="min-w-0"><h1 className="text-lg sm:text-2xl font-black text-gray-900 tracking-tight truncate">UTS ATTENDANCE</h1><p className="text-[10px] sm:text-xs text-gray-500 font-bold tracking-[0.2em] mt-0.5 sm:mt-1">SECURE CHECK-IN</p></div></div>
         <div className="flex items-center gap-2 overflow-x-auto pb-2 sm:pb-0 no-scrollbar w-full xl:w-auto mask-fade-right" role="toolbar">
            <button onClick={() => { setShowManualModal(true); setManualId(''); setManualName(''); setManualError(''); }} className="flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 bg-indigo-50 text-indigo-600 rounded-xl border hover:bg-indigo-100 transition-colors shrink-0" title="Manual Entry"><PencilSquareIcon className="w-5 h-5" /></button>
            <button onClick={() => setViewMode(v => v === 'checklist' ? 'teacher' : 'checklist')} className={`flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 rounded-xl border transition-colors shadow-sm shrink-0 ${viewMode === 'checklist' ? 'bg-indigo-600 text-white' : 'bg-indigo-50 text-indigo-600'}`} title="Class Register (Checklist)"><ClipboardDocumentCheckIcon className="w-5 h-5" /></button>
            <button onClick={() => setShowSettingsModal(true)} className="flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 rounded-xl border bg-gray-50 text-gray-600 hover:bg-gray-100 transition-colors shadow-sm shrink-0" title="Settings"><AdjustmentsHorizontalIcon className="w-5 h-5" /></button>
            <button onClick={() => setViewMode('classroom')} className={`flex group items-center gap-3 px-3 sm:px-5 py-2 sm:py-3 rounded-xl font-bold transition-all shrink-0 bg-gray-50 text-gray-700`} title="Switch to Classroom View"><div className="text-right hidden sm:block"><span className="text-[10px] uppercase opacity-60">View</span><span className="block text-xs uppercase tracking-wider">Classroom</span></div><EyeIcon className="w-5 h-5" /></button>
            <button onClick={onLogout} className="flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 bg-red-50 text-red-600 rounded-xl border hover:bg-red-100 shrink-0" title="Log Out"><LockClosedIcon className="w-5 h-5" /></button>
         </div>
       </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center gap-3"><div className="relative w-10 h-10 flex items-center justify-center"><svg className="w-full h-full" viewBox="0 0 36 36"><path className="text-gray-200" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" strokeWidth="3.8"></path><path className="text-brand-primary" strokeDasharray={`${attendanceRate}, 100`} d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" strokeWidth="3.8" strokeLinecap="round"></path></svg><span className="absolute text-xs font-bold text-brand-primary">{attendanceRate}%</span></div><div><p className="text-xl font-black text-gray-800">{presentCount}<span className="text-sm font-medium text-gray-400">/{totalStudents}</span></p><p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Attendance</p></div></div>
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center gap-3"><div className="w-10 h-10 flex items-center justify-center bg-green-100 text-green-600 rounded-lg"><CheckCircleIcon className="w-5 h-5" /></div><div><p className="text-xl font-black text-gray-800">{presentCount}</p><p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Present</p></div></div>
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center gap-3"><div className="w-10 h-10 flex items-center justify-center bg-red-100 text-red-600 rounded-lg"><XCircleIcon className="w-5 h-5" /></div><div><p className="text-xl font-black text-gray-800">{absentCount}</p><p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Absent</p></div></div>
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center gap-3"><div className="w-10 h-10 flex items-center justify-center bg-yellow-100 text-yellow-600 rounded-lg"><DocumentTextIcon className="w-5 h-5" /></div><div><p className="text-xl font-black text-gray-800">{withReasonCount}</p><p className="text-xs font-bold text-gray-500 uppercase tracking-wide">With Reason</p></div></div>
      </div>

      {viewMode === 'checklist' ? (
        <div className="bg-white rounded-2xl shadow-lg border border-gray-200 overflow-hidden flex flex-col h-[calc(100vh-220px)] sm:h-[calc(100vh-200px)]">
            <div className="p-3 sm:p-4 border-b border-gray-100 bg-gray-50 flex flex-col gap-3"><div className="flex items-center justify-between"><h2 className="text-base sm:text-lg font-bold text-gray-800 flex items-center gap-2"><ClipboardDocumentCheckIcon className="w-5 h-5 text-brand-primary" />Class Register</h2><div className="text-xs text-gray-500 font-medium">{presentCount} / {totalStudents}</div></div><div className="flex flex-col sm:flex-row gap-3 w-full"><div className="relative flex-1"><MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" /><input type="text" placeholder="Search name or ID..." value={checklistSearchTerm} onChange={(e) => setChecklistSearchTerm(e.target.value)} className="w-full pl-9 pr-4 py-2.5 rounded-lg border-gray-200 text-sm focus:border-brand-primary focus:ring-brand-primary"/></div><button onClick={markAllVisiblePresent} className="w-full sm:w-auto px-4 py-2.5 bg-brand-primary text-white text-sm font-bold rounded-lg hover:bg-brand-secondary transition-colors">Mark All Present</button></div></div>
            <div className="flex-1 overflow-y-auto p-2"><div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">{filteredChecklist.map(student => { const a = attendanceList.find(r => r.studentId === student.id); const isP = !!a; const isR = isP && a.status !== 'P'; const sT = isP ? (a.status === 'P' ? 'Present' : a.status) : ''; return (<div key={student.id} onClick={() => toggleStudentAttendance(student)} className={`cursor-pointer p-3 rounded-xl border transition-all duration-200 flex items-center justify-between group ${isR ? 'bg-yellow-50 border-yellow-200' : (isP ? 'bg-green-50 border-green-200' : 'bg-white border-gray-100 hover:border-brand-primary/50')}`}><div className="min-w-0 pr-2"><p className={`text-xs font-black truncate ${isR ? 'text-yellow-800' : (isP ? 'text-green-800' : 'text-gray-700')}`}>{student.name}</p><p className="text-[10px] text-gray-400 font-mono">{student.id}</p>{isR && <p className="text-[10px] font-bold text-yellow-600 mt-1 uppercase">{sT}</p>}</div><div className="flex items-center gap-2"><button onClick={(e) => openReasonModal(student, e)} className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${isR ? 'bg-yellow-200 text-yellow-700' : 'bg-gray-100 text-gray-400 hover:bg-gray-200'}`} title="Mark with Reason"><DocumentTextIcon className="w-4 h-4" /></button><div className={`w-6 h-6 shrink-0 rounded-full border-2 flex items-center justify-center transition-colors ${isP && !isR ? 'bg-green-500 border-green-500' : (isR ? 'bg-yellow-400 border-yellow-400' : 'bg-white border-gray-300 group-hover:border-brand-primary')}`}>{isP && <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}</div></div></div>);})}{filteredChecklist.length === 0 && (<div className="col-span-full text-center py-10 text-gray-400">No students found matching "{checklistSearchTerm}"</div>)}</div></div>
        </div>
      ) : (
      <>
        <div className="xl:hidden flex w-full bg-gray-200 p-1 rounded-xl shadow-inner mb-4"><button onClick={() => setMobileTab('qr')} className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-bold transition-all ${mobileTab === 'qr' ? 'bg-white text-brand-primary shadow-sm' : 'text-gray-500'}`}><QrCodeIcon className="w-4 h-4" />QR Code</button><button onClick={() => setMobileTab('list')} className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-bold transition-all ${mobileTab === 'list' ? 'bg-white text-brand-primary shadow-sm' : 'text-gray-500'}`}><ListBulletIcon className="w-4 h-4" />Live List ({presentCount})</button></div>
        <div className="grid grid-cols-1 gap-4 sm:gap-6 xl:grid-cols-5 items-start transition-all duration-300">
          
          <div className={`w-full xl:col-span-2 flex-col gap-4 ${mobileTab === 'list' ? 'flex' : 'hidden xl:flex'} order-2 xl:order-1`}>
            <div className={`bg-white rounded-xl shadow-sm border flex-1 grid transition-all duration-500 ease-in-out ${isListCollapsed ? 'grid-rows-[auto_0fr]' : 'grid-rows-[auto_1fr]'} max-h-[80vh]`}>
                <div className="p-3 border-b bg-gray-50 space-y-3">
                     <div className="flex items-center justify-between"><h3 className="font-bold text-gray-700 text-sm">Live Attendance List</h3>
                       <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-gray-400">{presentCount} / {totalStudents}</span>
                         <button onClick={() => setIsListCollapsed(!isListCollapsed)} className="p-1 text-gray-400 hover:text-gray-700 rounded-full focus:outline-none focus:ring-2 focus:ring-brand-primary">
                          <ChevronDownIcon className={`w-5 h-5 transition-transform duration-300 ${isListCollapsed ? 'rotate-180' : ''}`} />
                         </button>
                       </div>
                     </div>
                     <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
                        {(['present', 'absent', 'reason', 'all'] as const).map(f => <button key={f} onClick={() => setListFilter(f)} className={`px-3 py-1.5 text-xs font-bold rounded-full transition-colors shrink-0 ${listFilter === f ? 'bg-brand-primary text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>{f.charAt(0).toUpperCase() + f.slice(1)}</button>)}
                     </div>
                     <div className="flex gap-2">
                         <div className="relative flex-1"><MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" /><input type="text" placeholder="Search list..." value={listSearchTerm} onChange={e => setListSearchTerm(e.target.value)} className="w-full text-sm pl-9 pr-3 py-2 rounded-lg border-gray-200 focus:ring-brand-primary focus:border-brand-primary" /></div>
                         <select value={listSort} onChange={e => setListSort(e.target.value as any)} className="text-sm rounded-lg border-gray-200 focus:ring-brand-primary focus:border-brand-primary"><option value="time-desc">Newest</option><option value="time-asc">Oldest</option><option value="name-asc">Name (A-Z)</option><option value="name-desc">Name (Z-A)</option></select>
                     </div>
                </div>
                <div className="flex flex-col min-h-0 overflow-hidden">
                    {filteredAndSortedList.length === 0 ? (
                      <div className="flex flex-col items-center justify-center flex-1 text-gray-400 p-8"><UserIcon className="w-12 h-12 mb-2 opacity-20" /><p className="text-sm">No records found.</p></div>
                    ) : (
                      <div className="overflow-y-auto flex-1">
                        <table className="w-full text-sm text-left">
                          <thead className="text-xs text-gray-500 uppercase bg-gray-50/70 sticky top-0 z-10">
                            <tr>
                              <th scope="col" className="p-3 w-8"><input type="checkbox" className="rounded border-gray-300 text-brand-primary focus:ring-brand-primary" onChange={handleSelectAll} checked={selectedIds.size > 0 && selectedIds.size === filteredAndSortedList.length} indeterminate={selectedIds.size > 0 && selectedIds.size < filteredAndSortedList.length} /></th>
                              <th scope="col" className="px-3 py-3">Student</th>
                              <th scope="col" className="px-3 py-3 text-right">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                              {filteredAndSortedList.map(s => {
                                const isReason = s.status !== 'P' && s.isPresent;
                                return (
                                  <tr key={s.studentId} className={`transition-colors ${s.isPresent ? (isReason ? "bg-yellow-50/50" : "bg-white") : "bg-gray-50/50 opacity-60"} hover:bg-brand-primary/5`}>
                                    <td className="p-3 w-8"><input type="checkbox" className="rounded border-gray-300 text-brand-primary focus:ring-brand-primary" checked={selectedIds.has(s.studentId)} onChange={() => handleSelectOne(s.studentId)}/></td>
                                    <td className="px-3 py-4"><p className={`font-bold text-sm ${isReason ? 'text-yellow-900' : 'text-gray-800'}`}>{s.name}</p><p className="font-mono text-[10px] text-gray-500">{s.studentId}</p></td>
                                    <td className="px-3 py-4 text-right">
                                      {!s.isPresent ? (<span className="text-xs font-bold text-gray-400">ABSENT</span>) : (
                                        <div className="flex flex-col items-end gap-1">
                                          <span className="text-gray-400 text-xs">{new Date(s.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                                          {pendingIds.has(s.studentId) ? <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-orange-100 text-orange-700"><ClockIcon className="w-3 h-3" />Pending</span> : (isReason ? <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-bold bg-yellow-100 text-yellow-800"><DocumentTextIcon className="w-3 h-3" />{s.status}</span> : <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-50 text-green-700 opacity-80"><CheckCircleIcon className="w-3 h-3" />Saved</span>)}
                                        </div>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                          </tbody>
                        </table>
                      </div>
                    )}
                </div>
            </div>
          </div>
          
          <div className={`w-full xl:col-span-3 flex flex-1 flex-col items-center justify-center bg-white p-4 sm:p-6 rounded-2xl shadow-xl border order-1 xl:order-2 transition-all duration-500 ease-in-out z-0 ${mobileTab === 'list' ? 'hidden xl:flex' : 'flex'}`}>
            <div className="w-full flex flex-col items-center justify-center order-1 h-full">
                <h2 className="font-bold text-brand-primary tracking-tight text-center transition-all duration-300 text-xl sm:text-2xl mb-4 shrink-0">Scan to Check-in</h2>
                <div 
                  className="bg-gray-50 p-3 sm:p-4 rounded-3xl shadow-inner border relative aspect-square flex items-center justify-center mx-auto transition-all duration-300 w-full max-w-[85vw] sm:max-w-xl max-h-[55vh]"
                  role="img" 
                  aria-label="Dynamic QR Code"
                >
                   {isQrLoading && <div className="absolute inset-0 flex items-center justify-center bg-white/80 z-10"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-primary"></div></div>}
                  <canvas ref={canvasRef} className="w-full h-full object-contain rounded-xl" style={{ maxWidth: '100%', maxHeight: '100%' }} />
                </div>
                <div className="mt-6 flex flex-col items-center shrink-0"><div className="flex items-center gap-2 text-green-600 bg-green-50 px-3 py-1 rounded-full border" role="status"><span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span><span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span></span><span className="text-xs font-bold uppercase tracking-wide">Live Security Active</span></div><p className="text-gray-400 text-xs mt-1">QR Code refreshes every second.</p></div>
            </div>
          </div>
        </div>
      </>
      )}
      
      {showSettingsModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 flex flex-col">
                <div className="bg-gray-50 px-6 py-4 border-b flex justify-between items-center shrink-0">
                    <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2"><AdjustmentsHorizontalIcon className="w-5 h-5"/>Configuration</h3>
                    <button onClick={() => setShowSettingsModal(false)} className="text-gray-400 hover:text-gray-600"><XCircleIcon className="w-6 h-6" /></button>
                </div>
                
                {/* SETTINGS CONTENT - GRID LAYOUT TO PREVENT SCROLLING */}
                <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4 overflow-y-auto md:overflow-hidden">
                    
                    {/* LEFT COLUMN */}
                    <div className="space-y-4">
                        {/* Session Details - Added as requested */}
                         <div className="space-y-3 p-4 rounded-xl border bg-gray-50/70">
                            <h4 className="text-sm font-bold text-gray-700">Session Details</h4>
                            <div>
                                <label htmlFor="course-name" className="block text-xs font-bold text-gray-500 mb-1">Course / Class Name</label>
                                <input id="course-name" type="text" value={courseName} onChange={e => setCourseName(e.target.value)} className="w-full text-sm rounded-lg border-gray-300 focus:ring-brand-primary focus:border-brand-primary" placeholder="e.g. UCS5512 Software Engineering" />
                            </div>
                        </div>

                        {/* General Settings */}
                        <div className="space-y-3 p-4 rounded-xl border bg-gray-50/70 h-full">
                            <h4 className="text-sm font-bold text-gray-700">General</h4>
                             <dl className="divide-y divide-gray-200">
                               <div className="flex items-center justify-between py-2"><dt className="text-sm font-medium text-gray-700 flex items-center gap-2"><SpeakerWaveIcon className="w-5 h-5 text-gray-400"/>Sound Effects</dt><dd><input type="checkbox" checked={isSoundEnabled} onChange={() => setIsSoundEnabled(!isSoundEnabled)} className="toggle toggle-sm toggle-primary"/></dd></div>
                               <div className="flex items-center justify-between py-2"><dt className="text-sm font-medium text-gray-700 flex items-center gap-2"><GlobeIcon className="w-5 h-5 text-gray-400"/>Session Mode</dt><dd><div className="flex items-center gap-2"><span className={`text-xs font-bold ${isOfflineMode ? 'text-red-600' : 'text-green-600'}`}>{isOfflineMode ? 'Offline Hub' : 'Live Sync'}</span><input type="checkbox" checked={isOfflineMode} onChange={() => setIsOfflineMode(!isOfflineMode)} className="toggle toggle-sm toggle-error [--tglbg:theme(colors.green.500)] bg-green-200 hover:bg-green-300 border-green-300"/></div></dd></div>
                               <div className="flex items-center justify-between py-2"><dt className="text-sm font-medium text-gray-700 flex items-center gap-2"><MapPinIcon className="w-5 h-5 text-gray-400"/>GPS Geofence</dt><dd><div className="flex items-center gap-2"><span className={`text-xs font-bold ${isGeoEnabled ? 'text-blue-600' : 'text-gray-400'}`}>{isGeoEnabled ? 'Enabled' : 'Disabled'}</span><input type="checkbox" checked={isGeoEnabled} onChange={() => setIsGeoEnabled(!isGeoEnabled)} className="toggle toggle-sm toggle-info"/></div></dd></div>
                            </dl>
                        </div>
                    </div>

                    {/* RIGHT COLUMN */}
                    <div className="space-y-4">
                        {/* QR Code Customization */}
                        <div className="space-y-3 p-4 rounded-xl border bg-gray-50/70">
                          <h4 className="text-sm font-bold text-gray-700">QR Code Customization</h4>
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <label htmlFor="qr-error-correction" className="block text-xs font-bold text-gray-500 mb-1">Error Correction</label>
                              <select id="qr-error-correction" value={qrErrorCorrection} onChange={e => setQrErrorCorrection(e.target.value as any)} className="w-full text-sm rounded-lg border-gray-300 focus:ring-brand-primary focus:border-brand-primary">
                                <option value="L">Low</option><option value="M">Medium</option><option value="Q">Quartile</option><option value="H">High</option>
                              </select>
                            </div>
                            <div>
                              <label htmlFor="qr-margin" className="block text-xs font-bold text-gray-500 mb-1">Margin</label>
                              <input type="number" id="qr-margin" value={qrMargin} onChange={e => setQrMargin(parseInt(e.target.value) || 0)} min="0" max="10" className="w-full text-sm rounded-lg border-gray-300 focus:ring-brand-primary focus:border-brand-primary" />
                            </div>
                          </div>
                          <div>
                            <label htmlFor="qr-size" className="block text-xs font-bold text-gray-500 mb-1">Display Size (Classroom View): {qrDisplaySize}vmin</label>
                            <input type="range" id="qr-size" value={qrDisplaySize} onChange={e => setQrDisplaySize(parseInt(e.target.value))} min="20" max="100" className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-brand-primary" />
                          </div>
                        </div>

                         {/* Integration (Compact) */}
                        <div className="space-y-3 p-4 rounded-xl border bg-gray-50/70">
                           <h4 className="text-sm font-bold text-gray-700">Google Sheets Integration</h4>
                           <div><label className="block text-xs font-bold text-gray-500 mb-1" htmlFor="script-url-input">Web App URL</label><input id="script-url-input" type="text" value={scriptUrl} onChange={(e) => onScriptUrlChange(e.target.value)} className="block w-full bg-white border border-gray-300 rounded-lg py-2 px-3 text-sm focus:ring-2 focus:ring-brand-primary" placeholder="https://script.google.com/..." /></div>
                        </div>
                    </div>
                    
                    {/* BOTTOM / FULL WIDTH Data Management */}
                    <div className="md:col-span-2 space-y-3 p-4 rounded-xl border bg-gray-50/70">
                        <h4 className="text-sm font-bold text-gray-700">Data Management</h4>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                           <button onClick={onTestAttendance} className="flex items-center justify-center gap-2 px-3 py-2 bg-indigo-50 border border-indigo-100 text-indigo-700 rounded-lg text-xs font-bold hover:bg-indigo-100"><div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></div>Test Keying</button>
                           <button onClick={() => handleExportCSV()} disabled={attendanceList.length === 0} className="flex items-center justify-center gap-2 px-3 py-2 bg-white border rounded-lg text-xs font-bold disabled:opacity-50"><DownloadIcon className="w-4 h-4" />Export CSV</button>
                           <button onClick={onClearAttendance} disabled={attendanceList.length === 0} className="flex items-center justify-center gap-2 px-3 py-2 bg-red-50 border border-red-100 text-red-700 rounded-lg text-xs font-bold disabled:opacity-50"><TrashIcon className="w-4 h-4" />Clear List</button>
                        </div>
                    </div>

                </div>
            </div>
        </div>
      )}

      {showScanner && <QrScanner onScan={handleScanResult} onClose={() => setShowScanner(false)} />}
      {scanResult && <div className="fixed inset-0 flex items-center justify-center z-[300] pointer-events-none p-4"><div className={`transform transition-all duration-300 ease-out flex flex-col items-center justify-center p-6 sm:p-8 rounded-3xl shadow-2xl border-4 ${scanResult.type === 'success' ? 'bg-white border-green-500 text-green-700' : scanResult.type === 'duplicate' ? 'bg-white border-yellow-500 text-yellow-700' : 'bg-white border-red-500 text-red-700'}`} role="alert"><div className={`rounded-full p-4 mb-4 ${scanResult.type === 'success' ? 'bg-green-100' : scanResult.type === 'duplicate' ? 'bg-yellow-100' : 'bg-red-100'}`}>{scanResult.type === 'success' && <CheckCircleIcon className="w-12 h-12 sm:w-16 sm:h-16 text-green-600" />}{scanResult.type === 'duplicate' && <UserIcon className="w-12 h-12 sm:w-16 sm:h-16 text-yellow-600" />}{scanResult.type === 'error' && <XCircleIcon className="w-12 h-12 sm:w-16 sm:h-16 text-red-600" />}</div><h3 className="text-xl sm:text-2xl font-black uppercase tracking-tight mb-1 text-center">{scanResult.type === 'success' ? 'Checked In' : scanResult.type === 'duplicate' ? 'Already Scanned' : 'Scan Failed'}</h3><p className="text-base sm:text-lg font-bold text-center max-w-xs">{scanResult.message}</p></div></div>}
      {showManualModal && <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"><div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200"><div className="bg-gray-50 px-6 py-4 border-b flex justify-between items-center"><h3 className="text-lg font-bold text-gray-900">Manual Entry</h3><button onClick={() => setShowManualModal(false)} className="text-gray-400 hover:text-gray-600"><XCircleIcon className="w-6 h-6" /></button></div><div className="p-6 space-y-4"><div><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Student ID</label><input type="text" value={manualId} onChange={handleManualIdChange} className="w-full border-2 border-gray-200 rounded-xl px-4 py-2 font-mono uppercase font-bold focus:border-brand-primary outline-none" placeholder="FIA..." autoFocus/></div><div><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Student Name</label><input type="text" value={manualName} onChange={(e) => setManualName(e.target.value.toUpperCase())} className={`w-full border-2 rounded-xl px-4 py-2 font-bold outline-none ${!manualIsNew && manualName ? 'bg-gray-100 border-transparent' : 'border-gray-200 focus:border-brand-primary'}`} readOnly={!manualIsNew && !!manualName} placeholder="NAME"/></div>{manualError && <p className="text-xs text-red-500 font-bold">{manualError}</p>}<button onClick={submitManualAdd} className="w-full bg-brand-primary text-white font-bold py-3 rounded-xl hover:bg-brand-secondary active:scale-95 transition-all">Add to List</button></div></div></div>}
      {reasonModalStudent && <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4"><div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in duration-200"><div className="bg-yellow-50 px-6 py-4 border-b border-yellow-100 flex justify-between items-center"><h3 className="text-lg font-bold text-yellow-800">Mark Absent with Reason</h3><button onClick={() => setReasonModalStudent(null)} className="text-yellow-600 hover:text-yellow-800"><XCircleIcon className="w-6 h-6" /></button></div><div className="p-6"><p className="text-sm font-bold text-gray-800 mb-1">{reasonModalStudent.name}</p><p className="text-xs text-gray-400 font-mono mb-4">{reasonModalStudent.id}</p><div className="grid grid-cols-2 gap-2 mb-4">{['Medical', 'Exempt', 'Other'].map(r => (<button key={r} onClick={() => submitReason(r)} className="px-3 py-2 bg-gray-50 border hover:bg-yellow-50 hover:border-yellow-200 rounded-lg text-xs font-bold"> {r} </button>))}</div><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Custom Reason</label><div className="flex gap-2"><input type="text" value={reasonInput} onChange={(e) => setReasonInput(e.target.value)} className="flex-1 border-2 border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-yellow-400 outline-none" placeholder="Type reason..."/><button onClick={() => submitReason(reasonInput || 'Other')} className="px-4 py-2 bg-yellow-400 text-yellow-900 font-bold rounded-lg hover:bg-yellow-500">Save</button></div></div></div></div>}
      {selectedIds.size > 0 && <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-gray-800/90 backdrop-blur-sm text-white p-3 rounded-xl shadow-2xl flex items-center gap-4 animate-in fade-in slide-in-from-bottom-5 duration-300"><span className="font-bold text-sm">{selectedIds.size} selected</span><div className="flex items-center gap-2"><button onClick={() => setShowBulkReasonModal(true)} className="px-3 py-1.5 text-xs font-bold bg-white/10 hover:bg-white/20 rounded">Mark as...</button><button onClick={handleBulkRemove} className="px-3 py-1.5 text-xs font-bold bg-red-500/50 hover:bg-red-500/80 rounded">Remove</button><button onClick={() => setSelectedIds(new Set())}><XCircleIcon className="w-5 h-5 text-gray-400 hover:text-white"/></button></div></div>}
      {showBulkReasonModal && <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4"><div className="bg-white rounded-xl shadow-lg w-full max-w-xs p-4"><h3 className="font-bold text-center mb-3">Mark {selectedIds.size} students as:</h3><div className="grid grid-cols-2 gap-2">{['Present', 'Medical', 'Exempt', 'Other'].map(r => <button key={r} onClick={() => handleBulkMark(r === 'Present' ? 'P' : r)} className="px-3 py-2 text-sm bg-gray-100 hover:bg-brand-primary hover:text-white rounded-lg">{r}</button>)}<button onClick={() => setShowBulkReasonModal(false)} className="col-span-2 mt-2 text-sm">Cancel</button></div></div></div>}
    </div>
  );
};
