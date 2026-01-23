
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { TeacherView } from './components/TeacherView';
import { StudentView } from './components/StudentView';
import { LoginView } from './components/LoginView';
import { ExclamationTriangleIcon } from './components/icons/ExclamationTriangleIcon';
import { GlobeIcon } from './components/icons/GlobeIcon';
import type { Student, SyncTask } from './types';
import { PRE_REGISTERED_STUDENTS, PreRegisteredStudent } from './studentList';

type View = 'teacher' | 'student';

const STORAGE_KEY = 'attendance-storage-standard-v1';
const DELETED_IDS_KEY = 'attendance-deleted-ids-v1';
const SCRIPT_URL_KEY = 'attendance-script-url-v37'; 
const SYNC_QUEUE_KEY = 'attendance-sync-queue-v3';
const AUTH_KEY = 'attendance-lecturer-auth-v1';
const KNOWN_STUDENTS_KEY = 'attendance-known-students-v1';
const LECTURER_PASSWORD = 'adminscm'; 
const LAST_SCAN_DATE_KEY = 'attendance-last-scan-date-v1';

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
  
  // Dynamic Student Registry (Syncs with Cloud & Manual Entries)
  const [knownStudents, setKnownStudents] = useState<PreRegisteredStudent[]>(() => {
      const saved = localStorage.getItem(KNOWN_STUDENTS_KEY);
      const initial = PRE_REGISTERED_STUDENTS; // Start with hardcoded list
      if (saved) {
          try {
              const parsed = JSON.parse(saved);
              if (Array.isArray(parsed)) {
                  // Merge saved with initial to ensure we have both
                  const map = new Map();
                  initial.forEach(s => map.set(s.id, s));
                  parsed.forEach(s => map.set(s.id, s)); // Saved overrides/adds to initial
                  return Array.from(map.values());
              }
          } catch (e) { console.error("Error loading known students", e); }
      }
      return initial;
  });

  const [isListLocallyCleared, setIsListLocallyCleared] = useState(false);

  useEffect(() => {
      localStorage.setItem(KNOWN_STUDENTS_KEY, JSON.stringify(knownStudents));
  }, [knownStudents]);

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
    return saved || 'https://script.google.com/macros/s/AKfycbzDUCgVLQefbF7pqCnFHAWZaxi9KnJYBzfqrST9nibnGASeDqqlRuFLWm6O4gu0d-kc/exec';
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

  const checkAndClearForNewDay = useCallback(() => {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD format
    const lastScanDate = localStorage.getItem(LAST_SCAN_DATE_KEY);

    if (lastScanDate && lastScanDate !== today) {
      console.log("New day detected. Clearing local data for a fresh start.");
      setAttendanceList([]);
      setLocallyDeletedIds(new Set());
      setSyncQueue([]); // Also clear pending sync tasks from the previous day.
    }
  }, []);

  useEffect(() => {
    checkAndClearForNewDay();
  }, [checkAndClearForNewDay]);

  // Network Listener
  useEffect(() => {
    console.log("UTS QR Attendance App Mounted - v1.8.0 (Reason Support)");

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
    if (view !== 'teacher' || !isOnline || !scriptUrl || isListLocallyCleared) return;

    try {
        const response = await fetch(scriptUrl);
        if (!response.ok) return;
        
        const data = await response.json();
        
        if (Array.isArray(data)) {
            // 1. Update Known Students Registry (Learn new names from cloud)
            setKnownStudents(prev => {
                const existingMap = new Map(prev.map(s => [s.id, s.name]));
                const newEntries: PreRegisteredStudent[] = [];
                let hasChanges = false;

                data.forEach((item: any) => {
                    const sId = String(item.studentId).toUpperCase();
                    const sName = String(item.name).toUpperCase();
                    if (sId && sName && !existingMap.has(sId)) {
                        existingMap.set(sId, sName);
                        newEntries.push({ id: sId, name: sName });
                        hasChanges = true;
                    }
                });

                if (hasChanges) {
                    return [...prev, ...newEntries];
                }
                return prev;
            });

            // 2. Update Attendance List
            setAttendanceList((prev: Student[]) => {
                const existingMap = new Map<string, Student>();
                prev.forEach(s => existingMap.set(s.studentId, s));
                
                const newStudents: Student[] = [];
                let listChanged = false;
                
                data.forEach((item: any) => {
                    const sId = String(item.studentId).toUpperCase();
                    const status = item.status || 'P';
                    
                    // Show anyone who is NOT 'A' (Absent).
                    // 'P' = Present, 'Medical' = Present with Reason, etc.
                    // 'A' implies they should be removed from the view.
                    const shouldShow = status !== 'A';

                    if (shouldShow && !locallyDeletedIds.has(sId)) {
                        if (!existingMap.has(sId)) {
                            // New remote student
                            newStudents.push({
                                name: item.name,
                                studentId: sId,
                                email: `${sId}@STUDENT.UTS.EDU.MY`,
                                timestamp: Date.now(), // Estimate timestamp
                                status: status
                            });
                            listChanged = true;
                        } else {
                            // Update existing student status if changed (e.g. from P to Medical)
                            const current = existingMap.get(sId);
                            if (current && current.status !== status) {
                                current.status = status;
                                listChanged = true;
                            }
                        }
                    }
                });
                
                if (listChanged) {
                    return [...newStudents, ...Array.from(existingMap.values())].sort((a: Student, b: Student) => b.timestamp - a.timestamp);
                }
                return prev;
            });
        }
    } catch (e) {
        console.warn("Polling failed (background)", e);
    }
  }, [scriptUrl, isOnline, view, locallyDeletedIds, isListLocallyCleared]);

  useEffect(() => {
    if (view === 'teacher') {
        fetchRemoteAttendance();
        const interval = setInterval(fetchRemoteAttendance, 10000); // Poll every 10 seconds
        return () => clearInterval(interval);
    }
  }, [fetchRemoteAttendance, view]);

  // --- CORE SYNC ENGINE (REINFORCED RETRY) ---
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
            if (isMounted) setSyncStatus(`Uploading ${task.data.studentId}...`);
            
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
            
            // TIMEOUT STRATEGY: 45s timeout.
            // If server is busy, it might lock for 30s. We give 15s buffer.
            const timeoutId = setTimeout(() => {
                if (isMounted) setSyncStatus('Server taking too long...');
                controller.abort();
            }, 45000); 

            if (isMounted) setSyncStatus('Connecting to Google Server...');

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
            
            // Handle HTML responses
            if (text.trim().startsWith('<')) {
                throw new Error("Access Denied: Script permissions incorrect. Set to 'Anyone'.");
            }

            let result;
            try {
                result = JSON.parse(text);
            } catch(e) {
                if (text.toLowerCase().includes('success')) {
                    result = { result: 'success' };
                } else {
                    throw new Error(`Invalid Server Response: ${text.substring(0, 50)}`);
                }
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
            let shouldRetryImmediately = false;

            if (err.name === 'AbortError') {
              detailedError = "Connection Timeout: Server busy. Auto-retrying...";
              if (isMounted) setSyncStatus('Timeout. Retrying...');
              shouldRetryImmediately = true;
            } else if (err.message === 'Failed to fetch') {
              detailedError = "Network Error: Auto-retrying when connected...";
              if (isMounted) setSyncStatus('Network error. Pending...');
            } else if (detailedError.includes("Access Denied")) {
               if (isMounted) setSyncStatus('Permission Error.');
            } else {
              if (isMounted) setSyncStatus(`Error: ${detailedError.substring(0, 30)}...`);
            }
            
            if (isMounted) {
                setSyncError(detailedError);
                // Schedule Retry
                // If it was a timeout, retry faster (2s). Otherwise standard jitter.
                const delay = shouldRetryImmediately ? 2000 : (3000 + Math.random() * 5000);
                setTimeout(() => {
                   if (isMounted) setRetryTrigger(c => c + 1);
                }, delay);
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

  const addStudent = (name: string, studentId: string, email: string, status: string, overrideTimestamp?: number) => {
      // CRITICAL FIX: Check for duplicates before proceeding.
      if (attendanceList.some(s => s.studentId === studentId)) {
        return { success: false, message: "This student has already been marked present." };
      }

      setIsListLocallyCleared(false); // Resume polling when new activity occurs
      // Run the check before adding a student, in case the app was left open overnight
      checkAndClearForNewDay();

      const timestamp = overrideTimestamp || Date.now();
      
      // Update Registry
      setKnownStudents(prev => {
         if (!prev.some(s => s.id === studentId)) {
             return [...prev, { id: studentId, name: name }];
         }
         return prev;
      });

      // Update Attendance List locally
      setAttendanceList(prev => {
        // This logic is now safe because we've already checked for duplicates
        return [{ name, studentId, email, timestamp, status }, ...prev];
      });

      // Remove from local deletion list if they are being added back
      if (locallyDeletedIds.has(studentId)) {
          setLocallyDeletedIds(prev => {
              const next = new Set(prev);
              next.delete(studentId);
              return next;
          });
      }

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
      
      // After successfully queueing the task, update the last scan date
      localStorage.setItem(LAST_SCAN_DATE_KEY, new Date().toISOString().slice(0, 10));
      
      return { success: true, message: "Recorded" };
  };

  const markAttendance = (name: string, studentId: string, email: string) => {
      return addStudent(name, studentId, email, 'P');
  };

  const onManualAdd = (name: string, id: string, email: string, status: string) => {
      return addStudent(name, id, email, status);
  };

  const onRemoveStudents = (ids: string[]) => {
      // 1. Remove from local list
      setAttendanceList(prev => prev.filter(s => !ids.includes(s.studentId)));
      
      // 2. Add to locally deleted set
      setLocallyDeletedIds(prev => {
          const next = new Set(prev);
          ids.forEach(id => next.add(id));
          return next;
      });

      // 3. Queue Sync Tasks with Status 'A' (Absent)
      const tasks: SyncTask[] = [];
      const now = Date.now();
      ids.forEach(id => {
           // We need name/email from known students or current list if possible
           const student = attendanceList.find(s => s.studentId === id) || knownStudents.find(k => k.id === id);
           const name = student ? ('name' in student ? student.name : student.name) : 'Unknown';
           
           tasks.push({
               id: `${id}-${now}-absent`,
               data: {
                   studentId: id,
                   name: name,
                   email: `${id}@STUDENT.UTS.EDU.MY`,
                   status: 'A', 
                   timestamp: now.toString()
               },
               timestamp: now
           });
      });
      
      if (tasks.length > 0) {
          setSyncQueue(prev => [...prev, ...tasks]);
      }
  };

  const onBulkStatusUpdate = (ids: string[], status: string) => {
      // Update local state
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
    if (window.confirm('Are you sure you want to clear the list? This only affects this device for the current session.')) {
      setAttendanceList([]);
      setSyncQueue([]);
      setIsListLocallyCleared(true);
    }
  };
  
  const onTestAttendance = () => {
      const now = Date.now();
      addStudent(
        "TEST DATA KEYING", 
        `TEST-${now.toString().slice(-4)}`, 
        "test@example.com", 
        'P', 
        now
      );
  };

  const onBulkTest = () => {
    if (window.confirm('This will add 200 test students to the sync queue to test system performance. Continue?')) {
      const now = Date.now();
      for (let i = 1; i <= 200; i++) {
        const studentId = `BULK-TEST-${now.toString().slice(-5)}-${i.toString().padStart(3, '0')}`;
        const studentName = `BULK TEST STUDENT #${i}`;
        addStudent(
          studentName,
          studentId,
          `${studentId}@test.uts.edu`,
          'P',
          now + i // Stagger timestamp slightly to ensure unique task IDs and order
        );
      }
    }
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
                     knownStudents={knownStudents}
                     onBulkTest={onBulkTest}
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
                       onRetry={handleRetryNow}
                       knownStudents={knownStudents}
                   />
               </div>
           </div>
       )}
    </div>
  );
};

export default App;
