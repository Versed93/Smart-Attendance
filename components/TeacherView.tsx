import React, { useState, useEffect, useRef } from 'react';
import type { Student, SyncTask } from '../types';
import QRCode from 'qrcode';
import { DownloadIcon } from './icons/DownloadIcon';
import { EyeIcon } from './icons/EyeIcon';
import { EyeSlashIcon } from './icons/EyeSlashIcon';
import { UserIcon } from './icons/UserIcon';
import { TrashIcon } from './icons/TrashIcon';
import { ShieldCheckIcon } from './icons/ShieldCheckIcon';
import { PencilSquareIcon } from './icons/PencilSquareIcon';
import { ClockIcon } from './icons/ClockIcon';
import { CheckCircleIcon } from './icons/CheckCircleIcon';
import { XCircleIcon } from './icons/XCircleIcon';
import { GlobeIcon } from './icons/GlobeIcon';
import { MapPinIcon } from './icons/MapPinIcon';
import { ExclamationTriangleIcon } from './icons/ExclamationTriangleIcon';
import { LockClosedIcon } from './icons/LockClosedIcon';
import { SpeakerWaveIcon } from './icons/SpeakerWaveIcon';
import { SpeakerXMarkIcon } from './icons/SpeakerXMarkIcon';
import { GoogleSheetIntegrationInfo } from './GoogleSheetIntegrationInfo';
import { PRE_REGISTERED_STUDENTS } from '../studentList';

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
  pendingSyncCount?: number;
  syncQueue?: SyncTask[];
  syncError?: string | null;
  onRetrySync?: () => void;
  isOnline?: boolean;
  onLogout: () => void;
}

type SortOption = 'id' | 'newest' | 'oldest';

