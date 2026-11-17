import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import process from 'node:process';
import nodemailer from 'nodemailer';
import type {
  AppUser,
  AdminSessionActivity,
  AdminNotification,
  CollaboratorOption,
  CourseProfile,
  EmailDeliveryStatus,
  EmailProviderType,
  SheetTabOwnershipResult,
  Student,
  UserNotification,
} from './types.ts';
import { PRE_REGISTERED_STUDENTS, type PreRegisteredStudent } from './studentList.ts';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ACTIVATION_PIN_EXPIRY_MS = 24 * 60 * 60 * 1000;

const FIREBASE_DB_URL = (
  process.env.FIREBASE_DATABASE_URL ||
  'https://smart-attendance-system-c0a9b-default-rtdb.asia-southeast1.firebasedatabase.app'
).replace(/\/+$/, '');

const FIREBASE_DB_SECRET =
  process.env.FIREBASE_DATABASE_SECRET ||
  'Ljz9cYejOtpU83Z6h1wdZdvK1kjpRLZ4haMlkYO1';

const AUTH_SECRET =
  process.env.AUTH_SECRET ||
  crypto.createHash('sha256').update(`smart-attendance-hmac:${FIREBASE_DB_SECRET}`).digest('hex');

const DEFAULT_ADMIN_PASSWORD = process.env.ADMIN_DEFAULT_PASSWORD || 'adminscm';
const DEFAULT_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbwbjXTrbFPRqVA0I-RGc1rV7K7eZ_CkgQujSBVtOtvjDCW1GJYAkxiVlXJzAB_-R_CaLA/exec';

type IntegrationType = 'google_sheets' | 'airtable' | 'firebase';

interface StoredAppUser extends Omit<AppUser, 'password'> {
  password?: string;
  passwordHash?: string;
  activationPin?: string;
}

const generateActivationPin = (): string => crypto.randomInt(100000, 1000000).toString();

interface AuthTokenPayload {
  uid: string;
  username: string;
  role: 'admin' | 'lecturer';
  sid: string;
  iat: number;
  exp: number;
}

interface AuthenticatedRequest extends Request {
  auth?: AuthTokenPayload;
}

const toFirebaseKey = (raw: string): string => raw.replace(/[^a-zA-Z0-9_-]/g, '_');

const normalizeStudentId = (val: string): string => val.trim().replace(/\s+/g, '').toUpperCase();
const toStudentFirebaseKey = (studentId: string): string => toFirebaseKey(normalizeStudentId(studentId));
const toCourseKey = (name: string): string => {
  const clean = name.trim();
  return clean ? clean.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase() : 'GENERAL_SESSION';
};
const normalizeCourseNameKey = (name: string): string =>
  name.replace(/\s+/g, ' ').trim().toUpperCase();
const isSameCourse = (course: CourseProfile, cleanName: string): boolean => {
  if (!cleanName) return false;
  if (normalizeCourseNameKey(course.courseName) === normalizeCourseNameKey(cleanName)) return true;
  if (course.id === toCourseKey(cleanName)) return true;
  return false;
};
const sanitizeCoursePath = (str: string): string => str.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase();
const getSessionDateId = (): string => new Date().toISOString().slice(0, 10);

const buildDbUrl = (dbPath: string): string => {
  const cleanPath = dbPath.replace(/^\/+/, '');
  return `${FIREBASE_DB_URL}/${cleanPath}.json?auth=${FIREBASE_DB_SECRET}&_ts=${Date.now()}`;
};

async function fbGet<T>(dbPath: string): Promise<T | null> {
  const res = await fetch(buildDbUrl(dbPath), { cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Database read failed (${res.status})`);
  }
  return (await res.json()) as T | null;
}

async function fbPut(dbPath: string, payload: unknown): Promise<void> {
  const res = await fetch(buildDbUrl(dbPath), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Database write failed (${res.status})`);
  }
}

async function fbPatch(dbPath: string, payload: unknown): Promise<void> {
  const res = await fetch(buildDbUrl(dbPath), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Database update failed (${res.status})`);
  }
}

async function fbDelete(dbPath: string): Promise<void> {
  const res = await fetch(buildDbUrl(dbPath), { method: 'DELETE' });
  if (!res.ok && res.status !== 404) {
    throw new Error(`Database delete failed (${res.status})`);
  }
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

function verifyPasswordHash(password: string, storedHash: string): boolean {
  const parts = storedHash.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, hashHex] = parts;
  const derivedBuf = crypto.scryptSync(password, salt, 64);
  const expectedBuf = Buffer.from(hashHex, 'hex');
  if (derivedBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(derivedBuf, expectedBuf);
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

async function verifyAndUpgradeUserPassword(user: StoredAppUser, plainPassword: string): Promise<boolean> {
  if (user.passwordHash) {
    return verifyPasswordHash(plainPassword, user.passwordHash);
  }
  if (typeof user.password === 'string' && user.password.length > 0) {
    const matched = timingSafeStringEqual(plainPassword, user.password);
    if (matched) {
      const upgradedHash = hashPassword(plainPassword);
      await fbPatch(`app_users/${user.id}`, {
        passwordHash: upgradedHash,
        password: null,
      }).catch(() => { /* ignore */ });
    }
    return matched;
  }
  return false;
}

function signSessionToken(payload: AuthTokenPayload): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', AUTH_SECRET).update(encodedPayload).digest('base64url');
  return `${encodedPayload}.${signature}`;
}

function verifySessionToken(token: string): AuthTokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encodedPayload, signature] = parts;
  const expectedSig = crypto.createHmac('sha256', AUTH_SECRET).update(encodedPayload).digest('base64url');
  if (!timingSafeStringEqual(signature, expectedSig)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as AuthTokenPayload;
    if (!parsed || !parsed.uid || !parsed.username || !parsed.role || !parsed.exp) return null;
    if (Date.now() > parsed.exp) return null;
    return parsed;
  } catch {
    return null;
  }
}

const PIN_CHALLENGE_TTL_MS = 15 * 60 * 1000;

interface PinChallengePayload {
  purpose: 'pin_activation';
  uid: string;
  iat: number;
  exp: number;
}

function signPinChallengeToken(uid: string): string {
  const now = Date.now();
  const payload: PinChallengePayload = {
    purpose: 'pin_activation',
    uid,
    iat: now,
    exp: now + PIN_CHALLENGE_TTL_MS,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', AUTH_SECRET).update(encodedPayload).digest('base64url');
  return `${encodedPayload}.${signature}`;
}

function verifyPinChallengeToken(token: string): PinChallengePayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encodedPayload, signature] = parts;
  const expectedSig = crypto.createHmac('sha256', AUTH_SECRET).update(encodedPayload).digest('base64url');
  if (!timingSafeStringEqual(signature, expectedSig)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as PinChallengePayload;
    if (!parsed || parsed.purpose !== 'pin_activation' || !parsed.uid || !parsed.exp) return null;
    if (Date.now() > parsed.exp) return null;
    return parsed;
  } catch {
    return null;
  }
}

const QR_TOKEN_VALIDITY_MS = 15 * 1000;
const CHECKIN_GRANT_VALIDITY_MS = 2 * 60 * 1000;

interface QrTokenPayload {
  v: 1;
  iat: number;
  exp: number;
  courseName: string;
  courseId: string;
  week: string;
  sessionKey: string;
  pinRequired: boolean;
}

interface CheckinGrantPayload {
  v: 1;
  nonce: string;
  iat: number;
  exp: number;
  courseName: string;
  courseId: string;
  week: string;
  sessionKey: string;
  pinRequired: boolean;
}

interface ClassroomPinConfig {
  enabled: boolean;
  pin: string;
  courseName: string;
  week: string;
  updatedAt: number;
  updatedBy?: string;
}

const activePinCache = new Map<string, ClassroomPinConfig>();
const usedScanNonces = new Map<string, number>();

function pruneUsedScanNonces(now: number): void {
  if (usedScanNonces.size < 200) return;
  for (const [nonce, exp] of usedScanNonces.entries()) {
    if (now > exp) {
      usedScanNonces.delete(nonce);
    }
  }
}

function generateClassroomPin(): string {
  return String(crypto.randomInt(1000, 10000));
}

function buildPinSessionKey(courseName: string): string {
  const clean = (courseName || 'General Session').trim() || 'General Session';
  return toFirebaseKey(`${getSessionDateId()}_${sanitizeCoursePath(clean)}`);
}

async function readPinConfig(sessionKey: string): Promise<ClassroomPinConfig | null> {
  try {
    const remote = await fbGet<ClassroomPinConfig>(`classroom_pins/${sessionKey}`);
    if (remote && typeof remote === 'object' && typeof remote.pin === 'string') {
      activePinCache.set(sessionKey, remote);
      return remote;
    }
  } catch {
    // Fall back to in-memory cache if DB read temporarily fails
  }
  return activePinCache.get(sessionKey) || null;
}

async function getOrUpdatePinConfig(params: {
  sessionKey: string;
  courseName: string;
  week: string;
  requirePin?: boolean;
  rotatePin?: boolean;
  updatedBy?: string;
}): Promise<ClassroomPinConfig> {
  const existing = await readPinConfig(params.sessionKey);
  const now = Date.now();
  const nextEnabled = params.requirePin !== undefined ? Boolean(params.requirePin) : (existing ? existing.enabled : true);
  const needNewPin = Boolean(params.rotatePin) || !existing || !/^\d{4}$/.test(existing.pin);

  if (!existing || nextEnabled !== existing.enabled || needNewPin) {
    const nextConfig: ClassroomPinConfig = {
      enabled: nextEnabled,
      pin: needNewPin ? generateClassroomPin() : existing.pin,
      courseName: params.courseName,
      week: params.week,
      updatedAt: now,
      updatedBy: params.updatedBy || existing?.updatedBy,
    };
    activePinCache.set(params.sessionKey, nextConfig);
    await fbPut(`classroom_pins/${params.sessionKey}`, nextConfig).catch(() => { /* ignore */ });
    return nextConfig;
  }

  return existing;
}

function signQrToken(payload: QrTokenPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', AUTH_SECRET).update(`qr:${encoded}`).digest('base64url');
  return `${encoded}.${sig}`;
}

function verifyQrToken(token: string): QrTokenPayload | null {
  const parts = String(token || '').trim().split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', AUTH_SECRET).update(`qr:${encoded}`).digest('base64url');
  if (!timingSafeStringEqual(sig, expectedSig)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as QrTokenPayload;
    if (!parsed || parsed.v !== 1 || !parsed.iat || !parsed.exp || !parsed.sessionKey) return null;
    return parsed;
  } catch {
    return null;
  }
}

function signCheckinGrant(payload: CheckinGrantPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', AUTH_SECRET).update(`grant:${encoded}`).digest('base64url');
  return `${encoded}.${sig}`;
}

function verifyCheckinGrant(token: string): CheckinGrantPayload | null {
  const parts = String(token || '').trim().split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', AUTH_SECRET).update(`grant:${encoded}`).digest('base64url');
  if (!timingSafeStringEqual(sig, expectedSig)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as CheckinGrantPayload;
    if (!parsed || parsed.v !== 1 || !parsed.nonce || !parsed.exp || !parsed.sessionKey) return null;
    if (Date.now() > parsed.exp) return null;
    return parsed;
  } catch {
    return null;
  }
}

function sanitizeUser(user: StoredAppUser): AppUser {
  const rest = { ...user };
  delete rest.password;
  delete rest.passwordHash;
  delete rest.activationPin;
  delete rest.activationToken;
  return {
    ...rest,
    role: rest.username?.toLowerCase() === 'admin' ? 'admin' : (rest.role || 'lecturer'),
    status: rest.status || 'active',
    email: rest.email || '',
    createdAt: rest.createdAt || 0,
  };
}

function normalizeCourse(raw: CourseProfile): CourseProfile {
  return {
    ...raw,
    selectedWeek: raw.selectedWeek || 'W1',
    students: Array.isArray(raw.students) ? raw.students : [],
    sharedWith: Array.isArray(raw.sharedWith) ? raw.sharedWith : [],
  };
}

function canAccessCourse(course: CourseProfile, auth: AuthTokenPayload): boolean {
  if (auth.role === 'admin') return true;
  if (course.ownerId && course.ownerId === auth.uid) return true;
  if (!course.ownerId && course.createdBy && course.createdBy.toLowerCase() === auth.username.toLowerCase()) {
    return true;
  }
  if (
    Array.isArray(course.sharedWith) &&
    (course.sharedWith.includes(auth.uid) ||
      course.sharedWith.some((entry) => entry.toLowerCase() === auth.username.toLowerCase()))
  ) {
    return true;
  }
  return false;
}

function isDirectOwnerOrShared(course: CourseProfile, auth: AuthTokenPayload): boolean {
  if (course.ownerId && course.ownerId === auth.uid) return true;
  if (!course.ownerId && course.createdBy && course.createdBy.toLowerCase() === auth.username.toLowerCase()) {
    return true;
  }
  if (!course.ownerId && !course.createdBy && auth.role === 'admin') {
    return true;
  }
  if (
    Array.isArray(course.sharedWith) &&
    (course.sharedWith.includes(auth.uid) ||
      course.sharedWith.some((entry) => entry.toLowerCase() === auth.username.toLowerCase()))
  ) {
    return true;
  }
  return false;
}

function sanitizeSharedWithIds(
  rawIds: unknown,
  allUsers: StoredAppUser[],
  excludeOwnerId?: string
): string[] {
  if (!Array.isArray(rawIds)) return [];
  const validIds = new Set(allUsers.filter((u) => u && u.id && (u.status || 'active') === 'active').map((u) => u.id));
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const item of rawIds) {
    const id = String(item || '').trim();
    if (!id || id === excludeOwnerId || !validIds.has(id) || seen.has(id)) continue;
    seen.add(id);
    cleaned.push(id);
  }
  return cleaned;
}

function parseOwnerTokens(rawOwner: unknown): string[] {
  return String(rawOwner || '')
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function resolveSheetTabOwner(
  rawOwner: unknown,
  ownerExplicit: boolean,
  allUsers: StoredAppUser[]
): {
  recognized: boolean;
  tokens: string[];
  matchedUsers: StoredAppUser[];
  displayLabel: string;
} {
  const tokens = parseOwnerTokens(rawOwner);
  if (tokens.length === 0) {
    return { recognized: false, tokens: [], matchedUsers: [], displayLabel: '' };
  }
  const matchedUsers: StoredAppUser[] = [];
  const seenIds = new Set<string>();
  for (const token of tokens) {
    const lower = token.toLowerCase();
    const user = allUsers.find(
      (u) =>
        u.username?.trim().toLowerCase() === lower ||
        (u.email && u.email.trim().toLowerCase() === lower)
    );
    if (user && !seenIds.has(user.id)) {
      seenIds.add(user.id);
      matchedUsers.push(user);
    }
  }
  const looksLikeEmail = tokens.some((t) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t));
  const recognized = ownerExplicit || matchedUsers.length > 0 || looksLikeEmail;
  const displayLabel =
    matchedUsers.length > 0
      ? matchedUsers.map((u) => u.username).join(', ')
      : tokens.join(', ');
  return { recognized, tokens, matchedUsers, displayLabel };
}

function doesAuthMatchSheetOwner(
  tokens: string[],
  auth: AuthTokenPayload,
  authUser: StoredAppUser | null
): boolean {
  const authUsername = auth.username.trim().toLowerCase();
  const authEmail = (authUser?.email || '').trim().toLowerCase();
  return tokens.some((token) => {
    const lower = token.toLowerCase();
    return lower === authUsername || (authEmail !== '' && lower === authEmail);
  });
}

function getDeviceLabel(ua: string): string {
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
}

function sanitizePublicAppUrl(rawUrl: unknown, req: Request): string {
  if (typeof rawUrl === 'string' && /^https?:\/\//i.test(rawUrl.trim())) {
    const clean = rawUrl.trim().split('?')[0].split('#')[0];
    return clean.replace(/^https:\/\/ais-dev-/i, 'https://ais-pre-');
  }
  const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'https';
  const host = (req.headers['x-forwarded-host'] as string) || req.get('host') || 'localhost:3000';
  return `${proto}://${host}/`.replace(/^https:\/\/ais-dev-/i, 'https://ais-pre-');
}

async function ensureAdminUserExists(): Promise<StoredAppUser> {
  const existing = await fbGet<StoredAppUser>('app_users/admin');
  if (existing && existing.id) {
    if (!existing.passwordHash) {
      const pwd = existing.password || DEFAULT_ADMIN_PASSWORD;
      const hash = hashPassword(pwd);
      await fbPatch('app_users/admin', {
        passwordHash: hash,
        password: null,
        role: 'admin',
        status: 'active',
      });
      return { ...existing, passwordHash: hash, role: 'admin', status: 'active' };
    }
    return existing;
  }
  const adminUser: StoredAppUser = {
    id: 'admin',
    username: 'admin',
    email: '',
    passwordHash: hashPassword(DEFAULT_ADMIN_PASSWORD),
    role: 'admin',
    status: 'active',
    createdAt: 0,
  };
  await fbPut('app_users/admin', adminUser);
  return adminUser;
}

async function getAppConfig(): Promise<{
  scriptUrl: string;
  integrationType: IntegrationType;
  adminEmail: string;
  knownStudentsV2: PreRegisteredStudent[];
}> {
  const cfg = (await fbGet<Record<string, unknown>>('app_config')) || {};
  const scriptUrl =
    typeof cfg.script_url === 'string' && cfg.script_url.trim().startsWith('https://script.google.com/')
      ? cfg.script_url.trim()
      : DEFAULT_SCRIPT_URL;
  const integrationType: IntegrationType =
    cfg.integration_type === 'google_sheets' ||
    cfg.integration_type === 'airtable' ||
    cfg.integration_type === 'firebase'
      ? cfg.integration_type
      : 'google_sheets';
  const adminEmail = typeof cfg.admin_email === 'string' ? cfg.admin_email.trim() : '';
  const knownStudentsV2 = Array.isArray(cfg.known_students_v2)
    ? (cfg.known_students_v2 as PreRegisteredStudent[])
    : PRE_REGISTERED_STUDENTS;
  return { scriptUrl, integrationType, adminEmail, knownStudentsV2 };
}

function formatCloudPayload(r: Student, fallbackWeek = 'W1') {
  const targetWeek = r.week || fallbackWeek || 'W1';
  return {
    'Student ID': r.studentId,
    Name: r.name,
    'Course Name': r.courseName || 'General Session',
    Week: targetWeek,
    Status: r.status,
    '[Course Name Here]': r.courseName || 'General Session',
    '[Date Here 1]': new Date(r.timestamp).toLocaleDateString(),
    '[Status Here]': r.status,
    [targetWeek]: r.status,
    Reason: r.absenceReason || '',
    Timestamp: new Date(r.timestamp).toISOString(),
  };
}

async function upsertAttendanceHistory(incoming: Student[]): Promise<void> {
  if (!Array.isArray(incoming) || incoming.length === 0) return;
  const histRaw = await fbGet<Student[] | Record<string, Student>>('attendance_history');
  const prevHist: Student[] = Array.isArray(histRaw)
    ? histRaw.filter((h) => Boolean(h && h.studentId && h.timestamp))
    : histRaw && typeof histRaw === 'object'
      ? Object.values(histRaw).filter((h) => Boolean(h && h.studentId && h.timestamp))
      : [];

  const deduped = new Map<string, Student>();
  for (const rec of [...incoming, ...prevHist]) {
    if (!rec || !rec.studentId || !rec.timestamp) continue;
    const key = `${rec.studentId.trim().toUpperCase()}__${rec.timestamp}`;
    if (!deduped.has(key)) {
      deduped.set(key, rec);
    }
  }

  const nextHist = Array.from(deduped.values()).sort((a, b) => b.timestamp - a.timestamp);
  await fbPut('attendance_history', nextHist).catch(() => { /* ignore */ });
}

async function postToGoogleScript(scriptUrl: string, bodyPayload: unknown): Promise<{ ok: boolean; json?: Record<string, unknown> }> {
  const cleanUrl = scriptUrl.trim();
  if (!cleanUrl || !cleanUrl.startsWith('https://script.google.com/') || cleanUrl.endsWith('/dev')) {
    return { ok: false };
  }
  try {
    const res = await fetch(cleanUrl, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(bodyPayload),
    });
    const text = await res.text();
    if (!res.ok || text.trim().startsWith('<')) return { ok: false };
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      return { ok: true, json: parsed };
    } catch {
      return { ok: true };
    }
  } catch {
    return { ok: false };
  }
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getEmailDeliveryStatus(scriptUrl?: string): EmailDeliveryStatus {
  const resendKey = (process.env.RESEND_API_KEY || '').trim();
  const smtpUrl = (process.env.SMTP_URL || '').trim();
  const smtpHost = (process.env.SMTP_HOST || '').trim();
  const smtpUser = (process.env.SMTP_USER || '').trim();
  const smtpPass = (process.env.SMTP_PASS || '').trim();
  const emailFrom = (process.env.EMAIL_FROM || '').trim();

  if (resendKey) {
    return {
      provider: 'resend',
      label: 'Built-in Resend API',
      configured: true,
      fromAddress: emailFrom || 'Smart Attendance <onboarding@resend.dev>',
    };
  }

  if (smtpUrl || (smtpHost && smtpUser && smtpPass)) {
    return {
      provider: 'smtp',
      label: 'Built-in SMTP Server',
      configured: true,
      fromAddress: emailFrom || (smtpUser ? `Smart Attendance <${smtpUser}>` : 'Smart Attendance'),
    };
  }

  const cleanScript = (scriptUrl || '').trim();
  if (cleanScript && cleanScript !== DEFAULT_SCRIPT_URL && !cleanScript.endsWith('/dev')) {
    return {
      provider: 'apps_script',
      label: 'Google Apps Script (MailApp)',
      configured: true,
    };
  }

  return {
    provider: 'none',
    label: 'Not Configured',
    configured: false,
  };
}

