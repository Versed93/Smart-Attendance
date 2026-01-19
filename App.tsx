import React, { useState, useCallback, useEffect, useRef } from 'react';
import { TeacherView } from './components/TeacherView';
import { StudentView } from './components/StudentView';
import { LoginView } from './components/LoginView';
import { ExclamationTriangleIcon } from './components/icons/ExclamationTriangleIcon';
import { GlobeIcon } from './components/icons/GlobeIcon';
import type { Student, SyncTask } from './types';

type View = 'teacher' | 'student';

const STORAGE_KEY = 'attendance-storage-standard-v1';
const DELETED_IDS_KEY = 'attendance-deleted-ids-v1';
const SCRIPT_URL_KEY = 'attendance-script-url-v31'; 
const SYNC_QUEUE_KEY = 'attendance-sync-queue-v2';
const AUTH_KEY = 'attendance-lecturer-auth-v1';
const LECTURER_PASSWORD = 'adminscm'; 

const App: React.FC = () => {
  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get('t');
  const courseName = urlParams.get('c');
  const isOfflineScan = urlParams.get('offline') === 'true';
  
  // Geolocation params
  const latParam = urlParams.get('lat');
  const lngParam = urlParams.get('lng');
  const radParam = urlParams.get('rad');
  
  const initialView: View = token ? 'student' : 'teacher';

  const [view, setView] = useState<View>(initialView);
  const [isKioskMode, setIsKioskMode] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    return localStorage.getItem(AUTH_KEY) === 'true';
  });
  const [attendanceList, setAttendanceList] = useState<Student[]>([]);
  
  // Network Status
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  const [locallyDeletedIds, setLocallyDeletedIds] = useState<Set<string>>(() => {
    const saved = localStorage.getItem(DELETED_IDS_KEY);
    try {
        return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch (e) {
        return new Set();
    }
  });
  
  const [scriptUrl, setScriptUrl] = useState<string>(() => {
    const saved = localStorage.getItem(SCRIPT_URL_KEY);
    return saved || 'https://script.google.com/macros/s/AKfycbxN1V5a-kImLL2NgeLTTVrPvW36RM22yM5jAalPHzOmm2lOv72WcTLDeDJxSpmKjNlv/exec';
  });

  const [syncQueue, setSyncQueue] = useState<SyncTask[]>(() => {
      try {
          const saved = localStorage.getItem(SYNC_QUEUE_KEY);
          return saved ? JSON.parse(saved) : [];
      } catch (e) {
          return [];
      }
  });
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<string>('Initializing...');
  
  // Retry Trigger Mechanism
  const [retryTrigger, setRetryTrigger] = useState(0);
  const isSyncingRef = useRef(false); // Prevents dependency loops

  // Network Listener
  useEffect(() => {
    console.log("UTS QR Attendance App Mounted - v1.7.2 (New Deployment)");

    const handleOnline = () => {
        setIsOnline(true);
        // Trigger immediate retry when back online
        setRetryTrigger(c => c + 1);
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (syncQueue.length > 0) {
        e.preventDefault();
        e.returnValue = 'Your attendance is still saving to the cloud. Please wait until the spinner stops.';
        return e.returnValue;
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [syncQueue]);

  useEffect(() => {
    const savedData = localStorage.getItem(STORAGE_KEY);
    if (savedData) {
      try {
        const parsed = JSON.parse(savedData);
        if (Array.isArray(parsed)) setAttendanceList(parsed);
      } catch (e) {
        console.error('Failed to parse attendance data', e);
      }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(attendanceList));
  }, [attendanceList]);

  useEffect(() => {
    localStorage.setItem(DELETED_IDS_KEY, JSON.stringify(Array.from(locallyDeletedIds)));
  }, [locallyDeletedIds]);
  
  useEffect(() => {
    localStorage.setItem(SCRIPT_URL_KEY, scriptUrl);
  }, [scriptUrl]);

  useEffect(() => {
    localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(syncQueue));
  }, [syncQueue]);

  // --- POLLING ENGINE ---
  const fetchRemoteAttendance = useCallback(async () => {
    if (view !== 'teacher' || !isOnline || !scriptUrl) return;

    try {
        const response = await fetch(scriptUrl);
        if (!response.ok) return;
        
        const data = await response.json();
        
        if (Array.isArray(data)) {
            setAttendanceList(prev => {
                const existingIds = new Set(prev.map(s => s.studentId));
                const newStudents: Student[] = [];
                
                data.forEach((item: any) => {
                    const sId = String(item.studentId).toUpperCase();
                    if (!existingIds.has(sId) && !locallyDeletedIds.has(sId)) {
                        newStudents.push({
                            name: item.name,
                            studentId: sId,
                            email: `${sId}@STUDENT.UTS.EDU.MY`,
                            timestamp: Date.now(), // Estimate timestamp for remote records
                            status: item.status as 'P' | 'A'
                        });
                    }
                });
                
                if (newStudents.length > 0) {
                    return [...newStudents, ...prev];
                }
                return prev;
            });
        }
    } catch (e) {
        console.warn("Polling failed (background)", e);
    }
  }, [scriptUrl, isOnline, view, locallyDeletedIds]);

  useEffect(() => {
    if (view === 'teacher') {
        fetchRemoteAttendance();
        const interval = setInterval(fetchRemoteAttendance, 10000); // Poll every 10 seconds
        return () => clearInterval(interval);
    }
  }, [fetchRemoteAttendance, view]);

  // --- CORE SYNC ENGINE (FIXED FOR NO-CORS) ---
  useEffect(() => {
    // Conditions to SKIP processing
    if (syncQueue.length === 0) return;
    if (isSyncingRef.current) return; // Prevent concurrent runs
    if (!scriptUrl || !scriptUrl.startsWith('http')) return;
    if (!isOnline) return;

    // Start Lock
    isSyncingRef.current = true;
    setIsSyncing(true);
    let isMounted = true;

    const processNext = async () => {
        const task = syncQueue[0];
        
        try {
            if (isMounted) setSyncStatus('Preparing data package...');
            
            // Prepare Payload
            const recordTimestamp = parseInt(task.data.timestamp || Date.now().toString());
            const recordDate = new Date(recordTimestamp);
            const day = String(recordDate.getDate()).padStart(2, '0');
            const month = String(recordDate.getMonth() + 1).padStart(2, '0');
            const year = recordDate.getFullYear();

            // Structure data specifically for the new script
            const payload = {
                ...task.data,
                customDate: `${day}/${month}/${year}`
            };

            const controller = new AbortController();
            const timeoutId = setTimeout(() => {
                if (isMounted) setSyncStatus('Server is busy (High Traffic)...');
                controller.abort();
            }, 15000); 

            if (isMounted) setSyncStatus('Connecting to Google Server...');

            // VITAL FIX: Use text/plain to avoid CORS Preflight (OPTIONS request)
            // The Google Apps Script must parse the JSON from the post body string.
            const response = await fetch(scriptUrl.trim(), {
                method: 'POST',
                body: JSON.stringify(payload),
                headers: { 
                  'Content-Type': 'text/plain;charset=utf-8' 
                },
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (isMounted) setSyncStatus('Verifying server response...');

            if (!response.ok) {
                const errText = await response.text().catch(() => response.statusText);
                throw new Error(`HTTP Error ${response.status}: ${errText.slice(0, 200)}`);
            }

            const text = await response.text();
            let result;
            try {
                result = JSON.parse(text);
            } catch(e) {
                // If script returns text but not JSON, it might still be success in some GAS configs, 
                // but we expect JSON {result: "success"}
                throw new Error(`Invalid Server Response`);
            }

            if (result.result !== 'success') {
                throw new Error(`Script Error: ${result.message || 'Rejected'}`);
            }

            // SUCCESS
            if (isMounted) {
              setSyncStatus('Sync successful!');
              setSyncQueue(prev => prev.filter(t => t.id !== task.id)); // Remove processed item
              setSyncError(null);
              // Trigger a fetch to update the list with any other changes
              setTimeout(() => setRetryTrigger(c => c + 1), 500);
            }

        } catch (err: any) {
            console.error("Cloud Sync Error:", err);
            
            let detailedError = err.message || "Failed to sync.";
            if (err.name === 'AbortError') {
              detailedError = "Connection Timeout: Server busy. Retrying...";
              if (isMounted) setSyncStatus('Saved. Uploading in background...');
            } else if (err.message === 'Failed to fetch') {
              detailedError = "Network Error: Could not connect. Check internet. Retrying...";
              if (isMounted) setSyncStatus('Saved. Uploading in background...');
            } else {
              if (isMounted) setSyncStatus(`Error: ${detailedError.substring(0, 30)}...`);
            }
            
            if (isMounted) {
                setSyncError(detailedError);
                // Schedule Retry
                const jitter = 2000 + Math.random() * 5000;
                setTimeout(() => {
                   if (isMounted) setRetryTrigger(c => c + 1);
                }, jitter);
            }
        } finally {
            if (isMounted) {
                isSyncingRef.current = false;
                setIsSyncing(false);
            }
        }
    };

    processNext();
    return () => { isMounted = false; };
  }, [syncQueue, scriptUrl, isOnline, retryTrigger]); 

  const handleRetryNow = useCallback(() => {
      setRetryTrigger(c => c + 1);
  }, []);

  const handleLogin = (password: string) => {
    if (password === LECTURER_PASSWORD) {
        setIsAuthenticated(true);
        localStorage.setItem(AUTH_KEY, 'true');
        return true;
    }
    return false;
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    localStorage.removeItem(AUTH_KEY);
  };

  const addStudent = (name: string, studentId: string, email: string, status: 'P' | 'A', overrideTimestamp?: number) => {
      const timestamp = overrideTimestamp || Date.now();
      const newStudent: Student = { name, studentId, email, timestamp, status };
      
      const studentExists = attendanceList.some(s => s.studentId === studentId);
      if (studentExists) {
        return { success: false, message: "This student is already on the list." };
      }

      setAttendanceList(prev => [newStudent, ...prev]);

      const task: SyncTask = {
          id: `${studentId}-${timestamp}`,
          data: {
              studentId,
              name,
              email,
              status,
              timestamp: timestamp.toString()
          },
          timestamp
      };
      setSyncQueue(prev => [...prev, task]);
      return { success: true, message: "Recorded" };
  };

  const markAttendance = (name: string, studentId: string, email: string) => {
      return addStudent(name, studentId, email, 'P');
  };

  const onManualAdd = (name: string, id: string, email: string, status: 'P' | 'A') => {
      return addStudent(name, id, email, status);
  };

  const onRemoveStudents = (ids: string[]) => {
      setAttendanceList(prev => prev.filter(s => !ids.includes(s.studentId)));
      setLocallyDeletedIds(prev => {
          const next = new Set(prev);
          ids.forEach(id => next.add(id));
          return next;
      });
  };

  const onBulkStatusUpdate = (ids: string[], status: 'P' | 'A') => {
      setAttendanceList(prev => prev.map(s => ids.includes(s.studentId) ? { ...s, status } : s));
      
      const tasks: SyncTask[] = [];
      const now = Date.now();
      ids.forEach(id => {
          const student = attendanceList.find(s => s.studentId === id);
          if (student) {
             tasks.push({
                 id: `${id}-${now}-update`,
                 data: {
                     studentId: id,
                     name: student.name,
                     email: student.email,
                     status,
                     timestamp: now.toString()
                 },
                 timestamp: now
             });
          }
      });
      if (tasks.length > 0) setSyncQueue(prev => [...prev, ...tasks]);
  };

  const onClearAttendance = () => {
      if (window.confirm('Are you sure you want to clear the list? This only affects this device.')) {
        setAttendanceList([]);
      }
  };
  
  const onTestAttendance = () => {
      const futureDate = new Date('2030-01-01T12:00:00');
      addStudent(
        "TEST W6-W10 (Future Date)", 
        `TEST-${Date.now().toString().slice(-4)}`, 
        "test@example.com", 
        'P', 
        futureDate.getTime()
      );
  };

  const onOpenKiosk = () => {
      setIsKioskMode(true);
      setView('student');
  };

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
       {view === 'teacher' ? (
           isAuthenticated ? (
             <div className="flex-1 p-4 overflow-auto relative">
                 <TeacherView 
                     attendanceList={attendanceList}
                     onTestAttendance={onTestAttendance}
                     onClearAttendance={onClearAttendance}
                     onRemoveStudents={onRemoveStudents}
                     onBulkStatusUpdate={onBulkStatusUpdate}
                     scriptUrl={scriptUrl}
                     onScriptUrlChange={setScriptUrl}
                     onOpenKiosk={onOpenKiosk}
                     onManualAdd={onManualAdd}
                     pendingSyncCount={syncQueue.length}
                     syncQueue={syncQueue} 
                     syncError={syncError}
                     onRetrySync={handleRetryNow}
                     isOnline={isOnline}
                     onLogout={handleLogout}
                     addStudent={addStudent}
                 />
                 
                 {syncError && isOnline && (
                    <div className="fixed top-6 right-6 max-w-sm w-full bg-white border-l-4 border-red-500 shadow-2xl rounded-r-lg p-5 z-[100] flex flex-col gap-3 animate-pulse" role="alert" aria-live="assertive">
                        <div className="flex items-start gap-4">
                            <div className="text-red-500 bg-red-100 p-2 rounded-full" aria-hidden="true">
                              <ExclamationTriangleIcon className="w-6 h-6" />
                            </div>
                            <div className="flex-1">
                                <h3 className="font-bold text-gray-900 text-lg">Cloud Sync Failed</h3>
                                <p className="text-sm text-gray-600 mt-1 leading-tight break-words font-mono text-xs bg-gray-50 p-2 rounded border border-gray-200">{syncError}</p>
                                <p className="text-xs text-gray-400 mt-2 font-medium">Automatic retry in progress...</p>
                            </div>
                        </div>
                        <div className="flex justify-end gap-2 mt-1">
                            <button 
                              onClick={handleRetryNow} 
                              className="px-4 py-2 bg-red-600 text-white text-sm font-bold rounded shadow hover:bg-red-700 transition-colors flex items-center gap-2 focus:ring-2 focus:ring-red-500 focus:outline-none"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                              Retry Now
                            </button>
                        </div>
                    </div>
                 )}
                 {!isOnline && syncQueue.length > 0 && (
                     <div className="fixed top-6 right-6 max-w-sm w-full bg-yellow-50 border-l-4 border-yellow-500 shadow-xl rounded-r-lg p-4 z-[100] flex items-center gap-3" role="status">
                         <GlobeIcon className="w-6 h-6 text-yellow-600" aria-hidden="true" />
                         <div>
                             <h3 className="font-bold text-yellow-800 text-sm">Offline Mode</h3>
                             <p className="text-xs text-yellow-700">{syncQueue.length} records pending upload.</p>
                         </div>
                     </div>
                 )}
             </div>
           ) : (
             <LoginView onLogin={handleLogin} />
           )
       ) : (
           <div className="flex-1 flex flex-col items-center justify-center p-4 bg-gray-50">
               <div className="w-full max-w-md bg-white rounded-xl shadow-lg p-6">
                   <StudentView 
                       markAttendance={markAttendance}
                       token={token || (isKioskMode ? Date.now().toString() : '')}
                       courseName={courseName || undefined}
                       geoConstraints={latParam && lngParam ? { lat: parseFloat(latParam), lng: parseFloat(lngParam), radius: radParam ? parseFloat(radParam) : 150 } : undefined}
                       bypassRestrictions={isKioskMode}
                       onExit={() => { setIsKioskMode(false); setView('teacher'); }}
                       isSyncing={isSyncing || syncQueue.length > 0}
                       isOnline={isOnline}
                       syncStatus={syncStatus}
                       isOfflineScan={isOfflineScan}
                   />
               </div>
           </div>
       )}
    </div>
  );
};

export default App;