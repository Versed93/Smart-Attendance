
export interface Student {
  name: string;
  studentId: string;
  email: string;
  timestamp: number;
  status: 'P' | 'A';
}

export interface SyncTask {
  id: string;
  data: Record<string, string>;
  timestamp: number;
}
