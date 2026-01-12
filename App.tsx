import React, { useState, useCallback, useEffect } from 'react';
import { TeacherView } from './components/TeacherView';
import { StudentView } from './components/StudentView';
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
                throw new Error(`Cloud Server responded with ${response.status}. Retrying...`);
            }

            const text = await response.text();
            let result;
            try {
                result = JSON.parse(text);
            } catch(e) {
                throw new Error("Cloud script returned invalid response format. Check your Apps Script deployment.");
            }

            if (result.result !== 'success') {
                throw new Error(result.message || 'The attendance script rejected the data.');
            }

            if (active) {
              setSyncQueue(prev => prev.filter(t => t.id !== task.id));
              setSyncError(null);
            }

        } catch (err: any) {
            console.error("Cloud Sync Error:", err);
            if (active) setSyncError(err.message || "Failed to sync with cloud. Check internet connection.");
            
            // Jittered retry
            const jitter = 5000 + Math.random() * 10000;
            await new Promise(resolve => setTimeout(resolve, jitter));
        } finally {
            if (active) setIsSyncing(false);
        }
    };

    processNext();
    return () => { active = false; };
  }, [syncQueue, isSyncing, scriptUrl]);

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
           <div className="flex-1 p-4 overflow-auto">
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
               />
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
                   />
               </div>
           </div>
       )}
       {syncError && (
          <div className="fixed bottom-0 left-0 right-0 bg-red-600 text-white text-center p-2 text-sm font-bold animate-pulse z-50">
              SYNC ERROR: {syncError} (Retrying...)
          </div>
       )}
    </div>
  );
};

export default App;