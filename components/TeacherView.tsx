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
import { CameraIcon } from './icons/CameraIcon';
import { ExclamationTriangleIcon } from './icons/ExclamationTriangleIcon';
import { LockClosedIcon } from './icons/LockClosedIcon';
import { SpeakerWaveIcon } from './icons/SpeakerWaveIcon';
import { SpeakerXMarkIcon } from './icons/SpeakerXMarkIcon';
import { GoogleSheetIntegrationInfo } from './GoogleSheetIntegrationInfo';
import { PRE_REGISTERED_STUDENTS } from '../studentList';
import { QrScanner } from './QrScanner';

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
  addStudent: (name: string, studentId: string, email: string, status: 'P' | 'A', overrideTimestamp?: number) => { success: boolean, message: string };
  pendingSyncCount?: number;
  syncQueue?: SyncTask[];
  syncError?: string | null;
  onRetrySync?: () => void;
  isOnline?: boolean;
  onLogout: () => void;
}

type SortOption = 'id' | 'newest' | 'oldest';

export const TeacherView: React.FC<TeacherViewProps> = ({ 
  attendanceList, 
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
  onLogout
}) => {
  const [baseUrl] = useState<string>(window.location.href.split('?')[0]);
  const [qrData, setQrData] = useState<string>('');
  
  const [courseName, setCourseName] = useState(() => localStorage.getItem('attendance-course-name') || '');
  
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<'teacher' | 'classroom'>('teacher');
  const [isSoundEnabled, setIsSoundEnabled] = useState(true);
  
  const [sortBy, setSortBy] = useState<SortOption>('newest');
  
  // New Offline Hub Mode
  const [isOfflineMode, setIsOfflineMode] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [scanResult, setScanResult] = useState<{ type: 'success' | 'error' | 'duplicate', message: string} | null>(null);

  const [isGeoEnabled, setIsGeoEnabled] = useState(false);
  const [teacherLocation, setTeacherLocation] = useState<{lat: number, lng: number} | null>(null);
  const [geoError, setGeoError] = useState('');
  
  const [timeFilter, setTimeFilter] = useState<'all' | number>('all');
  const [currentTime, setCurrentTime] = useState(Date.now());
  
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [showManualModal, setShowManualModal] = useState(false);
  const [manualId, setManualId] = useState('');
  const [manualName, setManualName] = useState('');
  const [manualStatus, setManualStatus] = useState<'P' | 'A'>('P');
  const [manualError, setManualError] = useState('');
  const [manualIsNew, setManualIsNew] = useState(false);

  const [isQrLoading, setIsQrLoading] = useState(true);

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
                // Success sound is triggered by useEffect on list change
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
        new Date(s.timestamp).toLocaleString(), `"${s.name}"`, `"${s.studentId}"`, `"${s.email}"`, s.status,
        pendingIds.has(s.studentId) ? 'PENDING' : 'SAVED'
    ].join(','))].join('\n');
    const blob = new Blob(["\ufeff" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `attendance-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
  };
  
  return (
    <div className="w-full max-w-[1600px] mx-auto p-4 sm:p-6 space-y-6">
       <div className="relative z-10 flex flex-col sm:flex-row justify-between items-center bg-white p-4 rounded-2xl shadow-sm border border-gray-100 gap-4">
         <div className="flex items-center gap-4">
             <div className="flex items-center justify-center w-12 h-12 bg-gradient-to-br from-brand-primary to-brand-secondary text-white rounded-xl shadow-lg" aria-hidden="true">
                 <ShieldCheckIcon className="w-7 h-7" />
             </div>
             <div>
                 <h1 className="text-2xl font-black text-gray-900 tracking-tight">UTS ATTENDANCE</h1>
                 <p className="text-xs text-gray-500 font-bold tracking-[0.2em] mt-1">SECURE CHECK-IN</p>
             </div>
         </div>
         <div className="flex items-center gap-2" role="toolbar" aria-label="Toolbar">
            <button 
              onClick={() => setIsSoundEnabled(!isSoundEnabled)} 
              className={`flex items-center justify-center w-12 h-12 rounded-xl border transition-colors shadow-sm ${isSoundEnabled ? 'bg-indigo-50 text-indigo-600' : 'bg-gray-50 text-gray-400'}`} 
              title={isSoundEnabled ? "Mute Sound" : "Enable Sound"}
              aria-label={isSoundEnabled ? "Mute sound" : "Enable sound"}
              aria-pressed={isSoundEnabled}
            >
              {isSoundEnabled ? <SpeakerWaveIcon className="w-5 h-5" /> : <SpeakerXMarkIcon className="w-5 h-5" />}
            </button>
            <button 
              onClick={() => setViewMode(v => v === 'teacher' ? 'classroom' : 'teacher')} 
              className={`group flex items-center gap-3 px-5 py-3 rounded-xl font-bold transition-all ${viewMode === 'teacher' ? 'bg-gray-50 text-gray-700' : 'bg-gray-900 text-white shadow-lg'}`} 
              title="Toggle View Mode"
              aria-label={`Switch to ${viewMode === 'teacher' ? 'Classroom' : 'Teacher'} view`}
            >
              <div className="text-right">
                <span className="text-[10px] uppercase opacity-60">View</span>
                <span className="block text-xs uppercase tracking-wider">{viewMode}</span>
              </div>
              <EyeIcon className="w-5 h-5" aria-hidden="true" />
            </button>
            <button 
              onClick={onLogout} 
              className="flex items-center justify-center w-12 h-12 bg-red-50 text-red-600 rounded-xl border hover:bg-red-100" 
              title="Log Out"
              aria-label="Log out"
            >
              <LockClosedIcon className="w-5 h-5" aria-hidden="true" />
            </button>
         </div>
       </div>

      <div className={`grid grid-cols-1 gap-6 ${viewMode === 'teacher' ? 'xl:grid-cols-12' : ''} items-start transition-all duration-300`}>
        
        {viewMode === 'teacher' && (
        <div className="w-full xl:col-span-4 order-2 xl:order-1 flex flex-col gap-4">
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

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 flex-1 flex flex-col overflow-hidden min-h-[400px]">
            {visibleList.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-400">
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
                      {visibleList.map(s => (
                        <tr key={s.studentId} className="hover:bg-gray-50">
                          <td className="px-4 py-3">
                            <p className="font-bold text-gray-800">{s.name}</p>
                            <p className="font-mono text-xs text-gray-500">{s.studentId}</p>
                          </td>
                          <td className="px-4 py-3 text-right text-gray-400 text-xs">
                            {new Date(s.timestamp).toLocaleTimeString()}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
        )}

        <div className={`w-full flex flex-col items-center bg-white p-6 sm:p-8 rounded-2xl shadow-xl border order-1 xl:order-2 transition-all duration-500 ease-in-out z-0 ${viewMode === 'teacher' ? 'xl:col-span-8' : 'col-span-1 xl:col-span-12 min-h-[85vh] justify-center'}`}>
          {viewMode === 'teacher' && (
              <div className="w-full space-y-4 mb-6 relative z-20">
                <div className="flex justify-between items-center">
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
                    <div id="settings-panel" className="p-5 bg-gray-50 rounded-xl border space-y-5" role="region" aria-label="Settings">
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
                      <div className="grid grid-cols-2 gap-3 pt-4 border-t">
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
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
            </div>
          )}

          <h2 className={`font-bold text-brand-primary tracking-tight text-center transition-all duration-300 ${viewMode === 'classroom' ? 'text-5xl mb-12' : 'text-2xl mb-6'}`}>Scan to Check-in</h2>
          
          <div 
            className={`bg-white p-2 rounded-3xl shadow-[inset_0_2px_8px_rgba(0,0,0,0.05)] border relative w-full transition-all duration-500 ease-in-out ${
                viewMode === 'teacher' 
                ? 'max-w-[380px] lg:max-w-[420px]' 
                : 'max-w-[650px] lg:max-w-[800px]'
            } aspect-square flex items-center justify-center z-10`}
            role="img"
            aria-label="Dynamic QR Code for attendance. Updates every second."
          >
             {isQrLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-white/80 z-10" aria-label="Loading QR Code">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-primary"></div>
                </div>
             )}
            <canvas ref={canvasRef} className="w-full h-full max-w-full max-h-full" />
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
      </div>
      
      {showScanner && <QrScanner onScan={handleScanResult} onClose={() => setShowScanner(false)} />}

      {scanResult && (
        <div className="fixed inset-0 flex items-center justify-center z-[200] pointer-events-none">
             <div 
                className={`transform transition-all duration-300 ease-out translate-y-0 opacity-100 flex flex-col items-center justify-center p-8 rounded-3xl shadow-2xl border-4 ${
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
                    {scanResult.type === 'success' && <CheckCircleIcon className="w-16 h-16 text-green-600" />}
                    {scanResult.type === 'duplicate' && <UserIcon className="w-16 h-16 text-yellow-600" />}
                    {scanResult.type === 'error' && <XCircleIcon className="w-16 h-16 text-red-600" />}
                </div>
                <h3 className="text-2xl font-black uppercase tracking-tight mb-1">
                    {scanResult.type === 'success' ? 'Checked In' : 
                     scanResult.type === 'duplicate' ? 'Already Scanned' : 'Scan Failed'}
                </h3>
                <p className="text-lg font-bold text-center max-w-xs">{scanResult.message}</p>
             </div>
        </div>
      )}
    </div>
  );
};