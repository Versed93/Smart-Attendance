import React, { useState, useCallback, useEffect, useRef } from 'react';
import { TeacherView } from './components/TeacherView';
import { StudentView } from './components/StudentView';
import { LoginView } from './components/LoginView';
import type { Student, AppUser, AdminSessionActivity, AdminNotification, CourseProfile } from './types';
import { PRE_REGISTERED_STUDENTS, PreRegisteredStudent } from './studentList';
import { FIREBASE_CONFIG } from './firebaseConfig';

type View = 'teacher' | 'student';
type IntegrationType = 'google_sheets' | 'airtable' | 'firebase';

const SCRIPT_URL_KEY = 'attendance-script-url-v58';
const AUTH_KEY = 'attendance-lecturer-auth-v1';
const VIEW_PREF_KEY = 'attendance-view-pref-v1';
const KIOSK_PREF_KEY = 'attendance-kiosk-pref-v1';
const KNOWN_STUDENTS_KEY = 'attendance-known-students-v2';
const LEGACY_KNOWN_STUDENTS_KEY = 'attendance-known-students-v1';
const LECTURER_PASSWORD = 'adminscm';
const LAST_SCAN_DATE_KEY = 'attendance-last-scan-date-v1';
const REGISTERED_USERS_KEY = 'attendance-registered-users-v1';
const CURRENT_ADMIN_NAME_KEY = 'attendance-current-admin-name-v1';
const CURRENT_USER_ID_KEY = 'attendance-current-user-id-v1';
const ACTIVE_SESSION_ID_KEY = 'attendance-active-session-id-v1';
const TEACHER_HISTORY_KEY = 'attendance-teacher-history-v1';
const ADMIN_EMAIL_KEY = 'attendance-admin-email-v1';
const ACTIVE_WEEK_KEY = 'attendance-active-week-v2';
const COURSES_KEY = 'attendance-courses-v1';

const DEFAULT_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwbjXTrbFPRqVA0I-RGc1rV7K7eZ_CkgQujSBVtOtvjDCW1GJYAkxiVlXJzAB_-R_CaLA/exec';

const SESSION_ID = new Date().toISOString().slice(0, 10);

const DEFAULT_ADMIN_USER: AppUser = {
  id: 'admin',
  username: 'admin',
  email: '',
  password: LECTURER_PASSWORD,
  role: 'admin',
  status: 'active',
  createdAt: 0,
};

const getBaseDbUrl = () => FIREBASE_CONFIG.DATABASE_URL.replace(/\/+$/, '');

const buildDbUrl = (path: string) => {
  const cleanPath = path.replace(/^\/+/, '');
  return `${getBaseDbUrl()}/${cleanPath}.json?auth=${FIREBASE_CONFIG.DATABASE_SECRET}&_ts=${Date.now()}`;
};

const getDeviceLabel = (): string => {
  const ua = navigator.userAgent || '';
  let os = 'Desktop';
  if (/iPhone/i.test(ua)) os = 'iPhone';
  else if (/iPad/i.test(ua)) os = 'iPad';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/Windows/i.test(ua)) os = 'Windows';
  else if (/Mac OS X|Macintosh/i.test(ua)) os = 'macOS';
  else if (/Linux/i.test(ua)) os = 'Linux';

  let browser = 'Browser';
  if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/OPR\/|Opera/i.test(ua)) browser = 'Opera';
  else if (/Chrome\//i.test(ua) && !/Edg\//i.test(ua)) browser = 'Chrome';
  else if (/Firefox\//i.test(ua)) browser = 'Firefox';
  else if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) browser = 'Safari';

  return `${browser} • ${os}`;
};

const generateToken = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '');
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
};

const toFirebaseKey = (raw: string) => raw.replace(/[^a-zA-Z0-9_-]/g, '_');

const getPublicAppUrl = () => {
  const publicOrigin = window.location.origin.replace(/^https:\/\/ais-dev-/i, 'https://ais-pre-');
  return `${publicOrigin}${window.location.pathname}`;
};

