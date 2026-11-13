export interface Student {
  name: string;
  studentId: string;
  email: string;
  timestamp: number;
  status: string;
  courseName: string;
  absenceReason?: string;
  week?: string;
}

export interface AppUser {
  id: string;
  username: string;
  email: string;
  password: string;
  role: 'admin' | 'lecturer';
  status: 'active' | 'pending';
  activationToken?: string;
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
  type: 'user_signup';
  userId: string;
  username: string;
  email: string;
  createdAt: number;
  read: boolean;
  emailSent: boolean;
  message: string;
}
