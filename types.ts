
export interface Student {
  name: string;
  studentId: string;
  email: string;
  timestamp: number;
  status: string; // Changed from 'P' | 'A' to string to support reasons like "Medical", "Exempt"
}

export interface SyncTask {
  id: string;
  data: Record<string, string>;
  timestamp: number;
}