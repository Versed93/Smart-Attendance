
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { TeacherView } from './components/TeacherView';
import { StudentView } from './components/StudentView';
import { LoginView } from './components/LoginView';
import type { Student } from './types';
import { PRE_REGISTERED_STUDENTS, PreRegisteredStudent } from './studentList';
import { FIREBASE_CONFIG } from './firebaseConfig';

type View = 'teacher' | 'student';

// Essential storage keys for UX and configuration
const SCRIPT_URL_KEY = 'attendance-script-url-v37'; 
const AUTH_KEY = 'attendance-lecturer-auth-v1';
const KNOWN_STUDENTS_KEY = 'attendance-known-students-v1';
const LECTURER_PASSWORD = 'adminscm'; 
const LAST_SCAN_DATE_KEY = 'attendance-last-scan-date-v1';

// Use today's date as a stable session ID for the live view
const SESSION_ID = new Date().toISOString().slice(0, 10);

const App: React.FC = () => {
  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get('t');
  const courseNameParam = urlParams.get('c');
  const isOfflineScan = urlParams.get('offline') === 'true';
  
  const latParam = urlParams.get('lat');
  const lngParam = urlParams.get('lng');
  const radParam = urlParams.get('rad');
  
  const initialView: View = token ? 'student' : 'teacher';

  const [view, setView] = useState<View>(initialView);
  const [isKioskMode, setIsKioskMode] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(() => localStorage.getItem(AUTH_KEY) === 'true');
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
    return localStorage.getItem(SCRIPT_URL_KEY) || 'https://script.google.com/macros/s/AKfycbxP3RrkoAOBJEd_AtUHXhYAqEBaNJhOHZFONNELI_3dsYalxlmd9ITiQjlYEW3fj46c/exec';
  });

  const checkAndClearForNewDay = useCallback(() => {
    const today = new Date().toISOString().slice(0, 10);
    const lastScanDate = localStorage.getItem(LAST_SCAN_DATE_KEY);
    if (lastScanDate && lastScanDate !== today) {
      console.log("New day detected. Clearing data for a fresh start.");
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
    if (view !== 'teacher' || !FIREBASE_CONFIG.DATABASE_URL || !FIREBASE_CONFIG.DATABASE_SECRET) return;
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
        console.warn("Polling from Firebase live session failed", e);
    }
  }, [view]);

  useEffect(() => {
    if (view === 'teacher') {
        fetchFirebaseLiveAttendance();
        const interval = setInterval(fetchFirebaseLiveAttendance, 8000); 
        return () => clearInterval(interval);
    }
  }, [fetchFirebaseLiveAttendance, view]);

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
  
  const handleNewSession = async () => {
    if (!FIREBASE_CONFIG.DATABASE_URL || !FIREBASE_CONFIG.DATABASE_SECRET) return;
    setAttendanceList([]);
    try {
        await fetch(`${FIREBASE_CONFIG.DATABASE_URL}/live_sessions/${SESSION_ID}.json?auth=${FIREBASE_CONFIG.DATABASE_SECRET}`, {
            method: 'DELETE',
        });
    } catch (e) {
        console.error("Failed to clear live session in Firebase", e);
    }
  };

  const addStudent = async (name: string, studentId: string, email: string, status: string, courseName: string, overrideTimestamp?: number) => {
      if (!FIREBASE_CONFIG.DATABASE_URL || !FIREBASE_CONFIG.DATABASE_SECRET) {
          return { success: false, message: "Firebase is not configured." };
      }
      
      checkAndClearForNewDay();
      const timestamp = overrideTimestamp || Date.now();
      const studentData = { name, studentId, email, status, timestamp, courseName };
      
      // Optimistic UI update
      setAttendanceList(prev => [{ ...studentData }, ...prev.filter(s => s.studentId !== studentId)]);

      try {
          // 1. Record to Firebase for Teacher's Live View & Pending Queue
          const p1 = fetch(`${FIREBASE_CONFIG.DATABASE_URL}/pending/${studentId}.json?auth=${FIREBASE_CONFIG.DATABASE_SECRET}`, {
              method: 'PUT',
              body: JSON.stringify(studentData),
          });
          const p2 = fetch(`${FIREBASE_CONFIG.DATABASE_URL}/live_sessions/${SESSION_ID}/${studentId}.json?auth=${FIREBASE_CONFIG.DATABASE_SECRET}`, {
              method: 'PUT',
              body: JSON.stringify(studentData),
          });
          
          await Promise.all([p1, p2]);

          // 2. IMMEDIATE DIRECT RECORDING TO GOOGLE SHEETS
          // This removes the need for manual force sync as long as student has internet
          if (scriptUrl) {
              fetch(scriptUrl, {
                  method: 'POST',
                  mode: 'no-cors',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ [studentId]: studentData }), // Wrap in object to match script expectations
              }).catch(err => console.warn("Background sheet recording failed, will rely on auto-trigger fallback", err));
          }
          
          setKnownStudents(prev => {
             if (!prev.some(s => s.id === studentId)) return [...prev, { id: studentId, name }];
             return prev;
          });
          localStorage.setItem(LAST_SCAN_DATE_KEY, new Date().toISOString().slice(0, 10));

          return { success: true, message: "Attendance Recorded & Synced." };
      } catch (error) {
          console.error("Firebase write error:", error);
          return { success: false, message: "Submission failed. Please check your internet connection." };
      }
  };

  const onRemoveStudents = async (ids: string[], courseName: string) => {
      if (!FIREBASE_CONFIG.DATABASE_URL || !FIREBASE_CONFIG.DATABASE_SECRET) return;
      setAttendanceList(prev => prev.filter(s => !ids.includes(s.studentId)));
      const now = Date.now();
      const promises: Promise<any>[] = [];

      for (const id of ids) {
        const student = attendanceList.find(s => s.studentId === id) || knownStudents.find(k => k.id === id);
        const name = student ? student.name : 'Unknown';
        const removalData = {
          studentId: id,
          name: name,
          email: `${id}@STUDENT.UTS.EDU.MY`,
          status: 'A', // Mark as Absent
          timestamp: now,
          courseName
        };
        
        const p1 = fetch(`${FIREBASE_CONFIG.DATABASE_URL}/pending/${id}.json?auth=${FIREBASE_CONFIG.DATABASE_SECRET}`, {
            method: 'PUT',
            body: JSON.stringify(removalData),
        });
        const p2 = fetch(`${FIREBASE_CONFIG.DATABASE_URL}/live_sessions/${SESSION_ID}/${id}.json?auth=${FIREBASE_CONFIG.DATABASE_SECRET}`, {
            method: 'DELETE',
        });
        promises.push(p1, p2);
      }
      await Promise.all(promises);
  };

  const onBulkStatusUpdate = async (ids: string[], status: string, courseName: string) => {
      setAttendanceList(prev => prev.map(s => ids.includes(s.studentId) ? { ...s, status } : s));
      const now = Date.now();
      const updatePayload: Record<string, Student> = {};

      for (const id of ids) {
        const student = attendanceList.find(s => s.studentId === id);
        if (student) {
           const updateData = { ...student, status, timestamp: now, courseName };
           updatePayload[id] = updateData;
           
           // Update Firebase
           fetch(`${FIREBASE_CONFIG.DATABASE_URL}/pending/${id}.json?auth=${FIREBASE_CONFIG.DATABASE_SECRET}`, {
                method: 'PUT',
                body: JSON.stringify(updateData),
           });
           fetch(`${FIREBASE_CONFIG.DATABASE_URL}/live_sessions/${SESSION_ID}/${id}.json?auth=${FIREBASE_CONFIG.DATABASE_SECRET}`, {
                method: 'PUT',
                body: JSON.stringify(updateData),
           });
        }
      }

      // Bulk direct record to Sheets
      if (scriptUrl && Object.keys(updatePayload).length > 0) {
          fetch(scriptUrl, {
              method: 'POST',
              mode: 'no-cors',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(updatePayload),
          });
      }
  };

  const handleSendTestRecord = async (courseName: string): Promise<{ success: boolean; message: string }> => {
    if (!FIREBASE_CONFIG.DATABASE_URL || !FIREBASE_CONFIG.DATABASE_SECRET) {
      return { success: false, message: "Firebase is not configured." };
    }
    const testStudentId = 'TEST001';
    const testRecord = {
      name: 'TEST STUDENT',
      studentId: testStudentId,
      email: 'test@student.uts.edu.my',
      status: 'P',
      timestamp: Date.now(),
      courseName: courseName || 'Test Session'
    };
    try {
      const response = await fetch(`${FIREBASE_CONFIG.DATABASE_URL}/pending/${testStudentId}.json?auth=${FIREBASE_CONFIG.DATABASE_SECRET}`, {
        method: 'PUT',
        body: JSON.stringify(testRecord),
      });
      if (!response.ok) throw new Error(response.statusText);
      
      // Also test direct sync
      if (scriptUrl) {
          fetch(scriptUrl, {
              method: 'POST',
              mode: 'no-cors',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ [testStudentId]: testRecord }),
          });
      }

      return { success: true, message: "Test record sent! Check your sheet now." };
    } catch (error) {
      console.error(error);
      return { success: false, message: "Failed to send test record." };
    }
  };

  const handleCheckPendingRecords = async (): Promise<{ success: boolean; message: string; count: number }> => {
    if (!FIREBASE_CONFIG.DATABASE_URL || !FIREBASE_CONFIG.DATABASE_SECRET) {
      return { success: false, message: "Firebase is not configured.", count: 0 };
    }
    try {
      const response = await fetch(`${FIREBASE_CONFIG.DATABASE_URL}/pending.json?auth=${FIREBASE_CONFIG.DATABASE_SECRET}`);
      const data = await response.json();
      if (data) {
        const count = Object.keys(data).length;
        return { success: true, message: `Found ${count} pending records.`, count };
      } else {
        return { success: true, message: "No pending records found.", count: 0 };
      }
    } catch (error) {
      return { success: false, message: "Connection error.", count: 0 };
    }
  };
  
  const handleForceSync = async (): Promise<{ success: boolean; message: string; syncedCount: number; errorCount: number; total: number }> => {
    if (!FIREBASE_CONFIG.DATABASE_URL || !FIREBASE_CONFIG.DATABASE_SECRET || !scriptUrl) {
        return { success: false, message: "Configuration missing.", syncedCount: 0, errorCount: 0, total: 0 };
    }
    const checkResponse = await fetch(`${FIREBASE_CONFIG.DATABASE_URL}/pending.json?auth=${FIREBASE_CONFIG.DATABASE_SECRET}`);
    const records = await checkResponse.json();
    if (!records) return { success: true, message: "No pending records to sync.", syncedCount: 0, errorCount: 0, total: 0 };
    const total = Object.keys(records).length;

    try {
        await fetch(scriptUrl, {
            method: 'POST',
            mode: 'no-cors', 
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(records),
        });
        return { success: true, message: `Sync command sent for ${total} records.`, syncedCount: total, errorCount: 0, total };
    } catch (e) {
        return { success: false, message: `Failed to send sync command.`, syncedCount: 0, errorCount: total, total };
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
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
                     onOpenKiosk={() => { setIsKioskMode(true); setView('student'); }}
                     onManualAdd={(name, id, email, status, courseName) => addStudent(name, id, email, status, courseName)}
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
               <div className="w-full max-w-md bg-white rounded-xl shadow-lg p-6">
                   <StudentView 
                       markAttendance={(name, id, email) => addStudent(name, id, email, 'P', courseNameParam || 'General')}
                       token={token || (isKioskMode ? Date.now().toString() : '')}
                       courseName={courseNameParam || undefined}
                       geoConstraints={latParam && lngParam ? { lat: parseFloat(latParam), lng: parseFloat(lngParam), radius: radParam ? parseFloat(radParam) : 150 } : undefined}
                       bypassRestrictions={isKioskMode}
                       onExit={() => { setIsKioskMode(false); setView('teacher'); }}
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