async function sendDirectEmail(params: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<{ ok: boolean; provider: EmailProviderType; error?: string }> {
  const recipient = params.to.trim();
  if (!recipient) {
    return { ok: false, provider: 'none', error: 'Recipient email address is empty.' };
  }

  const resendKey = (process.env.RESEND_API_KEY || '').trim();
  const emailFrom = (process.env.EMAIL_FROM || '').trim();

  if (resendKey) {
    const fromAddr = emailFrom || 'Smart Attendance <onboarding@resend.dev>';
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: fromAddr,
          to: [recipient],
          subject: params.subject,
          text: params.text,
          html: params.html,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string; error?: { message?: string } };
      if (!res.ok) {
        return {
          ok: false,
          provider: 'resend',
          error: body?.message || body?.error?.message || `Resend API error (${res.status})`,
        };
      }
      return { ok: true, provider: 'resend' };
    } catch (err: unknown) {
      return {
        ok: false,
        provider: 'resend',
        error: err instanceof Error ? err.message : 'Failed to reach Resend API.',
      };
    }
  }

  const smtpUrl = (process.env.SMTP_URL || '').trim();
  const smtpHost = (process.env.SMTP_HOST || '').trim();
  const smtpUser = (process.env.SMTP_USER || '').trim();
  const smtpPass = (process.env.SMTP_PASS || '').trim();
  const smtpPort = Number(process.env.SMTP_PORT || 587);
  const smtpSecure = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || smtpPort === 465;

  if (smtpUrl || (smtpHost && smtpUser && smtpPass)) {
    const fromAddr = emailFrom || (smtpUser ? `Smart Attendance <${smtpUser}>` : 'no-reply@localhost');
    try {
      const transporter = smtpUrl
        ? nodemailer.createTransport(smtpUrl)
        : nodemailer.createTransport({
            host: smtpHost,
            port: smtpPort,
            secure: smtpSecure,
            auth: { user: smtpUser, pass: smtpPass },
          });
      await transporter.sendMail({
        from: fromAddr,
        to: recipient,
        subject: params.subject,
        text: params.text,
        html: params.html,
      });
      return { ok: true, provider: 'smtp' };
    } catch (err: unknown) {
      return {
        ok: false,
        provider: 'smtp',
        error: err instanceof Error ? err.message : 'SMTP delivery failed.',
      };
    }
  }

  return { ok: false, provider: 'none', error: 'No built-in email provider configured.' };
}

async function dispatchSignupApprovalEmails(params: {
  toEmail: string;
  username: string;
  cfg: { scriptUrl: string; adminEmail: string };
}): Promise<{ emailSent: boolean; provider: EmailProviderType; error?: string }> {
  const status = getEmailDeliveryStatus(params.cfg.scriptUrl);

  if (status.provider === 'resend' || status.provider === 'smtp') {
    const safeUser = escapeHtml(params.username);
    const safeEmail = escapeHtml(params.toEmail);

    let adminEmailSent = false;
    if (params.cfg.adminEmail) {
      const adminRes = await sendDirectEmail({
        to: params.cfg.adminEmail,
        subject: `[Smart Attendance] Approval Needed: New User Signup (${params.username})`,
        text:
          `A new user signed up on the Smart QR Attendance System and is waiting for Admin approval.\n\n` +
          `Username: ${params.username}\nEmail: ${params.toEmail}\nStatus: Pending Admin Approval\n\n` +
          `Open the Admin Control Center -> Users tab to approve and activate this account.\n`,
        html:
          `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:20px;border:1px solid #e5e7eb;border-radius:12px;">` +
          `<h3 style="color:#111827;margin:0 0 8px;">New User Signup — Approval Needed</h3>` +
          `<p style="color:#374151;font-size:14px;"><strong>Username:</strong> ${safeUser}<br/><strong>Email:</strong> ${safeEmail}<br/><strong>Status:</strong> Pending Admin Approval</p>` +
          `<p style="color:#6b7280;font-size:12px;">Open the Admin Control Center &rarr; Users tab in Smart Attendance to approve and activate this account.</p>` +
          `</div>`,
      }).catch(() => ({ ok: false, provider: status.provider, error: 'Failed to notify admin' }));
      adminEmailSent = Boolean(adminRes.ok);
    }

    const userRes = await sendDirectEmail({
      to: params.toEmail,
      subject: 'Smart Attendance Registration Received (Pending Admin Approval)',
      text:
        `Hello ${params.username},\n\n` +
        `Thank you for signing up for the Smart QR Attendance System.\n\n` +
        `Your account has been created and is waiting for Administrator approval before it can be used.\n` +
        `You will receive another confirmation email once the Administrator approves and activates your account.\n`,
      html:
        `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;border:1px solid #e5e7eb;border-radius:12px;">` +
        `<h2 style="color:#111827;margin:0 0 10px;">Registration Pending Approval</h2>` +
        `<p style="color:#4b5563;font-size:14px;">Hello <strong>${safeUser}</strong>,</p>` +
        `<p style="color:#4b5563;font-size:14px;">Thank you for signing up for the Smart QR Attendance System. Your account is currently <strong>pending Administrator approval</strong> and cannot be used until it is approved.</p>` +
        `<p style="color:#6b7280;font-size:12px;">You will receive a confirmation email once the Administrator activates your account.</p>` +
        `</div>`,
    }).catch(() => ({ ok: false, provider: status.provider, error: 'Failed to notify user' }));

    return {
      emailSent: Boolean(userRes.ok || adminEmailSent),
      provider: status.provider,
      error: userRes.error,
    };
  }

  const emailRes = await postToGoogleScript(params.cfg.scriptUrl, {
    action: 'SEND_ACTIVATION_EMAIL',
    toEmail: params.toEmail,
    username: params.username,
    activationUrl: '',
    expiresAtText: '',
    adminEmail: params.cfg.adminEmail,
  });
  return {
    emailSent: Boolean(emailRes.ok && emailRes.json?.success && emailRes.json?.emailSent !== false),
    provider: status.provider,
    error: typeof emailRes.json?.error === 'string' ? emailRes.json.error : undefined,
  };
}

