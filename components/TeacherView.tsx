import React, { useState, useEffect, useRef } from 'react';
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

interface TeacherViewProps {
  attendanceList: Student[];
  onTestAttendance: () => void;
  onClearAttendance: () => void;
  onRemoveStudents: (studentIds: string[]) => void;
  onBulkStatusUpdate: (studentIds: string[], status: 'P' | 'A') => void;
  scriptUrl: string;
  onScriptUrlChange: (url: string) => void;
  onOpenKiosk: () => void;
  onManualAdd: (name: string, id: string, email: string, status: 'P' | 'A') => {success: boolean, message: string};
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
  const [baseUrl] = useState<string>(window.location.href.split('?')[0]);
  const [qrData, setQrData] = useState<string>('');
  
  const [courseName, setCourseName] = useState(() => localStorage.getItem('attendance-course-name') || '');
  
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<'teacher' | 'classroom' | 'checklist'>('teacher');
  const [isSoundEnabled, setIsSoundEnabled] = useState(true);
  
  // New Offline Hub Mode
  const [isOfflineMode, setIsOfflineMode] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [scanResult, setScanResult] = useState<{ type: 'success' | 'error' | 'duplicate', message: string} | null>(null);

  const [isGeoEnabled, setIsGeoEnabled] = useState(false);
  const [teacherLocation, setTeacherLocation] = useState<{lat: number, lng: number} | null>(null);
  
  const [currentTime, setCurrentTime] = useState(Date.now());
  
  const [showManualModal, setShowManualModal] = useState(false);
  const [manualId, setManualId] = useState('');
  const [manualName, setManualName] = useState('');
  const [manualError, setManualError] = useState('');
  const [manualIsNew, setManualIsNew] = useState(false);

  const [isQrLoading, setIsQrLoading] = useState(true);
  
  // Checklist Mode State
  const [checklistSearch, setChecklistSearch] = useState('');
  const [reasonModalStudent, setReasonModalStudent] = useState<PreRegisteredStudent | null>(null);
  const [reasonInput, setReasonInput] = useState('');

  // Mobile Tab State (QR vs List)
  const [mobileTab, setMobileTab] = useState<'qr' | 'list'>('qr');

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const prevCountRef = useRef(attendanceList.length);

  const pendingIds = new Set(syncQueue.map(t => t.data.studentId));

