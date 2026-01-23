
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { TeacherView } from './components/TeacherView';
import { StudentView } from './components/StudentView';
import { LoginView } from './components/LoginView';
import type { Student } from './types';
import { PRE_REGISTERED_STUDENTS, PreRegisteredStudent } from './studentList';
import { FIREBASE_CONFIG } from './firebaseConfig';

type View = 'teacher' | 'student';

const STORAGE_KEY = 'attendance-storage-standard-v1';
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
    return localStorage.getItem(SCRIPT_URL_KEY) || 'https://script.google.com/macros/s/AKfycbwj-23rrLPnzKQlnjT-KL-Aeno1JakDQxBPUQFBH5ugIkU5BIM7IYxF3y1usPcZB9Mo/exec';
  });

  const checkAndClearForNewDay = useCallback(() => {
    const today = new Date().toISOString().slice(0, 10);
    const lastScanDate = localStorage.getItem(LAST_SCAN_DATE_KEY);
    if (lastScanDate && lastScanDate !== today) {
      console.log("New day detected. Clearing local data for a fresh start.");
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
    if (view === 'teacher') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(attendanceList));
    }
  }, [attendanceList, view]);
  
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
            // Replace local state with Firebase state to ensure consistency and prevent deleted students from reappearing.
            setAttendanceList(firebaseStudents.sort((a, b) => b.timestamp - a.timestamp));
        } else {
            // If firebase is empty (e.g. after a deletion or new day), clear the list
            setAttendanceList([]);
        }
    } catch (e) {
        console.warn("Polling from Firebase live session failed", e);
    }
  }, [view]);

  useEffect(() => {
    if (view === 'teacher') {
        fetchFirebaseLiveAttendance(); // Initial fetch
        const interval = setInterval(fetchFirebaseLiveAttendance, 8000); // Poll for real-time updates
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

    // Clear local state
    setAttendanceList([]);

    // Clear remote live session state
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
      
      // Optimistically update UI
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
          
          const [responsePending] = await Promise.all([p1, p2]);

          if (!responsePending.ok) throw new Error('Failed to write to Firebase.');
          
          setKnownStudents(prev => {
             if (!prev.some(s => s.id === studentId)) return [...prev, { id: studentId, name }];
             return prev;
          });
          localStorage.setItem(LAST_SCAN_DATE_KEY, new Date().toISOString().slice(0, 10));

          return { success: true, message: "Recorded" };
      } catch (error) {
          console.error("Firebase write error:", error);
          // Revert optimistic update on failure? For now, we'll leave it to be corrected by next poll.
          return { success: false, message: "Could not connect to submission server." };
      }
  };

  const onRemoveStudents = async (ids: string[], courseName: string) => {
      if (!FIREBASE_CONFIG.DATABASE_URL || !FIREBASE_CONFIG.DATABASE_SECRET) return;

      setAttendanceList(prev => prev.filter(s => !ids.includes(s.studentId)));

      const now = Date.now();
      const promises: Promise<any>[] = [];

      for (const id of ids) {
        const student = attendanceList.find(s => s.studentId === id) || knownStudents.find(k => k.id === id);
        // FIX: The original check `('name' in student ? student.name : student.name)` caused a type error. In the 'else' branch, TypeScript inferred student as type 'never' and then tried to access '.name', leading to the error. Simplified to a direct property access which is safe as both potential object types for `student` contain a `name` property.
        const name = student ? student.name : 'Unknown';
        const removalData = {
          studentId: id,
          name: name,
          email: `${id}@STUDENT.UTS.EDU.MY`,
          status: 'A', // Mark as Absent
          timestamp: now,
          courseName
        };
        
        // Update pending for Apps Script to sync 'Absent' status
        const p1 = fetch(`${FIREBASE_CONFIG.DATABASE_URL}/pending/${id}.json?auth=${FIREBASE_CONFIG.DATABASE_SECRET}`, {
            method: 'PUT',
            body: JSON.stringify(removalData),
        });
        
        // DELETE from live session so it doesn't reappear in UI
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
      const promises: Promise<any>[] = [];

      for (const id of ids) {
        const student = attendanceList.find(s => s.studentId === id);
        if (student) {
           const updateData = { ...student, status, timestamp: now, courseName };
           const p1 = fetch(`${FIREBASE_CONFIG.DATABASE_URL}/pending/${id}.json?auth=${FIREBASE_CONFIG.DATABASE_SECRET}`, {
                method: 'PUT',
                body: JSON.stringify(updateData),
           });
           const p2 = fetch(`${FIREBASE_CONFIG.DATABASE_URL}/live_sessions/${SESSION_ID}/${id}.json?auth=${FIREBASE_CONFIG.DATABASE_SECRET}`, {
                method: 'PUT',
                body: JSON.stringify(updateData),
           });
           promises.push(p1, p2);
        }
      }
      await Promise.all(promises);
  };

  const handleSendTestRecord = async (courseName: string): Promise<{ success: boolean; message: string }> => {
    if (!FIREBASE_CONFIG.DATABASE_URL || !FIREBASE_CONFIG.DATABASE_SECRET) {
      return { success: false, message: "Firebase is not configured in firebaseConfig.ts." };
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

      if (!response.ok) {
        throw new Error('Firebase returned an error: ' + response.statusText);
      }

      return { success: true, message: "Test record sent! Check your sheet in ~1 minute." };
    } catch (error) {
      console.error("Firebase test write error:", error);
      return { success: false, message: "Failed to send. Check Firebase config & network." };
    }
  };

  const handleCheckPendingRecords = async (): Promise<{ success: boolean; message: string; count: number }> => {
    if (!FIREBASE_CONFIG.DATABASE_URL || !FIREBASE_CONFIG.DATABASE_SECRET) {
      return { success: false, message: "Firebase is not configured in firebaseConfig.ts.", count: 0 };
    }

    try {
      const response = await fetch(`${FIREBASE_CONFIG.DATABASE_URL}/pending.json?auth=${FIREBASE_CONFIG.DATABASE_SECRET}`);
      if (!response.ok) {
        throw new Error('Firebase returned an error: ' + response.statusText);
      }
      const data = await response.json();
      if (data) {
        const count = Object.keys(data).length;
        return { success: true, message: `Found ${count} pending records.`, count };
      } else {
        return { success: true, message: "No pending records found.", count: 0 };
      }
    } catch (error) {
      console.error("Firebase pending check error:", error);
      return { success: false, message: "Failed to check. Check Firebase config & network.", count: 0 };
    }
  };
  
  const handleForceSync = async (): Promise<{ success: boolean; message: string; syncedCount: number; errorCount: number; total: number }> => {
    if (!FIREBASE_CONFIG.DATABASE_URL || !FIREBASE_CONFIG.DATABASE_SECRET || !scriptUrl) {
        return { success: false, message: "Firebase/Script URL not configured.", syncedCount: 0, errorCount: 0, total: 0 };
    }

    // 1. Fetch pending records
    const checkResponse = await fetch(`${FIREBASE_CONFIG.DATABASE_URL}/pending.json?auth=${FIREBASE_CONFIG.DATABASE_SECRET}`);
    if (!checkResponse.ok) {
        return { success: false, message: "Failed to fetch pending records from Firebase.", syncedCount: 0, errorCount: 0, total: 0 };
    }
    const records = await checkResponse.json();

    if (!records) {
        return { success: true, message: "No pending records to sync.", syncedCount: 0, errorCount: 0, total: 0 };
    }
    const total = Object.keys(records).length;

    try {
        // 2. Send all records to Google Apps Script in a single POST request.
        // The script is now responsible for processing and deleting the records from Firebase.
        await fetch(scriptUrl, {
            method: 'POST',
            mode: 'no-cors', // We "fire and forget" because we can't read the response from a cross-origin script.
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(records),
        });

        // 3. Since we can't confirm success from the response, we provide an optimistic message.
        const message = `Sync command sent for ${total} records. Please use "Check Pending Records" again in a minute to verify completion.`;
        return { success: true, message, syncedCount: total, errorCount: 0, total };

    } catch (e) {
        console.error(`Failed to post records to Google Apps Script:`, e);
        const message = `Failed to send sync command. Check network connection and script URL.`;
        return { success: false, message, syncedCount: 0, errorCount: total, total };
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
