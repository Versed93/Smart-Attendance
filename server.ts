import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import nodemailer from 'nodemailer';
import type {
  AppUser,
  AdminSessionActivity,
  AdminNotification,
  CourseProfile,
  EmailDeliveryStatus,
  EmailProviderType,
  Student,
} from './types.ts';
import { PRE_REGISTERED_STUDENTS, type PreRegisteredStudent } from './studentList.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ACTIVATION_EXPIRY_MS = 24 * 60 * 60 * 1000;

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
}

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
const toCourseKey = (name: string): string => {
  const clean = name.trim();
  return clean ? clean.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase() : 'GENERAL_SESSION';
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

function sanitizeUser(user: StoredAppUser): AppUser {
  const rest = { ...user };
  delete rest.password;
  delete rest.passwordHash;
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

function generateRandomToken(): string {
  return crypto.randomBytes(24).toString('hex');
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

async function dispatchActivationEmails(params: {
  toEmail: string;
  username: string;
  activationUrl: string;
  expiresAtText: string;
  cfg: { scriptUrl: string; adminEmail: string };
}): Promise<{ emailSent: boolean; provider: EmailProviderType; error?: string }> {
  const status = getEmailDeliveryStatus(params.cfg.scriptUrl);
  const expiryLine = params.expiresAtText
    ? `This activation link expires in 1 day (${params.expiresAtText}).`
    : 'This activation link expires within 1 day (24 hours).';

  if (status.provider === 'resend' || status.provider === 'smtp') {
    const safeUser = escapeHtml(params.username);
    const safeUrl = escapeHtml(params.activationUrl);
    const safeExpiry = escapeHtml(expiryLine);
    const userRes = await sendDirectEmail({
      to: params.toEmail,
      subject: 'Activate Your Smart Attendance Account',
      text:
        `Hello ${params.username},\n\n` +
        `Please activate your Smart QR Attendance account by opening the link below:\n${params.activationUrl}\n\n` +
        `${expiryLine}\n\n` +
        `If you signed up by mistake or want to delete your account, open the app login page and submit an Account Deletion Request to Admin.\n`,
      html:
        `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;border:1px solid #e5e7eb;border-radius:12px;">` +
        `<h2 style="color:#111827;margin:0 0 10px;">Activate Your Account</h2>` +
        `<p style="color:#4b5563;font-size:14px;">Hello <strong>${safeUser}</strong>,</p>` +
        `<p style="color:#4b5563;font-size:14px;">Thank you for signing up for the Smart QR Attendance System. Click the button below to activate your account:</p>` +
        `<p style="margin:24px 0;"><a href="${safeUrl}" style="background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block;">Activate Account</a></p>` +
        `<p style="color:#92400e;background:#fffbeb;border:1px solid #fde68a;padding:10px 12px;border-radius:8px;font-size:12px;font-weight:bold;">${safeExpiry}</p>` +
        `<p style="color:#6b7280;font-size:12px;">Or copy this link: ${safeUrl}</p>` +
        `</div>`,
    });

    if (params.cfg.adminEmail) {
      const safeEmail = escapeHtml(params.toEmail);
      await sendDirectEmail({
        to: params.cfg.adminEmail,
        subject: `[Smart Attendance] New User Signup: ${params.username}`,
        text:
          `A new user signed up on the Smart QR Attendance System.\n\n` +
          `Username: ${params.username}\nEmail: ${params.toEmail}\nStatus: Pending Activation\n${expiryLine}\n`,
        html:
          `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:20px;border:1px solid #e5e7eb;border-radius:12px;">` +
          `<h3 style="color:#111827;margin:0 0 8px;">New User Signup</h3>` +
          `<p style="color:#374151;font-size:14px;"><strong>Username:</strong> ${safeUser}<br/><strong>Email:</strong> ${safeEmail}<br/><strong>Status:</strong> Pending Activation</p>` +
          `<p style="color:#6b7280;font-size:12px;">${safeExpiry}</p>` +
          `</div>`,
      }).catch(() => { /* ignore secondary admin notification failure */ });
    }

    return { emailSent: userRes.ok, provider: userRes.provider, error: userRes.error };
  }

  const emailRes = await postToGoogleScript(params.cfg.scriptUrl, {
    action: 'SEND_ACTIVATION_EMAIL',
    toEmail: params.toEmail,
    username: params.username,
    activationUrl: params.activationUrl,
    expiresAtText: params.expiresAtText,
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

async function startServer() {
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
            'Account pending activation. Please click the activation link sent to your email or ask Admin to activate your account.',
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
      const activationToken = generateRandomToken();
      const activationExpiresAt = now + ACTIVATION_EXPIRY_MS;

      const newUser: StoredAppUser = {
        id: userId,
        username: cleanUser,
        email: cleanEmail,
        passwordHash: hashPassword(password),
        role: 'lecturer',
        status: 'pending',
        activationToken,
        activationSentAt: now,
        activationExpiresAt,
        createdAt: now,
      };

      await fbPut(`app_users/${userId}`, newUser);

      const baseAppUrl = sanitizePublicAppUrl(req.body?.publicAppUrl, req);
      const activationUrl = `${baseAppUrl}?activate=${encodeURIComponent(activationToken)}&user=${encodeURIComponent(userId)}`;

      const cfg = await getAppConfig();
      const { emailSent } = await dispatchActivationEmails({
        toEmail: cleanEmail,
        username: cleanUser,
        activationUrl,
        expiresAtText: new Date(activationExpiresAt).toLocaleString(),
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
        message: `${cleanUser} (${cleanEmail}) signed up and is waiting for account activation.`,
      };
      await fbPut(`admin_notifications/${notifId}`, notif).catch(() => { /* ignore */ });

      res.json({
        success: true,
        message: emailSent
          ? `Account created! An activation email has been sent to ${cleanEmail}. Admin has also been notified.`
          : 'Account created and Admin has been notified! Please check your email or ask Admin to send/activate your account link.',
      });
    } catch {
      res.status(500).json({ success: false, message: 'Failed to save user registration to cloud.' });
    }
  });

  // 4. Auth: Activate via Email Link
  app.post('/api/auth/activate', async (req: Request, res: Response) => {
    try {
      const token = String(req.body?.token || '').trim();
      const userId = String(req.body?.userId || '').trim();
      if (!token || !userId) {
        res.status(400).json({ success: false, message: 'Invalid activation parameters.' });
        return;
      }

      const userRecord = await fbGet<StoredAppUser>(`app_users/${toFirebaseKey(userId)}`);
      if (!userRecord || !userRecord.id) {
        res.status(404).json({
          success: false,
          message: 'Activation failed: Account no longer exists or was removed by Admin.',
        });
        return;
      }
      if (userRecord.status === 'active') {
        res.json({
          success: true,
          message: `Account "${userRecord.username}" is already active. You can sign in now.`,
        });
        return;
      }
      if (!userRecord.activationToken || !timingSafeStringEqual(userRecord.activationToken, token)) {
        res.status(400).json({
          success: false,
          message: 'Invalid or expired activation link. Contact Admin to resend.',
        });
        return;
      }
      const expiresAt = userRecord.activationExpiresAt || (userRecord.createdAt + ACTIVATION_EXPIRY_MS);
      if (Date.now() > expiresAt) {
        res.status(400).json({
          success: false,
          message: 'This activation link has expired (valid for 24 hours). Please contact Admin to resend.',
        });
        return;
      }

      await fbPatch(`app_users/${userRecord.id}`, {
        status: 'active',
        activatedAt: Date.now(),
      });

      res.json({
        success: true,
        message: `Account "${userRecord.username}" has been activated! Please sign in below.`,
      });
    } catch {
      res.status(500).json({ success: false, message: 'Network error while activating account.' });
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

  app.post('/api/student/checkin', async (req: Request, res: Response) => {
    try {
      const name = String(req.body?.name || '').trim();
      const studentId = String(req.body?.studentId || '').trim();
      const email = String(req.body?.email || `${studentId}@student.edu.my`).trim();
      const status = String(req.body?.status || 'P').trim().toUpperCase();
      const courseName = String(req.body?.courseName || 'General Session').trim();
      const courseId = String(req.body?.courseId || '').trim();
      const week = String(req.body?.week || 'W1').trim().toUpperCase();

      if (!name || !studentId) {
        res.status(400).json({ success: false, message: 'Name and Student ID are required.' });
        return;
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
      const existingData = await fbGet<Student>(`live_sessions/${sessionPath}/${studentId}`);
      if (existingData && existingData.status === 'P' && status === 'P' && (existingData.week || 'W1').trim().toUpperCase() === week) {
        res.status(409).json({ success: false, message: 'You have already checked in for this session.' });
        return;
      }

      const timestamp = Date.now();
      const studentData: Student = {
        name,
        studentId,
        email,
        status,
        timestamp,
        courseName,
        week,
      };

      await Promise.all([
        fbPut(`pending/${studentId}`, studentData),
        fbPut(`live_sessions/${sessionPath}/${studentId}`, studentData),
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

  // 8. Authenticated Dashboard Sync (Scoped by Role & Ownership)
  app.get('/api/dashboard/sync', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const auth = req.auth!;
      const [cfg, coursesObj, userPref, historyRaw, usersObj, sessionsObj, notifsObj] = await Promise.all([
        getAppConfig(),
        fbGet<Record<string, CourseProfile>>('courses'),
        fbGet<{ activeCourse?: string; selectedWeek?: string }>(`user_preferences/${auth.uid}`),
        fbGet<Student[] | Record<string, Student>>('attendance_history'),
        auth.role === 'admin' ? fbGet<Record<string, StoredAppUser>>('app_users') : Promise.resolve(null),
        auth.role === 'admin' ? fbGet<Record<string, AdminSessionActivity>>('admin_logins') : Promise.resolve(null),
        auth.role === 'admin' ? fbGet<Record<string, AdminNotification>>('admin_notifications') : Promise.resolve(null),
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

      const sanitizedUsers: AppUser[] =
        auth.role === 'admin' && usersObj && typeof usersObj === 'object'
          ? Object.values(usersObj)
              .filter((u) => u && u.id && u.username)
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
        sessions,
        notifications,
      });
    } catch {
      res.status(500).json({ success: false, error: 'Failed to sync dashboard state.' });
    }
  });

  // 9. User Preferences (Strictly scoped to req.auth.uid)
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
      if (!cleanName) {
        res.status(400).json({ success: false, error: 'Course name is required.' });
        return;
      }

      const coursesObj = (await fbGet<Record<string, CourseProfile>>('courses')) || {};
      const allCourses = Object.values(coursesObj).filter((c) => c && c.id).map(normalizeCourse);

      const existingOwned = allCourses.find(
        (c) => canAccessCourse(c, auth) && c.courseName.trim().toUpperCase() === cleanName.toUpperCase()
      );
      if (existingOwned) {
        res.json({ success: true, course: existingOwned });
        return;
      }

      const baseId = toCourseKey(cleanName);
      const idTakenByOther = Boolean(coursesObj[baseId] && !canAccessCourse(normalizeCourse(coursesObj[baseId]), auth));
      const finalId = idTakenByOther ? `${baseId}__${toFirebaseKey(auth.uid)}` : baseId;
      const now = Date.now();

      const newCourse: CourseProfile = {
        id: finalId,
        courseName: cleanName,
        selectedWeek,
        students: initialStudents,
        ownerId: auth.uid,
        createdBy: auth.username,
        sharedWith: [],
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

  app.post('/api/courses/sync-tabs', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const auth = req.auth!;
      const tabs = Array.isArray(req.body?.tabs)
        ? (req.body.tabs as Array<{ sheetName?: string; courseName?: string; students?: PreRegisteredStudent[] }>)
        : [];
      if (tabs.length === 0) {
        res.json({ success: true, courses: [] });
        return;
      }

      const coursesObj = (await fbGet<Record<string, CourseProfile>>('courses')) || {};
      const allCourses = Object.values(coursesObj).filter((c) => c && c.id).map(normalizeCourse);
      const now = Date.now();
      const synced: CourseProfile[] = [];

      for (const tab of tabs) {
        const cleanName = String(tab.courseName || '').trim();
        if (!cleanName) continue;
        const students = Array.isArray(tab.students) ? tab.students : [];
        const existingOwned = allCourses.find(
          (c) => canAccessCourse(c, auth) && c.courseName.trim().toUpperCase() === cleanName.toUpperCase()
        );
        if (existingOwned) {
          const updated: CourseProfile = {
            ...existingOwned,
            sheetName: tab.sheetName || existingOwned.sheetName,
            students: students.length > 0 ? students : existingOwned.students,
            ownerId: existingOwned.ownerId || auth.uid,
            updatedAt: now,
          };
          await fbPut(`courses/${updated.id}`, updated);
          synced.push(updated);
        } else {
          const baseId = toCourseKey(cleanName);
          const takenByOther = Boolean(coursesObj[baseId] && !canAccessCourse(normalizeCourse(coursesObj[baseId]), auth));
          const finalId = takenByOther ? `${baseId}__${toFirebaseKey(auth.uid)}` : baseId;
          const created: CourseProfile = {
            id: finalId,
            courseName: cleanName,
            sheetName: tab.sheetName || '',
            selectedWeek: 'W1',
            students,
            ownerId: auth.uid,
            createdBy: auth.username,
            sharedWith: [],
            createdAt: now,
            updatedAt: now,
          };
          await fbPut(`courses/${finalId}`, created);
          synced.push(created);
        }
      }

      res.json({ success: true, courses: synced });
    } catch {
      res.status(500).json({ success: false, error: 'Failed to sync sheet tabs.' });
    }
  });

  app.patch('/api/courses/:id/owner', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const courseId = String(req.params.id || '').trim();
      const newOwnerId = String(req.body?.ownerId || '').trim();
      const sharedWith = Array.isArray(req.body?.sharedWith) ? req.body.sharedWith.map(String) : undefined;

      const existing = await fbGet<CourseProfile>(`courses/${courseId}`);
      if (!existing) {
        res.status(404).json({ success: false, error: 'Course not found.' });
        return;
      }

      let nextCreatedBy = existing.createdBy || 'admin';
      if (newOwnerId) {
        const ownerUser = await fbGet<StoredAppUser>(`app_users/${newOwnerId}`);
        if (!ownerUser) {
          res.status(404).json({ success: false, error: 'Selected owner account not found.' });
          return;
        }
        nextCreatedBy = ownerUser.username;
      }

      const patchPayload: Partial<CourseProfile> = {
        updatedAt: Date.now(),
      };
      if (newOwnerId) {
        patchPayload.ownerId = newOwnerId;
        patchPayload.createdBy = nextCreatedBy;
      }
      if (sharedWith !== undefined) {
        patchPayload.sharedWith = sharedWith;
      }

      await fbPatch(`courses/${courseId}`, patchPayload);
      const updated = normalizeCourse({ ...existing, ...patchPayload });
      res.json({ success: true, course: updated });
    } catch {
      res.status(500).json({ success: false, error: 'Failed to update course ownership.' });
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
      const email = String(req.body?.email || `${studentId}@student.edu.my`).trim();
      const status = String(req.body?.status || 'P').trim().toUpperCase();
      const courseName = String(req.body?.courseName || 'General Session').trim();
      const absenceReason = typeof req.body?.absenceReason === 'string' ? req.body.absenceReason : undefined;
      const week = String(req.body?.week || 'W1').trim().toUpperCase();
      const overrideTimestamp = typeof req.body?.overrideTimestamp === 'number' ? req.body.overrideTimestamp : undefined;

      if (!name || !studentId) {
        res.status(400).json({ success: false, message: 'Name and Student ID are required.' });
        return;
      }

      const sessionPath = courseName ? `${getSessionDateId()}_${sanitizeCoursePath(courseName)}` : getSessionDateId();
      if (status === 'P') {
        const existingData = await fbGet<Student>(`live_sessions/${sessionPath}/${studentId}`);
        if (existingData && existingData.status === 'P' && (existingData.week || 'W1').trim().toUpperCase() === week) {
          res.status(409).json({ success: false, message: 'You have already checked in for this session.' });
          return;
        }
      }

      const timestamp = overrideTimestamp || Date.now();
      const studentData: Student = {
        name,
        studentId,
        email,
        status,
        timestamp,
        courseName,
        absenceReason,
        week,
      };

      await Promise.all([
        fbPut(`pending/${studentId}`, studentData),
        fbPut(`live_sessions/${sessionPath}/${studentId}`, studentData),
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
        ...records.flatMap((r) => [
          fbPut(`pending/${r.studentId}`, r),
          fbPut(`live_sessions/${sessionPath}/${r.studentId}`, r),
        ]),
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
        ...removals.flatMap((r) => [
          fbPut(`pending/${r.studentId}`, r),
          fbDelete(`live_sessions/${sessionPath}/${r.studentId}`),
        ]),
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
      const studentId = String(req.body?.studentId || '').trim();
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
        fbPut(`pending/${studentId}`, record),
        upsertAttendanceHistory([record]),
      ];

      if (updateLiveSession) {
        const sessionPath = courseName ? `${getSessionDateId()}_${sanitizeCoursePath(courseName)}` : getSessionDateId();
        writes.push(fbPut(`live_sessions/${sessionPath}/${studentId}`, record));
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
    const now = Date.now();
    await fbPatch(`app_users/${userId}`, { status: 'active', activatedAt: now });
    res.json({ success: true, activatedAt: now });
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
    const user = await fbGet<StoredAppUser>(`app_users/${userId}`);
    if (!user) {
      res.status(404).json({ success: false, error: 'User not found.' });
      return;
    }
    const now = Date.now();
    const tokenToUse = generateRandomToken();
    const activationExpiresAt = now + ACTIVATION_EXPIRY_MS;
    await fbPatch(`app_users/${userId}`, {
      activationToken: tokenToUse,
      activationSentAt: now,
      activationExpiresAt,
    });
    const baseAppUrl = sanitizePublicAppUrl(req.body?.publicAppUrl, req);
    const activationUrl = `${baseAppUrl}?activate=${encodeURIComponent(tokenToUse)}&user=${encodeURIComponent(user.id)}`;
    if (!user.email) {
      res.json({ sent: false, activationUrl });
      return;
    }
    const cfg = await getAppConfig();
    const { emailSent, provider } = await dispatchActivationEmails({
      toEmail: user.email,
      username: user.username,
      activationUrl,
      expiresAtText: new Date(activationExpiresAt).toLocaleString(),
      cfg,
    });
    res.json({ sent: emailSent, provider, activationUrl });
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

  // Frontend Vite / Static Serving
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(__dirname, 'dist');
    app.use(express.static(distDir));
    app.use((_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Smart QR Attendance server running on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