  const playSound = (type: 'success' | 'error' | 'duplicate') => {
    try {
        if (!isSoundEnabled) return;
        const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioContext) return;
        const ctx = new AudioContext();
        
        // Success: Happy Chime
        if (type === 'success') {
            const t = ctx.currentTime;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            
            osc.type = 'sine';
            osc.frequency.setValueAtTime(500, t);
            osc.frequency.exponentialRampToValueAtTime(1000, t + 0.1);
            
            gain.gain.setValueAtTime(0, t);
            gain.gain.linearRampToValueAtTime(0.3, t + 0.05);
            gain.gain.exponentialRampToValueAtTime(0.01, t + 0.3);
            
            osc.start(t);
            osc.stop(t + 0.3);
        } 
        // Duplicate: Double Warning Beep
        else if (type === 'duplicate') {
             const beep = (startTime: number) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(300, startTime);
                gain.gain.setValueAtTime(0.2, startTime);
                gain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.1);
                osc.start(startTime);
                osc.stop(startTime + 0.1);
             };
             beep(ctx.currentTime);
             beep(ctx.currentTime + 0.15);
        } 
        // Error: Harsh Buzz
        else { 
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(100, ctx.currentTime);
            osc.frequency.linearRampToValueAtTime(50, ctx.currentTime + 0.3);
            gain.gain.setValueAtTime(0.2, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
            osc.start();
            osc.stop(ctx.currentTime + 0.3);
        }
    } catch (e) { console.error("Audio failed", e); }
  };

  useEffect(() => {
    if (attendanceList.length > prevCountRef.current) {
        playSound('success');
    }
    prevCountRef.current = attendanceList.length;
  }, [attendanceList.length, isSoundEnabled]);

  useEffect(() => localStorage.setItem('attendance-course-name', courseName), [courseName]);
  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(Date.now()), 10000);
    return () => clearInterval(interval);
  }, []);

  const handleScanResult = (data: string) => {
      setShowScanner(false);
      try {
        const studentData = JSON.parse(data);
        if (studentData.studentId && studentData.name && studentData.email) {
            const result = addStudent(studentData.name, studentData.studentId, studentData.email, 'P', studentData.timestamp);
            if (result.success) {
                setScanResult({ type: 'success', message: `${studentData.name} checked in!` });
            } else {
                playSound('duplicate');
                setScanResult({ type: 'duplicate', message: `${studentData.name} is already here.` });
            }
        } else {
            throw new Error("Invalid student data structure");
        }
      } catch (e) {
          playSound('error');
          setScanResult({ type: 'error', message: 'Invalid QR code format.' });
      }
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
    if (canvasRef.current && qrData) {
      QRCode.toCanvas(canvasRef.current, qrData, { width: 800, margin: 1, errorCorrectionLevel: 'M' }, (error) => {
        if (error) console.error(error);
        setIsQrLoading(false);
      });
    }
  }, [qrData]);

  const visibleList = [...attendanceList].sort((a, b) => b.timestamp - a.timestamp);

  const handleExportCSV = () => {
    if (attendanceList.length === 0) return;
    const headers = ['Timestamp', 'Student Name', 'Student ID', 'Email', 'Status', 'Sync Status'];
    const csvContent = [headers.join(','), ...visibleList.map(s => [
        new Date(s.timestamp).toLocaleString(), `"${s.name}"`, `"${s.studentId}"`, `"${s.email}"`, `"${s.status}"`,
        pendingIds.has(s.studentId) ? 'PENDING' : 'SAVED'
    ].join(','))].join('\n');
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
    if (matched) {
        setManualName(matched.name);
        setManualIsNew(false);
        setManualError('');
    } else {
        if (!manualIsNew) setManualName('');
        setManualIsNew(true);
    }
  };

  const submitManualAdd = () => {
      if (!manualId) { setManualError('Student ID is required.'); return; }
      if (!manualName) { setManualError('Student Name is required.'); return; }
      
      const email = `${manualId}@STUDENT.UTS.EDU.MY`;
      const result = onManualAdd(manualName, manualId, email, 'P');
      
      if (result.success) {
          setShowManualModal(false);
          setManualId('');
          setManualName('');
          setManualError('');
      } else {
          setManualError(result.message);
      }
  };
  
  // Checklist Mode Logic
  const filteredChecklist = knownStudents.filter(s => 
      s.name.toLowerCase().includes(checklistSearch.toLowerCase()) || 
      s.id.toLowerCase().includes(checklistSearch.toLowerCase())
  ).sort((a, b) => a.name.localeCompare(b.name));

  const toggleStudentAttendance = (student: PreRegisteredStudent) => {
      const isPresent = attendanceList.some(a => a.studentId === student.id);
      if (isPresent) {
          onRemoveStudents([student.id]);
      } else {
          addStudent(student.name, student.id, `${student.id}@STUDENT.UTS.EDU.MY`, 'P');
      }
  };

  const markAllVisiblePresent = () => {
      if (!confirm(`Mark all ${filteredChecklist.length} visible students as present?`)) return;
      
      let count = 0;
      filteredChecklist.forEach(s => {
          const isPresent = attendanceList.some(a => a.studentId === s.id);
          if (!isPresent) {
              addStudent(s.name, s.id, `${s.id}@STUDENT.UTS.EDU.MY`, 'P');
              count++;
          }
      });
      alert(`Marked ${count} students as present.`);
  };

  const openReasonModal = (student: PreRegisteredStudent, e: React.MouseEvent) => {
      e.stopPropagation(); // Prevent toggling attendance
      setReasonModalStudent(student);
      setReasonInput('');
  };

  const submitReason = (reason: string) => {
      if (!reasonModalStudent) return;
      addStudent(
          reasonModalStudent.name, 
          reasonModalStudent.id, 
          `${reasonModalStudent.id}@STUDENT.UTS.EDU.MY`, 
          reason
      );
      setReasonModalStudent(null);
  };

  return (
    <div className="w-full max-w-[1600px] mx-auto p-2 sm:p-6 space-y-4 sm:space-y-6 pb-20 sm:pb-6">
       {/* Main Toolbar */}
       <div className="relative z-10 flex flex-col xl:flex-row justify-between items-stretch xl:items-center bg-white p-3 sm:p-4 rounded-2xl shadow-sm border border-gray-100 gap-4">
         <div className="flex items-center gap-3 sm:gap-4">
             <div className="flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 bg-gradient-to-br from-brand-primary to-brand-secondary text-white rounded-xl shadow-lg shrink-0" aria-hidden="true">
                 <ShieldCheckIcon className="w-6 h-6 sm:w-7 sm:h-7" />
             </div>
             <div className="min-w-0">
                 <h1 className="text-lg sm:text-2xl font-black text-gray-900 tracking-tight truncate">UTS ATTENDANCE</h1>
                 <p className="text-[10px] sm:text-xs text-gray-500 font-bold tracking-[0.2em] mt-0.5 sm:mt-1">SECURE CHECK-IN</p>
             </div>
         </div>
         
         {/* Toolbar Buttons - Horizontal Scroll on Mobile */}
         <div className="flex items-center gap-2 overflow-x-auto pb-2 sm:pb-0 no-scrollbar w-full xl:w-auto mask-fade-right" role="toolbar" aria-label="Toolbar">
            <button 
              onClick={() => {
                  setShowManualModal(true);
                  setManualId('');
                  setManualName('');
                  setManualError('');
              }}
              className="flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 bg-indigo-50 text-indigo-600 rounded-xl border hover:bg-indigo-100 transition-colors shrink-0"
              title="Manual Entry"
              aria-label="Manually add student"
            >
              <PencilSquareIcon className="w-5 h-5" />
            </button>
            <button 
              onClick={() => setViewMode(v => v === 'checklist' ? 'teacher' : 'checklist')} 
              className={`flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 rounded-xl border transition-colors shadow-sm shrink-0 ${viewMode === 'checklist' ? 'bg-indigo-600 text-white' : 'bg-indigo-50 text-indigo-600'}`}
              title="Class Register (Checklist)"
              aria-label="Toggle Class Register"
            >
              <ClipboardDocumentCheckIcon className="w-5 h-5" />
            </button>
            <button 
              onClick={() => setIsSoundEnabled(!isSoundEnabled)} 
              className={`flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 rounded-xl border transition-colors shadow-sm shrink-0 ${isSoundEnabled ? 'bg-indigo-50 text-indigo-600' : 'bg-gray-50 text-gray-400'}`} 
              title={isSoundEnabled ? "Mute Sound" : "Enable Sound"}
              aria-label={isSoundEnabled ? "Mute sound" : "Enable sound"}
              aria-pressed={isSoundEnabled}
            >
              {isSoundEnabled ? <SpeakerWaveIcon className="w-5 h-5" /> : <SpeakerXMarkIcon className="w-5 h-5" />}
            </button>
            <button 
              onClick={() => setViewMode(v => v === 'teacher' ? 'classroom' : 'teacher')} 
              className={`flex group items-center gap-3 px-3 sm:px-5 py-2 sm:py-3 rounded-xl font-bold transition-all shrink-0 ${viewMode === 'teacher' ? 'bg-gray-50 text-gray-700' : (viewMode === 'classroom' ? 'bg-gray-900 text-white shadow-lg' : 'bg-gray-50 text-gray-400')}`} 
              title="Toggle QR View Mode"
              aria-label={`Switch to ${viewMode === 'teacher' ? 'Classroom' : 'Teacher'} view`}
            >
              <div className="text-right hidden sm:block">
                <span className="text-[10px] uppercase opacity-60">View</span>
                <span className="block text-xs uppercase tracking-wider">{viewMode === 'classroom' ? 'Classroom' : 'Teacher'}</span>
              </div>
              <EyeIcon className="w-5 h-5" aria-hidden="true" />
            </button>
            <button 
              onClick={onLogout} 
              className="flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 bg-red-50 text-red-600 rounded-xl border hover:bg-red-100 shrink-0" 
              title="Log Out"
              aria-label="Log out"
            >
              <LockClosedIcon className="w-5 h-5" aria-hidden="true" />
            </button>
         </div>
       </div>

      {viewMode === 'checklist' ? (
          <div className="bg-white rounded-2xl shadow-lg border border-gray-200 overflow-hidden flex flex-col h-[calc(100vh-220px)] sm:h-[calc(100vh-200px)]">
              <div className="p-3 sm:p-4 border-b border-gray-100 bg-gray-50 flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                      <h2 className="text-base sm:text-lg font-bold text-gray-800 flex items-center gap-2">
                          <ClipboardDocumentCheckIcon className="w-5 h-5 text-brand-primary" />
                          Class Register
                      </h2>
                      <div className="text-xs text-gray-500 font-medium">
                          {attendanceList.length} / {knownStudents.length}
                      </div>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-3 w-full">
                      <div className="relative flex-1">
                          <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                          <input 
                            type="text" 
                            placeholder="Search name or ID..." 
                            value={checklistSearch}
                            onChange={(e) => setChecklistSearch(e.target.value)}
                            className="w-full pl-9 pr-4 py-2.5 rounded-lg border-gray-200 text-sm focus:border-brand-primary focus:ring-brand-primary"
                          />
                      </div>
                      <button 
                        onClick={markAllVisiblePresent}
                        className="w-full sm:w-auto px-4 py-2.5 bg-brand-primary text-white text-sm font-bold rounded-lg hover:bg-brand-secondary transition-colors"
                      >
                          Mark All Present
                      </button>
                  </div>
              </div>
              <div className="flex-1 overflow-y-auto p-2">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
                      {filteredChecklist.map(student => {
                          const attendanceRecord = attendanceList.find(a => a.studentId === student.id);
                          const isPresent = !!attendanceRecord;
                          const isReason = isPresent && attendanceRecord.status !== 'P';
                          const statusText = isPresent ? (attendanceRecord.status === 'P' ? 'Present' : attendanceRecord.status) : '';

                          return (
                              <div 
                                key={student.id}
                                onClick={() => toggleStudentAttendance(student)}
                                className={`cursor-pointer p-3 rounded-xl border transition-all duration-200 flex items-center justify-between group ${isReason ? 'bg-yellow-50 border-yellow-200 shadow-sm' : (isPresent ? 'bg-green-50 border-green-200 shadow-sm' : 'bg-white border-gray-100 hover:border-brand-primary/50')}`}
                              >
                                  <div className="min-w-0 pr-2">
                                      <p className={`text-xs font-black truncate ${isReason ? 'text-yellow-800' : (isPresent ? 'text-green-800' : 'text-gray-700')}`}>{student.name}</p>
                                      <p className="text-[10px] text-gray-400 font-mono">{student.id}</p>
                                      {isReason && <p className="text-[10px] font-bold text-yellow-600 mt-1 uppercase">{statusText}</p>}
                                  </div>
                                  <div className="flex items-center gap-2">
                                      <button 
                                        onClick={(e) => openReasonModal(student, e)}
                                        className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${isReason ? 'bg-yellow-200 text-yellow-700' : 'bg-gray-100 text-gray-400 hover:bg-gray-200 hover:text-gray-600'}`}
                                        title="Mark Absent with Reason"
                                      >
                                        <DocumentTextIcon className="w-4 h-4" />
                                      </button>
                                      <div className={`w-6 h-6 shrink-0 rounded-full border-2 flex items-center justify-center transition-colors ${isPresent && !isReason ? 'bg-green-500 border-green-500' : (isReason ? 'bg-yellow-400 border-yellow-400' : 'bg-white border-gray-300 group-hover:border-brand-primary')}`}>
                                          {isPresent && <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                                      </div>
                                  </div>
                              </div>
                          );
                      })}
                      {filteredChecklist.length === 0 && (
                          <div className="col-span-full text-center py-10 text-gray-400">
                              No students found matching "{checklistSearch}"
                          </div>
                      )}
                  </div>
              </div>
          </div>
      ) : (
      <>
        {/* Mobile View Switcher (Tabs) */}
        {viewMode === 'teacher' && (
          <div className="xl:hidden flex w-full bg-gray-200 p-1 rounded-xl shadow-inner mb-4">
            <button 
              onClick={() => setMobileTab('qr')}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-bold transition-all ${mobileTab === 'qr' ? 'bg-white text-brand-primary shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              <QrCodeIcon className="w-4 h-4" />
              QR & Settings
            </button>
            <button 
              onClick={() => setMobileTab('list')}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-bold transition-all ${mobileTab === 'list' ? 'bg-white text-brand-primary shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              <ListBulletIcon className="w-4 h-4" />
              Live List ({attendanceList.length})
            </button>
          </div>
        )}

        <div className={`grid grid-cols-1 gap-4 sm:gap-6 ${viewMode === 'teacher' ? 'xl:grid-cols-12' : ''} items-start transition-all duration-300`}>
          
          {/* LEFT COLUMN (List) */}
          {viewMode === 'teacher' && (
          <div className={`w-full xl:col-span-4 flex-col gap-4 ${mobileTab === 'list' ? 'flex' : 'hidden xl:flex'} order-2 xl:order-1`}>
            <div className="flex items-center flex-wrap gap-2 py-1" role="status" aria-label="System Status">
                <div className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-primary/10 text-brand-primary rounded-full text-xs font-bold border border-brand-primary/20" aria-label={`${attendanceList.length} students scanned`}>
                  <UserIcon className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{attendanceList.length} Scanned</span>
                </div>
                {!isOnline && (
                  <div className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-500 text-white rounded-full text-xs font-bold" aria-label="System is offline">
                    <GlobeIcon className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>OFFLINE</span>
                  </div>
                )}
                {pendingSyncCount > 0 && isOnline && (
                  <div className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-100 text-blue-700 rounded-full text-xs font-bold animate-pulse" aria-label={`${pendingSyncCount} records syncing`}>
                    <GlobeIcon className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                    <span>{pendingSyncCount} Syncing...</span>
                  </div>
                )}
            </div>
            
            {isOfflineMode && (
              <div className="w-full flex flex-col items-center p-6 bg-white rounded-xl shadow-md border-2 border-dashed border-brand-primary">
                  <div className="flex items-center gap-2 text-brand-primary mb-3">
                      <div className="w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse" aria-hidden="true"></div>
                      <h3 className="text-sm font-bold uppercase tracking-wider">Offline Hub Active</h3>
                  </div>
                  <button 
                    onClick={() => setShowScanner(true)} 
                    className="w-full flex items-center justify-center gap-3 px-4 py-4 bg-brand-primary text-white text-lg font-bold rounded-xl shadow-lg hover:bg-brand-secondary transition-all active:scale-95"
                    aria-label="Scan Student QR Code"
                  >
                      <CameraIcon className="w-6 h-6" aria-hidden="true" />
                      Scan Student QR
                  </button>
              </div>
            )}

            <div className="bg-white rounded-xl shadow-sm border border-gray-200 flex-1 flex flex-col overflow-hidden min-h-[50vh] xl:min-h-[400px]">
              {visibleList.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-gray-400 p-8">
                  <UserIcon className="w-12 h-12 mb-2 opacity-20" aria-hidden="true" />
                  <p className="text-sm">No records yet.</p>
                </div>
              ) : (
                <div className="overflow-y-auto flex-1">
                  <table className="w-full text-sm text-left">
                    <thead className="text-xs text-gray-500 uppercase bg-gray-50 sticky top-0 z-10">
                      <tr>
                        <th scope="col" className="px-4 py-3">Student</th>
                        <th scope="col" className="px-4 py-3 text-right">Time</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {visibleList.map(s => {
                          const isReason = s.status !== 'P';
                          return (
                            <tr key={s.studentId} className={isReason ? "bg-yellow-50 hover:bg-yellow-100" : "hover:bg-gray-50"}>
                              <td className="px-4 py-3">
                                <p className={`font-bold text-sm ${isReason ? 'text-yellow-900' : 'text-gray-800'}`}>{s.name}</p>
                                <p className="font-mono text-[10px] sm:text-xs text-gray-500">{s.studentId}</p>
                              </td>
                              <td className="px-4 py-3 text-right">
                                <div className="flex flex-col items-end gap-1">
                                    <span className="text-gray-400 text-xs">{new Date(s.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                                    {pendingIds.has(s.studentId) ? (
                                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-orange-100 text-orange-700">
                                            <ClockIcon className="w-3 h-3" />
                                            <span>Pending</span>
                                        </span>
                                    ) : (
                                        isReason ? (
                                           <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-yellow-200 text-yellow-800">
                                              <span>{s.status}</span>
                                           </span>
                                        ) : (
                                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-50 text-green-700 opacity-70">
                                              <CheckCircleIcon className="w-3 h-3" />
                                              <span>Saved</span>
                                          </span>
                                        )
                                    )}
                                </div>
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
          )}

          {/* RIGHT COLUMN (QR + Settings) */}
          <div className={`w-full flex flex-col items-center bg-white p-4 sm:p-8 rounded-2xl shadow-xl border order-1 xl:order-2 transition-all duration-500 ease-in-out z-0 ${viewMode === 'teacher' ? 'xl:col-span-8' : 'col-span-1 xl:col-span-12 min-h-[85vh] justify-center'} ${viewMode === 'teacher' && mobileTab === 'list' ? 'hidden xl:flex' : 'flex'}`}>
            
            {/* QR Code Section - Reordered for Mobile to be at the top visually via Flex order or just placed first */}
            <div className="w-full flex flex-col items-center mb-6 order-1">
                <h2 className={`font-bold text-brand-primary tracking-tight text-center transition-all duration-300 ${viewMode === 'classroom' ? 'text-4xl sm:text-5xl mb-6 sm:mb-12' : 'text-xl sm:text-2xl mb-4 sm:mb-6'}`}>Scan to Check-in</h2>
                
                <div 
                  className={`bg-white p-2 rounded-3xl shadow-[inset_0_2px_8px_rgba(0,0,0,0.05)] border relative w-full transition-all duration-500 ease-in-out ${
                      viewMode === 'teacher' 
                      ? 'max-w-[100px] sm:max-w-[130px]' 
                      : 'max-w-[85vmin] max-h-[85vmin]'
                  } aspect-square flex items-center justify-center z-10 mx-auto`}
                  role="img"
                  aria-label="Dynamic QR Code for attendance. Updates every second."
                >
                   {isQrLoading && (
                      <div className="absolute inset-0 flex items-center justify-center bg-white/80 z-10" aria-label="Loading QR Code">
                          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-primary"></div>
                      </div>
                   )}
                  <canvas ref={canvasRef} className="w-full h-full object-contain" />
                </div>
                
                <div className="mt-6 flex flex-col items-center">
                  <div className="flex items-center gap-2 text-green-600 bg-green-50 px-3 py-1 rounded-full border" role="status">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                    </span>
                    <span className="text-xs font-bold uppercase tracking-wide">Live Security Active</span>
                  </div>
                  <p className="text-gray-400 text-xs mt-1">QR Code refreshes every second.</p>
                </div>
            </div>

            {/* Configuration Section - Below QR Code on Mobile for "Teacher" view */}
            {viewMode === 'teacher' && (
                <div className="w-full space-y-4 mb-6 relative z-20 order-2">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                    <div className="bg-gray-50 p-3 rounded-xl border">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className={`p-2 rounded-lg ${isOfflineMode ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}`} aria-hidden="true">
                            <GlobeIcon className="w-5 h-5"/>
                          </div>
                          <div>
                            <p className="text-xs font-bold text-gray-700 uppercase" id="session-mode-label">SESSION MODE</p>
                            <p className="text-[10px] text-gray-500">{isOfflineMode ? 'Offline Hub' : 'Live Sync'}</p>
                          </div>
                        </div>
                        <input 
                          type="checkbox" 
                          checked={isOfflineMode} 
                          onChange={() => setIsOfflineMode(!isOfflineMode)} 
                          className="toggle toggle-error [--tglbg:theme(colors.green.500)] bg-green-200 hover:bg-green-300 border-green-300"
                          aria-labelledby="session-mode-label"
                        />
                      </div>
                    </div>
                    <div className="bg-gray-50 p-3 rounded-xl border">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className={`p-2 rounded-lg ${isGeoEnabled ? 'bg-blue-100 text-blue-600' : 'bg-gray-200 text-gray-500'}`} aria-hidden="true">
                            <MapPinIcon className="w-5 h-5"/>
                          </div>
                          <div>
                            <p className="text-xs font-bold text-gray-700 uppercase" id="gps-geofence-label">GPS GEOFENCE</p>
                            <p className="text-[10px] text-gray-500">Require 150m Radius</p>
                          </div>
                        </div>
                        <input 
                          type="checkbox" 
                          checked={isGeoEnabled} 
                          onChange={() => setIsGeoEnabled(!isGeoEnabled)} 
                          className="toggle toggle-info" 
                          aria-labelledby="gps-geofence-label"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-between items-center border-t pt-4">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wide">Configuration</label>
                    <button 
                      onClick={() => setShowSettings(!showSettings)} 
                      className="text-xs text-brand-primary hover:text-brand-secondary font-bold uppercase tracking-wide underline decoration-dotted"
                      aria-expanded={showSettings}
                      aria-controls="settings-panel"
                    >
                      {showSettings ? 'Close' : 'Settings'}
                    </button>
                  </div>
                  {showSettings && (
                      <div id="settings-panel" className="p-4 sm:p-5 bg-gray-50 rounded-xl border space-y-5" role="region" aria-label="Settings">
                        <GoogleSheetIntegrationInfo />
                        <div>
                          <label className="block text-sm font-bold text-gray-700 mb-2" htmlFor="script-url-input">Google Web App URL</label>
                          <input 
                            id="script-url-input" 
                            type="text" 
                            value={scriptUrl} 
                            onChange={(e) => onScriptUrlChange(e.target.value)} 
                            className="block w-full bg-white border border-gray-300 rounded-lg py-2.5 px-4 text-sm focus:ring-2 focus:ring-brand-primary" 
                            placeholder="https://script.google.com/..." 
                          />
                        </div>
                        
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-4 border-t">
                           <button 
                            onClick={onTestAttendance} 
                            className="sm:col-span-2 flex items-center justify-center gap-2 px-3 py-2 bg-indigo-50 border border-indigo-100 text-indigo-700 rounded-lg text-xs font-bold hover:bg-indigo-100 transition-colors"
                            aria-label="Send test data to cloud"
                          >
                            <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></div>
                            Test Cloud Keying
                          </button>
                          <button 
                            onClick={handleExportCSV} 
                            disabled={attendanceList.length === 0} 
                            className="flex items-center justify-center gap-2 px-3 py-2 bg-white border rounded-lg text-xs font-bold disabled:opacity-50"
                            aria-label="Export attendance as CSV"
                          >
                            <DownloadIcon className="w-4 h-4" aria-hidden="true" />Export CSV
                          </button>
                          <button 
                            onClick={onClearAttendance} 
                            disabled={attendanceList.length === 0} 
                            className="flex items-center justify-center gap-2 px-3 py-2 bg-red-50 border border-red-100 text-red-700 rounded-lg text-xs font-bold disabled:opacity-50"
                            aria-label="Clear attendance list"
                          >
                            <TrashIcon className="w-4 h-4" aria-hidden="true" />Clear List
                          </button>
                        </div>
                      </div>
                  )}
              </div>
            )}
          </div>
        </div>
      </>
      )}
      
      {showScanner && <QrScanner onScan={handleScanResult} onClose={() => setShowScanner(false)} />}

      {scanResult && (
        <div className="fixed inset-0 flex items-center justify-center z-[200] pointer-events-none p-4">
             <div 
                className={`transform transition-all duration-300 ease-out translate-y-0 opacity-100 flex flex-col items-center justify-center p-6 sm:p-8 rounded-3xl shadow-2xl border-4 ${
                    scanResult.type === 'success' ? 'bg-white border-green-500 text-green-700' : 
                    scanResult.type === 'duplicate' ? 'bg-white border-yellow-500 text-yellow-700' :
                    'bg-white border-red-500 text-red-700'
                }`}
                role="alert"
             >
                <div className={`rounded-full p-4 mb-4 ${
                    scanResult.type === 'success' ? 'bg-green-100' : 
                    scanResult.type === 'duplicate' ? 'bg-yellow-100' :
                    'bg-red-100'
                }`}>
                    {scanResult.type === 'success' && <CheckCircleIcon className="w-12 h-12 sm:w-16 sm:h-16 text-green-600" />}
                    {scanResult.type === 'duplicate' && <UserIcon className="w-12 h-12 sm:w-16 sm:h-16 text-yellow-600" />}
                    {scanResult.type === 'error' && <XCircleIcon className="w-12 h-12 sm:w-16 sm:h-16 text-red-600" />}
                </div>
                <h3 className="text-xl sm:text-2xl font-black uppercase tracking-tight mb-1 text-center">
                    {scanResult.type === 'success' ? 'Checked In' : 
                     scanResult.type === 'duplicate' ? 'Already Scanned' : 'Scan Failed'}
                </h3>
                <p className="text-base sm:text-lg font-bold text-center max-w-xs">{scanResult.message}</p>
             </div>
        </div>
      )}

      {/* Manual Add Modal */}
      {showManualModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="bg-gray-50 px-6 py-4 border-b flex justify-between items-center">
              <h3 className="text-lg font-bold text-gray-900">Manual Entry</h3>
              <button onClick={() => setShowManualModal(false)} className="text-gray-400 hover:text-gray-600">
                <XCircleIcon className="w-6 h-6" />
              </button>
            </div>
            <div className="p-6 space-y-4">
               <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Student ID</label>
                  <input 
                    type="text" 
                    value={manualId}
                    onChange={handleManualIdChange}
                    className="w-full border-2 border-gray-200 rounded-xl px-4 py-2 font-mono uppercase font-bold focus:border-brand-primary outline-none"
                    placeholder="FIA..."
                    autoFocus
                  />
               </div>
               <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Student Name</label>
                  <input 
                    type="text" 
                    value={manualName}
                    onChange={(e) => setManualName(e.target.value.toUpperCase())}
                    className={`w-full border-2 rounded-xl px-4 py-2 font-bold outline-none ${!manualIsNew && manualName ? 'bg-gray-100 border-transparent text-gray-500' : 'border-gray-200 focus:border-brand-primary'}`}
                    readOnly={!manualIsNew && !!manualName}
                    placeholder="NAME"
                  />
               </div>
               {manualError && <p className="text-xs text-red-500 font-bold">{manualError}</p>}
               <button 
                 onClick={submitManualAdd}
                 className="w-full bg-brand-primary text-white font-bold py-3 rounded-xl hover:bg-brand-secondary active:scale-95 transition-all"
               >
                 Add to List
               </button>
            </div>
          </div>
        </div>
      )}

      {/* Reason Modal */}
      {reasonModalStudent && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in duration-200">
             <div className="bg-yellow-50 px-6 py-4 border-b border-yellow-100 flex justify-between items-center">
                <h3 className="text-lg font-bold text-yellow-800">Mark Absent with Reason</h3>
                <button onClick={() => setReasonModalStudent(null)} className="text-yellow-600 hover:text-yellow-800">
                   <XCircleIcon className="w-6 h-6" />
                </button>
             </div>
             <div className="p-6">
                <p className="text-sm font-bold text-gray-800 mb-1">{reasonModalStudent.name}</p>
                <p className="text-xs text-gray-400 font-mono mb-4">{reasonModalStudent.id}</p>
                
                <div className="grid grid-cols-2 gap-2 mb-4">
                   {['Medical', 'University Activity', 'Exempt', 'Other'].map(r => (
                       <button 
                         key={r}
                         onClick={() => submitReason(r)}
                         className="px-3 py-2 bg-gray-50 border hover:bg-yellow-50 hover:border-yellow-200 hover:text-yellow-700 rounded-lg text-xs font-bold transition-all"
                       >
                         {r}
                       </button>
                   ))}
                </div>
                
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Custom Reason</label>
                <div className="flex gap-2">
                    <input 
                      type="text" 
                      value={reasonInput}
                      onChange={(e) => setReasonInput(e.target.value)}
                      className="flex-1 border-2 border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-yellow-400 outline-none"
                      placeholder="Type reason..."
                    />
                    <button 
                      onClick={() => submitReason(reasonInput || 'Other')}
                      className="px-4 py-2 bg-yellow-400 text-yellow-900 font-bold rounded-lg hover:bg-yellow-500 transition-colors"
                    >
                      Save
                    </button>
                </div>
             </div>
          </div>
        </div>
      )}
    </div>
  );
};