
export interface Student {
  name: string;
  studentId: string;
  email: string;
  timestamp: number;
  status: string;
  // The course name associated with the attendance record
  courseName: string;
  mark?: number;
  absenceReason?: string;
}
