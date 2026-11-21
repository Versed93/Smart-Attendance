import type {
  AdminNotification,
  AdminSessionActivity,
  AppUser,
  CollaboratorOption,
  CourseProfile,
  SheetTabCandidate,
  Student,
  UserNotification,
} from '../types';
import type { PreRegisteredStudent } from '../studentList';

export interface DemoSandboxSnapshot {
  courses: CourseProfile[];
  activeCourse: string;
  selectedWeek: string;
  knownStudents: PreRegisteredStudent[];
  attendanceList: Student[];
  teacherHistory: Student[];
  users: AppUser[];
  coLecturerOptions: CollaboratorOption[];
  sessions: AdminSessionActivity[];
  adminNotifications: AdminNotification[];
  userNotifications: UserNotification[];
  sheetTabs: SheetTabCandidate[];
}

const CS101_STUDENTS: PreRegisteredStudent[] = [
  { id: 'S2026001', name: 'AMINA RAHMAN' },
  { id: 'S2026002', name: 'DANIEL TAN' },
  { id: 'S2026003', name: 'PRIYA NAIR' },
  { id: 'S2026004', name: 'MARCUS LIM' },
  { id: 'S2026005', name: 'NURUL HUDA' },
  { id: 'S2026006', name: 'KEVIN CHONG' },
];

const CS204_STUDENTS: PreRegisteredStudent[] = [
  { id: 'S2026101', name: 'FARAH AISYAH' },
  { id: 'S2026102', name: 'JASON WONG' },
  { id: 'S2026103', name: 'SITI ZAHRA' },
  { id: 'S2026104', name: 'ETHAN KOH' },
];

const IT305_STUDENTS: PreRegisteredStudent[] = [
  { id: 'S2026201', name: 'AISHAH ZAINAL' },
  { id: 'S2026202', name: 'RYAN GOH' },
  { id: 'S2026203', name: 'MEI LING' },
  { id: 'S2026204', name: 'HARITH ISKANDAR' },
];

const AI401_SHEET_STUDENTS: PreRegisteredStudent[] = [
  { id: 'S2026301', name: 'ALICIA CHEN' },
  { id: 'S2026302', name: 'HAKIM ROSLI' },
  { id: 'S2026303', name: 'DEVIKA RAO' },
  { id: 'S2026304', name: 'NOAH YAP' },
];

