
import React, { useState, useCallback, useEffect } from 'react';
import { TeacherView } from './components/TeacherView';
import { StudentView } from './components/StudentView';
import type { Student } from './types';

type View = 'teacher' | 'student';

const STORAGE_KEY = 'attendance-storage-standard-v1';
const DELETED_IDS_KEY = 'attendance-deleted-ids-v1';
const SCRIPT_URL_KEY = 'attendance-script-url-v21';

const App: React.FC = () => {
  // Determine view based on URL parameters
  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get('t');
  
  const initialView: View = token ? 'student' : 'teacher';

  const [view, setView] = useState<View>(initialView);
  const [isKioskMode, setIsKioskMode] = useState(false);
  const [attendanceList, setAttendanceList] = useState<Student[]>([]);
  
  // Track IDs that have been explicitly deleted locally so polling doesn't bring them back
  const [locallyDeletedIds, setLocallyDeletedIds] = useState<Set<string>>(() => {
    const saved = localStorage.getItem(DELETED_IDS_KEY);
    try {
        return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch (e) {
        return new Set();
    }
  });
  
  // Initialize with the user-provided Web App URL or empty.
  // We use lazy initialization here to check localStorage FIRST.
  const [scriptUrl, setScriptUrl] = useState<string>(() => {
    const saved = localStorage.getItem(SCRIPT_URL_KEY);
    return saved || 'https://script.google.com/macros/s/AKfycbxPcnCL5b7z_C9-PJXQH03r9IMPoDlxOeJqSv5A6ZtQCmgCk6XDeBUDcDjYaDX9gbIx/exec';
  });

  // Load attendance data from LocalStorage on mount
  useEffect(() => {
    const savedData = localStorage.getItem(STORAGE_KEY);
    if (savedData) {
      try {
        const parsed = JSON.parse(savedData);
        if (Array.isArray(parsed)) {
          setAttendanceList(parsed);
        }
      } catch (e) {
        console.error('Failed to parse attendance data', e);
      }
    }
  }, []);

  // Save data to LocalStorage whenever it changes
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(attendanceList));
  }, [attendanceList]);

  // Save deleted IDs to LocalStorage
  useEffect(() => {
    localStorage.setItem(DELETED_IDS_KEY, JSON.stringify(Array.from(locallyDeletedIds)));
  }, [locallyDeletedIds]);
  
  // Save Script URL to LocalStorage whenever it changes (Auto-save)
  useEffect(() => {
    localStorage.setItem(SCRIPT_URL_KEY, scriptUrl);
  }, [scriptUrl]);

  // Poll for updates if scriptUrl is present and we are in Teacher View
  useEffect(() => {
    if (!scriptUrl || !scriptUrl.startsWith('http') || view === 'student') return;

    let isMounted = true;

    const fetchData = async () => {
      try {
        // Add cache: 'no-store' to prevent browser caching of the GET request
        const response = await fetch(`${scriptUrl.trim()}?action=read&_=${Date.now()}`, {
          method: 'GET',
          cache: 'no-store',
          headers: {
            'Content-Type': 'text/plain',
          },
        });
        
        if (!response.ok) {
           return;
        }

        const data = await response.json();
        
        if (isMounted && Array.isArray(data)) {
           setAttendanceList(prevList => {
               const mergedMap = new Map<string, Student>();
               
               // 1. Start with existing local data to preserve timestamps and pending items
               prevList.forEach(s => {
                   if (s.studentId) {
                       mergedMap.set(s.studentId.toUpperCase(), s);
                   }
               });
               
               // 2. Merge server data (Update existing, Add new)
               (data as any[]).forEach((item: any) => {
                   if (!item.studentId) return;
                   
                   const normalizedId = item.studentId.toUpperCase();
                   
                   // Skip if explicitly deleted locally
                   if (locallyDeletedIds.has(normalizedId)) return;

                   const existing = mergedMap.get(normalizedId);
                   
                   mergedMap.set(normalizedId, {
                       name: item.name ? item.name.toUpperCase() : '',
                       studentId: normalizedId,
                       email: item.email ? item.email.toUpperCase() : '',
                       // Keep existing timestamp if available to preserve sort order/scan time
                       // If new from server, use item.timestamp (which is likely current server time)
                       timestamp: existing ? existing.timestamp : (item.timestamp || Date.now()),
                       status: item.status || 'P',
                   });
               });
               
               return Array.from(mergedMap.values());
           });
        }
      } catch (e) {
        console.warn('Polling failed (this is normal if offline or script URL is invalid):', e);
      }
    };

    // Poll every 5 seconds
    const interval = setInterval(fetchData, 5000);
    fetchData(); // Initial fetch
    return () => {
        isMounted = false;
        clearInterval(interval);
    };
  }, [scriptUrl, view, locallyDeletedIds]);

  const handleMarkAttendance = useCallback((name: string, studentId: string, email: string, status: 'P' | 'A' = 'P'): { success: boolean, message: string } => {
    const normalizedId = studentId.toUpperCase();
    
    // Check local duplicates
    const isDuplicate = attendanceList.some(s => s.studentId.toUpperCase() === normalizedId);
    
    // If student was previously deleted locally, un-delete them so they show up
    setLocallyDeletedIds(prev => {
        if (prev.has(normalizedId)) {
            const next = new Set(prev);
            next.delete(normalizedId);
            return next;
        }
        return prev;
    });

    // Add new
    const newStudent: Student = {
      name,
      studentId: normalizedId,
      email,
      timestamp: Date.now(),
      status
    };

    if (!isDuplicate) {
        setAttendanceList(prevList => [newStudent, ...prevList]);
    } else {
         // Even if duplicate locally, we might want to allow re-submission or just update timestamp.
         // For now, we update the timestamp of the existing entry and move to top
         setAttendanceList(prevList => {
             const filtered = prevList.filter(s => s.studentId.toUpperCase() !== normalizedId);
             return [newStudent, ...filtered];
         });
    }
    
    // Send to Google Apps Script for Storage (Background)
    if (scriptUrl && scriptUrl.startsWith('http')) {
        // Use URLSearchParams to send as application/x-www-form-urlencoded
        const formData = new URLSearchParams();
        formData.append('studentId', normalizedId);
        formData.append('name', name);
        formData.append('email', email);
        formData.append('status', status);

        fetch(scriptUrl.trim(), {
            method: 'POST',
            mode: 'no-cors', // Opaque response
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: formData
        }).catch(err => console.error("Failed to send data to script", err));
    }

    return { success: true, message: 'Attendance recorded!' };
  }, [attendanceList, scriptUrl]);

  const handleBulkStatusUpdate = useCallback((studentIds: string[], status: 'P' | 'A') => {
    const normalizedIds = studentIds.map(id => id.toUpperCase());

    // 1. Update Local State Immediately
    setAttendanceList(prevList => prevList.map(student => {
        if (normalizedIds.includes(student.studentId)) {
            return { ...student, status };
        }
        return student;
    }));

    // 2. Send updates to Server
    // Note: Since the Google Script processes one at a time, we send multiple requests.
    // In a production environment with high volume, a bulk API endpoint would be better.
    if (scriptUrl && scriptUrl.startsWith('http')) {
        normalizedIds.forEach(id => {
            const student = attendanceList.find(s => s.studentId === id);
            // We need the name/email from the existing record to satisfy the script requirements
            // If the student isn't found in current list (unlikely), we skip
            if (student) {
                const formData = new URLSearchParams();
                formData.append('studentId', student.studentId);
                formData.append('name', student.name);
                formData.append('email', student.email);
                formData.append('status', status);

                fetch(scriptUrl.trim(), {
                    method: 'POST',
                    mode: 'no-cors',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                    },
                    body: formData
                }).catch(err => console.error(`Failed to update status for ${id}`, err));
            }
        });
    }
  }, [attendanceList, scriptUrl]);

  const handleTestAttendance = () => {
      const randomId = Math.floor(Math.random() * 1000);
      const newStudent: Student = {
          name: "TEST STUDENT",
          studentId: `TEST-${randomId}`,
          email: `TEST${randomId}@EXAMPLE.COM`,
          timestamp: Date.now(),
          status: 'P'
      };
      
      handleMarkAttendance(newStudent.name, newStudent.studentId, newStudent.email, 'P');
  };

  const handleClearAttendance = () => {
      if (window.confirm("WARNING: This will clear the LOCAL attendance list. It will NOT delete data from the Google Sheet.")) {
        // Mark currently visible students as deleted so polling doesn't restore them immediately
        const currentIds = attendanceList.map(s => s.studentId.toUpperCase());
        setLocallyDeletedIds(prev => {
            const next = new Set(prev);
            currentIds.forEach(id => next.add(id));
            return next;
        });
        setAttendanceList([]);
      }
  };

  const handleRemoveStudents = useCallback((studentIds: string[]) => {
      const normalizedIds = studentIds.map(id => id.toUpperCase());
      // Update locally deleted IDs to prevent polling resurrection
      setLocallyDeletedIds(prev => {
          const next = new Set(prev);
          normalizedIds.forEach(id => next.add(id));
          return next;
      });
      // Deletes locally
      setAttendanceList(prevList => prevList.filter(s => !normalizedIds.includes(s.studentId.toUpperCase())));
  }, []);
  
  const handleOpenKiosk = () => {
    setIsKioskMode(true);
    setView('student');
  };

  const handleExitKiosk = () => {
    setIsKioskMode(false);
    setView('teacher');
  };

  const renderView = () => {
    if (view === 'student') {
        return (
            <StudentView 
                markAttendance={handleMarkAttendance} 
                token={token || 'admin-bypass'} 
                bypassRestrictions={isKioskMode}
                onExit={isKioskMode ? handleExitKiosk : undefined}
            />
        );
    }
    return (
        <TeacherView 
            attendanceList={attendanceList} 
            onTestAttendance={handleTestAttendance} 
            onClearAttendance={handleClearAttendance}
            onRemoveStudents={handleRemoveStudents}
            onBulkStatusUpdate={handleBulkStatusUpdate}
            scriptUrl={scriptUrl} 
            onScriptUrlChange={setScriptUrl} 
            onOpenKiosk={handleOpenKiosk}
            onManualAdd={handleMarkAttendance}
        />
    );
  };

  return (
    <div className="min-h-screen bg-base-100 flex flex-col items-center p-4 sm:p-6 lg:p-8 font-sans">
      <div className="w-full max-w-7xl mx-auto">
        <header className="text-center mb-8">
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-brand-primary to-brand-secondary">
            UTS QR Attendance
          </h1>
          <p className="text-gray-500 mt-2">Simple, secure attendance tracking.</p>
        </header>

        <main className="bg-base-200 rounded-xl shadow-lg p-4 sm:p-8">
          {renderView()}
        </main>
      </div>
    </div>
  );
};

export default App;
