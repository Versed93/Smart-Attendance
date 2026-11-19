
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import type {
  Student,
  AppUser,
  AdminSessionActivity,
  AdminNotification,
  CollaboratorOption,
  CourseProfile,
  SheetTabCandidate,
  SheetTabOwnershipResult,
  SyncSheetCoursesResult,
  UserNotification,
} from '../types';
import type { PreRegisteredStudent } from '../studentList';
import QRCode from 'qrcode';
import { BrandLogoIcon } from './icons/BrandLogoIcon';
import { BellIcon } from './icons/BellIcon';
import { PencilSquareIcon } from './icons/PencilSquareIcon';
import { CameraIcon } from './icons/CameraIcon';
import { LockClosedIcon } from './icons/LockClosedIcon';
import { QrScanner } from './QrScanner';
import { QrCodeIcon } from './icons/QrCodeIcon';
import { AdjustmentsHorizontalIcon } from './icons/AdjustmentsHorizontalIcon';
import { MagnifyingGlassIcon } from './icons/MagnifyingGlassIcon';
import { XCircleIcon } from './icons/XCircleIcon';
import { CloudIntegrationSettings } from './CloudIntegrationSettings';
import { ArrowDownTrayIcon } from './icons/ArrowDownTrayIcon';
import { CheckIcon } from './icons/CheckIcon';
import { XMarkIcon } from './icons/XMarkIcon';
import { ExclamationTriangleIcon } from './icons/ExclamationTriangleIcon';
import { PlusIcon } from './icons/PlusIcon';
import { EyeIcon } from './icons/EyeIcon';
import { TrashIcon } from './icons/TrashIcon';
import { HistoryIcon } from './icons/HistoryIcon';
import { ListBulletIcon } from './icons/ListBulletIcon';
import { ChevronDownIcon } from './icons/ChevronDownIcon';
import { ClassroomDisplay } from './ClassroomDisplay';
import { PWAInstallButton } from './PWAInstallButton';
import {
  buildAttendanceQrUrl,
  buildStandaloneClassroomUrl,
  CLASSROOM_CHANNEL_NAME,
  getScreenDetailsSafe,
  isExtendedScreenReported,
  openExtendedClassroomWindow,
  pickExtendedScreen,
  prefetchGrantedScreenDetails,
  publishClassroomSyncState,
  requestAdaptiveFullscreen,
  type ClassroomSyncPayload,
  type ExtendedScreenInfo,
  type ScreenDetailsLike,
} from '../utils/classroomWindow';

interface TeacherViewProps {
  attendanceList: Student[];
  onRemoveStudents: (studentIds: string[], courseName: string) => void;
  onBulkStatusUpdate: (studentIds:string[], status: string, courseName: string, absenceReason?: string) => void;
  onNewSession: () => void;
  scriptUrl: string;
  onScriptUrlChange: (url: string) => void;
  onOpenKiosk: () => void;
  onManualAdd: (name: string, id: string, email: string, status: string, courseName: string, reason?: string) => Promise<{success: boolean, message: string}>;
  addStudent: (name: string, studentId: string, email: string, status: string, courseName: string, overrideTimestamp?: number, reason?: string) => Promise<{ success: boolean, message: string }>;
  onLogout: () => void;
  knownStudents: PreRegisteredStudent[];
  onSendTestRecord: (courseName: string) => Promise<{ success: boolean; message: string }>;
  onCheckPendingRecords: () => Promise<{ success: boolean; message: string; count: number }>;
  onClearPendingQueue: () => Promise<{ success: boolean; message: string }>;
  onForceSync: () => Promise<{ success: boolean; message: string; syncedCount: number; errorCount: number; total: number; }>;
  onUpdateKnownStudents: (students: PreRegisteredStudent[]) => void;
  courseName?: string;
  onCourseChange: (courseName: string) => void;
  courses?: CourseProfile[];
  onSelectCourse?: (course: CourseProfile) => void;
  onAddCourse?: (courseName: string, initialStudents?: PreRegisteredStudent[], ownerId?: string, sharedWith?: string[]) => CourseProfile | null;
  onDeleteCourse?: (courseId: string) => Promise<void> | void;
  onFetchSheetTabs?: (params?: { course?: string }) => Promise<{
    success: boolean;
    sheets?: SheetTabCandidate[];
    updatedCourses?: CourseProfile[];
    error?: string;
  }>;
  onCheckSheetTabOwnership?: (sheetTabs: SheetTabCandidate[]) => Promise<SheetTabOwnershipResult[]>;
  onSyncSheetCourses?: (
    sheetTabs: SheetTabCandidate[],
    options?: { allowUpdateExisting?: boolean }
  ) => Promise<SyncSheetCoursesResult> | void;
  onAssignCourseOwner?: (
    courseId: string,
    ownerId: string
  ) => Promise<{ success: boolean; course?: CourseProfile; error?: string } | void> | void;
  onUpdateCourseCoLecturers?: (
    courseId: string,
    sharedWith: string[]
  ) => Promise<{ success: boolean; course?: CourseProfile; error?: string } | void> | void;
  coLecturerOptions?: CollaboratorOption[];
  selectedWeek?: string;
  onWeekChange?: (week: string) => void;
  currentAdminName?: string;
  currentUserId?: string;
  currentUserRole?: 'admin' | 'lecturer';
  integrationType?: 'google_sheets' | 'airtable' | 'firebase';
  onIntegrationTypeChange?: (type: 'google_sheets' | 'airtable' | 'firebase') => void;
  firebaseDatabaseUrl?: string;
  teacherHistory?: Student[];
  onUpdateMatrixCell?: (params: {
    studentId: string;
    name: string;
    courseName: string;
    week: string;
    status: 'P' | 'A';
    absenceReason?: string;
  }) => Promise<{ success: boolean; message?: string }>;
  onDeleteHistoryItem?: (timestamp: number, studentId: string) => void;
  onClearTeacherHistory?: () => void;
  registeredUsers?: AppUser[];
  adminSessions?: AdminSessionActivity[];
  adminNotifications?: AdminNotification[];
  userNotifications?: UserNotification[];
  adminEmail?: string;
  onAdminEmailChange?: (email: string) => void;
  onDeleteUser?: (userId: string) => Promise<void> | void;
  onActivateUser?: (userId: string) => Promise<{
    success: boolean;
    emailSent?: boolean;
    email?: string;
    pin?: string;
    error?: string;
  } | void> | void;
  onResendActivationEmail?: (user: AppUser) => Promise<{
    sent: boolean;
    activationUrl: string;
    pin?: string;
    email?: string;
    error?: string;
  }>;
  onResetUserPassword?: (params: {
    userId: string;
    newPassword: string;
    activateAccount?: boolean;
  }) => Promise<{ success: boolean; error?: string }>;
  onRevokeSession?: (sessionId: string) => Promise<void> | void;
  onClearInactiveSessions?: () => Promise<void> | void;
  onMarkNotificationRead?: (notifId: string) => Promise<void> | void;
  onMarkAllNotificationsRead?: () => Promise<void> | void;
  onClearNotifications?: () => Promise<void> | void;
  onMarkUserNotificationRead?: (notifId: string) => Promise<void> | void;
  onMarkAllUserNotificationsRead?: () => Promise<void> | void;
  onClearUserNotifications?: () => Promise<void> | void;
  onSendTestAdminEmail?: (targetEmail?: string) => Promise<{ success: boolean; message: string }>;
  onRequestAccountDeletion?: (params: { usernameOrEmail: string; reason: string }) => Promise<{ success: boolean; message: string }>;
  onIssueQrToken?: (params: {
    courseName: string;
    courseId?: string;
    week: string;
    requirePin?: boolean;
    rotatePin?: boolean;
  }) => Promise<{
    success: boolean;
    qrToken?: string;
    iat?: number;
    exp?: number;
    pinRequired?: boolean;
    pin?: string;
  }>;
}

const WEEKS = Array.from({ length: 14 }, (_, i) => `W${i + 1}`);