export function createDemoSandboxSnapshot(): DemoSandboxSnapshot {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const weekMs = 7 * dayMs;

  const courses: CourseProfile[] = [
    {
      id: 'DEMO_CS101_SOFTWARE_ENG',
      courseName: 'CS101 Software Engineering',
      sheetName: 'CS101 Software Engineering',
      selectedWeek: 'W5',
      students: CS101_STUDENTS.map((s) => ({ ...s })),
      ownerId: 'demo_lect_sara',
      createdBy: 'dr_sara',
      sharedWith: ['admin'],
      createdAt: now - 35 * dayMs,
      updatedAt: now - 2 * 60 * 60 * 1000,
    },
    {
      id: 'DEMO_CS204_DATABASE_SYS',
      courseName: 'CS204 Database Systems',
      sheetName: 'CS204 Database Systems',
      selectedWeek: 'W5',
      students: CS204_STUDENTS.map((s) => ({ ...s })),
      ownerId: 'admin',
      createdBy: 'admin',
      sharedWith: ['demo_lect_sara'],
      createdAt: now - 30 * dayMs,
      updatedAt: now - 5 * 60 * 60 * 1000,
    },
    {
      id: 'DEMO_IT305_CLOUD_COMP',
      courseName: 'IT305 Cloud Computing',
      sheetName: 'IT305 Cloud Computing',
      selectedWeek: 'W5',
      students: IT305_STUDENTS.map((s) => ({ ...s })),
      ownerId: 'demo_lect_sara',
      createdBy: 'dr_sara',
      sharedWith: [],
      createdAt: now - 28 * dayMs,
      updatedAt: now - dayMs,
    },
  ];

  const liveAttendance: Student[] = [
    {
      name: 'AMINA RAHMAN',
      studentId: 'S2026001',
      email: 'S2026001@student.edu.my',
      status: 'P',
      timestamp: now - 8 * 60 * 1000,
      courseName: 'CS101 Software Engineering',
      courseId: 'DEMO_CS101_SOFTWARE_ENG',
      week: 'W5',
    },
    {
      name: 'DANIEL TAN',
      studentId: 'S2026002',
      email: 'S2026002@student.edu.my',
      status: 'P',
      timestamp: now - 4 * 60 * 1000,
      courseName: 'CS101 Software Engineering',
      courseId: 'DEMO_CS101_SOFTWARE_ENG',
      week: 'W5',
    },
  ];

  const historicalRecords: Student[] = [...liveAttendance];

  const addMatrixWeeks = (
    course: CourseProfile,
    absentMap: Record<string, string[]>
  ) => {
    const weeks = ['W1', 'W2', 'W3', 'W4'];
    weeks.forEach((wk, wkIdx) => {
      const wkTime = now - (4 - wkIdx) * weekMs;
      course.students.forEach((stu, stuIdx) => {
        const isAbsent = (absentMap[stu.id] || []).includes(wk);
        historicalRecords.push({
          name: stu.name,
          studentId: stu.id,
          email: `${stu.id}@student.edu.my`,
          status: isAbsent ? 'A' : 'P',
          timestamp: wkTime + stuIdx * 1000,
          courseName: course.courseName,
          courseId: course.id,
          week: wk,
          ...(isAbsent ? { absenceReason: 'Medical Certificate' } : {}),
        });
      });
    });
  };

  addMatrixWeeks(courses[0], {
    S2026003: ['W3'],
    S2026005: ['W2'],
    S2026006: ['W4'],
  });
  addMatrixWeeks(courses[1], {
    S2026102: ['W2'],
    S2026104: ['W4'],
  });
  addMatrixWeeks(courses[2], {
    S2026203: ['W1'],
  });

  historicalRecords.sort((a, b) => b.timestamp - a.timestamp);

  const users: AppUser[] = [
    {
      id: 'admin',
      username: 'admin',
      email: 'demo-admin@university.edu',
      role: 'admin',
      status: 'active',
      createdAt: now - 60 * dayMs,
      activatedAt: now - 60 * dayMs,
      lastLoginAt: now - 2 * 60 * 1000,
    },
    {
      id: 'demo_lect_sara',
      username: 'dr_sara',
      email: 'sara.demo@university.edu',
      role: 'lecturer',
      status: 'active',
      createdAt: now - 40 * dayMs,
      approvedAt: now - 40 * dayMs,
      activatedAt: now - 40 * dayMs,
      lastLoginAt: now - 30 * 60 * 1000,
    },
    {
      id: 'demo_lect_kamal',
      username: 'prof_kamal',
      email: 'kamal.demo@university.edu',
      role: 'lecturer',
      status: 'pending',
      createdAt: now - 45 * 60 * 1000,
    },
    {
      id: 'demo_lect_lin',
      username: 'ms_lin',
      email: 'lin.demo@university.edu',
      role: 'lecturer',
      status: 'approved_pending_pin',
      createdAt: now - 2 * dayMs,
      approvedAt: now - 3 * 60 * 60 * 1000,
      activationSentAt: now - 3 * 60 * 60 * 1000,
      activationExpiresAt: now + 21 * 60 * 60 * 1000,
    },
  ];

  const coLecturerOptions: CollaboratorOption[] = [
    { id: 'admin', username: 'admin', role: 'admin' },
    { id: 'demo_lect_sara', username: 'dr_sara', role: 'lecturer' },
  ];

  const sessions: AdminSessionActivity[] = [
    {
      id: 'demo_sess_admin',
      adminName: 'admin',
      email: 'demo-admin@university.edu',
      device: 'Chrome • Windows',
      date: new Date(now).toISOString().slice(0, 10),
      loginTime: now - 15 * 60 * 1000,
      lastActiveTime: now - 30 * 1000,
      status: 'active',
      currentAction: 'Dashboard',
    },
    {
      id: 'demo_sess_sara',
      adminName: 'dr_sara',
      email: 'sara.demo@university.edu',
      device: 'Safari • iPad',
      date: new Date(now).toISOString().slice(0, 10),
      loginTime: now - 55 * 60 * 1000,
      lastActiveTime: now - 3 * 60 * 1000,
      status: 'active',
      currentAction: 'Dashboard',
    },
  ];

  const adminNotifications: AdminNotification[] = [
    {
      id: 'demo_notif_signup',
      type: 'user_signup',
      userId: 'demo_lect_kamal',
      username: 'prof_kamal',
      email: 'kamal.demo@university.edu',
      createdAt: now - 45 * 60 * 1000,
      read: false,
      emailSent: true,
      message: 'prof_kamal (kamal.demo@university.edu) signed up and is waiting for Admin approval.',
    },
  ];

  const userNotifications: UserNotification[] = [
    {
      id: 'demo_unotif_welcome',
      userId: 'admin',
      type: 'system_update',
      title: 'Demo Sandbox Active',
      message:
        'You are exploring sample courses and simulated attendance data. No live database or Google Sheet records are affected.',
      createdAt: now - 10 * 60 * 1000,
      read: false,
    },
  ];

  const sheetTabs: SheetTabCandidate[] = [
    {
      sheetName: 'CS101 Software Engineering',
      courseName: 'CS101 Software Engineering',
      owner: 'dr_sara',
      ownerExplicit: true,
      ownerId: 'demo_lect_sara',
      sharedWith: ['admin'],
      students: CS101_STUDENTS.map((s) => ({ ...s })),
    },
    {
      sheetName: 'CS204 Database Systems',
      courseName: 'CS204 Database Systems',
      owner: 'admin',
      ownerExplicit: true,
      ownerId: 'admin',
      sharedWith: ['demo_lect_sara'],
      students: CS204_STUDENTS.map((s) => ({ ...s })),
    },
    {
      sheetName: 'IT305 Cloud Computing',
      courseName: 'IT305 Cloud Computing',
      owner: 'dr_sara',
      ownerExplicit: true,
      ownerId: 'demo_lect_sara',
      sharedWith: [],
      students: IT305_STUDENTS.map((s) => ({ ...s })),
    },
    {
      sheetName: 'AI401 Machine Learning',
      courseName: 'AI401 Machine Learning',
      owner: '',
      ownerExplicit: false,
      students: AI401_SHEET_STUDENTS.map((s) => ({ ...s })),
    },
  ];

  return {
    courses,
    activeCourse: courses[0].courseName,
    selectedWeek: 'W5',
    knownStudents: CS101_STUDENTS.map((s) => ({ ...s })),
    attendanceList: liveAttendance,
    teacherHistory: historicalRecords,
    users,
    coLecturerOptions,
    sessions,
    adminNotifications,
    userNotifications,
    sheetTabs,
  };
}