interface TestStats {
    total: number;
    success: number;
    retrying: number;
    failed: number;
    isRunning: boolean;
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
  pendingSyncCount = 0,
  syncQueue = [],
  syncError = null,
  onRetrySync,
  isOnline = true,
  onLogout
}) => {
  const [baseUrl, setBaseUrl] = useState<string>(window.location.href.split('?')[0]);
  const [qrData, setQrData] = useState<string>('');
  
  const [courseName, setCourseName] = useState(() => localStorage.getItem('attendance-course-name') || '');
  
  const [showEmailSetup, setShowEmailSetup] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<'teacher' | 'classroom'>('teacher');
  const [isSoundEnabled, setIsSoundEnabled] = useState(true);
  
  const [sortBy, setSortBy] = useState<SortOption>('newest');
  
  // Geofencing State
  const [isGeoEnabled, setIsGeoEnabled] = useState(false);
  const [teacherLocation, setTeacherLocation] = useState<{lat: number, lng: number} | null>(null);
  const [geoError, setGeoError] = useState('');
  
  // Filter State
  const [timeFilter, setTimeFilter] = useState<'all' | number>('all');
  const [currentTime, setCurrentTime] = useState(Date.now());
  
  // Selection State
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Manual Entry State
  const [showManualModal, setShowManualModal] = useState(false);
  const [manualId, setManualId] = useState('');
  const [manualName, setManualName] = useState('');
  const [manualStatus, setManualStatus] = useState<'P' | 'A'>('P');
  const [manualError, setManualError] = useState('');
  const [manualIsNew, setManualIsNew] = useState(false);

  // Stress Test State
  const [testStats, setTestStats] = useState<TestStats>({ total: 0, success: 0, retrying: 0, failed: 0, isRunning: false });

  // QR Loading State
  const [isQrLoading, setIsQrLoading] = useState(true);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isMountedRef = useRef(true);
  const prevCountRef = useRef(attendanceList.length);

  // Computed: Sync Status Map
  const pendingIds = new Set(syncQueue.map(t => t.data.studentId));

  // Sound Effect Logic using Web Audio API (Zero Assets)
  const playSuccessSound = () => {
    try {
        const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioContext) return;
        
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        
        // Pleasant "Ding" sound (Sine wave with decay)
        osc.type = 'sine';
        osc.frequency.setValueAtTime(800, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(400, ctx.currentTime + 0.3);
        
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
        
        osc.start();
        osc.stop(ctx.currentTime + 0.3);
    } catch (e) {
        console.error("Audio playback failed", e);
    }
  };

  useEffect(() => {
    if (attendanceList.length > prevCountRef.current) {
        if (isSoundEnabled) {
            playSuccessSound();
        }
    }
    prevCountRef.current = attendanceList.length;
  }, [attendanceList.length, isSoundEnabled]);

  useEffect(() => {
    localStorage.setItem('attendance-course-name', courseName);
  }, [courseName]);

  useEffect(() => {
    return () => { isMountedRef.current = false; };
  }, []);

  const toggleGeofence = () => {
      if (isGeoEnabled) {
          setIsGeoEnabled(false);
          setTeacherLocation(null);
          setGeoError('');
      } else {
          if (!navigator.geolocation) {
              setGeoError('Geolocation is not supported by this browser.');
              return;
          }
          setGeoError('');
          // Force fresh location (maximumAge: 0) to avoid using old cached coordinates
          navigator.geolocation.getCurrentPosition(
              (pos) => {
                  setTeacherLocation({
                      lat: pos.coords.latitude,
                      lng: pos.coords.longitude
                  });
                  setIsGeoEnabled(true);
              },
              (err) => {
                  console.error(err);
                  setGeoError('Location permission denied or unavailable.');
                  setIsGeoEnabled(false);
              },
              { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
          );
      }
  };

  useEffect(() => {
    const updateQR = () => {
        let cleanBaseUrl = baseUrl.trim();
        const timestamp = Date.now().toString();
        const separator = cleanBaseUrl.includes('?') ? '&' : '?';
        let params = `t=${timestamp}`;
        
        if (courseName) params += `&c=${encodeURIComponent(courseName)}`;
        if (isGeoEnabled && teacherLocation) {
            // Updated radius to 150m to be more permissive for indoor GPS drift
            params += `&lat=${teacherLocation.lat.toFixed(6)}&lng=${teacherLocation.lng.toFixed(6)}&rad=150`;
        }

        const fullUrl = `${cleanBaseUrl}${separator}${params}`;
        setQrData(fullUrl);
    };

    updateQR();
    const interval = setInterval(updateQR, 1000);
    return () => clearInterval(interval);
  }, [baseUrl, courseName, isGeoEnabled, teacherLocation]);

  useEffect(() => {
    if (canvasRef.current && qrData) {
      QRCode.toCanvas(canvasRef.current, qrData, { 
          width: 600, 
          color: { dark: '#000000', light: '#ffffff' },
          margin: 2,
          errorCorrectionLevel: 'M' // Medium error correction sufficient for standard QR
        }, (error) => {
        if (error) {
            console.error(error);
        }
        setIsQrLoading(false);
      });
    }
  }, [qrData]);

  useEffect(() => {
    if (timeFilter === 'all') return;
    const interval = setInterval(() => setCurrentTime(Date.now()), 10000);
    return () => clearInterval(interval);
  }, [timeFilter]);

  const sortList = (list: Student[]) => {
    const sorted = [...list];
    switch (sortBy) {
      case 'id': return sorted.sort((a, b) => a.studentId.localeCompare(b.studentId, undefined, { numeric: true }));
      case 'newest': return sorted.sort((a, b) => b.timestamp - a.timestamp);
      case 'oldest': return sorted.sort((a, b) => a.timestamp - b.timestamp);
      default: return sorted;
    }
  };

  const visibleList = sortList(timeFilter === 'all' ? attendanceList : attendanceList.filter(s => s.timestamp >= (currentTime - (timeFilter * 60 * 1000))));

  // Live Stream items (Last 3)
  const liveStreamItems = [...attendanceList].sort((a, b) => b.timestamp - a.timestamp).slice(0, 3);

  const handleExportCSV = () => {
    if (attendanceList.length === 0) return;
    const headers = ['Timestamp', 'Student Name', 'Student ID', 'Email', 'Status', 'Sync Status'];
    const dataToExport = sortList(attendanceList);
    const csvContent = [headers.join(','), ...dataToExport.map(student => [
        new Date(student.timestamp).toLocaleString(), 
        `"${student.name}"`, 
        `"${student.studentId}"`, 
        `"${student.email}"`, 
        student.status,
        pendingIds.has(student.studentId) ? 'PENDING' : 'SAVED'
    ].join(','))].join('\n');
    const blob = new Blob(["\ufeff" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `attendance-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
  };

  const handleBackupPending = () => {
    if (syncQueue.length === 0) return;
    const headers = ['Timestamp', 'Student Name', 'Student ID', 'Email', 'Status'];
    const csvContent = [headers.join(','), ...syncQueue.map(task => [
        new Date(task.timestamp).toLocaleString(), 
        `"${task.data.name}"`, 
        `"${task.data.studentId}"`, 
        `"${task.data.email}"`, 
        task.data.status
    ].join(','))].join('\n');
    const blob = new Blob(["\ufeff" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `backup-failed-sync-${new Date().toISOString()}.csv`;
    link.click();
  };

  const handleBulkRemove = () => {
    if (selectedIds.size === 0) return;
    if (window.confirm(`Are you sure you want to remove the ${selectedIds.size} selected students?`)) {
      onRemoveStudents(Array.from(selectedIds));
      setSelectedIds(new Set());
    }
  };

  const handleBulkStatusChange = (status: 'P' | 'A') => {
    if (selectedIds.size === 0) return;
    const statusLabel = status === 'P' ? 'Present' : 'Absent';
    if (window.confirm(`Mark ${selectedIds.size} selected students as ${statusLabel}?`)) {
      onBulkStatusUpdate(Array.from(selectedIds), status);
      setSelectedIds(new Set());
    }
  };

  // --- STRESS TEST LOGIC ---
  const runStressTest = async () => {
    if (!scriptUrl || !scriptUrl.startsWith('http')) { alert("Set a valid Script URL first."); return; }
    if (!window.confirm("Simulating 230 students.\n\nNOTE: To prevent Google Server Errors (Lock Timeout), we will simulate a realistic queue of students.\n\nThis will take about 3 minutes. Please do not close the tab.")) return;

    setTestStats({ total: 230, success: 0, retrying: 0, failed: 0, isRunning: true });
    
    // Prepare 230 test subjects
    const testPool = [...PRE_REGISTERED_STUDENTS];
    // Ensure we have at least 230 items
    while(testPool.length < 230) {
        testPool.push({ id: `STRESS-${testPool.length + 1}-${Date.now()}`, name: `STRESS TESTER ${testPool.length + 1}` });
    }
    const finalPool = testPool.slice(0, 230);

    // Track completion to turn off the spinner
    let completedCount = 0;
    const checkCompletion = () => {
        completedCount++;
        if (completedCount >= finalPool.length && isMountedRef.current) {
            setTestStats(prev => ({ ...prev, isRunning: false }));
            console.log("Stress Test Completed");
        }
    };

    // OPTIMIZED FOR 100% SUCCESS RATE
    // Google Sheets LockService waits 30s. Writing takes ~1.5s.
    // 30s / 1.5s = ~20 requests max queue depth.
    // By sending 3 requests every 2 seconds (1.5 req/s), we match the write speed.
    const CHUNK_SIZE = 3; 
    const DELAY_MS = 2000; 

    console.log(`Starting stress test: ${finalPool.length} students, chunk size ${CHUNK_SIZE}, delay ${DELAY_MS}ms`);

    for (let i = 0; i < finalPool.length; i += CHUNK_SIZE) {
        const chunk = finalPool.slice(i, i + CHUNK_SIZE);
        
        chunk.forEach((student) => {
            const attemptSync = async (retries = 0) => {
                try {
                    const formData = new URLSearchParams();
                    formData.append('studentId', student.id);
                    formData.append('name', student.name);
                    formData.append('email', `${student.id}@student.uts.edu.my`);
                    formData.append('status', 'P');

                    // Add cache busting and random param to avoid browser aggressive caching/batching
                    const uniqueUrl = `${scriptUrl}${scriptUrl.includes('?') ? '&' : '?'}cb=${Date.now()}-${Math.random()}`;

                    const response = await fetch(uniqueUrl, {
                        method: 'POST',
                        body: formData,
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    });

                    if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
                    
                    const text = await response.text();
                    let res;
                    try {
                        res = JSON.parse(text);
                    } catch {
                        throw new Error("Invalid Server Response");
                    }

                    if (res.result !== 'success') throw new Error(res.message || "Script Rejected");

                    if (isMountedRef.current) {
                        setTestStats(prev => ({ 
                            ...prev, 
                            success: prev.success + 1, 
                            retrying: Math.max(0, prev.retrying - (retries > 0 ? 1 : 0)) 
                        }));
                    }
                    checkCompletion();
                } catch (err) {
                    console.warn(`Failed ${student.id} retry ${retries}:`, err);
                    if (retries < 4) {
                        if (isMountedRef.current) {
                            setTestStats(prev => ({ ...prev, retrying: prev.retrying + (retries === 0 ? 1 : 0) }));
                        }
                        // Jitter to spread out retry load
                        const jitter = 3000 + Math.random() * 4000; 
                        setTimeout(() => attemptSync(retries + 1), jitter);
                    } else {
                        if (isMountedRef.current) {
                            setTestStats(prev => ({ 
                                ...prev, 
                                failed: prev.failed + 1, 
                                retrying: Math.max(0, prev.retrying - 1) 
                            }));
                        }
                        checkCompletion();
                    }
                }
            };
            attemptSync();
        });

        // Delay between chunks to allow browser event loop to breathe and network request dispatch
        await new Promise(resolve => setTimeout(resolve, DELAY_MS));
    }
  };

  return (
    <div className="w-full max-w-[1600px] mx-auto p-4 sm:p-6 space-y-6">
       {/* Professional Header */}
       <div className="flex flex-col sm:flex-row justify-between items-center bg-white p-4 rounded-2xl shadow-sm border border-gray-100 gap-4">
         <div className="flex items-center gap-4 w-full sm:w-auto justify-center sm:justify-start">
             <div className="flex items-center justify-center w-12 h-12 bg-gradient-to-br from-brand-primary to-brand-secondary text-white rounded-xl shadow-lg shadow-brand-primary/20 shrink-0">
                 <ShieldCheckIcon className="w-7 h-7" />
             </div>
             <div className="flex flex-col">
                 <h1 className="text-2xl font-black text-gray-900 tracking-tight leading-none text-center sm:text-left">UTS ATTENDANCE</h1>
                 <p className="text-xs text-gray-500 font-bold tracking-[0.2em] mt-1 text-center sm:text-left">Secure Check-In System</p>
             </div>
         </div>
         
         <div className="flex items-center gap-2 w-full sm:w-auto justify-center sm:justify-end">
            <button
                onClick={() => setIsSoundEnabled(!isSoundEnabled)}
                className={`flex items-center justify-center w-12 h-12 rounded-xl border transition-colors shadow-sm ${isSoundEnabled ? 'bg-indigo-50 text-indigo-600 border-indigo-100 hover:bg-indigo-100' : 'bg-gray-50 text-gray-400 border-gray-200 hover:bg-gray-100'}`}
                title={isSoundEnabled ? "Mute Sound" : "Enable Sound"}
            >
                {isSoundEnabled ? <SpeakerWaveIcon className="w-5 h-5" /> : <SpeakerXMarkIcon className="w-5 h-5" />}
            </button>
            <button 
                onClick={() => setViewMode(viewMode === 'teacher' ? 'classroom' : 'teacher')} 
                className={`group flex items-center gap-3 px-5 py-3 rounded-xl font-bold transition-all duration-200 justify-center sm:justify-between ${
                    viewMode === 'teacher' 
                    ? 'bg-gray-50 text-gray-700 hover:bg-gray-100 border border-gray-200' 
                    : 'bg-gray-900 text-white hover:bg-gray-800 shadow-xl shadow-gray-900/10'
                }`}
                title={viewMode === 'teacher' ? "Switch to Classroom Mode for Projector" : "Return to Dashboard"}
            >
                <div className="flex flex-col items-end text-right mr-1">
                    <span className="text-[10px] uppercase opacity-60 font-medium leading-none mb-1">View Mode</span>
                    <span className="text-xs uppercase tracking-wider leading-none">
                        {viewMode === 'teacher' ? 'Dashboard' : 'Classroom'}
                    </span>
                </div>
                {viewMode === 'teacher' ? <EyeIcon className="w-5 h-5" /> : <EyeSlashIcon className="w-5 h-5 text-gray-300" />}
            </button>
            
            <button
                onClick={onLogout}
                className="flex items-center justify-center w-12 h-12 bg-red-50 text-red-600 rounded-xl border border-red-100 hover:bg-red-100 hover:border-red-200 transition-colors shadow-sm"
                title="Log Out"
            >
                <LockClosedIcon className="w-5 h-5" />
            </button>
         </div>
       </div>

      {/* Main Content: Using CSS Grid for robust layout */}
      <div className={`grid grid-cols-1 gap-6 ${viewMode === 'teacher' ? 'xl:grid-cols-12' : ''} items-start`}>
        
        {/* LEFT COLUMN - HISTORY & CONTROLS (HIDDEN IN CLASSROOM MODE) */}
        {/* Takes up 4 columns (1/3 width) on XL screens */}
        {viewMode === 'teacher' && (
        <div className="w-full xl:col-span-4 order-2 xl:order-1 flex flex-col gap-4">
          
          {/* LIVE CONCURRENCY MONITOR */}
          <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200">
             <div className="flex justify-between items-center mb-3">
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wide flex items-center gap-2">
                   <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                   Live Activity
                </h3>
                {syncError && syncQueue.length > 0 && (
                    <button onClick={handleBackupPending} className="text-[10px] bg-red-100 text-red-700 px-2 py-1 rounded border border-red-200 hover:bg-red-200 font-bold transition-colors">
                        ⚠ Backup Pending Data
                    </button>
                )}
             </div>
             
             <div className="space-y-2">
                 {liveStreamItems.length === 0 ? (
                     <div className="text-center py-4 text-gray-400 text-xs italic">Waiting for scans...</div>
                 ) : (
                     liveStreamItems.map(student => {
                         const isPending = pendingIds.has(student.studentId);
                         return (
                            <div key={`live-${student.studentId}`} className={`flex items-center justify-between p-3 rounded-lg border transition-all duration-300 ${isPending ? (syncError ? 'bg-red-50 border-red-100' : 'bg-blue-50 border-blue-100') : 'bg-green-50/50 border-green-100'}`}>
                                <div className="flex items-center gap-3 overflow-hidden">
                                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${isPending ? (syncError ? 'bg-red-200 text-red-700' : 'bg-blue-200 text-blue-700 animate-pulse') : 'bg-green-200 text-green-700'}`}>
                                        {student.name.charAt(0)}
                                    </div>
                                    <div className="min-w-0">
                                        <p className="text-xs font-bold text-gray-900 truncate">{student.name}</p>
                                        <p className="text-[10px] text-gray-500 font-mono truncate">{student.studentId}</p>
                                    </div>
                                </div>
                                <div className="flex flex-col items-end shrink-0">
                                    {isPending ? (
                                        syncError ? 
                                        <span className="text-[10px] font-bold text-red-600 bg-red-100 px-1.5 py-0.5 rounded">Failed</span> :
                                        <span className="text-[10px] font-bold text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded animate-pulse">Syncing</span>
                                    ) : (
                                        <CheckCircleIcon className="w-4 h-4 text-green-500" />
                                    )}
                                    <span className="text-[9px] text-gray-400 mt-0.5">{new Date(student.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'})}</span>
                                </div>
                            </div>
                         );
                     })
                 )}
             </div>
          </div>

          <div className="flex flex-col gap-3">
             <div className="flex justify-between items-center flex-wrap gap-2">
                <div className="flex items-center gap-3">
                    <h2 className="text-xl font-bold text-gray-800">History</h2>
                </div>
                <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1 bg-white border border-gray-300 rounded-lg px-2 py-1 shadow-sm">
                        <ClockIcon className="w-3 h-3 text-gray-500" />
                        <select value={timeFilter} onChange={(e) => setTimeFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))} className="text-xs bg-transparent text-gray-700 border-none focus:ring-0 cursor-pointer">
                            <option value="all">Show All</option>
                            <option value="5">Last 5 Mins</option>
                            <option value="30">Last 30 Mins</option>
                        </select>
                    </div>
                    <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortOption)} className="text-xs border border-gray-300 rounded-lg px-2 py-1 bg-white cursor-pointer shadow-sm">
                        <option value="newest">Newest</option>
                        <option value="id">ID</option>
                    </select>
                </div>
             </div>

            <div className="flex items-center flex-wrap gap-2 py-1">
                <div className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-primary/10 text-brand-primary rounded-full text-xs font-bold border border-brand-primary/20 shadow-sm transition-all">
                    <UserIcon className="w-3.5 h-3.5" />
                    <span>{attendanceList.length} Scanned</span>
                </div>
                
                {!isOnline ? (
                   <div className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-500 text-white rounded-full text-xs font-bold border border-gray-600 shadow-sm transition-all">
                       <GlobeIcon className="w-3.5 h-3.5" />
                       <span>OFFLINE MODE</span>
                   </div>
                ) : syncError ? (
                   <button onClick={onRetrySync} className="flex items-center gap-1.5 px-3 py-1.5 bg-red-100 text-red-700 rounded-full text-xs font-bold border border-red-200 shadow-sm animate-pulse hover:bg-red-200 transition-all cursor-pointer">
                      <ExclamationTriangleIcon className="w-3.5 h-3.5" />
                      <span>Sync Error (Retry)</span>
                   </button>
                ) : (
                    pendingSyncCount > 0 && (
                        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-100 text-blue-700 rounded-full text-xs font-bold border border-blue-200 shadow-sm animate-pulse transition-all">
                            <GlobeIcon className="w-3.5 h-3.5 animate-spin" style={{ animationDuration: '3s' }} />
                            <span>{pendingSyncCount} Syncing...</span>
                        </div>
                    )
                )}
            </div>
            
            <div className="flex flex-col gap-3 mt-1">
                     {/* PRIMARY ACTIONS */}
                     <div className="grid grid-cols-2 gap-3">
                        <button onClick={() => setShowManualModal(true)} className="flex items-center justify-center gap-2 px-4 py-2.5 bg-brand-primary text-white text-sm font-bold rounded-lg shadow-md hover:bg-brand-secondary transition-all active:scale-95">
                            <PencilSquareIcon className="w-4 h-4" />
                            Add Student
                        </button>
                        <button onClick={handleExportCSV} disabled={attendanceList.length === 0} className="flex items-center justify-center gap-2 px-4 py-2.5 bg-white text-gray-700 border border-gray-200 text-sm font-bold rounded-lg shadow-sm hover:bg-gray-50 hover:border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95">
                            <DownloadIcon className="w-4 h-4 text-gray-500" />
                            Export CSV
                        </button>
                        {syncQueue.length > 0 && (
                            <button onClick={handleBackupPending} className="col-span-2 flex items-center justify-center gap-2 px-4 py-2 bg-yellow-100 text-yellow-800 border border-yellow-200 text-sm font-bold rounded-lg shadow-sm hover:bg-yellow-200 transition-all active:scale-95">
                                <DownloadIcon className="w-4 h-4" />
                                Export Pending ({syncQueue.length})
                            </button>
                        )}
                    </div>

                    <div className="flex flex-wrap gap-2">
                        {selectedIds.size > 0 ? (
                            <div className="flex-1 flex flex-wrap gap-2">
                                <button onClick={() => handleBulkStatusChange('P')} className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-green-600 text-white text-xs font-semibold rounded-lg shadow-sm hover:bg-green-700 transition-colors">
                                    <CheckCircleIcon className="w-4 h-4" />Present
                                </button>
                                <button onClick={() => handleBulkStatusChange('A')} className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-orange-500 text-white text-xs font-semibold rounded-lg shadow-sm hover:bg-orange-600 transition-colors">
                                    <XCircleIcon className="w-4 h-4" />Absent
                                </button>
                                <button onClick={handleBulkRemove} className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-red-600 text-white text-xs font-semibold rounded-lg shadow-sm hover:bg-red-700 transition-colors">
                                    <TrashIcon className="w-4 h-4" />Remove
                                </button>
                            </div>
                        ) : (
                            <div className="flex flex-1 gap-2">
                                <button onClick={onOpenKiosk} className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-gray-50 text-gray-700 text-xs font-semibold rounded-lg border border-gray-200 hover:bg-gray-100 transition-colors">
                                    <ShieldCheckIcon className="w-4 h-4" />
                                    Admin Mode
                                </button>
                                <button onClick={onClearAttendance} disabled={attendanceList.length === 0} className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-red-50 text-red-700 text-xs font-semibold rounded-lg border border-red-100 hover:bg-red-100 disabled:opacity-50 transition-colors">
                                    <TrashIcon className="w-4 h-4" />
                                    Clear List
                                </button>
                            </div>
                        )}
                    </div>
                </div>
          </div>
          
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 flex-1 flex flex-col overflow-hidden min-h-[400px]">
            {visibleList.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                  <UserIcon className="w-12 h-12 mb-2 opacity-20" />
                  <p className="text-sm">No records to display.</p>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto max-h-[600px]">
                {/* Scroll wrapper for table to prevent overlap on small screens */}
                <div className="min-w-full inline-block align-middle">
                    <div className="overflow-x-auto">
                        <table className="min-w-[400px] w-full text-sm text-left text-gray-700">
                        <thead className="text-xs text-gray-500 uppercase bg-gray-50 sticky top-0 z-10 border-b border-gray-200">
                            <tr>
                            <th className="px-4 py-3 w-8"><input type="checkbox" className="rounded border-gray-300 text-brand-primary focus:ring-brand-primary" checked={visibleList.length > 0 && visibleList.every(s => selectedIds.has(s.studentId))} onChange={() => { if(selectedIds.size === visibleList.length) setSelectedIds(new Set()); else setSelectedIds(new Set(visibleList.map(s => s.studentId))); }} /></th>
                            <th className="px-4 py-3 font-semibold whitespace-nowrap">Student ID</th>
                            <th className="px-4 py-3 font-semibold">Status</th>
                            <th className="px-4 py-3 text-right font-semibold">Time</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {visibleList.map((student) => {
                                const isPending = pendingIds.has(student.studentId);
                                return (
                                <tr key={`${student.studentId}-${student.timestamp}`} className={`hover:bg-gray-50 transition-colors ${selectedIds.has(student.studentId) ? 'bg-indigo-50/60' : ''}`}>
                                    <td className="px-4 py-3"><input type="checkbox" className="rounded border-gray-300 text-brand-primary focus:ring-brand-primary" checked={selectedIds.has(student.studentId)} onChange={() => { const next = new Set(selectedIds); if(next.has(student.studentId)) next.delete(student.studentId); else next.add(student.studentId); setSelectedIds(next); }} /></td>
                                    <td className="px-4 py-3 font-mono font-medium text-gray-900 whitespace-nowrap flex items-center gap-2">
                                        {student.studentId}
                                        {/* TABLE STATUS ICON */}
                                        {isPending ? (
                                            syncError ? 
                                            <div title="Sync Failed" className="w-2 h-2 rounded-full bg-red-500"></div> :
                                            <div title="Syncing..." className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></div>
                                        ) : (
                                            <div title="Saved to Cloud" className="w-2 h-2 rounded-full bg-green-500"></div>
                                        )}
                                    </td>
                                    <td className="px-4 py-3">
                                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide whitespace-nowrap ${student.status === 'P' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                            {student.status === 'P' ? 'Present' : 'Absent'}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-right text-gray-400 text-xs tabular-nums whitespace-nowrap">{new Date(student.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</td>
                                </tr>
                                );
                            })}
                        </tbody>
                        </table>
                    </div>
                </div>
              </div>
            )}
          </div>
        </div>
        )}

        {/* RIGHT COLUMN - QR CODE */}
        {/* Takes 8 columns (2/3 width) on XL screens */}
        <div className={`w-full flex flex-col items-center bg-white p-6 sm:p-8 rounded-2xl shadow-xl border border-gray-100 order-1 xl:order-2 ${viewMode === 'teacher' ? 'xl:col-span-8' : 'max-w-4xl mx-auto shadow-2xl border-brand-primary/10'}`}>
          {viewMode === 'teacher' && (
              <div className="w-full space-y-4 mb-6">
                  <div className="flex justify-between items-center">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wide">Configuration</label>
                    <button onClick={() => setShowEmailSetup(!showEmailSetup)} className="text-xs text-brand-primary hover:text-brand-secondary font-bold uppercase tracking-wide underline decoration-dotted underline-offset-4">
                        {showEmailSetup ? 'Close Settings' : 'Google Sheets & Stress Test'}
                    </button>
                  </div>
                  
                  {showEmailSetup && (
                    <div className="p-5 bg-gray-50 rounded-xl border border-gray-200 space-y-5 animate-in fade-in slide-in-from-top-2 duration-300">
                      <GoogleSheetIntegrationInfo />
                      <div>
                          <label className="block text-sm font-bold text-gray-700 mb-2">Google Web App URL</label>
                          <input type="text" value={scriptUrl} onChange={(e) => onScriptUrlChange(e.target.value)} className="block w-full bg-white border border-gray-300 rounded-lg py-2.5 px-4 text-sm text-gray-800 focus:ring-2 focus:ring-brand-primary focus:border-brand-primary transition-shadow" placeholder="https://script.google.com/..." />
                          <p className="text-xs text-gray-400 mt-1">Paste the URL from your Google Apps Script deployment here.</p>
                      </div>
                      
                      {/* NEW TEST BUTTON SECTION */}
                      <div className="flex items-center justify-between bg-indigo-50 p-4 rounded-lg border border-indigo-100">
                          <div>
                              <h4 className="text-sm font-bold text-indigo-900">Connectivity Check</h4>
                              <p className="text-xs text-indigo-700 mt-0.5">Adds a dummy student record to verify cloud sync.</p>
                          </div>
                          <button onClick={onTestAttendance} className="px-4 py-2 bg-indigo-600 text-white text-xs font-bold rounded-lg hover:bg-indigo-700 transition-colors shadow-sm active:scale-95">
                              Add Test Student
                          </button>
                      </div>

                      {/* STRESS TEST BOX */}
                      <div className="p-4 bg-orange-50 border border-orange-200 rounded-lg">
                        <div className="flex justify-between items-center mb-3">
                            <h4 className="text-sm font-bold text-orange-800">Concurrency Stress Test</h4>
                            {!testStats.isRunning ? (
                                <button onClick={runStressTest} className="px-3 py-1 bg-orange-600 text-white text-xs font-bold rounded-full hover:bg-orange-700 shadow-sm transition-colors">Simulate 230 Scans</button>
                            ) : (
                                <span className="text-xs font-bold text-orange-600 animate-pulse">Running Test...</span>
                            )}
                        </div>
                        {(testStats.isRunning || testStats.total > 0) && (
                            <div className="space-y-2">
                                <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                                    <div className={`h-full transition-all duration-500 ease-out ${testStats.failed > 0 && !testStats.isRunning ? 'bg-orange-500' : 'bg-green-500'}`} style={{ width: `${((testStats.success + testStats.failed) / (testStats.total || 1)) * 100}%` }}></div>
                                </div>
                                <div className="flex justify-between text-[10px] font-bold uppercase">
                                    <span className="text-green-600">Success: {testStats.success}</span>
                                    <span className="text-blue-600">Retrying: {testStats.retrying}</span>
                                    <span className="text-red-600">Failed: {testStats.failed}</span>
                                    <span className="text-gray-500">Left: {Math.max(0, testStats.total - testStats.success - testStats.failed)}</span>
                                </div>
                                {!testStats.isRunning && testStats.total > 0 && (
                                  <p className="text-[10px] font-bold text-center mt-1">
                                    {testStats.success === testStats.total 
                                      ? <span className="text-green-700">✓ ALL 230 SCANS SAVED SUCCESSFULLY!</span> 
                                      : <span className="text-orange-700">⚠ TEST COMPLETED WITH {testStats.failed} FAILURES</span>}
                                  </p>
                                )}
                            </div>
                        )}
                      </div>
                    </div>
                  )}
              </div>
          )}

          {viewMode === 'classroom' && courseName && (
             <h2 className="text-5xl font-black mb-8 text-gray-900 tracking-tight text-center uppercase drop-shadow-sm leading-none break-all">{courseName}</h2>
          )}

          <h2 className="text-2xl font-bold mb-6 text-brand-primary tracking-tight text-center">Scan to Check-in</h2>
          
          {viewMode === 'teacher' && (
            <div className="w-full mb-6 flex flex-col gap-4">
                <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5 ml-1">Current Class / Session</label>
                    <div className="relative group">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                            <PencilSquareIcon className="h-5 w-5 text-gray-400 group-focus-within:text-brand-primary transition-colors" />
                        </div>
                        <input
                            type="text"
                            value={courseName}
                            onChange={(e) => setCourseName(e.target.value)}
                            className="block w-full pl-10 pr-4 py-3 border-2 border-gray-200 rounded-xl leading-5 bg-gray-50 placeholder-gray-400 focus:outline-none focus:bg-white focus:ring-0 focus:border-brand-primary sm:text-sm font-medium transition-all"
                            placeholder="e.g. DATA STRUCTURES W1"
                        />
                    </div>
                </div>

                <div className="bg-gray-50 p-3 rounded-xl border border-gray-200">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                             <div className={`p-2 rounded-lg ${isGeoEnabled ? 'bg-blue-100 text-blue-600' : 'bg-gray-200 text-gray-500'}`}>
                                 <MapPinIcon className="w-5 h-5" />
                             </div>
                             <div>
                                 <p className="text-xs font-bold text-gray-700 uppercase">GPS Geofencing</p>
                                 <p className="text-[10px] text-gray-500">Require students to be within 150m</p>
                             </div>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" checked={isGeoEnabled} onChange={toggleGeofence} className="sr-only peer" />
                            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                        </label>
                    </div>
                    {geoError && <p className="text-[10px] text-red-500 font-bold mt-2 ml-1">{geoError}</p>}
                    {isGeoEnabled && teacherLocation && <p className="text-[10px] text-blue-500 font-bold mt-2 ml-1 animate-pulse">✓ Location Locked: {teacherLocation.lat.toFixed(4)}, {teacherLocation.lng.toFixed(4)}</p>}
                </div>
            </div>
          )}

          <div className="bg-white p-6 rounded-2xl shadow-[inset_0_2px_8px_rgba(0,0,0,0.05)] border border-gray-100 relative w-full max-w-[400px] aspect-square flex items-center justify-center overflow-hidden">
             {isQrLoading && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/90 z-10 rounded-2xl backdrop-blur-sm">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-primary mb-3"></div>
                    <p className="text-sm font-bold text-gray-500 animate-pulse">Generating Secure QR...</p>
                </div>
             )}
            <canvas ref={canvasRef} className="w-full h-full object-contain block" style={{ maxWidth: '100%', maxHeight: '100%' }} />
            
            {/* Corner Markers for decorative purpose */}
            <div className="absolute top-4 left-4 w-8 h-8 border-t-4 border-l-4 border-gray-900 rounded-tl-lg pointer-events-none"></div>
            <div className="absolute top-4 right-4 w-8 h-8 border-t-4 border-r-4 border-gray-900 rounded-tr-lg pointer-events-none"></div>
            <div className="absolute bottom-4 left-4 w-8 h-8 border-b-4 border-l-4 border-gray-900 rounded-bl-lg pointer-events-none"></div>
            <div className="absolute bottom-4 right-4 w-8 h-8 border-b-4 border-r-4 border-gray-900 rounded-br-lg pointer-events-none"></div>
          </div>
          
          <div className="mt-6 flex flex-col items-center">
             <div className="flex items-center gap-2 text-green-600 bg-green-50 px-3 py-1 rounded-full border border-green-100 mb-1">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                </span>
                <span className="text-xs font-bold uppercase tracking-wide">Live Security Active</span>
             </div>
             <p className="text-gray-400 text-xs">QR Code refreshes automatically every second.</p>
          </div>
        </div>
      </div>

      {showManualModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 transition-all">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden transform transition-all scale-100">
                <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                    <h3 className="text-lg font-black text-gray-900 tracking-tight">Add Student Manually</h3>
                    <button onClick={() => setShowManualModal(false)} className="text-gray-400 hover:text-gray-600 transition-colors">
                        <XCircleIcon className="w-6 h-6" />
                    </button>
                </div>
                <form onSubmit={(e) => {
                    e.preventDefault();
                    const res = onManualAdd(manualName, manualId, `${manualId}@student.uts.edu.my`, manualStatus);
                    if(res.success) { setShowManualModal(false); setManualId(''); setManualName(''); }
                    else { setManualError(res.message); }
                }} className="p-6 space-y-5">
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Student ID</label>
                        <input type="text" value={manualId} onChange={(e) => {
                            const val = e.target.value.toUpperCase();
                            setManualId(val);
                            const matched = PRE_REGISTERED_STUDENTS.find(s => s.id === val);
                            if(matched) { setManualName(matched.name); setManualIsNew(false); }
                            else { setManualIsNew(true); }
                        }} placeholder="FIA..." className="block w-full border-2 border-gray-200 focus:border-brand-primary rounded-lg p-3 uppercase font-mono text-sm outline-none transition-colors" />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Student Name</label>
                        <input type="text" value={manualName} onChange={(e) => setManualName(e.target.value.toUpperCase())} readOnly={!manualIsNew && manualName.length > 0} placeholder="Full Name" className={`block w-full border-2 border-gray-200 rounded-lg p-3 uppercase text-sm outline-none transition-colors ${!manualIsNew && manualName.length > 0 ? 'bg-gray-100 text-gray-500' : 'focus:border-brand-primary'}`} />
                    </div>
                    
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Attendance Status</label>
                        <div className="grid grid-cols-2 gap-3">
                            <label className={`cursor-pointer border-2 rounded-lg p-3 flex items-center justify-center gap-2 transition-all ${manualStatus === 'P' ? 'border-green-500 bg-green-50 text-green-700' : 'border-gray-200 hover:border-green-200'}`}>
                                <input type="radio" checked={manualStatus === 'P'} onChange={() => setManualStatus('P')} className="hidden"/>
                                <CheckCircleIcon className="w-5 h-5" />
                                <span className="font-bold text-sm">Present</span>
                            </label>
                            <label className={`cursor-pointer border-2 rounded-lg p-3 flex items-center justify-center gap-2 transition-all ${manualStatus === 'A' ? 'border-red-500 bg-red-50 text-red-700' : 'border-gray-200 hover:border-red-200'}`}>
                                <input type="radio" checked={manualStatus === 'A'} onChange={() => setManualStatus('A')} className="hidden"/>
                                <XCircleIcon className="w-5 h-5" />
                                <span className="font-bold text-sm">Absent</span>
                            </label>
                        </div>
                    </div>

                    {manualError && <p className="text-xs text-red-600 font-bold bg-red-50 p-2 rounded text-center">{manualError}</p>}
                    
                    <button type="submit" className="w-full py-3.5 bg-brand-primary text-white rounded-xl font-bold shadow-lg shadow-brand-primary/20 hover:bg-brand-secondary active:scale-[0.98] transition-all">Confirm Addition</button>
                </form>
            </div>
        </div>
      )}
    </div>
  );
};