export const TeacherView: React.FC<TeacherViewProps> = ({ 
  attendanceList, 
  onRemoveStudents,
  onBulkStatusUpdate,
  onNewSession,
  scriptUrl,
  onScriptUrlChange,
  onOpenKiosk, 
  onManualAdd,
  addStudent,
  onLogout,
  knownStudents,
  onSendTestRecord,
  onCheckPendingRecords,
  onClearPendingQueue,
  onForceSync,
  onUpdateKnownStudents,
  courseName: propCourseName,
  onCourseChange,
  courses = [],
  onSelectCourse,
  onAddCourse,
  onDeleteCourse,
  onFetchSheetTabs,
  onCheckSheetTabOwnership,
  onSyncSheetCourses,
  onAssignCourseOwner,
  onUpdateCourseCoLecturers,
  coLecturerOptions = [],
  selectedWeek = 'W1',
  onWeekChange,
  currentAdminName = 'admin',
  currentUserId = '',
  currentUserRole,
  integrationType = 'google_sheets',
  onIntegrationTypeChange,
  firebaseDatabaseUrl,
  teacherHistory = [],
  onUpdateMatrixCell,
  onDeleteHistoryItem,
  onClearTeacherHistory,
  registeredUsers = [],
  adminSessions = [],
  adminNotifications = [],
  userNotifications = [],
  adminEmail = '',
  onAdminEmailChange,
  onDeleteUser,
  onActivateUser,
  onResendActivationEmail,
  onResetUserPassword,
  onRevokeSession,
  onClearInactiveSessions,
  onMarkNotificationRead,
  onMarkAllNotificationsRead,
  onClearNotifications,
  onMarkUserNotificationRead,
  onMarkAllUserNotificationsRead,
  onClearUserNotifications,
  onSendTestAdminEmail,
  onRequestAccountDeletion,
  onIssueQrToken,
}) => {
  const isAdmin = currentUserRole === 'admin' || currentAdminName?.toLowerCase() === 'admin';
  const [baseUrl] = useState<string>(() => window.location.origin + window.location.pathname);
  const [qrData, setQrData] = useState<string>('');
  const courseName = propCourseName ?? '';
  const setCourseName = (valOrUpdater: string | ((prev: string) => string)) => {
    const next = typeof valOrUpdater === 'function' ? valOrUpdater(courseName) : valOrUpdater;
    onCourseChange(next);
  };
  const [showSettingsModal, setShowSettingsModal] = useState<boolean>(false);
  const [showUserNotificationsModal, setShowUserNotificationsModal] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<'teacher' | 'classroom'>('teacher');
  const [isExtendedClassroomOpen, setIsExtendedClassroomOpen] = useState(false);
  const [extendedScreenInfo, setExtendedScreenInfo] = useState<ExtendedScreenInfo | null>(null);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(() =>
    typeof document !== 'undefined' ? Boolean(document.fullscreenElement) : false
  );
  const [isOfflineMode, setIsOfflineMode] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [scanResult, setScanResult] = useState<{ type: 'success' | 'error' | 'duplicate', message: string} | null>(null);
  const [isGeoEnabled, setIsGeoEnabled] = useState(false);
  const [teacherLocation, setTeacherLocation] = useState<{lat: number, lng: number} | null>(null);
  const [locationStatus, setLocationStatus] = useState<'idle' | 'fetching' | 'success' | 'error' | 'denied'>('idle');
  const [showManualModal, setShowManualModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'attendance' | 'matrix' | 'history'>('attendance');
  const [matrixFilterMode, setMatrixFilterMode] = useState<'all' | 'below80'>('all');
  const [editingMatrixCell, setEditingMatrixCell] = useState<{
    studentId: string;
    name: string;
    week: string;
    currentStatus: string;
    reason: string;
  } | null>(null);
  const [isSavingMatrixCell, setIsSavingMatrixCell] = useState(false);
  const [adminPanelTab, setAdminPanelTab] = useState<'activity' | 'users' | 'notifications'>('activity');
  const [adminEmailInput, setAdminEmailInput] = useState(adminEmail);
  const [isTestingAdminEmail, setIsTestingAdminEmail] = useState(false);
  const [adminEmailTestStatus, setAdminEmailTestStatus] = useState<{ success: boolean; message: string } | null>(null);
  const [approvingUserId, setApprovingUserId] = useState<string | null>(null);
  const [deleteReason, setDeleteReason] = useState('Signed up by mistake');
  const [customDeleteReason, setCustomDeleteReason] = useState('');
  const [isSubmittingDeleteRequest, setIsSubmittingDeleteRequest] = useState(false);
  const [deleteRequestFeedback, setDeleteRequestFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [manualId, setManualId] = useState('');
  const [manualName, setManualName] = useState('');
  const [manualStatus, setManualStatus] = useState('P');
  const [manualReason, setManualReason] = useState('');
  const [manualError, setManualError] = useState('');
  const [manualSuggestionField, setManualSuggestionField] = useState<'id' | 'name' | null>(null);
  const manualAutoFillRef = useRef<{ id?: string; name?: string }>({});
  const [isQrLoading, setIsQrLoading] = useState(true);
  const qrErrorCorrection = (localStorage.getItem('qr-error-correction') as 'L' | 'M' | 'Q' | 'H') || 'M';
  const qrMargin = parseInt(localStorage.getItem('qr-margin') || '2', 10);
  const [pinRequired, setPinRequired] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return localStorage.getItem('smart-attendance-pin-required') !== 'false';
  });
  const [pinDisplayMode, setPinDisplayMode] = useState<'hidden' | 'flash' | 'visible'>('hidden');
  const [pinVisibleUntil, setPinVisibleUntil] = useState<number>(0);
  const [isUpdatingPin, setIsUpdatingPin] = useState(false);
  const [signedQrState, setSignedQrState] = useState<{
    qrToken: string;
    iat: number;
    exp: number;
    pinRequired: boolean;
    pin: string;
    configKey: string;
  } | null>(null);
  const signedQrRef = useRef<typeof signedQrState>(null);
  const [listSearchTerm, setListSearchTerm] = useState('');
  const [studentSortBy, setStudentSortBy] = useState<'id' | 'name' | 'status'>('id');
  const [attendanceFilterMode, setAttendanceFilterMode] = useState<'all' | 'present' | 'absent_unscanned' | 'not_scanned'>('all');
  const [markingStudentId, setMarkingStudentId] = useState<string | null>(null);
  const [editingLiveStudent, setEditingLiveStudent] = useState<{
    studentId: string;
    name: string;
    status: string;
    reason: string;
    isUnscanned: boolean;
  } | null>(null);
  const [isSavingLiveStudent, setIsSavingLiveStudent] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const [confirmation, setConfirmation] = useState<{
    action: 'P' | 'A' | null;
    targetIds: string[];
    label: string;
    count: number;
    reason?: string;
  }>({ action: null, targetIds: [], label: '', count: 0 });
  const [showNewSessionModal, setShowNewSessionModal] = useState(false);
  const [showStudentListModal, setShowStudentListModal] = useState(false);
  const [studentListFilter, setStudentListFilter] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [selectedStudentListIds, setSelectedStudentListIds] = useState<Set<string>>(new Set());
  const [showWeekPromptModal, setShowWeekPromptModal] = useState(true);
  const [isLoadingSheetCourse, setIsLoadingSheetCourse] = useState(false);
  const [sheetReadError, setSheetReadError] = useState<string | null>(null);
  const [sheetSyncModalItems, setSheetSyncModalItems] = useState<Array<{
    tab: SheetTabCandidate;
    status: SheetTabOwnershipResult['status'];
    alreadySynced?: boolean;
    ownerId?: string;
    ownerLabel?: string;
    sharedWith?: string[];
    sharedBy?: string;
    reason?: string;
  }> | null>(null);
  const [sheetSyncUpdatedNames, setSheetSyncUpdatedNames] = useState<string[]>([]);
  const [selectedSyncCourseKeys, setSelectedSyncCourseKeys] = useState<Set<string>>(new Set());
  const [selectedSyncOwnerByCourse, setSelectedSyncOwnerByCourse] = useState<Record<string, string>>({});
  const [selectedSyncSharedByCourse, setSelectedSyncSharedByCourse] = useState<Record<string, string[]>>({});
  const [isConfirmingSheetSync, setIsConfirmingSheetSync] = useState(false);
  const [showAddCourseModal, setShowAddCourseModal] = useState(false);
  const [newCourseNameInput, setNewCourseNameInput] = useState('');
  const [newCourseOwnerId, setNewCourseOwnerId] = useState('');
  const [newCourseSharedWith, setNewCourseSharedWith] = useState<string[]>([]);
  const [newCourseStudents, setNewCourseStudents] = useState<PreRegisteredStudent[]>([]);
  const [newCourseUploadFileName, setNewCourseUploadFileName] = useState('');
  const [newCourseUploadError, setNewCourseUploadError] = useState<string | null>(null);
  const [editingCoLecturersCourse, setEditingCoLecturersCourse] = useState<{
    course: CourseProfile;
    selectedIds: string[];
  } | null>(null);
  const [isSavingCoLecturers, setIsSavingCoLecturers] = useState(false);
  const [subjectFilter, setSubjectFilter] = useState('');
  const [subjectScope, setSubjectScope] = useState<'all' | 'mine'>('all');
  const [historyScope, setHistoryScope] = useState<'course' | 'all'>('course');

  const collaboratorPool = useMemo<CollaboratorOption[]>(() => {
    if (coLecturerOptions.length > 0) return coLecturerOptions;
    return registeredUsers
      .filter((u) => u.status === 'active')
      .map((u) => ({ id: u.id, username: u.username, role: u.role }));
  }, [coLecturerOptions, registeredUsers]);
  const [pendingDeleteAction, setPendingDeleteAction] = useState<
    | { type: 'single'; id: string; name: string }
    | { type: 'bulk'; count: number }
    | { type: 'clear-list' }
    | { type: 'clear-history' }
    | { type: 'delete-user'; id: string; username: string; email?: string }
    | { type: 'delete-course'; id: string; courseName: string }
    | null
  >(null);
  const [resetPasswordModal, setResetPasswordModal] = useState<{
    user: AppUser;
    newPassword: string;
    activateAccount: boolean;
    isSaving: boolean;
    error?: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const addCourseFileInputRef = useRef<HTMLInputElement>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastConfigRef = useRef('');
  const extendedWindowRef = useRef<Window | null>(null);
  const screenDetailsRef = useRef<ScreenDetailsLike | null>(null);
  
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void prefetchGrantedScreenDetails().then((details) => {
      if (cancelled || !details) return;
      screenDetailsRef.current = details;
      setExtendedScreenInfo(pickExtendedScreen(details));
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    setAdminEmailInput(adminEmail);
  }, [adminEmail]);

  const normalizeSheetStudents = (rawList: unknown): PreRegisteredStudent[] => {
      if (!Array.isArray(rawList)) return [];
      const seen = new Set<string>();
      const cleaned: PreRegisteredStudent[] = [];
      for (const item of rawList) {
          const rec = item as { id?: unknown; name?: unknown } | null;
          const id = String(rec?.id || '').trim().toUpperCase();
          const name = String(rec?.name || '').trim().toUpperCase();
          if (id && name && !seen.has(id)) {
              seen.add(id);
              cleaned.push({ id, name });
          }
      }
      return cleaned;
  };

  const parseValidCourseSheets = (
      data: {
          sheets?: Array<{
              sheetName?: string;
              courseName?: string;
              owner?: string;
              ownerExplicit?: boolean;
              students?: unknown;
          }>;
      }
  ): SheetTabCandidate[] => {
      if (!Array.isArray(data?.sheets)) return [];
      const seenCourses = new Set<string>();
      const valid: SheetTabCandidate[] = [];
      for (const s of data.sheets) {
          if (!s) continue;
          const cleanCourse = String(s.courseName || '').trim();
          if (!cleanCourse) continue;
          const key = cleanCourse.replace(/\s+/g, ' ').trim().toUpperCase();
          if (seenCourses.has(key)) continue;
          seenCourses.add(key);
          valid.push({
              sheetName: String(s.sheetName || ''),
              courseName: cleanCourse,
              owner: typeof s.owner === 'string' ? s.owner.trim() : '',
              ownerExplicit: Boolean(s.ownerExplicit),
              students: normalizeSheetStudents(s.students),
          });
      }
      return valid;
  };

  const resolveLocalTabOwnershipFallback = useCallback(
      (tabs: SheetTabCandidate[]): SheetTabOwnershipResult[] => {
          const norm = (n: string) => n.replace(/\s+/g, ' ').trim().toUpperCase();
          return tabs.map((tab) => {
              const key = norm(tab.courseName);
              const matched = courses.find((c) => norm(c.courseName) === key);
              if (matched) {
                  return {
                      courseName: tab.courseName,
                      status: 'mine',
                      alreadySynced: true,
                      ownerId: matched.ownerId,
                      ownerLabel: matched.createdBy || currentAdminName || 'You',
                  };
              }
              return { courseName: tab.courseName, status: 'unclaimed', alreadySynced: false };
          });
      },
      [courses, currentAdminName]
  );

  const fetchCourseFromB1 = async (manual = false, mode: 'select-tabs' | 'active-only' = manual ? 'select-tabs' : 'active-only') => {
      if (integrationType !== 'google_sheets') {
          const msg = 'Configure Google Sheets Apps Script URL in Settings first.';
          setSheetReadError(msg);
          if (manual) showToast('error', msg);
          return;
      }
      if (isAdmin && scriptUrl.trim().endsWith('/dev')) {
          const msg = 'Apps Script URL uses /dev. Deploy as Web App and paste the /exec URL in Settings.';
          setSheetReadError(msg);
          if (manual) showToast('error', msg);
          return;
      }
      if (!onFetchSheetTabs) {
          const msg = 'Sheet sync service is unavailable. Please refresh the page.';
          setSheetReadError(msg);
          if (manual) showToast('error', msg);
          return;
      }
      setIsLoadingSheetCourse(true);
      setSheetReadError(null);
      try {
          const data = await onFetchSheetTabs(
              mode === 'active-only' && courseName ? { course: courseName } : undefined
          );
          if (!data || !data.success) {
              const msg = data?.error || 'Could not read Course Name from Google Sheet. Re-deploy updated Apps Script.';
              setSheetReadError(msg);
              if (manual) showToast('error', msg);
              return;
          }

          const validCourseSheets = parseValidCourseSheets(data);
          const autoUpdatedNames = (data.updatedCourses || []).map((c) => c.courseName).filter(Boolean);
          setSheetReadError(null);

          // Automatic background refresh: NEVER import other tabs or change active subject; only refresh current owned course roster.
          if (!manual) {
              const targetUpper = courseName.replace(/\s+/g, ' ').trim().toUpperCase();
              if (!targetUpper) return;
              const ownsCurrent = courses.some((c) => c.courseName.replace(/\s+/g, ' ').trim().toUpperCase() === targetUpper);
              if (!ownsCurrent) return;
              const matchedSheet = validCourseSheets.find((s) => s.courseName.replace(/\s+/g, ' ').trim().toUpperCase() === targetUpper);
              if (matchedSheet && autoUpdatedNames.length === 0) {
                  onUpdateKnownStudents(matchedSheet.students);
              }
              return;
          }

          const effectiveMode: 'select-tabs' | 'active-only' =
              mode === 'active-only' && !courseName.trim() ? 'select-tabs' : mode;

          if (effectiveMode === 'active-only') {
              const targetUpper = courseName.replace(/\s+/g, ' ').trim().toUpperCase();
              const matchedSheet = validCourseSheets.find((s) => s.courseName.replace(/\s+/g, ' ').trim().toUpperCase() === targetUpper);
              if (!matchedSheet) {
                  showToast('error', `No Google Sheet tab found for "${courseName}". Use "Sync Sheet Tabs" to choose from available tabs.`);
                  return;
              }
              const ownershipList = onCheckSheetTabOwnership
                  ? await onCheckSheetTabOwnership([matchedSheet])
                  : resolveLocalTabOwnershipFallback([matchedSheet]);
              const ownership = ownershipList[0];
              if (ownership?.status === 'other') {
                  showToast('error', `Cannot sync "${matchedSheet.courseName}": ${ownership.reason || 'Owned by another lecturer'}.`);
                  return;
              }
              const result = await onSyncSheetCourses?.([matchedSheet], { allowUpdateExisting: true });
              if (result && result.skippedCourses.length > 0 && result.courses.length === 0) {
                  showToast('error', `Skipped "${matchedSheet.courseName}": ${result.skippedCourses[0].reason}.`);
                  return;
              }
              if (!result || result.courses.length === 0) {
                  onUpdateKnownStudents(matchedSheet.students);
              }
              const count = matchedSheet.students.length;
              showToast('success', `Synced "${matchedSheet.courseName}" (${count} ${count === 1 ? 'student' : 'students'} from Sheet).`);
              return;
          }

          // Select-tabs mode: verify ownership for each tab and show the picker modal instead of auto-importing all tabs
          if (validCourseSheets.length === 0) {
              const msg = 'No tabs with a Course Name in cell B1 were found on the Google Sheet.';
              setSheetReadError(msg);
              showToast('error', msg);
              return;
          }

          const ownershipList = onCheckSheetTabOwnership
              ? await onCheckSheetTabOwnership(validCourseSheets)
              : resolveLocalTabOwnershipFallback(validCourseSheets);
          const ownershipMap = new Map<string, SheetTabOwnershipResult>();
          const normKey = (name: string) => name.replace(/\s+/g, ' ').trim().toUpperCase();
          ownershipList.forEach((item) => ownershipMap.set(normKey(item.courseName), item));

          const pickerItems = validCourseSheets.map((tab) => {
              const ownership = ownershipMap.get(normKey(tab.courseName));
              const locallyExists = courses.some((c) => normKey(c.courseName) === normKey(tab.courseName));
              return {
                  tab,
                  status: ownership?.status || (locallyExists ? 'mine' : 'unclaimed'),
                  alreadySynced: ownership?.alreadySynced ?? locallyExists,
                  ownerId: ownership?.ownerId,
                  ownerLabel: ownership?.ownerLabel,
                  sharedWith: ownership?.sharedWith,
                  sharedBy: ownership?.sharedBy,
                  reason: ownership?.reason,
              };
          });

          const preselected = new Set<string>();
          const initialOwners: Record<string, string> = {};
          const initialShared: Record<string, string[]> = {};
          const fallbackAdminOwner =
              currentUserId ||
              collaboratorPool.find((u) => u.role === 'admin' || u.username.toLowerCase() === (currentAdminName || 'admin').toLowerCase())?.id ||
              '';
          pickerItems.forEach((item) => {
              const key = normKey(item.tab.courseName);
              if (!item.alreadySynced && item.status === 'assigned_to_me') {
                  preselected.add(key);
              }
              const ownerIdForTab = item.ownerId || fallbackAdminOwner;
              initialOwners[key] = ownerIdForTab;
              initialShared[key] = (item.sharedWith || []).filter((id) => id !== ownerIdForTab);
          });

          setSelectedSyncOwnerByCourse(initialOwners);
          setSelectedSyncSharedByCourse(initialShared);
          setSelectedSyncCourseKeys(preselected);
          setSheetSyncUpdatedNames(autoUpdatedNames);
          setSheetSyncModalItems(pickerItems);
      } catch {
          const msg = 'Could not read Google Sheet. Check Apps Script URL in Settings (must be /exec with access = Anyone).';
          setSheetReadError(msg);
          if (manual) {
              showToast('error', msg);
          }
      } finally {
          setIsLoadingSheetCourse(false);
      }
  };

  const handleConfirmSheetSync = async () => {
      if (!sheetSyncModalItems || isConfirmingSheetSync) return;
      const normKey = (name: string) => name.replace(/\s+/g, ' ').trim().toUpperCase();
      const chosenTabs = sheetSyncModalItems
          .filter((item) => !item.alreadySynced && item.status !== 'other' && selectedSyncCourseKeys.has(normKey(item.tab.courseName)))
          .map((item) => {
              const key = normKey(item.tab.courseName);
              if (!isAdmin) return item.tab;
              const assignedOwnerId = selectedSyncOwnerByCourse[key];
              const assignedShared = (selectedSyncSharedByCourse[key] || []).filter((id) => id !== assignedOwnerId);
              return {
                  ...item.tab,
                  ownerId: assignedOwnerId || item.tab.ownerId,
                  sharedWith: assignedShared,
              };
          });

      if (chosenTabs.length === 0) {
          showToast('error', 'Select at least one new subject tab to sync.');
          return;
      }

      setIsConfirmingSheetSync(true);
      try {
          const result = await onSyncSheetCourses?.(chosenTabs, { allowUpdateExisting: false });
          const syncedCourses = result?.courses || [];
          const skippedCourses = result?.skippedCourses || [];

          const activeUpper = normKey(courseName);
          const syncedActiveCourse = activeUpper
              ? syncedCourses.find((c) => normKey(c.courseName) === activeUpper)
              : undefined;

          if (syncedActiveCourse) {
              onUpdateKnownStudents(syncedActiveCourse.students || []);
          } else if (!activeUpper && syncedCourses.length > 0) {
              const firstSynced = syncedCourses[0];
              setCourseName(firstSynced.courseName);
              onUpdateKnownStudents(firstSynced.students || []);
          }

          if (skippedCourses.length > 0 && syncedCourses.length === 0) {
              showToast('error', `Could not sync selected tab(s): ${skippedCourses[0].reason}.`);
          } else if (skippedCourses.length > 0) {
              showToast(
                  'success',
                  `Synced ${syncedCourses.length} new subject${syncedCourses.length === 1 ? '' : 's'}; skipped ${skippedCourses.length} already synced or owned by another lecturer.`
              );
          } else {
              const count = syncedCourses.length;
              showToast('success', `Synced ${count} new subject${count === 1 ? '' : 's'} from Google Sheet.`);
          }
          setSheetSyncModalItems(null);
      } finally {
          setIsConfirmingSheetSync(false);
      }
  };

  const handleScanResult = (data: string) => {
      setShowScanner(false);
      try {
        const studentData = JSON.parse(data) as {
          name?: unknown;
          studentId?: unknown;
          email?: unknown;
          timestamp?: unknown;
        } | null;
        const cleanName = typeof studentData?.name === 'string' ? studentData.name.trim() : '';
        const cleanId = typeof studentData?.studentId === 'string' ? studentData.studentId.trim().replace(/\s+/g, '').toUpperCase() : '';
        const cleanEmail = typeof studentData?.email === 'string' ? studentData.email.trim() : '';
        const rawTimestamp = typeof studentData?.timestamp === 'number' && Number.isFinite(studentData.timestamp) ? studentData.timestamp : undefined;

        if (!studentData || typeof studentData !== 'object' || !cleanName || !cleanId) {
          setScanResult({ type: 'error', message: 'Invalid student QR code (missing Name or Student ID).' });
          setTimeout(() => setScanResult(null), 2500);
          return;
        }

        if (knownStudents.length > 0) {
          const isRegistered = knownStudents.some(
            (s) => s.id.trim().replace(/\s+/g, '').toUpperCase() === cleanId
          );
          if (!isRegistered) {
            setScanResult({
              type: 'error',
              message: `Student ID "${cleanId}" is not registered in this subject roster.`,
            });
            setTimeout(() => setScanResult(null), 3000);
            return;
          }
        }

        addStudent(cleanName, cleanId, cleanEmail, 'P', courseName, rawTimestamp)
            .then(result => {
                if (result.success) setScanResult({ type: 'success', message: `${cleanName} checked-in! Thank you.` });
                else setScanResult({ type: 'duplicate', message: result.message });
            });
      } catch { setScanResult({ type: 'error', message: 'Invalid QR format.' }); }
      setTimeout(() => setScanResult(null), 2500);
  };
  
  const issueSignedQrToken = useCallback(
    async (options?: { nextRequirePin?: boolean; rotatePin?: boolean }) => {
      if (!onIssueQrToken) return null;
      const effectiveRequirePin = options?.nextRequirePin !== undefined ? options.nextRequirePin : pinRequired;
      const matchedCourse = courseName
        ? courses.find((c) => c.courseName.trim().toUpperCase() === courseName.trim().toUpperCase())
        : undefined;
      const configKey = `${courseName || 'General Session'}|${matchedCourse?.id || ''}|${selectedWeek || 'W1'}`;
      const res = await onIssueQrToken({
        courseName: courseName || 'General Session',
        courseId: matchedCourse?.id,
        week: selectedWeek || 'W1',
        requirePin: effectiveRequirePin,
        rotatePin: Boolean(options?.rotatePin),
      });
      if (res?.success && res.qrToken && res.iat && res.exp) {
        const nextState = {
          qrToken: res.qrToken,
          iat: res.iat,
          exp: res.exp,
          pinRequired: Boolean(res.pinRequired),
          pin: res.pin || '',
          configKey,
        };
        signedQrRef.current = nextState;
        setSignedQrState(nextState);
        return nextState;
      }
      return null;
    },
    [onIssueQrToken, courseName, courses, selectedWeek, pinRequired]
  );

  useEffect(() => {
    if (pinDisplayMode !== 'flash' || !pinVisibleUntil) return;
    const remainingMs = pinVisibleUntil - Date.now();
    if (remainingMs <= 0) {
      setPinDisplayMode('hidden');
      setPinVisibleUntil(0);
      return;
    }
    const timeout = setTimeout(() => {
      setPinDisplayMode('hidden');
      setPinVisibleUntil(0);
    }, remainingMs);
    return () => clearTimeout(timeout);
  }, [pinDisplayMode, pinVisibleUntil]);

  useEffect(() => {
    let cancelled = false;
    const refreshToken = async () => {
      const next = await issueSignedQrToken();
      if (cancelled || !next) return;
    };
    void refreshToken();
    const interval = setInterval(() => {
      void refreshToken();
    }, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [issueSignedQrToken]);

  useEffect(() => {
    const matchedCourse = courseName
      ? courses.find((c) => c.courseName.trim().toUpperCase() === courseName.trim().toUpperCase())
      : undefined;
    const currentConfigKey = `${courseName || 'General Session'}|${matchedCourse?.id || ''}|${selectedWeek || 'W1'}`;
    const configString = `${courseName}-${selectedWeek}-${isOfflineMode}-${isGeoEnabled}-${teacherLocation?.lat}-${teacherLocation?.lng}-${pinRequired}`;
    if (configString !== lastConfigRef.current) {
      setIsQrLoading(true);
      lastConfigRef.current = configString;
    }

    const activeSigned =
      signedQrState && signedQrState.configKey === currentConfigKey ? signedQrState : null;

    if (!activeSigned && onIssueQrToken && !isOfflineMode) {
      return;
    }

    setQrData(
      buildAttendanceQrUrl({
        baseUrl,
        selectedWeek,
        courseName,
        courseId: matchedCourse?.id,
        isOfflineMode,
        isGeoEnabled,
        teacherLocation,
        qrToken: activeSigned?.qrToken,
        qrTokenIat: activeSigned?.iat,
        pinRequired,
      })
    );
  }, [
    baseUrl,
    courseName,
    courses,
    selectedWeek,
    isGeoEnabled,
    teacherLocation,
    isOfflineMode,
    pinRequired,
    signedQrState,
    onIssueQrToken,
  ]);

  useEffect(() => {
    if (canvasRef.current && qrData) {
      QRCode.toCanvas(canvasRef.current, qrData, { 
          width: 320,
          margin: qrMargin, 
          errorCorrectionLevel: qrErrorCorrection.toLowerCase() as 'low' | 'medium' | 'quartile' | 'high',
      }, (err) => {
        if (err) console.error(err);
        setIsQrLoading(false);
      });
    }
  }, [qrData, qrErrorCorrection, qrMargin]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [courseName]);

  const liveStudentNormIds = useMemo(() => {
    const set = new Set<string>();
    for (const s of attendanceList) {
      const nid = (s.studentId || '').trim().replace(/\s+/g, '').toUpperCase();
      if (nid) set.add(nid);
    }
    return set;
  }, [attendanceList]);

  const unscannedStudents = useMemo(() => {
    const seen = new Set<string>();
    const list: Array<{
      studentId: string;
      name: string;
      status: 'UNSCANNED';
      timestamp?: number;
      absenceReason?: string;
      isUnscanned: true;
    }> = [];
    for (const k of knownStudents) {
      const nid = (k.id || '').trim().replace(/\s+/g, '').toUpperCase();
      if (!nid || seen.has(nid) || liveStudentNormIds.has(nid)) continue;
      seen.add(nid);
      list.push({
        studentId: nid,
        name: (k.name || nid).trim(),
        status: 'UNSCANNED',
        isUnscanned: true,
      });
    }
    return list;
  }, [knownStudents, liveStudentNormIds]);

  const stats = useMemo(() => {
    const present = attendanceList.filter(s => s.status.toUpperCase() === 'P').length;
    const absent = attendanceList.filter(s => s.status.toUpperCase() === 'A').length;
    const excused = attendanceList.filter(s => ['M', 'E'].includes(s.status.toUpperCase())).length;
    const notScanned = unscannedStudents.length;
    const recordedCount = attendanceList.length;
    const total = knownStudents.length > 0 ? recordedCount + notScanned : recordedCount;
    const pct = total > 0 ? Math.round((present / total) * 100) : 0;
    return { present, absent, excused, notScanned, recordedCount, total, pct };
  }, [attendanceList, knownStudents.length, unscannedStudents.length]);

  const cycleStudentSort = () => {
    setStudentSortBy((prev) => (prev === 'id' ? 'name' : prev === 'name' ? 'status' : 'id'));
  };

  const getStatusSortRank = (status: string) => {
    const s = status.trim().toUpperCase();
    if (s === 'P') return 0;
    if (s === 'M' || s === 'E') return 1;
    if (s === 'A') return 2;
    if (s === 'UNSCANNED') return 3;
    return 1;
  };

  const sortStudentRecords = useCallback((records: Student[]) => {
    return [...records].sort((a, b) => {
      if (studentSortBy === 'id') {
        const idCmp = a.studentId.localeCompare(b.studentId, undefined, { numeric: true, sensitivity: 'base' });
        return idCmp !== 0 ? idCmp : a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      }
      if (studentSortBy === 'name') {
        const nameCmp = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        return nameCmp !== 0
          ? nameCmp
          : a.studentId.localeCompare(b.studentId, undefined, { numeric: true, sensitivity: 'base' });
      }
      const statusCmp = getStatusSortRank(a.status) - getStatusSortRank(b.status);
      if (statusCmp !== 0) return statusCmp;
      const rawStatusCmp = a.status.localeCompare(b.status, undefined, { sensitivity: 'base' });
      return rawStatusCmp !== 0
        ? rawStatusCmp
        : a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
  }, [studentSortBy]);

  const allLiveRows = useMemo(() => {
    const recorded = attendanceList.map((s) => ({
      studentId: s.studentId,
      name: s.name,
      status: (s.status || 'P').trim().toUpperCase(),
      timestamp: s.timestamp,
      absenceReason: s.absenceReason,
      isUnscanned: false as const,
    }));
    return [...recorded, ...unscannedStudents];
  }, [attendanceList, unscannedStudents]);

  const filteredLiveRows = useMemo(() => {
    const q = listSearchTerm.trim().toLowerCase();
    const filtered = allLiveRows.filter((row) => {
      if (attendanceFilterMode === 'present' && row.status !== 'P') return false;
      if (attendanceFilterMode === 'absent_unscanned' && row.status === 'P') return false;
      if (attendanceFilterMode === 'not_scanned' && !row.isUnscanned) return false;
      if (!q) return true;
      return row.name.toLowerCase().includes(q) || row.studentId.toLowerCase().includes(q);
    });

    return [...filtered].sort((a, b) => {
      if (studentSortBy === 'id') {
        const idCmp = a.studentId.localeCompare(b.studentId, undefined, { numeric: true, sensitivity: 'base' });
        return idCmp !== 0 ? idCmp : a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      }
      if (studentSortBy === 'name') {
        const nameCmp = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        return nameCmp !== 0
          ? nameCmp
          : a.studentId.localeCompare(b.studentId, undefined, { numeric: true, sensitivity: 'base' });
      }
      const statusCmp = getStatusSortRank(a.status) - getStatusSortRank(b.status);
      if (statusCmp !== 0) return statusCmp;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
  }, [allLiveRows, attendanceFilterMode, listSearchTerm, studentSortBy]);

  const filteredHistory = useMemo(() => {
    const filtered = teacherHistory.filter(s => {
      const matchesCourse = historyScope === 'all' || !courseName.trim()
        ? true
        : (s.courseName || '').trim().toUpperCase() === courseName.trim().toUpperCase();
      if (!matchesCourse) return false;
      return s.name.toLowerCase().includes(listSearchTerm.toLowerCase()) || s.studentId.toLowerCase().includes(listSearchTerm.toLowerCase());
    });
    return sortStudentRecords(filtered);
  }, [teacherHistory, listSearchTerm, sortStudentRecords, historyScope, courseName]);

  const matrixData = useMemo(() => {
    const targetCourseUpper = (courseName || 'General Session').trim().toUpperCase();
    const studentMap = new Map<string, { studentId: string; name: string }>();

    knownStudents.forEach((s) => {
      const id = s.id.trim().toUpperCase();
      if (id && !studentMap.has(id)) {
        studentMap.set(id, { studentId: id, name: s.name.trim().toUpperCase() });
      }
    });

    const courseRecords: Student[] = [];
    const considerRecord = (r: Student) => {
      const rCourse = (r.courseName || 'General Session').trim().toUpperCase();
      if (courseName.trim() && rCourse !== targetCourseUpper) return;
      courseRecords.push(r);
      const id = (r.studentId || '').trim().toUpperCase();
      if (id && !studentMap.has(id)) {
        studentMap.set(id, { studentId: id, name: (r.name || id).trim().toUpperCase() });
      }
    };

    teacherHistory.forEach(considerRecord);
    attendanceList.forEach(considerRecord);

    const cellLookup = new Map<string, { status: string; timestamp: number; absenceReason?: string }>();
    const recordedWeeksSet = new Set<string>();

    for (const r of courseRecords) {
      const id = (r.studentId || '').trim().toUpperCase();
      const week = (r.week || 'W1').trim().toUpperCase();
      if (!id || !/^W([1-9]|1[0-4])$/.test(week)) continue;
      recordedWeeksSet.add(week);
      const cellKey = `${id}__${week}`;
      const existing = cellLookup.get(cellKey);
      if (!existing || r.timestamp >= existing.timestamp) {
        cellLookup.set(cellKey, {
          status: (r.status || 'P').trim().toUpperCase(),
          timestamp: r.timestamp,
          absenceReason: r.absenceReason,
        });
      }
    }

    const totalWeeksRecorded = recordedWeeksSet.size;
    const allRows = Array.from(studentMap.values()).map((stu) => {
      const weeks: Record<string, { status: string; timestamp: number; absenceReason?: string } | undefined> = {};
      let presentCount = 0;
      let absentCount = 0;
      let studentMarkedWeeks = 0;

      for (const w of WEEKS) {
        const cell = cellLookup.get(`${stu.studentId}__${w}`);
        weeks[w] = cell;
        if (cell) {
          studentMarkedWeeks += 1;
          if (cell.status === 'P') presentCount += 1;
          else if (cell.status === 'A') absentCount += 1;
        }
      }

      const denominator = Math.max(totalWeeksRecorded, studentMarkedWeeks);
      const attendancePct = denominator > 0 ? Math.round((presentCount / denominator) * 100) : null;

      return {
        studentId: stu.studentId,
        name: stu.name,
        weeks,
        presentCount,
        absentCount,
        denominator,
        attendancePct,
      };
    });

    const below80Count = allRows.filter((r) => r.attendancePct !== null && r.attendancePct < 80).length;
    const pctRows = allRows.filter((r) => r.attendancePct !== null);
    const averagePct =
      pctRows.length > 0
        ? Math.round(pctRows.reduce((acc, r) => acc + (r.attendancePct || 0), 0) / pctRows.length)
        : null;

    const query = listSearchTerm.trim().toLowerCase();
    const visibleRows = allRows
      .filter((r) => {
        if (matrixFilterMode === 'below80' && !(r.attendancePct !== null && r.attendancePct < 80)) {
          return false;
        }
        if (!query) return true;
        return r.name.toLowerCase().includes(query) || r.studentId.toLowerCase().includes(query);
      })
      .sort((a, b) => {
        if (studentSortBy === 'id') {
          return a.studentId.localeCompare(b.studentId, undefined, { numeric: true, sensitivity: 'base' });
        }
        if (studentSortBy === 'name') {
          return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        }
        const aPct = a.attendancePct ?? 101;
        const bPct = b.attendancePct ?? 101;
        if (aPct !== bPct) return aPct - bPct;
        return a.studentId.localeCompare(b.studentId, undefined, { numeric: true, sensitivity: 'base' });
      });

    return {
      totalStudents: allRows.length,
      totalWeeksRecorded,
      recordedWeeksSet,
      below80Count,
      averagePct,
      rows: visibleRows,
    };
  }, [attendanceList, courseName, knownStudents, listSearchTerm, matrixFilterMode, studentSortBy, teacherHistory]);

  const handleExportCSV = () => {
    const safeCourseSlug = (courseName || 'session').toLowerCase().replace(/\s+/g, '_');

    if (activeTab === 'matrix') {
      if (matrixData.rows.length === 0) {
        showToast('error', 'No matrix records to export.');
        return;
      }
      const headers = ['Student ID', 'Name', 'Course Name', ...WEEKS, 'Present', 'Weeks Conducted', 'Attendance %'];
      const rows = [headers.join(',')];
      const courseEscaped = `"${(courseName || 'General Session').replace(/"/g, '""')}"`;
      matrixData.rows.forEach((row) => {
        const nameEscaped = `"${row.name.replace(/"/g, '""')}"`;
        const weekCells = WEEKS.map((w) => row.weeks[w]?.status || '-');
        const pctVal = row.attendancePct !== null ? `${row.attendancePct}%` : '-';
        rows.push([row.studentId, nameEscaped, courseEscaped, ...weekCells, row.presentCount, row.denominator, pctVal].join(','));
      });
      const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `attendance_matrix_w1_w14_${safeCourseSlug}.csv`;
      link.click();
      return;
    }

    if (activeTab === 'history') {
      if (filteredHistory.length === 0) {
        showToast('error', 'No data to export.');
        return;
      }
      const headers = ['Student ID', 'Name', 'Course Name', 'Week', 'Date', 'Status', 'Reason', 'Time'];
      const rows = [headers.join(',')];
      filteredHistory.forEach((s) => {
        const ts = new Date(s.timestamp);
        const name = `"${s.name.replace(/"/g, '""')}"`;
        const reason = `"${(s.absenceReason || '').replace(/"/g, '""')}"`;
        const course = `"${(s.courseName || courseName || 'General Session').replace(/"/g, '""')}"`;
        const weekVal = s.week || selectedWeek;
        rows.push([s.studentId, name, course, weekVal, ts.toLocaleDateString(), s.status, reason, ts.toLocaleTimeString()].join(','));
      });
      const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `attendance_history_${safeCourseSlug}.csv`;
      link.click();
      return;
    }

    if (filteredLiveRows.length === 0) {
      showToast('error', 'No data to export.');
      return;
    }
    const headers = ['Student ID', 'Name', 'Course Name', 'Week', 'Date', 'Status', 'Reason', 'Time'];
    const rows = [headers.join(',')];
    const todayStr = new Date().toLocaleDateString();
    filteredLiveRows.forEach((r) => {
      const name = `"${r.name.replace(/"/g, '""')}"`;
      const reason = `"${(r.absenceReason || '').replace(/"/g, '""')}"`;
      const course = `"${(courseName || 'General Session').replace(/"/g, '""')}"`;
      const statusLabel = r.status === 'UNSCANNED' ? 'NOT SCANNED' : r.status;
      const dateStr = r.timestamp ? new Date(r.timestamp).toLocaleDateString() : todayStr;
      const timeStr = r.timestamp ? new Date(r.timestamp).toLocaleTimeString() : '-';
      rows.push([r.studentId, name, course, selectedWeek, dateStr, statusLabel, reason, timeStr].join(','));
    });
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `attendance_${safeCourseSlug}.csv`;
    link.click();
  };

  const handleMarkAll = (status: 'P' | 'A') => {
    if (filteredLiveRows.length === 0) return;
    setConfirmation({
      action: status,
      targetIds: filteredLiveRows.map(s => s.studentId),
      label: `Update ${filteredLiveRows.length} Visible Student${filteredLiveRows.length === 1 ? '' : 's'}`,
      count: filteredLiveRows.length,
      reason: status === 'A' ? 'Bulk update' : '',
    });
  };

  const handleMarkUnscannedAbsent = () => {
    if (unscannedStudents.length === 0) return;
    setConfirmation({
      action: 'A',
      targetIds: unscannedStudents.map(s => s.studentId),
      label: `Mark ${unscannedStudents.length} Unscanned Student${unscannedStudents.length === 1 ? '' : 's'} Absent`,
      count: unscannedStudents.length,
      reason: 'Did not scan',
    });
  };

  const handleQuickMarkLiveStudent = async (
    row: { studentId: string; name: string; status: string; isUnscanned: boolean },
    targetStatus: 'P' | 'A' | 'M' | 'E',
    reason?: string
  ) => {
    if (markingStudentId) return;
    setMarkingStudentId(row.studentId);
    try {
      const effectiveCourse = courseName || 'General Session';
      const email = `${row.studentId}@student.edu.my`;
      const result = await onManualAdd(row.name, row.studentId, email, targetStatus, effectiveCourse, reason);
      if (result.success) {
        const label =
          targetStatus === 'P' ? 'Present' : targetStatus === 'A' ? 'Absent' : targetStatus === 'M' ? 'Medical' : 'Exempt';
        showToast('success', `Marked ${row.studentId} as ${label}.`);
      } else {
        showToast('error', result.message || 'Failed to update student status.');
      }
    } finally {
      setMarkingStudentId(null);
    }
  };
  
  const handleNewSession = () => {
    onNewSession();
    setCourseName('');
    setShowNewSessionModal(false);
  };

  const handleDownloadTemplate = () => {
    const headers = ["StudentID", "Name"];
    const rows = [headers.join(',')];
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "student_list_template.csv";
    link.click();
  };

  const showToast = (type: 'success' | 'error' | 'duplicate', message: string) => {
    setScanResult({ type, message });
    setTimeout(() => setScanResult(null), 2500);
  };

  const handleClearKnownStudents = () => {
    setPendingDeleteAction({ type: 'clear-list' });
  };

  const handleClearTeacherHistory = () => {
    setPendingDeleteAction({ type: 'clear-history' });
  };

  const handleDeleteHistoryItem = (timestamp: number, studentId: string) => {
      onDeleteHistoryItem?.(timestamp, studentId);
      showToast('success', 'History record deleted.');
  };

  const handleDeleteKnownStudent = (id: string, name: string) => {
      setPendingDeleteAction({ type: 'single', id, name });
  };

  const handleBulkDeleteKnownStudents = () => {
      if (selectedStudentListIds.size === 0) return;
      setPendingDeleteAction({ type: 'bulk', count: selectedStudentListIds.size });
  };

  const executePendingDeleteAction = () => {
      if (!pendingDeleteAction) return;
      if (pendingDeleteAction.type === 'single') {
          const newList = knownStudents.filter(s => s.id !== pendingDeleteAction.id);
          onUpdateKnownStudents(newList);
          setSelectedStudentListIds(prev => {
              const next = new Set(prev);
              next.delete(pendingDeleteAction.id);
              return next;
          });
          showToast('success', `Removed ${pendingDeleteAction.id} from Student List.`);
      } else if (pendingDeleteAction.type === 'bulk') {
          const count = selectedStudentListIds.size;
          const newList = knownStudents.filter(s => !selectedStudentListIds.has(s.id));
          onUpdateKnownStudents(newList);
          setSelectedStudentListIds(new Set());
          showToast('success', `Removed ${count} student(s) from Student List.`);
      } else if (pendingDeleteAction.type === 'clear-list') {
          onUpdateKnownStudents([]);
          setSelectedStudentListIds(new Set());
          showToast('success', 'Student list cleared.');
      } else if (pendingDeleteAction.type === 'clear-history') {
          onClearTeacherHistory?.();
          showToast('success', 'Scan history cleared.');
      } else if (pendingDeleteAction.type === 'delete-user') {
          void onDeleteUser?.(pendingDeleteAction.id);
          showToast('success', `Removed user account "${pendingDeleteAction.username}".`);
      } else if (pendingDeleteAction.type === 'delete-course') {
          void onDeleteCourse?.(pendingDeleteAction.id);
          showToast('success', `Removed course tab "${pendingDeleteAction.courseName}".`);
      }
      setPendingDeleteAction(null);
  };

  const toggleGroup = (groupKey: string) => {
      const newSet = new Set(collapsedGroups);
      if (newSet.has(groupKey)) newSet.delete(groupKey);
      else newSet.add(groupKey);
      setCollapsedGroups(newSet);
  };

  const toggleAllGroups = (allKeys: string[]) => {
      if (collapsedGroups.size === allKeys.length) {
          setCollapsedGroups(new Set());
      } else {
          setCollapsedGroups(new Set(allKeys));
      }
  };

  const parseStudentCsvText = (rawText: string): PreRegisteredStudent[] => {
    const cleanText = rawText.replace(/^\uFEFF/, '');
    const lines = cleanText.split(/\r?\n/).filter(line => line.trim() !== '');
    if (lines.length === 0) return [];

    const parseCsvLine = (line: string, delimiter: string = ',') => {
      const parts: string[] = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (current === '' && char === ' ' && !inQuotes) continue;
        if (char === '"' && line[i + 1] === '"') {
          current += '"';
          i++;
        } else if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === delimiter && !inQuotes) {
          parts.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      parts.push(current.trim());
      return parts;
    };

    const headerLine = lines[0].toLowerCase();
    const delimiter = headerLine.includes('\t') ? '\t' : (headerLine.includes(';') ? ';' : ',');
    const headerParts = parseCsvLine(headerLine, delimiter);

    let idIndex = headerParts.findIndex(h => h === 'id' || h === 'student id' || h === 'studentid' || h === 'matrik' || h === 'matric');
    if (idIndex === -1) {
      idIndex = headerParts.findIndex(h => h.includes('id') || h.includes('matrik') || h.includes('matric'));
    }
    if (idIndex === -1) {
      idIndex = headerParts.findIndex(h => h.includes('number') || h.includes('no.'));
    }

    let nameIndex = headerParts.findIndex(h => h === 'name' || h === 'student name' || h === 'nama');
    if (nameIndex === -1) {
      nameIndex = headerParts.findIndex(h => h.includes('name') || h.includes('nama') || h.includes('student'));
    }

    if (idIndex === -1 && nameIndex === -1) {
      const isFirstColSerial = lines.slice(0, 3).every(l => {
        const p = parseCsvLine(l, delimiter);
        return p.length > 0 && !isNaN(Number(p[0])) && p[0].length < 4;
      });

      if (isFirstColSerial && headerParts.length >= 3) {
        idIndex = 1;
        nameIndex = 2;
      } else if (headerParts.length >= 2) {
        const isCol1Number = !isNaN(Number(headerParts[1])) || /^[a-z0-9]+$/.test(headerParts[1].replace(/\s/g, ''));
        const isCol0Name = isNaN(Number(headerParts[0])) && headerParts[0].length > 4;

        if (isCol1Number && isCol0Name) {
          idIndex = 1;
          nameIndex = 0;
        } else {
          idIndex = 0;
          nameIndex = 1;
        }
      } else {
        idIndex = 0;
        nameIndex = 1;
      }
    } else {
      if (idIndex === -1) idIndex = 0;
      if (nameIndex === -1) nameIndex = 1;
    }

    const deduped = new Map<string, PreRegisteredStudent>();
    const hasHeaders = headerParts.some(h => h.includes('id') || h.includes('name') || h.includes('matrik'));
    const startIndex = hasHeaders ? 1 : 0;

    for (let i = startIndex; i < lines.length; i++) {
      const parts = parseCsvLine(lines[i], delimiter);
      if (parts.length > Math.max(idIndex, nameIndex)) {
        const id = parts[idIndex].trim().toUpperCase();
        const name = parts[nameIndex].trim().toUpperCase();
        if (id && name && id.length > 1 && id !== 'ID' && id !== 'STUDENT ID' && id !== 'STUDENTID' && id !== 'MATRIK' && id !== 'MATRIC' && id !== 'NO.') {
          deduped.set(id, { id, name });
        }
      }
    }

    return Array.from(deduped.values());
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (!text) return;

      const newStudents = parseStudentCsvText(text);
      if (newStudents.length > 0) {
        const mergedMap = new Map<string, PreRegisteredStudent>();
        knownStudents.forEach(s => mergedMap.set(s.id, s));
        newStudents.forEach(s => mergedMap.set(s.id, s));
        onUpdateKnownStudents(Array.from(mergedMap.values()));
        showToast('success', `Successfully imported ${newStudents.length} students.`);
      } else {
        showToast('error', 'No valid student records found. Check CSV columns.');
      }

      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    reader.readAsText(file);
  };

  const handleAddCourseFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (!text) return;

      const parsed = parseStudentCsvText(text);
      if (parsed.length > 0) {
        setNewCourseStudents(parsed);
        setNewCourseUploadFileName(file.name);
        setNewCourseUploadError(null);
      } else {
        setNewCourseStudents([]);
        setNewCourseUploadFileName('');
        setNewCourseUploadError('No valid student records found. Make sure your CSV follows StudentID, Name columns.');
      }

      if (addCourseFileInputRef.current) addCourseFileInputRef.current.value = '';
    };
    reader.readAsText(file);
  };

  const closeAddCourseModal = () => {
    setShowAddCourseModal(false);
    setNewCourseNameInput('');
    setNewCourseOwnerId('');
    setNewCourseSharedWith([]);
    setNewCourseStudents([]);
    setNewCourseUploadFileName('');
    setNewCourseUploadError(null);
    if (addCourseFileInputRef.current) addCourseFileInputRef.current.value = '';
  };

  const submitManualAdd = async () => {
      if (!manualId || !manualName) { setManualError('ID and Name required.'); return; }
      const result = await onManualAdd(manualName, manualId, `${manualId}@student.edu.my`, manualStatus, courseName, manualReason);
      if (result.success) { setShowManualModal(false); setManualId(''); setManualName(''); setManualError(''); } 
      else setManualError(result.message);
  };

  const normalizeStudentId = (val: string) => val.trim().replace(/\s+/g, '').toUpperCase();
  const normalizeStudentName = (val: string) => val.trim().replace(/\s+/g, ' ').toUpperCase();

  const manualIdSuggestions = useMemo(() => {
    const query = normalizeStudentId(manualId);
    if (manualSuggestionField !== 'id' || query.length < 2) return [];
    return knownStudents
      .filter((s) => {
        const sId = normalizeStudentId(s.id);
        return sId.includes(query) && sId !== query;
      })
      .slice(0, 5);
  }, [knownStudents, manualId, manualSuggestionField]);

  const manualNameSuggestions = useMemo(() => {
    const query = normalizeStudentName(manualName);
    if (manualSuggestionField !== 'name' || query.length < 2) return [];
    const tokens = query.split(' ').filter(Boolean);
    return knownStudents
      .filter((s) => {
        const sName = normalizeStudentName(s.name);
        if (sName === query && normalizeStudentId(s.id) === normalizeStudentId(manualId)) return false;
        return tokens.every((t) => sName.includes(t));
      })
      .slice(0, 5);
  }, [knownStudents, manualName, manualId, manualSuggestionField]);

  const selectManualSuggestedStudent = (student: PreRegisteredStudent) => {
    const cleanId = student.id.toUpperCase();
    const cleanName = student.name.toUpperCase();
    setManualId(cleanId);
    setManualName(cleanName);
    manualAutoFillRef.current = { id: cleanId, name: cleanName };
    setManualError('');
    setManualSuggestionField(null);
  };

  const handleManualIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = normalizeStudentId(e.target.value);
    setManualId(val);
    setManualSuggestionField(val.length >= 2 ? 'id' : null);

    const matched = knownStudents.find((s) => normalizeStudentId(s.id) === val);
    if (matched) {
      const cleanId = matched.id.toUpperCase();
      const cleanName = matched.name.toUpperCase();
      setManualId(cleanId);
      setManualName(cleanName);
      manualAutoFillRef.current = { id: cleanId, name: cleanName };
      setManualError('');
      setManualSuggestionField(null);
    } else {
      if (manualAutoFillRef.current.name && normalizeStudentName(manualName) === normalizeStudentName(manualAutoFillRef.current.name)) {
        setManualName('');
      }
      manualAutoFillRef.current = {};
    }
  };

  const handleManualNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawUpper = e.target.value.toUpperCase();
    setManualName(rawUpper);
    const norm = normalizeStudentName(rawUpper);
    setManualSuggestionField(norm.length >= 2 ? 'name' : null);

    const exactMatches = norm ? knownStudents.filter((s) => normalizeStudentName(s.name) === norm) : [];
    if (exactMatches.length === 1) {
      const matched = exactMatches[0];
      const cleanId = matched.id.toUpperCase();
      const cleanName = matched.name.toUpperCase();
      setManualId(cleanId);
      manualAutoFillRef.current = { id: cleanId, name: cleanName };
      setManualError('');
      setManualSuggestionField(null);
    } else {
      if (manualAutoFillRef.current.id && normalizeStudentId(manualId) === normalizeStudentId(manualAutoFillRef.current.id)) {
        setManualId('');
      }
      manualAutoFillRef.current = {};
    }
  };

  const requestCurrentPosition = (
    onSuccess: (pos: GeolocationPosition) => void,
    onFailure: (code: number, message: string) => void
  ) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      onFailure(0, 'Geolocation is not supported on this browser.');
      return;
    }

    const formatGeoFailure = (err: GeolocationPositionError): string => {
      const detail = err?.message ? ` (${err.message})` : '';
      if (err?.code === 1) {
        return `Location access denied${detail}. Allow location access in browser settings or open the app in a standalone tab.`;
      }
      if (err?.code === 3) {
        return 'Location request timed out. Ensure device GPS/Wi-Fi location is enabled and try again.';
      }
      return `Could not acquire location${detail}. Ensure device location services are enabled.`;
    };

    navigator.geolocation.getCurrentPosition(
      onSuccess,
      (err) => {
        // Retry with standard network/Wi-Fi accuracy if high-accuracy GPS is unavailable or timed out
        if (err && (err.code === 2 || err.code === 3)) {
          navigator.geolocation.getCurrentPosition(
            onSuccess,
            (fallbackErr) => onFailure(fallbackErr?.code ?? err.code, formatGeoFailure(fallbackErr || err)),
            { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
          );
          return;
        }
        onFailure(err?.code ?? 0, formatGeoFailure(err));
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
    );
  };

  const handleGeoToggle = (enabled: boolean) => {
    setIsGeoEnabled(enabled);
    if (enabled) {
        setLocationStatus('fetching');
        requestCurrentPosition(
            (pos) => {
                setTeacherLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
                setLocationStatus('success');
            },
            (code, msg) => {
                setIsGeoEnabled(false);
                setTeacherLocation(null);
                setLocationStatus(code === 1 ? 'denied' : 'error');
                showToast('error', msg);
            }
        );
    } else {
        setTeacherLocation(null);
        setLocationStatus('idle');
    }
  };

  const getStatusBadge = (status: string) => {
    const s = status.toUpperCase();
    if (s === 'P') return <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-green-100 text-green-800 border border-green-200">PRESENT</span>;
    if (s === 'A') return <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-red-100 text-red-800 border border-red-200">ABSENT</span>;
    if (s === 'M') return <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-amber-100 text-amber-800 border border-amber-200">MEDICAL</span>;
    if (s === 'E') return <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-indigo-100 text-indigo-800 border border-indigo-200">EXEMPT</span>;
    if (s === 'UNSCANNED') return <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-amber-50 text-amber-700 border border-amber-300">NOT SCANNED</span>;
    return <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-yellow-100 text-yellow-800 border border-yellow-200">{s}</span>;
  };

  const buildCurrentSyncPayload = useCallback(
    (overrides?: Partial<ClassroomSyncPayload>): ClassroomSyncPayload => {
      const matchedCourse = courseName
        ? courses.find((c) => c.courseName.trim().toUpperCase() === courseName.trim().toUpperCase())
        : undefined;
      return {
        active: true,
        geoPending: false,
        baseUrl,
        courseName,
        courseId: matchedCourse?.id,
        selectedWeek,
        isOfflineMode,
        isGeoEnabled,
        teacherLocation,
        qrErrorCorrection,
        qrMargin,
        qrToken: signedQrState?.qrToken,
        qrTokenIat: signedQrState?.iat,
        qrTokenExpiresAt: signedQrState?.exp,
        pinRequired,
        classroomPin: signedQrState?.pin || '',
        pinDisplayMode,
        pinVisibleUntil,
        updatedAt: Date.now(),
        ...overrides,
      };
    },
    [
      baseUrl,
      courseName,
      courses,
      selectedWeek,
      isOfflineMode,
      isGeoEnabled,
      teacherLocation,
      qrErrorCorrection,
      qrMargin,
      signedQrState,
      pinRequired,
      pinDisplayMode,
      pinVisibleUntil,
    ]
  );

  const handleTogglePinRequired = async () => {
    const next = !pinRequired;
    setPinRequired(next);
    try {
      localStorage.setItem('smart-attendance-pin-required', String(next));
    } catch {
      // ignore storage errors
    }
    if (!next) {
      setPinDisplayMode('hidden');
      setPinVisibleUntil(0);
    }
    setIsUpdatingPin(true);
    try {
      await issueSignedQrToken({ nextRequirePin: next });
      showToast('success', next ? 'Classroom PIN protection enabled.' : 'Classroom PIN protection turned off.');
    } finally {
      setIsUpdatingPin(false);
    }
  };

  const handleRotateClassroomPin = async () => {
    setIsUpdatingPin(true);
    try {
      const res = await issueSignedQrToken({ rotatePin: true });
      if (res?.pin) {
        showToast('success', `Generated new Classroom PIN: ${res.pin}`);
      } else {
        showToast('error', 'Could not generate a new Classroom PIN.');
      }
    } finally {
      setIsUpdatingPin(false);
    }
  };

  const handleFlashPinOnProjector = () => {
    if (!pinRequired) return;
    setPinDisplayMode('flash');
    setPinVisibleUntil(Date.now() + 10_000);
  };

  const handleTogglePinProjectorVisibility = () => {
    if (!pinRequired) return;
    setPinDisplayMode((prev) => (prev === 'visible' ? 'hidden' : 'visible'));
    setPinVisibleUntil(0);
  };

  const closeExtendedClassroom = useCallback(() => {
    publishClassroomSyncState(buildCurrentSyncPayload({ active: false }));
    try {
      if (extendedWindowRef.current && !extendedWindowRef.current.closed) {
        extendedWindowRef.current.close();
      }
    } catch {
      // Ignore cross-window close errors
    }
    extendedWindowRef.current = null;
    setIsExtendedClassroomOpen(false);
  }, [buildCurrentSyncPayload]);

  useEffect(() => {
    if (!isExtendedClassroomOpen) return;

    publishClassroomSyncState(
      buildCurrentSyncPayload({
        active: true,
        geoPending: false,
      })
    );

    const checkInterval = setInterval(() => {
      if (!extendedWindowRef.current || extendedWindowRef.current.closed) {
        extendedWindowRef.current = null;
        setIsExtendedClassroomOpen(false);
      }
    }, 1000);

    let channel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel(CLASSROOM_CHANNEL_NAME);
      channel.onmessage = (event: MessageEvent<{ type?: string }>) => {
        if (event?.data?.type === 'CLASSROOM_WINDOW_CLOSED') {
          extendedWindowRef.current = null;
          setIsExtendedClassroomOpen(false);
        }
      };
    }

    return () => {
      clearInterval(checkInterval);
      channel?.close();
    };
  }, [isExtendedClassroomOpen, buildCurrentSyncPayload]);

  const toggleClassroomView = async (mode: 'teacher' | 'classroom', preferredScreen?: ExtendedScreenInfo | null) => {
    setViewMode(mode);
    try {
      if (mode === 'classroom') {
        await requestAdaptiveFullscreen(preferredScreen);
      } else if (document.fullscreenElement && document.exitFullscreen) {
        await document.exitFullscreen();
      }
    } catch (err) {
      console.warn('Fullscreen API failed', err);
    }
  };

  const launchClassroomDisplay = (options: {
    geoEnabled: boolean;
    location: { lat: number; lng: number } | null;
    targetScreen?: ExtendedScreenInfo | null;
  }): 'extended_window' | 'in_page' => {
    const payload = buildCurrentSyncPayload({
      active: true,
      isGeoEnabled: options.geoEnabled,
      teacherLocation: options.location,
      geoPending: false,
    });

    const targetExtendedScreen =
      options.targetScreen !== undefined
        ? options.targetScreen
        : (extendedScreenInfo || pickExtendedScreen(screenDetailsRef.current));

    if (targetExtendedScreen) {
      publishClassroomSyncState(payload);
      if (extendedWindowRef.current && !extendedWindowRef.current.closed) {
        try {
          extendedWindowRef.current.focus();
        } catch { /* ignore */ }
        setIsExtendedClassroomOpen(true);
        setViewMode('teacher');
        return 'extended_window';
      }

      const classroomUrl = buildStandaloneClassroomUrl(payload);
      const popup = openExtendedClassroomWindow(classroomUrl, targetExtendedScreen);
      if (popup) {
        extendedWindowRef.current = popup;
        setIsExtendedClassroomOpen(true);
        setViewMode('teacher');
        showToast('success', 'Classroom View opened on your extended screen.');
        return 'extended_window';
      }

      // Fallback to in-page Classroom View in fullscreen (targeting extended screen if permitted)
      void toggleClassroomView('classroom', targetExtendedScreen);
      return 'in_page';
    }

    if (extendedWindowRef.current && !extendedWindowRef.current.closed) {
      closeExtendedClassroom();
    }
    void toggleClassroomView('classroom');
    return 'in_page';
  };

  const handleDirectLaunchClassroom = () => {
    // If geolocation is toggled on in Settings without cached coordinates yet, acquire silently in background
    if (isGeoEnabled && !teacherLocation) {
      setLocationStatus('fetching');
      requestCurrentPosition(
        (pos) => {
          setTeacherLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          setLocationStatus('success');
        },
        (code, msg) => {
          setIsGeoEnabled(false);
          setTeacherLocation(null);
          setLocationStatus(code === 1 ? 'denied' : 'error');
          showToast('error', msg);
        }
      );
    }

    const cachedExt = extendedScreenInfo || pickExtendedScreen(screenDetailsRef.current);
    if (cachedExt) {
      launchClassroomDisplay({
        geoEnabled: isGeoEnabled,
        location: teacherLocation,
        targetScreen: cachedExt,
      });
      return;
    }

    // If an extended display is reported and details weren't cached yet, resolve once before falling back
    if (isExtendedScreenReported() && !screenDetailsRef.current) {
      void getScreenDetailsSafe().then((details) => {
        if (details) {
          screenDetailsRef.current = details;
          const picked = pickExtendedScreen(details);
          setExtendedScreenInfo(picked);
          launchClassroomDisplay({
            geoEnabled: isGeoEnabled,
            location: teacherLocation,
            targetScreen: picked,
          });
        } else {
          launchClassroomDisplay({
            geoEnabled: isGeoEnabled,
            location: teacherLocation,
            targetScreen: null,
          });
        }
      });
      return;
    }

    // Single screen: enter fullscreen Classroom View synchronously on click without asking
    launchClassroomDisplay({
      geoEnabled: isGeoEnabled,
      location: teacherLocation,
      targetScreen: null,
    });
  };

  const unreadUserNotifications = userNotifications.filter((n) => !n.read);

  if (viewMode === 'classroom') {
    return (
      <ClassroomDisplay
        courseName={courseName}
        selectedWeek={selectedWeek}
        qrData={qrData}
        currentTime={currentTime}
        qrErrorCorrection={qrErrorCorrection}
        qrMargin={qrMargin}
        pinRequired={pinRequired}
        classroomPin={signedQrState?.pin || ''}
        pinDisplayMode={pinDisplayMode}
        pinVisibleUntil={pinVisibleUntil}
        onClose={() => void toggleClassroomView('teacher')}
        onToggleFullscreen={() => {
          if (document.fullscreenElement) {
            void document.exitFullscreen?.().catch(() => { /* ignore */ });
          } else {
            void requestAdaptiveFullscreen(extendedScreenInfo || pickExtendedScreen(screenDetailsRef.current));
          }
        }}
        isFullscreen={isFullscreen}
      />
    );
  }

  return (
    <div className="w-full max-w-[1600px] mx-auto p-1 sm:p-6 space-y-4 sm:space-y-6 pb-20 sm:pb-6 animate-in fade-in duration-500">
       <div className="relative z-10 flex flex-col xl:flex-row justify-between items-stretch xl:items-center bg-white p-4 rounded-2xl shadow-sm border border-gray-100 gap-3 sm:gap-4">
         <div className="flex items-center gap-3 sm:gap-4">
             <div className="flex items-center justify-center w-11 h-11 sm:w-12 sm:h-12 bg-gradient-to-br from-brand-primary to-brand-secondary text-white rounded-2xl shadow-lg shrink-0"><BrandLogoIcon className="w-6 h-6 sm:w-7 sm:h-7" /></div>
             <div className="min-w-0"><h1 className="text-lg sm:text-2xl font-black text-gray-900 tracking-tight leading-none truncate">SMART ATTENDANCE</h1><p className="text-[10px] text-gray-400 font-bold tracking-[0.15em] sm:tracking-[0.2em] mt-1.5 uppercase truncate">Lecturer Dashboard {currentAdminName ? `• User: ${currentAdminName}` : ''}</p></div>
         </div>
         <div className="flex items-center justify-between sm:justify-end flex-wrap gap-2 w-full xl:w-auto pt-1 sm:pt-0 border-t border-gray-50 xl:border-t-0">
            <div className="flex items-center gap-2">
              <button onClick={() => setShowNewSessionModal(true)} className="flex items-center justify-center w-10 h-10 sm:w-11 sm:h-11 bg-gray-900 text-white rounded-xl border border-gray-800 hover:bg-black transition-all shrink-0 active:scale-90" title="Clear Session"><PlusIcon className="w-5 h-5" /></button>
              <button onClick={() => { setShowManualModal(true); setManualId(''); setManualName(''); setManualError(''); }} className="flex items-center justify-center w-10 h-10 sm:w-11 sm:h-11 bg-brand-primary/5 text-brand-primary rounded-xl border-2 border-brand-primary/10 hover:bg-brand-primary/10 transition-all shrink-0 active:scale-90" title="Manual Entry"><PencilSquareIcon className="w-5 h-5" /></button>
              <button onClick={() => setShowSettingsModal(true)} className="flex items-center justify-center w-10 h-10 sm:w-11 sm:h-11 rounded-xl border-2 border-gray-100 bg-gray-50 text-gray-500 hover:bg-gray-100 transition-all shrink-0 active:scale-90" title="Settings"><AdjustmentsHorizontalIcon className="w-5 h-5" /></button>
              <button
                type="button"
                onClick={() => setShowUserNotificationsModal(true)}
                className={`relative flex items-center justify-center w-10 h-10 sm:w-11 sm:h-11 rounded-xl border-2 transition-all shrink-0 active:scale-90 ${
                  unreadUserNotifications.length > 0
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                    : 'border-gray-100 bg-gray-50 text-gray-500 hover:bg-gray-100'
                }`}
                title="System Notifications"
              >
                <BellIcon className="w-5 h-5" />
                {unreadUserNotifications.length > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-emerald-600 text-white text-[10px] font-black flex items-center justify-center shadow">
                    {unreadUserNotifications.length}
                  </span>
                )}
              </button>
            </div>
            <div className="flex items-center gap-2">
              <PWAInstallButton variant="compact" />
              <button onClick={handleDirectLaunchClassroom} className="flex group items-center gap-2.5 sm:gap-4 px-3.5 sm:px-5 py-2 sm:py-2.5 rounded-xl font-bold transition-all shrink-0 bg-gray-900 text-white hover:bg-black active:scale-95 shadow-lg shadow-gray-200">
                  <div className="text-right"><span className="hidden sm:block text-[9px] uppercase opacity-60 tracking-widest">Launch</span><span className="block text-[10px] sm:text-xs uppercase tracking-widest">Classroom</span></div>
                  <EyeIcon className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>
              <div className="w-[1px] h-7 sm:h-8 bg-gray-100 mx-0.5 sm:mx-1 shrink-0 hidden sm:block"></div>
              <button onClick={() => { closeExtendedClassroom(); onLogout(); }} className="flex items-center justify-center w-10 h-10 sm:w-11 sm:h-11 bg-red-50 text-red-600 rounded-xl border-2 border-red-100 hover:bg-red-100 shrink-0 active:scale-90" title="Log Out"><LockClosedIcon className="w-5 h-5" /></button>
            </div>
         </div>
       </div>

       {isExtendedClassroomOpen && (
         <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm">
           <div className="flex items-center gap-3 min-w-0">
             <span className="w-2.5 h-2.5 rounded-full bg-indigo-600 shrink-0 animate-pulse"></span>
             <div className="min-w-0">
               <p className="text-xs font-black text-indigo-900 uppercase tracking-wider">
                 Classroom View Active on Extended Screen
               </p>
               <p className="text-xs font-semibold text-indigo-700 mt-0.5 truncate">
                 Projecting {courseName || 'General Session'} · {selectedWeek.replace(/^W(\d+)$/i, 'Week $1')} — updates automatically from this dashboard.
               </p>
             </div>
           </div>
           <div className="flex items-center gap-2 shrink-0 self-start sm:self-center">
             <button
               type="button"
               onClick={() => {
                 try {
                   extendedWindowRef.current?.focus();
                 } catch { /* ignore */ }
               }}
               className="text-[10px] font-bold uppercase tracking-wider bg-white text-indigo-700 border border-indigo-200 px-3 py-1.5 rounded-xl hover:bg-indigo-100 transition-all"
             >
               Focus Window
             </button>
             <button
               type="button"
               onClick={closeExtendedClassroom}
               className="text-[10px] font-bold uppercase tracking-wider bg-indigo-600 text-white px-3 py-1.5 rounded-xl hover:bg-indigo-700 transition-all"
             >
               Close Extended View
             </button>
           </div>
         </div>
       )}

       {unreadUserNotifications.length > 0 && (() => {
         const topNotif = unreadUserNotifications[0];
         const isRemoved = topNotif.type === 'co_lecturer_removed';
         const isCourse = topNotif.type === 'course_assigned' || topNotif.type === 'co_lecturer_added';
         const boxStyle = isRemoved
           ? 'bg-amber-50 border-amber-200'
           : isCourse
             ? 'bg-indigo-50 border-indigo-200'
             : 'bg-emerald-50 border-emerald-200';
         const dotStyle = isRemoved
           ? 'bg-amber-500'
           : isCourse
             ? 'bg-indigo-500'
             : 'bg-emerald-500';
         const titleStyle = isRemoved
           ? 'text-amber-900'
           : isCourse
             ? 'text-indigo-900'
             : 'text-emerald-900';
         const msgStyle = isRemoved
           ? 'text-amber-800'
           : isCourse
             ? 'text-indigo-800'
             : 'text-emerald-800';
         const timeStyle = isRemoved
           ? 'text-amber-700/75'
           : isCourse
             ? 'text-indigo-700/75'
             : 'text-emerald-700/75';
         const btnStyle = isRemoved
           ? 'bg-amber-600 hover:bg-amber-700'
           : isCourse
             ? 'bg-indigo-600 hover:bg-indigo-700'
             : 'bg-emerald-600 hover:bg-emerald-700';
         const secondaryBtnStyle = isRemoved
           ? 'text-amber-700 border-amber-200 hover:bg-amber-100'
           : isCourse
             ? 'text-indigo-700 border-indigo-200 hover:bg-indigo-100'
             : 'text-emerald-700 border-emerald-200 hover:bg-emerald-100';
         return (
           <div className={`${boxStyle} border rounded-2xl p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm`}>
             <div className="flex items-start gap-3 min-w-0">
               <span className={`mt-1 w-2.5 h-2.5 rounded-full ${dotStyle} shrink-0 animate-pulse`}></span>
               <div className="min-w-0">
                 <p className={`text-xs font-black uppercase tracking-wider ${titleStyle}`}>
                   {topNotif.title}
                   {unreadUserNotifications.length > 1 ? ` (+${unreadUserNotifications.length - 1} more)` : ''}
                 </p>
                 <p className={`text-xs font-semibold mt-0.5 ${msgStyle}`}>
                   {topNotif.message}
                 </p>
                 <p className={`text-[10px] font-bold mt-1 tabular-nums ${timeStyle}`}>
                   {new Date(topNotif.createdAt).toLocaleString()}
                 </p>
               </div>
             </div>
             <div className="flex items-center gap-2 shrink-0 self-start sm:self-center">
               <button
                 type="button"
                 onClick={() => void onMarkUserNotificationRead?.(topNotif.id)}
                 className={`text-[10px] font-bold uppercase tracking-wider text-white px-3 py-1.5 rounded-xl transition-all ${btnStyle}`}
               >
                 Mark Read
               </button>
               <button
                 type="button"
                 onClick={() => setShowUserNotificationsModal(true)}
                 className={`text-[10px] font-bold uppercase tracking-wider bg-white border px-3 py-1.5 rounded-xl transition-all ${secondaryBtnStyle}`}
               >
                 All Updates
               </button>
             </div>
           </div>
         );
       })()}

       <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <button
            type="button"
            onClick={() => { setActiveTab('attendance'); setAttendanceFilterMode('all'); }}
            className="bg-white p-4 rounded-2xl border border-gray-100 hover:border-gray-300 shadow-sm flex flex-col text-left transition-colors"
          >
             <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Total Enrolled</span>
             <span className="text-2xl font-bold text-gray-900 tabular-nums leading-none">{stats.total}</span>
             {knownStudents.length > 0 && (
               <span className="text-[11px] font-semibold text-gray-400 mt-1.5 tabular-nums">
                 {stats.recordedCount} recorded · {stats.notScanned} not scanned
               </span>
             )}
          </button>
          <button
            type="button"
            onClick={() => { setActiveTab('attendance'); setAttendanceFilterMode('present'); }}
            className="bg-white p-4 rounded-2xl border border-gray-100 hover:border-green-200 shadow-sm flex flex-col text-left transition-colors"
          >
             <span className="text-[10px] font-bold text-green-500 uppercase tracking-widest mb-1">Present</span>
             <span className="text-2xl font-bold text-green-600 tabular-nums leading-none">{stats.present}</span>
             <span className="text-[11px] font-semibold text-gray-400 mt-1.5 tabular-nums">
               {stats.excused > 0 ? `${stats.excused} medical / exempt` : 'Scanned or marked P'}
             </span>
          </button>
          <button
            type="button"
            onClick={() => { setActiveTab('attendance'); setAttendanceFilterMode('absent_unscanned'); }}
            className="bg-white p-4 rounded-2xl border border-gray-100 hover:border-red-200 shadow-sm flex flex-col text-left transition-colors"
          >
             <span className="text-[10px] font-bold text-red-500 uppercase tracking-widest mb-1">Absent / Not Scanned</span>
             <span className="text-2xl font-bold text-red-600 tabular-nums leading-none">{stats.absent + stats.notScanned}</span>
             <span className="text-[11px] font-semibold text-amber-700 mt-1.5 tabular-nums">
               {stats.absent} absent · {stats.notScanned} not scanned
             </span>
          </button>
          <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex flex-col">
             <span className="text-[10px] font-bold text-indigo-500 uppercase tracking-widest mb-1">Attendance Rate</span>
             <span className="text-2xl font-bold text-indigo-600 tabular-nums leading-none">{stats.pct}%</span>
             <span className="text-[11px] font-semibold text-gray-400 mt-1.5 tabular-nums">
               {stats.present}/{stats.total} present
             </span>
          </div>
       </div>

       {isAdmin && (() => {
         const nowMs = currentTime.getTime();
         const ONLINE_THRESHOLD_MS = 90 * 1000;
         const onlineSessions = adminSessions.filter(
           s => s.status === 'active' && nowMs - (s.lastActiveTime || s.loginTime || 0) <= ONLINE_THRESHOLD_MS
         );
         const unreadNotifications = adminNotifications.filter(n => !n.read);
         const pendingUsersCount = registeredUsers.filter(
           u => u.status === 'pending' || u.status === 'approved_pending_pin'
         ).length;

         return (
           <div className="bg-white p-4 sm:p-6 rounded-3xl shadow-sm border border-gray-100 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                 <div className="flex items-center gap-2.5 flex-wrap">
                    <div className="w-2.5 h-2.5 bg-emerald-500 rounded-full animate-pulse shrink-0"></div>
                    <h3 className="text-xs font-bold text-gray-700 uppercase tracking-widest">Admin Control Center</h3>
                    <span className="text-[10px] bg-emerald-50 text-emerald-700 font-bold px-2.5 py-0.5 rounded-full border border-emerald-200">
                      {onlineSessions.length} Online Now
                    </span>
                    {pendingUsersCount > 0 && (
                      <span className="text-[10px] bg-amber-50 text-amber-700 font-bold px-2.5 py-0.5 rounded-full border border-amber-200">
                        {pendingUsersCount} Pending Approval
                      </span>
                    )}
                    {unreadNotifications.length > 0 && (
                      <span className="text-[10px] bg-red-50 text-red-600 font-bold px-2.5 py-0.5 rounded-full border border-red-200 animate-pulse">
                        {unreadNotifications.length} New Alert{unreadNotifications.length > 1 ? 's' : ''}
                      </span>
                    )}
                 </div>

                 <div className="flex bg-gray-100 p-1 rounded-xl shrink-0">
                    <button
                      type="button"
                      onClick={() => setAdminPanelTab('activity')}
                      className={`flex-1 sm:flex-initial px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${adminPanelTab === 'activity' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}
                    >
                      Live Activity ({onlineSessions.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setAdminPanelTab('users')}
                      className={`flex-1 sm:flex-initial px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${adminPanelTab === 'users' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}
                    >
                      Users ({registeredUsers.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setAdminPanelTab('notifications')}
                      className={`flex-1 sm:flex-initial px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${adminPanelTab === 'notifications' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}
                    >
                      Alerts {unreadNotifications.length > 0 ? `(${unreadNotifications.length})` : ''}
                    </button>
                 </div>
              </div>

              {unreadNotifications.length > 0 && adminPanelTab !== 'notifications' && (() => {
                const topNotif = unreadNotifications[0];
                const isActivation = topNotif.type === 'account_activated';
                const isDeleteReq = topNotif.type === 'delete_request';
                const isEmailFail = topNotif.type === 'email_delivery_failure';
                const isOwnership = topNotif.type === 'course_ownership_changed';
                const isSyncSkip = topNotif.type === 'sheet_sync_skipped';
                const bannerStyle = isActivation
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : isDeleteReq || isEmailFail
                    ? 'bg-red-50 border-red-200 text-red-900'
                    : isOwnership
                      ? 'bg-indigo-50 border-indigo-200 text-indigo-900'
                      : 'bg-amber-50 border-amber-200 text-amber-900';
                const dotColor = isActivation
                  ? 'bg-emerald-500'
                  : isDeleteReq || isEmailFail
                    ? 'bg-red-500'
                    : isOwnership
                      ? 'bg-indigo-500'
                      : 'bg-amber-500';
                const btnStyle = isActivation
                  ? 'bg-emerald-600 hover:bg-emerald-700'
                  : isDeleteReq || isEmailFail
                    ? 'bg-red-600 hover:bg-red-700'
                    : isOwnership
                      ? 'bg-indigo-600 hover:bg-indigo-700'
                      : 'bg-amber-600 hover:bg-amber-700';
                const prefix = isActivation
                  ? 'Account Activated:'
                  : isDeleteReq
                    ? 'Deletion Request:'
                    : isEmailFail
                      ? 'Email Delivery Failure:'
                      : isOwnership
                        ? 'Ownership Change:'
                        : isSyncSkip
                          ? 'Sheet Sync Skip:'
                          : 'New Signup:';
                return (
                  <div className={`border rounded-2xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${bannerStyle}`}>
                    <div className="flex items-center gap-2 text-xs font-bold min-w-0">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`}></span>
                      <span className="truncate">
                        {prefix} {topNotif.message || `${topNotif.username} (${topNotif.email})`}
                        {unreadNotifications.length > 1 ? ` (+${unreadNotifications.length - 1} more)` : ''}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setAdminPanelTab('notifications')}
                      className={`self-start sm:self-auto shrink-0 text-[10px] font-bold uppercase tracking-wider text-white px-3 py-1.5 rounded-xl transition-all ${btnStyle}`}
                    >
                      View Alerts
                    </button>
                  </div>
                );
              })()}

              {adminPanelTab === 'activity' && (
                <div className="space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px] font-bold text-gray-500">
                    <span>Showing active and recent logins across all browsers &amp; devices (auto-syncs every 6s)</span>
                    {adminSessions.length > 0 && (
                      <button
                        type="button"
                        onClick={() => void onClearInactiveSessions?.()}
                        className="self-start sm:self-auto text-[10px] text-gray-600 bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-lg uppercase tracking-wider transition-all"
                      >
                        Clear Signed-Out
                      </button>
                    )}
                  </div>
                  {adminSessions.length === 0 ? (
                    <div className="bg-gray-50 rounded-2xl p-4 text-center text-xs font-bold text-gray-400">
                      No active user sessions recorded yet.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-64 overflow-y-auto pr-1 custom-scrollbar">
                      {adminSessions.slice(0, 12).map((session) => {
                        const lastSeenMs = session.lastActiveTime || session.loginTime || 0;
                        const isOnline = session.status === 'active' && nowMs - lastSeenMs <= ONLINE_THRESHOLD_MS;
                        const isIdle = session.status === 'active' && !isOnline;
                        return (
                          <div
                            key={session.id}
                            className={`p-3.5 rounded-2xl border flex items-center justify-between gap-3 ${
                              isOnline ? 'bg-emerald-50/40 border-emerald-200' : 'bg-gray-50 border-gray-100'
                            }`}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span
                                  className={`w-2 h-2 rounded-full shrink-0 ${
                                    isOnline ? 'bg-emerald-500 animate-pulse' : isIdle ? 'bg-amber-400' : 'bg-gray-300'
                                  }`}
                                ></span>
                                <span className="font-black text-xs text-gray-900 truncate">{session.adminName}</span>
                                <span
                                  className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded-full ${
                                    isOnline
                                      ? 'bg-emerald-100 text-emerald-700'
                                      : isIdle
                                        ? 'bg-amber-100 text-amber-700'
                                        : 'bg-gray-200 text-gray-600'
                                  }`}
                                >
                                  {isOnline ? 'Online' : isIdle ? 'Idle' : 'Signed Out'}
                                </span>
                              </div>
                              <p className="text-[10px] font-bold text-gray-500 truncate mt-1">
                                {session.device || 'Unknown Device'}{session.currentAction ? ` • ${session.currentAction}` : ''}
                              </p>
                              <p className="text-[10px] font-bold text-gray-400 mt-0.5 tabular-nums">
                                Active: {lastSeenMs ? new Date(lastSeenMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '-'} • {session.date || '-'}
                              </p>
                            </div>
                            {session.status === 'active' && session.adminName.toLowerCase() !== 'admin' && (
                              <button
                                type="button"
                                onClick={() => {
                                  void onRevokeSession?.(session.id);
                                  showToast('success', `Signed out ${session.adminName} session.`);
                                }}
                                className="shrink-0 text-[10px] font-bold text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 px-2.5 py-1.5 rounded-xl uppercase transition-all"
                              >
                                Force Exit
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {adminPanelTab === 'users' && (
                <div className="space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px] font-bold text-gray-500">
                    <span>Admin-only User Directory • Approve pending accounts before sign-in or remove users for safety</span>
                    <span className="text-[10px] text-gray-400 uppercase">{registeredUsers.length} Registered Account{registeredUsers.length === 1 ? '' : 's'}</span>
                  </div>
                  <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1 custom-scrollbar">
                    {registeredUsers.map((user) => {
                      const isBuiltInAdmin = user.role === 'admin' || user.username.toLowerCase() === 'admin';
                      const isPendingApproval = user.status === 'pending' && !isBuiltInAdmin;
                      const isAwaitingPin = user.status === 'approved_pending_pin' && !isBuiltInAdmin;
                      const isUserOnline = adminSessions.some(
                        s =>
                          s.adminName.toLowerCase() === user.username.toLowerCase() &&
                          s.status === 'active' &&
                          nowMs - (s.lastActiveTime || s.loginTime || 0) <= ONLINE_THRESHOLD_MS
                      );

                      return (
                        <div
                          key={user.id}
                          className="p-3.5 bg-gray-50 rounded-2xl border border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-black text-xs text-gray-900">{user.username}</span>
                              <span className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded-full ${isBuiltInAdmin ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-200 text-gray-700'}`}>
                                {isBuiltInAdmin ? 'Admin' : 'Lecturer'}
                              </span>
                              <span className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded-full ${
                                isPendingApproval
                                  ? 'bg-amber-100 text-amber-700'
                                  : isAwaitingPin
                                    ? 'bg-indigo-100 text-indigo-700'
                                    : 'bg-emerald-100 text-emerald-700'
                              }`}>
                                {isPendingApproval ? 'Pending Approval' : isAwaitingPin ? 'Approved · PIN Sent' : 'Active'}
                              </span>
                              {isUserOnline && (
                                <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                                  Online
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] font-bold text-gray-500 truncate mt-1">
                              {user.email || 'No email provided'}
                            </p>
                            <p className="text-[10px] font-bold text-gray-400 mt-0.5">
                              {user.lastLoginAt
                                ? `Last login: ${new Date(user.lastLoginAt).toLocaleString()}`
                                : user.createdAt
                                  ? `Registered: ${new Date(user.createdAt).toLocaleString()}`
                                  : 'System Account'}
                            </p>
                          </div>

                          {!isBuiltInAdmin ? (
                            <div className="flex items-center gap-2 flex-wrap shrink-0">
                              {isPendingApproval && (
                                <button
                                  type="button"
                                  disabled={approvingUserId === user.id}
                                  onClick={async () => {
                                    if (!onActivateUser) return;
                                    setApprovingUserId(user.id);
                                    try {
                                      const res = await onActivateUser(user.id);
                                      if (res && res.success === false) {
                                        showToast('error', res.error || 'Could not approve user.');
                                      } else if (res && res.emailSent) {
                                        showToast('success', `Approved "${user.username}". Activation PIN sent to ${res.email || user.email}.`);
                                      } else if (res && res.pin) {
                                        await navigator.clipboard?.writeText(res.pin).catch(() => {});
                                        showToast('success', `Approved "${user.username}". Email service unavailable — Activation PIN: ${res.pin} (copied).`);
                                      } else {
                                        showToast('success', `Approved "${user.username}".`);
                                      }
                                    } finally {
                                      setApprovingUserId(null);
                                    }
                                  }}
                                  className="text-[10px] font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-2.5 py-1.5 rounded-xl uppercase transition-all disabled:opacity-50"
                                >
                                  {approvingUserId === user.id ? 'Approving...' : 'Approve'}
                                </button>
                              )}
                              {isAwaitingPin && (
                                <button
                                  type="button"
                                  disabled={approvingUserId === user.id}
                                  onClick={async () => {
                                    if (!onResendActivationEmail) return;
                                    setApprovingUserId(user.id);
                                    try {
                                      const res = await onResendActivationEmail(user);
                                      if (res.sent) {
                                        showToast('success', `New Activation PIN emailed to ${res.email || user.email}.`);
                                      } else if (res.pin) {
                                        await navigator.clipboard?.writeText(res.pin).catch(() => {});
                                        showToast('success', `Email service unavailable — New Activation PIN: ${res.pin} (copied).`);
                                      } else {
                                        showToast('error', res.error || 'Could not resend Activation PIN.');
                                      }
                                    } finally {
                                      setApprovingUserId(null);
                                    }
                                  }}
                                  className="text-[10px] font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 px-2.5 py-1.5 rounded-xl uppercase transition-all disabled:opacity-50"
                                >
                                  {approvingUserId === user.id ? 'Sending...' : 'Resend PIN'}
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() =>
                                  setResetPasswordModal({
                                    user,
                                    newPassword: '',
                                    activateAccount: (user.status || 'active') !== 'active',
                                    isSaving: false,
                                  })
                                }
                                className="text-[10px] font-bold text-gray-700 bg-white hover:bg-gray-100 border border-gray-200 px-2.5 py-1.5 rounded-xl uppercase transition-all"
                                title={`Reset password for ${user.username}`}
                              >
                                Reset Password
                              </button>
                              <button
                                type="button"
                                onClick={() => setPendingDeleteAction({ type: 'delete-user', id: user.id, username: user.username, email: user.email })}
                                className="inline-flex items-center gap-1 text-[10px] font-bold text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 px-2.5 py-1.5 rounded-xl uppercase transition-all"
                                title={`Remove user ${user.username}`}
                              >
                                <TrashIcon className="w-3.5 h-3.5" />
                                Remove
                              </button>
                            </div>
                          ) : (
                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider shrink-0">Protected Admin</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {adminPanelTab === 'notifications' && (
                <div className="space-y-4">
                  <div className="bg-gray-50 p-3.5 rounded-2xl border border-gray-100 space-y-2.5">
                    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">
                          Admin Notification Email (receives new signup alerts)
                        </label>
                        <input
                          type="email"
                          value={adminEmailInput}
                          onChange={(e) => setAdminEmailInput(e.target.value)}
                          placeholder="admin@university.edu (or uses Google Sheet owner email)"
                          className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-xs font-bold text-gray-800 outline-none focus:border-brand-primary"
                        />
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            onAdminEmailChange?.(adminEmailInput);
                            showToast('success', 'Admin notification email saved to cloud.');
                          }}
                          className="bg-indigo-600 text-white text-[10px] font-bold uppercase tracking-wider px-4 py-2.5 rounded-xl hover:bg-indigo-700 transition-all"
                        >
                          Save Email
                        </button>
                        <button
                          type="button"
                          disabled={isTestingAdminEmail}
                          onClick={async () => {
                            if (!onSendTestAdminEmail) return;
                            setIsTestingAdminEmail(true);
                            setAdminEmailTestStatus(null);
                            try {
                              onAdminEmailChange?.(adminEmailInput);
                              const result = await onSendTestAdminEmail(adminEmailInput);
                              setAdminEmailTestStatus(result);
                              showToast(result.success ? 'success' : 'error', result.message);
                            } finally {
                              setIsTestingAdminEmail(false);
                            }
                          }}
                          className="bg-gray-900 text-white text-[10px] font-bold uppercase tracking-wider px-4 py-2.5 rounded-xl hover:bg-black transition-all disabled:opacity-50"
                        >
                          {isTestingAdminEmail ? 'Testing...' : 'Test Email'}
                        </button>
                      </div>
                    </div>
                    {adminEmailTestStatus && (
                      <div
                        className={`text-[11px] font-bold px-3 py-2 rounded-xl border ${
                          adminEmailTestStatus.success
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-red-50 text-red-700 border-red-200'
                        }`}
                      >
                        {adminEmailTestStatus.message}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-bold text-gray-500">
                      System Alerts ({adminNotifications.length})
                    </span>
                    <div className="flex items-center gap-2">
                      {unreadNotifications.length > 0 && (
                        <button
                          type="button"
                          onClick={() => void onMarkAllNotificationsRead?.()}
                          className="text-[10px] font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1 rounded-lg uppercase"
                        >
                          Mark All Read
                        </button>
                      )}
                      {adminNotifications.length > 0 && (
                        <button
                          type="button"
                          onClick={() => void onClearNotifications?.()}
                          className="text-[10px] font-bold text-red-600 bg-red-50 hover:bg-red-100 px-2.5 py-1 rounded-lg uppercase"
                        >
                          Clear All
                        </button>
                      )}
                    </div>
                  </div>

                  {adminNotifications.length === 0 ? (
                    <div className="bg-gray-50 rounded-2xl p-4 text-center text-xs font-bold text-gray-400">
                      No system notifications yet.
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-60 overflow-y-auto pr-1 custom-scrollbar">
                      {adminNotifications.map((notif) => {
                        const isActivation = notif.type === 'account_activated';
                        const isDeleteReq = notif.type === 'delete_request';
                        const isEmailFail = notif.type === 'email_delivery_failure';
                        const isOwnership = notif.type === 'course_ownership_changed';
                        const isSyncSkip = notif.type === 'sheet_sync_skipped';
                        const typeLabel = isActivation
                          ? 'Account Activated'
                          : isDeleteReq
                            ? 'Deletion Request'
                            : isEmailFail
                              ? 'Email Failure'
                              : isOwnership
                                ? 'Ownership Change'
                                : isSyncSkip
                                  ? 'Sheet Sync Skip'
                                  : 'New Signup';
                        const badgeClass = isActivation
                          ? 'bg-emerald-100 text-emerald-700'
                          : isDeleteReq || isEmailFail
                            ? 'bg-red-100 text-red-700'
                            : isOwnership
                              ? 'bg-indigo-100 text-indigo-700'
                              : 'bg-amber-100 text-amber-700';
                        const rowUnreadClass = isActivation
                          ? 'bg-emerald-50/60 border-emerald-200'
                          : isDeleteReq || isEmailFail
                            ? 'bg-red-50/60 border-red-200'
                            : isOwnership
                              ? 'bg-indigo-50/60 border-indigo-200'
                              : 'bg-amber-50/60 border-amber-200';
                        const dotClass = isActivation
                          ? 'bg-emerald-500'
                          : isDeleteReq || isEmailFail
                            ? 'bg-red-500'
                            : isOwnership
                              ? 'bg-indigo-500'
                              : 'bg-amber-500';
                        const deliveryLabel = isEmailFail
                          ? 'Delivery Failed'
                          : isOwnership
                            ? 'Course / Sheet Ownership'
                            : isSyncSkip
                              ? 'Google Sheet Sync Skipped'
                              : notif.emailSent
                                ? isActivation
                                  ? 'Confirmation Email Sent'
                                  : 'Notification Email Sent'
                                : notif.type === 'user_signup'
                                  ? 'Awaiting Admin Approval'
                                  : 'In-System Alert';
                        const deliveryClass = isEmailFail
                          ? 'text-red-700'
                          : isOwnership
                            ? 'text-indigo-700'
                            : isSyncSkip
                              ? 'text-amber-700'
                              : notif.emailSent || isActivation
                                ? 'text-emerald-700'
                                : 'text-amber-700';
                        return (
                          <div
                            key={notif.id}
                            className={`p-3.5 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${
                              notif.read ? 'bg-gray-50 border-gray-100' : rowUnreadClass
                            }`}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                {!notif.read && <span className={`w-2 h-2 rounded-full shrink-0 ${dotClass}`}></span>}
                                <span className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded-md ${badgeClass}`}>
                                  {typeLabel}
                                </span>
                                <span className="font-bold text-xs text-gray-900">{notif.message}</span>
                              </div>
                              <div className="flex items-center gap-2 mt-1 flex-wrap text-[10px] font-bold">
                                <span className={deliveryClass}>
                                  {deliveryLabel}
                                </span>
                                <span className="text-gray-300" aria-hidden="true">·</span>
                                <span className="text-gray-400 tabular-nums">
                                  {new Date(notif.createdAt).toLocaleString()}
                                </span>
                              </div>
                            </div>
                            {!notif.read && (
                              <button
                                type="button"
                                onClick={() => void onMarkNotificationRead?.(notif.id)}
                                className="self-start sm:self-auto shrink-0 text-[10px] font-bold text-gray-600 bg-white border border-gray-200 hover:bg-gray-100 px-2.5 py-1 rounded-lg uppercase"
                              >
                                Mark Read
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
           </div>
         );
       })()}

      {/* Subjects / Courses Panel */}
      <section className="bg-white p-4 sm:p-5 rounded-3xl shadow-sm border border-gray-100 space-y-4">
        {(() => {
          const activeUsers = registeredUsers.filter((u) => u.status === 'active');
          const isCourseOwnedByMe = (c: CourseProfile) => {
            if (currentUserId && c.ownerId) return c.ownerId === currentUserId;
            return String(c.createdBy || '').trim().toLowerCase() === (currentAdminName || 'admin').trim().toLowerCase();
          };
          const showAdminScopeToggle = isAdmin && activeUsers.length > 1 && courses.length > 0;
          const scopedCourses = showAdminScopeToggle && subjectScope === 'mine'
            ? courses.filter(isCourseOwnedByMe)
            : courses;
          const query = subjectFilter.trim().toLowerCase();
          const visibleCourses = query
            ? scopedCourses.filter(c => c.courseName.toLowerCase().includes(query))
            : scopedCourses;

          return (
            <>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0 flex-wrap">
                  <h2 className="text-sm font-bold text-gray-900 tracking-tight whitespace-nowrap">SUBJECTS</h2>
                  <span className="text-xs font-medium text-gray-400 tabular-nums whitespace-nowrap">
                    · {scopedCourses.length} {scopedCourses.length === 1 ? 'course' : 'courses'}
                  </span>
                  {showAdminScopeToggle && (
                    <div className="inline-flex bg-gray-100 p-0.5 rounded-xl border border-gray-200/70">
                      <button
                        type="button"
                        onClick={() => setSubjectScope('all')}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors ${
                          subjectScope === 'all'
                            ? 'bg-white text-gray-900 shadow-sm'
                            : 'text-gray-500 hover:text-gray-800'
                        }`}
                      >
                        All ({courses.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setSubjectScope('mine')}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors ${
                          subjectScope === 'mine'
                            ? 'bg-white text-indigo-700 shadow-sm'
                            : 'text-gray-500 hover:text-gray-800'
                        }`}
                      >
                        Mine ({courses.filter(isCourseOwnedByMe).length})
                      </button>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                  {courses.length > 6 && (
                    <div className="relative flex-1 sm:flex-initial sm:w-52">
                      <MagnifyingGlassIcon className="w-3.5 h-3.5 text-gray-400 absolute top-1/2 left-3 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="text"
                        value={subjectFilter}
                        onChange={(e) => setSubjectFilter(e.target.value)}
                        placeholder="Filter subjects..."
                        className="w-full pl-8 pr-3 py-2 text-xs font-medium bg-gray-50 border border-gray-200 rounded-xl text-gray-800 placeholder-gray-400 focus:bg-white focus:border-indigo-500 outline-none transition-colors"
                      />
                    </div>
                  )}
                  {integrationType === 'google_sheets' && (
                    <button
                      type="button"
                      onClick={() => fetchCourseFromB1(true, 'select-tabs')}
                      disabled={isLoadingSheetCourse}
                      className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors active:scale-95 disabled:opacity-50 whitespace-nowrap shrink-0"
                    >
                      {isLoadingSheetCourse ? 'Syncing...' : 'Sync Sheet Tabs'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setNewCourseNameInput('');
                      setNewCourseOwnerId(currentUserId || activeUsers.find(u => u.role === 'admin')?.id || '');
                      setNewCourseSharedWith([]);
                      setShowAddCourseModal(true);
                    }}
                    className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-gray-900 text-white hover:bg-black transition-colors active:scale-95 shadow-sm whitespace-nowrap shrink-0"
                  >
                    <PlusIcon className="w-3.5 h-3.5" />
                    Add Subject
                  </button>
                </div>
              </div>

              {courses.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/60 px-4 py-6 text-center">
                  <p className="text-xs font-semibold text-gray-700">No subjects added yet</p>
                  <p className="text-xs text-gray-500 mt-1">
                    Sync tabs from your Google Sheet or add a subject to manage its own roster, week, and attendance list.
                  </p>
                </div>
              ) : visibleCourses.length === 0 ? (
                <div className="rounded-2xl border border-gray-100 bg-gray-50/60 px-4 py-5 text-center text-xs text-gray-500">
                  {query
                    ? <>No subjects match &ldquo;{subjectFilter.trim()}&rdquo;.</>
                    : 'No subjects assigned to your account yet. Switch to "All" or sync/add a subject.'}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5 max-h-60 overflow-y-auto pr-0.5 custom-scrollbar">
              {visibleCourses.map((c) => {
                const isActive = courseName.trim().toUpperCase() === c.courseName.trim().toUpperCase();
                const studentCount = c.students?.length ?? 0;
                const weekLabel = (c.selectedWeek || 'W1').replace(/^W(\d+)$/i, 'Week $1');
                const showOwnerSelector = isAdmin && Boolean(onAssignCourseOwner) && activeUsers.length > 0;
                const matchedOwner =
                  collaboratorPool.find((u) => u.id === c.ownerId) ||
                  collaboratorPool.find(
                    (u) => u.username.toLowerCase() === String(c.createdBy || '').trim().toLowerCase()
                  );
                const resolvedOwnerValue = matchedOwner?.id || c.ownerId || '';
                const isPrimaryOwner =
                  isAdmin ||
                  (currentUserId
                    ? c.ownerId === currentUserId
                    : String(c.createdBy || '').trim().toLowerCase() === (currentAdminName || '').trim().toLowerCase());
                const sharedIds = Array.isArray(c.sharedWith)
                  ? c.sharedWith.filter((id) => id && id !== resolvedOwnerValue)
                  : [];
                const canManageCoLecturers = Boolean(onUpdateCourseCoLecturers) && isPrimaryOwner && collaboratorPool.length > 1;
                const sharedNames = sharedIds
                  .map((id) => collaboratorPool.find((u) => u.id === id || u.username.toLowerCase() === id.toLowerCase())?.username || id)
                  .filter(Boolean);

                return (
                  <div
                    key={c.id}
                    className={`group flex flex-col justify-between rounded-2xl border transition-all duration-150 ${
                      isActive
                        ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                        : 'bg-gray-50/70 text-gray-900 border-gray-200/80 hover:bg-white hover:border-gray-300'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => onSelectCourse?.(c)}
                        className="flex-1 min-w-0 text-left px-3.5 py-2.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded-l-2xl"
                        title={c.courseName}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-bold tracking-tight truncate">
                            {c.courseName}
                          </span>
                        </div>
                        <div
                          className={`flex items-center gap-1.5 mt-1 text-[11px] font-medium tabular-nums truncate ${
                            isActive ? 'text-indigo-100' : 'text-gray-500'
                          }`}
                        >
                          <span>{weekLabel}</span>
                          <span aria-hidden="true">·</span>
                          <span>
                            {studentCount > 0
                              ? `${studentCount} ${studentCount === 1 ? 'student' : 'students'}`
                              : 'No roster'}
                          </span>
                          {!isPrimaryOwner && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="truncate">Shared by {c.createdBy || 'owner'}</span>
                            </>
                          )}
                          {isPrimaryOwner && sharedIds.length > 0 && !canManageCoLecturers && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="truncate">+{sharedIds.length} co-lecturer</span>
                            </>
                          )}
                          {isAdmin && !showOwnerSelector && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="truncate">{c.createdBy || 'admin'}</span>
                            </>
                          )}
                          {isActive && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="font-semibold text-white">Active</span>
                            </>
                          )}
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingDeleteAction({ type: 'delete-course', id: c.id, courseName: c.courseName })}
                        className={`mr-2 w-8 h-8 rounded-xl flex items-center justify-center shrink-0 transition-colors ${
                          isActive
                            ? 'text-indigo-200 hover:text-white hover:bg-white/15'
                            : 'text-gray-400 hover:text-red-600 hover:bg-red-50'
                        }`}
                        title={`Remove ${c.courseName}`}
                        aria-label={`Remove ${c.courseName}`}
                      >
                        <XMarkIcon className="w-4 h-4" />
                      </button>
                    </div>
                    {(showOwnerSelector || canManageCoLecturers) && (
                      <div
                        className={`px-3.5 pb-2.5 pt-2 border-t space-y-1.5 ${
                          isActive ? 'border-white/15' : 'border-gray-200/70'
                        }`}
                      >
                        {showOwnerSelector && (
                          <div className="flex items-center justify-between gap-2">
                            <span className={`text-[10px] font-semibold shrink-0 ${isActive ? 'text-indigo-100' : 'text-gray-500'}`}>
                              Owner
                            </span>
                            <select
                              aria-label={`Assign owner for ${c.courseName}`}
                              value={resolvedOwnerValue}
                              onChange={async (e) => {
                                const nextOwnerId = e.target.value;
                                if (nextOwnerId && onAssignCourseOwner) {
                                  const res = await onAssignCourseOwner(c.id, nextOwnerId);
                                  if (res && res.success === false) {
                                    showToast('error', res.error || 'Could not update subject owner.');
                                  } else {
                                    const assignedUser = activeUsers.find(u => u.id === nextOwnerId);
                                    showToast('success', `Assigned "${c.courseName}" to ${assignedUser?.username || 'selected user'}.`);
                                  }
                                }
                              }}
                              className="font-sans text-[11px] font-semibold rounded-lg pl-2.5 pr-7 py-1 outline-none max-w-[170px] cursor-pointer bg-white text-gray-800 border border-gray-200 shadow-sm"
                            >
                              {!matchedOwner && (
                                <option value="" className="text-gray-900">
                                  {c.createdBy || 'Unassigned'}
                                </option>
                              )}
                              {activeUsers.map((u) => (
                                <option key={u.id} value={u.id} className="text-gray-900">
                                  {u.username}{u.role === 'admin' ? ' (Admin)' : ''}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                        {canManageCoLecturers && (
                          <div className="flex items-center justify-between gap-2">
                            <span className={`text-[10px] font-semibold truncate ${isActive ? 'text-indigo-100' : 'text-gray-500'}`}>
                              {sharedNames.length > 0 ? `Shared: ${sharedNames.join(', ')}` : 'Co-lecturers'}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                setEditingCoLecturersCourse({
                                  course: c,
                                  selectedIds: sharedIds,
                                })
                              }
                              className={`shrink-0 text-[10px] font-semibold px-2.5 py-1 rounded-lg border transition-colors ${
                                isActive
                                  ? 'bg-white/15 hover:bg-white/25 text-white border-white/25'
                                  : 'bg-white hover:bg-indigo-50 text-indigo-700 border-gray-200 shadow-sm'
                              }`}
                            >
                              {sharedIds.length > 0 ? `Share (${sharedIds.length})` : '+ Share'}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
                </div>
              )}
            </>
          );
        })()}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        <div className="bg-white p-4 sm:p-6 rounded-3xl shadow-sm border border-gray-100 flex flex-col items-center justify-center">
            <div className="w-full text-center mb-5 sm:mb-6">
                <div className="flex items-center justify-center gap-2 flex-wrap">
                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest bg-gray-100 px-3.5 py-1.5 rounded-full border border-gray-200">Active Session Config</span>
                    <button
                        type="button"
                        onClick={() => setShowWeekPromptModal(true)}
                        className="inline-flex items-center gap-1.5 text-[10px] font-bold text-amber-800 uppercase tracking-widest bg-amber-50 hover:bg-amber-100 px-3.5 py-1.5 rounded-full border border-amber-300 shadow-sm active:scale-95 transition-all cursor-pointer"
                        title="Click to change attendance week"
                    >
                        <PencilSquareIcon className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                        <span>{selectedWeek.replace(/^W(\d+)$/i, 'Week $1')}</span>
                        <span className="text-amber-600 font-black">• Edit</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => fetchCourseFromB1(true, 'active-only')}
                        disabled={isLoadingSheetCourse}
                        className="text-[10px] font-bold text-emerald-700 uppercase tracking-widest bg-emerald-50 hover:bg-emerald-100 px-3.5 py-1.5 rounded-full border border-emerald-200 transition-all active:scale-95 disabled:opacity-50"
                        title="Sync Course Name & Student List from Google Sheet"
                    >
                        {isLoadingSheetCourse ? 'Syncing Course...' : 'Sync Course Name'}
                    </button>
                </div>
                <input 
                    type="text"
                    value={courseName}
                    onChange={(e) => setCourseName(e.target.value)}
                    placeholder="Enter Course Name (or Add Subject above)"
                    className="text-xl sm:text-2xl font-bold text-gray-800 text-center w-full border-none focus:ring-0 p-2.5 sm:p-3 bg-transparent placeholder-gray-300 mt-2"
                />
            </div>
            <div className="mb-4 max-w-[260px] sm:max-w-[320px] w-full aspect-square p-3 border-4 border-dashed border-gray-100 rounded-[2rem] sm:rounded-[2.5rem] relative flex items-center justify-center overflow-hidden">
                {isQrLoading && <div className="absolute inset-0 flex items-center justify-center bg-white/80 z-10"><div className="animate-spin h-8 w-8 border-4 border-brand-primary border-t-transparent rounded-full"></div></div>}
                <canvas ref={canvasRef} className="max-w-full max-h-full rounded-2xl" />
                <div className="absolute top-2 right-2 flex items-center gap-1.5 bg-green-500 text-white px-3 py-1 rounded-full text-[9px] font-bold animate-pulse tabular-nums">
                  <div className="w-1.5 h-1.5 bg-white rounded-full"></div>
                  LIVE · {signedQrState ? `${Math.max(0, Math.ceil((signedQrState.exp - currentTime.getTime()) / 1000))}s` : '15s'}
                </div>
            </div>

            <div className="w-full max-w-md mb-4 rounded-2xl border border-gray-200 bg-gray-50/80 p-3.5 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-7 h-7 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0">
                    <LockClosedIcon className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold text-gray-900 leading-tight">Anti-Proxy Guard</p>
                    <p className="text-[10px] font-semibold text-gray-500 truncate tabular-nums">
                      15s signed QR {signedQrState ? `· refreshes automatically` : '· connecting...'}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void handleTogglePinRequired()}
                  disabled={isUpdatingPin}
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider border transition-colors shrink-0 disabled:opacity-50 ${
                    pinRequired
                      ? 'bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700'
                      : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-100'
                  }`}
                >
                  PIN: {pinRequired ? 'ON' : 'OFF'}
                </button>
              </div>

              {pinRequired && (() => {
                const flashSecs = pinDisplayMode === 'flash'
                  ? Math.max(0, Math.ceil((pinVisibleUntil - currentTime.getTime()) / 1000))
                  : 0;
                return (
                  <div className="pt-2 border-t border-gray-200/80 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-baseline gap-2">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Classroom PIN</span>
                        <span className="font-mono text-xl font-black text-indigo-700 tracking-[0.2em] tabular-nums bg-white px-2.5 py-0.5 rounded-lg border border-indigo-200 shadow-xs">
                          {signedQrState?.pin || '----'}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => void handleRotateClassroomPin()}
                          disabled={isUpdatingPin}
                          className="px-2.5 py-1.5 rounded-lg bg-white hover:bg-indigo-50 text-gray-700 hover:text-indigo-700 border border-gray-200 text-[10px] font-bold uppercase tracking-wider transition-colors disabled:opacity-50"
                        >
                          New PIN
                        </button>
                        <button
                          type="button"
                          onClick={handleFlashPinOnProjector}
                          className={`px-2.5 py-1.5 rounded-lg border text-[10px] font-bold uppercase tracking-wider transition-colors tabular-nums ${
                            pinDisplayMode === 'flash' && flashSecs > 0
                              ? 'bg-amber-500 text-white border-amber-500'
                              : 'bg-white hover:bg-amber-50 text-amber-700 border-amber-200'
                          }`}
                        >
                          {pinDisplayMode === 'flash' && flashSecs > 0 ? `Flashing ${flashSecs}s` : 'Flash 10s'}
                        </button>
                        <button
                          type="button"
                          onClick={handleTogglePinProjectorVisibility}
                          className={`px-2.5 py-1.5 rounded-lg border text-[10px] font-bold uppercase tracking-wider transition-colors ${
                            pinDisplayMode === 'visible'
                              ? 'bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700'
                              : 'bg-white hover:bg-gray-100 text-gray-700 border-gray-200'
                          }`}
                        >
                          {pinDisplayMode === 'visible' ? 'Hide Projector' : 'Show Projector'}
                        </button>
                      </div>
                    </div>
                    <p className="text-[10px] font-medium text-gray-500">
                      {pinDisplayMode === 'visible'
                        ? 'PIN is currently displayed on Classroom View.'
                        : pinDisplayMode === 'flash' && flashSecs > 0
                          ? `PIN is flashing on Classroom View for ${flashSecs}s.`
                          : 'Projector shows "PIN Required · Ask Lecturer". Announce the PIN aloud or flash it briefly.'}
                    </p>
                  </div>
                );
              })()}
            </div>

             <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-2.5 sm:gap-3 w-full sm:w-auto">
                <button onClick={() => onOpenKiosk()} className="flex items-center justify-center gap-2.5 bg-gray-100 text-gray-700 text-[11px] font-bold uppercase px-5 py-3 rounded-xl hover:bg-gray-200 transition-all active:scale-95"><QrCodeIcon className="w-4 h-4" /> Tablet Mode</button>
                <button onClick={() => setShowScanner(true)} className="flex items-center justify-center gap-2.5 bg-indigo-600 text-white text-[11px] font-bold uppercase px-5 py-3 rounded-xl hover:bg-indigo-700 transition-all active:scale-95 shadow-lg shadow-indigo-100"><CameraIcon className="w-4 h-4" /> Scan Student</button>
            </div>
        </div>

        <div className="bg-white p-4 sm:p-6 rounded-3xl shadow-sm border border-gray-100 flex flex-col">
            <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center mb-5 sm:mb-6 gap-3 sm:gap-4">
                <div className="flex bg-gray-100 p-1 rounded-xl shrink-0">
                    <button 
                        onClick={() => setActiveTab('attendance')}
                        className={`flex-1 sm:flex-initial px-3.5 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all whitespace-nowrap ${activeTab === 'attendance' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                    >
                        Live List
                    </button>
                    <button 
                        onClick={() => setActiveTab('matrix')}
                        className={`flex-1 sm:flex-initial px-3.5 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all whitespace-nowrap ${activeTab === 'matrix' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                    >
                        W1–W14 Matrix
                    </button>
                    <button 
                        onClick={() => setActiveTab('history')}
                        className={`flex-1 sm:flex-initial px-3.5 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all whitespace-nowrap ${activeTab === 'history' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                    >
                        History
                    </button>
                </div>
                <div className="flex items-center gap-2 w-full">
                    <div className="relative w-full">
                        <MagnifyingGlassIcon className="w-4 h-4 text-gray-300 absolute top-1/2 left-3.5 -translate-y-1/2" />
                        <input type="text" placeholder="Search students..." value={listSearchTerm} onChange={(e) => setListSearchTerm(e.target.value)} className="w-full pl-10 pr-4 py-2.5 text-xs font-bold border-2 border-gray-50 bg-gray-50/50 rounded-xl focus:ring-0 focus:border-brand-primary focus:bg-white transition-all" />
                    </div>
                    <button onClick={handleExportCSV} className="flex items-center justify-center w-11 h-11 bg-gray-900 text-white rounded-xl shadow-lg shadow-gray-200 hover:bg-black transition-all shrink-0 active:scale-90" title={activeTab === 'matrix' ? 'Export W1–W14 Matrix CSV' : activeTab === 'history' ? 'Export Full History CSV' : 'Export Live Session CSV'}><ArrowDownTrayIcon className="w-4 h-4" /></button>
                </div>
            </div>

            {activeTab === 'attendance' ? (
              <div className="space-y-3 mb-4 sm:mb-5">
                <div className="flex flex-wrap items-center gap-1.5 bg-gray-100 p-1 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setAttendanceFilterMode('all')}
                    className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all whitespace-nowrap tabular-nums ${
                      attendanceFilterMode === 'all' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'
                    }`}
                  >
                    All ({allLiveRows.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setAttendanceFilterMode('present')}
                    className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all whitespace-nowrap tabular-nums ${
                      attendanceFilterMode === 'present' ? 'bg-emerald-600 text-white shadow-sm' : 'text-gray-500 hover:text-emerald-700'
                    }`}
                  >
                    Present ({stats.present})
                  </button>
                  <button
                    type="button"
                    onClick={() => setAttendanceFilterMode('absent_unscanned')}
                    className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all whitespace-nowrap tabular-nums ${
                      attendanceFilterMode === 'absent_unscanned' ? 'bg-red-600 text-white shadow-sm' : 'text-gray-500 hover:text-red-700'
                    }`}
                  >
                    Absent / Not Scanned ({allLiveRows.length - stats.present})
                  </button>
                  <button
                    type="button"
                    onClick={() => setAttendanceFilterMode('not_scanned')}
                    className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all whitespace-nowrap tabular-nums ${
                      attendanceFilterMode === 'not_scanned' ? 'bg-amber-600 text-white shadow-sm' : 'text-gray-500 hover:text-amber-700'
                    }`}
                  >
                    Not Scanned ({stats.notScanned})
                  </button>
                </div>
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 bg-brand-primary/5 p-3 rounded-2xl border border-brand-primary/10">
                    <p className="text-[10px] font-bold text-brand-primary uppercase tracking-[0.2em] ml-1 sm:ml-2">Bulk Update</p>
                    <div className="flex flex-wrap items-center gap-2">
                        {stats.notScanned > 0 && (
                          <button
                            type="button"
                            onClick={handleMarkUnscannedAbsent}
                            className="flex items-center justify-center gap-1.5 bg-amber-600 text-white text-[10px] font-bold px-3 py-2 rounded-xl hover:bg-amber-700 transition-all active:scale-95 uppercase shadow-sm tabular-nums whitespace-nowrap"
                          >
                            <XMarkIcon className="w-3.5 h-3.5" /> Mark Unscanned Absent ({stats.notScanned})
                          </button>
                        )}
                        <button onClick={() => handleMarkAll('P')} className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 bg-white text-green-600 text-[10px] font-bold px-3 py-2 rounded-xl hover:shadow-md transition-all disabled:opacity-30 active:scale-95 uppercase border border-green-100 whitespace-nowrap" disabled={filteredLiveRows.length === 0}><CheckIcon className="w-3.5 h-3.5" /> All Present</button>
                        <button onClick={() => handleMarkAll('A')} className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 bg-white text-red-600 text-[10px] font-bold px-3 py-2 rounded-xl hover:shadow-md transition-all disabled:opacity-30 active:scale-95 uppercase border border-red-100 whitespace-nowrap" disabled={filteredLiveRows.length === 0}><XMarkIcon className="w-3.5 h-3.5" /> All Absent</button>
                    </div>
                </div>
              </div>
            ) : activeTab === 'matrix' ? (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 mb-4 bg-gray-50 px-3.5 py-2.5 rounded-2xl border border-gray-200">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-bold text-gray-600 tabular-nums">
                    <span className="text-gray-900">{courseName || 'General Session'}</span>
                    <span className="text-gray-300" aria-hidden="true">·</span>
                    <span>{matrixData.totalStudents} student{matrixData.totalStudents === 1 ? '' : 's'}</span>
                    <span className="text-gray-300" aria-hidden="true">·</span>
                    <span>{matrixData.totalWeeksRecorded}/14 weeks recorded</span>
                    {matrixData.averagePct !== null && (
                      <>
                        <span className="text-gray-300" aria-hidden="true">·</span>
                        <span>Avg {matrixData.averagePct}%</span>
                      </>
                    )}
                    {matrixData.below80Count > 0 && (
                      <>
                        <span className="text-gray-300" aria-hidden="true">·</span>
                        <span className="text-amber-700">{matrixData.below80Count} below 80%</span>
                      </>
                    )}
                  </div>
                  <div className="flex bg-white p-0.5 rounded-xl border border-gray-200 shrink-0 self-start sm:self-auto">
                    <button
                      type="button"
                      onClick={() => setMatrixFilterMode('all')}
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase transition-all whitespace-nowrap ${matrixFilterMode === 'all' ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:text-gray-800'}`}
                    >
                      All
                    </button>
                    <button
                      type="button"
                      onClick={() => setMatrixFilterMode('below80')}
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase transition-all whitespace-nowrap ${matrixFilterMode === 'below80' ? 'bg-amber-600 text-white' : 'text-gray-500 hover:text-gray-800'}`}
                    >
                      Below 80% ({matrixData.below80Count})
                    </button>
                  </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2 mb-5 sm:mb-6 bg-gray-50 p-2.5 rounded-2xl border border-gray-100">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-2 truncate tabular-nums">
                    {historyScope === 'course' && courseName ? courseName : 'All Subjects'} · {filteredHistory.length} record{filteredHistory.length === 1 ? '' : 's'}
                  </p>
                  <div className="flex bg-white p-0.5 rounded-xl border border-gray-200 shrink-0">
                    <button
                      type="button"
                      onClick={() => setHistoryScope('course')}
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase transition-all ${historyScope === 'course' ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:text-gray-800'}`}
                    >
                      This Subject
                    </button>
                    <button
                      type="button"
                      onClick={() => setHistoryScope('all')}
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase transition-all ${historyScope === 'all' ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:text-gray-800'}`}
                    >
                      All
                    </button>
                  </div>
              </div>
            )}

            {/* Student List Table Header */}
            <div className="flex items-center justify-between gap-2 px-4 py-2.5 mb-2.5 bg-gray-50 rounded-xl border border-gray-100">
                <div className="flex items-center gap-3 min-w-0">
                    {activeTab === 'attendance' && (
                        <input
                            type="checkbox"
                            aria-label="Select all visible students"
                            checked={filteredLiveRows.length > 0 && filteredLiveRows.every(s => selectedIds.has(s.studentId))}
                            onChange={(e) => {
                                if (e.target.checked) {
                                    setSelectedIds(new Set(filteredLiveRows.map(s => s.studentId)));
                                } else {
                                    setSelectedIds(new Set());
                                }
                            }}
                            className="w-4 h-4 rounded border-2 border-gray-200 text-brand-primary focus:ring-0 cursor-pointer shrink-0"
                        />
                    )}
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest truncate">
                        {activeTab === 'matrix' ? 'Click any W1–W14 cell to update attendance' : 'Student (Name / ID)'}
                    </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <button
                        type="button"
                        onClick={cycleStudentSort}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-[10px] font-bold uppercase tracking-wider text-gray-700 hover:border-indigo-300 hover:text-indigo-600 transition-all active:scale-95 shadow-xs"
                        title="Click to switch sorting between ID, Name, and Attendance Status"
                    >
                        <svg className="w-3.5 h-3.5 text-indigo-500 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 7.5 7.5 3m0 0L12 7.5M7.5 3v13.5m13.5 0L16.5 21m0 0L12 16.5m4.5 4.5V7.5" />
                        </svg>
                        <span>
                            Sort: {studentSortBy === 'id' ? 'ID' : studentSortBy === 'name' ? 'Name' : activeTab === 'matrix' ? 'Rate %' : 'Status'}
                        </span>
                    </button>
                </div>
            </div>

            {activeTab === 'matrix' ? (
              <div className="overflow-auto h-[340px] sm:h-[440px] border border-gray-200 rounded-2xl bg-white custom-scrollbar">
                {matrixData.rows.length > 0 ? (
                  <table className="w-full border-collapse text-left text-xs min-w-[820px]">
                    <thead className="sticky top-0 z-20 bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="sticky left-0 z-30 bg-gray-50 px-3.5 py-2.5 text-[10px] font-bold uppercase tracking-wider text-gray-500 border-r border-gray-200 min-w-[190px]">
                          Student
                        </th>
                        {WEEKS.map((w) => (
                          <th
                            key={w}
                            className={`px-1.5 py-2.5 text-center text-[10px] font-bold uppercase tabular-nums min-w-[40px] ${
                              w === selectedWeek ? 'text-indigo-700 bg-indigo-50/80' : 'text-gray-500'
                            }`}
                          >
                            {w}
                          </th>
                        ))}
                        <th className="px-3 py-2.5 text-right text-[10px] font-bold uppercase tracking-wider text-gray-500 border-l border-gray-200 whitespace-nowrap">
                          Present
                        </th>
                        <th className="px-3 py-2.5 text-right text-[10px] font-bold uppercase tracking-wider text-gray-500 whitespace-nowrap">
                          Rate
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {matrixData.rows.map((row) => {
                        const pctColor =
                          row.attendancePct === null
                            ? 'text-gray-400'
                            : row.attendancePct >= 80
                              ? 'text-emerald-700'
                              : row.attendancePct >= 60
                                ? 'text-amber-700'
                                : 'text-red-700';

                        return (
                          <tr key={row.studentId} className="hover:bg-gray-50/70 transition-colors">
                            <td className="sticky left-0 z-10 bg-white px-3.5 py-2 border-r border-gray-200 max-w-[220px]">
                              <div className="font-bold text-xs text-gray-900 truncate">{row.name}</div>
                              <div className="font-mono text-[10px] text-gray-400 tabular-nums">{row.studentId}</div>
                            </td>
                            {WEEKS.map((w) => {
                              const cell = row.weeks[w];
                              const st = cell?.status || '';
                              const cellStyle =
                                st === 'P'
                                  ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                                  : st === 'A'
                                    ? 'bg-red-50 text-red-700 hover:bg-red-100'
                                    : st
                                      ? 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                                      : 'text-gray-300 hover:bg-gray-100 hover:text-gray-600';
                              return (
                                <td key={w} className="p-1 text-center">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setEditingMatrixCell({
                                        studentId: row.studentId,
                                        name: row.name,
                                        week: w,
                                        currentStatus: st,
                                        reason: cell?.absenceReason || '',
                                      })
                                    }
                                    title={
                                      cell
                                        ? `${row.name} (${w}): ${st}${cell.absenceReason ? ` — ${cell.absenceReason}` : ''} · Click to edit`
                                        : `${row.name} (${w}): Not recorded · Click to mark`
                                    }
                                    className={`w-8 h-7 rounded-md font-mono text-[11px] font-bold transition-colors tabular-nums ${cellStyle}`}
                                  >
                                    {st || '-'}
                                  </button>
                                </td>
                              );
                            })}
                            <td className="px-3 py-2 text-right font-mono text-xs font-bold text-gray-700 border-l border-gray-200 tabular-nums whitespace-nowrap">
                              {row.presentCount}/{row.denominator}
                            </td>
                            <td className={`px-3 py-2 text-right font-mono text-xs font-bold tabular-nums whitespace-nowrap ${pctColor}`}>
                              {row.attendancePct !== null ? `${row.attendancePct}%` : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-center p-8">
                    <div className="w-14 h-14 bg-gray-50 rounded-full flex items-center justify-center mb-3 text-gray-300">
                      <ListBulletIcon className="w-7 h-7" />
                    </div>
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">
                      {matrixFilterMode === 'below80'
                        ? 'No students below 80% attendance'
                        : 'No student roster or attendance records for this subject yet'}
                    </p>
                  </div>
                )}
              </div>
            ) : (
            <div className="overflow-y-auto h-[340px] sm:h-[440px] pr-1 sm:pr-2 custom-scrollbar">
                {activeTab === 'attendance' ? (
                    filteredLiveRows.length > 0 ? (
                        <ul className="space-y-2.5">
                            {filteredLiveRows.map(s => {
                                const isBusy = markingStudentId === s.studentId;
                                const rowTone = s.isUnscanned
                                  ? 'bg-amber-50/50 border-amber-200/80 hover:border-amber-300'
                                  : s.status === 'A'
                                    ? 'bg-red-50/35 border-red-100 hover:border-red-200'
                                    : 'bg-gray-50/60 border-transparent hover:border-gray-200';
                                return (
                                <li key={s.studentId} className={`flex flex-col gap-2 p-3.5 rounded-2xl border transition-all group ${rowTone}`}>
                                    <div className="flex items-center gap-3">
                                        <input
                                          type="checkbox"
                                          checked={selectedIds.has(s.studentId)}
                                          onChange={(e) => {
                                            const next = new Set(selectedIds);
                                            if (e.target.checked) next.add(s.studentId);
                                            else next.delete(s.studentId);
                                            setSelectedIds(next);
                                          }}
                                          className="w-4.5 h-4.5 rounded-md border-2 border-gray-300 text-brand-primary focus:ring-0 transition-all cursor-pointer shrink-0"
                                        />
                                        <div className="flex-1 min-w-0">
                                            <p className="font-bold text-sm text-gray-900 truncate leading-tight mb-0.5">{s.name}</p>
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="text-[10px] font-mono font-bold text-gray-500 bg-white px-2 py-0.5 rounded-md border border-gray-200">{s.studentId}</span>
                                                {s.timestamp ? (
                                                  <span className="text-[10px] font-bold text-gray-400 tabular-nums">
                                                    {new Date(s.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}
                                                  </span>
                                                ) : (
                                                  <span className="text-[10px] font-semibold text-amber-700">
                                                    Enrolled · Not scanned yet
                                                  </span>
                                                )}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1.5 shrink-0">
                                            {getStatusBadge(s.status)}
                                            <div className="flex items-center gap-1 ml-1 pl-1.5 border-l border-gray-200">
                                              <button
                                                type="button"
                                                disabled={isBusy || s.status === 'P'}
                                                onClick={() => void handleQuickMarkLiveStudent(s, 'P')}
                                                title={`Mark ${s.name} Present`}
                                                className={`w-7 h-7 rounded-lg text-[10px] font-black transition-all active:scale-95 ${
                                                  s.status === 'P'
                                                    ? 'bg-emerald-600 text-white opacity-90 cursor-default'
                                                    : 'bg-white text-emerald-700 border border-emerald-200 hover:bg-emerald-600 hover:text-white'
                                                } disabled:opacity-60`}
                                              >
                                                P
                                              </button>
                                              <button
                                                type="button"
                                                disabled={isBusy}
                                                onClick={() => void handleQuickMarkLiveStudent(s, 'A', s.absenceReason || 'Absent')}
                                                title={`Mark ${s.name} Absent`}
                                                className={`w-7 h-7 rounded-lg text-[10px] font-black transition-all active:scale-95 ${
                                                  s.status === 'A'
                                                    ? 'bg-red-600 text-white'
                                                    : 'bg-white text-red-600 border border-red-200 hover:bg-red-600 hover:text-white'
                                                } disabled:opacity-60`}
                                              >
                                                A
                                              </button>
                                              <button
                                                type="button"
                                                disabled={isBusy}
                                                onClick={() =>
                                                  setEditingLiveStudent({
                                                    studentId: s.studentId,
                                                    name: s.name,
                                                    status: s.isUnscanned ? 'A' : s.status,
                                                    reason: s.absenceReason || '',
                                                    isUnscanned: s.isUnscanned,
                                                  })
                                                }
                                                title={`Edit status & note for ${s.name}`}
                                                aria-label={`Edit status for ${s.name}`}
                                                className="w-7 h-7 rounded-lg bg-white text-gray-500 border border-gray-200 hover:border-indigo-300 hover:text-indigo-600 flex items-center justify-center transition-all active:scale-95"
                                              >
                                                <PencilSquareIcon className="w-3.5 h-3.5" />
                                              </button>
                                            </div>
                                        </div>
                                    </div>
                                    {s.absenceReason && (
                                        <div className="ml-8 flex flex-wrap items-center gap-3 mt-0.5 pt-2 border-t border-gray-200/60">
                                            <div className="flex items-center gap-2 px-2.5 py-1 bg-white rounded-lg border border-gray-100 shadow-xs flex-1 min-w-0">
                                                <span className="text-[9px] font-bold text-gray-400 uppercase tracking-tighter shrink-0">Note</span>
                                                <span className="text-[10px] font-bold text-gray-600 truncate italic" title={s.absenceReason}>"{s.absenceReason}"</span>
                                            </div>
                                        </div>
                                    )}
                                </li>
                                );
                            })}
                        </ul>
                    ) : (
                        <div className="flex flex-col items-center justify-center h-full text-center p-8">
                            <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mb-4 text-gray-200"><ListBulletIcon className="w-8 h-8" /></div>
                            <p className="text-sm font-bold text-gray-400 uppercase tracking-widest">
                              {attendanceFilterMode === 'not_scanned'
                                ? knownStudents.length === 0
                                  ? 'No enrolled student roster uploaded yet'
                                  : 'All enrolled students have been recorded'
                                : attendanceFilterMode === 'absent_unscanned'
                                  ? 'No absent or unscanned students'
                                  : attendanceFilterMode === 'present'
                                    ? 'No present check-ins yet'
                                    : 'Waiting for check-ins...'}
                            </p>
                        </div>
                    )
                ) : (
                    filteredHistory.length > 0 ? (
                        <ul className="space-y-3">
                            {filteredHistory.map((s, idx) => (
                                <li key={`${s.studentId}-${s.timestamp}-${idx}`} className="flex flex-col gap-2 p-4 bg-gray-50/50 rounded-2xl border-2 border-transparent hover:border-gray-100 transition-all group">
                                    <div className="flex items-center gap-4">
                                        <div className="w-10 h-10 bg-indigo-50 text-indigo-400 rounded-xl flex items-center justify-center font-bold text-xs shrink-0">{s.name.charAt(0)}</div>
                                        <div className="flex-1 min-w-0">
                                            <p className="font-bold text-sm text-gray-900 truncate leading-tight mb-0.5">{s.name}</p>
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="text-[10px] font-mono font-bold text-gray-400 bg-white px-2 rounded-md border border-gray-100">{s.studentId}</span>
                                                {s.week && (
                                                  <span className="text-[10px] font-mono font-bold text-indigo-600 tabular-nums">{s.week}</span>
                                                )}
                                                <span className="text-[10px] font-bold text-gray-300 tabular-nums">
                                                    {new Date(s.timestamp).toLocaleDateString()} {new Date(s.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="flex flex-col items-end gap-1 shrink-0">
                                            {getStatusBadge(s.status)}
                                            <button onClick={(e) => { e.stopPropagation(); handleDeleteHistoryItem(s.timestamp, s.studentId); }} className="text-gray-300 hover:text-red-500 transition-colors p-1"><TrashIcon className="w-3.5 h-3.5" /></button>
                                        </div>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <div className="flex flex-col items-center justify-center h-full text-center p-8">
                            <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mb-4 text-gray-200"><HistoryIcon className="w-8 h-8" /></div>
                            <p className="text-sm font-bold text-gray-300 uppercase tracking-widest">No history recorded yet</p>
                        </div>
                    )
                )}
            </div>
            )}
            {activeTab === 'attendance' && selectedIds.size > 0 && (() => {
              const selectedArr = Array.from(selectedIds);
              const recordedSelected = selectedArr.filter(id =>
                liveStudentNormIds.has(id.trim().replace(/\s+/g, '').toUpperCase())
              );
              return (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 p-3 bg-indigo-50/70 rounded-2xl border border-indigo-200 animate-in slide-in-from-bottom-4">
                    <span className="text-xs font-bold text-indigo-800 ml-1 tabular-nums">{selectedIds.size} SELECTED</span>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setConfirmation({
                            action: 'P',
                            targetIds: selectedArr,
                            label: `Mark ${selectedArr.length} Selected Student${selectedArr.length === 1 ? '' : 's'} Present`,
                            count: selectedArr.length,
                          })
                        }
                        className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 text-white rounded-xl text-[10px] font-bold uppercase hover:bg-emerald-700 transition-all shadow-sm active:scale-95"
                      >
                        <CheckIcon className="w-3.5 h-3.5" /> Mark Present
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setConfirmation({
                            action: 'A',
                            targetIds: selectedArr,
                            label: `Mark ${selectedArr.length} Selected Student${selectedArr.length === 1 ? '' : 's'} Absent`,
                            count: selectedArr.length,
                            reason: 'Absent',
                          })
                        }
                        className="flex items-center gap-1.5 px-3 py-2 bg-amber-600 text-white rounded-xl text-[10px] font-bold uppercase hover:bg-amber-700 transition-all shadow-sm active:scale-95"
                      >
                        <XMarkIcon className="w-3.5 h-3.5" /> Mark Absent
                      </button>
                      {recordedSelected.length > 0 && (
                        <button
                          type="button"
                          onClick={() => { onRemoveStudents(recordedSelected, courseName); setSelectedIds(new Set()); }}
                          className="flex items-center gap-1.5 px-3 py-2 bg-red-600 text-white rounded-xl text-[10px] font-bold uppercase hover:bg-red-700 transition-all shadow-sm active:scale-95"
                        >
                          <TrashIcon className="w-3.5 h-3.5" /> Remove ({recordedSelected.length})
                        </button>
                      )}
                    </div>
                </div>
              );
            })()}
        </div>
      </div>
       
      {showSettingsModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-[110] flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-300">
            <div className="bg-white w-full max-w-2xl rounded-3xl sm:rounded-[2.5rem] shadow-2xl max-h-[90vh] overflow-hidden flex flex-col">
                <div className="p-5 sm:p-8 border-b border-gray-50 flex justify-between items-center bg-gray-50/50">
                    <div className="flex items-center gap-3 sm:gap-4">
                        <div className="w-10 h-10 bg-indigo-600 text-white rounded-xl flex items-center justify-center shadow-lg shrink-0"><AdjustmentsHorizontalIcon className="w-6 h-6" /></div>
                        <h2 className="text-xl sm:text-2xl font-bold text-gray-900 tracking-tight">System Settings</h2>
                    </div>
                    <button onClick={() => setShowSettingsModal(false)} className="w-10 h-10 bg-white border border-gray-200 text-gray-400 hover:text-gray-900 transition-all rounded-full flex items-center justify-center active:scale-90 shrink-0"><XCircleIcon className="w-6 h-6" /></button>
                </div>
                <div className="p-5 sm:p-8 space-y-6 sm:space-y-8 overflow-y-auto custom-scrollbar">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-4">
                            <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em] ml-1">QR Generation</h3>
                            <div className="bg-gray-50 p-5 rounded-3xl space-y-4 border border-gray-100">
                                <div>
                                    <label className="block text-xs font-bold text-gray-600 mb-2 ml-1">Error Correction</label>
                                    <select value={qrErrorCorrection} onChange={e => {
                                        const val = e.target.value as 'L' | 'M' | 'Q' | 'H';
                                        localStorage.setItem('qr-error-correction', val);
                                        window.location.reload(); // Simple way to update since we removed state
                                    }} className="w-full text-sm font-bold rounded-xl border-gray-200 bg-white p-3 shadow-sm focus:ring-0 focus:border-brand-primary">
                                        <option value="L">Level L (7%)</option>
                                        <option value="M">Level M (15%)</option>
                                        <option value="Q">Level Q (25%)</option>
                                        <option value="H">Level H (30%)</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-600 mb-2 ml-1">QR Padding ({qrMargin}px)</label>
                                    <input type="range" min="0" max="10" value={qrMargin} onChange={e => {
                                        const val = e.target.value;
                                        localStorage.setItem('qr-margin', val);
                                        window.location.reload();
                                    }} className="w-full h-2 bg-white rounded-lg appearance-none cursor-pointer accent-brand-primary border border-gray-200" />
                                </div>
                            </div>
                        </div>
                        <div className="space-y-4">
                            <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em] ml-1">Session Protocol</h3>
                            <div className="bg-gray-50 p-5 rounded-3xl space-y-4 border border-gray-100">
                                <label className="flex items-center justify-between cursor-pointer p-3 bg-white rounded-xl border border-gray-100 shadow-sm active:scale-[0.98] transition-all">
                                    <div className="flex flex-col">
                                        <span className="text-xs font-bold text-gray-800">Geolocation</span>
                                        <div className="flex items-center gap-2 mt-1">
                                            <span className="text-[9px] font-bold text-gray-400 uppercase">Proximity Check</span>
                                            {locationStatus === 'fetching' && <span className="text-[9px] font-bold text-blue-500 uppercase">FETCHING...</span>}
                                            {locationStatus === 'success' && <span className="text-[9px] font-bold text-green-500 uppercase flex items-center gap-1"><CheckIcon className="w-3 h-3"/>LOCKED</span>}
                                            {locationStatus === 'denied' && <span className="text-[9px] font-bold text-red-500 uppercase">DENIED</span>}
                                            {locationStatus === 'error' && <span className="text-[9px] font-bold text-red-500 uppercase">ERROR</span>}
                                        </div>
                                    </div>
                                    <input 
                                        type="checkbox" 
                                        checked={isGeoEnabled} 
                                        onChange={(e) => handleGeoToggle(e.target.checked)} 
                                        className="w-6 h-6 rounded-md border-2 border-gray-100 text-brand-primary focus:ring-0 transition-all" 
                                    />
                                </label>
                                <label className="flex items-center justify-between cursor-pointer p-3 bg-white rounded-xl border border-gray-100 shadow-sm active:scale-[0.98] transition-all">
                                    <div className="flex flex-col"><span className="text-xs font-bold text-gray-800">Reverse Scan</span><span className="text-[9px] font-bold text-gray-400 uppercase">Lecturer Scans Stu</span></div>
                                    <input type="checkbox" checked={isOfflineMode} onChange={(e) => setIsOfflineMode(e.target.checked)} className="w-6 h-6 rounded-md border-2 border-gray-100 text-brand-primary focus:ring-0 transition-all" />
                                </label>
                            </div>
                        </div>
                    </div>
                    <div className="space-y-4">
                        <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em] ml-1">Cloud Synchronization</h3>
                        <CloudIntegrationSettings 
                            scriptUrl={scriptUrl} 
                            onScriptUrlChange={onScriptUrlChange} 
                            onSendTestRecord={() => onSendTestRecord(courseName)} 
                            onCheckPendingRecords={onCheckPendingRecords} 
                            onClearPendingQueue={onClearPendingQueue}
                            onForceSync={onForceSync} 
                            selectedWeek={selectedWeek}
                            integrationType={integrationType}
                            onIntegrationTypeChange={onIntegrationTypeChange}
                            firebaseDatabaseUrl={firebaseDatabaseUrl}
                            isAdmin={isAdmin}
                        />
                    </div>
                    <div className="space-y-4">
                        <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em] ml-1">Student Management</h3>
                        <div className="bg-gray-50 p-4 sm:p-5 rounded-3xl border border-gray-100 flex flex-col gap-4">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                <div className="flex flex-col">
                                    <span className="text-xs font-bold text-gray-800">Import Student List</span>
                                    <span className="text-[9px] font-bold text-gray-400 uppercase">CSV Format: StudentID, Name</span>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    <button 
                                        onClick={handleDownloadTemplate}
                                        className="flex items-center gap-1.5 bg-white text-gray-600 text-[10px] font-bold px-3 sm:px-4 py-2 rounded-xl hover:shadow-md transition-all active:scale-95 uppercase border border-gray-200"
                                    >
                                        <ArrowDownTrayIcon className="w-3.5 h-3.5" />
                                        Template
                                    </button>
                                    <button 
                                        onClick={() => setShowStudentListModal(true)}
                                        className="flex items-center gap-1.5 bg-white text-gray-600 text-[10px] font-bold px-3 sm:px-4 py-2 rounded-xl hover:shadow-md transition-all active:scale-95 uppercase border border-gray-200"
                                    >
                                        <ListBulletIcon className="w-3.5 h-3.5" />
                                        Manage
                                    </button>
                                    <button 
                                        onClick={() => fileInputRef.current?.click()}
                                        className="flex items-center gap-1.5 bg-white text-indigo-600 text-[10px] font-bold px-3 sm:px-4 py-2 rounded-xl hover:shadow-md transition-all active:scale-95 uppercase border border-indigo-100"
                                    >
                                        <ArrowDownTrayIcon className="w-3.5 h-3.5 rotate-180" />
                                        Upload CSV
                                    </button>
                                </div>
                                <input 
                                    type="file" 
                                    ref={fileInputRef} 
                                    onChange={handleFileUpload} 
                                    accept=".csv" 
                                    className="hidden" 
                                />
                            </div>
                            <div className="h-[1px] bg-gray-200 w-full"></div>
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                <div className="flex flex-col">
                                    <span className="text-xs font-bold text-gray-800">Data Management</span>
                                    <span className="text-[9px] font-bold text-gray-400 uppercase">Clear stored records</span>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    <button 
                                        onClick={handleClearKnownStudents}
                                        className="flex items-center gap-1.5 bg-white text-red-600 text-[10px] font-bold px-3 sm:px-4 py-2 rounded-xl hover:shadow-md transition-all active:scale-95 uppercase border border-red-100"
                                    >
                                        <TrashIcon className="w-3.5 h-3.5" />
                                        Clear List
                                    </button>
                                    <button 
                                        onClick={handleClearTeacherHistory}
                                        className="flex items-center gap-1.5 bg-white text-red-600 text-[10px] font-bold px-3 sm:px-4 py-2 rounded-xl hover:shadow-md transition-all active:scale-95 uppercase border border-red-100"
                                    >
                                        <HistoryIcon className="w-3.5 h-3.5" />
                                        Clear History
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                    {onRequestAccountDeletion && (
                      <div className="space-y-4">
                        <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em] ml-1">Account Deletion</h3>
                        <div className="bg-red-50/50 p-4 sm:p-5 rounded-3xl border border-red-100 space-y-3">
                          <div className="flex flex-col gap-1">
                            <span className="text-xs font-bold text-gray-900">
                              Signed up by mistake or want to delete your account?
                            </span>
                            <span className="text-[11px] font-medium text-gray-600">
                              {isAdmin
                                ? 'The built-in Admin account is protected. Lecturer deletion requests submitted from Settings appear in Admin Control.'
                                : `Submit a deletion request for "${currentAdminName}" to notify the Administrator.`}
                            </span>
                          </div>
                          {!isAdmin && (
                            <div className="space-y-3 pt-1">
                              <div className="flex flex-col sm:flex-row gap-2">
                                <select
                                  aria-label="Account deletion reason"
                                  value={deleteReason}
                                  onChange={(e) => setDeleteReason(e.target.value)}
                                  className="flex-1 text-xs font-semibold rounded-xl border border-red-200 bg-white px-3 py-2.5 text-gray-800 outline-none focus:border-red-400"
                                >
                                  <option value="Signed up by mistake">Signed up by mistake</option>
                                  <option value="Wrong email or username entered">Wrong email or username entered</option>
                                  <option value="Account no longer needed">Account no longer needed</option>
                                  <option value="Other">Other reason...</option>
                                </select>
                                <button
                                  type="button"
                                  disabled={isSubmittingDeleteRequest}
                                  onClick={async () => {
                                    if (isSubmittingDeleteRequest) return;
                                    const finalReason =
                                      deleteReason === 'Other'
                                        ? customDeleteReason.trim() || 'Requested account deletion via settings'
                                        : deleteReason;
                                    setIsSubmittingDeleteRequest(true);
                                    setDeleteRequestFeedback(null);
                                    try {
                                      const result = await onRequestAccountDeletion({
                                        usernameOrEmail: currentAdminName,
                                        reason: finalReason,
                                      });
                                      setDeleteRequestFeedback({
                                        type: result.success ? 'success' : 'error',
                                        message: result.message,
                                      });
                                      if (result.success) {
                                        setCustomDeleteReason('');
                                        showToast('success', result.message);
                                      } else {
                                        showToast('error', result.message);
                                      }
                                    } finally {
                                      setIsSubmittingDeleteRequest(false);
                                    }
                                  }}
                                  className="px-4 py-2.5 bg-red-600 text-white rounded-xl text-[11px] font-bold uppercase tracking-wider hover:bg-red-700 transition-colors active:scale-95 disabled:opacity-50 whitespace-nowrap shrink-0"
                                >
                                  {isSubmittingDeleteRequest ? 'Sending...' : 'Request Admin'}
                                </button>
                              </div>
                              {deleteReason === 'Other' && (
                                <textarea
                                  value={customDeleteReason}
                                  onChange={(e) => setCustomDeleteReason(e.target.value)}
                                  placeholder="Explain why you want Admin to delete this account..."
                                  className="w-full text-xs font-medium rounded-xl border border-red-200 bg-white p-3 text-gray-800 outline-none focus:border-red-400 min-h-[72px]"
                                />
                              )}
                              {deleteRequestFeedback && (
                                <div
                                  className={`text-[11px] font-bold px-3 py-2 rounded-xl border ${
                                    deleteRequestFeedback.type === 'success'
                                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                      : 'bg-red-50 text-red-700 border-red-200'
                                  }`}
                                >
                                  {deleteRequestFeedback.message}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                </div>
            </div>
        </div>
      )}

      {showStudentListModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-[130] flex items-center justify-center p-3 sm:p-4">
            <div className="bg-white w-full max-w-md rounded-3xl sm:rounded-[2.5rem] shadow-2xl p-5 sm:p-8 relative overflow-hidden flex flex-col max-h-[90vh]">
                <div className="flex items-center justify-between mb-6 shrink-0 gap-2">
                    <h2 className="text-2xl font-bold text-gray-900 tracking-tight">Student List</h2>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => fetchCourseFromB1(true, 'active-only')}
                            disabled={isLoadingSheetCourse}
                            className="text-[10px] font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 px-3 py-1.5 rounded-xl transition-all disabled:opacity-50"
                        >
                            {isLoadingSheetCourse ? 'Syncing...' : 'Sync Sheet'}
                        </button>
                        <button onClick={() => setShowStudentListModal(false)} className="text-gray-300 hover:text-gray-900 transition-all active:scale-90"><XCircleIcon className="w-8 h-8"/></button>
                    </div>
                </div>
                
                <div className="mb-4 shrink-0 flex gap-2">
                    <div className="relative flex-1">
                        <MagnifyingGlassIcon className="w-4 h-4 text-gray-400 absolute top-1/2 left-3 -translate-y-1/2" />
                        <input 
                            type="text" 
                            placeholder="Search by ID or Name..." 
                            value={studentListFilter}
                            onChange={(e) => setStudentListFilter(e.target.value)}
                            className="w-full pl-9 pr-4 py-3 bg-gray-50 border-2 border-gray-100 rounded-xl text-xs font-bold focus:bg-white focus:border-brand-primary outline-none transition-all"
                        />
                    </div>
                    <button 
                        onClick={() => {
                            const groups = Object.keys(
                                knownStudents.reduce((acc, s) => {
                                    const key = s.id.charAt(0).toUpperCase() || '#';
                                    acc[key] = true;
                                    return acc;
                                }, {} as Record<string, boolean>)
                            );
                            toggleAllGroups(groups);
                        }}
                        className="px-3 bg-gray-50 border-2 border-gray-100 rounded-xl text-gray-500 hover:bg-gray-100 hover:text-gray-900 transition-all active:scale-95"
                        title="Toggle All"
                    >
                        <ChevronDownIcon className={`w-5 h-5 transition-transform duration-300 ${collapsedGroups.size > 0 ? '-rotate-180' : ''}`} />
                    </button>
                </div>

                {knownStudents.length > 0 && (
                    <div className="flex items-center justify-between mb-4 bg-gray-50 p-2 rounded-xl border border-gray-100 shrink-0">
                        <div className="flex items-center gap-2 px-2">
                            <input 
                                type="checkbox" 
                                checked={
                                    knownStudents.filter(s => s.name.toLowerCase().includes(studentListFilter.toLowerCase()) || s.id.toLowerCase().includes(studentListFilter.toLowerCase())).length > 0 &&
                                    knownStudents.filter(s => s.name.toLowerCase().includes(studentListFilter.toLowerCase()) || s.id.toLowerCase().includes(studentListFilter.toLowerCase())).every(s => selectedStudentListIds.has(s.id))
                                }
                                onChange={(e) => {
                                    const visibleStudents = knownStudents.filter(s => s.name.toLowerCase().includes(studentListFilter.toLowerCase()) || s.id.toLowerCase().includes(studentListFilter.toLowerCase()));
                                    const newSet = new Set(selectedStudentListIds);
                                    if (e.target.checked) {
                                        visibleStudents.forEach(s => newSet.add(s.id));
                                    } else {
                                        visibleStudents.forEach(s => newSet.delete(s.id));
                                    }
                                    setSelectedStudentListIds(newSet);
                                }}
                                className="w-4 h-4 text-brand-primary rounded border-gray-300 focus:ring-brand-primary"
                            />
                            <span className="text-[10px] font-bold text-gray-500 uppercase">Select All {studentListFilter ? 'Filtered' : ''}</span>
                        </div>
                        {selectedStudentListIds.size > 0 && (
                            <button 
                                onClick={handleBulkDeleteKnownStudents}
                                className="flex items-center gap-1 bg-red-100 text-red-600 text-[10px] font-bold px-3 py-1.5 rounded-lg hover:bg-red-200 transition-all active:scale-95 uppercase"
                            >
                                <TrashIcon className="w-3.5 h-3.5" />
                                Delete ({selectedStudentListIds.size})
                            </button>
                        )}
                    </div>
                )}

                <div className="space-y-4 overflow-y-auto custom-scrollbar pr-2">
                    {knownStudents.length === 0 ? (
                        <p className="text-center text-gray-400 font-bold text-sm py-8">No students in list.</p>
                    ) : (
                        Object.entries(
                            knownStudents
                                .filter(s => s.name.toLowerCase().includes(studentListFilter.toLowerCase()) || s.id.toLowerCase().includes(studentListFilter.toLowerCase()))
                                .sort((a, b) => a.id.localeCompare(b.id))
                                .reduce((groups, s) => {
                                    const key = s.id.charAt(0).toUpperCase() || '#';
                                    if (!groups[key]) groups[key] = [];
                                    groups[key].push(s);
                                    return groups;
                                }, {} as Record<string, typeof knownStudents>)
                        ).sort((a, b) => a[0].localeCompare(b[0])).map(([groupKey, students]) => (
                            <div key={groupKey} className="rounded-xl overflow-hidden border border-transparent transition-all">
                                <div className="w-full flex items-center justify-between bg-white py-2 px-1 hover:bg-gray-50 transition-colors group sticky top-0 z-10">
                                    <div className="flex items-center gap-2">
                                        <input 
                                            type="checkbox" 
                                            checked={students.length > 0 && students.every(s => selectedStudentListIds.has(s.id))}
                                            onChange={(e) => {
                                                const newSet = new Set(selectedStudentListIds);
                                                if (e.target.checked) {
                                                    students.forEach(s => newSet.add(s.id));
                                                } else {
                                                    students.forEach(s => newSet.delete(s.id));
                                                }
                                                setSelectedStudentListIds(newSet);
                                            }}
                                            className="w-3.5 h-3.5 text-brand-primary rounded border-gray-300 focus:ring-brand-primary ml-1"
                                        />
                                        <button onClick={() => toggleGroup(groupKey)} className="flex items-center gap-1">
                                            <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest group-hover:text-brand-primary transition-colors">{groupKey} <span className="text-gray-300 text-[9px]">({students.length})</span></h3>
                                        </button>
                                    </div>
                                    <button onClick={() => toggleGroup(groupKey)} className="p-1">
                                        <ChevronDownIcon className={`w-4 h-4 text-gray-300 group-hover:text-brand-primary transition-all duration-300 ${collapsedGroups.has(groupKey) ? '-rotate-90' : ''}`} />
                                    </button>
                                </div>
                                
                                <div className={`space-y-2 transition-all duration-300 origin-top ${collapsedGroups.has(groupKey) ? 'hidden' : 'block'}`}>
                                    {students.map(s => (
                                        <div key={s.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl border border-gray-100 group hover:border-brand-primary/20 transition-all">
                                            <div className="flex items-center gap-3">
                                                <input 
                                                    type="checkbox" 
                                                    checked={selectedStudentListIds.has(s.id)}
                                                    onChange={(e) => {
                                                        const newSet = new Set(selectedStudentListIds);
                                                        if (e.target.checked) newSet.add(s.id);
                                                        else newSet.delete(s.id);
                                                        setSelectedStudentListIds(newSet);
                                                    }}
                                                    className="w-4 h-4 text-brand-primary rounded border-gray-300 focus:ring-brand-primary"
                                                />
                                                <div>
                                                    <p className="font-bold text-xs text-gray-900">{s.name}</p>
                                                    <p className="font-mono text-[10px] text-gray-400 group-hover:text-brand-primary transition-colors">{s.id}</p>
                                                </div>
                                            </div>
                                            <button type="button" onClick={() => handleDeleteKnownStudent(s.id, s.name)} className="text-gray-400 hover:text-red-500 p-2 transition-colors" title={`Delete ${s.name}`} aria-label={`Delete ${s.name}`}><TrashIcon className="w-4 h-4" /></button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))
                    )}
                    {knownStudents.length > 0 && knownStudents.filter(s => s.name.toLowerCase().includes(studentListFilter.toLowerCase()) || s.id.toLowerCase().includes(studentListFilter.toLowerCase())).length === 0 && (
                        <p className="text-center text-gray-400 font-bold text-xs py-4">No matches found.</p>
                    )}
                </div>
            </div>
        </div>
      )}

      {showManualModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-[120] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-[2.5rem] shadow-2xl p-8 relative overflow-y-auto max-h-[90vh]">
            <button onClick={() => setShowManualModal(false)} className="absolute top-6 right-6 text-gray-300 hover:text-gray-900 transition-all active:scale-90"><XCircleIcon className="w-8 h-8"/></button>
            <h2 className="text-2xl font-bold text-gray-900 mb-6 tracking-tight">Manual Entry</h2>
            <div className="space-y-5">
               <div className="relative">
                 <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 ml-1">Student ID</label>
                 <input
                   type="text"
                   value={manualId}
                   onChange={handleManualIdChange}
                   onFocus={() => { if (normalizeStudentId(manualId).length >= 2) setManualSuggestionField('id'); }}
                   onBlur={() => setTimeout(() => setManualSuggestionField((prev) => (prev === 'id' ? null : prev)), 150)}
                   placeholder="Enter Student ID (auto-fills name)"
                   className="w-full border-2 border-gray-50 bg-gray-50/50 rounded-2xl p-4 font-mono font-bold uppercase focus:bg-white focus:border-brand-primary transition-all outline-none placeholder:font-sans placeholder:text-gray-400 placeholder:text-xs placeholder:normal-case"
                 />
                 {manualIdSuggestions.length > 0 && (
                   <ul className="absolute z-30 left-0 right-0 mt-1 bg-white border-2 border-indigo-100 rounded-2xl shadow-xl max-h-40 overflow-y-auto divide-y divide-gray-50">
                     {manualIdSuggestions.map((s) => (
                       <li key={s.id}>
                         <button
                           type="button"
                           onMouseDown={(e) => {
                             e.preventDefault();
                             selectManualSuggestedStudent(s);
                           }}
                           className="w-full text-left px-4 py-2 hover:bg-indigo-50 flex items-center justify-between gap-2"
                         >
                           <span className="text-xs font-bold text-gray-900 truncate">{s.name}</span>
                           <span className="text-[11px] font-mono font-bold text-indigo-600 shrink-0">{s.id}</span>
                         </button>
                       </li>
                     ))}
                   </ul>
                 )}
               </div>
               <div className="relative">
                 <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 ml-1">Full Name</label>
                 <input
                   type="text"
                   value={manualName}
                   onChange={handleManualNameChange}
                   onFocus={() => { if (normalizeStudentName(manualName).length >= 2) setManualSuggestionField('name'); }}
                   onBlur={() => setTimeout(() => setManualSuggestionField((prev) => (prev === 'name' ? null : prev)), 150)}
                   placeholder="Enter Full Name (auto-fills Student ID)"
                   className="w-full border-2 border-gray-50 bg-gray-50/50 rounded-2xl p-4 font-bold uppercase focus:bg-white focus:border-brand-primary transition-all outline-none placeholder:text-gray-400 placeholder:text-xs placeholder:normal-case"
                 />
                 {manualNameSuggestions.length > 0 && (
                   <ul className="absolute z-30 left-0 right-0 mt-1 bg-white border-2 border-indigo-100 rounded-2xl shadow-xl max-h-40 overflow-y-auto divide-y divide-gray-50">
                     {manualNameSuggestions.map((s) => (
                       <li key={s.id}>
                         <button
                           type="button"
                           onMouseDown={(e) => {
                             e.preventDefault();
                             selectManualSuggestedStudent(s);
                           }}
                           className="w-full text-left px-4 py-2 hover:bg-indigo-50 flex items-center justify-between gap-2"
                         >
                           <span className="text-xs font-bold text-gray-900 truncate">{s.name}</span>
                           <span className="text-[11px] font-mono font-bold text-indigo-600 shrink-0">{s.id}</span>
                         </button>
                       </li>
                     ))}
                   </ul>
                 )}
               </div>
               <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 ml-1">Status</label>
                  <select value={manualStatus} onChange={(e) => setManualStatus(e.target.value)} className="w-full border-2 border-gray-50 bg-gray-50/50 rounded-2xl p-4 font-bold focus:bg-white focus:border-brand-primary transition-all outline-none appearance-none">
                      <option value="P">Present</option>
                      <option value="A">Absent</option>
                      <option value="M">Medical</option>
                      <option value="E">Exempt</option>
                  </select>
               </div>
               <div><label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 ml-1">Note / Reason</label><textarea value={manualReason} onChange={(e) => setManualReason(e.target.value)} className="w-full border-2 border-gray-50 bg-gray-50/50 rounded-2xl p-4 font-bold text-xs min-h-[80px] focus:bg-white focus:border-brand-primary transition-all outline-none" placeholder="Reason for status..."></textarea></div>
               {manualError && <p className="text-xs text-red-500 font-bold bg-red-50 p-3 rounded-xl border border-red-100 text-center">{manualError}</p>}
               <button onClick={submitManualAdd} className="w-full bg-indigo-600 text-white font-bold py-4 rounded-2xl hover:bg-indigo-700 transition-all active:scale-95 shadow-lg shadow-indigo-100 uppercase tracking-widest text-xs mt-2">Add Entry</button>
            </div>
          </div>
        </div>
      )}

      {showNewSessionModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-[200] flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-sm rounded-[2.5rem] shadow-2xl p-10 text-center border-t-8 border-indigo-600">
                <div className="w-16 h-16 bg-indigo-50 text-indigo-600 rounded-3xl flex items-center justify-center mx-auto mb-6"><PlusIcon className="w-10 h-10" /></div>
                <h2 className="text-2xl font-bold text-gray-900 mb-2 tracking-tight">New Session?</h2>
                <p className="text-sm text-gray-400 font-bold mb-8 uppercase tracking-widest">This clears all current entries.</p>
                <div className="flex gap-3">
                    <button onClick={() => setShowNewSessionModal(false)} className="flex-1 px-4 py-4 font-bold text-gray-400 bg-gray-100 rounded-2xl hover:bg-gray-200 transition-all uppercase text-[10px] tracking-widest">Cancel</button>
                    <button onClick={handleNewSession} className="flex-1 px-4 py-4 font-bold text-white bg-indigo-600 rounded-2xl hover:bg-indigo-700 transition-all uppercase text-[10px] tracking-widest shadow-lg shadow-indigo-100">Proceed</button>
                </div>
            </div>
        </div>
      )}

      {editingLiveStudent && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-[215] flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl p-6 sm:p-7 relative border-t-8 border-indigo-600 animate-in zoom-in duration-200">
            <button
              type="button"
              disabled={isSavingLiveStudent}
              onClick={() => setEditingLiveStudent(null)}
              className="absolute top-5 right-5 text-gray-300 hover:text-gray-900 transition-all"
            >
              <XCircleIcon className="w-6 h-6" />
            </button>
            <h3 className="text-lg font-bold text-gray-900 tracking-tight mb-1">
              Mark Student Status ({selectedWeek})
            </h3>
            <p className="text-xs font-bold text-gray-500 mb-4 tabular-nums">
              {editingLiveStudent.name} · <span className="font-mono">{editingLiveStudent.studentId}</span>
              {courseName ? ` · ${courseName}` : ''}
            </p>
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">
                  Status
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { code: 'P', label: 'Present', active: 'bg-emerald-600 text-white border-emerald-600' },
                    { code: 'A', label: 'Absent', active: 'bg-red-600 text-white border-red-600' },
                    { code: 'M', label: 'Medical', active: 'bg-amber-600 text-white border-amber-600' },
                    { code: 'E', label: 'Exempt', active: 'bg-indigo-600 text-white border-indigo-600' },
                  ].map((opt) => {
                    const isSelected = editingLiveStudent.status === opt.code;
                    return (
                      <button
                        key={opt.code}
                        type="button"
                        onClick={() =>
                          setEditingLiveStudent((prev) =>
                            prev ? { ...prev, status: opt.code, reason: opt.code === 'P' ? '' : prev.reason } : null
                          )
                        }
                        className={`px-3 py-2 rounded-xl text-xs font-bold border transition-all ${
                          isSelected ? opt.active : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100'
                        }`}
                      >
                        {opt.label} ({opt.code})
                      </button>
                    );
                  })}
                </div>
              </div>

              {editingLiveStudent.status !== 'P' && (
                <div className="space-y-2">
                  <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                    Reason / Note (Optional)
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {['Unexcused', 'Did not scan', 'Late', 'Medical Certificate', 'Approved Leave'].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() =>
                          setEditingLiveStudent((prev) => (prev ? { ...prev, reason: preset } : null))
                        }
                        className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-colors ${
                          editingLiveStudent.reason === preset
                            ? 'bg-indigo-50 text-indigo-700 border-indigo-300'
                            : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                  <input
                    type="text"
                    value={editingLiveStudent.reason}
                    onChange={(e) =>
                      setEditingLiveStudent((prev) => (prev ? { ...prev, reason: e.target.value } : null))
                    }
                    placeholder="Enter custom reason..."
                    className="w-full border border-gray-200 bg-gray-50 rounded-xl px-3.5 py-2.5 text-xs font-bold text-gray-800 focus:bg-white focus:border-indigo-600 outline-none"
                  />
                </div>
              )}

              <div className="flex gap-2.5 pt-1">
                <button
                  type="button"
                  disabled={isSavingLiveStudent}
                  onClick={() => setEditingLiveStudent(null)}
                  className="flex-1 py-2.5 rounded-xl font-bold text-[10px] uppercase tracking-widest text-gray-500 bg-gray-100 hover:bg-gray-200 transition-all"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isSavingLiveStudent}
                  onClick={async () => {
                    if (!editingLiveStudent) return;
                    setIsSavingLiveStudent(true);
                    try {
                      await handleQuickMarkLiveStudent(
                        {
                          studentId: editingLiveStudent.studentId,
                          name: editingLiveStudent.name,
                          status: editingLiveStudent.status,
                          isUnscanned: editingLiveStudent.isUnscanned,
                        },
                        editingLiveStudent.status as 'P' | 'A' | 'M' | 'E',
                        editingLiveStudent.status === 'P' ? '' : editingLiveStudent.reason.trim()
                      );
                      setEditingLiveStudent(null);
                    } finally {
                      setIsSavingLiveStudent(false);
                    }
                  }}
                  className="flex-1 py-2.5 rounded-xl font-bold text-[10px] uppercase tracking-widest text-white bg-indigo-600 hover:bg-indigo-700 transition-all shadow-md shadow-indigo-100 disabled:opacity-50"
                >
                  {isSavingLiveStudent ? 'Saving...' : 'Save Status'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {confirmation.action && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-[200] flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-md rounded-[2.5rem] shadow-2xl p-8">
                <div className="text-center mb-6">
                    <div className="w-16 h-16 bg-amber-50 text-amber-500 rounded-3xl flex items-center justify-center mx-auto mb-4"><ExclamationTriangleIcon className="w-10 h-10" /></div>
                    <h2 className="text-2xl font-bold text-gray-900 mb-2">{confirmation.label || `Update ${confirmation.count} Students`}</h2>
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Action: Set to {confirmation.action === 'P' ? 'Present' : 'Absent'}</p>
                </div>
                {confirmation.action === 'A' && (
                    <div className="mb-6">
                        <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 ml-1">Reason for Absence</label>
                        <input type="text" value={confirmation.reason || ''} onChange={(e) => setConfirmation({...confirmation, reason: e.target.value})} className="w-full border-2 border-gray-50 bg-gray-50/50 rounded-2xl p-4 text-xs font-bold outline-none focus:bg-white focus:border-brand-primary" placeholder="Reason (Optional)" />
                    </div>
                )}
                <div className="flex gap-4">
                    <button onClick={() => setConfirmation({ action: null, targetIds: [], label: '', count: 0 })} className="flex-1 px-4 py-4 font-bold text-gray-400 bg-gray-100 rounded-2xl hover:bg-gray-200 transition-all uppercase text-[10px]">Cancel</button>
                    <button
                      onClick={() => {
                        onBulkStatusUpdate(confirmation.targetIds, confirmation.action!, courseName, confirmation.reason);
                        setSelectedIds(new Set());
                        showToast('success', `Updated ${confirmation.targetIds.length} student${confirmation.targetIds.length === 1 ? '' : 's'} as ${confirmation.action === 'P' ? 'Present' : 'Absent'}.`);
                        setConfirmation({ action: null, targetIds: [], label: '', count: 0 });
                      }}
                      className="flex-1 px-4 py-4 font-bold text-white bg-indigo-600 rounded-2xl hover:bg-indigo-700 transition-all uppercase text-[10px] shadow-lg shadow-indigo-100"
                    >
                      Confirm
                    </button>
                </div>
            </div>
        </div>
      )}

      {scanResult && (
        <div className="fixed top-6 sm:top-8 left-1/2 -translate-x-1/2 z-[300] w-[calc(100%-2rem)] sm:w-auto max-w-md animate-in slide-in-from-top-10 duration-500">
            <div className={`px-5 sm:px-8 py-3.5 sm:py-4 rounded-3xl shadow-2xl flex items-center gap-3 sm:gap-4 border-4 ${scanResult.type === 'success' ? 'bg-green-600 border-green-500 text-white' : 'bg-red-600 border-red-500 text-white'}`}>
                <div className="bg-white/20 p-2 rounded-xl shrink-0">{scanResult.type === 'success' ? <CheckIcon className="w-5 h-5 sm:w-6 sm:h-6" /> : <XMarkIcon className="w-5 h-5 sm:w-6 sm:h-6" />}</div>
                <p className="font-bold text-xs sm:text-sm uppercase tracking-tight">{scanResult.message}</p>
            </div>
        </div>
      )}

      {pendingDeleteAction && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-[210] flex items-center justify-center p-3 sm:p-4">
            <div className="bg-white w-full max-w-sm rounded-3xl sm:rounded-[2.5rem] shadow-2xl p-6 sm:p-8 text-center border-t-8 border-red-500 animate-in zoom-in duration-200">
                <div className="w-16 h-16 bg-red-50 text-red-500 rounded-3xl flex items-center justify-center mx-auto mb-5"><TrashIcon className="w-9 h-9" /></div>
                <h2 className="text-xl font-bold text-gray-900 mb-2">
                  {pendingDeleteAction.type === 'single' ? 'Delete Student?' :
                   pendingDeleteAction.type === 'bulk' ? `Delete ${pendingDeleteAction.count} Students?` :
                   pendingDeleteAction.type === 'clear-list' ? 'Clear Student List?' :
                   pendingDeleteAction.type === 'delete-user' ? 'Remove User Account?' :
                   pendingDeleteAction.type === 'delete-course' ? 'Remove Subject Tab?' :
                   'Clear Scan History?'}
                </h2>
                <p className="text-xs font-bold text-gray-400 mb-7 leading-relaxed">
                  {pendingDeleteAction.type === 'single' ? `Remove ${pendingDeleteAction.name} (${pendingDeleteAction.id}) from the Student List?` :
                   pendingDeleteAction.type === 'bulk' ? `Remove ${pendingDeleteAction.count} selected student(s) from the Student List?` :
                   pendingDeleteAction.type === 'clear-list' ? 'This will remove all students from the known Student List. This cannot be undone.' :
                   pendingDeleteAction.type === 'delete-user' ? `Permanently remove user "${pendingDeleteAction.username}"${pendingDeleteAction.email ? ` (${pendingDeleteAction.email})` : ''} and revoke any active login sessions?` :
                   pendingDeleteAction.type === 'delete-course' ? `Remove subject "${pendingDeleteAction.courseName}" from the course tabs? (Existing Google Sheet data is preserved.)` :
                   'This will remove all saved scan history records across all devices.'}
                </p>
                <div className="flex gap-3">
                    <button type="button" onClick={() => setPendingDeleteAction(null)} className="flex-1 px-4 py-3.5 font-bold text-gray-500 bg-gray-100 rounded-2xl hover:bg-gray-200 transition-all uppercase text-[10px] tracking-widest">Cancel</button>
                    <button type="button" onClick={executePendingDeleteAction} className="flex-1 px-4 py-3.5 font-bold text-white bg-red-600 rounded-2xl hover:bg-red-700 transition-all uppercase text-[10px] tracking-widest shadow-lg shadow-red-100">Delete</button>
                </div>
            </div>
        </div>
      )}

      {resetPasswordModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-[215] flex items-center justify-center p-3 sm:p-4">
          <div className="bg-white w-full max-w-sm rounded-3xl sm:rounded-[2.5rem] shadow-2xl p-6 sm:p-8 border-t-8 border-indigo-600 animate-in zoom-in duration-200">
            <h2 className="text-xl font-bold text-gray-900 mb-1 text-center">Reset Account Password</h2>
            <p className="text-xs font-bold text-gray-400 mb-5 text-center">
              Set a new password for <span className="text-gray-700">{resetPasswordModal.user.username}</span>
              {resetPasswordModal.user.email ? ` (${resetPasswordModal.user.email})` : ''}
            </p>
            <div className="space-y-4 text-left">
              <div>
                <label htmlFor="admin-reset-pwd" className="block text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1.5 ml-1">
                  New Password (min 4 chars)
                </label>
                <input
                  id="admin-reset-pwd"
                  type="text"
                  value={resetPasswordModal.newPassword}
                  onChange={(e) =>
                    setResetPasswordModal(prev => (prev ? { ...prev, newPassword: e.target.value, error: undefined } : prev))
                  }
                  placeholder="Enter temporary password"
                  autoFocus
                  className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-sm font-bold text-gray-900 outline-none focus:border-brand-primary"
                />
              </div>
              {(resetPasswordModal.user.status || 'active') !== 'active' && (
                <label className="flex items-center gap-2.5 p-3 rounded-xl bg-indigo-50/70 border border-indigo-100 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={resetPasswordModal.activateAccount}
                    onChange={(e) =>
                      setResetPasswordModal(prev => (prev ? { ...prev, activateAccount: e.target.checked } : prev))
                    }
                    className="w-4 h-4 rounded accent-indigo-600"
                  />
                  <span className="text-xs font-bold text-indigo-900">
                    Activate account immediately (skip PIN)
                  </span>
                </label>
              )}
              {resetPasswordModal.error && (
                <div className="bg-red-50 text-red-600 text-xs font-bold p-2.5 rounded-xl border border-red-100 text-center">
                  {resetPasswordModal.error}
                </div>
              )}
              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  disabled={resetPasswordModal.isSaving}
                  onClick={() => setResetPasswordModal(null)}
                  className="flex-1 px-4 py-3.5 font-bold text-gray-500 bg-gray-100 rounded-2xl hover:bg-gray-200 transition-all uppercase text-[10px] tracking-widest"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={resetPasswordModal.isSaving}
                  onClick={async () => {
                    if (!onResetUserPassword) return;
                    if (resetPasswordModal.newPassword.trim().length < 4) {
                      setResetPasswordModal(prev =>
                        prev ? { ...prev, error: 'Password must be at least 4 characters.' } : prev
                      );
                      return;
                    }
                    setResetPasswordModal(prev => (prev ? { ...prev, isSaving: true, error: undefined } : prev));
                    const res = await onResetUserPassword({
                      userId: resetPasswordModal.user.id,
                      newPassword: resetPasswordModal.newPassword,
                      activateAccount: resetPasswordModal.activateAccount,
                    });
                    if (!res.success) {
                      setResetPasswordModal(prev =>
                        prev ? { ...prev, isSaving: false, error: res.error || 'Could not reset password.' } : prev
                      );
                      return;
                    }
                    showToast('success', `Password updated for "${resetPasswordModal.user.username}".`);
                    setResetPasswordModal(null);
                  }}
                  className="flex-1 px-4 py-3.5 font-bold text-white bg-indigo-600 rounded-2xl hover:bg-indigo-700 transition-all uppercase text-[10px] tracking-widest shadow-lg shadow-indigo-100 disabled:opacity-60"
                >
                  {resetPasswordModal.isSaving ? 'Saving...' : 'Save Password'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showWeekPromptModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-[220] flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200">
            <div className="bg-white w-full max-w-md rounded-3xl sm:rounded-[2.5rem] shadow-2xl p-6 sm:p-8 text-center border-t-8 border-amber-500 animate-in zoom-in duration-200 max-h-[92vh] overflow-y-auto">
                <h2 className="text-xl sm:text-2xl font-bold text-gray-900 mb-2 tracking-tight">Select Attendance Week</h2>
                <p className="text-xs font-bold text-gray-400 mb-5 sm:mb-6 leading-relaxed">
                  Choose the active week for today&apos;s attendance check-ins.
                </p>
                <div className="grid grid-cols-4 sm:grid-cols-7 gap-2 mb-5 sm:mb-6">
                  {WEEKS.map((w) => {
                    const isSelected = selectedWeek === w;
                    return (
                      <button
                        key={w}
                        type="button"
                        onClick={() => onWeekChange?.(w)}
                        className={`py-2.5 rounded-xl text-xs font-bold transition-all active:scale-95 ${
                          isSelected
                            ? 'bg-indigo-600 text-white shadow-md shadow-indigo-200 ring-2 ring-indigo-300'
                            : 'bg-gray-50 text-gray-600 hover:bg-gray-100 border border-gray-200'
                        }`}
                      >
                        {w}
                      </button>
                    );
                  })}
                </div>
                <div className="bg-gray-50 border border-gray-100 rounded-2xl p-3 mb-5 sm:mb-6 text-[11px] font-bold text-gray-500 space-y-2">
                  <div className="flex items-center justify-center gap-2 flex-wrap">
                    <span>Course Name: <strong className="text-gray-800">{courseName || 'Not set'}</strong></span>
                    <button
                      type="button"
                      onClick={() => fetchCourseFromB1(true, 'active-only')}
                      disabled={isLoadingSheetCourse}
                      className="text-[10px] text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-2.5 py-1 rounded-md border border-emerald-200 font-bold"
                    >
                      {isLoadingSheetCourse ? 'Syncing...' : 'Sync Course Name'}
                    </button>
                  </div>
                  {sheetReadError && (
                    <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-2.5 text-[10px] leading-relaxed">
                      <p>{sheetReadError}</p>
                      <button
                        type="button"
                        onClick={() => { setShowWeekPromptModal(false); setShowSettingsModal(true); }}
                        className="mt-1.5 inline-block text-indigo-700 bg-white border border-indigo-200 hover:bg-indigo-50 px-2.5 py-1 rounded-lg uppercase tracking-wider"
                      >
                        Open Cloud Settings
                      </button>
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setShowWeekPromptModal(false)}
                  className="w-full bg-indigo-600 text-white font-bold py-4 rounded-2xl hover:bg-indigo-700 transition-all active:scale-95 shadow-lg shadow-indigo-100 uppercase tracking-widest text-xs"
                >
                  CONFIRM
                </button>
            </div>
        </div>
      )}

      {showAddCourseModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-[220] flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-lg rounded-3xl sm:rounded-[2.5rem] shadow-2xl p-6 sm:p-8 relative border-t-8 border-indigo-600 animate-in zoom-in duration-200 max-h-[90vh] overflow-y-auto custom-scrollbar">
            <button
              type="button"
              onClick={closeAddCourseModal}
              className="absolute top-6 right-6 text-gray-300 hover:text-gray-900 transition-all active:scale-90"
            >
              <XCircleIcon className="w-7 h-7" />
            </button>
            <h2 className="text-xl sm:text-2xl font-bold text-gray-900 mb-2 tracking-tight">Add New Subject / Course</h2>
            <p className="text-xs font-bold text-gray-400 mb-5 leading-relaxed">
              Create a dedicated tab with its own attendance list, week setting, and registered student roster.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const clean = newCourseNameInput.trim();
                if (!clean) return;
                const count = newCourseStudents.length;
                const ownerToAssign = isAdmin && newCourseOwnerId ? newCourseOwnerId : undefined;
                const effectiveOwnerId = ownerToAssign || currentUserId;
                const cleanedCoLecturers = newCourseSharedWith.filter((id) => id && id !== effectiveOwnerId);
                onAddCourse?.(clean, newCourseStudents, ownerToAssign, cleanedCoLecturers);
                closeAddCourseModal();
                showToast(
                  'success',
                  count > 0
                    ? `Created "${clean}" with ${count} registered student${count === 1 ? '' : 's'}.`
                    : `Switched to "${clean}"`
                );
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5 ml-1">
                  Course / Subject Name
                </label>
                <input
                  type="text"
                  value={newCourseNameInput}
                  onChange={(e) => setNewCourseNameInput(e.target.value)}
                  placeholder="e.g., CSC 2104 DATA STRUCTURES"
                  className="w-full border-2 border-gray-100 bg-gray-50 rounded-2xl p-4 text-sm font-bold text-gray-900 focus:bg-white focus:border-indigo-600 outline-none transition-all"
                  autoFocus
                  required
                />
              </div>

              {isAdmin && collaboratorPool.length > 1 && (
                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5 ml-1">
                    Assign Owner
                  </label>
                  <select
                    value={newCourseOwnerId}
                    onChange={(e) => {
                      const nextOwner = e.target.value;
                      setNewCourseOwnerId(nextOwner);
                      setNewCourseSharedWith((prev) => prev.filter((id) => id !== nextOwner));
                    }}
                    className="font-sans w-full border-2 border-gray-100 bg-gray-50 rounded-2xl px-4 py-3 text-sm font-semibold text-gray-900 focus:bg-white focus:border-indigo-600 outline-none transition-all"
                  >
                    {collaboratorPool.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.username}{u.role === 'admin' ? ' (Admin)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {(() => {
                const effectiveOwnerId = (isAdmin && newCourseOwnerId) || currentUserId;
                const eligibleCoLecturers = collaboratorPool.filter((u) => u.id !== effectiveOwnerId);
                if (eligibleCoLecturers.length === 0) return null;
                return (
                  <div className="bg-gray-50 border border-gray-200 rounded-2xl p-3.5 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                        Share with Co-Lecturers (Optional)
                      </span>
                      {newCourseSharedWith.length > 0 && (
                        <span className="text-[10px] font-semibold text-indigo-600 tabular-nums">
                          {newCourseSharedWith.length} selected
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto custom-scrollbar">
                      {eligibleCoLecturers.map((u) => {
                        const checked = newCourseSharedWith.includes(u.id);
                        return (
                          <label
                            key={u.id}
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-semibold cursor-pointer transition-colors ${
                              checked
                                ? 'bg-indigo-50 border-indigo-300 text-indigo-800'
                                : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-100'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() =>
                                setNewCourseSharedWith((prev) =>
                                  prev.includes(u.id) ? prev.filter((id) => id !== u.id) : [...prev, u.id]
                                )
                              }
                              className="h-3.5 w-3.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                            />
                            <span>{u.username}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                  <div>
                    <span className="block text-xs font-bold text-gray-800">Upload Student List (Optional)</span>
                    <span className="block text-[10px] font-bold text-gray-400 uppercase tracking-wide">
                      CSV Format: StudentID, Name
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={handleDownloadTemplate}
                      className="flex items-center gap-1.5 bg-white text-gray-600 text-[10px] font-bold px-3 py-2 rounded-xl hover:shadow-sm transition-all active:scale-95 uppercase border border-gray-200 whitespace-nowrap"
                    >
                      <ArrowDownTrayIcon className="w-3.5 h-3.5" />
                      Template
                    </button>
                    <button
                      type="button"
                      onClick={() => addCourseFileInputRef.current?.click()}
                      className="flex items-center gap-1.5 bg-white text-indigo-600 text-[10px] font-bold px-3 py-2 rounded-xl hover:shadow-sm transition-all active:scale-95 uppercase border border-indigo-200 whitespace-nowrap"
                    >
                      <ArrowDownTrayIcon className="w-3.5 h-3.5 rotate-180" />
                      Upload CSV
                    </button>
                  </div>
                  <input
                    type="file"
                    ref={addCourseFileInputRef}
                    onChange={handleAddCourseFileUpload}
                    accept=".csv"
                    className="hidden"
                  />
                </div>

                {newCourseUploadError && (
                  <p className="text-[11px] font-bold text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                    {newCourseUploadError}
                  </p>
                )}

                {newCourseStudents.length > 0 && (
                  <div className="bg-white border border-emerald-200 rounded-xl p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 text-[11px] font-bold text-emerald-700 truncate">
                        <span>{newCourseUploadFileName || 'Roster CSV'}</span>
                        <span className="mx-1.5 text-emerald-400" aria-hidden="true">·</span>
                        <span className="tabular-nums">{newCourseStudents.length} student{newCourseStudents.length === 1 ? '' : 's'} ready</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setNewCourseStudents([]);
                          setNewCourseUploadFileName('');
                          setNewCourseUploadError(null);
                          if (addCourseFileInputRef.current) addCourseFileInputRef.current.value = '';
                        }}
                        className="text-[10px] font-bold text-gray-500 hover:text-red-600 uppercase shrink-0"
                      >
                        Clear
                      </button>
                    </div>
                    <div className="divide-y divide-gray-100 text-[11px] text-gray-600 max-h-28 overflow-y-auto custom-scrollbar">
                      {newCourseStudents.slice(0, 5).map((s) => (
                        <div key={s.id} className="py-1 flex items-center justify-between gap-3">
                          <span className="font-bold text-gray-800 truncate">{s.name}</span>
                          <span className="font-mono text-[10px] text-gray-400 shrink-0 tabular-nums">{s.id}</span>
                        </div>
                      ))}
                      {newCourseStudents.length > 5 && (
                        <div className="pt-1.5 text-[10px] font-bold text-gray-400 tabular-nums">
                          +{newCourseStudents.length - 5} more student{newCourseStudents.length - 5 === 1 ? '' : 's'}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeAddCourseModal}
                  className="flex-1 px-4 py-3.5 font-bold text-gray-500 bg-gray-100 rounded-2xl hover:bg-gray-200 transition-all uppercase text-[10px] tracking-widest"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-3.5 font-bold text-white bg-indigo-600 rounded-2xl hover:bg-indigo-700 transition-all uppercase text-[10px] tracking-widest shadow-lg shadow-indigo-100"
                >
                  Add
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editingMatrixCell && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-[225] flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl p-6 sm:p-7 relative border-t-8 border-indigo-600 animate-in zoom-in duration-200">
            <button
              type="button"
              onClick={() => !isSavingMatrixCell && setEditingMatrixCell(null)}
              className="absolute top-5 right-5 text-gray-300 hover:text-gray-900 transition-all"
            >
              <XCircleIcon className="w-6 h-6" />
            </button>
            <h3 className="text-lg font-bold text-gray-900 tracking-tight mb-1">
              Update Week {editingMatrixCell.week} Attendance
            </h3>
            <p className="text-xs font-bold text-gray-500 mb-4 tabular-nums">
              {editingMatrixCell.name} · <span className="font-mono">{editingMatrixCell.studentId}</span>
              {courseName ? ` · ${courseName}` : ''}
            </p>
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">
                  Absence / Excuse Note (Optional)
                </label>
                <input
                  type="text"
                  value={editingMatrixCell.reason}
                  onChange={(e) =>
                    setEditingMatrixCell((prev) => (prev ? { ...prev, reason: e.target.value } : null))
                  }
                  placeholder="e.g., Medical Certificate, Approved Leave"
                  className="w-full border border-gray-200 bg-gray-50 rounded-xl px-3.5 py-2.5 text-xs font-bold text-gray-800 focus:bg-white focus:border-indigo-600 outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  disabled={isSavingMatrixCell}
                  onClick={async () => {
                    if (!onUpdateMatrixCell) return;
                    setIsSavingMatrixCell(true);
                    try {
                      const res = await onUpdateMatrixCell({
                        studentId: editingMatrixCell.studentId,
                        name: editingMatrixCell.name,
                        courseName: courseName || 'General Session',
                        week: editingMatrixCell.week,
                        status: 'P',
                      });
                      if (res.success) {
                        showToast('success', `Marked ${editingMatrixCell.studentId} Present (${editingMatrixCell.week}).`);
                        setEditingMatrixCell(null);
                      } else {
                        showToast('error', res.message || 'Failed to update week record.');
                      }
                    } finally {
                      setIsSavingMatrixCell(false);
                    }
                  }}
                  className="px-4 py-3 rounded-xl font-bold text-xs uppercase tracking-wider bg-emerald-600 text-white hover:bg-emerald-700 transition-all disabled:opacity-50"
                >
                  Mark Present (P)
                </button>
                <button
                  type="button"
                  disabled={isSavingMatrixCell}
                  onClick={async () => {
                    if (!onUpdateMatrixCell) return;
                    setIsSavingMatrixCell(true);
                    try {
                      const res = await onUpdateMatrixCell({
                        studentId: editingMatrixCell.studentId,
                        name: editingMatrixCell.name,
                        courseName: courseName || 'General Session',
                        week: editingMatrixCell.week,
                        status: 'A',
                        absenceReason: editingMatrixCell.reason,
                      });
                      if (res.success) {
                        showToast('success', `Marked ${editingMatrixCell.studentId} Absent (${editingMatrixCell.week}).`);
                        setEditingMatrixCell(null);
                      } else {
                        showToast('error', res.message || 'Failed to update week record.');
                      }
                    } finally {
                      setIsSavingMatrixCell(false);
                    }
                  }}
                  className="px-4 py-3 rounded-xl font-bold text-xs uppercase tracking-wider bg-red-600 text-white hover:bg-red-700 transition-all disabled:opacity-50"
                >
                  Mark Absent (A)
                </button>
              </div>
              <button
                type="button"
                disabled={isSavingMatrixCell}
                onClick={() => setEditingMatrixCell(null)}
                className="w-full py-2.5 rounded-xl font-bold text-[10px] uppercase tracking-widest text-gray-500 bg-gray-100 hover:bg-gray-200 transition-all"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {sheetSyncModalItems && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-[250] flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-xl rounded-3xl sm:rounded-[2rem] shadow-2xl p-5 sm:p-7 relative border-t-8 border-emerald-600 flex flex-col max-h-[90vh] animate-in zoom-in duration-200">
            <button
              type="button"
              disabled={isConfirmingSheetSync}
              onClick={() => setSheetSyncModalItems(null)}
              className="absolute top-5 right-5 text-gray-300 hover:text-gray-900 transition-all"
            >
              <XCircleIcon className="w-7 h-7" />
            </button>

            <h2 className="text-lg sm:text-xl font-bold text-gray-900 tracking-tight pr-8">
              Select Sheet Tabs to Sync
            </h2>
            <p className="text-xs text-gray-500 mt-1 mb-4 leading-relaxed">
              {isAdmin
                ? 'Choose only new tabs to sync and assign each subject to its lecturer or Admin. Subjects already available in Subjects are skipped automatically so they will not be duplicated or re-synced.'
                : 'Select only new subjects that belong to you. Subjects already available in your Subjects or owned by another lecturer cannot be duplicated or re-synced.'}
            </p>

            {(() => {
              const normKey = (name: string) => name.replace(/\s+/g, ' ').trim().toUpperCase();
              const alreadySyncedCount = sheetSyncModalItems.filter((i) => i.alreadySynced).length;
              const lockedOnlyCount = sheetSyncModalItems.filter((i) => !i.alreadySynced && i.status === 'other').length;
              const syncableCount = sheetSyncModalItems.filter((i) => !i.alreadySynced && i.status !== 'other').length;

              return (
                <>
                  <div className="flex items-center justify-between gap-2 pb-3 border-b border-gray-100 text-[11px] font-semibold">
                    <span className="text-gray-500 tabular-nums">
                      {selectedSyncCourseKeys.size} new selected · {alreadySyncedCount} already synced · {lockedOnlyCount} locked
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={syncableCount === 0}
                        onClick={() => {
                          const next = new Set<string>();
                          sheetSyncModalItems.forEach((item) => {
                            if (!item.alreadySynced && item.status === 'assigned_to_me') {
                              next.add(normKey(item.tab.courseName));
                            }
                          });
                          setSelectedSyncCourseKeys(next);
                        }}
                        className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 transition-colors disabled:opacity-40"
                      >
                        Select Mine
                      </button>
                      <button
                        type="button"
                        disabled={selectedSyncCourseKeys.size === 0}
                        onClick={() => setSelectedSyncCourseKeys(new Set())}
                        className="px-2.5 py-1 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors disabled:opacity-40"
                      >
                        Clear
                      </button>
                    </div>
                  </div>

                  {sheetSyncUpdatedNames.length > 0 && (
                    <div className="mt-3 px-3.5 py-2.5 rounded-xl bg-indigo-50 border border-indigo-200 text-[11px] font-semibold text-indigo-800">
                      Updated student roster{sheetSyncUpdatedNames.length === 1 ? '' : 's'} from Google Sheet for:{' '}
                      <span className="font-bold">{sheetSyncUpdatedNames.join(', ')}</span>.
                    </div>
                  )}

                  {syncableCount === 0 && (
                    <div className="mt-3 px-3.5 py-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-[11px] font-semibold text-emerald-800">
                      All available subjects from this Google Sheet are already in Subjects (or owned by other lecturers). Synced subjects automatically keep their student rosters up to date.
                    </div>
                  )}

                  <div className="my-3 overflow-y-auto custom-scrollbar space-y-2 pr-1 flex-1">
                    {(() => {
                      const activeUsers = collaboratorPool;
                      return sheetSyncModalItems.map((item) => {
                        const key = normKey(item.tab.courseName);
                        const isLocked = item.status === 'other';
                        const isAlreadySynced = Boolean(item.alreadySynced);
                        const isDisabled = isLocked || isAlreadySynced;
                        const isChecked = !isDisabled && selectedSyncCourseKeys.has(key);
                        const chosenOwnerId = selectedSyncOwnerByCourse[key] || '';
                        const chosenSharedIds = selectedSyncSharedByCourse[key] || [];
                        const eligibleCoLecturers = activeUsers.filter((u) => u.id !== chosenOwnerId);

                        let statusLabel = 'New — check to sync';
                        let statusTone = 'text-gray-500';
                        if (isAlreadySynced && item.status === 'mine') {
                          statusLabel = item.sharedBy
                            ? `Already Synced · Shared with you by ${item.sharedBy} (Co-lecturer)`
                            : 'Already Synced · In your Subjects';
                          statusTone = 'text-emerald-700';
                        } else if (isAlreadySynced && item.status === 'other_managed') {
                          statusLabel = `Already Synced · Owner: ${item.ownerLabel || 'Lecturer'}`;
                          statusTone = 'text-emerald-700';
                        } else if (isAlreadySynced && item.status === 'other') {
                          statusLabel = item.reason || `Owned by ${item.ownerLabel || 'another lecturer'} — locked`;
                          statusTone = 'text-red-600';
                        } else if (item.status === 'assigned_to_me') {
                          statusLabel = 'New · Assigned to You';
                          statusTone = 'text-indigo-700';
                        } else if (item.status === 'other') {
                          statusLabel = item.reason || `Owned by ${item.ownerLabel || 'another lecturer'} — locked`;
                          statusTone = 'text-red-600';
                        } else if (item.status === 'other_managed') {
                          statusLabel = `New · Sheet Owner: ${item.ownerLabel || 'Lecturer'}`;
                          statusTone = 'text-amber-700';
                        }

                        return (
                          <div
                            key={key}
                            className={`p-3 rounded-2xl border transition-colors ${
                              isLocked
                                ? 'bg-gray-50 border-gray-200 opacity-65'
                                : isAlreadySynced
                                  ? 'bg-emerald-50/25 border-emerald-200/80 opacity-80'
                                  : isChecked
                                    ? 'bg-emerald-50/40 border-emerald-300'
                                    : 'bg-white border-gray-200 hover:bg-gray-50'
                            }`}
                          >
                            <label className={`flex items-start gap-3 ${isDisabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
                              <input
                                type="checkbox"
                                disabled={isDisabled || isConfirmingSheetSync}
                                checked={isChecked}
                                onChange={() => {
                                  if (isDisabled) return;
                                  setSelectedSyncCourseKeys((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(key)) next.delete(key);
                                    else next.add(key);
                                    return next;
                                  });
                                }}
                                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 disabled:opacity-50"
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                  <span className="text-sm font-bold text-gray-900 truncate">
                                    {item.tab.courseName}
                                  </span>
                                  <span className="text-[11px] font-medium text-gray-400 tabular-nums shrink-0">
                                    {item.tab.students.length} student{item.tab.students.length === 1 ? '' : 's'}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2 mt-0.5 flex-wrap text-[11px] font-semibold">
                                  {item.tab.sheetName && normKey(item.tab.sheetName) !== key && (
                                    <span className="text-gray-400">Tab: {item.tab.sheetName}</span>
                                  )}
                                  <span className={statusTone}>{statusLabel}</span>
                                </div>
                              </div>
                            </label>

                            {isAdmin && !isDisabled && activeUsers.length > 0 && (
                              <div className="mt-2.5 pt-2 border-t border-gray-100 space-y-2 pl-7">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-[10px] font-semibold text-gray-500">Assign Owner</span>
                                  <select
                                    aria-label={`Assign owner for ${item.tab.courseName}`}
                                    disabled={isConfirmingSheetSync}
                                    value={chosenOwnerId}
                                    onChange={(e) => {
                                      const nextOwner = e.target.value;
                                      setSelectedSyncOwnerByCourse((prev) => ({ ...prev, [key]: nextOwner }));
                                      setSelectedSyncSharedByCourse((prev) => ({
                                        ...prev,
                                        [key]: (prev[key] || []).filter((id) => id !== nextOwner),
                                      }));
                                    }}
                                    className="font-sans text-[11px] font-semibold rounded-lg pl-2.5 pr-7 py-1 outline-none max-w-[190px] bg-white text-gray-800 border border-gray-200 shadow-sm"
                                  >
                                    {activeUsers.map((u) => (
                                      <option key={u.id} value={u.id}>
                                        {u.username}{u.role === 'admin' ? ' (Admin)' : ''}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                                {eligibleCoLecturers.length > 0 && (
                                  <div className="flex items-start justify-between gap-2 flex-wrap">
                                    <span className="text-[10px] font-semibold text-gray-500 pt-1">Co-Lecturers</span>
                                    <div className="flex flex-wrap gap-1 flex-1 justify-end">
                                      {eligibleCoLecturers.map((u) => {
                                        const isShared = chosenSharedIds.includes(u.id);
                                        return (
                                          <label
                                            key={u.id}
                                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border text-[10px] font-semibold cursor-pointer transition-colors ${
                                              isShared
                                                ? 'bg-indigo-50 border-indigo-300 text-indigo-800'
                                                : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                                            }`}
                                          >
                                            <input
                                              type="checkbox"
                                              disabled={isConfirmingSheetSync}
                                              checked={isShared}
                                              onChange={() => {
                                                setSelectedSyncSharedByCourse((prev) => {
                                                  const curr = prev[key] || [];
                                                  const next = curr.includes(u.id)
                                                    ? curr.filter((id) => id !== u.id)
                                                    : [...curr, u.id];
                                                  return { ...prev, [key]: next };
                                                });
                                              }}
                                              className="h-3 w-3 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                                            />
                                            <span>{u.username}</span>
                                          </label>
                                        );
                                      })}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      });
                    })()}
                  </div>
                </>
              );
            })()}

            <div className="flex items-center gap-3 pt-3 border-t border-gray-100">
              <button
                type="button"
                disabled={isConfirmingSheetSync}
                onClick={() => setSheetSyncModalItems(null)}
                className="flex-1 py-3 rounded-2xl bg-gray-100 text-gray-600 hover:bg-gray-200 text-xs font-bold uppercase tracking-wider transition-all"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isConfirmingSheetSync || selectedSyncCourseKeys.size === 0}
                onClick={() => void handleConfirmSheetSync()}
                className="flex-1 py-3 rounded-2xl bg-emerald-600 text-white hover:bg-emerald-700 text-xs font-bold uppercase tracking-wider transition-all shadow-md shadow-emerald-100 disabled:opacity-50"
              >
                {isConfirmingSheetSync
                  ? 'Syncing...'
                  : `Sync Selected (${selectedSyncCourseKeys.size})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {editingCoLecturersCourse && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-[255] flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl p-6 relative border-t-8 border-indigo-600 animate-in zoom-in duration-200">
            <button
              type="button"
              disabled={isSavingCoLecturers}
              onClick={() => setEditingCoLecturersCourse(null)}
              className="absolute top-5 right-5 text-gray-300 hover:text-gray-900 transition-all"
            >
              <XCircleIcon className="w-6 h-6" />
            </button>
            <h3 className="text-lg font-bold text-gray-900 tracking-tight pr-7">
              Share Subject with Co-Lecturers
            </h3>
            <p className="text-xs font-semibold text-gray-500 mt-1 mb-4">
              {editingCoLecturersCourse.course.courseName} · Owner:{' '}
              <span className="text-gray-800">{editingCoLecturersCourse.course.createdBy || 'Owner'}</span>
            </p>

            {(() => {
              const ownerId = editingCoLecturersCourse.course.ownerId;
              const ownerNameLower = String(editingCoLecturersCourse.course.createdBy || '').trim().toLowerCase();
              const eligible = collaboratorPool.filter(
                (u) => u.id !== ownerId && u.username.toLowerCase() !== ownerNameLower
              );
              if (eligible.length === 0) {
                return (
                  <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4 text-xs text-gray-500 text-center">
                    No other active lecturer accounts available yet.
                  </div>
                );
              }
              return (
                <div className="space-y-2 max-h-60 overflow-y-auto custom-scrollbar pr-1">
                  {eligible.map((u) => {
                    const checked = editingCoLecturersCourse.selectedIds.includes(u.id);
                    return (
                      <label
                        key={u.id}
                        className={`flex items-center justify-between gap-3 p-3 rounded-2xl border cursor-pointer transition-colors ${
                          checked
                            ? 'bg-indigo-50/50 border-indigo-300'
                            : 'bg-white border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <input
                            type="checkbox"
                            disabled={isSavingCoLecturers}
                            checked={checked}
                            onChange={() => {
                              setEditingCoLecturersCourse((prev) => {
                                if (!prev) return null;
                                const next = prev.selectedIds.includes(u.id)
                                  ? prev.selectedIds.filter((id) => id !== u.id)
                                  : [...prev.selectedIds, u.id];
                                return { ...prev, selectedIds: next };
                              });
                            }}
                            className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                          />
                          <span className="text-sm font-bold text-gray-900 truncate">{u.username}</span>
                        </div>
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                          {u.role}
                        </span>
                      </label>
                    );
                  })}
                </div>
              );
            })()}

            <div className="flex items-center gap-3 pt-4 mt-4 border-t border-gray-100">
              <button
                type="button"
                disabled={isSavingCoLecturers}
                onClick={() => setEditingCoLecturersCourse(null)}
                className="flex-1 py-2.5 rounded-xl bg-gray-100 text-gray-600 hover:bg-gray-200 text-xs font-bold uppercase tracking-wider transition-all"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isSavingCoLecturers}
                onClick={async () => {
                  if (!editingCoLecturersCourse || !onUpdateCourseCoLecturers) return;
                  setIsSavingCoLecturers(true);
                  try {
                    const res = await onUpdateCourseCoLecturers(
                      editingCoLecturersCourse.course.id,
                      editingCoLecturersCourse.selectedIds
                    );
                    if (res && res.success === false) {
                      showToast('error', res.error || 'Failed to update co-lecturers.');
                    } else {
                      const count = editingCoLecturersCourse.selectedIds.length;
                      showToast(
                        'success',
                        count > 0
                          ? `Shared "${editingCoLecturersCourse.course.courseName}" with ${count} co-lecturer${count === 1 ? '' : 's'}.`
                          : `Removed co-lecturers from "${editingCoLecturersCourse.course.courseName}".`
                      );
                      setEditingCoLecturersCourse(null);
                    }
                  } finally {
                    setIsSavingCoLecturers(false);
                  }
                }}
                className="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 text-xs font-bold uppercase tracking-wider transition-all shadow-md shadow-indigo-100 disabled:opacity-50"
              >
                {isSavingCoLecturers ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showUserNotificationsModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-[260] flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-lg rounded-3xl shadow-2xl p-6 relative border-t-8 border-emerald-600 animate-in zoom-in duration-200">
            <button
              type="button"
              onClick={() => setShowUserNotificationsModal(false)}
              className="absolute top-5 right-5 text-gray-300 hover:text-gray-900 transition-all"
            >
              <XCircleIcon className="w-6 h-6" />
            </button>

            <div className="flex items-center gap-2.5 pr-8">
              <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center justify-center shrink-0">
                <BellIcon className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-900 tracking-tight">System Notifications</h3>
                <p className="text-xs font-semibold text-gray-500">
                  Account updates and system notices for {currentAdminName || 'your account'}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 mt-4 mb-3">
              <span className="text-[11px] font-bold text-gray-500">
                {userNotifications.length} Notification{userNotifications.length === 1 ? '' : 's'}
                {unreadUserNotifications.length > 0 ? ` • ${unreadUserNotifications.length} Unread` : ''}
              </span>
              <div className="flex items-center gap-2">
                {unreadUserNotifications.length > 0 && (
                  <button
                    type="button"
                    onClick={() => void onMarkAllUserNotificationsRead?.()}
                    className="text-[10px] font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-2.5 py-1 rounded-lg uppercase"
                  >
                    Mark All Read
                  </button>
                )}
                {userNotifications.length > 0 && (
                  <button
                    type="button"
                    onClick={() => void onClearUserNotifications?.()}
                    className="text-[10px] font-bold text-red-600 bg-red-50 hover:bg-red-100 px-2.5 py-1 rounded-lg uppercase"
                  >
                    Clear All
                  </button>
                )}
              </div>
            </div>

            {userNotifications.length === 0 ? (
              <div className="bg-gray-50 border border-gray-100 rounded-2xl p-6 text-center text-xs font-bold text-gray-400">
                No system notifications yet.
              </div>
            ) : (
              <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1 custom-scrollbar">
                {userNotifications.map((notif) => {
                  const isRemoved = notif.type === 'co_lecturer_removed';
                  const isCourse = notif.type === 'course_assigned' || notif.type === 'co_lecturer_added';
                  const unreadBox = isRemoved
                    ? 'bg-amber-50/70 border-amber-200'
                    : isCourse
                      ? 'bg-indigo-50/70 border-indigo-200'
                      : 'bg-emerald-50/70 border-emerald-200';
                  const dotClass = isRemoved
                    ? 'bg-amber-500'
                    : isCourse
                      ? 'bg-indigo-500'
                      : 'bg-emerald-500';
                  const badgeClass = isRemoved
                    ? 'text-amber-700 bg-amber-100'
                    : isCourse
                      ? 'text-indigo-700 bg-indigo-100'
                      : 'text-emerald-700 bg-emerald-100';
                  const readBtnClass = isRemoved
                    ? 'text-amber-700 border-amber-200 hover:bg-amber-50'
                    : isCourse
                      ? 'text-indigo-700 border-indigo-200 hover:bg-indigo-50'
                      : 'text-emerald-700 border-emerald-200 hover:bg-emerald-50';
                  return (
                    <div
                      key={notif.id}
                      className={`p-3.5 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 ${
                        notif.read ? 'bg-gray-50 border-gray-100' : unreadBox
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          {!notif.read && <span className={`w-2 h-2 rounded-full shrink-0 ${dotClass}`}></span>}
                          <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md ${badgeClass}`}>
                            {notif.title}
                          </span>
                        </div>
                        <p className="text-xs font-semibold text-gray-800 mt-1.5">{notif.message}</p>
                        <p className="text-[10px] font-bold text-gray-400 mt-1 tabular-nums">
                          {new Date(notif.createdAt).toLocaleString()}
                        </p>
                      </div>
                      {!notif.read && (
                        <button
                          type="button"
                          onClick={() => void onMarkUserNotificationRead?.(notif.id)}
                          className={`self-start sm:self-auto shrink-0 text-[10px] font-bold bg-white border px-2.5 py-1.5 rounded-xl uppercase ${readBtnClass}`}
                        >
                          Mark Read
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <div className="mt-5 pt-3 border-t border-gray-100 flex justify-end">
              <button
                type="button"
                onClick={() => setShowUserNotificationsModal(false)}
                className="py-2 px-5 rounded-xl bg-gray-900 text-white hover:bg-black text-xs font-bold uppercase tracking-wider transition-all"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {showScanner && <QrScanner onScan={handleScanResult} onClose={() => setShowScanner(false)} />}
    </div>
  );
};
