
import React, { useState, useEffect, useRef, useMemo } from 'react';
import type { Student } from '../types';
import type { PreRegisteredStudent } from '../studentList';
import QRCode from 'qrcode';
import { DownloadIcon } from './icons/DownloadIcon';
import { EyeIcon } from './icons/EyeIcon';
import { TrashIcon } from './icons/TrashIcon';
import { ShieldCheckIcon } from './icons/ShieldCheckIcon';
import { PencilSquareIcon } from './icons/PencilSquareIcon';
import { MapPinIcon } from './icons/MapPinIcon';
import { CameraIcon } from './icons/CameraIcon';
import { LockClosedIcon } from './icons/LockClosedIcon';
import { QrScanner } from './QrScanner';
import { QrCodeIcon } from './icons/QrCodeIcon';
import { AdjustmentsHorizontalIcon } from './icons/AdjustmentsHorizontalIcon';
import { MagnifyingGlassIcon } from './icons/MagnifyingGlassIcon';
import { XCircleIcon } from './icons/XCircleIcon';
import { GoogleSheetIntegrationInfo } from './GoogleSheetIntegrationInfo';
import { DevicePhoneMobileIcon } from './icons/DevicePhoneMobileIcon';
import { ArrowDownTrayIcon } from './icons/ArrowDownTrayIcon';

interface TeacherViewProps {
  attendanceList: Student[];
  onRemoveStudents: (studentIds: string[]) => void;
  onBulkStatusUpdate: (studentIds:string[], status: string) => void;
  scriptUrl: string;
  onScriptUrlChange: (url: string) => void;
  onOpenKiosk: () => void;
  onManualAdd: (name: string, id: string, email: string, status: string) => Promise<{success: boolean, message: string}>;
  addStudent: (name: string, studentId: string, email: string, status: string, overrideTimestamp?: number) => Promise<{ success: boolean, message: string }>;
  onLogout: () => void;
  knownStudents: PreRegisteredStudent[];
}

