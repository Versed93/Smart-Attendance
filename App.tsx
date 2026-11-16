import React, { useState, useCallback, useEffect, useRef } from 'react';
import { TeacherView } from './components/TeacherView';
import { StudentView } from './components/StudentView';
import { LoginView } from './components/LoginView';
import type { Student, AppUser, AdminSessionActivity, AdminNotification, CourseProfile } from './types';
import { PRE_REGISTERED_STUDENTS, PreRegisteredStudent } from './studentList';

type View = 'teacher' | 'student';
type IntegrationType = 'google_sheets' | 'airtable' | 'firebase';

const SCRIPT_URL_KEY = 'attendance-script-url-v58';
const AUTH_KEY = 'attendance-lecturer-auth-v1';
const AUTH_TOKEN_KEY = 'attendance-auth-token-v1';
const VIEW_PREF_KEY = 'attendance-view-pref-v1';
const KIOSK_PREF_KEY = 'attendance-kiosk-pref-v1';
const KNOWN_STUDENTS_KEY = 'attendance-known-students-v2';
const LEGACY_KNOWN_STUDENTS_KEY = 'attendance-known-students-v1';
const LEGACY_REGISTERED_USERS_KEY = 'attendance-registered-users-v1';
const LAST_SCAN_DATE_KEY = 'attendance-last-scan-date-v1';
const CURRENT_ADMIN_NAME_KEY = 'attendance-current-admin-name-v1';
const CURRENT_USER_ID_KEY = 'attendance-current-user-id-v1';
const CURRENT_USER_ROLE_KEY = 'attendance-current-user-role-v1';
const ACTIVE_SESSION_ID_KEY = 'attendance-active-session-id-v1';
const TEACHER_HISTORY_KEY = 'attendance-teacher-history-v1';
const ADMIN_EMAIL_KEY = 'attendance-admin-email-v1';
const ACTIVE_WEEK_KEY = 'attendance-active-week-v2';
const COURSES_KEY = 'attendance-courses-v1';

const DEFAULT_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwbjXTrbFPRqVA0I-RGc1rV7K7eZ_CkgQujSBVtOtvjDCW1GJYAkxiVlXJzAB_-R_CaLA/exec';

const getPublicAppUrl = () => {
  const publicOrigin = window.location.origin.replace(/^https:\/\/ais-dev-/i, 'https://ais-pre-');
  return `${publicOrigin}${window.location.pathname}`;
};

const isDevPreviewOrigin = () => /^ais-dev-/i.test(window.location.hostname);

async function readJsonSafe<T = Record<string, unknown>>(res: Response): Promise<T | null> {
  try {
    const raw = await res.text();
    if (!raw) return null;
    const trimmed = raw.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
      return null;
    }
    return JSON.parse(trimmed) as T;
  } catch {
    return null;
  }
}

const normalizeCourses = (list: unknown): CourseProfile[] => {
  if (!Array.isArray(list)) return [];
  return list
    .filter((c): c is CourseProfile => Boolean(c && typeof c === 'object' && (c as CourseProfile).id && (c as CourseProfile).courseName))
    .map(c => ({
      ...c,
      selectedWeek: c.selectedWeek || 'W1',
      students: Array.isArray(c.students) ? c.students : [],
      sharedWith: Array.isArray(c.sharedWith) ? c.sharedWith : [],
    }));
};

