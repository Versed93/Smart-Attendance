export interface Student {
  name: string;
  studentId: string;
  email: string;
  timestamp: number;
  status: string;
  courseName: string;
  courseId?: string;
  absenceReason?: string;
  week?: string;
}

export interface CourseStudentRef {
  id: string;
  name: string;
}

export interface CourseProfile {
  id: string;
  courseName: string;
  sheetName?: string;
  selectedWeek: string;
  students: CourseStudentRef[];
  ownerId?: string;
  createdBy?: string;
  sharedWith?: string[];
  createdAt: number;
  updatedAt: number;
}

export const ACTIVATION_EXPIRY_MS = 24 * 60 * 60 * 1000; // 1 day (24 hours)

export interface AppUser {
  id: string;
  username: string;
  email: string;
  password?: string;
  role: 'admin' | 'lecturer';
  status: 'active' | 'pending' | 'approved_pending_pin';
  activationToken?: string;
  activationSentAt?: number;
  activationExpiresAt?: number;
  approvedAt?: number;
  deletionRequestedAt?: number;
  deletionReason?: string;
  createdAt: number;
  activatedAt?: number;
  lastLoginAt?: number;
}

export interface AdminSessionActivity {
  id: string;
  adminName: string;
  email?: string;
  device: string;
  date: string;
  loginTime: number;
  lastActiveTime: number;
  status: 'active' | 'signed_out';
  currentAction?: string;
}

export interface AdminNotification {
  id: string;
  type:
    | 'user_signup'
    | 'delete_request'
    | 'account_activated'
    | 'email_delivery_failure'
    | 'course_ownership_changed'
    | 'sheet_sync_skipped';
  userId: string;
  username: string;
  email: string;
  createdAt: number;
  read: boolean;
  emailSent: boolean;
  message: string;
  reason?: string;
  courseName?: string;
}

export interface UserNotification {
  id: string;
  userId: string;
  type:
    | 'account_activated'
    | 'course_assigned'
    | 'co_lecturer_added'
    | 'co_lecturer_removed'
    | 'system_update';
  title: string;
  message: string;
  createdAt: number;
  read: boolean;
  courseName?: string;
}

export type EmailProviderType = 'resend' | 'smtp' | 'apps_script' | 'none';

export interface EmailDeliveryStatus {
  provider: EmailProviderType;
  label: string;
  configured: boolean;
  fromAddress?: string;
}

export interface CollaboratorOption {
  id: string;
  username: string;
  role: 'admin' | 'lecturer';
}

export interface SheetTabCandidate {
  sheetName: string;
  courseName: string;
  owner?: string;
  ownerExplicit?: boolean;
  ownerId?: string;
  sharedWith?: string[];
  students: CourseStudentRef[];
}

export type SheetTabOwnershipStatus =
  | 'mine'
  | 'assigned_to_me'
  | 'other'
  | 'other_managed'
  | 'unclaimed';

export interface SheetTabOwnershipResult {
  courseName: string;
  status: SheetTabOwnershipStatus;
  alreadySynced?: boolean;
  ownerId?: string;
  ownerLabel?: string;
  sharedWith?: string[];
  sharedBy?: string;
  reason?: string;
}

export interface SyncSheetCoursesResult {
  success: boolean;
  courses: CourseProfile[];
  skippedCourses: Array<{ courseName: string; reason: string; owner?: string }>;
}