async function dispatchDeleteRequestEmail(params: {
  username: string;
  userEmail: string;
  reason: string;
  cfg: { scriptUrl: string; adminEmail: string };
}): Promise<{ emailSent: boolean; provider: EmailProviderType }> {
  const status = getEmailDeliveryStatus(params.cfg.scriptUrl);
  if (status.provider === 'resend' || status.provider === 'smtp') {
    const targetAdmin = params.cfg.adminEmail || (process.env.EMAIL_FROM || '').trim() || (process.env.SMTP_USER || '').trim();
    if (!targetAdmin) {
      return { emailSent: false, provider: status.provider };
    }
    const safeUser = escapeHtml(params.username);
    const safeEmail = escapeHtml(params.userEmail || 'N/A');
    const safeReason = escapeHtml(params.reason);
    const res = await sendDirectEmail({
      to: targetAdmin,
      subject: `[Smart Attendance] Account Deletion Request: ${params.username}`,
      text:
        `A user submitted an account deletion request from the Smart QR Attendance app.\n\n` +
        `Username: ${params.username}\nEmail: ${params.userEmail}\nReason: ${params.reason}\n\n` +
        `Open the Admin Control Center to review and remove this account.`,
      html:
        `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:20px;border:1px solid #e5e7eb;border-radius:12px;">` +
        `<h3 style="color:#991b1b;margin:0 0 8px;">Account Deletion Request</h3>` +
        `<p style="color:#374151;font-size:14px;"><strong>Username:</strong> ${safeUser}<br/><strong>Email:</strong> ${safeEmail}<br/><strong>Reason:</strong> ${safeReason}</p>` +
        `<p style="color:#6b7280;font-size:12px;">Open the Admin Control Center in the app to review and remove this account.</p>` +
        `</div>`,
    });
    return { emailSent: res.ok, provider: res.provider };
  }

  const emailRes = await postToGoogleScript(params.cfg.scriptUrl, {
    action: 'SEND_DELETE_REQUEST_EMAIL',
    username: params.username,
    userEmail: params.userEmail,
    reason: params.reason,
    adminEmail: params.cfg.adminEmail,
  });
  return {
    emailSent: Boolean(emailRes.ok && emailRes.json?.success && emailRes.json?.emailSent !== false),
    provider: status.provider,
  };
}

async function dispatchApprovalPinEmail(params: {
  toEmail: string;
  username: string;
  pin: string;
  expiresAtText: string;
  cfg: { scriptUrl: string; adminEmail: string };
}): Promise<{ emailSent: boolean; provider: EmailProviderType; error?: string }> {
  const status = getEmailDeliveryStatus(params.cfg.scriptUrl);
  const expiryLine = params.expiresAtText
    ? `This Activation PIN expires in 24 hours (${params.expiresAtText}).`
    : 'This Activation PIN expires within 24 hours.';

  if (status.provider === 'resend' || status.provider === 'smtp') {
    const safeUser = escapeHtml(params.username);
    const safePin = escapeHtml(params.pin);
    const safeExpiry = escapeHtml(expiryLine);
    const res = await sendDirectEmail({
      to: params.toEmail,
      subject: 'Your Smart Attendance Account Is Approved — Activation PIN',
      text:
        `Hello ${params.username},\n\n` +
        `Good news! Your Smart QR Attendance account has been approved by the Administrator.\n\n` +
        `Your 6-digit Activation PIN is: ${params.pin}\n\n` +
        `How to complete activation:\n` +
        `1. Open the Smart Attendance Sign In page and log in with your User Name and Password first.\n` +
        `2. Key in this 6-digit Activation PIN when prompted to complete activation and start using your account.\n\n` +
        `${expiryLine}\n`,
      html:
        `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;border:1px solid #e5e7eb;border-radius:12px;">` +
        `<h2 style="color:#111827;margin:0 0 10px;">Account Approved — Activation PIN</h2>` +
        `<p style="color:#4b5563;font-size:14px;">Hello <strong>${safeUser}</strong>,</p>` +
        `<p style="color:#4b5563;font-size:14px;">Your Smart QR Attendance account has been approved by the Administrator. Sign in with your User Name and Password first, then key in this 6-digit Activation PIN when prompted to complete activation and access your account:</p>` +
        `<div style="margin:20px 0;padding:14px 20px;background:#eef2ff;border:2px solid #c7d2fe;border-radius:12px;text-align:center;font-family:monospace;font-size:28px;font-weight:900;letter-spacing:0.25em;color:#3730a3;">${safePin}</div>` +
        `<p style="color:#92400e;background:#fffbeb;border:1px solid #fde68a;padding:10px 12px;border-radius:8px;font-size:12px;font-weight:bold;">${safeExpiry}</p>` +
        `</div>`,
    }).catch(() => ({ ok: false, provider: status.provider, error: 'Failed to send PIN email' }));

    return {
      emailSent: Boolean(res.ok),
      provider: status.provider,
      error: res.error,
    };
  }

  const emailRes = await postToGoogleScript(params.cfg.scriptUrl, {
    action: 'SEND_ACTIVATION_EMAIL',
    toEmail: params.toEmail,
    username: params.username,
    activationPin: params.pin,
    activationUrl: '',
    expiresAtText: params.expiresAtText,
    adminEmail: params.cfg.adminEmail,
  });
  return {
    emailSent: Boolean(emailRes.ok && emailRes.json?.success && emailRes.json?.emailSent !== false),
    provider: status.provider,
    error: typeof emailRes.json?.error === 'string' ? emailRes.json.error : undefined,
  };
}

async function createActivationNotifications(
  userRecord: StoredAppUser,
  activatedBy: 'admin' | 'email_pin'
): Promise<{ adminNotification: AdminNotification; userNotification: UserNotification }> {
  const now = Date.now();
  const suffix = crypto.randomBytes(2).toString('hex');
  const adminNotifId = `activated_${now}_${suffix}`;
  const userNotifId = `user_activated_${now}_${suffix}`;

  const [cfg, existingAdminNotifs] = await Promise.all([
    getAppConfig(),
    fbGet<Record<string, AdminNotification>>('admin_notifications').catch(() => null),
  ]);

  if (existingAdminNotifs && typeof existingAdminNotifs === 'object') {
    await Promise.all(
      Object.values(existingAdminNotifs)
        .filter((n) => n && !n.read && n.type === 'user_signup' && n.userId === userRecord.id)
        .map((n) => fbPatch(`admin_notifications/${n.id}`, { read: true }).catch(() => { /* ignore */ }))
    );
  }

  let emailSent = false;
  try {
    const status = getEmailDeliveryStatus(cfg.scriptUrl);
    if (status.provider === 'resend' || status.provider === 'smtp') {
      const safeUser = escapeHtml(userRecord.username);
      const actorText =
        activatedBy === 'email_pin'
          ? 'with your Activation PIN after Admin approval'
          : 'by the Administrator';

      if (userRecord.email) {
        const userEmailRes = await sendDirectEmail({
          to: userRecord.email,
          subject: 'Your Smart Attendance Account Is Now Active',
          text:
            `Hello ${userRecord.username},\n\n` +
            `Your lecturer account on the Smart Attendance system is now active (${actorText}).\n` +
            `You can sign in and manage your attendance sessions anytime.\n`,
          html:
            `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;border:1px solid #e5e7eb;border-radius:12px;">` +
            `<h2 style="color:#065f46;margin:0 0 10px;">Account Activated</h2>` +
            `<p style="color:#374151;font-size:14px;">Hello <strong>${safeUser}</strong>,</p>` +
            `<p style="color:#374151;font-size:14px;">Your Smart Attendance lecturer account is now active and ready to use.</p>` +
            `</div>`,
        });
        if (userEmailRes.ok) emailSent = true;
      }
    }
  } catch {
    // Email confirmation is best-effort; in-system notifications still proceed
  }

  const adminNotification: AdminNotification = {
    id: adminNotifId,
    type: 'account_activated',
    userId: userRecord.id,
    username: userRecord.username,
    email: userRecord.email || '',
    createdAt: now,
    read: false,
    emailSent,
    message:
      activatedBy === 'email_pin'
        ? `${userRecord.username} (${userRecord.email || 'no email'}) entered their Activation PIN and is now active.`
        : `${userRecord.username} (${userRecord.email || 'no email'}) account has been activated by Admin.`,
  };

  const userNotification: UserNotification = {
    id: userNotifId,
    userId: userRecord.id,
    type: 'account_activated',
    title: 'Account Activated',
    message: `Your lecturer account (${userRecord.username}) is now active and ready to use.`,
    createdAt: now,
    read: false,
  };

  await Promise.all([
    fbPut(`admin_notifications/${adminNotifId}`, adminNotification),
    fbPut(`user_notifications/${userRecord.id}/${userNotifId}`, userNotification),
  ]);

  return { adminNotification, userNotification };
}

async function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  const payload = verifySessionToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Session expired or invalid. Please sign in again.' });
    return;
  }
  try {
    const [userRecord, sessionRecord] = await Promise.all([
      fbGet<StoredAppUser>(`app_users/${payload.uid}`),
      payload.sid ? fbGet<AdminSessionActivity>(`admin_logins/${payload.sid}`) : Promise.resolve(null),
    ]);

    if (!userRecord || !userRecord.id) {
      res.status(401).json({ error: 'Your account access was removed by the Administrator.' });
      return;
    }
    if (userRecord.role !== 'admin' && userRecord.status !== 'active') {
      res.status(401).json({ error: 'Your account is deactivated. Contact the Administrator.' });
      return;
    }
    if (sessionRecord && sessionRecord.status === 'signed_out') {
      res.status(401).json({ error: 'Your session was signed out by the Administrator.' });
      return;
    }
    req.auth = {
      ...payload,
      role: userRecord.username.toLowerCase() === 'admin' ? 'admin' : userRecord.role || payload.role,
    };
    next();
  } catch {
    res.status(500).json({ error: 'Unable to verify authentication session.' });
  }
}

function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.auth || req.auth.role !== 'admin') {
    res.status(403).json({ error: 'Administrator privileges required.' });
    return;
  }
  next();
}

async function resolveRosterForCourse(params: {
  courseName?: string;
  courseId?: string;
}): Promise<PreRegisteredStudent[]> {
  const cleanCourse = (params.courseName || '').trim();
  const cleanId = (params.courseId || '').trim();
  const cfg = await getAppConfig();

  // 1. Check Google Sheets if configured
  if (
    cfg.integrationType === 'google_sheets' &&
    cfg.scriptUrl &&
    cfg.scriptUrl !== DEFAULT_SCRIPT_URL &&
    !cfg.scriptUrl.endsWith('/dev')
  ) {
    try {
      const sheetUrl = `${cfg.scriptUrl}${cfg.scriptUrl.includes('?') ? '&' : '?'}action=getCourse${
        cleanCourse ? `&course=${encodeURIComponent(cleanCourse)}` : ''
      }&t=${Date.now()}`;
      const res = await fetch(sheetUrl, { method: 'GET', redirect: 'follow' });
      const rawText = await res.text();
      if (res.ok && !rawText.trim().startsWith('<')) {
        const data = JSON.parse(rawText) as {
          success?: boolean;
          students?: Array<{ id?: unknown; name?: unknown }>;
          sheets?: Array<{ courseName?: unknown; students?: Array<{ id?: unknown; name?: unknown }> }>;
        };
        if (data?.success) {
          const sheetsArr = Array.isArray(data.sheets) ? data.sheets : [];
          const targetUpper = cleanCourse.toUpperCase();
          const matchedTab = targetUpper
            ? sheetsArr.find((s) => String(s?.courseName || '').trim().toUpperCase() === targetUpper)
            : undefined;
          const rawStudents =
            targetUpper && sheetsArr.length > 0
              ? matchedTab && Array.isArray(matchedTab.students)
                ? matchedTab.students
                : []
              : Array.isArray(data.students)
                ? data.students
                : [];
          if (rawStudents.length > 0) {
            const seen = new Set<string>();
            const normalized: PreRegisteredStudent[] = [];
            for (const item of rawStudents) {
              const id = String(item?.id || '').trim().toUpperCase();
              const name = String(item?.name || '').trim().toUpperCase();
              if (id && name && !seen.has(id)) {
                seen.add(id);
                normalized.push({ id, name });
              }
            }
            if (normalized.length > 0) return normalized;
          }
        }
      }
    } catch {
      // Fallback to Firebase course roster
    }
  }

  // 2. Check Firebase /courses
  const coursesObj = await fbGet<Record<string, CourseProfile>>('courses');
  if (coursesObj && typeof coursesObj === 'object') {
    const allCourses = Object.values(coursesObj).filter((c) => c && c.id);
    if (cleanId) {
      const byId = allCourses.find((c) => c.id === cleanId);
      if (byId && Array.isArray(byId.students) && byId.students.length > 0) {
        return byId.students;
      }
    }
    if (cleanCourse) {
      const targetUpper = cleanCourse.toUpperCase();
      const byName = allCourses.find((c) => c.courseName?.trim().toUpperCase() === targetUpper);
      if (byName && Array.isArray(byName.students) && byName.students.length > 0) {
        return byName.students;
      }
    }
  }

  return cfg.knownStudentsV2;
}