const App: React.FC = () => {
  const [initialUrlParams] = useState(() => new URLSearchParams(window.location.search));
  const token = initialUrlParams.get('t');
  const courseNameParam = initialUrlParams.get('c');
  const courseIdParam = initialUrlParams.get('cid');
  const weekParam = initialUrlParams.get('w');
  const isOfflineScan = initialUrlParams.get('offline') === 'true';
  const activateTokenParam = initialUrlParams.get('activate');
  const activateUserParam = initialUrlParams.get('user');
  const testEmailParam = initialUrlParams.get('test_email');

  const latParam = initialUrlParams.get('lat');
  const lngParam = initialUrlParams.get('lng');
  const radParam = initialUrlParams.get('rad');

  const [authToken, setAuthToken] = useState<string>(() => {
    localStorage.removeItem(LEGACY_REGISTERED_USERS_KEY);
    return localStorage.getItem(AUTH_TOKEN_KEY) || '';
  });

  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    localStorage.removeItem(VIEW_PREF_KEY);
    localStorage.removeItem(KIOSK_PREF_KEY);
    if ((activateTokenParam && activateUserParam) || testEmailParam === 'verified') return false;
    const auth = localStorage.getItem(AUTH_KEY) === 'true';
    const savedToken = localStorage.getItem(AUTH_TOKEN_KEY);
    return auth && Boolean(savedToken);
  });

  // Always direct root URL opens to Main Access ('teacher' -> LoginView when unauthenticated),
  // reserving 'student' view strictly for QR scan links (?t=...) or active Kiosk sessions.
  const initialView: View = (activateTokenParam && activateUserParam) || testEmailParam === 'verified'
    ? 'teacher'
    : token
      ? 'student'
      : 'teacher';

  const [view, setView] = useState<View>(initialView);
  const [isKioskMode, setIsKioskMode] = useState(false);
  const [activeCourse, setActiveCourse] = useState(() => localStorage.getItem('attendance-course-name') || '');
  const [selectedWeek, setSelectedWeek] = useState<string>(() => {
    localStorage.removeItem('attendance-active-week');
    return localStorage.getItem(ACTIVE_WEEK_KEY) || 'W1';
  });
  const [integrationType, setIntegrationType] = useState<IntegrationType>(() => {
    return (localStorage.getItem('attendance-integration-type') as IntegrationType) || 'google_sheets';
  });
  const [adminEmail, setAdminEmail] = useState<string>(() => localStorage.getItem(ADMIN_EMAIL_KEY) || '');

  const [registeredUsers, setRegisteredUsers] = useState<AppUser[]>([]);
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
  const [currentUserRole, setCurrentUserRole] = useState<'admin' | 'lecturer'>(() => {
    const savedRole = localStorage.getItem(CURRENT_USER_ROLE_KEY);
    if (savedRole === 'admin' || savedRole === 'lecturer') return savedRole;
    return localStorage.getItem(CURRENT_ADMIN_NAME_KEY)?.toLowerCase() === 'admin' ? 'admin' : 'lecturer';
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
        return normalizeCourses(JSON.parse(saved));
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
        sharedWith: [],
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
  const authTokenRef = useRef<string>(authToken);

  useEffect(() => {
    coursesRef.current = courses;
  }, [courses]);

  useEffect(() => {
    activeCourseRef.current = activeCourse;
  }, [activeCourse]);

  useEffect(() => {
    authTokenRef.current = authToken;
  }, [authToken]);

  const toCourseKey = useCallback((name: string) => {
    const clean = name.trim();
    return clean ? clean.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase() : 'GENERAL_SESSION';
  }, []);

  useEffect(() => {
    if (authToken) localStorage.setItem(AUTH_TOKEN_KEY, authToken);
    else localStorage.removeItem(AUTH_TOKEN_KEY);
  }, [authToken]);

  useEffect(() => {
    if (currentAdminName) localStorage.setItem(CURRENT_ADMIN_NAME_KEY, currentAdminName);
    else localStorage.removeItem(CURRENT_ADMIN_NAME_KEY);
  }, [currentAdminName]);

  useEffect(() => {
    if (currentUserId) localStorage.setItem(CURRENT_USER_ID_KEY, currentUserId);
    else localStorage.removeItem(CURRENT_USER_ID_KEY);
  }, [currentUserId]);

  useEffect(() => {
    localStorage.setItem(CURRENT_USER_ROLE_KEY, currentUserRole);
  }, [currentUserRole]);

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

  const clearClientSession = useCallback((noticeMessage?: string) => {
    setIsAuthenticated(false);
    setAuthToken('');
    setCurrentAdminName('');
    setCurrentUserId('');
    setCurrentUserRole('lecturer');
    setActiveSessionId('');
    setRegisteredUsers([]);
    setAdminSessions([]);
    setAdminNotifications([]);
    setAttendanceList([]);
    hasInitializedUserPrefRef.current = false;
    courseEditedAtRef.current = 0;
    localStorage.removeItem(AUTH_KEY);
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(CURRENT_ADMIN_NAME_KEY);
    localStorage.removeItem(CURRENT_USER_ID_KEY);
    localStorage.removeItem(CURRENT_USER_ROLE_KEY);
    localStorage.removeItem(ACTIVE_SESSION_ID_KEY);
    localStorage.removeItem(KIOSK_PREF_KEY);
    if (noticeMessage) {
      setActivationNotice({ type: 'error', message: noticeMessage });
    }
    setView('teacher');
    setIsKioskMode(false);
  }, []);

  const handleLogout = useCallback(() => {
    const activeToken = authTokenRef.current || localStorage.getItem(AUTH_TOKEN_KEY);
    if (activeToken) {
      void fetch('/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${activeToken}` },
      }).catch(() => { /* ignore */ });
    }
    clearClientSession();
  }, [clearClientSession]);

  const apiFetch = useCallback(
    async (url: string, options: RequestInit = {}): Promise<Response> => {
      const activeToken = authTokenRef.current || localStorage.getItem(AUTH_TOKEN_KEY) || '';
      const headers = new Headers(options.headers || {});
      if (activeToken) {
        headers.set('Authorization', `Bearer ${activeToken}`);
      }
      if (options.body && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
      }
      const res = await fetch(url, { ...options, headers });
      if (res.status === 401 && activeToken) {
        let msg = 'Your session expired or was revoked by the Administrator.';
        try {
          const body = (await res.clone().json()) as { error?: string };
          if (body?.error) msg = body.error;
        } catch { /* ignore */ }
        clearClientSession(msg);
      }
      return res;
    },
    [clearClientSession]
  );

  // Load public non-secret configuration on boot
  useEffect(() => {
    let cancelled = false;
    const loadPublicCfg = async () => {
      try {
        const res = await fetch('/api/config/public', { cache: 'no-store' });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled || !data) return;
        if (typeof data.scriptUrl === 'string' && data.scriptUrl.startsWith('https://script.google.com/')) {
          setScriptUrl(data.scriptUrl);
        }
        if (
          data.integrationType === 'google_sheets' ||
          data.integrationType === 'airtable' ||
          data.integrationType === 'firebase'
        ) {
          setIntegrationType(data.integrationType);
        }
      } catch { /* ignore */ }
    };
    void loadPublicCfg();
    return () => { cancelled = true; };
  }, []);

  const syncAllCloudState = useCallback(async () => {
    const activeToken = authTokenRef.current || localStorage.getItem(AUTH_TOKEN_KEY);
    if (!isAuthenticated || !activeToken) return;
    try {
      const res = await apiFetch('/api/dashboard/sync', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      if (!data?.success) return;

      if (data.user) {
        if (data.user.role === 'admin' || data.user.role === 'lecturer') {
          setCurrentUserRole(data.user.role);
        }
        if (data.user.username) setCurrentAdminName(data.user.username);
        if (data.user.id) setCurrentUserId(data.user.id);
      }

      if (data.config) {
        if (typeof data.config.scriptUrl === 'string' && data.config.scriptUrl.startsWith('https://script.google.com/')) {
          setScriptUrl(data.config.scriptUrl);
        }
        if (
          data.config.integrationType === 'google_sheets' ||
          data.config.integrationType === 'airtable' ||
          data.config.integrationType === 'firebase'
        ) {
          setIntegrationType(data.config.integrationType);
        }
        if (typeof data.config.adminEmail === 'string') {
          setAdminEmail(data.config.adminEmail);
        }
      }

      const loadedCourses = normalizeCourses(data.courses);
      if (Date.now() - courseEditedAtRef.current > 4000) {
        setCourses(loadedCourses);
      }

      if (data.userPref && typeof data.userPref === 'object' && Date.now() - courseEditedAtRef.current > 3000) {
        const pref = data.userPref as { activeCourse?: string; selectedWeek?: string };
        if (!hasInitializedUserPrefRef.current) {
          hasInitializedUserPrefRef.current = true;
          if (typeof pref.activeCourse === 'string' && pref.activeCourse.trim()) {
            const matchedCourse = loadedCourses.find(
              c => c.courseName.trim().toUpperCase() === pref.activeCourse!.trim().toUpperCase()
            );
            if (matchedCourse) {
              setActiveCourse(matchedCourse.courseName);
              setKnownStudents(matchedCourse.students || []);
            } else if (loadedCourses.length > 0) {
              setActiveCourse(loadedCourses[0].courseName);
              setKnownStudents(loadedCourses[0].students || []);
            } else {
              setActiveCourse('');
            }
          } else if (loadedCourses.length > 0) {
            setActiveCourse(loadedCourses[0].courseName);
            setKnownStudents(loadedCourses[0].students || []);
          } else {
            setActiveCourse('');
          }
        }
        if (typeof pref.selectedWeek === 'string' && /^W\d+$/i.test(pref.selectedWeek)) {
          setSelectedWeek(pref.selectedWeek);
        }
      } else if (!hasInitializedUserPrefRef.current) {
        hasInitializedUserPrefRef.current = true;
        if (loadedCourses.length > 0) {
          const currentMatches = loadedCourses.find(
            c => c.courseName.trim().toUpperCase() === activeCourseRef.current.trim().toUpperCase()
          );
          if (currentMatches) {
            setKnownStudents(currentMatches.students || []);
          } else {
            setActiveCourse(loadedCourses[0].courseName);
            setKnownStudents(loadedCourses[0].students || []);
          }
        }
      }

      if (Array.isArray(data.history)) {
        setTeacherHistory(data.history);
      }
      if (Array.isArray(data.users)) {
        setRegisteredUsers(data.users);
      }
      if (Array.isArray(data.sessions)) {
        setAdminSessions(data.sessions);
      }
      if (Array.isArray(data.notifications)) {
        setAdminNotifications(data.notifications);
      }
    } catch {
      // Ignore transient network errors
    }
  }, [isAuthenticated, apiFetch]);

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
        const res = await fetch('/api/auth/activate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: activateTokenParam, userId: activateUserParam }),
        });
        const data = await res.json();
        if (cancelled) return;
        setActivationNotice({
          type: data?.success ? 'success' : 'error',
          message: data?.message || 'Could not verify activation link.',
        });
        if (data?.success && window.location.search) {
          window.history.replaceState({}, '', window.location.pathname);
        }
      } catch {
        if (!cancelled) {
          setActivationNotice({ type: 'error', message: 'Network error while activating account.' });
        }
      }
    };

    void processActivation();
    return () => { cancelled = true; };
  }, [activateTokenParam, activateUserParam, testEmailParam]);

  // Initial sync + cross-device polling when authenticated
  useEffect(() => {
    if (!isAuthenticated || !authToken) return;
    const initialTimer = setTimeout(() => {
      void syncAllCloudState();
    }, 0);

    const pollInterval = setInterval(() => {
      void syncAllCloudState();
    }, view === 'teacher' ? 6000 : 20000);

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
  }, [syncAllCloudState, isAuthenticated, authToken, view]);

  // Activity Heartbeat for currently logged-in user
  useEffect(() => {
    if (!isAuthenticated || !authToken) return;

    const sendHeartbeat = () => {
      void apiFetch('/api/auth/heartbeat', {
        method: 'POST',
        body: JSON.stringify({ currentAction: view === 'teacher' ? 'Dashboard' : 'Kiosk' }),
      }).catch(() => { /* ignore */ });
    };

    sendHeartbeat();
    const hbInterval = setInterval(sendHeartbeat, 15000);

    const handlePageHide = () => {
      try {
        void fetch('/api/auth/logout', {
          method: 'POST',
          keepalive: true,
          headers: { Authorization: `Bearer ${authToken}` },
        });
      } catch { /* ignore */ }
    };

    window.addEventListener('pagehide', handlePageHide);
    return () => {
      clearInterval(hbInterval);
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, [isAuthenticated, authToken, view, apiFetch]);

  const handleScriptUrlChange = useCallback((nextUrl: string) => {
    const trimmed = nextUrl.trim();
    setScriptUrl(trimmed);
    if (trimmed.startsWith('https://script.google.com/')) {
      void apiFetch('/api/admin/config', {
        method: 'PATCH',
        body: JSON.stringify({ scriptUrl: trimmed }),
      }).catch(() => { /* ignore */ });
    }
  }, [apiFetch]);

  const saveUserCoursePref = useCallback((nextCourse: string, nextWeek: string) => {
    if (!authTokenRef.current) return;
    void apiFetch('/api/user/preferences', {
      method: 'PUT',
      body: JSON.stringify({ activeCourse: nextCourse, selectedWeek: nextWeek }),
    }).catch(() => { /* ignore */ });
  }, [apiFetch]);

  const persistCourseToServer = useCallback((course: CourseProfile) => {
    if (!authTokenRef.current) return;
    void apiFetch(`/api/courses/${encodeURIComponent(course.id)}`, {
      method: 'PUT',
      body: JSON.stringify(course),
    }).catch(() => { /* ignore */ });
  }, [apiFetch]);

  const handleCourseChange = useCallback((courseName: string) => {
    courseEditedAtRef.current = Date.now();
    hasInitializedUserPrefRef.current = true;
    setActiveCourse(courseName);
    const trimmed = courseName.trim();
    if (trimmed) {
      const matched = coursesRef.current.find(c => c.courseName.toUpperCase() === trimmed.toUpperCase());
      if (matched) {
        setKnownStudents(matched.students || []);
      }
    }
    if (courseDebounceRef.current) clearTimeout(courseDebounceRef.current);
    courseDebounceRef.current = setTimeout(() => {
      saveUserCoursePref(courseName, selectedWeek);
    }, 450);
  }, [saveUserCoursePref, selectedWeek]);

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
    const existing = coursesRef.current.find(c => c.courseName.trim().toUpperCase() === cleanName.toUpperCase());
    if (existing) {
      if (initialStudents.length > 0) {
        const mergedMap = new Map<string, PreRegisteredStudent>();
        (existing.students || []).forEach(s => mergedMap.set(s.id, s));
        initialStudents.forEach(s => mergedMap.set(s.id, s));
        const updated: CourseProfile = {
          ...existing,
          students: Array.from(mergedMap.values()),
          updatedAt: Date.now(),
        };
        courseEditedAtRef.current = Date.now();
        setCourses(prev => prev.map(c => (c.id === updated.id ? updated : c)));
        handleSelectCourse(updated);
        persistCourseToServer(updated);
        return updated;
      }
      handleSelectCourse(existing);
      return existing;
    }
    const now = Date.now();
    const uidSuffix = currentUserId ? `__${currentUserId}` : '';
    const tempId = `${toCourseKey(cleanName)}${uidSuffix}`;
    const optimisticCourse: CourseProfile = {
      id: tempId,
      courseName: cleanName,
      selectedWeek: 'W1',
      students: initialStudents,
      ownerId: currentUserId || undefined,
      createdBy: currentAdminName || 'lecturer',
      sharedWith: [],
      createdAt: now,
      updatedAt: now,
    };

    courseEditedAtRef.current = Date.now();
    hasInitializedUserPrefRef.current = true;
    setCourses(prev => [...prev, optimisticCourse]);
    setActiveCourse(optimisticCourse.courseName);
    setSelectedWeek('W1');
    setKnownStudents(optimisticCourse.students);
    setAttendanceList([]);

    void apiFetch('/api/courses', {
      method: 'POST',
      body: JSON.stringify({
        courseName: cleanName,
        selectedWeek: 'W1',
        students: initialStudents,
      }),
    })
      .then(r => (r.ok ? r.json() : null))
      .then((resData: { course?: CourseProfile } | null) => {
        if (resData?.course) {
          const saved = normalizeCourses([resData.course])[0];
          setCourses(prev => prev.map(c => (c.id === tempId || c.id === saved.id ? saved : c)));
        }
      })
      .catch(() => { /* ignore */ });

    return optimisticCourse;
  }, [apiFetch, currentAdminName, currentUserId, handleSelectCourse, persistCourseToServer, toCourseKey]);

  const handleDeleteCourse = useCallback(async (courseId: string) => {
    courseEditedAtRef.current = Date.now();
    const remaining = coursesRef.current.filter(c => c.id !== courseId);
    const deletedCourse = coursesRef.current.find(c => c.id === courseId);
    setCourses(remaining);
    await apiFetch(`/api/courses/${encodeURIComponent(courseId)}`, { method: 'DELETE' }).catch(() => { /* ignore */ });

    if (deletedCourse && activeCourseRef.current.trim().toUpperCase() === deletedCourse.courseName.trim().toUpperCase()) {
      const next = remaining[0];
      if (next) {
        handleSelectCourse(next);
      } else {
        setActiveCourse('');
        setKnownStudents([]);
        setAttendanceList([]);
        saveUserCoursePref('', selectedWeek);
      }
    }
  }, [apiFetch, handleSelectCourse, saveUserCoursePref, selectedWeek]);

  const handleSyncSheetCourses = useCallback((sheetTabs: Array<{ sheetName: string; courseName: string; students: PreRegisteredStudent[] }>) => {
    if (!Array.isArray(sheetTabs) || sheetTabs.length === 0) return;
    courseEditedAtRef.current = Date.now();
    void apiFetch('/api/courses/sync-tabs', {
      method: 'POST',
      body: JSON.stringify({ tabs: sheetTabs }),
    })
      .then(r => (r.ok ? r.json() : null))
      .then((resData: { courses?: CourseProfile[] } | null) => {
        if (resData?.courses) {
          const syncedList = normalizeCourses(resData.courses);
          setCourses(prev => {
            const byId = new Map<string, CourseProfile>();
            prev.forEach(c => byId.set(c.id, c));
            syncedList.forEach(c => byId.set(c.id, c));
            return Array.from(byId.values()).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
          });
        }
      })
      .catch(() => { /* ignore */ });
  }, [apiFetch]);

  const handleAssignCourseOwner = useCallback(async (courseId: string, ownerId: string) => {
    courseEditedAtRef.current = Date.now();
    try {
      const res = await apiFetch(`/api/courses/${encodeURIComponent(courseId)}/owner`, {
        method: 'PATCH',
        body: JSON.stringify({ ownerId }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data?.course) {
        const updated = normalizeCourses([data.course])[0];
        setCourses(prev => prev.map(c => (c.id === updated.id ? updated : c)));
      }
    } catch { /* ignore */ }
  }, [apiFetch]);

  const handleWeekChange = useCallback((week: string) => {
    courseEditedAtRef.current = Date.now();
    setSelectedWeek(week);
    saveUserCoursePref(activeCourse, week);
    if (activeCourse.trim()) {
      const matched = coursesRef.current.find(c => c.courseName.trim().toUpperCase() === activeCourse.trim().toUpperCase());
      if (matched) {
        const updated: CourseProfile = { ...matched, selectedWeek: week, updatedAt: Date.now() };
        setCourses(prev => prev.map(c => (c.id === matched.id ? updated : c)));
        persistCourseToServer(updated);
      }
    }
  }, [activeCourse, persistCourseToServer, saveUserCoursePref]);

  const handleIntegrationTypeChange = useCallback((nextType: IntegrationType) => {
    setIntegrationType(nextType);
    void apiFetch('/api/admin/config', {
      method: 'PATCH',
      body: JSON.stringify({ integrationType: nextType }),
    }).catch(() => { /* ignore */ });
  }, [apiFetch]);

  const handleAdminEmailChange = useCallback((email: string) => {
    const trimmed = email.trim();
    setAdminEmail(trimmed);
    void apiFetch('/api/admin/config', {
      method: 'PATCH',
      body: JSON.stringify({ adminEmail: trimmed }),
    }).catch(() => { /* ignore */ });
  }, [apiFetch]);

  const syncKnownStudentsToCloud = useCallback((students: PreRegisteredStudent[], targetCourseName?: string) => {
    if (!authTokenRef.current) return;
    const courseLabel = (targetCourseName ?? activeCourseRef.current).trim();
    if (!courseLabel) return;
    const existing = coursesRef.current.find(
      c => c.courseName.trim().toUpperCase() === courseLabel.toUpperCase()
    );
    const now = Date.now();
    if (existing) {
      const updatedCourse: CourseProfile = { ...existing, students, updatedAt: now };
      setCourses(prev => prev.map(c => (c.id === updatedCourse.id ? updatedCourse : c)));
      persistCourseToServer(updatedCourse);
    } else {
      void apiFetch('/api/courses', {
        method: 'POST',
        body: JSON.stringify({
          courseName: courseLabel,
          selectedWeek: selectedWeek || 'W1',
          students,
        }),
      })
        .then(r => (r.ok ? r.json() : null))
        .then((resData: { course?: CourseProfile } | null) => {
          if (resData?.course) {
            const saved = normalizeCourses([resData.course])[0];
            setCourses(prev => [...prev.filter(c => c.id !== saved.id), saved]);
          }
        })
        .catch(() => { /* ignore */ });
    }
  }, [apiFetch, persistCourseToServer, selectedWeek]);

  const handleUpdateKnownStudents = useCallback((students: PreRegisteredStudent[]) => {
    setKnownStudents(students);
    syncKnownStudentsToCloud(students);
  }, [syncKnownStudentsToCloud]);

  const handleDeleteHistoryItem = useCallback((timestamp: number, studentId: string) => {
    setTeacherHistory(prev => prev.filter(h => !(h.timestamp === timestamp && h.studentId === studentId)));
    void apiFetch(`/api/history/item?timestamp=${encodeURIComponent(timestamp)}&studentId=${encodeURIComponent(studentId)}`, {
      method: 'DELETE',
    }).catch(() => { /* ignore */ });
  }, [apiFetch]);

  const handleClearTeacherHistory = useCallback(() => {
    setTeacherHistory([]);
    void apiFetch('/api/history', { method: 'DELETE' }).catch(() => { /* ignore */ });
  }, [apiFetch]);

  // Load course roster when viewing Student QR check-in or switching active course
  useEffect(() => {
    let cancelled = false;
    const loadRoster = async () => {
      const courseFilter = courseNameParam || activeCourse || '';
      const cidFilter = courseIdParam || coursesRef.current.find(c => c.courseName.trim().toUpperCase() === courseFilter.trim().toUpperCase())?.id || '';
      if (!courseFilter && !cidFilter) return;

      // If authenticated and already have course students locally, use them immediately while verifying server
      if (isAuthenticated && courseFilter) {
        const localCourse = coursesRef.current.find(c => c.courseName.trim().toUpperCase() === courseFilter.trim().toUpperCase());
        if (localCourse && Array.isArray(localCourse.students) && localCourse.students.length > 0) {
          setKnownStudents(localCourse.students);
        }
      }

      try {
        const params = new URLSearchParams();
        if (courseFilter) params.set('course', courseFilter);
        if (cidFilter) params.set('courseId', cidFilter);
        const res = await fetch(`/api/student/roster?${params.toString()}`, { cache: 'no-store' });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled && Array.isArray(data?.students) && data.students.length > 0) {
          setKnownStudents(data.students);
        }
      } catch { /* ignore */ }
    };
    void loadRoster();
    return () => { cancelled = true; };
  }, [isAuthenticated, courseNameParam, courseIdParam, activeCourse]);

  const formatCloudPayload = useCallback((r: Student) => {
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
  }, [selectedWeek]);

  const syncToAirtable = useCallback(async (records: Record<string, Student>) => {
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
  }, [formatCloudPayload, integrationType]);

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
    if (view !== 'teacher' || !isAuthenticated || !authTokenRef.current) return;
    try {
      const res = await apiFetch(`/api/attendance/live?course=${encodeURIComponent(activeCourse || '')}`, {
        cache: 'no-store',
      });
      if (!res.ok) return;
      const data = await res.json();
      const liveStudents: Student[] = Array.isArray(data?.students) ? data.students : [];
      setAttendanceList(liveStudents);
      if (liveStudents.length > 0) {
        setTeacherHistory(prev => {
          const combined = [...liveStudents, ...prev];
          return combined
            .filter((item, index, self) => index === self.findIndex(t => t.studentId === item.studentId && t.timestamp === item.timestamp))
            .sort((a, b) => b.timestamp - a.timestamp);
        });
      }
    } catch {
      console.warn('Polling failed');
    }
  }, [view, isAuthenticated, activeCourse, apiFetch]);

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

  const sendTestAdminEmail = useCallback(async (targetEmail?: string): Promise<{ success: boolean; message: string }> => {
    try {
      const res = await apiFetch('/api/admin/test-email', {
        method: 'POST',
        body: JSON.stringify({ targetEmail, publicAppUrl: getPublicAppUrl() }),
      });
      const data = await res.json();
      return { success: Boolean(data?.success), message: data?.message || 'Test failed.' };
    } catch {
      return { success: false, message: 'Network error reaching server.' };
    }
  }, [apiFetch]);

  useEffect(() => {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then((regs) => {
        regs.forEach((reg) => {
          void reg.update().catch(() => { /* ignore */ });
        });
      }).catch(() => { /* ignore */ });
    }
  }, []);

  const handleLogin = async (usernameOrEmail: string, password: string): Promise<{ success: boolean; message?: string }> => {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify({ usernameOrEmail, password }),
      });
      const data = await readJsonSafe<{
        success?: boolean;
        message?: string;
        token?: string;
        user?: AppUser;
        session?: AdminSessionActivity;
      }>(res);

      if (!data) {
        if (isDevPreviewOrigin()) {
          return {
            success: false,
            message: 'This preview link requires your developer Google login. On mobile, please open the Shared App URL (ais-pre-...) instead.',
          };
        }
        if (res.status === 405) {
          return {
            success: false,
            message: 'Sign-in API returned HTTP 405 (static-only host). Please redeploy the latest update or open the live full-stack Shared App URL.',
          };
        }
        return {
          success: false,
          message: `Sign-in server returned an unexpected response (HTTP ${res.status}). Please refresh and try again.`,
        };
      }

      if (!res.ok || !data?.success || !data?.token || !data?.user) {
        return { success: false, message: data?.message || 'Invalid User Name / Email or Password.' };
      }

      hasInitializedUserPrefRef.current = false;
      courseEditedAtRef.current = 0;
      authTokenRef.current = data.token;
      setAuthToken(data.token);
      setIsAuthenticated(true);
      setCurrentAdminName(data.user.username);
      setCurrentUserId(data.user.id);
      setCurrentUserRole(data.user.role === 'admin' ? 'admin' : 'lecturer');
      if (data.session?.id) {
        setActiveSessionId(data.session.id);
      }
      localStorage.setItem(AUTH_KEY, 'true');
      localStorage.setItem(AUTH_TOKEN_KEY, data.token);
      setView('teacher');
      if (data.session) {
        setAdminSessions(prev => [data.session!, ...prev]);
      }
      return { success: true };
    } catch {
      if (isDevPreviewOrigin()) {
        return {
          success: false,
          message: 'Mobile sign-in is blocked on the ais-dev preview URL. Please open the Shared App URL (ais-pre-...) on mobile.',
        };
      }
      return { success: false, message: 'Network error while signing in. Please check your connection and try again.' };
    }
  };

  const handleSignUp = async (
    username: string,
    email: string,
    password: string
  ): Promise<{ success: boolean; message: string }> => {
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify({
          username,
          email,
          password,
          publicAppUrl: getPublicAppUrl(),
        }),
      });
      const data = await readJsonSafe<{ success?: boolean; message?: string }>(res);
      if (!data) {
        return {
          success: false,
          message: isDevPreviewOrigin()
            ? 'Please open the Shared App URL (ais-pre-...) to register on mobile.'
            : `Registration server returned an unexpected response (HTTP ${res.status}).`,
        };
      }
      return {
        success: Boolean(data?.success),
        message: data?.message || 'Registration failed.',
      };
    } catch {
      return { success: false, message: 'Network error during sign up.' };
    }
  };

  const handleRequestAccountDeletion = async (params: {
    usernameOrEmail: string;
    reason: string;
  }): Promise<{ success: boolean; message: string }> => {
    try {
      const res = await fetch('/api/auth/delete-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify(params),
      });
      const data = await readJsonSafe<{ success?: boolean; message?: string }>(res);
      if (!data) {
        return {
          success: false,
          message: `Server returned an unexpected response (HTTP ${res.status}).`,
        };
      }
      return {
        success: Boolean(data?.success),
        message: data?.message || 'Could not submit deletion request.',
      };
    } catch {
      return { success: false, message: 'Network error submitting deletion request.' };
    }
  };

  // Admin Control Center Actions
  const handleDeleteUser = useCallback(async (userId: string) => {
    const targetUser = registeredUsers.find(u => u.id === userId);
    if (!targetUser || targetUser.role === 'admin' || targetUser.username.toLowerCase() === 'admin') return;
    setRegisteredUsers(prev => prev.filter(u => u.id !== userId));
    await apiFetch(`/api/admin/users/${encodeURIComponent(userId)}`, { method: 'DELETE' }).catch(() => { /* ignore */ });
  }, [apiFetch, registeredUsers]);

  const handleActivateUser = useCallback(async (userId: string) => {
    const now = Date.now();
    setRegisteredUsers(prev =>
      prev.map(u => (u.id === userId ? { ...u, status: 'active', activatedAt: now } : u))
    );
    await apiFetch(`/api/admin/users/${encodeURIComponent(userId)}/activate`, { method: 'POST' }).catch(() => { /* ignore */ });
  }, [apiFetch]);

  const handleResendActivationEmail = useCallback(async (user: AppUser): Promise<{ sent: boolean; activationUrl: string }> => {
    try {
      const res = await apiFetch(`/api/admin/users/${encodeURIComponent(user.id)}/resend-activation`, {
        method: 'POST',
        body: JSON.stringify({ publicAppUrl: getPublicAppUrl() }),
      });
      const data = await res.json();
      return {
        sent: Boolean(data?.sent),
        activationUrl: data?.activationUrl || `${getPublicAppUrl()}?user=${encodeURIComponent(user.id)}`,
      };
    } catch {
      return { sent: false, activationUrl: `${getPublicAppUrl()}?user=${encodeURIComponent(user.id)}` };
    }
  }, [apiFetch]);

  const handleRevokeSession = useCallback(async (sessionId: string) => {
    const now = Date.now();
    setAdminSessions(prev =>
      prev.map(s => (s.id === sessionId ? { ...s, status: 'signed_out', lastActiveTime: now } : s))
    );
    await apiFetch(`/api/admin/sessions/${encodeURIComponent(sessionId)}/revoke`, { method: 'POST' }).catch(() => { /* ignore */ });
  }, [apiFetch]);

  const handleClearInactiveSessions = useCallback(async () => {
    const staleThreshold = Date.now() - 2 * 60 * 1000;
    setAdminSessions(prev => prev.filter(s => s.status === 'active' && (s.lastActiveTime || 0) >= staleThreshold));
    await apiFetch('/api/admin/sessions/inactive', { method: 'DELETE' }).catch(() => { /* ignore */ });
  }, [apiFetch]);

  const handleMarkNotificationRead = useCallback(async (notifId: string) => {
    setAdminNotifications(prev => prev.map(n => (n.id === notifId ? { ...n, read: true } : n)));
    await apiFetch(`/api/admin/notifications/${encodeURIComponent(notifId)}/read`, { method: 'PATCH' }).catch(() => { /* ignore */ });
  }, [apiFetch]);

  const handleMarkAllNotificationsRead = useCallback(async () => {
    setAdminNotifications(prev => prev.map(n => ({ ...n, read: true })));
    await apiFetch('/api/admin/notifications/read-all', { method: 'POST' }).catch(() => { /* ignore */ });
  }, [apiFetch]);

  const handleClearNotifications = useCallback(async () => {
    setAdminNotifications([]);
    await apiFetch('/api/admin/notifications', { method: 'DELETE' }).catch(() => { /* ignore */ });
  }, [apiFetch]);

  const handleNewSession = useCallback(async () => {
    setAttendanceList([]);
    await apiFetch(`/api/attendance/session?course=${encodeURIComponent(activeCourse || '')}`, {
      method: 'DELETE',
    }).catch(() => { /* ignore */ });
  }, [activeCourse, apiFetch]);

  const handleEnterKiosk = useCallback(() => {
    setIsKioskMode(true);
    setView('student');
  }, []);

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
    checkAndClearForNewDay();

    const targetWeek = week || selectedWeek || 'W1';

    if (requireRegistered) {
      if (status === 'P' && attendanceList.some(s => s.studentId === studentId && s.status === 'P')) {
        return { success: false, message: 'Attendance already recorded for this student ID.' };
      }
      try {
        const res = await fetch('/api/student/checkin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            studentId,
            email,
            status,
            courseName,
            courseId: courseIdParam || '',
            week: targetWeek,
          }),
        });
        const data = await res.json();
        if (!res.ok || !data?.success) {
          return { success: false, message: data?.message || 'Submission failed.' };
        }
        const savedRecord: Student = data.record || {
          name,
          studentId,
          email,
          status,
          timestamp: overrideTimestamp || Date.now(),
          courseName,
          week: targetWeek,
        };
        setAttendanceList(prev => [{ ...savedRecord }, ...prev.filter(s => s.studentId !== studentId)]);
        setTeacherHistory(prev =>
          [savedRecord, ...prev.filter(t => !(t.studentId === savedRecord.studentId && t.timestamp === savedRecord.timestamp))]
        );
        if (integrationType === 'airtable') {
          await syncToAirtable({ [studentId]: savedRecord });
        }
        localStorage.setItem(LAST_SCAN_DATE_KEY, new Date().toISOString().slice(0, 10));
        return { success: true, message: data.message || 'Record submitted successfully.' };
      } catch {
        return { success: false, message: 'Connection lost. Please try again.' };
      }
    }

    if (status === 'P' && attendanceList.some(s => s.studentId === studentId && s.status === 'P')) {
      return { success: false, message: 'Attendance already recorded for this student ID.' };
    }

    try {
      const res = await apiFetch('/api/attendance/manual', {
        method: 'POST',
        body: JSON.stringify({
          name,
          studentId,
          email,
          status,
          courseName,
          overrideTimestamp,
          absenceReason,
          week: targetWeek,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        return { success: false, message: data?.message || 'Failed to record attendance.' };
      }
      const studentData: Student = data.record || {
        name,
        studentId,
        email,
        status,
        timestamp: overrideTimestamp || Date.now(),
        courseName,
        absenceReason,
        week: targetWeek,
      };
      setAttendanceList(prev => [{ ...studentData }, ...prev.filter(s => s.studentId !== studentId)]);
      setTeacherHistory(prev =>
        [studentData, ...prev.filter(t => !(t.studentId === studentData.studentId && t.timestamp === studentData.timestamp))]
      );

      if (integrationType === 'airtable') {
        await syncToAirtable({ [studentId]: studentData });
      }

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

      localStorage.setItem(LAST_SCAN_DATE_KEY, new Date().toISOString().slice(0, 10));
      return { success: true, message: data.message || 'Record submitted successfully.' };
    } catch {
      return { success: false, message: 'Connection lost. Please try again.' };
    }
  };

  const onRemoveStudents = async (ids: string[], courseName: string) => {
    setAttendanceList(prev => prev.filter(s => !ids.includes(s.studentId)));
    const now = Date.now();
    const removals: Student[] = ids.map(id => {
      const student = attendanceList.find(s => s.studentId === id) || knownStudents.find(k => k.id === id);
      return {
        studentId: id,
        name: student?.name || 'Unknown',
        email: `${id}@student.edu.my`,
        status: 'A',
        timestamp: now,
        courseName,
        absenceReason: 'Lecturer Override',
        week: selectedWeek || 'W1',
      };
    });

    if (removals.length > 0) {
      setTeacherHistory(prev => [...removals, ...prev]);
    }

    await apiFetch('/api/attendance/remove', {
      method: 'POST',
      body: JSON.stringify({ removals, courseName }),
    }).catch(() => { /* ignore */ });

    if (integrationType === 'airtable') {
      const airtableMap: Record<string, Student> = {};
      removals.forEach(r => { airtableMap[r.studentId] = r; });
      await syncToAirtable(airtableMap);
    }
  };

  const onBulkStatusUpdate = async (ids: string[], status: string, courseName: string, absenceReason?: string) => {
    setAttendanceList(prev => prev.map(s => (ids.includes(s.studentId) ? { ...s, status, absenceReason, week: selectedWeek } : s)));
    const now = Date.now();
    const records: Student[] = [];
    const updatePayload: Record<string, Student> = {};

    for (const id of ids) {
      const student = attendanceList.find(s => s.studentId === id);
      if (student) {
        const updateData: Student = {
          ...student,
          status,
          timestamp: now,
          courseName,
          absenceReason,
          week: selectedWeek || 'W1',
        };
        records.push(updateData);
        updatePayload[id] = updateData;
      }
    }

    if (records.length > 0) {
      setTeacherHistory(prev => [...records, ...prev]);
      await apiFetch('/api/attendance/bulk', {
        method: 'POST',
        body: JSON.stringify({ records, courseName, week: selectedWeek || 'W1' }),
      }).catch(() => { /* ignore */ });
      if (integrationType === 'airtable') {
        await syncToAirtable(updatePayload);
      }
    }
  };

  const handleUpdateMatrixCell = useCallback(async (params: {
    studentId: string;
    name: string;
    courseName: string;
    week: string;
    status: 'P' | 'A';
    absenceReason?: string;
  }): Promise<{ success: boolean; message?: string }> => {
    try {
      const isCurrentWeek =
        params.week.toUpperCase() === (selectedWeek || 'W1').toUpperCase() &&
        params.courseName.trim().toUpperCase() === activeCourseRef.current.trim().toUpperCase();
      const res = await apiFetch('/api/attendance/matrix-cell', {
        method: 'PUT',
        body: JSON.stringify({
          ...params,
          updateLiveSession: isCurrentWeek,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success || !data?.record) {
        return { success: false, message: data?.error || 'Failed to update week record.' };
      }
      const saved = data.record as Student;
      setTeacherHistory(prev => [saved, ...prev]);
      if (isCurrentWeek) {
        setAttendanceList(prev => [{ ...saved }, ...prev.filter(s => s.studentId !== saved.studentId)]);
      }
      if (integrationType === 'airtable') {
        await syncToAirtable({ [saved.studentId]: saved });
      }
      return { success: true };
    } catch {
      return { success: false, message: 'Network error updating matrix cell.' };
    }
  }, [apiFetch, integrationType, selectedWeek, syncToAirtable]);

  const handleSendTestRecord = async (courseName: string): Promise<{ success: boolean; message: string }> => {
    try {
      const res = await apiFetch('/api/queue/test', {
        method: 'POST',
        body: JSON.stringify({
          courseName: courseName || 'Connectivity Test',
          week: selectedWeek || 'W1',
        }),
      });
      const data = await res.json();
      if (integrationType === 'airtable' && data?.success) {
        const testRecord: Student = {
          name: 'CONNECTION TEST',
          studentId: 'TEST999',
          email: 'test@student.edu.my',
          status: 'P',
          timestamp: Date.now(),
          courseName: courseName || 'Connectivity Test',
          absenceReason: '',
          week: selectedWeek || 'W1',
        };
        await syncToAirtable({ TEST999: testRecord });
      }
      return { success: Boolean(data?.success), message: data?.message || 'Cloud test failed.' };
    } catch {
      return { success: false, message: 'Cloud test failed.' };
    }
  };

  const handleCheckPendingRecords = async (): Promise<{ success: boolean; message: string; count: number }> => {
    try {
      const res = await apiFetch('/api/queue', { cache: 'no-store' });
      const data = await res.json();
      return {
        success: Boolean(data?.success),
        message: data?.message || 'Status check failed.',
        count: typeof data?.count === 'number' ? data.count : 0,
      };
    } catch {
      return { success: false, message: 'Status check failed.', count: 0 };
    }
  };

  const handleClearPendingQueue = async (): Promise<{ success: boolean; message: string }> => {
    try {
      const res = await apiFetch('/api/queue', { method: 'DELETE' });
      const data = await res.json();
      return { success: Boolean(data?.success), message: data?.message || 'Failed to clear queue.' };
    } catch {
      return { success: false, message: 'Failed to clear queue.' };
    }
  };

  const handleForceSync = async (): Promise<{ success: boolean; message: string; syncedCount: number; errorCount: number; total: number }> => {
    try {
      const res = await apiFetch('/api/queue/sync', {
        method: 'POST',
        body: JSON.stringify({ week: selectedWeek }),
      });
      const data = await res.json();
      if (integrationType === 'airtable' && Array.isArray(data?.records) && data.records.length > 0) {
        const map: Record<string, Student> = {};
        for (const rec of data.records as Student[]) {
          map[rec.studentId] = rec;
        }
        await syncToAirtable(map);
        return {
          success: true,
          message: 'Synced pending records to Airtable.',
          syncedCount: data.records.length,
          errorCount: 0,
          total: data.records.length,
        };
      }
      return {
        success: Boolean(data?.success),
        message: data?.message || 'Sync complete.',
        syncedCount: data?.syncedCount || 0,
        errorCount: data?.errorCount || 0,
        total: data?.total || 0,
      };
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
              onAssignCourseOwner={handleAssignCourseOwner}
              selectedWeek={selectedWeek}
              onWeekChange={handleWeekChange}
              currentAdminName={currentAdminName}
              currentUserRole={currentUserRole}
              integrationType={integrationType}
              onIntegrationTypeChange={handleIntegrationTypeChange}
              teacherHistory={teacherHistory}
              onUpdateMatrixCell={handleUpdateMatrixCell}
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
              onRequestAccountDeletion={handleRequestAccountDeletion}
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
              onSwitchToTeacher={() => {
                setIsKioskMode(false);
                setView('teacher');
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