export const TeacherView: React.FC<TeacherViewProps> = ({ 
  attendanceList, 
  onRemoveStudents,
  onBulkStatusUpdate,
  scriptUrl, 
  onScriptUrlChange, 
  onOpenKiosk, 
  onManualAdd,
  addStudent,
  onLogout,
  knownStudents,
}) => {
  const [baseUrl] = useState<string>(() => window.location.origin + window.location.pathname);
  const [qrData, setQrData] = useState<string>('');
  const [courseName, setCourseName] = useState(() => localStorage.getItem('attendance-course-name') || '');
  const [showSettingsModal, setShowSettingsModal] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<'teacher' | 'classroom' | 'checklist'>('teacher');
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
  const [qrErrorCorrection, setQrErrorCorrection] = useState<'L' | 'M' | 'Q' | 'H'>(() => (localStorage.getItem('qr-error-correction') as any) || 'M');
  const [qrMargin, setQrMargin] = useState<number>(() => parseInt(localStorage.getItem('qr-margin') || '2', 10));
  const [listSearchTerm, setListSearchTerm] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [unlockMessage, setUnlockMessage] = useState('');
  const [currentTime, setCurrentTime] = useState(() => new Date());

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => localStorage.setItem('qr-error-correction', qrErrorCorrection), [qrErrorCorrection]);
  useEffect(() => localStorage.setItem('qr-margin', qrMargin.toString()), [qrMargin]);

  useEffect(() => localStorage.setItem('attendance-course-name', courseName), [courseName]);

  const handleScanResult = (data: string) => {
      setShowScanner(false);
      try {
        const studentData = JSON.parse(data);
        addStudent(studentData.name, studentData.studentId, studentData.email, 'P', studentData.timestamp)
            .then(result => {
                if (result.success) setScanResult({ type: 'success', message: `${studentData.name} checked in!` });
                else setScanResult({ type: 'duplicate', message: result.message });
            });
      } catch (e) { setScanResult({ type: 'error', message: 'Invalid QR code format.' }); }
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
      QRCode.toCanvas(canvasRef.current, qrData, { 
          width: viewMode === 'classroom' ? 500 : 320,
          margin: qrMargin, 
          errorCorrectionLevel: qrErrorCorrection.toLowerCase() as any,
      }, (error) => {
        if (error) console.error(error);
        setIsQrLoading(false);
      });
    }
  }, [qrData, qrErrorCorrection, qrMargin, viewMode]);

  const handleManualIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.toUpperCase().trim();
    setManualId(val);
    const matched = knownStudents.find(s => s.id === val);
    if (matched) { setManualName(matched.name); setManualIsNew(false); setManualError(''); } 
    else { if (!manualIsNew) setManualName(''); setManualIsNew(true); }
  };

  const submitManualAdd = async () => {
      if (!manualId || !manualName) { setManualError('Student ID and Name are required.'); return; }
      const result = await onManualAdd(manualName, manualId, `${manualId}@STUDENT.UTS.EDU.MY`, 'P');
      if (result.success) { setShowManualModal(false); setManualId(''); setManualName(''); setManualError(''); } 
      else { setManualError(result.message); }
  };
  
  const handleUnlockDevice = () => {
    localStorage.removeItem('attendance-device-lock-v1');
    setUnlockMessage('Device unlocked! Students can now submit from this device.');
    setTimeout(() => setUnlockMessage(''), 3000);
  };

  const filteredList = useMemo(() => {
    return attendanceList.filter(s => s.name.toLowerCase().includes(listSearchTerm.toLowerCase()) || s.studentId.toLowerCase().includes(listSearchTerm.toLowerCase()));
  }, [attendanceList, listSearchTerm]);

  const handleExportCSV = () => {
      if (filteredList.length === 0) {
          alert("No attendance data to export.");
          return;
      }

      const headers = ["Student ID", "Name", "Status", "Timestamp", "Date", "Time"];
      const csvRows = [headers.join(',')];

      for (const student of filteredList) {
          const timestamp = new Date(student.timestamp);
          const date = timestamp.toLocaleDateString('en-CA'); // YYYY-MM-DD format
          const time = timestamp.toLocaleTimeString('en-US', { hour12: false });
          const name = `"${student.name.replace(/"/g, '""')}"`; // Escape double quotes

          const row = [student.studentId, name, student.status, student.timestamp, date, time];
          csvRows.push(row.join(','));
      }

      const csvString = csvRows.join('\n');
      const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement("a");
      const url = URL.createObjectURL(blob);
      const today = new Date().toISOString().slice(0, 10);
      const safeCourseName = courseName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      
      link.setAttribute("href", url);
      link.setAttribute("download", `attendance_${safeCourseName || 'session'}_${today}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
  };


  if (viewMode === 'classroom') {
    return (
        <div className="fixed inset-0 bg-gray-900/95 backdrop-blur-lg z-50 flex flex-col items-center justify-center p-4 animate-in fade-in duration-300" role="dialog" aria-modal="true">
            <div className="w-full max-w-2xl text-center text-white mb-6">
                <p className="text-lg font-bold text-brand-light uppercase tracking-widest">Join Session</p>
                <h2 className="text-4xl sm:text-5xl font-black mt-1 break-words">{courseName || 'General Attendance'}</h2>
                <p className="font-mono text-2xl mt-3 opacity-80">{currentTime.toLocaleTimeString()}</p>
            </div>
            <div className="bg-white p-4 rounded-3xl shadow-2xl w-full max-w-md sm:max-w-lg aspect-square flex items-center justify-center">
                 <canvas ref={canvasRef} className="max-w-full max-h-full" />
            </div>
            <button 
                onClick={() => setViewMode('teacher')} 
                className="mt-8 bg-white/10 border border-white/20 text-white font-bold py-3 px-8 rounded-full hover:bg-white/20 transition-colors"
            >
                Exit Classroom View
            </button>
        </div>
    );
  }

  return (
    <div className="w-full max-w-[1600px] mx-auto p-2 sm:p-6 space-y-4 sm:space-y-6 pb-20 sm:pb-6">
       <div className="relative z-10 flex flex-col xl:flex-row justify-between items-stretch xl:items-center bg-white p-3 sm:p-4 rounded-2xl shadow-sm border border-gray-100 gap-4">
         <div className="flex items-center gap-3 sm:gap-4"><div className="flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 bg-gradient-to-br from-brand-primary to-brand-secondary text-white rounded-xl shadow-lg shrink-0"><ShieldCheckIcon className="w-6 h-6 sm:w-7 sm:h-7" /></div><div className="min-w-0"><h1 className="text-lg sm:text-2xl font-black text-gray-900 tracking-tight truncate">UTS ATTENDANCE</h1><p className="text-[10px] sm:text-xs text-gray-500 font-bold tracking-[0.2em] mt-0.5 sm:mt-1">SECURE CHECK-IN</p></div></div>
         <div className="flex items-center gap-2 overflow-x-auto pb-2 sm:pb-0 no-scrollbar w-full xl:w-auto mask-fade-right" role="toolbar">
            <button onClick={() => { setShowManualModal(true); setManualId(''); setManualName(''); setManualError(''); }} className="flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 bg-indigo-50 text-indigo-600 rounded-xl border hover:bg-indigo-100 transition-colors shrink-0" title="Manual Entry"><PencilSquareIcon className="w-5 h-5" /></button>
            <button onClick={() => setShowSettingsModal(true)} className="flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 rounded-xl border bg-gray-50 text-gray-600 hover:bg-gray-100 transition-colors shadow-sm shrink-0" title="Settings"><AdjustmentsHorizontalIcon className="w-5 h-5" /></button>
            <button onClick={() => setViewMode('classroom')} className={`flex group items-center gap-3 px-3 sm:px-5 py-2 sm:py-3 rounded-xl font-bold transition-all shrink-0 bg-gray-50 text-gray-700`} title="Switch to Classroom View"><div className="text-right hidden sm:block"><span className="text-[10px] uppercase opacity-60">View</span><span className="block text-xs uppercase tracking-wider">Classroom</span></div><EyeIcon className="w-5 h-5" /></button>
            <button onClick={onLogout} className="flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 bg-red-50 text-red-600 rounded-xl border hover:bg-red-100 shrink-0" title="Log Out"><LockClosedIcon className="w-5 h-5" /></button>
         </div>
       </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col items-center justify-center">
            <div className="w-full text-center">
                <p className="text-sm font-bold text-brand-primary">SESSION</p>
                <input 
                    type="text"
                    value={courseName}
                    onChange={(e) => setCourseName(e.target.value)}
                    placeholder="e.g., UACD1004 Intro to C"
                    className="text-2xl font-extrabold text-gray-800 text-center w-full border-none focus:ring-0 p-1"
                />
            </div>
            <div className="my-4 max-w-[280px] sm:max-w-[320px] w-full aspect-square p-2 border-2 border-gray-200 rounded-2xl relative flex items-center justify-center">
                {isQrLoading && <div className="absolute inset-0 flex items-center justify-center bg-white/50 rounded-2xl"><div className="animate-spin h-8 w-8 border-2 border-brand-primary border-t-transparent rounded-full"></div></div>}
                <canvas ref={canvasRef} className="max-w-full max-h-full rounded-xl" />
            </div>
             <div className="flex items-center justify-center gap-2 flex-wrap">
                <button onClick={() => onOpenKiosk()} className="flex items-center gap-2 bg-indigo-100 text-indigo-700 text-xs font-bold px-3 py-2 rounded-lg hover:bg-indigo-200 transition-colors"><QrCodeIcon className="w-4 h-4" /> Kiosk Mode</button>
                <button onClick={() => setShowScanner(true)} className="flex items-center gap-2 bg-indigo-100 text-indigo-700 text-xs font-bold px-3 py-2 rounded-lg hover:bg-indigo-200 transition-colors"><CameraIcon className="w-4 h-4" /> Scan Student</button>
            </div>
        </div>

        <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border border-gray-100">
            <div className="flex justify-between items-center mb-4 gap-2">
                <h2 className="text-xl font-bold text-gray-800 shrink-0">List ({filteredList.length})</h2>
                <div className="flex items-center gap-2 w-full">
                    <div className="relative w-full">
                        <MagnifyingGlassIcon className="w-4 h-4 text-gray-400 absolute top-1/2 left-3 -translate-y-1/2" />
                        <input type="text" placeholder="Search..." value={listSearchTerm} onChange={(e) => setListSearchTerm(e.target.value)} className="w-full pl-9 pr-3 py-2 text-sm border-gray-200 rounded-lg focus:ring-brand-primary focus:border-brand-primary" />
                    </div>
                    <button onClick={handleExportCSV} className="flex items-center justify-center w-10 h-9 bg-gray-100 text-gray-600 rounded-lg border hover:bg-gray-200 transition-colors shrink-0" title="Export CSV"><ArrowDownTrayIcon className="w-4 h-4" /></button>
                </div>
            </div>
            {selectedIds.size > 0 && (
                <div className="bg-gray-50 p-2 rounded-lg mb-2 flex items-center justify-between gap-2">
                    <p className="text-xs font-bold text-gray-600">{selectedIds.size} selected</p>
                    <button onClick={() => onRemoveStudents(Array.from(selectedIds))} className="text-xs text-red-600 font-bold p-1 hover:bg-red-100 rounded"><TrashIcon className="w-4 h-4" /></button>
                </div>
            )}
            <div className="overflow-y-auto h-96 pr-2">
                {filteredList.length > 0 ? (
                    <ul className="space-y-2">
                        {filteredList.map(s => (
                            <li key={s.studentId} className="flex items-center gap-3 p-2 bg-gray-50 rounded-lg">
                                <input type="checkbox" checked={selectedIds.has(s.studentId)} onChange={(e) => {
                                    const next = new Set(selectedIds);
                                    if(e.target.checked) next.add(s.studentId); else next.delete(s.studentId);
                                    setSelectedIds(next);
                                }} className="rounded border-gray-300 text-brand-primary focus:ring-brand-primary" />
                                <div className="flex-1">
                                    <p className="font-bold text-sm text-gray-800">{s.name}</p>
                                    <p className="text-xs font-mono text-gray-500">{s.studentId}</p>
                                </div>
                                <p className="text-xs text-gray-400">{new Date(s.timestamp).toLocaleTimeString()}</p>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <div className="text-center py-10 text-gray-500">No students have checked in yet.</div>
                )}
            </div>
        </div>
      </div>
       
      {showSettingsModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200" role="dialog" aria-modal="true">
            <div className="bg-white w-full max-w-2xl rounded-2xl shadow-xl max-h-[90vh] overflow-y-auto">
                <div className="p-6 sticky top-0 bg-white/80 backdrop-blur-sm border-b z-10 flex justify-between items-center">
                    <h2 className="text-xl font-bold text-gray-900">Settings</h2>
                    <button onClick={() => setShowSettingsModal(false)} className="text-gray-400 hover:text-gray-600"><XCircleIcon className="w-6 h-6" /></button>
                </div>
                <div className="p-6 space-y-6">
                    <div className="border border-gray-200 rounded-lg p-4">
                        <h3 className="flex items-center gap-2 text-sm font-bold text-gray-700 uppercase tracking-wider mb-3"><QrCodeIcon className="w-5 h-5 text-gray-500" /><span>QR Code</span></h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-semibold text-gray-800 mb-1">Error Correction</label>
                                <p className="text-xs text-gray-500 mb-2">Higher levels resist damage.</p>
                                <select value={qrErrorCorrection} onChange={e => setQrErrorCorrection(e.target.value as any)} className="w-full text-sm rounded-md border-gray-300 focus:ring-brand-primary focus:border-brand-primary">
                                    <option value="L">Low (7%)</option>
                                    <option value="M">Medium (15%)</option>
                                    <option value="Q">Quartile (25%)</option>
                                    <option value="H">High (30%)</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-semibold text-gray-800 mb-1">Margin ({qrMargin}px)</label>
                                <p className="text-xs text-gray-500 mb-2">Adds white space.</p>
                                <input type="range" min="0" max="10" value={qrMargin} onChange={e => setQrMargin(parseInt(e.target.value, 10))} className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-brand-primary" />
                            </div>
                        </div>
                    </div>
                    <div className="border border-gray-200 rounded-lg p-4">
                        <h3 className="flex items-center gap-2 text-sm font-bold text-gray-700 uppercase tracking-wider mb-3"><ShieldCheckIcon className="w-5 h-5 text-gray-500" /><span>Session Security</span></h3>
                        <div className="space-y-3">
                           <label className="flex items-center justify-between cursor-pointer p-2 rounded-md hover:bg-gray-50">
                                <div>
                                    <p className="font-semibold text-gray-800">Geolocation Lock</p>
                                    <p className="text-xs text-gray-500">Only allow check-ins near your location.</p>
                                </div>
                                <input type="checkbox" checked={isGeoEnabled} onChange={(e) => setIsGeoEnabled(e.target.checked)} className="rounded text-brand-primary focus:ring-brand-primary/50" />
                            </label>
                             <label className="flex items-center justify-between cursor-pointer p-2 rounded-md hover:bg-gray-50">
                                <div>
                                    <p className="font-semibold text-gray-800">Offline Mode</p>
                                    <p className="text-xs text-gray-500">Students generate a QR to be scanned by you.</p>
                                </div>
                                <input type="checkbox" checked={isOfflineMode} onChange={(e) => setIsOfflineMode(e.target.checked)} className="rounded text-brand-primary focus:ring-brand-primary/50" />
                            </label>
                        </div>
                    </div>
                    <div className="border border-gray-200 rounded-lg p-4">
                       <h3 className="flex items-center gap-2 text-sm font-bold text-gray-700 uppercase tracking-wider mb-3"><DevicePhoneMobileIcon className="w-5 h-5 text-gray-500" /><span>Device Management</span></h3>
                         <div className="space-y-3 bg-red-50/50 p-3 rounded-md border border-red-200/50">
                           <p className="text-xs text-red-700">If a student link was tested on this device, it might be locked. Clear the security lock for this device only.</p>
                            <button 
                                onClick={handleUnlockDevice}
                                className="w-full bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-4 rounded-lg transition-colors text-sm shadow-sm"
                            >
                                Unlock This Device
                            </button>
                            {unlockMessage && <p className="text-green-700 text-xs mt-2 text-center font-semibold animate-in fade-in">{unlockMessage}</p>}
                        </div>
                    </div>
                    <GoogleSheetIntegrationInfo />
                </div>
            </div>
        </div>
      )}
      
      {showManualModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200" role="dialog" aria-modal="true" aria-labelledby="manual-entry-title">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-xl p-6 relative">
            <button onClick={() => setShowManualModal(false)} className="absolute top-3 right-3 text-gray-400 hover:text-gray-600"><XCircleIcon className="w-6 h-6"/></button>
            <h2 id="manual-entry-title" className="text-xl font-bold text-gray-900 mb-1">Manual Student Entry</h2>
            <p className="text-sm text-gray-500 mb-4">Enter student details to mark them as present.</p>
            <div className="space-y-4">
               <div>
                  <label htmlFor="manual-student-id" className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Student ID</label>
                  <input id="manual-student-id" type="text" value={manualId} placeholder="FIA..." onChange={handleManualIdChange} className="block w-full bg-base-100 border-2 border-base-300 focus:border-brand-primary rounded-lg py-2.5 px-4 text-gray-900 uppercase font-mono font-bold" required />
               </div>
               <div>
                  <label htmlFor="manual-full-name" className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Full Name</label>
                  <input id="manual-full-name" type="text" value={manualName} placeholder="AS PER IC" onChange={(e) => setManualName(e.target.value.toUpperCase())} readOnly={!manualIsNew && manualName.length > 0} className={`block w-full border-2 rounded-lg py-2.5 px-4 text-gray-900 uppercase font-bold ${!manualIsNew && manualName.length > 0 ? 'bg-gray-100 border-transparent text-gray-600' : 'bg-base-100 border-base-300 focus:border-brand-primary'}`} required />
               </div>
               {manualError && <p className="text-sm text-red-500 font-bold text-center bg-red-50 py-2 rounded" role="alert">{manualError}</p>}
               <div className="flex justify-end gap-3 pt-2">
                 <button onClick={() => setShowManualModal(false)} type="button" className="px-4 py-2 text-sm font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg">Cancel</button>
                 <button onClick={submitManualAdd} type="button" className="px-5 py-2 text-sm font-bold text-white bg-brand-primary hover:bg-brand-secondary rounded-lg shadow-sm">Add Student</button>
               </div>
            </div>
          </div>
        </div>
      )}

      {showScanner && <QrScanner onScan={handleScanResult} onClose={() => setShowScanner(false)} />}
    </div>
  );
};