export function createApiApp(): express.Express {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  // Ensure admin record exists with hashed password
  void ensureAdminUserExists().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('Could not initialize admin record on boot:', msg);
  });

  // 1. Public Config (no secrets)
  app.get('/api/config/public', async (_req: Request, res: Response) => {
    try {
      const cfg = await getAppConfig();
      res.json({
        databaseUrl: FIREBASE_DB_URL,
        scriptUrl: cfg.scriptUrl,
        integrationType: cfg.integrationType,
        adminEmailConfigured: Boolean(cfg.adminEmail),
      });
    } catch {
      res.json({
        databaseUrl: FIREBASE_DB_URL,
        scriptUrl: DEFAULT_SCRIPT_URL,
        integrationType: 'google_sheets',
        adminEmailConfigured: false,
      });
    }
  });

  // 2. Auth: Login
  app.post('/api/auth/login', async (req: Request, res: Response) => {
    try {
      const usernameOrEmail = String(req.body?.usernameOrEmail || '').trim().toLowerCase();
      const password = String(req.body?.password || '');
      if (!usernameOrEmail || !password) {
        res.status(400).json({ success: false, message: 'Username/Email and Password are required.' });
        return;
      }

      await ensureAdminUserExists();
      const usersObj = (await fbGet<Record<string, StoredAppUser>>('app_users')) || {};
      const allUsers = Object.values(usersObj).filter((u) => u && u.id && u.username);

      const matched = allUsers.find(
        (u) =>
          u.username.toLowerCase() === usernameOrEmail ||
          (u.email && u.email.toLowerCase() === usernameOrEmail)
      );

      if (!matched) {
        res.status(401).json({ success: false, message: 'Invalid User Name / Email or Password.' });
        return;
      }

      const passwordOk = await verifyAndUpgradeUserPassword(matched, password);
      if (!passwordOk) {
        res.status(401).json({ success: false, message: 'Invalid User Name / Email or Password.' });
        return;
      }

      const role: 'admin' | 'lecturer' = matched.username.toLowerCase() === 'admin' ? 'admin' : matched.role || 'lecturer';
      if (matched.status === 'pending' && role !== 'admin') {
        res.status(403).json({
          success: false,
          message:
            'Your account is waiting for Admin approval. An activation PIN will be emailed to you once approved.',
        });
        return;
      }
      if (matched.status === 'approved_pending_pin' && role !== 'admin') {
        res.status(403).json({
          success: false,
          requiresActivationPin: true,
          username: matched.username,
          challengeToken: signPinChallengeToken(matched.id),
          message:
            'Your account has been approved! Enter the 6-digit Activation PIN sent to your email to complete activation.',
        });
        return;
      }

      const now = Date.now();
      const sessionId = `${toFirebaseKey(matched.username.toLowerCase())}_${now}`;
      const device = getDeviceLabel(String(req.headers['user-agent'] || ''));
      const newSession: AdminSessionActivity = {
        id: sessionId,
        adminName: matched.username,
        email: matched.email || '',
        device,
        date: new Date(now).toISOString().slice(0, 10),
        loginTime: now,
        lastActiveTime: now,
        status: 'active',
        currentAction: 'Dashboard',
      };

      await Promise.all([
        fbPut(`admin_logins/${sessionId}`, newSession),
        fbPatch(`app_users/${matched.id}`, { lastLoginAt: now }),
      ]);

      const token = signSessionToken({
        uid: matched.id,
        username: matched.username,
        role,
        sid: sessionId,
        iat: now,
        exp: now + SESSION_TTL_MS,
      });

      res.json({
        success: true,
        token,
        user: sanitizeUser({ ...matched, role }),
        session: newSession,
      });
    } catch {
      res.status(500).json({ success: false, message: 'Server error during sign in.' });
    }
  });

  // 3. Auth: Sign Up
  app.post('/api/auth/signup', async (req: Request, res: Response) => {
    try {
      const cleanUser = String(req.body?.username || '').trim();
      const cleanEmail = String(req.body?.email || '').trim().toLowerCase();
      const password = String(req.body?.password || '');

      if (!cleanUser || !cleanEmail || !password) {
        res.status(400).json({ success: false, message: 'All fields are required.' });
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        res.status(400).json({ success: false, message: 'Please enter a valid email address.' });
        return;
      }

      const usersObj = (await fbGet<Record<string, StoredAppUser>>('app_users')) || {};
      const latestUsers = Object.values(usersObj).filter((u) => u && u.id && u.username);

      if (latestUsers.some((u) => u.username.toLowerCase() === cleanUser.toLowerCase())) {
        res.status(409).json({ success: false, message: 'Username already exists.' });
        return;
      }
      if (latestUsers.some((u) => u.email && u.email.toLowerCase() === cleanEmail)) {
        res.status(409).json({ success: false, message: 'Email address is already registered.' });
        return;
      }

      const now = Date.now();
      const userId = `${toFirebaseKey(cleanUser.toLowerCase())}_${now.toString(36)}`;

      const newUser: StoredAppUser = {
        id: userId,
        username: cleanUser,
        email: cleanEmail,
        passwordHash: hashPassword(password),
        role: 'lecturer',
        status: 'pending',
        createdAt: now,
      };

      await fbPut(`app_users/${userId}`, newUser);

      const cfg = await getAppConfig();
      const { emailSent } = await dispatchSignupApprovalEmails({
        toEmail: cleanEmail,
        username: cleanUser,
        cfg,
      });

      const notifId = `notif_${now}_${crypto.randomBytes(2).toString('hex')}`;
      const notif: AdminNotification = {
        id: notifId,
        type: 'user_signup',
        userId,
        username: cleanUser,
        email: cleanEmail,
        createdAt: now,
        read: false,
        emailSent,
        message: `${cleanUser} (${cleanEmail}) signed up and is waiting for Admin approval.`,
      };
      await fbPut(`admin_notifications/${notifId}`, notif).catch(() => { /* ignore */ });

      res.json({
        success: true,
        message:
          'Account created! Once Admin approves your request, a 6-digit Activation PIN will be emailed to you to complete activation.',
      });
    } catch {
      res.status(500).json({ success: false, message: 'Failed to save user registration to cloud.' });
    }
  });

  // 4. Auth: Complete Signup Activation with Emailed PIN (issued after Admin Approval)
  app.post('/api/auth/activate', async (req: Request, res: Response) => {
    try {
      const lookup = String(req.body?.usernameOrEmail || '').trim().toLowerCase();
      const rawPin = String(req.body?.pin || '').trim().replace(/\D/g, '');
      const challengeToken = String(req.body?.challengeToken || '').trim();
      if (!lookup || rawPin.length !== 6) {
        res.status(400).json({
          success: false,
          message: 'Please enter your User Name or Email and the 6-digit Activation PIN.',
        });
        return;
      }

      const usersObj = (await fbGet<Record<string, StoredAppUser>>('app_users')) || {};
      const userRecord = Object.values(usersObj).find(
        (u) =>
          u &&
          u.id &&
          (u.username?.toLowerCase() === lookup || (u.email && u.email.toLowerCase() === lookup))
      );

      if (!userRecord || !userRecord.id) {
        res.status(404).json({
          success: false,
          message: 'Account not found. Please sign up first or check your username/email.',
        });
        return;
      }
      if (userRecord.status === 'active') {
        res.json({
          success: true,
          message: `Account "${userRecord.username}" is already active. You can sign in below.`,
        });
        return;
      }
      if (userRecord.status === 'pending') {
        res.status(403).json({
          success: false,
          message:
            'Your account is still waiting for Admin approval. You will receive an email with your Activation PIN once approved.',
        });
        return;
      }
      if (!userRecord.activationPin || !timingSafeStringEqual(rawPin, userRecord.activationPin)) {
        res.status(403).json({
          success: false,
          message: 'Invalid Activation PIN. Please check the 6-digit PIN sent to your email.',
        });
        return;
      }
      if (userRecord.activationExpiresAt && Date.now() > userRecord.activationExpiresAt) {
        res.status(410).json({
          success: false,
          message: 'This Activation PIN has expired. Please ask Admin to resend a new PIN.',
        });
        return;
      }

      const now = Date.now();
      const challenge = challengeToken ? verifyPinChallengeToken(challengeToken) : null;
      const canAutoSignIn = Boolean(challenge && challenge.uid === userRecord.id);

      await fbPatch(`app_users/${userRecord.id}`, {
        status: 'active',
        activatedAt: now,
        activationPin: null,
        activationExpiresAt: null,
        ...(canAutoSignIn ? { lastLoginAt: now } : {}),
      });

      await createActivationNotifications(userRecord, 'email_pin').catch(() => { /* ignore */ });

      if (canAutoSignIn) {
        const role: 'admin' | 'lecturer' =
          userRecord.username.toLowerCase() === 'admin' ? 'admin' : userRecord.role || 'lecturer';
        const sessionId = `${toFirebaseKey(userRecord.username.toLowerCase())}_${now}`;
        const device = getDeviceLabel(String(req.headers['user-agent'] || ''));
        const newSession: AdminSessionActivity = {
          id: sessionId,
          adminName: userRecord.username,
          email: userRecord.email || '',
          device,
          date: new Date(now).toISOString().slice(0, 10),
          loginTime: now,
          lastActiveTime: now,
          status: 'active',
          currentAction: 'Dashboard',
        };
        await fbPut(`admin_logins/${sessionId}`, newSession);

        const token = signSessionToken({
          uid: userRecord.id,
          username: userRecord.username,
          role,
          sid: sessionId,
          iat: now,
          exp: now + SESSION_TTL_MS,
        });

        res.json({
          success: true,
          token,
          user: sanitizeUser({ ...userRecord, status: 'active', activatedAt: now, role }),
          session: newSession,
          message: `Account "${userRecord.username}" activated and ready to use!`,
        });
        return;
      }

      res.json({
        success: true,
        message: `Account "${userRecord.username}" activated! You can now sign in.`,
      });
    } catch {
      res.status(500).json({ success: false, message: 'Server error while verifying activation PIN.' });
    }
  });

  // 5. Auth: Account Deletion Request (from Login screen)
  app.post('/api/auth/delete-request', async (req: Request, res: Response) => {
    try {
      const lookup = String(req.body?.usernameOrEmail || '').trim().toLowerCase();
      const reason = String(req.body?.reason || 'Requested via app').trim();
      if (!lookup) {
        res.status(400).json({ success: false, message: 'Please enter your User Name or Email Address.' });
        return;
      }

      const usersObj = (await fbGet<Record<string, StoredAppUser>>('app_users')) || {};
      const matched = Object.values(usersObj).find(
        (u) =>
          u &&
          u.id &&
          (u.username?.toLowerCase() === lookup || (u.email && u.email.toLowerCase() === lookup))
      );

      if (!matched || matched.role === 'admin' || matched.username.toLowerCase() === 'admin') {
        res.status(404).json({
          success: false,
          message: 'No matching lecturer account found for that username or email.',
        });
        return;
      }

      const now = Date.now();
      await fbPatch(`app_users/${matched.id}`, {
        deletionRequestedAt: now,
        deletionReason: reason,
      });

      const cfg = await getAppConfig();
      const { emailSent } = await dispatchDeleteRequestEmail({
        username: matched.username,
        userEmail: matched.email || '',
        reason,
        cfg,
      });

      const notifId = `delreq_${now}_${crypto.randomBytes(2).toString('hex')}`;
      const notif: AdminNotification = {
        id: notifId,
        type: 'delete_request',
        userId: matched.id,
        username: matched.username,
        email: matched.email || '',
        createdAt: now,
        read: false,
        emailSent,
        reason,
        message: `${matched.username} (${matched.email || 'no email'}) requested account deletion: ${reason}`,
      };
      await fbPut(`admin_notifications/${notifId}`, notif);

      res.json({
        success: true,
        message: 'Deletion request sent to the Administrator for review.',
      });
    } catch {
      res.status(500).json({ success: false, message: 'Could not submit deletion request.' });
    }
  });

  // 6. Auth: Logout & Heartbeat
  app.post('/api/auth/logout', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const sid = req.auth?.sid;
    if (sid) {
      await fbPatch(`admin_logins/${sid}`, {
        status: 'signed_out',
        lastActiveTime: Date.now(),
        currentAction: 'Signed Out',
      }).catch(() => { /* ignore */ });
    }
    res.json({ success: true });
  });

  app.post('/api/auth/heartbeat', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const auth = req.auth!;
    if (!auth.sid) {
      res.json({ success: true });
      return;
    }
    const now = Date.now();
    const currentAction = String(req.body?.currentAction || 'Dashboard').slice(0, 60);
    await fbPatch(`admin_logins/${auth.sid}`, {
      id: auth.sid,
      adminName: auth.username,
      device: getDeviceLabel(String(req.headers['user-agent'] || '')),
      date: new Date(now).toISOString().slice(0, 10),
      lastActiveTime: now,
      status: 'active',
      currentAction,
    }).catch(() => { /* ignore */ });
    res.json({ success: true });
  });

  // 7. Public Student QR Check-in Endpoints
  app.get('/api/student/roster', async (req: Request, res: Response) => {
    try {
      const courseName = String(req.query.course || '').trim();
      const courseId = String(req.query.courseId || '').trim();
      const students = await resolveRosterForCourse({ courseName, courseId });
      res.json({ success: true, students });
    } catch {
      res.json({ success: true, students: PRE_REGISTERED_STUDENTS });
    }
  });

  // 7.5. Server-Signed Short-Lived QR Issuance (15s) & Student Verification
  app.post('/api/qr/token', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const auth = req.auth!;
      const courseName = String(req.body?.courseName || 'General Session').trim() || 'General Session';
      const courseId = String(req.body?.courseId || '').trim();
      const week = String(req.body?.week || 'W1').trim().toUpperCase() || 'W1';
      const requirePin = typeof req.body?.requirePin === 'boolean' ? req.body.requirePin : undefined;
      const rotatePin = Boolean(req.body?.rotatePin);
      const sessionKey = buildPinSessionKey(courseName);

      const pinConfig = await getOrUpdatePinConfig({
        sessionKey,
        courseName,
        week,
        requirePin,
        rotatePin,
        updatedBy: auth.username,
      });

      const iat = Date.now();
      const exp = iat + QR_TOKEN_VALIDITY_MS;
      const qrToken = signQrToken({
        v: 1,
        iat,
        exp,
        courseName,
        courseId,
        week,
        sessionKey,
        pinRequired: pinConfig.enabled,
      });

      res.json({
        success: true,
        qrToken,
        iat,
        exp,
        ttlMs: QR_TOKEN_VALIDITY_MS,
        pinRequired: pinConfig.enabled,
        pin: pinConfig.pin,
      });
    } catch {
      res.status(500).json({ success: false, message: 'Failed to issue signed QR token.' });
    }
  });

  app.post('/api/qr/verify', async (req: Request, res: Response) => {
    try {
      const sig = String(req.body?.sig || '').trim();
      if (!sig) {
        res.status(403).json({
          success: false,
          code: 'QR_UNVERIFIED',
          message: 'Unverified or outdated QR code. Please scan the live attendance QR code in class.',
        });
        return;
      }

      const payload = verifyQrToken(sig);
      if (!payload) {
        res.status(403).json({
          success: false,
          code: 'QR_INVALID',
          message: 'Invalid or tampered QR code. Please scan the live QR code in class.',
        });
        return;
      }

      const now = Date.now();
      if (now > payload.exp) {
        res.status(410).json({
          success: false,
          code: 'QR_EXPIRED',
          message: 'QR Code expired (15s limit). Scan the newest live code in class.',
        });
        return;
      }

      const latestPinConfig = await readPinConfig(payload.sessionKey);
      const pinRequired = latestPinConfig ? latestPinConfig.enabled : payload.pinRequired;

      const grantExp = now + CHECKIN_GRANT_VALIDITY_MS;
      const checkinToken = signCheckinGrant({
        v: 1,
        nonce: crypto.randomBytes(12).toString('hex'),
        iat: now,
        exp: grantExp,
        courseName: payload.courseName,
        courseId: payload.courseId,
        week: payload.week,
        sessionKey: payload.sessionKey,
        pinRequired,
      });

      res.json({
        success: true,
        checkinToken,
        expiresAt: grantExp,
        pinRequired,
        courseName: payload.courseName,
        courseId: payload.courseId,
        week: payload.week,
      });
    } catch {
      res.status(500).json({ success: false, message: 'Could not verify QR code. Please try again.' });
    }
  });

  app.post('/api/student/checkin', async (req: Request, res: Response) => {
    try {
      const name = String(req.body?.name || '').trim();
      const studentId = String(req.body?.studentId || '').trim();
      const status = String(req.body?.status || 'P').trim().toUpperCase();
      let courseName = String(req.body?.courseName || 'General Session').trim();
      let courseId = String(req.body?.courseId || '').trim();
      let week = String(req.body?.week || 'W1').trim().toUpperCase();

      if (!name || !studentId) {
        res.status(400).json({ success: false, message: 'Name and Student ID are required.' });
        return;
      }

      // Check if an authenticated lecturer/admin is submitting via Tablet / Kiosk Mode
      let isLecturerKiosk = false;
      const authHeader = String(req.headers.authorization || '');
      if (authHeader.startsWith('Bearer ')) {
        const bearerToken = authHeader.slice(7).trim();
        const authPayload = bearerToken ? verifySessionToken(bearerToken) : null;
        if (authPayload) {
          const userRecord = await fbGet<StoredAppUser>(`app_users/${authPayload.uid}`).catch(() => null);
          if (userRecord && userRecord.id && (userRecord.role === 'admin' || userRecord.status === 'active')) {
            isLecturerKiosk = true;
          }
        }
      }

      let verifiedGrant: CheckinGrantPayload | null = null;
      if (!isLecturerKiosk) {
        const checkinToken = String(req.body?.checkinToken || '').trim();
        verifiedGrant = verifyCheckinGrant(checkinToken);
        if (!verifiedGrant) {
          res.status(401).json({
            success: false,
            code: 'GRANT_EXPIRED',
            message: 'QR verification expired. Please scan the live QR code again.',
          });
          return;
        }

        const now = Date.now();
        pruneUsedScanNonces(now);
        const alreadyUsedMem = usedScanNonces.has(verifiedGrant.nonce);
        const alreadyUsedDb = !alreadyUsedMem
          ? await fbGet<number>(`used_qr_nonces/${verifiedGrant.nonce}`).catch(() => null)
          : 1;
        if (alreadyUsedMem || alreadyUsedDb) {
          res.status(409).json({
            success: false,
            code: 'QR_ALREADY_USED',
            message: 'This QR scan has already been used. Please scan the live QR code again.',
          });
          return;
        }

        // Bind submission to the signed QR's course and week
        courseName = verifiedGrant.courseName || courseName;
        courseId = verifiedGrant.courseId || courseId;
        week = verifiedGrant.week || week;

        const pinConfig = await readPinConfig(verifiedGrant.sessionKey);
        const pinMustMatch = pinConfig ? pinConfig.enabled : verifiedGrant.pinRequired;
        if (pinMustMatch) {
          const submittedPin = String(req.body?.pin || '').trim();
          if (!submittedPin || !pinConfig || !timingSafeStringEqual(submittedPin, pinConfig.pin)) {
            res.status(403).json({
              success: false,
              code: 'INVALID_PIN',
              message: 'Invalid Classroom PIN. Ask your lecturer for the current 4-digit PIN.',
            });
            return;
          }
        }
      }

      const roster = await resolveRosterForCourse({ courseName, courseId });
      const normalizeRegName = (val: string) => val.trim().replace(/\s+/g, ' ').toUpperCase();
      const normalizeRegId = (val: string) => val.trim().replace(/\s+/g, '').toUpperCase();

      const cleanSubmittedName = normalizeRegName(name);
      const cleanSubmittedId = normalizeRegId(studentId);
      const nameMatches = roster.filter((s) => normalizeRegName(s.name) === cleanSubmittedName);

      if (nameMatches.length === 0) {
        res.status(403).json({
          success: false,
          message: 'Your name is not registered in the system. Please consult with your Lecturer.',
        });
        return;
      }
      if (!nameMatches.some((s) => normalizeRegId(s.id) === cleanSubmittedId)) {
        res.status(403).json({
          success: false,
          message: 'Warning: Student ID does not match the registered student name.',
        });
        return;
      }

      const sessionPath = courseName ? `${getSessionDateId()}_${sanitizeCoursePath(courseName)}` : getSessionDateId();
      const studentKey = toStudentFirebaseKey(cleanSubmittedId);
      const liveSessionMap = await fbGet<Record<string, Student>>(`live_sessions/${sessionPath}`);
      const existingData = liveSessionMap && typeof liveSessionMap === 'object'
        ? (liveSessionMap[studentKey] ||
            Object.values(liveSessionMap).find(
              (s) => s && normalizeStudentId(s.studentId || '') === cleanSubmittedId
            ))
        : null;
      if (existingData && existingData.status === 'P' && status === 'P' && (existingData.week || 'W1').trim().toUpperCase() === week) {
        res.status(409).json({ success: false, message: 'You have already checked in for this session.' });
        return;
      }

      const timestamp = Date.now();
      const normalizedEmail = req.body?.email ? String(req.body.email).trim() : `${cleanSubmittedId}@student.edu.my`;
      const studentData: Student = {
        name: cleanSubmittedName,
        studentId: cleanSubmittedId,
        email: normalizedEmail || `${cleanSubmittedId}@student.edu.my`,
        status,
        timestamp,
        courseName,
        week,
      };

      await Promise.all([
        fbPut(`pending/${studentKey}`, studentData),
        fbPut(`live_sessions/${sessionPath}/${studentKey}`, studentData),
        upsertAttendanceHistory([studentData]),
      ]);

      if (verifiedGrant) {
        usedScanNonces.set(verifiedGrant.nonce, verifiedGrant.exp);
        void fbPut(`used_qr_nonces/${verifiedGrant.nonce}`, verifiedGrant.exp).catch(() => { /* ignore */ });
      }

      const cfg = await getAppConfig();
      if (cfg.integrationType === 'google_sheets' && cfg.scriptUrl) {
        void postToGoogleScript(cfg.scriptUrl, formatCloudPayload(studentData, week));
      }

      res.json({ success: true, message: 'Record submitted successfully.', record: studentData });
    } catch {
      res.status(500).json({ success: false, message: 'Connection lost. Please try again.' });
    }
  });

  // 8. Authenticated Dashboard Sync (Scoped by Role & Ownership)
  app.get('/api/dashboard/sync', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const auth = req.auth!;
      const [cfg, coursesObj, userPref, historyRaw, usersObj, sessionsObj, notifsObj, userNotifsObj] = await Promise.all([
        getAppConfig(),
        fbGet<Record<string, CourseProfile>>('courses'),
        fbGet<{ activeCourse?: string; selectedWeek?: string }>(`user_preferences/${auth.uid}`),
        fbGet<Student[] | Record<string, Student>>('attendance_history'),
        fbGet<Record<string, StoredAppUser>>('app_users'),
        auth.role === 'admin' ? fbGet<Record<string, AdminSessionActivity>>('admin_logins') : Promise.resolve(null),
        auth.role === 'admin' ? fbGet<Record<string, AdminNotification>>('admin_notifications') : Promise.resolve(null),
        fbGet<Record<string, UserNotification>>(`user_notifications/${auth.uid}`),
      ]);

      const allCourses = coursesObj && typeof coursesObj === 'object'
        ? Object.values(coursesObj)
            .filter((c) => c && c.id && c.courseName)
            .map(normalizeCourse)
        : [];

      const scopedCourses = allCourses
        .filter((c) => canAccessCourse(c, auth))
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

      const ownedCourseNames = new Set(scopedCourses.map((c) => c.courseName.trim().toUpperCase()));
      const allHistory: Student[] = Array.isArray(historyRaw)
        ? historyRaw.filter((h) => h && h.studentId && h.timestamp)
        : historyRaw && typeof historyRaw === 'object'
          ? Object.values(historyRaw).filter((h) => h && h.studentId && h.timestamp)
          : [];

      const scopedHistory = (
        auth.role === 'admin'
          ? allHistory
          : allHistory.filter((h) => ownedCourseNames.has((h.courseName || '').trim().toUpperCase()))
      ).sort((a, b) => b.timestamp - a.timestamp);

      const allUserRecords = usersObj && typeof usersObj === 'object'
        ? Object.values(usersObj).filter((u) => u && u.id && u.username)
        : [];

      const coLecturerOptions: CollaboratorOption[] = allUserRecords
        .filter((u) => (u.status || 'active') === 'active')
        .map((u) => ({
          id: u.id,
          username: u.username,
          role: u.username.toLowerCase() === 'admin' ? 'admin' : (u.role || 'lecturer'),
        }))
        .sort((a, b) => {
          if (a.role === 'admin' && b.role !== 'admin') return -1;
          if (b.role === 'admin' && a.role !== 'admin') return 1;
          return a.username.localeCompare(b.username);
        });

      const sanitizedUsers: AppUser[] =
        auth.role === 'admin'
          ? allUserRecords
              .map(sanitizeUser)
              .sort((a, b) => {
                if (a.role === 'admin') return -1;
                if (b.role === 'admin') return 1;
                return (b.createdAt || 0) - (a.createdAt || 0);
              })
          : [];

      const sessions: AdminSessionActivity[] =
        auth.role === 'admin' && sessionsObj && typeof sessionsObj === 'object'
          ? Object.values(sessionsObj)
              .filter((s) => s && s.id && s.adminName)
              .sort((a, b) => (b.lastActiveTime || b.loginTime || 0) - (a.lastActiveTime || a.loginTime || 0))
          : [];

      const notifications: AdminNotification[] =
        auth.role === 'admin' && notifsObj && typeof notifsObj === 'object'
          ? Object.values(notifsObj)
              .filter((n) => n && n.id)
              .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
          : [];

      const userNotifications: UserNotification[] =
        userNotifsObj && typeof userNotifsObj === 'object'
          ? Object.values(userNotifsObj)
              .filter((n) => n && n.id)
              .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
          : [];

      res.json({
        success: true,
        user: { id: auth.uid, username: auth.username, role: auth.role },
        config: {
          scriptUrl: cfg.scriptUrl,
          integrationType: cfg.integrationType,
          adminEmail: auth.role === 'admin' ? cfg.adminEmail : '',
          emailDelivery: auth.role === 'admin' ? getEmailDeliveryStatus(cfg.scriptUrl) : undefined,
        },
        courses: scopedCourses,
        userPref: userPref || null,
        history: scopedHistory,
        users: sanitizedUsers,
        coLecturerOptions,
        sessions,
        notifications,
        userNotifications,
      });
    } catch {
      res.status(500).json({ success: false, error: 'Failed to sync dashboard state.' });
    }
  });

  // 9. User Preferences & Personal Notifications (Strictly scoped to req.auth.uid)
  app.patch('/api/user/notifications/:id/read', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const auth = req.auth!;
    const notifId = String(req.params.id || '').trim();
    if (!notifId) {
      res.status(400).json({ success: false, error: 'Notification ID is required.' });
      return;
    }
    await fbPatch(`user_notifications/${auth.uid}/${notifId}`, { read: true });
    res.json({ success: true });
  });

  app.post('/api/user/notifications/read-all', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const auth = req.auth!;
    const notifsObj = (await fbGet<Record<string, UserNotification>>(`user_notifications/${auth.uid}`)) || {};
    await Promise.all(
      Object.values(notifsObj)
        .filter((n) => n && !n.read)
        .map((n) => fbPatch(`user_notifications/${auth.uid}/${n.id}`, { read: true }))
    );
    res.json({ success: true });
  });

  app.delete('/api/user/notifications', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const auth = req.auth!;
    await fbDelete(`user_notifications/${auth.uid}`);
    res.json({ success: true });
  });

  app.put('/api/user/preferences', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const auth = req.auth!;
    const activeCourse = String(req.body?.activeCourse || '').trim();
    const selectedWeek = String(req.body?.selectedWeek || 'W1').trim();
    await fbPatch(`user_preferences/${auth.uid}`, {
      activeCourse,
      selectedWeek,
      updatedAt: Date.now(),
    });
    res.json({ success: true });
  });

  // 10. Scoped Courses CRUD
  app.post('/api/courses', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const auth = req.auth!;
      const cleanName = String(req.body?.courseName || '').trim();
      const initialStudents = Array.isArray(req.body?.students) ? (req.body.students as PreRegisteredStudent[]) : [];
      const selectedWeek = String(req.body?.selectedWeek || 'W1').trim() || 'W1';
      const requestedOwnerId = auth.role === 'admin' && typeof req.body?.ownerId === 'string'
        ? req.body.ownerId.trim()
        : '';
      if (!cleanName) {
        res.status(400).json({ success: false, error: 'Course name is required.' });
        return;
      }

      const [coursesObj, usersObj] = await Promise.all([
        fbGet<Record<string, CourseProfile>>('courses'),
        fbGet<Record<string, StoredAppUser>>('app_users'),
      ]);
      const allCourses = coursesObj && typeof coursesObj === 'object'
        ? Object.values(coursesObj).filter((c) => c && c.id).map(normalizeCourse)
        : [];
      const allUsers = usersObj && typeof usersObj === 'object'
        ? Object.values(usersObj).filter((u) => u && u.id)
        : [];
      const requestedOwnerUser = requestedOwnerId
        ? allUsers.find((u) => u.id === requestedOwnerId) || null
        : null;

      let targetOwnerId = auth.uid;
      let targetCreatedBy = auth.username;
      if (auth.role === 'admin' && requestedOwnerUser) {
        targetOwnerId = requestedOwnerUser.id;
        targetCreatedBy = requestedOwnerUser.username;
      }
      const targetSharedWith = sanitizeSharedWithIds(req.body?.sharedWith, allUsers, targetOwnerId);

      const existingOwned = allCourses.find(
        (c) => canAccessCourse(c, auth) && isSameCourse(c, cleanName)
      );
      if (existingOwned) {
        res.json({ success: true, course: existingOwned });
        return;
      }

      const baseId = toCourseKey(cleanName);
      const idTakenByOther = Boolean(
        coursesObj &&
        coursesObj[baseId] &&
        !canAccessCourse(normalizeCourse(coursesObj[baseId]), auth)
      );
      const finalId = idTakenByOther ? `${baseId}__${toFirebaseKey(targetOwnerId)}` : baseId;
      const now = Date.now();

      const newCourse: CourseProfile = {
        id: finalId,
        courseName: cleanName,
        selectedWeek,
        students: initialStudents,
        ownerId: targetOwnerId,
        createdBy: targetCreatedBy,
        sharedWith: targetSharedWith,
        createdAt: now,
        updatedAt: now,
      };

      await fbPut(`courses/${finalId}`, newCourse);
      await fbPatch(`user_preferences/${auth.uid}`, {
        activeCourse: newCourse.courseName,
        selectedWeek: newCourse.selectedWeek,
        updatedAt: now,
      });

      res.json({ success: true, course: newCourse });
    } catch {
      res.status(500).json({ success: false, error: 'Failed to create course.' });
    }
  });

  app.put('/api/courses/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const auth = req.auth!;
      const courseId = String(req.params.id || '').trim();
      if (!courseId) {
        res.status(400).json({ success: false, error: 'Course ID is required.' });
        return;
      }

      const existing = await fbGet<CourseProfile>(`courses/${courseId}`);
      if (existing) {
        const normalized = normalizeCourse(existing);
        if (!canAccessCourse(normalized, auth)) {
          res.status(403).json({ success: false, error: 'You do not have permission to edit this subject.' });
          return;
        }
        const updated: CourseProfile = {
          ...normalized,
          courseName: typeof req.body?.courseName === 'string' && req.body.courseName.trim()
            ? req.body.courseName.trim()
            : normalized.courseName,
          selectedWeek: typeof req.body?.selectedWeek === 'string' && req.body.selectedWeek.trim()
            ? req.body.selectedWeek.trim()
            : normalized.selectedWeek,
          students: Array.isArray(req.body?.students) ? req.body.students : normalized.students,
          sheetName: typeof req.body?.sheetName === 'string' ? req.body.sheetName : normalized.sheetName,
          ownerId: normalized.ownerId || auth.uid,
          createdBy: normalized.createdBy || auth.username,
          updatedAt: Date.now(),
        };
        await fbPut(`courses/${courseId}`, updated);
        res.json({ success: true, course: updated });
        return;
      }

      // Create if not yet stored
      const cleanName = String(req.body?.courseName || '').trim();
      if (!cleanName) {
        res.status(404).json({ success: false, error: 'Course not found.' });
        return;
      }
      const now = Date.now();
      const created: CourseProfile = {
        id: courseId,
        courseName: cleanName,
        selectedWeek: String(req.body?.selectedWeek || 'W1'),
        students: Array.isArray(req.body?.students) ? req.body.students : [],
        ownerId: auth.uid,
        createdBy: auth.username,
        sharedWith: [],
        createdAt: now,
        updatedAt: now,
      };
      await fbPut(`courses/${courseId}`, created);
      res.json({ success: true, course: created });
    } catch {
      res.status(500).json({ success: false, error: 'Failed to update course.' });
    }
  });

  app.delete('/api/courses/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const auth = req.auth!;
      const courseId = String(req.params.id || '').trim();
      const existing = await fbGet<CourseProfile>(`courses/${courseId}`);
      if (!existing) {
        res.json({ success: true });
        return;
      }
      if (!canAccessCourse(normalizeCourse(existing), auth)) {
        res.status(403).json({ success: false, error: 'You do not have permission to delete this subject.' });
        return;
      }
      await fbDelete(`courses/${courseId}`);
      res.json({ success: true });
    } catch {
      res.status(500).json({ success: false, error: 'Failed to delete course.' });
    }
  });

  app.post('/api/courses/check-tab-ownership', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const auth = req.auth!;
      const tabs = Array.isArray(req.body?.tabs)
        ? (req.body.tabs as Array<{ courseName?: string; owner?: string; ownerExplicit?: boolean }>)
        : [];
      if (tabs.length === 0) {
        res.json({ success: true, results: [] });
        return;
      }

      const [coursesObj, usersObj] = await Promise.all([
        fbGet<Record<string, CourseProfile>>('courses'),
        fbGet<Record<string, StoredAppUser>>('app_users'),
      ]);
      const allCourses = coursesObj && typeof coursesObj === 'object'
        ? Object.values(coursesObj).filter((c) => c && c.id).map(normalizeCourse)
        : [];
      const allUsers = usersObj && typeof usersObj === 'object'
        ? Object.values(usersObj).filter((u) => u && u.id)
        : [];
      const authUser = allUsers.find((u) => u.id === auth.uid) || null;

      const results: SheetTabOwnershipResult[] = [];
      const seenCheckKeys = new Set<string>();
      for (const tab of tabs) {
        const cleanName = String(tab?.courseName || '').trim();
        if (!cleanName) continue;
        const normKey = normalizeCourseNameKey(cleanName);
        if (seenCheckKeys.has(normKey)) continue;
        seenCheckKeys.add(normKey);

        const matchingCourses = allCourses.filter((c) => isSameCourse(c, cleanName));
        const directMine = matchingCourses.find((c) => isDirectOwnerOrShared(c, auth));
        const otherCourse = matchingCourses.find((c) => !isDirectOwnerOrShared(c, auth));
        const sheetOwner = resolveSheetTabOwner(tab?.owner, Boolean(tab?.ownerExplicit), allUsers);

        const isCoLecturerOnMine = Boolean(
          directMine &&
          directMine.ownerId &&
          directMine.ownerId !== auth.uid &&
          Array.isArray(directMine.sharedWith) &&
          (directMine.sharedWith.includes(auth.uid) ||
            directMine.sharedWith.some((entry) => entry.toLowerCase() === auth.username.toLowerCase()))
        );

        // If subject already exists in the system for the caller (owner or co-lecturer), never duplicate or re-sync
        if (directMine) {
          results.push({
            courseName: cleanName,
            status: 'mine',
            alreadySynced: true,
            ownerId: directMine.ownerId || auth.uid,
            ownerLabel: directMine.createdBy || auth.username,
            sharedWith: directMine.sharedWith || [],
            sharedBy: isCoLecturerOnMine ? (directMine.createdBy || 'Owner') : undefined,
          });
          continue;
        }

        // If subject already exists in the system under another lecturer, never duplicate or re-sync
        if (otherCourse) {
          const ownerName = otherCourse.createdBy || 'another lecturer';
          results.push({
            courseName: cleanName,
            status: auth.role === 'admin' ? 'other_managed' : 'other',
            alreadySynced: true,
            ownerId: auth.role === 'admin' ? otherCourse.ownerId : undefined,
            ownerLabel: ownerName,
            sharedWith: auth.role === 'admin' ? (otherCourse.sharedWith || []) : undefined,
            reason: auth.role === 'admin' ? `Already synced (Owner: ${ownerName})` : `Owned by ${ownerName}`,
          });
          continue;
        }

        // Brand-new subject not yet in the system
        if (sheetOwner.recognized) {
          const matchesCaller = doesAuthMatchSheetOwner(sheetOwner.tokens, auth, authUser);
          if (!matchesCaller) {
            if (auth.role !== 'admin') {
              results.push({
                courseName: cleanName,
                status: 'other',
                alreadySynced: false,
                ownerLabel: sheetOwner.displayLabel,
                reason: `Assigned to ${sheetOwner.displayLabel} in Google Sheet`,
              });
            } else {
              results.push({
                courseName: cleanName,
                status: 'other_managed',
                alreadySynced: false,
                ownerId: sheetOwner.matchedUsers[0]?.id,
                ownerLabel: sheetOwner.displayLabel,
                sharedWith: [],
                reason: `Assigned to ${sheetOwner.displayLabel} in Google Sheet`,
              });
            }
          } else {
            results.push({
              courseName: cleanName,
              status: 'assigned_to_me',
              alreadySynced: false,
              ownerId: auth.uid,
              ownerLabel: auth.username,
              sharedWith: [],
            });
          }
          continue;
        }

        results.push({
          courseName: cleanName,
          status: 'unclaimed',
          alreadySynced: false,
        });
      }

      res.json({ success: true, results });
    } catch {
      res.status(500).json({ success: false, error: 'Failed to check sheet tab ownership.' });
    }
  });

  app.post('/api/courses/sync-tabs', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const auth = req.auth!;
      const tabs = Array.isArray(req.body?.tabs)
        ? (req.body.tabs as Array<{
            sheetName?: string;
            courseName?: string;
            owner?: string;
            ownerExplicit?: boolean;
            ownerId?: string;
            sharedWith?: string[];
            students?: PreRegisteredStudent[];
          }>)
        : [];
      if (tabs.length === 0) {
        res.json({ success: true, courses: [], skippedCourses: [] });
        return;
      }

      const [coursesObj, usersObj] = await Promise.all([
        fbGet<Record<string, CourseProfile>>('courses'),
        fbGet<Record<string, StoredAppUser>>('app_users'),
      ]);
      const allCourses = coursesObj && typeof coursesObj === 'object'
        ? Object.values(coursesObj).filter((c) => c && c.id).map(normalizeCourse)
        : [];
      const allUsers = usersObj && typeof usersObj === 'object'
        ? Object.values(usersObj).filter((u) => u && u.id)
        : [];
      const authUser = allUsers.find((u) => u.id === auth.uid) || null;
      const allowUpdateExisting = Boolean(req.body?.allowUpdateExisting);
      const now = Date.now();
      const synced: CourseProfile[] = [];
      const skippedCourses: Array<{ courseName: string; reason: string; owner?: string }> = [];
      const seenSyncKeys = new Set<string>();
      const mutableCoursesMap: Record<string, CourseProfile> =
        coursesObj && typeof coursesObj === 'object' ? { ...coursesObj } : {};

      for (const tab of tabs) {
        const cleanName = String(tab.courseName || '').trim();
        if (!cleanName) continue;
        const normKey = normalizeCourseNameKey(cleanName);
        if (seenSyncKeys.has(normKey)) continue;
        seenSyncKeys.add(normKey);

        const students = Array.isArray(tab.students) ? tab.students : [];
        const sheetOwner = resolveSheetTabOwner(tab.owner, Boolean(tab.ownerExplicit), allUsers);
        const existingCourse = allCourses.find((c) => isSameCourse(c, cleanName));

        if (existingCourse) {
          if (!allowUpdateExisting) {
            const ownerName = existingCourse.createdBy || 'another lecturer';
            skippedCourses.push({
              courseName: cleanName,
              owner: ownerName,
              reason: canAccessCourse(existingCourse, auth)
                ? 'Already exists in Subjects (not re-synced)'
                : `Already owned by ${ownerName}`,
            });
            continue;
          }

          if (!canAccessCourse(existingCourse, auth)) {
            const ownerName = existingCourse.createdBy || 'another lecturer';
            skippedCourses.push({
              courseName: cleanName,
              owner: ownerName,
              reason: `Already owned by ${ownerName}`,
            });
            continue;
          }

          if (sheetOwner.recognized && auth.role !== 'admin') {
            if (!doesAuthMatchSheetOwner(sheetOwner.tokens, auth, authUser) && !isDirectOwnerOrShared(existingCourse, auth)) {
              skippedCourses.push({
                courseName: cleanName,
                owner: sheetOwner.displayLabel,
                reason: `Assigned to ${sheetOwner.displayLabel} in Google Sheet`,
              });
              continue;
            }
          }

          const updated: CourseProfile = {
            ...existingCourse,
            sheetName: tab.sheetName || existingCourse.sheetName,
            students: students.length > 0 ? students : existingCourse.students,
            updatedAt: now,
          };
          await fbPut(`courses/${updated.id}`, updated);
          synced.push(updated);
          continue;
        }

        if (sheetOwner.recognized && auth.role !== 'admin') {
          if (!doesAuthMatchSheetOwner(sheetOwner.tokens, auth, authUser)) {
            skippedCourses.push({
              courseName: cleanName,
              owner: sheetOwner.displayLabel,
              reason: `Assigned to ${sheetOwner.displayLabel} in Google Sheet`,
            });
            continue;
          }
        }

        const requestedTabOwner =
          auth.role === 'admin' && typeof tab.ownerId === 'string' && tab.ownerId.trim()
            ? allUsers.find((u) => u.id === tab.ownerId!.trim()) || null
            : null;

        let targetOwnerId = auth.uid;
        let targetCreatedBy = auth.username;
        let targetSharedWith: string[] = [];
        if (requestedTabOwner) {
          targetOwnerId = requestedTabOwner.id;
          targetCreatedBy = requestedTabOwner.username;
        } else if (auth.role === 'admin' && sheetOwner.recognized && sheetOwner.matchedUsers.length > 0) {
          targetOwnerId = sheetOwner.matchedUsers[0].id;
          targetCreatedBy = sheetOwner.matchedUsers[0].username;
          if (sheetOwner.matchedUsers.length > 1) {
            targetSharedWith = sheetOwner.matchedUsers.slice(1).map((u) => u.id);
          }
        }
        if (auth.role === 'admin' && Array.isArray(tab.sharedWith)) {
          targetSharedWith = sanitizeSharedWithIds(tab.sharedWith, allUsers, targetOwnerId);
        }

        const baseId = toCourseKey(cleanName);
        const idTaken = Boolean(mutableCoursesMap[baseId]);
        const finalId = idTaken ? `${baseId}__${toFirebaseKey(targetOwnerId)}` : baseId;
        const created: CourseProfile = {
          id: finalId,
          courseName: cleanName,
          sheetName: tab.sheetName || '',
          selectedWeek: 'W1',
          students,
          ownerId: targetOwnerId,
          createdBy: targetCreatedBy,
          sharedWith: targetSharedWith,
          createdAt: now,
          updatedAt: now,
        };
        await fbPut(`courses/${finalId}`, created);
        mutableCoursesMap[finalId] = created;
        allCourses.push(created);
        synced.push(created);
      }

      res.json({ success: true, courses: synced, skippedCourses });
    } catch {
      res.status(500).json({ success: false, error: 'Failed to sync sheet tabs.' });
    }
  });

  app.patch('/api/courses/:id/owner', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const courseId = String(req.params.id || '').trim();
      const newOwnerId = String(req.body?.ownerId || '').trim();
      const sharedWith = Array.isArray(req.body?.sharedWith) ? req.body.sharedWith.map(String) : undefined;

      const [existing, usersObj] = await Promise.all([
        fbGet<CourseProfile>(`courses/${courseId}`),
        fbGet<Record<string, StoredAppUser>>('app_users'),
      ]);
      if (!existing) {
        res.status(404).json({ success: false, error: 'Course not found.' });
        return;
      }
      const allUsers = usersObj && typeof usersObj === 'object' ? Object.values(usersObj) : [];

      let nextCreatedBy = existing.createdBy || 'admin';
      if (newOwnerId) {
        const ownerUser = allUsers.find((u) => u && u.id === newOwnerId) || await fbGet<StoredAppUser>(`app_users/${newOwnerId}`);
        if (!ownerUser) {
          res.status(404).json({ success: false, error: 'Selected owner account not found.' });
          return;
        }
        nextCreatedBy = ownerUser.username;
      }

      const effectiveOwnerId = newOwnerId || existing.ownerId;
      const patchPayload: Partial<CourseProfile> = {
        updatedAt: Date.now(),
      };
      if (newOwnerId) {
        patchPayload.ownerId = newOwnerId;
        patchPayload.createdBy = nextCreatedBy;
      }
      if (sharedWith !== undefined) {
        patchPayload.sharedWith = sanitizeSharedWithIds(sharedWith, allUsers, effectiveOwnerId);
      } else if (newOwnerId && Array.isArray(existing.sharedWith)) {
        patchPayload.sharedWith = existing.sharedWith.filter((id) => id !== newOwnerId);
      }

      await fbPatch(`courses/${courseId}`, patchPayload);
      const updated = normalizeCourse({ ...existing, ...patchPayload });
      res.json({ success: true, course: updated });
    } catch {
      res.status(500).json({ success: false, error: 'Failed to update course ownership.' });
    }
  });

  app.patch('/api/courses/:id/co-lecturers', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const auth = req.auth!;
      const courseId = String(req.params.id || '').trim();
      if (!courseId) {
        res.status(400).json({ success: false, error: 'Course ID is required.' });
        return;
      }

      const [existingRaw, usersObj] = await Promise.all([
        fbGet<CourseProfile>(`courses/${courseId}`),
        fbGet<Record<string, StoredAppUser>>('app_users'),
      ]);
      if (!existingRaw) {
        res.status(404).json({ success: false, error: 'Subject not found.' });
        return;
      }
      const existing = normalizeCourse(existingRaw);
      const isPrimaryOwner =
        auth.role === 'admin' ||
        (existing.ownerId && existing.ownerId === auth.uid) ||
        (!existing.ownerId && existing.createdBy && existing.createdBy.toLowerCase() === auth.username.toLowerCase());

      if (!isPrimaryOwner) {
        res.status(403).json({ success: false, error: 'Only the subject owner or Administrator can manage co-lecturers.' });
        return;
      }

      const allUsers = usersObj && typeof usersObj === 'object' ? Object.values(usersObj) : [];
      const cleanedSharedWith = sanitizeSharedWithIds(req.body?.sharedWith, allUsers, existing.ownerId);

      const patchPayload: Partial<CourseProfile> = {
        sharedWith: cleanedSharedWith,
        updatedAt: Date.now(),
      };
      await fbPatch(`courses/${courseId}`, patchPayload);
      const updated = normalizeCourse({ ...existing, ...patchPayload });
      res.json({ success: true, course: updated });
    } catch {
      res.status(500).json({ success: false, error: 'Failed to update co-lecturers.' });
    }
  });

  // 11. Authenticated Live Attendance & Teacher Overrides
  app.get('/api/attendance/live', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const auth = req.auth!;
      const courseName = String(req.query.course || '').trim();
      if (courseName && auth.role !== 'admin') {
        const coursesObj = (await fbGet<Record<string, CourseProfile>>('courses')) || {};
        const matched = Object.values(coursesObj)
          .filter((c) => c && c.courseName)
          .find((c) => c.courseName.trim().toUpperCase() === courseName.toUpperCase());
        if (matched && !canAccessCourse(normalizeCourse(matched), auth)) {
          res.status(403).json({ success: false, error: 'Access denied for this subject.' });
          return;
        }
      }
      const sessionPath = courseName ? `${getSessionDateId()}_${sanitizeCoursePath(courseName)}` : getSessionDateId();
      const data = await fbGet<Record<string, Student>>(`live_sessions/${sessionPath}`);
      const students = data && typeof data === 'object'
        ? Object.values(data).sort((a, b) => b.timestamp - a.timestamp)
        : [];
      res.json({ success: true, students });
    } catch {
      res.status(500).json({ success: false, error: 'Failed to fetch live attendance.' });
    }
  });

  app.post('/api/attendance/manual', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const name = String(req.body?.name || '').trim();
      const studentId = String(req.body?.studentId || '').trim();
      const status = String(req.body?.status || 'P').trim().toUpperCase();
      const courseName = String(req.body?.courseName || 'General Session').trim();
      const absenceReason = typeof req.body?.absenceReason === 'string' ? req.body.absenceReason : undefined;
      const week = String(req.body?.week || 'W1').trim().toUpperCase();
      const overrideTimestamp = typeof req.body?.overrideTimestamp === 'number' ? req.body.overrideTimestamp : undefined;

      if (!name || !studentId) {
        res.status(400).json({ success: false, message: 'Name and Student ID are required.' });
        return;
      }

      const cleanStudentId = normalizeStudentId(studentId);
      const studentKey = toStudentFirebaseKey(cleanStudentId);
      const sessionPath = courseName ? `${getSessionDateId()}_${sanitizeCoursePath(courseName)}` : getSessionDateId();
      if (status === 'P') {
        const liveSessionMap = await fbGet<Record<string, Student>>(`live_sessions/${sessionPath}`);
        const existingData = liveSessionMap && typeof liveSessionMap === 'object'
          ? (liveSessionMap[studentKey] ||
              Object.values(liveSessionMap).find(
                (s) => s && normalizeStudentId(s.studentId || '') === cleanStudentId
              ))
          : null;
        if (existingData && existingData.status === 'P' && (existingData.week || 'W1').trim().toUpperCase() === week) {
          res.status(409).json({ success: false, message: 'You have already checked in for this session.' });
          return;
        }
      }

      const timestamp = overrideTimestamp || Date.now();
      const studentData: Student = {
        name,
        studentId: cleanStudentId,
        email: req.body?.email ? String(req.body.email).trim() : `${cleanStudentId}@student.edu.my`,
        status,
        timestamp,
        courseName,
        absenceReason,
        week,
      };

      await Promise.all([
        fbPut(`pending/${studentKey}`, studentData),
        fbPut(`live_sessions/${sessionPath}/${studentKey}`, studentData),
        upsertAttendanceHistory([studentData]),
      ]);

      const cfg = await getAppConfig();
      if (cfg.integrationType === 'google_sheets' && cfg.scriptUrl) {
        void postToGoogleScript(cfg.scriptUrl, formatCloudPayload(studentData, week));
      }

      res.json({ success: true, message: 'Record submitted successfully.', record: studentData });
    } catch {
      res.status(500).json({ success: false, message: 'Connection lost. Please try again.' });
    }
  });

  app.post('/api/attendance/bulk', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const records = Array.isArray(req.body?.records) ? (req.body.records as Student[]) : [];
      const courseName = String(req.body?.courseName || '').trim();
      const week = String(req.body?.week || 'W1').trim().toUpperCase();
      if (records.length === 0) {
        res.json({ success: true });
        return;
      }

      const sessionPath = courseName ? `${getSessionDateId()}_${sanitizeCoursePath(courseName)}` : getSessionDateId();
      await Promise.all([
        ...records.flatMap((r) => {
          const key = toStudentFirebaseKey(r.studentId || '');
          return [
            fbPut(`pending/${key}`, r),
            fbPut(`live_sessions/${sessionPath}/${key}`, r),
          ];
        }),
        upsertAttendanceHistory(records),
      ]);

      const cfg = await getAppConfig();
      if (cfg.integrationType === 'google_sheets' && cfg.scriptUrl) {
        void postToGoogleScript(
          cfg.scriptUrl,
          records.map((r) => formatCloudPayload(r, week))
        );
      }

      res.json({ success: true });
    } catch {
      res.status(500).json({ success: false, error: 'Bulk update failed.' });
    }
  });

  app.post('/api/attendance/remove', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const removals = Array.isArray(req.body?.removals) ? (req.body.removals as Student[]) : [];
      const courseName = String(req.body?.courseName || '').trim();
      const sessionPath = courseName ? `${getSessionDateId()}_${sanitizeCoursePath(courseName)}` : getSessionDateId();

      await Promise.all([
        ...removals.flatMap((r) => {
          const rawId = String(r.studentId || '').trim();
          const key = toStudentFirebaseKey(rawId);
          const tasks: Promise<void>[] = [
            fbPut(`pending/${key}`, r),
            fbDelete(`live_sessions/${sessionPath}/${key}`),
          ];
          if (rawId && rawId !== key) {
            tasks.push(fbDelete(`live_sessions/${sessionPath}/${rawId}`));
          }
          return tasks;
        }),
        upsertAttendanceHistory(removals),
      ]);

      const cfg = await getAppConfig();
      if (cfg.integrationType === 'google_sheets' && cfg.scriptUrl && removals.length > 0) {
        void postToGoogleScript(
          cfg.scriptUrl,
          removals.map((r) => formatCloudPayload(r, r.week || 'W1'))
        );
      }

      res.json({ success: true });
    } catch {
      res.status(500).json({ success: false, error: 'Failed to remove students.' });
    }
  });

  app.put('/api/attendance/matrix-cell', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const auth = req.auth!;
      const rawStudentId = String(req.body?.studentId || '').trim();
      const studentId = normalizeStudentId(rawStudentId);
      const studentKey = toStudentFirebaseKey(studentId);
      const name = String(req.body?.name || '').trim();
      const courseName = String(req.body?.courseName || 'General Session').trim();
      const week = String(req.body?.week || 'W1').trim().toUpperCase();
      const status = String(req.body?.status || 'P').trim().toUpperCase();
      const absenceReason = typeof req.body?.absenceReason === 'string' ? req.body.absenceReason.trim() : '';
      const updateLiveSession = Boolean(req.body?.updateLiveSession);

      if (!studentId || !name || !/^W([1-9]|1[0-4])$/.test(week)) {
        res.status(400).json({ success: false, error: 'Valid Student ID, Name, and Week (W1–W14) are required.' });
        return;
      }

      if (auth.role !== 'admin' && courseName) {
        const coursesObj = (await fbGet<Record<string, CourseProfile>>('courses')) || {};
        const matched = Object.values(coursesObj)
          .filter((c) => c && c.courseName)
          .find((c) => c.courseName.trim().toUpperCase() === courseName.toUpperCase());
        if (matched && !canAccessCourse(normalizeCourse(matched), auth)) {
          res.status(403).json({ success: false, error: 'You do not have permission to edit this subject.' });
          return;
        }
      }

      const timestamp = Date.now();
      const record: Student = {
        studentId,
        name,
        email: `${studentId}@student.edu.my`,
        status,
        timestamp,
        courseName,
        absenceReason: status === 'P' ? '' : (absenceReason || undefined),
        week,
      };

      const writes: Promise<void>[] = [
        fbPut(`pending/${studentKey}`, record),
        upsertAttendanceHistory([record]),
      ];

      if (updateLiveSession) {
        const sessionPath = courseName ? `${getSessionDateId()}_${sanitizeCoursePath(courseName)}` : getSessionDateId();
        writes.push(fbPut(`live_sessions/${sessionPath}/${studentKey}`, record));
      }

      await Promise.all(writes);

      const cfg = await getAppConfig();
      if (cfg.integrationType === 'google_sheets' && cfg.scriptUrl) {
        void postToGoogleScript(cfg.scriptUrl, formatCloudPayload(record, week));
      }

      res.json({ success: true, record });
    } catch {
      res.status(500).json({ success: false, error: 'Failed to update matrix cell.' });
    }
  });

  app.delete('/api/attendance/session', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const courseName = String(req.query.course || '').trim();
      const sessionPath = courseName ? `${getSessionDateId()}_${sanitizeCoursePath(courseName)}` : getSessionDateId();
      await fbDelete(`live_sessions/${sessionPath}`);
      res.json({ success: true });
    } catch {
      res.status(500).json({ success: false, error: 'Failed to clear session.' });
    }
  });

  // 12. Scoped History Delete
  app.delete('/api/history/item', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const auth = req.auth!;
      const timestamp = Number(req.query.timestamp);
      const studentId = String(req.query.studentId || '').trim();
      const histRaw = await fbGet<Student[] | Record<string, Student>>('attendance_history');
      const prevHist: Student[] = Array.isArray(histRaw)
        ? histRaw
        : histRaw && typeof histRaw === 'object'
          ? Object.values(histRaw)
          : [];

      let allowedCourses: Set<string> | null = null;
      if (auth.role !== 'admin') {
        const coursesObj = (await fbGet<Record<string, CourseProfile>>('courses')) || {};
        allowedCourses = new Set(
          Object.values(coursesObj)
            .filter((c) => c && c.courseName && canAccessCourse(normalizeCourse(c), auth))
            .map((c) => c.courseName.trim().toUpperCase())
        );
      }

      const nextHist = prevHist.filter((h) => {
        if (!h) return false;
        if (h.timestamp === timestamp && h.studentId === studentId) {
          if (allowedCourses && !allowedCourses.has((h.courseName || '').trim().toUpperCase())) {
            return true; // cannot delete another lecturer's history
          }
          return false;
        }
        return true;
      });
      await fbPut('attendance_history', nextHist);
      res.json({ success: true });
    } catch {
      res.status(500).json({ success: false, error: 'Failed to delete history item.' });
    }
  });

  app.delete('/api/history', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const auth = req.auth!;
      if (auth.role === 'admin') {
        await fbPut('attendance_history', []);
        res.json({ success: true });
        return;
      }
      const coursesObj = (await fbGet<Record<string, CourseProfile>>('courses')) || {};
      const ownedNames = new Set(
        Object.values(coursesObj)
          .filter((c) => c && c.courseName && canAccessCourse(normalizeCourse(c), auth))
          .map((c) => c.courseName.trim().toUpperCase())
      );
      const histRaw = await fbGet<Student[] | Record<string, Student>>('attendance_history');
      const prevHist: Student[] = Array.isArray(histRaw)
        ? histRaw
        : histRaw && typeof histRaw === 'object'
          ? Object.values(histRaw)
          : [];
      const remaining = prevHist.filter((h) => h && !ownedNames.has((h.courseName || '').trim().toUpperCase()));
      await fbPut('attendance_history', remaining);
      res.json({ success: true });
    } catch {
      res.status(500).json({ success: false, error: 'Failed to clear history.' });
    }
  });

  // 13. Queue / Sync Test Endpoints (Authenticated)
  app.post('/api/queue/test', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const courseName = String(req.body?.courseName || 'Connectivity Test').trim();
      const week = String(req.body?.week || 'W1').trim().toUpperCase();
      const testRecord: Student = {
        name: 'CONNECTION TEST',
        studentId: 'TEST999',
        email: 'test@student.edu.my',
        status: 'P',
        timestamp: Date.now(),
        courseName,
        absenceReason: '',
        week,
      };
      await fbPut('pending/TEST999', testRecord);
      const cfg = await getAppConfig();
      if (cfg.integrationType === 'google_sheets' && cfg.scriptUrl) {
        await postToGoogleScript(cfg.scriptUrl, formatCloudPayload(testRecord, week));
      }
      res.json({ success: true, message: `Test signal sent to Cloud (${week}).` });
    } catch {
      res.status(500).json({ success: false, message: 'Cloud test failed.' });
    }
  });

  app.get('/api/queue', requireAuth, async (_req: AuthenticatedRequest, res: Response) => {
    try {
      const data = await fbGet<Record<string, Student>>('pending');
      const count = data && typeof data === 'object' ? Object.keys(data).length : 0;
      res.json({
        success: true,
        message: count > 0 ? `Queue length: ${count}` : 'Synchronization queue is empty.',
        count,
        data: data || {},
      });
    } catch {
      res.status(500).json({ success: false, message: 'Status check failed.', count: 0 });
    }
  });

  app.delete('/api/queue', requireAuth, requireAdmin, async (_req: AuthenticatedRequest, res: Response) => {
    try {
      await fbDelete('pending');
      res.json({ success: true, message: 'Queue cleared. Queue length: 0' });
    } catch {
      res.status(500).json({ success: false, message: 'Failed to clear queue.' });
    }
  });

  app.post('/api/queue/sync', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const selectedWeek = String(req.body?.week || 'W1').trim().toUpperCase();
      const cfg = await getAppConfig();
      if (cfg.integrationType === 'firebase') {
        res.json({ success: true, message: 'Firebase syncs automatically.', syncedCount: 0, errorCount: 0, total: 0 });
        return;
      }
      const pendingData = await fbGet<Record<string, Student>>('pending');
      const records = pendingData && typeof pendingData === 'object' ? Object.values(pendingData) : [];
      if (cfg.integrationType === 'airtable') {
        res.json({
          success: true,
          message: records.length > 0 ? 'Pending records ready for Airtable sync.' : 'No pending records to sync.',
          syncedCount: records.length,
          errorCount: 0,
          total: records.length,
          records,
        });
        return;
      }
      if (!cfg.scriptUrl) {
        res.status(400).json({ success: false, message: 'Script Endpoint missing.', syncedCount: 0, errorCount: 0, total: 0 });
        return;
      }
      if (records.length > 0) {
        const bulkPayload = records.map((r) => formatCloudPayload({ ...r, week: r.week || selectedWeek }, selectedWeek));
        await postToGoogleScript(cfg.scriptUrl, bulkPayload);
        res.json({
          success: true,
          message: `Synced ${records.length} record(s) to ${selectedWeek}.`,
          syncedCount: records.length,
          errorCount: 0,
          total: records.length,
        });
        return;
      }
      await postToGoogleScript(cfg.scriptUrl, { action: 'SYNC_QUEUE', week: selectedWeek });
      res.json({ success: true, message: `Cloud sync triggered (${selectedWeek}).`, syncedCount: 0, errorCount: 0, total: 0 });
    } catch {
      res.status(500).json({ success: false, message: 'Trigger failed.', syncedCount: 0, errorCount: 0, total: 0 });
    }
  });

  // 14. Admin-Only Endpoints
  app.patch('/api/admin/config', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const updates: Record<string, unknown> = {};
      if (typeof req.body?.scriptUrl === 'string') {
        const trimmed = req.body.scriptUrl.trim();
        if (trimmed.startsWith('https://script.google.com/')) {
          await fbPut('app_config/script_url', trimmed);
          updates.scriptUrl = trimmed;
        }
      }
      if (
        req.body?.integrationType === 'google_sheets' ||
        req.body?.integrationType === 'airtable' ||
        req.body?.integrationType === 'firebase'
      ) {
        await fbPut('app_config/integration_type', req.body.integrationType);
        updates.integrationType = req.body.integrationType;
      }
      if (typeof req.body?.adminEmail === 'string') {
        await fbPut('app_config/admin_email', req.body.adminEmail.trim());
        updates.adminEmail = req.body.adminEmail.trim();
      }
      res.json({ success: true, updates });
    } catch {
      res.status(500).json({ success: false, error: 'Failed to update system configuration.' });
    }
  });

  app.post('/api/admin/test-email', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const cfg = await getAppConfig();
      const recipient = String(req.body?.targetEmail ?? cfg.adminEmail).trim();
      if (!recipient) {
        res.json({ success: false, message: 'Enter an Admin Notification Email first.' });
        return;
      }

      const deliveryStatus = getEmailDeliveryStatus(cfg.scriptUrl);
      const baseAppUrl = sanitizePublicAppUrl(req.body?.publicAppUrl, req);
      const testLink = `${baseAppUrl}?test_email=verified`;

      if (deliveryStatus.provider === 'resend' || deliveryStatus.provider === 'smtp') {
        const directRes = await sendDirectEmail({
          to: recipient,
          subject: 'Smart Attendance — Email Delivery Test',
          text:
            `Your built-in email delivery (${deliveryStatus.label}) is working properly.\n\n` +
            `Verification link: ${testLink}\n`,
          html:
            `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:20px;border:1px solid #e5e7eb;border-radius:12px;">` +
            `<h2 style="color:#111827;margin:0 0 8px;">Email Delivery Verified</h2>` +
            `<p style="color:#4b5563;font-size:14px;">Your Smart Attendance backend delivered this test email via <strong>${escapeHtml(deliveryStatus.label)}</strong>.</p>` +
            `<p style="color:#6b7280;font-size:12px;word-break:break-all;">Test URL: ${escapeHtml(testLink)}</p>` +
            `</div>`,
        });
        if (directRes.ok) {
          res.json({
            success: true,
            provider: deliveryStatus.provider,
            message: `Test email sent to ${recipient} via ${deliveryStatus.label}. Check Inbox/Spam!`,
          });
          return;
        }
        res.json({
          success: false,
          provider: deliveryStatus.provider,
          message: directRes.error || `Failed to send via ${deliveryStatus.label}.`,
        });
        return;
      }

      if (!cfg.scriptUrl || cfg.scriptUrl === DEFAULT_SCRIPT_URL || cfg.scriptUrl.endsWith('/dev')) {
        res.json({
          success: false,
          provider: 'none',
          message:
            'No email service configured yet. Deploy your Google Apps Script /exec URL in Settings, or use the Copy Link button for pending accounts.',
        });
        return;
      }

      const emailRes = await postToGoogleScript(cfg.scriptUrl, {
        action: 'SEND_ACTIVATION_EMAIL',
        toEmail: recipient,
        username: 'Admin Email Test',
        activationUrl: testLink,
        adminEmail: recipient,
      });
      if (!emailRes.ok) {
        res.json({ success: false, message: 'Apps Script returned HTML or failed. Check Web App access = Anyone.' });
        return;
      }
      if (emailRes.json?.success && emailRes.json?.emailSent !== false) {
        res.json({
          success: true,
          provider: 'apps_script',
          message: `Test email sent to ${recipient} via Google Apps Script. Check Inbox/Spam!`,
        });
        return;
      }
      const errText = String(emailRes.json?.error || 'Email could not be sent.');
      if (errText.includes('script.send_mail') || errText.includes('MailApp')) {
        res.json({
          success: false,
          message:
            'Apps Script lacks email permission (script.send_mail). Please re-authorize Apps Script MailApp in your deployment.',
        });
        return;
      }
      res.json({ success: false, message: errText });
    } catch {
      res.json({ success: false, message: 'Server error while sending test email.' });
    }
  });

  app.post('/api/admin/users/:id/activate', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    const userId = String(req.params.id || '').trim();
    const userRecord = await fbGet<StoredAppUser>(`app_users/${userId}`);
    if (!userRecord || !userRecord.id) {
      res.status(404).json({ success: false, error: 'User not found.' });
      return;
    }
    if (userRecord.status === 'active') {
      res.json({
        success: true,
        status: 'active',
        activatedAt: userRecord.activatedAt || Date.now(),
        alreadyActive: true,
      });
      return;
    }

    const now = Date.now();
    const pin = generateActivationPin();
    const activationExpiresAt = now + ACTIVATION_PIN_EXPIRY_MS;

    await fbPatch(`app_users/${userId}`, {
      status: 'approved_pending_pin',
      activationPin: pin,
      approvedAt: userRecord.approvedAt || now,
      activationSentAt: now,
      activationExpiresAt,
    });

    const existingAdminNotifs = await fbGet<Record<string, AdminNotification>>('admin_notifications').catch(() => null);
    if (existingAdminNotifs && typeof existingAdminNotifs === 'object') {
      await Promise.all(
        Object.values(existingAdminNotifs)
          .filter((n) => n && !n.read && n.type === 'user_signup' && n.userId === userRecord.id)
          .map((n) => fbPatch(`admin_notifications/${n.id}`, { read: true }).catch(() => { /* ignore */ }))
      );
    }

    let emailSent = false;
    let provider: EmailProviderType = 'none';
    if (userRecord.email) {
      const cfg = await getAppConfig();
      const emailRes = await dispatchApprovalPinEmail({
        toEmail: userRecord.email,
        username: userRecord.username,
        pin,
        expiresAtText: new Date(activationExpiresAt).toLocaleString(),
        cfg,
      });
      emailSent = emailRes.emailSent;
      provider = emailRes.provider;
    }

    res.json({
      success: true,
      status: 'approved_pending_pin',
      approvedAt: userRecord.approvedAt || now,
      emailSent,
      provider,
      email: userRecord.email || '',
      pin: emailSent ? undefined : pin,
    });
  });

  app.delete('/api/admin/users/:id', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    const userId = String(req.params.id || '').trim();
    const target = await fbGet<StoredAppUser>(`app_users/${userId}`);
    if (!target || target.role === 'admin' || target.username.toLowerCase() === 'admin') {
      res.status(400).json({ success: false, error: 'Cannot delete admin user.' });
      return;
    }
    await fbDelete(`app_users/${userId}`);
    const sessionsObj = (await fbGet<Record<string, AdminSessionActivity>>('admin_logins')) || {};
    const matching = Object.values(sessionsObj).filter(
      (s) => s && s.adminName?.toLowerCase() === target.username.toLowerCase() && s.status === 'active'
    );
    await Promise.all(
      matching.map((s) =>
        fbPatch(`admin_logins/${s.id}`, {
          status: 'signed_out',
          lastActiveTime: Date.now(),
          currentAction: 'Account Removed',
        })
      )
    );
    res.json({ success: true });
  });

  app.post('/api/admin/users/:id/resend-activation', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    const userId = String(req.params.id || '').trim();
    const userRecord = await fbGet<StoredAppUser>(`app_users/${userId}`);
    if (!userRecord || !userRecord.id) {
      res.status(404).json({ sent: false, error: 'User not found.' });
      return;
    }
    if (userRecord.status === 'active') {
      res.json({ sent: false, error: 'Account is already active.' });
      return;
    }
    const now = Date.now();
    const pin = generateActivationPin();
    const activationExpiresAt = now + ACTIVATION_PIN_EXPIRY_MS;
    await fbPatch(`app_users/${userId}`, {
      status: 'approved_pending_pin',
      activationPin: pin,
      approvedAt: userRecord.approvedAt || now,
      activationSentAt: now,
      activationExpiresAt,
    });
    if (!userRecord.email) {
      res.json({ sent: false, pin });
      return;
    }
    const cfg = await getAppConfig();
    const { emailSent, provider } = await dispatchApprovalPinEmail({
      toEmail: userRecord.email,
      username: userRecord.username,
      pin,
      expiresAtText: new Date(activationExpiresAt).toLocaleString(),
      cfg,
    });
    res.json({ sent: emailSent, provider, email: userRecord.email, pin: emailSent ? undefined : pin });
  });

  app.post('/api/admin/sessions/:id/revoke', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    const sessionId = String(req.params.id || '').trim();
    await fbPatch(`admin_logins/${sessionId}`, {
      status: 'signed_out',
      lastActiveTime: Date.now(),
      currentAction: 'Revoked by Admin',
    });
    res.json({ success: true });
  });

  app.delete('/api/admin/sessions/inactive', requireAuth, requireAdmin, async (_req: AuthenticatedRequest, res: Response) => {
    const sessionsObj = (await fbGet<Record<string, AdminSessionActivity>>('admin_logins')) || {};
    const staleThreshold = Date.now() - 2 * 60 * 1000;
    const toRemove = Object.values(sessionsObj).filter(
      (s) => s && (s.status === 'signed_out' || (s.lastActiveTime || 0) < staleThreshold)
    );
    await Promise.all(toRemove.map((s) => fbDelete(`admin_logins/${s.id}`)));
    res.json({ success: true });
  });

  app.patch('/api/admin/notifications/:id/read', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    const notifId = String(req.params.id || '').trim();
    await fbPatch(`admin_notifications/${notifId}`, { read: true });
    res.json({ success: true });
  });

  app.post('/api/admin/notifications/read-all', requireAuth, requireAdmin, async (_req: AuthenticatedRequest, res: Response) => {
    const notifsObj = (await fbGet<Record<string, AdminNotification>>('admin_notifications')) || {};
    await Promise.all(
      Object.values(notifsObj)
        .filter((n) => n && !n.read)
        .map((n) => fbPatch(`admin_notifications/${n.id}`, { read: true }))
    );
    res.json({ success: true });
  });

  app.delete('/api/admin/notifications', requireAuth, requireAdmin, async (_req: AuthenticatedRequest, res: Response) => {
    await fbDelete('admin_notifications');
    res.json({ success: true });
  });

  return app;
}

