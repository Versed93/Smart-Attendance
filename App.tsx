
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { TeacherView } from './components/TeacherView';
import { StudentView } from './components/StudentView';
import { ExclamationTriangleIcon } from './components/icons/ExclamationTriangleIcon';
import { GlobeIcon } from './components/icons/GlobeIcon';
import type { Student } from './types';

type View = 'teacher' | 'student';

const STORAGE_KEY = 'attendance-storage-standard-v1';
const DELETED_IDS_KEY = 'attendance-deleted-ids-v1';
const SCRIPT_URL_KEY = 'attendance-script-url-v21';
const SYNC_QUEUE_KEY = 'attendance-sync-queue-v2';

interface SyncTask {
  id: string;
  data: Record<string, string>;
  timestamp: number;
}

const App: React.FC = () => {
  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get('t');
  const initialView: View = token ? 'student' : 'teacher';

  const [view, setView] = useState<View>(initialView);
  const [isKioskMode, setIsKioskMode] = useState(false);
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
    return saved || 'https://script.google.com/macros/s/AKfycbxhMDImDgH34jMpCuCKTl_iL3xxnZf9OzjXORqnULDOg02C64p3JArfT8xH4oX7RsmS/exec';
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
  
  // Ref to hold the resolve function of the jitter delay promise, allowing manual retry
  const retryResolveRef = useRef<(() => void) | null>(null);

  // Network Listener
  useEffect(() => {
    const handleOnline = () => {
        setIsOnline(true);
        // Immediately trigger retry when back online
        if (retryResolveRef.current) retryResolveRef.current();
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

  useEffect(() => {
    if (syncQueue.length === 0 || isSyncing) return;
    if (!scriptUrl || !scriptUrl.startsWith('http')) return;

    // If offline, pause processing but don't clear queue.
    if (!isOnline) {
        return;
    }

    let active = true;

    const processNext = async () => {
        setIsSyncing(true);
        const task = syncQueue[0];

        try {
            const formData = new URLSearchParams();
            Object.entries(task.data).forEach(([k, v]) => formData.append(k, String(v)));

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 20000);

            const response = await fetch(scriptUrl.trim(), {
                method: 'POST',
                body: formData,
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const errText = await response.text().catch(() => response.statusText);
                throw new Error(`HTTP Error ${response.status}: ${errText.slice(0, 200) || 'Check Script URL permissions'}`);
            }

            const text = await response.text();
            let result;
            try {
                result = JSON.parse(text);
            } catch(e) {
                const snippet = text.length > 100 ? text.substring(0, 100) + '...' : text;
                throw new Error(`Invalid Server Response: Expected JSON but got "${snippet}". Check Script URL.`);
            }

            if (result.result !== 'success') {
                throw new Error(`Script Error: ${result.message || 'Data rejected by script'}`);
            }

            if (active) {
              setSyncQueue(prev => prev.filter(t => t.id !== task.id));
              setSyncError(null);
            }

        } catch (err: any) {
            console.error("Cloud Sync Error:", err);
            
            let detailedError = err.message || "Failed to sync with cloud.";
            if (err.name === 'AbortError') {
              detailedError = "Connection Timeout: Server took too long to respond.";
            } else if (err.message === 'Failed to fetch') {
              // Usually indicates offline or DNS failure
              detailedError = "Network Error: Could not connect to Google Script. Pausing.";
            }
            
            if (active) setSyncError(detailedError);
            
            // Wait before retry, but allow immediate retry if 'online' event fires
            const jitter = 5000 + Math.random() * 10000;
            await new Promise<void>(resolve => {
                retryResolveRef.current = resolve;
                setTimeout(resolve, jitter);
            });
            retryResolveRef.current = null;
        } finally {
            if (active) setIsSyncing(false);
        }
    };

    processNext();
    return () => { active = false; };
  }, [syncQueue, isSyncing, scriptUrl, isOnline]);

  const handleRetryNow = useCallback(() => {
      if (retryResolveRef.current) {
          retryResolveRef.current(); // Resolve the delay promise immediately
      }
  }, []);

  const addStudent = (name: string, studentId: string, email: string, status: 'P' | 'A') => {
      const timestamp = Date.now();
      const newStudent: Student = { name, studentId, email, timestamp, status };
      
      setAttendanceList(prev => [newStudent, ...prev.filter(s => s.studentId !== studentId)]);

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
      addStudent("TEST USER", `TEST-${Date.now().toString().slice(-4)}`, "test@example.com", 'P');
  };

  const onOpenKiosk = () => {
      setIsKioskMode(true);
      setView('student');
  };

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
       {view === 'teacher' ? (
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
                   syncError={syncError}
                   onRetrySync={handleRetryNow}
                   isOnline={isOnline}
               />
               
               {/* Prominent Error Notification */}
               {syncError && isOnline && (
                  <div className="fixed top-6 right-6 max-w-sm w-full bg-white border-l-4 border-red-500 shadow-2xl rounded-r-lg p-5 z-[100] flex flex-col gap-3 animate-pulse">
                      <div className="flex items-start gap-4">
                          <div className="text-red-500 bg-red-100 p-2 rounded-full">
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
                            className="px-4 py-2 bg-red-600 text-white text-sm font-bold rounded shadow hover:bg-red-700 transition-colors flex items-center gap-2"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                            Retry Now
                          </button>
                      </div>
                  </div>
               )}
               {!isOnline && syncQueue.length > 0 && (
                   <div className="fixed top-6 right-6 max-w-sm w-full bg-yellow-50 border-l-4 border-yellow-500 shadow-xl rounded-r-lg p-4 z-[100] flex items-center gap-3">
                       <GlobeIcon className="w-6 h-6 text-yellow-600" />
                       <div>
                           <h3 className="font-bold text-yellow-800 text-sm">Offline Mode</h3>
                           <p className="text-xs text-yellow-700">{syncQueue.length} records pending upload.</p>
                       </div>
                   </div>
               )}
           </div>
       ) : (
           <div className="flex-1 flex flex-col items-center justify-center p-4 bg-gray-50">
               <div className="w-full max-w-md bg-white rounded-xl shadow-lg p-6">
                   <StudentView 
                       markAttendance={markAttendance}
                       token={token || (isKioskMode ? Date.now().toString() : '')}
                       bypassRestrictions={isKioskMode}
                       onExit={() => { setIsKioskMode(false); setView('teacher'); }}
                       isSyncing={isSyncing || syncQueue.length > 0}
                       isOnline={isOnline}
                   />
               </div>
           </div>
       )}
    </div>
  );
};

export default App;
