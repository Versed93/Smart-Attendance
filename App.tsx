
import React, { useState, useCallback, useEffect } from 'react';
import { TeacherView } from './components/TeacherView';
import { StudentView } from './components/StudentView';
import { LoginView } from './components/LoginView';
import type { Student } from './types';
import { PRE_REGISTERED_STUDENTS, PreRegisteredStudent } from './studentList';
import { FIREBASE_CONFIG } from './firebaseConfig';

type View = 'teacher' | 'student';

const SCRIPT_URL_KEY = 'attendance-script-url-v58'; 
const AUTH_KEY = 'attendance-lecturer-auth-v1';
const VIEW_PREF_KEY = 'attendance-view-pref-v1';
const KIOSK_PREF_KEY = 'attendance-kiosk-pref-v1';
const KNOWN_STUDENTS_KEY = 'attendance-known-students-v1';
const LECTURER_PASSWORD = 'adminscm'; 
const LAST_SCAN_DATE_KEY = 'attendance-last-scan-date-v1';

const SESSION_ID = new Date().toISOString().slice(0, 10);

const App: React.FC = () => {
  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get('t');
  const courseNameParam = urlParams.get('c');
  const isOfflineScan = urlParams.get('offline') === 'true';
  
  const latParam = urlParams.get('lat');
  const lngParam = urlParams.get('lng');
  const radParam = urlParams.get('rad');
  
  const savedView = localStorage.getItem(VIEW_PREF_KEY) as View;
  const initialView: View = token ? 'student' : (savedView || 'teacher');

  const [view, setView] = useState<View>(initialView);
  const [isKioskMode, setIsKioskMode] = useState(() => localStorage.getItem(KIOSK_PREF_KEY) === 'true');
  
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
      const auth = localStorage.getItem(AUTH_KEY) === 'true';
      const kiosk = localStorage.getItem(KIOSK_PREF_KEY) === 'true';
      return auth && !kiosk; 
  });

  const [attendanceList, setAttendanceList] = useState<Student[]>([]);
  
  const [knownStudents, setKnownStudents] = useState<PreRegisteredStudent[]>(() => {
      const saved = localStorage.getItem(KNOWN_STUDENTS_KEY);
      const initial = PRE_REGISTERED_STUDENTS;
      if (saved) {
          try {
              const parsed = JSON.parse(saved);
              if (Array.isArray(parsed)) {
                  const map = new Map();
                  initial.forEach(s => map.set(s.id, s));
                  parsed.forEach(s => map.set(s.id, s));
                  return Array.from(map.values());
              }
          } catch (e) { console.error("Error loading known students", e); }
      }
      return initial;
  });

  const [scriptUrl, setScriptUrl] = useState<string>(() => {
    return localStorage.getItem(SCRIPT_URL_KEY) || 'https://script.google.com/macros/s/AKfycbxpwABKeVoJgMVdeCI7OHDgB-Cm0146YldpgYMixjQNVQjUt4c1WZX8K6HCx9zNdK-h/exec';
  });

  useEffect(() => {
    if (!token) {
        localStorage.setItem(VIEW_PREF_KEY, view);
    }
  }, [view, token]);

  useEffect(() => {
    localStorage.setItem(KIOSK_PREF_KEY, isKioskMode.toString());
  }, [isKioskMode]);

  const checkAndClearForNewDay = useCallback(() => {
    const today = new Date().toISOString().slice(0, 10);
    const lastScanDate = localStorage.getItem(LAST_SCAN_DATE_KEY);
    if (lastScanDate && lastScanDate !== today) {
      setAttendanceList([]);
    }
  }, []);

  useEffect(() => {
    checkAndClearForNewDay();
  }, [checkAndClearForNewDay]);

  useEffect(() => {
    localStorage.setItem(KNOWN_STUDENTS_KEY, JSON.stringify(knownStudents));
  }, [knownStudents]);

  useEffect(() => {
    localStorage.setItem(SCRIPT_URL_KEY, scriptUrl);
  }, [scriptUrl]);
  
  const fetchFirebaseLiveAttendance = useCallback(async () => {
    if (view !== 'teacher' || !FIREBASE_CONFIG.DATABASE_URL || !FIREBASE_CONFIG.DATABASE_SECRET || !isAuthenticated) return;
    try {
        const response = await fetch(`${FIREBASE_CONFIG.DATABASE_URL}/live_sessions/${SESSION_ID}.json?auth=${FIREBASE_CONFIG.DATABASE_SECRET}`);
        if (!response.ok && response.status !== 404) return;
        const data = response.status === 404 ? null : await response.json();
        if (data) {
            const firebaseStudents: Student[] = Object.values(data);
            setAttendanceList(firebaseStudents.sort((a, b) => b.timestamp - a.timestamp));
        } else {
            setAttendanceList([]);
        }
    } catch (e) {
        console.warn("Polling failed", e);
    }
  }, [view, isAuthenticated]);

  useEffect(() => {
    if (view === 'teacher' && isAuthenticated) {
        fetchFirebaseLiveAttendance();
        const interval = setInterval(fetchFirebaseLiveAttendance, 8000); 
        return () => clearInterval(interval);
    }
  }, [fetchFirebaseLiveAttendance, view, isAuthenticated]);

  const handleLogin = (password: string) => {
    if (password === LECTURER_PASSWORD) {
        setIsAuthenticated(true);
        localStorage.setItem(AUTH_KEY, 'true');
        return true;
    }
    return false;
  };

  const handleLogout = useCallback(() => {
    setIsAuthenticated(false);
    localStorage.removeItem(AUTH_KEY);
    localStorage.removeItem(KIOSK_PREF_KEY);
    setView('teacher'); 
    setIsKioskMode(false);
  }, []);

  const handleEnterKiosk = useCallback(() => {
      setIsKioskMode(true);
      setView('student');
      localStorage.removeItem(AUTH_KEY); 
      setIsAuthenticated(false);
  }, []);
  
  const handleNewSession = async () => {
    if (!FIREBASE_CONFIG.DATABASE_URL || !FIREBASE_CONFIG.DATABASE_SECRET) return;
    setAttendanceList([]);
    try {
        await fetch(`${FIREBASE_CONFIG.DATABASE_URL}/live_sessions/${SESSION_ID}.json?auth=${FIREBASE_CONFIG.DATABASE_SECRET}`, {
            method: 'DELETE',
        });
    } catch (e) {
        console.error("Failed to clear live session", e);
    }
  };

  const addStudent = async (name: string, studentId: string, email: string, status: string, courseName: string, overrideTimestamp?: number, absenceReason?: string) => {
      if (!FIREBASE_CONFIG.DATABASE_URL || !FIREBASE_CONFIG.DATABASE_SECRET) {
          return { success: false, message: "Configuration error." };
      }
      checkAndClearForNewDay();
      const timestamp = overrideTimestamp || Date.now();
      const studentData: Student = { name, studentId, email, status, timestamp, courseName, absenceReason };
      
      setAttendanceList(prev => [{ ...studentData }, ...prev.filter(s => s.studentId !== studentId)]);

      try {
          const p1 = fetch(`${FIREBASE_CONFIG.DATABASE_URL}/pending/${studentId}.json?auth=${FIREBASE_CONFIG.DATABASE_SECRET}`, {
              method: 'PUT',
              body: JSON.stringify(studentData),
          });
          const p2 = fetch(`${FIREBASE_CONFIG.DATABASE_URL}/live_sessions/${SESSION_ID}/${studentId}.json?auth=${FIREBASE_CONFIG.DATABASE_SECRET}`, {
              method: 'PUT',
              body: JSON.stringify(studentData),
          });
          await Promise.all([p1, p2]);
          if (scriptUrl) {
              fetch(scriptUrl, {
                  method: 'POST',
                  mode: 'no-cors',
                  body: JSON.stringify({ [studentId]: studentData }),
              }).catch(err => console.warn("Deferred sync", err));
          }
          setKnownStudents(prev => {
             if (!prev.some(s => s.id === studentId)) return [...prev, { id: studentId, name }];
             return prev;
          });
          localStorage.setItem(LAST_SCAN_DATE_KEY, new Date().toISOString().slice(0, 10));
          return { success: true, message: "Record submitted successfully." };
      } catch (error) {
          return { success: false, message: "Connection lost. Please try again." };
      }
  };

  const onRemoveStudents = async (ids: string[], courseName: string) => {
      if (!FIREBASE_CONFIG.DATABASE_URL || !FIREBASE_CONFIG.DATABASE_SECRET) return;
      setAttendanceList(prev => prev.filter(s => !ids.includes(s.studentId)));
      const now = Date.now();
      const promises: Promise<any>[] = [];
      for (const id of ids) {
        const student = attendanceList.find(s => s.studentId === id) || knownStudents.find(k => k.id === id);
        const removalData: Student = {
          studentId: id,
          name: student?.name || 'Unknown',
          email: `${id}@STUDENT.UTS.EDU.MY`,
          status: 'A',
          timestamp: now,
          courseName,
          absenceReason: 'Lecturer Override'
        };
        promises.push(
          fetch(`${FIREBASE_CONFIG.DATABASE_URL}/pending/${id}.json?auth=${FIREBASE_CONFIG.DATABASE_SECRET}`, { method: 'PUT', body: JSON.stringify(removalData) }),
          fetch(`${FIREBASE_CONFIG.DATABASE_URL}/live_sessions/${SESSION_ID}/${id}.json?auth=${FIREBASE_CONFIG.DATABASE_SECRET}`, { method: 'DELETE' })
        );
        if (scriptUrl) fetch(scriptUrl, { method: 'POST', mode: 'no-cors', body: JSON.stringify({ [id]: removalData }) });
      }
      await Promise.all(promises);
  };

  const onBulkStatusUpdate = async (ids: string[], status: string, courseName: string, absenceReason?: string) => {
      setAttendanceList(prev => prev.map(s => ids.includes(s.studentId) ? { ...s, status, absenceReason } : s));
      const now = Date.now();
      const updatePayload: Record<string, Student> = {};
      for (const id of ids) {
        const student = attendanceList.find(s => s.studentId === id);
        if (student) {
           const updateData: Student = { ...student, status, timestamp: now, courseName, absenceReason };
           updatePayload[id] = updateData;
           fetch(`${FIREBASE_CONFIG.DATABASE_URL}/pending/${id}.json?auth=${FIREBASE_CONFIG.DATABASE_SECRET}`, { method: 'PUT', body: JSON.stringify(updateData) });
           fetch(`${FIREBASE_CONFIG.DATABASE_URL}/live_sessions/${SESSION_ID}/${id}.json?auth=${FIREBASE_CONFIG.DATABASE_SECRET}`, { method: 'PUT', body: JSON.stringify(updateData) });
        }
      }
      if (scriptUrl && Object.keys(updatePayload).length > 0) {
          fetch(scriptUrl, { method: 'POST', mode: 'no-cors', body: JSON.stringify(updatePayload) });
      }
  };

  const handleSendTestRecord = async (courseName: string): Promise<{ success: boolean; message: string }> => {
    if (!FIREBASE_CONFIG.DATABASE_URL || !FIREBASE_CONFIG.DATABASE_SECRET) return { success: false, message: "Firebase URL missing." };
    const testRecord: Student = { name: 'CONNECTION TEST', studentId: 'TEST999', email: 'test@student.uts.edu.my', status: 'P', timestamp: Date.now(), courseName: courseName || 'Connectivity Test', absenceReason: '' };
    try {
      await fetch(`${FIREBASE_CONFIG.DATABASE_URL}/pending/TEST999.json?auth=${FIREBASE_CONFIG.DATABASE_SECRET}`, { method: 'PUT', body: JSON.stringify(testRecord) });
      if (scriptUrl) await fetch(scriptUrl, { method: 'POST', mode: 'no-cors', body: JSON.stringify({ 'TEST999': testRecord }) });
      return { success: true, message: "Test signal sent to Cloud." };
    } catch (e) { return { success: false, message: "Cloud test failed." }; }
  };

  const handleCheckPendingRecords = async (): Promise<{ success: boolean; message: string; count: number }> => {
    if (!FIREBASE_CONFIG.DATABASE_URL || !FIREBASE_CONFIG.DATABASE_SECRET) return { success: false, message: "Firebase URL missing.", count: 0 };
    try {
      const res = await fetch(`${FIREBASE_CONFIG.DATABASE_URL}/pending.json?auth=${FIREBASE_CONFIG.DATABASE_SECRET}`);
      const data = await res.json();
      return { success: true, message: data ? `Queue length: ${Object.keys(data).length}` : "Synchronization queue is empty.", count: data ? Object.keys(data).length : 0 };
    } catch (e) { return { success: false, message: "Status check failed.", count: 0 }; }
  };
  
  const handleForceSync = async (): Promise<{ success: boolean; message: string; syncedCount: number; errorCount: number; total: number }> => {
    if (!scriptUrl) return { success: false, message: "Script Endpoint missing.", syncedCount: 0, errorCount: 0, total: 0 };
    try {
        await fetch(scriptUrl, { method: 'POST', mode: 'no-cors', body: JSON.stringify({ "action": "SYNC_QUEUE" }) });
        return { success: true, message: "Cloud synchronization command triggered.", syncedCount: 0, errorCount: 0, total: 0 };
    } catch (e) { return { success: false, message: "Trigger failed.", syncedCount: 0, errorCount: 0, total: 0 }; }
  };

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col font-sans antialiased">
       {view === 'teacher' ? (
           isAuthenticated ? (
             <div className="flex-1 p-4 overflow-auto relative">
                 <TeacherView 
                     attendanceList={attendanceList}
                     onRemoveStudents={onRemoveStudents}
                     onBulkStatusUpdate={onBulkStatusUpdate}
                     onNewSession={handleNewSession}
                     scriptUrl={scriptUrl}
                     onScriptUrlChange={setScriptUrl}
                     onOpenKiosk={handleEnterKiosk}
                     onManualAdd={(name, id, email, status, courseName, reason) => addStudent(name, id, email, status, courseName, undefined, reason)}
                     addStudent={addStudent}
                     onLogout={handleLogout}
                     knownStudents={knownStudents}
                     onSendTestRecord={handleSendTestRecord}
                     onCheckPendingRecords={handleCheckPendingRecords}
                     onForceSync={handleForceSync}
                 />
             </div>
           ) : <LoginView onLogin={handleLogin} />
       ) : (
           <div className="flex-1 flex flex-col items-center justify-center p-4 bg-gray-50">
               <div className="w-full max-w-md bg-white rounded-xl shadow-lg p-6 border border-gray-100">
                   <StudentView 
                       markAttendance={(name, id, email) => addStudent(name, id, email, 'P', courseNameParam || 'General Session')}
                       token={token || (isKioskMode ? Date.now().toString() : '')}
                       courseName={courseNameParam || undefined}
                       geoConstraints={latParam && lngParam ? { lat: parseFloat(latParam), lng: parseFloat(lngParam), radius: radParam ? parseFloat(radParam) : 150 } : undefined}
                       bypassRestrictions={isKioskMode}
                       onExit={handleLogout}
                       isOfflineScan={isOfflineScan}
                       knownStudents={knownStudents}
                   />
               </div>
           </div>
       )}
    </div>
  );
};

export default App;