const App: React.FC = () => {
  const [initialUrlParams] = useState(() => new URLSearchParams(window.location.search));
  const token = initialUrlParams.get('t');
  const courseNameParam = initialUrlParams.get('c');
  const weekParam = initialUrlParams.get('w');
  const isOfflineScan = initialUrlParams.get('offline') === 'true';
  const activateTokenParam = initialUrlParams.get('activate');
  const activateUserParam = initialUrlParams.get('user');
  const testEmailParam = initialUrlParams.get('test_email');

  const latParam = initialUrlParams.get('lat');
  const lngParam = initialUrlParams.get('lng');
  const radParam = initialUrlParams.get('rad');

  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    if ((activateTokenParam && activateUserParam) || testEmailParam === 'verified') return false;
    const auth = localStorage.getItem(AUTH_KEY) === 'true';
    const kiosk = localStorage.getItem(KIOSK_PREF_KEY) === 'true';
    return auth && !kiosk;
  });

  const savedView = localStorage.getItem(VIEW_PREF_KEY) as View;

  // SECURITY: If not authenticated and no token is present, always force 'student' view unless opening an activation or test email link.
  const initialView: View = (activateTokenParam && activateUserParam) || testEmailParam === 'verified'
    ? 'teacher'
    : (token || !isAuthenticated)
      ? 'student'
      : (savedView || 'teacher');

  const [view, setView] = useState<View>(initialView);
  const [isKioskMode, setIsKioskMode] = useState(() => localStorage.getItem(KIOSK_PREF_KEY) === 'true');
  const [activeCourse, setActiveCourse] = useState(() => localStorage.getItem('attendance-course-name') || '');
  const [selectedWeek, setSelectedWeek] = useState<string>(() => {
    localStorage.removeItem('attendance-active-week');
    return localStorage.getItem(ACTIVE_WEEK_KEY) || 'W1';
  });
  const [integrationType, setIntegrationType] = useState<IntegrationType>(() => {
    return (localStorage.getItem('attendance-integration-type') as IntegrationType) || 'google_sheets';
  });
  const [adminEmail, setAdminEmail] = useState<string>(() => localStorage.getItem(ADMIN_EMAIL_KEY) || '');

  const [registeredUsers, setRegisteredUsers] = useState<AppUser[]>(() => {
    const saved = localStorage.getItem(REGISTERED_USERS_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map((u: Partial<AppUser> & { username?: string; password?: string }) => ({
            id: u.id || toFirebaseKey((u.username || 'user').toLowerCase()),
            username: u.username || 'user',
            email: u.email || '',
            password: u.password || '',
            role: u.username?.toLowerCase() === 'admin' ? 'admin' : (u.role || 'lecturer'),
            status: u.status || 'active',
            activationToken: u.activationToken,
            createdAt: u.createdAt || Date.now(),
            activatedAt: u.activatedAt,
            lastLoginAt: u.lastLoginAt,
          }));
        }
      } catch { /* ignore */ }
    }
    return [DEFAULT_ADMIN_USER];
  });

  const [hasLoadedCloudUsers, setHasLoadedCloudUsers] = useState(false);
  const [adminSessions, setAdminSessions] = useState<AdminSessionActivity[]>([]);
  const [adminNotifications, setAdminNotifications] = useState<AdminNotification[]>([]);
  const [activationNotice, setActivationNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(() =>
    testEmailParam === 'verified'
      ? {
          type: 'success',
          message: 'Test email link verified! Account activation buttons are working properly.',
        }
      : null
  );

  const [currentAdminName, setCurrentAdminName] = useState(() => {
    return localStorage.getItem(CURRENT_ADMIN_NAME_KEY) || '';
  });
  const [currentUserId, setCurrentUserId] = useState(() => {
    return localStorage.getItem(CURRENT_USER_ID_KEY) || '';
  });
  const [activeSessionId, setActiveSessionId] = useState(() => {
    return localStorage.getItem(ACTIVE_SESSION_ID_KEY) || '';
  });

  const [attendanceList, setAttendanceList] = useState<Student[]>([]);
  const [teacherHistory, setTeacherHistory] = useState<Student[]>(() => {
    const saved = localStorage.getItem(TEACHER_HISTORY_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      } catch { /* ignore */ }
    }
    return [];
  });

  const [knownStudents, setKnownStudents] = useState<PreRegisteredStudent[]>(() => {
    localStorage.removeItem(LEGACY_KNOWN_STUDENTS_KEY);
    const saved = localStorage.getItem(KNOWN_STUDENTS_KEY);
    if (saved !== null) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return parsed;
        }
      } catch {
        console.error('Error loading known students');
      }
    }
    return PRE_REGISTERED_STUDENTS;
  });

  const [courses, setCourses] = useState<CourseProfile[]>(() => {
    const saved = localStorage.getItem(COURSES_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return parsed
            .filter((c): c is CourseProfile => Boolean(c && c.id && c.courseName))
            .map(c => ({
              ...c,
              selectedWeek: c.selectedWeek || 'W1',
              students: Array.isArray(c.students) ? c.students : [],
            }));
        }
      } catch { /* ignore */ }
    }
    const initialCourse = localStorage.getItem('attendance-course-name')?.trim();
    if (initialCourse) {
      const now = Date.now();
      return [{
        id: initialCourse.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase(),
        courseName: initialCourse,
        selectedWeek: localStorage.getItem(ACTIVE_WEEK_KEY) || 'W1',
        students: [],
        createdAt: now,
        updatedAt: now,
      }];
    }
    return [];
  });

  const [scriptUrl, setScriptUrl] = useState<string>(() => {
    return localStorage.getItem(SCRIPT_URL_KEY) || DEFAULT_SCRIPT_URL;
  });

  const courseEditedAtRef = useRef<number>(0);
  const courseDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasInitializedUserPrefRef = useRef<boolean>(false);
  const coursesRef = useRef<CourseProfile[]>(courses);
  const activeCourseRef = useRef<string>(activeCourse);

  useEffect(() => {
    coursesRef.current = courses;
  }, [courses]);

  useEffect(() => {
    activeCourseRef.current = activeCourse;
  }, [activeCourse]);

  const sanitize = (str: string) => str.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase();
  const toCourseKey = useCallback((name: string) => {
    const clean = name.trim();
    return clean ? clean.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase() : 'GENERAL_SESSION';
  }, []);

  useEffect(() => {
    localStorage.setItem(REGISTERED_USERS_KEY, JSON.stringify(registeredUsers));
  }, [registeredUsers]);

  useEffect(() => {
    if (currentAdminName) localStorage.setItem(CURRENT_ADMIN_NAME_KEY, currentAdminName);
    else localStorage.removeItem(CURRENT_ADMIN_NAME_KEY);
  }, [currentAdminName]);

  useEffect(() => {
    if (currentUserId) localStorage.setItem(CURRENT_USER_ID_KEY, currentUserId);
    else localStorage.removeItem(CURRENT_USER_ID_KEY);
  }, [currentUserId]);

  useEffect(() => {
    if (activeSessionId) localStorage.setItem(ACTIVE_SESSION_ID_KEY, activeSessionId);
    else localStorage.removeItem(ACTIVE_SESSION_ID_KEY);
  }, [activeSessionId]);

  useEffect(() => {
    localStorage.setItem('attendance-course-name', activeCourse);
  }, [activeCourse]);

  useEffect(() => {
    localStorage.setItem(ACTIVE_WEEK_KEY, selectedWeek);
  }, [selectedWeek]);

  useEffect(() => {
    localStorage.setItem('attendance-integration-type', integrationType);
  }, [integrationType]);

  useEffect(() => {
    localStorage.setItem(ADMIN_EMAIL_KEY, adminEmail);
  }, [adminEmail]);

  useEffect(() => {
    localStorage.setItem(TEACHER_HISTORY_KEY, JSON.stringify(teacherHistory));
  }, [teacherHistory]);

  useEffect(() => {
    localStorage.setItem(KNOWN_STUDENTS_KEY, JSON.stringify(knownStudents));
  }, [knownStudents]);

  useEffect(() => {
    localStorage.setItem(COURSES_KEY, JSON.stringify(courses));
  }, [courses]);

  useEffect(() => {
    localStorage.setItem(SCRIPT_URL_KEY, scriptUrl);
  }, [scriptUrl]);

  useEffect(() => {
    if (!token && !(activateTokenParam && activateUserParam) && testEmailParam !== 'verified') {
      localStorage.setItem(VIEW_PREF_KEY, view);
    }
  }, [view, token, activateTokenParam, activateUserParam, testEmailParam]);

  useEffect(() => {
    localStorage.setItem(KIOSK_PREF_KEY, isKioskMode.toString());
  }, [isKioskMode]);

  const handleLogout = useCallback(() => {
    const sid = localStorage.getItem(ACTIVE_SESSION_ID_KEY) || activeSessionId;
    if (sid && FIREBASE_CONFIG.DATABASE_URL && FIREBASE_CONFIG.DATABASE_SECRET) {
      void fetch(buildDbUrl(`admin_logins/${sid}`), {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'signed_out',
          lastActiveTime: Date.now(),
          currentAction: 'Signed Out',
        }),
      }).catch(() => { /* ignore */ });
    }
    setIsAuthenticated(false);
    setCurrentAdminName('');
    setCurrentUserId('');
    setActiveSessionId('');
    hasInitializedUserPrefRef.current = false;
    courseEditedAtRef.current = 0;
    localStorage.removeItem(AUTH_KEY);
    localStorage.removeItem(CURRENT_ADMIN_NAME_KEY);
    localStorage.removeItem(CURRENT_USER_ID_KEY);
    localStorage.removeItem(ACTIVE_SESSION_ID_KEY);
    localStorage.removeItem(KIOSK_PREF_KEY);
    setView('student');
    setIsKioskMode(false);
  }, [activeSessionId]);

  const syncAllCloudState = useCallback(async () => {
    if (!FIREBASE_CONFIG.DATABASE_URL || !FIREBASE_CONFIG.DATABASE_SECRET) return;
    try {
      const uid = currentUserId || (currentAdminName ? toFirebaseKey(currentAdminName.toLowerCase()) : '');
      const requests: Promise<Response>[] = [
        fetch(buildDbUrl('app_config'), { cache: 'no-store' }),
        fetch(buildDbUrl('app_users'), { cache: 'no-store' }),
        fetch(buildDbUrl('admin_logins'), { cache: 'no-store' }),
        fetch(buildDbUrl('admin_notifications'), { cache: 'no-store' }),
        fetch(buildDbUrl('attendance_history'), { cache: 'no-store' }),
        fetch(buildDbUrl('courses'), { cache: 'no-store' }),
      ];
      if (isAuthenticated && uid) {
        requests.push(fetch(buildDbUrl(`user_preferences/${uid}`), { cache: 'no-store' }));
      }

      const [configRes, usersRes, sessionsRes, notifsRes, historyRes, coursesRes, userPrefRes] = await Promise.all(requests);

      // 1. Sync app_config (script_url, integration_type, admin_email, fallback known_students_v2)
      if (configRes.ok) {
        const cfg = await configRes.json();
        if (cfg && typeof cfg === 'object') {
          if (typeof cfg.script_url === 'string' && cfg.script_url.trim().startsWith('https://script.google.com/')) {
            const cleanRemote = cfg.script_url.trim();
            const localSaved = localStorage.getItem(SCRIPT_URL_KEY);
            if (!localSaved || localSaved === DEFAULT_SCRIPT_URL || cleanRemote !== localSaved) {
              setScriptUrl(cleanRemote);
            }
          } else {
            const localSaved = localStorage.getItem(SCRIPT_URL_KEY);
            if (localSaved && localSaved !== DEFAULT_SCRIPT_URL && localSaved.startsWith('https://script.google.com/')) {
              void fetch(buildDbUrl('app_config/script_url'), {
                method: 'PUT',
                body: JSON.stringify(localSaved),
              }).catch(() => { /* ignore */ });
            }
          }

          if (cfg.integration_type === 'google_sheets' || cfg.integration_type === 'airtable' || cfg.integration_type === 'firebase') {
            setIntegrationType(cfg.integration_type);
          }
          if (typeof cfg.admin_email === 'string') {
            setAdminEmail(cfg.admin_email);
          }
          if (!activeCourseRef.current && Array.isArray(cfg.known_students_v2) && cfg.known_students_v2.length > 0) {
            setKnownStudents(cfg.known_students_v2);
          }
        }
      }

      // 1b. Sync courses list across devices/users
      let loadedCourses: CourseProfile[] = [];
      if (coursesRes && coursesRes.ok) {
        const coursesObj = await coursesRes.json();
        if (coursesObj && typeof coursesObj === 'object') {
          loadedCourses = (Object.values(coursesObj) as CourseProfile[])
            .filter(c => c && c.id && c.courseName)
            .map(c => ({
              ...c,
              selectedWeek: c.selectedWeek || 'W1',
              students: Array.isArray(c.students) ? c.students : [],
            }))
            .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
          if (Date.now() - courseEditedAtRef.current > 4000) {
            setCourses(loadedCourses);
          }
        }
      }

      // 1c. Sync per-user active course & week preference (only if user hasn't edited locally in last 3s)
      if (userPrefRes && userPrefRes.ok && Date.now() - courseEditedAtRef.current > 3000) {
        const pref = await userPrefRes.json();
        if (pref && typeof pref === 'object') {
          if (typeof pref.activeCourse === 'string' && pref.activeCourse.trim() && !hasInitializedUserPrefRef.current) {
            hasInitializedUserPrefRef.current = true;
            setActiveCourse(pref.activeCourse);
            const matchedCourse = loadedCourses.find(c => c.courseName.toUpperCase() === pref.activeCourse.trim().toUpperCase());
            if (matchedCourse && Array.isArray(matchedCourse.students)) {
              setKnownStudents(matchedCourse.students);
            }
          }
          if (typeof pref.selectedWeek === 'string' && /^W\d+$/i.test(pref.selectedWeek)) {
            setSelectedWeek(pref.selectedWeek);
          }
        }
      }

      // 2. Sync app_users
      if (usersRes.ok) {
        const usersObj = await usersRes.json();
        const remoteList: AppUser[] = usersObj && typeof usersObj === 'object'
          ? (Object.values(usersObj) as AppUser[]).filter(u => u && u.id && u.username)
          : [];

        const hasAdmin = remoteList.some(u => u.username.toLowerCase() === 'admin' || u.id === 'admin');
        if (!hasAdmin) {
          await fetch(buildDbUrl(`app_users/${DEFAULT_ADMIN_USER.id}`), {
            method: 'PUT',
            body: JSON.stringify(DEFAULT_ADMIN_USER),
          }).catch(() => { /* ignore */ });
          remoteList.unshift(DEFAULT_ADMIN_USER);
        }

        // Seed any legacy local-only accounts once if cloud had none besides admin
        if (remoteList.length <= 1) {
          const localSaved = localStorage.getItem(REGISTERED_USERS_KEY);
          if (localSaved) {
            try {
              const parsed = JSON.parse(localSaved) as Partial<AppUser>[];
              for (const lu of parsed) {
                if (lu.username && lu.username.toLowerCase() !== 'admin' && lu.password) {
                  const migratedId = lu.id || toFirebaseKey(lu.username.toLowerCase());
                  if (!remoteList.some(r => r.id === migratedId || r.username.toLowerCase() === lu.username?.toLowerCase())) {
                    const newUser: AppUser = {
                      id: migratedId,
                      username: lu.username,
                      email: lu.email || '',
                      password: lu.password,
                      role: 'lecturer',
                      status: lu.status || 'active',
                      createdAt: lu.createdAt || Date.now(),
                    };
                    remoteList.push(newUser);
                    void fetch(buildDbUrl(`app_users/${migratedId}`), {
                      method: 'PUT',
                      body: JSON.stringify(newUser),
                    }).catch(() => { /* ignore */ });
                  }
                }
              }
            } catch { /* ignore */ }
          }
        }

        const sortedUsers = [...remoteList].sort((a, b) => {
          if (a.role === 'admin') return -1;
          if (b.role === 'admin') return 1;
          return (b.createdAt || 0) - (a.createdAt || 0);
        });
        setRegisteredUsers(sortedUsers);
        setHasLoadedCloudUsers(true);
      }

      // 3. Sync admin_logins (activity sessions)
      if (sessionsRes.ok) {
        const sessionsObj = await sessionsRes.json();
        const sessionList: AdminSessionActivity[] = sessionsObj && typeof sessionsObj === 'object'
          ? (Object.values(sessionsObj) as AdminSessionActivity[])
              .filter(s => s && s.id && s.adminName)
              .sort((a, b) => (b.lastActiveTime || b.loginTime || 0) - (a.lastActiveTime || a.loginTime || 0))
          : [];
        setAdminSessions(sessionList);
      }

      // 4. Sync admin_notifications
      if (notifsRes.ok) {
        const notifsObj = await notifsRes.json();
        const notifList: AdminNotification[] = notifsObj && typeof notifsObj === 'object'
          ? (Object.values(notifsObj) as AdminNotification[])
              .filter(n => n && n.id)
              .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
          : [];
        setAdminNotifications(notifList);
      }

      // 5. Sync attendance_history
      if (historyRes.ok) {
        const histData = await historyRes.json();
        if (Array.isArray(histData)) {
          setTeacherHistory(histData);
        } else if (histData && typeof histData === 'object') {
          const histArray = (Object.values(histData) as Student[])
            .filter(h => h && h.studentId && h.timestamp)
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, 200);
          setTeacherHistory(histArray);
        }
      }
    } catch {
      // Ignore transient network errors during background sync
    }
  }, [currentUserId, currentAdminName, isAuthenticated]);

  // Handle email activation link (?activate=TOKEN&user=USER_ID) and test email verification (?test_email=verified)
  useEffect(() => {
    if (testEmailParam === 'verified') {
      if (window.location.search) {
        window.history.replaceState({}, '', window.location.pathname);
      }
      return;
    }
    if (!activateTokenParam || !activateUserParam) return;
    let cancelled = false;

    const processActivation = async () => {
      try {
        if (!FIREBASE_CONFIG.DATABASE_URL || !FIREBASE_CONFIG.DATABASE_SECRET) {
          setActivationNotice({ type: 'error', message: 'Cloud database is not configured for activation.' });
          return;
        }
        const res = await fetch(buildDbUrl(`app_users/${toFirebaseKey(activateUserParam)}`), { cache: 'no-store' });
        if (cancelled) return;
        if (!res.ok) {
          setActivationNotice({ type: 'error', message: 'Could not verify activation link. Please try again.' });
          return;
        }
        const userRecord = (await res.json()) as AppUser | null;
        if (cancelled) return;
        if (!userRecord || !userRecord.id) {
          setActivationNotice({ type: 'error', message: 'Activation failed: Account no longer exists or was removed by Admin.' });
          return;
        }
        if (userRecord.status === 'active') {
          setActivationNotice({ type: 'success', message: `Account "${userRecord.username}" is already active. You can sign in now.` });
          if (window.location.search) {
            window.history.replaceState({}, '', window.location.pathname);
          }
          return;
        }
        if (userRecord.activationToken !== activateTokenParam) {
          setActivationNotice({ type: 'error', message: 'Invalid or expired activation link. Contact Admin to resend.' });
          return;
        }

        const patchRes = await fetch(buildDbUrl(`app_users/${userRecord.id}`), {
          method: 'PATCH',
          body: JSON.stringify({
            status: 'active',
            activatedAt: Date.now(),
          }),
        });
        if (cancelled) return;
        if (!patchRes.ok) {
          setActivationNotice({ type: 'error', message: 'Failed to update account activation status. Please try again.' });
          return;
        }
        setActivationNotice({
          type: 'success',
          message: `Account "${userRecord.username}" has been activated! Please sign in below.`,
        });
        if (window.location.search) {
          window.history.replaceState({}, '', window.location.pathname);
        }
        void syncAllCloudState();
      } catch {
        if (!cancelled) {
          setActivationNotice({ type: 'error', message: 'Network error while activating account.' });
        }
      }
    };

    void processActivation();
    return () => { cancelled = true; };
  }, [activateTokenParam, activateUserParam, testEmailParam, syncAllCloudState]);

  // Initial sync + cross-browser / cross-device live sync listeners (focus, visibilitychange, online, polling)
  useEffect(() => {
    const initialTimer = setTimeout(() => {
      void syncAllCloudState();
    }, 0);

    const pollInterval = setInterval(() => {
      void syncAllCloudState();
    }, isAuthenticated && view === 'teacher' ? 6000 : 20000);

    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        void syncAllCloudState();
      }
    };

    window.addEventListener('focus', handleVisibilityOrFocus);
    window.addEventListener('online', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(pollInterval);
      window.removeEventListener('focus', handleVisibilityOrFocus);
      window.removeEventListener('online', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
    };
  }, [syncAllCloudState, isAuthenticated, view]);

  // Safety enforcement: auto-logout if admin deletes account or revokes active session
  useEffect(() => {
    if (!isAuthenticated || !hasLoadedCloudUsers) return;
    const isBuiltInAdmin = currentAdminName.toLowerCase() === 'admin';
    if (!isBuiltInAdmin) {
      const matched = registeredUsers.find(
        u => (currentUserId && u.id === currentUserId) || u.username.toLowerCase() === currentAdminName.toLowerCase()
      );
      if (!matched || matched.status !== 'active') {
        const t = setTimeout(() => {
          setActivationNotice({
            type: 'error',
            message: 'Your account access was removed or deactivated by the Administrator.',
          });
          handleLogout();
        }, 0);
        return () => clearTimeout(t);
      }
    }

    if (activeSessionId && adminSessions.length > 0) {
      const currentSession = adminSessions.find(s => s.id === activeSessionId);
      if (currentSession && currentSession.status === 'signed_out') {
        const t = setTimeout(() => {
          setActivationNotice({
            type: 'error',
            message: 'Your session was signed out by the Administrator.',
          });
          handleLogout();
        }, 0);
        return () => clearTimeout(t);
      }
    }
  }, [isAuthenticated, hasLoadedCloudUsers, currentAdminName, currentUserId, registeredUsers, activeSessionId, adminSessions, handleLogout]);

  // Activity Heartbeat for currently logged-in user
  useEffect(() => {
    if (!isAuthenticated || !currentAdminName || !FIREBASE_CONFIG.DATABASE_URL || !FIREBASE_CONFIG.DATABASE_SECRET) return;

    let sessionId = activeSessionId;
    if (!sessionId) {
      sessionId = `${toFirebaseKey(currentAdminName.toLowerCase())}_${Date.now()}`;
      const timer = setTimeout(() => setActiveSessionId(sessionId), 0);
      return () => clearTimeout(timer);
    }

    const matchedUser = registeredUsers.find(u => u.username.toLowerCase() === currentAdminName.toLowerCase());
    const sendHeartbeat = () => {
      const now = Date.now();
      const payload: Partial<AdminSessionActivity> = {
        id: sessionId,
        adminName: currentAdminName,
        email: matchedUser?.email || '',
        device: getDeviceLabel(),
        date: new Date(now).toISOString().slice(0, 10),
        lastActiveTime: now,
        status: 'active',
        currentAction: view === 'teacher' ? 'Dashboard' : 'Kiosk',
      };
      void fetch(buildDbUrl(`admin_logins/${sessionId}`), {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }).catch(() => { /* ignore */ });
    };

    sendHeartbeat();
    const hbInterval = setInterval(sendHeartbeat, 15000);

    const handlePageHide = () => {
      try {
        void fetch(buildDbUrl(`admin_logins/${sessionId}`), {
          method: 'PATCH',
          keepalive: true,
          body: JSON.stringify({
            status: 'signed_out',
            lastActiveTime: Date.now(),
            currentAction: 'Closed Tab',
          }),
        });
      } catch { /* ignore */ }
    };

    window.addEventListener('pagehide', handlePageHide);
    return () => {
      clearInterval(hbInterval);
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, [isAuthenticated, currentAdminName, activeSessionId, view, registeredUsers]);

  const handleScriptUrlChange = useCallback((nextUrl: string) => {
    const trimmed = nextUrl.trim();
    setScriptUrl(trimmed);
    if (FIREBASE_CONFIG.DATABASE_URL && FIREBASE_CONFIG.DATABASE_SECRET && trimmed.startsWith('https://script.google.com/')) {
      void fetch(buildDbUrl('app_config/script_url'), {
        method: 'PUT',
        body: JSON.stringify(trimmed),
      }).catch(() => { /* ignore */ });
    }
  }, []);

  const saveUserCoursePref = useCallback((nextCourse: string, nextWeek: string) => {
    const uid = currentUserId || (currentAdminName ? toFirebaseKey(currentAdminName.toLowerCase()) : '');
    if (!uid || !FIREBASE_CONFIG.DATABASE_URL || !FIREBASE_CONFIG.DATABASE_SECRET) return;
    void fetch(buildDbUrl(`user_preferences/${uid}`), {
      method: 'PATCH',
      body: JSON.stringify({ activeCourse: nextCourse, selectedWeek: nextWeek, updatedAt: Date.now() }),
    }).catch(() => { /* ignore */ });
  }, [currentUserId, currentAdminName]);

  const upsertCourseInCloud = useCallback((course: CourseProfile) => {
    if (!FIREBASE_CONFIG.DATABASE_URL || !FIREBASE_CONFIG.DATABASE_SECRET) return;
    void fetch(buildDbUrl(`courses/${course.id}`), {
      method: 'PUT',
      body: JSON.stringify(course),
    }).catch(() => { /* ignore */ });
  }, []);

  const handleCourseChange = useCallback((courseName: string) => {
    courseEditedAtRef.current = Date.now();
    hasInitializedUserPrefRef.current = true;
    setActiveCourse(courseName);
    const trimmed = courseName.trim();
    if (trimmed) {
      const matched = courses.find(c => c.courseName.toUpperCase() === trimmed.toUpperCase());
      if (matched) {
        setKnownStudents(matched.students || []);
      }
    }
    if (courseDebounceRef.current) clearTimeout(courseDebounceRef.current);
    courseDebounceRef.current = setTimeout(() => {
      saveUserCoursePref(courseName, selectedWeek);
    }, 450);
  }, [courses, saveUserCoursePref, selectedWeek]);

  const handleSelectCourse = useCallback((course: CourseProfile) => {
    courseEditedAtRef.current = Date.now();
    hasInitializedUserPrefRef.current = true;
    const nextWeek = course.selectedWeek || 'W1';
    setActiveCourse(course.courseName);
    setSelectedWeek(nextWeek);
    setKnownStudents(course.students || []);
    setAttendanceList([]);
    saveUserCoursePref(course.courseName, nextWeek);
  }, [saveUserCoursePref]);

  const handleAddCourse = useCallback((rawCourseName: string, initialStudents: PreRegisteredStudent[] = []): CourseProfile | null => {
    const cleanName = rawCourseName.trim();
    if (!cleanName) return null;
    const existing = courses.find(c => c.courseName.trim().toUpperCase() === cleanName.toUpperCase());
    if (existing) {
      handleSelectCourse(existing);
      return existing;
    }
    const now = Date.now();
    const newCourse: CourseProfile = {
      id: toCourseKey(cleanName),
      courseName: cleanName,
      selectedWeek: 'W1',
      students: initialStudents,
      createdBy: currentAdminName || 'admin',
      createdAt: now,
      updatedAt: now,
    };
    setCourses(prev => [...prev, newCourse]);
    upsertCourseInCloud(newCourse);
    courseEditedAtRef.current = Date.now();
    hasInitializedUserPrefRef.current = true;
    setActiveCourse(newCourse.courseName);
    setSelectedWeek('W1');
    setKnownStudents(newCourse.students);
    setAttendanceList([]);
    saveUserCoursePref(newCourse.courseName, 'W1');
    return newCourse;
  }, [courses, currentAdminName, handleSelectCourse, saveUserCoursePref, toCourseKey, upsertCourseInCloud]);

  const handleDeleteCourse = useCallback(async (courseId: string) => {
    courseEditedAtRef.current = Date.now();
    const remaining = courses.filter(c => c.id !== courseId);
    const deletedCourse = courses.find(c => c.id === courseId);
    setCourses(remaining);
    if (FIREBASE_CONFIG.DATABASE_URL && FIREBASE_CONFIG.DATABASE_SECRET) {
      await fetch(buildDbUrl(`courses/${courseId}`), { method: 'DELETE' }).catch(() => { /* ignore */ });
    }
    if (deletedCourse && activeCourse.trim().toUpperCase() === deletedCourse.courseName.trim().toUpperCase()) {
      const next = remaining[0];
      if (next) {
        handleSelectCourse(next);
      } else {
        setActiveCourse('');
        setKnownStudents([]);
        setAttendanceList([]);
      }
    }
  }, [courses, activeCourse, handleSelectCourse]);

  const handleSyncSheetCourses = useCallback((sheetTabs: Array<{ sheetName: string; courseName: string; students: PreRegisteredStudent[] }>) => {
    if (!Array.isArray(sheetTabs) || sheetTabs.length === 0) return;
    courseEditedAtRef.current = Date.now();
    const now = Date.now();
    const nextMap = new Map<string, CourseProfile>();
    coursesRef.current.forEach(c => nextMap.set(c.courseName.trim().toUpperCase(), c));
    const toPersist: CourseProfile[] = [];
    for (const tab of sheetTabs) {
      const cleanName = tab.courseName.trim();
      if (!cleanName) continue;
      const key = cleanName.toUpperCase();
      const existing = nextMap.get(key);
      const updated: CourseProfile = existing
        ? {
            ...existing,
            sheetName: tab.sheetName || existing.sheetName,
            students: tab.students.length > 0 ? tab.students : existing.students,
            updatedAt: now,
          }
        : {
            id: toCourseKey(cleanName),
            courseName: cleanName,
            sheetName: tab.sheetName,
            selectedWeek: 'W1',
            students: tab.students,
            createdBy: currentAdminName || 'system',
            createdAt: now,
            updatedAt: now,
          };
      nextMap.set(key, updated);
      toPersist.push(updated);
    }
    const nextList = Array.from(nextMap.values()).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    setCourses(nextList);
    toPersist.forEach(c => upsertCourseInCloud(c));
  }, [currentAdminName, toCourseKey, upsertCourseInCloud]);

  const handleWeekChange = useCallback((week: string) => {
    courseEditedAtRef.current = Date.now();
    setSelectedWeek(week);
    saveUserCoursePref(activeCourse, week);
    if (activeCourse.trim()) {
      const matched = coursesRef.current.find(c => c.courseName.trim().toUpperCase() === activeCourse.trim().toUpperCase());
      if (matched) {
        const updated: CourseProfile = { ...matched, selectedWeek: week, updatedAt: Date.now() };
        setCourses(prev => prev.map(c => (c.id === matched.id ? updated : c)));
        upsertCourseInCloud(updated);
      }
    }
  }, [activeCourse, saveUserCoursePref, upsertCourseInCloud]);

  const handleIntegrationTypeChange = useCallback((nextType: IntegrationType) => {
    setIntegrationType(nextType);
    if (FIREBASE_CONFIG.DATABASE_URL && FIREBASE_CONFIG.DATABASE_SECRET) {
      void fetch(buildDbUrl('app_config/integration_type'), {
        method: 'PUT',
        body: JSON.stringify(nextType),
      }).catch(() => { /* ignore */ });
    }
  }, []);

  const handleAdminEmailChange = useCallback((email: string) => {
    const trimmed = email.trim();
    setAdminEmail(trimmed);
    if (FIREBASE_CONFIG.DATABASE_URL && FIREBASE_CONFIG.DATABASE_SECRET) {
      void fetch(buildDbUrl('app_config/admin_email'), {
        method: 'PUT',
        body: JSON.stringify(trimmed),
      }).catch(() => { /* ignore */ });
    }
  }, []);

  const syncKnownStudentsToCloud = useCallback((students: PreRegisteredStudent[], targetCourseName?: string) => {
    if (!FIREBASE_CONFIG.DATABASE_URL || !FIREBASE_CONFIG.DATABASE_SECRET) return;
    const courseLabel = (targetCourseName ?? activeCourseRef.current).trim();
    if (courseLabel) {
      const courseId = toCourseKey(courseLabel);
      const existing = coursesRef.current.find(c => c.id === courseId || c.courseName.trim().toUpperCase() === courseLabel.toUpperCase());
      const now = Date.now();
      const updatedCourse: CourseProfile = existing
        ? { ...existing, students, updatedAt: now }
        : {
            id: courseId,
            courseName: courseLabel,
            selectedWeek: selectedWeek || 'W1',
            students,
            createdBy: currentAdminName || 'admin',
            createdAt: now,
            updatedAt: now,
          };
      setCourses(prev => {
        const idx = prev.findIndex(c => c.id === updatedCourse.id);
        if (idx === -1) return [...prev, updatedCourse];
        return prev.map((c, i) => (i === idx ? updatedCourse : c));
      });
      upsertCourseInCloud(updatedCourse);
    }
    void fetch(buildDbUrl('app_config/known_students_v2'), {
      method: 'PUT',
      body: JSON.stringify(students),
    }).catch(() => { /* ignore */ });
  }, [currentAdminName, selectedWeek, toCourseKey, upsertCourseInCloud]);

  const handleUpdateKnownStudents = useCallback((students: PreRegisteredStudent[]) => {
    setKnownStudents(students);
    syncKnownStudentsToCloud(students);
  }, [syncKnownStudentsToCloud]);

  const syncHistoryToCloud = useCallback((historyList: Student[]) => {
    if (!FIREBASE_CONFIG.DATABASE_URL || !FIREBASE_CONFIG.DATABASE_SECRET) return;
    void fetch(buildDbUrl('attendance_history'), {
      method: 'PUT',
      body: JSON.stringify(historyList.slice(0, 200)),
    }).catch(() => { /* ignore */ });
  }, []);

  const handleDeleteHistoryItem = useCallback((timestamp: number, studentId: string) => {
    setTeacherHistory(prev => {
      const next = prev.filter(h => !(h.timestamp === timestamp && h.studentId === studentId));
      syncHistoryToCloud(next);
      return next;
    });
  }, [syncHistoryToCloud]);

  const handleClearTeacherHistory = useCallback(() => {
    setTeacherHistory([]);
    syncHistoryToCloud([]);
  }, [syncHistoryToCloud]);

  useEffect(() => {
    let cancelled = false;
    const loadStudentsFromSheetOrCloud = async () => {
      const cleanScriptUrl = scriptUrl.trim();
      const canFetchSheet =
        integrationType === 'google_sheets' &&
        cleanScriptUrl &&
        cleanScriptUrl !== DEFAULT_SCRIPT_URL &&
        !cleanScriptUrl.endsWith('/dev');

      const courseFilter = courseNameParam || activeCourse || '';

      if (canFetchSheet) {
        try {
          const sheetUrl = `${cleanScriptUrl}${cleanScriptUrl.includes('?') ? '&' : '?'}action=getCourse${courseFilter ? `&course=${encodeURIComponent(courseFilter)}` : ''}&t=${Date.now()}`;
          const res = await fetch(sheetUrl, { method: 'GET', redirect: 'follow' });
          const rawText = await res.text();
          if (!cancelled && res.ok && !rawText.trim().startsWith('<')) {
            const data = JSON.parse(rawText);
            if (data?.success) {
              const sheetsArr = Array.isArray(data.sheets) ? data.sheets : [];
              const normalizedCourseFilter = courseFilter.trim().toUpperCase();
              const matchedTab = normalizedCourseFilter
                ? sheetsArr.find((s: { courseName?: unknown }) => String(s?.courseName || '').trim().toUpperCase() === normalizedCourseFilter)
                : undefined;
              const rawStudents = normalizedCourseFilter && sheetsArr.length > 0
                ? (matchedTab && Array.isArray(matchedTab.students) ? matchedTab.students : [])
                : (Array.isArray(data.students) ? data.students : []);

              if (rawStudents.length > 0) {
                const normalized: PreRegisteredStudent[] = [];
                const seen = new Set<string>();
                for (const item of rawStudents) {
                  const id = String(item?.id || '').trim().toUpperCase();
                  const name = String(item?.name || '').trim().toUpperCase();
                  if (id && name && !seen.has(id)) {
                    seen.add(id);
                    normalized.push({ id, name });
                  }
                }
                if (!cancelled && normalized.length > 0) {
                  setKnownStudents(normalized);
                  if (courseFilter) {
                    syncKnownStudentsToCloud(normalized, courseFilter);
                  }
                  return;
                }
              }
            }
          }
        } catch {
          // Fallback to Firebase course roster below
        }
      }

      if (!FIREBASE_CONFIG.DATABASE_URL || !FIREBASE_CONFIG.DATABASE_SECRET) return;
      if (courseFilter) {
        try {
          const courseKey = toCourseKey(courseFilter);
          const courseRes = await fetch(buildDbUrl(`courses/${courseKey}/students`), { cache: 'no-store' });
          if (courseRes.ok && !cancelled) {
            const courseRoster = await courseRes.json();
            if (Array.isArray(courseRoster) && courseRoster.length > 0) {
              setKnownStudents(courseRoster);
              return;
            }
          }
        } catch { /* fallback below */ }
      }

      if (isAuthenticated && localStorage.getItem(KNOWN_STUDENTS_KEY) !== null) return;
      try {
        const res = await fetch(buildDbUrl('app_config/known_students_v2'), { cache: 'no-store' });
        if (!res.ok || cancelled) return;
        const remote = await res.json();
        if (!cancelled && Array.isArray(remote)) {
          setKnownStudents(remote);
        }
      } catch {
        // Ignore network errors
      }
    };
    void loadStudentsFromSheetOrCloud();
    return () => { cancelled = true; };
  }, [isAuthenticated, scriptUrl, integrationType, courseNameParam, activeCourse, toCourseKey, syncKnownStudentsToCloud]);

  const formatCloudPayload = (r: Student) => {
    const targetWeek = r.week || selectedWeek || 'W1';
    return {
      'Student ID': r.studentId,
      'Name': r.name,
      'Course Name': r.courseName || 'General Session',
      'Week': targetWeek,
      'Status': r.status,
      '[Course Name Here]': r.courseName || 'General Session',
      '[Date Here 1]': new Date(r.timestamp).toLocaleDateString(),
      '[Status Here]': r.status,
      [targetWeek]: r.status,
      'Reason': r.absenceReason || '',
      'Timestamp': new Date(r.timestamp).toISOString(),
    };
  };

  const syncToAirtable = async (records: Record<string, Student>) => {
    if (integrationType !== 'airtable') return;

    const aToken = localStorage.getItem('airtable-token');
    const baseId = localStorage.getItem('airtable-base-id');
    const tableName = localStorage.getItem('airtable-table-name') || 'Attendance';

    if (!aToken || !baseId) return;

    const airtableRecords = Object.values(records).map(r => ({
      fields: formatCloudPayload(r),
    }));

    try {
      await fetch(`https://api.airtable.com/v0/${baseId}/${tableName}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${aToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ records: airtableRecords }),
      });
    } catch (err) {
      console.error('Airtable sync failed', err);
    }
  };

  const checkAndClearForNewDay = useCallback(() => {
    const today = new Date().toISOString().slice(0, 10);
    const lastScanDate = localStorage.getItem(LAST_SCAN_DATE_KEY);
    if (lastScanDate && lastScanDate !== today) {
      setAttendanceList([]);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      checkAndClearForNewDay();
    }, 0);
    return () => clearTimeout(timer);
  }, [checkAndClearForNewDay]);

  const fetchFirebaseLiveAttendance = useCallback(async () => {
    if (view !== 'teacher' || !FIREBASE_CONFIG.DATABASE_URL || !FIREBASE_CONFIG.DATABASE_SECRET || !isAuthenticated) return;
    try {
      const path = activeCourse ? `${SESSION_ID}_${sanitize(activeCourse)}` : SESSION_ID;
      const response = await fetch(buildDbUrl(`live_sessions/${path}`), { cache: 'no-store' });
      if (!response.ok && response.status !== 404) return;
      const data = response.status === 404 ? null : await response.json();
      if (data) {
        const firebaseStudents: Student[] = (Object.values(data) as Student[]).sort((a, b) => b.timestamp - a.timestamp);
        setAttendanceList(firebaseStudents);
        setTeacherHistory(prev => {
          const combined = [...firebaseStudents, ...prev];
          const unique = combined
            .filter((item, index, self) => index === self.findIndex(t => t.studentId === item.studentId && t.timestamp === item.timestamp))
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, 200);
          if (unique.length !== prev.length || (unique[0]?.timestamp !== prev[0]?.timestamp)) {
            syncHistoryToCloud(unique);
          }
          return unique;
        });
      } else {
        setAttendanceList([]);
      }
    } catch {
      console.warn('Polling failed');
    }
  }, [view, isAuthenticated, activeCourse, syncHistoryToCloud]);

  useEffect(() => {
    if (view === 'teacher' && isAuthenticated) {
      const timer = setTimeout(() => {
        void fetchFirebaseLiveAttendance();
      }, 0);
      const interval = setInterval(() => {
        void fetchFirebaseLiveAttendance();
      }, 6000);
      return () => {
        clearTimeout(timer);
        clearInterval(interval);
      };
    }
  }, [fetchFirebaseLiveAttendance, view, isAuthenticated]);

  const buildActivationUrl = useCallback((user: AppUser) => {
    const tokenVal = user.activationToken || generateToken();
    return `${getPublicAppUrl()}?activate=${encodeURIComponent(tokenVal)}&user=${encodeURIComponent(user.id)}`;
  }, []);

  const sendActivationEmailViaScript = useCallback(async (params: {
    toEmail: string;
    username: string;
    activationUrl: string;
  }): Promise<boolean> => {
    const cleanUrl = scriptUrl.trim();
    if (!cleanUrl || cleanUrl === DEFAULT_SCRIPT_URL || cleanUrl.endsWith('/dev')) {
      return false;
    }
    try {
      const res = await fetch(cleanUrl, {
        method: 'POST',
        redirect: 'follow',
        body: JSON.stringify({
          action: 'SEND_ACTIVATION_EMAIL',
          toEmail: params.toEmail,
          username: params.username,
          activationUrl: params.activationUrl,
          adminEmail: adminEmail.trim(),
        }),
      });
      const text = await res.text();
      if (!res.ok || text.trim().startsWith('<')) return false;
      const parsed = JSON.parse(text);
      return Boolean(parsed?.success && parsed?.emailSent !== false);
    } catch {
      return false;
    }
  }, [scriptUrl, adminEmail]);

  const sendTestAdminEmail = useCallback(async (targetEmail?: string): Promise<{ success: boolean; message: string }> => {
    const cleanUrl = scriptUrl.trim();
    const recipient = (targetEmail ?? adminEmail).trim();
    if (!cleanUrl || cleanUrl === DEFAULT_SCRIPT_URL || cleanUrl.endsWith('/dev')) {
      return { success: false, message: 'Please configure a valid deployed Apps Script /exec URL in Settings first.' };
    }
    if (!recipient) {
      return { success: false, message: 'Enter an Admin Notification Email first.' };
    }
    try {
      const res = await fetch(cleanUrl, {
        method: 'POST',
        redirect: 'follow',
        body: JSON.stringify({
          action: 'SEND_ACTIVATION_EMAIL',
          toEmail: recipient,
          username: 'Admin Email Test',
          activationUrl: `${getPublicAppUrl()}?test_email=verified`,
          adminEmail: recipient,
        }),
      });
      const text = await res.text();
      if (!res.ok || text.trim().startsWith('<')) {
        return { success: false, message: 'Apps Script returned HTML instead of JSON. Check Web App access = Anyone.' };
      }
      const parsed = JSON.parse(text);
      if (parsed?.success && parsed?.emailSent !== false) {
        return { success: true, message: `Test email sent to ${recipient}. Check Inbox/Spam!` };
      }
      const errText = String(parsed?.error || 'Email could not be sent.');
      if (errText.includes('script.send_mail') || errText.includes('MailApp')) {
        return {
          success: false,
          message: 'Apps Script lacks email permission (script.send_mail). Open Apps Script editor → Run a function → Review Permissions → Allow, then re-deploy.',
        };
      }
      return { success: false, message: errText };
    } catch {
      return { success: false, message: 'Network error reaching Apps Script endpoint.' };
    }
  }, [scriptUrl, adminEmail]);

  const handleLogin = (usernameOrEmail: string, password: string): { success: boolean; message?: string } => {
    const cleanInput = usernameOrEmail.trim().toLowerCase();
    const matched = registeredUsers.find(
      u => (u.username.toLowerCase() === cleanInput || (u.email && u.email.toLowerCase() === cleanInput)) && u.password === password
    );

    if (matched) {
      if (matched.status === 'pending' && matched.role !== 'admin') {
        return {
          success: false,
          message: 'Account pending activation. Please click the activation link sent to your email or ask Admin to activate your account.',
        };
      }
      const now = Date.now();
      const newSessionId = `${toFirebaseKey(matched.username.toLowerCase())}_${now}`;
      const newSession: AdminSessionActivity = {
        id: newSessionId,
        adminName: matched.username,
        email: matched.email || '',
        device: getDeviceLabel(),
        date: new Date(now).toISOString().slice(0, 10),
        loginTime: now,
        lastActiveTime: now,
        status: 'active',
        currentAction: 'Dashboard',
      };

      hasInitializedUserPrefRef.current = false;
      courseEditedAtRef.current = 0;
      setIsAuthenticated(true);
      setCurrentAdminName(matched.username);
      setCurrentUserId(matched.id);
      setActiveSessionId(newSessionId);
      localStorage.setItem(AUTH_KEY, 'true');
      setView('teacher');

      if (FIREBASE_CONFIG.DATABASE_URL && FIREBASE_CONFIG.DATABASE_SECRET) {
        void fetch(buildDbUrl(`admin_logins/${newSessionId}`), {
          method: 'PUT',
          body: JSON.stringify(newSession),
        }).catch(() => { /* ignore */ });
        void fetch(buildDbUrl(`app_users/${matched.id}`), {
          method: 'PATCH',
          body: JSON.stringify({ lastLoginAt: now }),
        }).catch(() => { /* ignore */ });
      }
      setAdminSessions(prev => [newSession, ...prev]);
      return { success: true };
    }

    if (cleanInput === 'admin' && password === LECTURER_PASSWORD) {
      const now = Date.now();
      const newSessionId = `admin_${now}`;
      const newSession: AdminSessionActivity = {
        id: newSessionId,
        adminName: 'admin',
        email: adminEmail || '',
        device: getDeviceLabel(),
        date: new Date(now).toISOString().slice(0, 10),
        loginTime: now,
        lastActiveTime: now,
        status: 'active',
        currentAction: 'Dashboard',
      };
      hasInitializedUserPrefRef.current = false;
      courseEditedAtRef.current = 0;
      setIsAuthenticated(true);
      setCurrentAdminName('admin');
      setCurrentUserId('admin');
      setActiveSessionId(newSessionId);
      localStorage.setItem(AUTH_KEY, 'true');
      setView('teacher');
      if (FIREBASE_CONFIG.DATABASE_URL && FIREBASE_CONFIG.DATABASE_SECRET) {
        void fetch(buildDbUrl(`admin_logins/${newSessionId}`), {
          method: 'PUT',
          body: JSON.stringify(newSession),
        }).catch(() => { /* ignore */ });
      }
      setAdminSessions(prev => [newSession, ...prev]);
      return { success: true };
    }

    return { success: false, message: 'Invalid User Name / Email or Password.' };
  };

  const handleSignUp = async (
    username: string,
    email: string,
    password: string
  ): Promise<{ success: boolean; message: string }> => {
    const cleanUser = username.trim();
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanUser || !cleanEmail || !password) {
      return { success: false, message: 'All fields are required.' };
    }

    // Fetch latest users from Firebase so cross-browser signups stay consistent
    let latestUsers = registeredUsers;
    if (FIREBASE_CONFIG.DATABASE_URL && FIREBASE_CONFIG.DATABASE_SECRET) {
      try {
        const res = await fetch(buildDbUrl('app_users'), { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          if (data && typeof data === 'object') {
            latestUsers = Object.values(data) as AppUser[];
          }
        }
      } catch { /* fallback to current state */ }
    }

    if (latestUsers.some(u => u.username.toLowerCase() === cleanUser.toLowerCase())) {
      return { success: false, message: 'Username already exists.' };
    }
    if (latestUsers.some(u => u.email && u.email.toLowerCase() === cleanEmail)) {
      return { success: false, message: 'Email address is already registered.' };
    }

    const now = Date.now();
    const userId = `${toFirebaseKey(cleanUser.toLowerCase())}_${now.toString(36)}`;
    const activationToken = generateToken();
    const newUser: AppUser = {
      id: userId,
      username: cleanUser,
      email: cleanEmail,
      password,
      role: 'lecturer',
      status: 'pending',
      activationToken,
      createdAt: now,
    };

    const activationUrl = `${getPublicAppUrl()}?activate=${encodeURIComponent(activationToken)}&user=${encodeURIComponent(userId)}`;

    if (FIREBASE_CONFIG.DATABASE_URL && FIREBASE_CONFIG.DATABASE_SECRET) {
      const saveUserRes = await fetch(buildDbUrl(`app_users/${userId}`), {
        method: 'PUT',
        body: JSON.stringify(newUser),
      });
      if (!saveUserRes.ok) {
        return { success: false, message: 'Failed to save user registration to cloud.' };
      }
    }

    const emailSent = await sendActivationEmailViaScript({
      toEmail: cleanEmail,
      username: cleanUser,
      activationUrl,
    });

    const notifId = `notif_${now}_${Math.random().toString(36).slice(2, 6)}`;
    const notif: AdminNotification = {
      id: notifId,
      type: 'user_signup',
      userId,
      username: cleanUser,
      email: cleanEmail,
      createdAt: now,
      read: false,
      emailSent,
      message: `${cleanUser} (${cleanEmail}) signed up and is waiting for account activation.`,
    };

    if (FIREBASE_CONFIG.DATABASE_URL && FIREBASE_CONFIG.DATABASE_SECRET) {
      await fetch(buildDbUrl(`admin_notifications/${notifId}`), {
        method: 'PUT',
        body: JSON.stringify(notif),
      }).catch(() => { /* ignore */ });
    }

    setRegisteredUsers(prev => [newUser, ...prev]);
    setAdminNotifications(prev => [notif, ...prev]);

    return {
      success: true,
      message: emailSent
        ? `Account created! An activation email has been sent to ${cleanEmail}. Admin has also been notified.`
        : `Account created and Admin has been notified! Please check your email or ask Admin to send/activate your account link.`,
    };
  };

  // Admin Control Center Actions
  const handleDeleteUser = useCallback(async (userId: string) => {
    const targetUser = registeredUsers.find(u => u.id === userId);
    if (!targetUser || targetUser.role === 'admin' || targetUser.username.toLowerCase() === 'admin') return;

    setRegisteredUsers(prev => prev.filter(u => u.id !== userId));
    if (FIREBASE_CONFIG.DATABASE_URL && FIREBASE_CONFIG.DATABASE_SECRET) {
      await fetch(buildDbUrl(`app_users/${userId}`), { method: 'DELETE' }).catch(() => { /* ignore */ });

      // Revoke any active sessions belonging to the deleted user
      const matchingSessions = adminSessions.filter(
        s => s.adminName.toLowerCase() === targetUser.username.toLowerCase() && s.status === 'active'
      );
      await Promise.all(
        matchingSessions.map(s =>
          fetch(buildDbUrl(`admin_logins/${s.id}`), {
            method: 'PATCH',
            body: JSON.stringify({ status: 'signed_out', lastActiveTime: Date.now(), currentAction: 'Account Removed' }),
          }).catch(() => { /* ignore */ })
        )
      );
      setAdminSessions(prev =>
        prev.map(s =>
          s.adminName.toLowerCase() === targetUser.username.toLowerCase() && s.status === 'active'
            ? { ...s, status: 'signed_out', lastActiveTime: Date.now() }
            : s
        )
      );
    }
  }, [registeredUsers, adminSessions]);

  const handleActivateUser = useCallback(async (userId: string) => {
    const now = Date.now();
    setRegisteredUsers(prev =>
      prev.map(u => (u.id === userId ? { ...u, status: 'active', activatedAt: now } : u))
    );
    if (FIREBASE_CONFIG.DATABASE_URL && FIREBASE_CONFIG.DATABASE_SECRET) {
      await fetch(buildDbUrl(`app_users/${userId}`), {
        method: 'PATCH',
        body: JSON.stringify({ status: 'active', activatedAt: now }),
      }).catch(() => { /* ignore */ });
    }
  }, []);

  const handleResendActivationEmail = useCallback(async (user: AppUser): Promise<{ sent: boolean; activationUrl: string }> => {
    const tokenToUse = user.activationToken || generateToken();
    if (!user.activationToken && FIREBASE_CONFIG.DATABASE_URL && FIREBASE_CONFIG.DATABASE_SECRET) {
      await fetch(buildDbUrl(`app_users/${user.id}`), {
        method: 'PATCH',
        body: JSON.stringify({ activationToken: tokenToUse }),
      }).catch(() => { /* ignore */ });
      setRegisteredUsers(prev => prev.map(u => (u.id === user.id ? { ...u, activationToken: tokenToUse } : u)));
    }
    const url = buildActivationUrl({ ...user, activationToken: tokenToUse });
    if (!user.email) return { sent: false, activationUrl: url };
    const sent = await sendActivationEmailViaScript({
      toEmail: user.email,
      username: user.username,
      activationUrl: url,
    });
    return { sent, activationUrl: url };
  }, [buildActivationUrl, sendActivationEmailViaScript]);

  const handleRevokeSession = useCallback(async (sessionId: string) => {
    const now = Date.now();
    setAdminSessions(prev =>
      prev.map(s => (s.id === sessionId ? { ...s, status: 'signed_out', lastActiveTime: now } : s))
    );
    if (FIREBASE_CONFIG.DATABASE_URL && FIREBASE_CONFIG.DATABASE_SECRET) {
      await fetch(buildDbUrl(`admin_logins/${sessionId}`), {
        method: 'PATCH',
        body: JSON.stringify({ status: 'signed_out', lastActiveTime: now, currentAction: 'Revoked by Admin' }),
      }).catch(() => { /* ignore */ });
    }
  }, []);

  const handleClearInactiveSessions = useCallback(async () => {
    const staleThreshold = Date.now() - 2 * 60 * 1000;
    const toRemove = adminSessions.filter(s => s.status === 'signed_out' || (s.lastActiveTime || 0) < staleThreshold);
    const keep = adminSessions.filter(s => s.status === 'active' && (s.lastActiveTime || 0) >= staleThreshold);
    setAdminSessions(keep);
    if (FIREBASE_CONFIG.DATABASE_URL && FIREBASE_CONFIG.DATABASE_SECRET) {
      await Promise.all(
        toRemove.map(s => fetch(buildDbUrl(`admin_logins/${s.id}`), { method: 'DELETE' }).catch(() => { /* ignore */ }))
      );
    }
  }, [adminSessions]);

  const handleMarkNotificationRead = useCallback(async (notifId: string) => {
    setAdminNotifications(prev => prev.map(n => (n.id === notifId ? { ...n, read: true } : n)));
    if (FIREBASE_CONFIG.DATABASE_URL && FIREBASE_CONFIG.DATABASE_SECRET) {
      await fetch(buildDbUrl(`admin_notifications/${notifId}`), {
        method: 'PATCH',
        body: JSON.stringify({ read: true }),
      }).catch(() => { /* ignore */ });
    }
  }, []);

  const handleMarkAllNotificationsRead = useCallback(async () => {
    setAdminNotifications(prev => prev.map(n => ({ ...n, read: true })));
    if (FIREBASE_CONFIG.DATABASE_URL && FIREBASE_CONFIG.DATABASE_SECRET) {
      await Promise.all(
        adminNotifications
          .filter(n => !n.read)
          .map(n =>
            fetch(buildDbUrl(`admin_notifications/${n.id}`), {
              method: 'PATCH',
              body: JSON.stringify({ read: true }),
            }).catch(() => { /* ignore */ })
          )
      );
    }
  }, [adminNotifications]);

  const handleClearNotifications = useCallback(async () => {
    setAdminNotifications([]);
    if (FIREBASE_CONFIG.DATABASE_URL && FIREBASE_CONFIG.DATABASE_SECRET) {
      await fetch(buildDbUrl('admin_notifications'), { method: 'DELETE' }).catch(() => { /* ignore */ });
    }
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
      const path = activeCourse ? `${SESSION_ID}_${sanitize(activeCourse)}` : SESSION_ID;
      await fetch(`${getBaseDbUrl()}/live_sessions/${path}.json?auth=${FIREBASE_CONFIG.DATABASE_SECRET}`, {
        method: 'DELETE',
      });
    } catch {
      console.error('Failed to clear live session');
    }
  };

  const addStudent = async (
    name: string,
    studentId: string,
    email: string,
    status: string,
    courseName: string,
    overrideTimestamp?: number,
    absenceReason?: string,
    week?: string,
    requireRegistered = false
  ) => {
    if (!FIREBASE_CONFIG.DATABASE_URL || !FIREBASE_CONFIG.DATABASE_SECRET) {
      return { success: false, message: 'Configuration error.' };
    }
    checkAndClearForNewDay();

    const normalizeRegName = (val: string) => val.trim().replace(/\s+/g, ' ').toUpperCase();
    const normalizeRegId = (val: string) => val.trim().replace(/\s+/g, '').toUpperCase();

    if (requireRegistered) {
      const matchedCourse = courseName
        ? courses.find(c => c.courseName.trim().toUpperCase() === courseName.trim().toUpperCase())
        : undefined;
      let roster = (matchedCourse && Array.isArray(matchedCourse.students) && matchedCourse.students.length > 0)
        ? matchedCourse.students
        : knownStudents;
      if (roster.length === 0) {
        try {
          if (courseName) {
            const courseKey = toCourseKey(courseName);
            const courseRosterRes = await fetch(buildDbUrl(`courses/${courseKey}/students`), { cache: 'no-store' });
            if (courseRosterRes.ok) {
              const remoteCourseRoster = await courseRosterRes.json();
              if (Array.isArray(remoteCourseRoster) && remoteCourseRoster.length > 0) {
                roster = remoteCourseRoster;
                setKnownStudents(remoteCourseRoster);
              }
            }
          }
          if (roster.length === 0) {
            const rosterRes = await fetch(buildDbUrl('app_config/known_students_v2'), { cache: 'no-store' });
            if (rosterRes.ok) {
              const remoteRoster = await rosterRes.json();
              if (Array.isArray(remoteRoster) && remoteRoster.length > 0) {
                roster = remoteRoster;
                setKnownStudents(remoteRoster);
              }
            }
          }
        } catch { /* ignore */ }
      }
      const cleanSubmittedName = normalizeRegName(name);
      const cleanSubmittedId = normalizeRegId(studentId);
      const nameMatches = roster.filter(s => normalizeRegName(s.name) === cleanSubmittedName);
      if (nameMatches.length === 0) {
        return {
          success: false,
          message: 'Your name is not registered in the system. Please consult with your Lecturer.',
        };
      }
      if (!nameMatches.some(s => normalizeRegId(s.id) === cleanSubmittedId)) {
        return {
          success: false,
          message: 'Warning: Student ID does not match the registered student name.',
        };
      }
    }

    if (status === 'P' && attendanceList.some(s => s.studentId === studentId && s.status === 'P')) {
      return { success: false, message: 'Attendance already recorded for this student ID.' };
    }

    try {
      const path = courseName ? `${SESSION_ID}_${sanitize(courseName)}` : SESSION_ID;
      const checkRes = await fetch(buildDbUrl(`live_sessions/${path}/${studentId}`), { cache: 'no-store' });
      const existingData = await checkRes.json();
      if (existingData && existingData.status === 'P' && status === 'P') {
        return { success: false, message: 'You have already checked in for this session.' };
      }
    } catch { /* ignore */ }

    const timestamp = overrideTimestamp || Date.now();
    const targetWeek = week || selectedWeek || 'W1';
    const studentData: Student = { name, studentId, email, status, timestamp, courseName, absenceReason, week: targetWeek };

    setAttendanceList(prev => [{ ...studentData }, ...prev.filter(s => s.studentId !== studentId)]);
    setTeacherHistory(prev => {
      const next = [
        studentData,
        ...prev.filter(t => !(t.studentId === studentData.studentId && t.timestamp === studentData.timestamp)),
      ].slice(0, 200);
      syncHistoryToCloud(next);
      return next;
    });

    try {
      const path = courseName ? `${SESSION_ID}_${sanitize(courseName)}` : SESSION_ID;
      const p1 = fetch(`${getBaseDbUrl()}/pending/${studentId}.json?auth=${FIREBASE_CONFIG.DATABASE_SECRET}`, {
        method: 'PUT',
        body: JSON.stringify(studentData),
      });
      const p2 = fetch(`${getBaseDbUrl()}/live_sessions/${path}/${studentId}.json?auth=${FIREBASE_CONFIG.DATABASE_SECRET}`, {
        method: 'PUT',
        body: JSON.stringify(studentData),
      });
      await Promise.all([p1, p2]);

      if (integrationType === 'google_sheets' && scriptUrl) {
        await fetch(scriptUrl, {
          method: 'POST',
          mode: 'no-cors',
          body: JSON.stringify(formatCloudPayload(studentData)),
        }).catch(err => console.warn('Deferred sync', err));
      } else if (integrationType === 'airtable') {
        await syncToAirtable({ [studentId]: studentData });
      }
      if (!requireRegistered) {
        const cleanId = studentId.trim().toUpperCase();
        const cleanName = name.trim().toUpperCase();
        const existingIdx = knownStudents.findIndex(s => s.id.trim().toUpperCase() === cleanId);
        let nextKnown: PreRegisteredStudent[] | null = null;
        if (existingIdx === -1) {
          nextKnown = [...knownStudents, { id: cleanId, name: cleanName }];
        } else if (knownStudents[existingIdx].name.trim().toUpperCase() !== cleanName) {
          nextKnown = knownStudents.map((s, idx) => (idx === existingIdx ? { ...s, name: cleanName } : s));
        }
        if (nextKnown) {
          setKnownStudents(nextKnown);
          syncKnownStudentsToCloud(nextKnown, courseName);
        }
      }
      localStorage.setItem(LAST_SCAN_DATE_KEY, new Date().toISOString().slice(0, 10));
      return { success: true, message: 'Record submitted successfully.' };
    } catch {
      return { success: false, message: 'Connection lost. Please try again.' };
    }
  };

  const onRemoveStudents = async (ids: string[], courseName: string) => {
    if (!FIREBASE_CONFIG.DATABASE_URL || !FIREBASE_CONFIG.DATABASE_SECRET) return;
    setAttendanceList(prev => prev.filter(s => !ids.includes(s.studentId)));
    const now = Date.now();
    const promises: Promise<unknown>[] = [];
    const path = courseName ? `${SESSION_ID}_${sanitize(courseName)}` : SESSION_ID;
    for (const id of ids) {
      const student = attendanceList.find(s => s.studentId === id) || knownStudents.find(k => k.id === id);
      const removalData: Student = {
        studentId: id,
        name: student?.name || 'Unknown',
        email: `${id}@student.edu.my`,
        status: 'A',
        timestamp: now,
        courseName,
        absenceReason: 'Lecturer Override',
        week: selectedWeek || 'W1',
      };
      promises.push(
        fetch(`${getBaseDbUrl()}/pending/${id}.json?auth=${FIREBASE_CONFIG.DATABASE_SECRET}`, { method: 'PUT', body: JSON.stringify(removalData) }),
        fetch(`${getBaseDbUrl()}/live_sessions/${path}/${id}.json?auth=${FIREBASE_CONFIG.DATABASE_SECRET}`, { method: 'DELETE' })
      );

      if (integrationType === 'google_sheets' && scriptUrl) {
        promises.push(fetch(scriptUrl, { method: 'POST', mode: 'no-cors', body: JSON.stringify(formatCloudPayload(removalData)) }));
      } else if (integrationType === 'airtable') {
        promises.push(syncToAirtable({ [id]: removalData }));
      }
    }
    await Promise.all(promises);
  };

  const onBulkStatusUpdate = async (ids: string[], status: string, courseName: string, absenceReason?: string) => {
    setAttendanceList(prev => prev.map(s => (ids.includes(s.studentId) ? { ...s, status, absenceReason, week: selectedWeek } : s)));
    const now = Date.now();
    const updatePayload: Record<string, Student> = {};
    const path = courseName ? `${SESSION_ID}_${sanitize(courseName)}` : SESSION_ID;
    const promises: Promise<Response>[] = [];
    for (const id of ids) {
      const student = attendanceList.find(s => s.studentId === id);
      if (student) {
        const updateData: Student = { ...student, status, timestamp: now, courseName, absenceReason, week: selectedWeek || 'W1' };
        updatePayload[id] = updateData;
        promises.push(
          fetch(`${getBaseDbUrl()}/pending/${id}.json?auth=${FIREBASE_CONFIG.DATABASE_SECRET}`, { method: 'PUT', body: JSON.stringify(updateData) }),
          fetch(`${getBaseDbUrl()}/live_sessions/${path}/${id}.json?auth=${FIREBASE_CONFIG.DATABASE_SECRET}`, { method: 'PUT', body: JSON.stringify(updateData) })
        );
      }
    }
    await Promise.all(promises);
    if (integrationType === 'google_sheets' && scriptUrl && Object.keys(updatePayload).length > 0) {
      const bulkPayload = Object.values(updatePayload).map(formatCloudPayload);
      await fetch(scriptUrl, { method: 'POST', mode: 'no-cors', body: JSON.stringify(bulkPayload) });
    } else if (integrationType === 'airtable' && Object.keys(updatePayload).length > 0) {
      await syncToAirtable(updatePayload);
    }
  };

  const handleSendTestRecord = async (courseName: string): Promise<{ success: boolean; message: string }> => {
    if (!FIREBASE_CONFIG.DATABASE_URL || !FIREBASE_CONFIG.DATABASE_SECRET) return { success: false, message: 'Firebase URL missing.' };
    const testRecord: Student = { name: 'CONNECTION TEST', studentId: 'TEST999', email: 'test@student.edu.my', status: 'P', timestamp: Date.now(), courseName: courseName || 'Connectivity Test', absenceReason: '', week: selectedWeek || 'W1' };
    try {
      await fetch(`${getBaseDbUrl()}/pending/TEST999.json?auth=${FIREBASE_CONFIG.DATABASE_SECRET}`, { method: 'PUT', body: JSON.stringify(testRecord) });

      if (integrationType === 'google_sheets' && scriptUrl) {
        await fetch(scriptUrl, { method: 'POST', mode: 'no-cors', body: JSON.stringify(formatCloudPayload(testRecord)) });
      } else if (integrationType === 'airtable') {
        await syncToAirtable({ TEST999: testRecord });
      }

      return { success: true, message: `Test signal sent to Cloud (${selectedWeek}).` };
    } catch {
      return { success: false, message: 'Cloud test failed.' };
    }
  };

  const handleCheckPendingRecords = async (): Promise<{ success: boolean; message: string; count: number }> => {
    if (!FIREBASE_CONFIG.DATABASE_URL || !FIREBASE_CONFIG.DATABASE_SECRET) return { success: false, message: 'Firebase URL missing.', count: 0 };
    try {
      const res = await fetch(buildDbUrl('pending'), { cache: 'no-store' });
      const data = await res.json();
      return { success: true, message: data ? `Queue length: ${Object.keys(data).length}` : 'Synchronization queue is empty.', count: data ? Object.keys(data).length : 0 };
    } catch {
      return { success: false, message: 'Status check failed.', count: 0 };
    }
  };

  const handleClearPendingQueue = async (): Promise<{ success: boolean; message: string }> => {
    if (!FIREBASE_CONFIG.DATABASE_URL || !FIREBASE_CONFIG.DATABASE_SECRET) return { success: false, message: 'Firebase URL missing.' };
    try {
      const res = await fetch(`${getBaseDbUrl()}/pending.json?auth=${FIREBASE_CONFIG.DATABASE_SECRET}`, {
        method: 'DELETE',
      });
      if (!res.ok) return { success: false, message: 'Failed to clear queue.' };
      return { success: true, message: 'Queue cleared. Queue length: 0' };
    } catch {
      return { success: false, message: 'Failed to clear queue.' };
    }
  };

  const handleForceSync = async (): Promise<{ success: boolean; message: string; syncedCount: number; errorCount: number; total: number }> => {
    if (integrationType === 'firebase') {
      return { success: true, message: 'Firebase syncs automatically.', syncedCount: 0, errorCount: 0, total: 0 };
    }

    if (integrationType === 'airtable') {
      try {
        const res = await fetch(buildDbUrl('pending'), { cache: 'no-store' });
        const data = await res.json();
        if (data) {
          await syncToAirtable(data);
          return { success: true, message: 'Synced pending records to Airtable.', syncedCount: Object.keys(data).length, errorCount: 0, total: Object.keys(data).length };
        }
        return { success: true, message: 'No pending records to sync.', syncedCount: 0, errorCount: 0, total: 0 };
      } catch {
        return { success: false, message: 'Airtable sync failed.', syncedCount: 0, errorCount: 0, total: 0 };
      }
    }

    if (!scriptUrl) return { success: false, message: 'Script Endpoint missing.', syncedCount: 0, errorCount: 0, total: 0 };
    try {
      const pendingRes = await fetch(buildDbUrl('pending'), { cache: 'no-store' });
      const pendingData = pendingRes.ok ? await pendingRes.json() : null;
      if (pendingData && Object.keys(pendingData).length > 0) {
        const records = Object.values(pendingData) as Student[];
        const bulkPayload = records.map(r => formatCloudPayload({ ...r, week: r.week || selectedWeek }));
        await fetch(scriptUrl, { method: 'POST', mode: 'no-cors', body: JSON.stringify(bulkPayload) });
        return { success: true, message: `Synced ${records.length} record(s) to ${selectedWeek}.`, syncedCount: records.length, errorCount: 0, total: records.length };
      }
      await fetch(scriptUrl, { method: 'POST', mode: 'no-cors', body: JSON.stringify({ action: 'SYNC_QUEUE', week: selectedWeek }) });
      return { success: true, message: `Cloud sync triggered (${selectedWeek}).`, syncedCount: 0, errorCount: 0, total: 0 };
    } catch {
      return { success: false, message: 'Trigger failed.', syncedCount: 0, errorCount: 0, total: 0 };
    }
  };

  const [kioskToken] = useState(() => Date.now().toString());

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col font-sans antialiased">
      {view === 'teacher' ? (
        isAuthenticated ? (
          <div className="flex-1 p-2 sm:p-4 overflow-x-hidden overflow-y-auto relative">
            <TeacherView
              attendanceList={attendanceList}
              onRemoveStudents={onRemoveStudents}
              onBulkStatusUpdate={onBulkStatusUpdate}
              onNewSession={handleNewSession}
              scriptUrl={scriptUrl}
              onScriptUrlChange={handleScriptUrlChange}
              onOpenKiosk={handleEnterKiosk}
              onManualAdd={(name, id, email, status, courseName, reason) => addStudent(name, id, email, status, courseName, undefined, reason)}
              addStudent={addStudent}
              onLogout={handleLogout}
              knownStudents={knownStudents}
              onSendTestRecord={handleSendTestRecord}
              onCheckPendingRecords={handleCheckPendingRecords}
              onClearPendingQueue={handleClearPendingQueue}
              onForceSync={handleForceSync}
              onUpdateKnownStudents={handleUpdateKnownStudents}
              courseName={activeCourse}
              onCourseChange={handleCourseChange}
              courses={courses}
              onSelectCourse={handleSelectCourse}
              onAddCourse={handleAddCourse}
              onDeleteCourse={handleDeleteCourse}
              onSyncSheetCourses={handleSyncSheetCourses}
              selectedWeek={selectedWeek}
              onWeekChange={handleWeekChange}
              currentAdminName={currentAdminName}
              integrationType={integrationType}
              onIntegrationTypeChange={handleIntegrationTypeChange}
              teacherHistory={teacherHistory}
              onDeleteHistoryItem={handleDeleteHistoryItem}
              onClearTeacherHistory={handleClearTeacherHistory}
              registeredUsers={registeredUsers}
              adminSessions={adminSessions}
              adminNotifications={adminNotifications}
              adminEmail={adminEmail}
              onAdminEmailChange={handleAdminEmailChange}
              onDeleteUser={handleDeleteUser}
              onActivateUser={handleActivateUser}
              onResendActivationEmail={handleResendActivationEmail}
              onRevokeSession={handleRevokeSession}
              onClearInactiveSessions={handleClearInactiveSessions}
              onMarkNotificationRead={handleMarkNotificationRead}
              onMarkAllNotificationsRead={handleMarkAllNotificationsRead}
              onClearNotifications={handleClearNotifications}
              onSendTestAdminEmail={sendTestAdminEmail}
            />
          </div>
        ) : (
          <LoginView
            onLogin={handleLogin}
            onSignUp={handleSignUp}
            activationNotice={activationNotice}
            onDismissActivationNotice={() => setActivationNotice(null)}
          />
        )
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center p-3 sm:p-4 bg-gray-100">
          <div className="w-full max-w-md bg-white rounded-3xl shadow-xl p-5 sm:p-6 border border-gray-100">
            <StudentView
              markAttendance={(name, id, email, scannedWeek) =>
                addStudent(name, id, email, 'P', courseNameParam || activeCourse || 'General Session', undefined, undefined, scannedWeek || weekParam || selectedWeek, true)
              }
              token={token || (isKioskMode ? kioskToken : '')}
              courseName={courseNameParam || activeCourse || undefined}
              week={weekParam || selectedWeek}
              geoConstraints={latParam && lngParam ? { lat: parseFloat(latParam), lng: parseFloat(lngParam), radius: radParam ? parseFloat(radParam) : 150 } : undefined}
              bypassRestrictions={isKioskMode}
              isOfflineScan={isOfflineScan}
              knownStudents={knownStudents}
              onSwitchToTeacher={() => setView('teacher')}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
