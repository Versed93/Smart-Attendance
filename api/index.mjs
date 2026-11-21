// serverApp.ts
import express from "express";
import crypto from "node:crypto";
import process from "node:process";
import nodemailer from "nodemailer";

// studentList.ts
var PRE_REGISTERED_STUDENTS = [];

// utils/passwordPolicy.ts
function validateSignupPassword(password) {
  const value = typeof password === "string" ? password : "";
  const checks = {
    minLength: value.length >= 8,
    uppercase: /[A-Z]/.test(value),
    lowercase: /[a-z]/.test(value),
    number: /[0-9]/.test(value),
    symbol: /[^A-Za-z0-9\s]/.test(value)
  };
  const missing = [];
  if (!checks.minLength) missing.push("at least 8 characters");
  if (!checks.uppercase) missing.push("an uppercase letter (A-Z)");
  if (!checks.lowercase) missing.push("a lowercase letter (a-z)");
  if (!checks.number) missing.push("a number (0-9)");
  if (!checks.symbol) missing.push("a symbol/special character (e.g. !@#$%)");
  return {
    valid: missing.length === 0,
    checks,
    errorMessage: missing.length > 0 ? `Password must include ${missing.join(", ")}.` : null
  };
}

// serverApp.ts
var SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1e3;
var ACTIVATION_PIN_EXPIRY_MS = 24 * 60 * 60 * 1e3;
var loadLocalEnvIfPresent = () => {
  const loader = process.loadEnvFile;
  if (typeof loader !== "function") return;
  for (const envPath of [".env.local", ".env"]) {
    try {
      loader(envPath);
    } catch {
    }
  }
};
loadLocalEnvIfPresent();
var normalizeEnvString = (raw) => (raw || "").trim().replace(/^["']|["']$/g, "").trim();
var getFirebaseDbUrl = () => (normalizeEnvString(
  process.env.FIREBASE_DATABASE_URL || process.env.FIREBASE_DB_URL || process.env.VITE_FIREBASE_DATABASE_URL
) || "https://gen-lang-client-0701481146-default-rtdb.asia-southeast1.firebasedatabase.app").replace(/\.json$/i, "").replace(/\/+$/, "");
var getFirebaseDbSecret = () => normalizeEnvString(
  process.env.FIREBASE_DATABASE_SECRET || process.env.FIREBASE_DB_SECRET || process.env.DATABASE_SECRET || process.env.FIREBASE_SECRET || process.env.VITE_FIREBASE_DATABASE_SECRET
);
var resolvedAuthSecret = null;
var authSecretPromise = null;
var LEGACY_DEFAULT_ADMIN_PASSWORD = "adminscm";
var DEFAULT_ADMIN_PASSWORD = process.env.ADMIN_DEFAULT_PASSWORD || "Admin@1990";
var DEFAULT_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwbjXTrbFPRqVA0I-RGc1rV7K7eZ_CkgQujSBVtOtvjDCW1GJYAkxiVlXJzAB_-R_CaLA/exec";
var MAX_PIN_FAILED_ATTEMPTS = 5;
var RESET_PIN_EXPIRY_MS = 15 * 60 * 1e3;
var RESET_RESEND_COOLDOWN_MS = 60 * 1e3;
var MAX_RESET_FAILED_ATTEMPTS = 5;
var generateActivationPin = () => crypto.randomInt(1e5, 1e6).toString();
var hashResetPin = (userId, pin) => crypto.createHash("sha256").update(`${userId}:${pin}`).digest("hex");
var toFirebaseKey = (raw) => raw.replace(/[^a-zA-Z0-9_-]/g, "_");
var normalizeStudentId = (val) => val.trim().replace(/\s+/g, "").toUpperCase();
var toStudentFirebaseKey = (studentId) => toFirebaseKey(normalizeStudentId(studentId));
var toCourseKey = (name) => {
  const clean = name.trim();
  return clean ? clean.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase() : "GENERAL_SESSION";
};
var normalizeCourseNameKey = (name) => name.replace(/\s+/g, " ").trim().toUpperCase();
var isSameCourse = (course, cleanName) => {
  if (!cleanName) return false;
  if (normalizeCourseNameKey(course.courseName) === normalizeCourseNameKey(cleanName)) return true;
  if (course.id === toCourseKey(cleanName)) return true;
  return false;
};
var sanitizeCoursePath = (str) => str.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase();
var getSessionDateId = () => (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
var buildDbUrl = (dbPath) => {
  const cleanPath = dbPath.replace(/^\/+/, "");
  const params = new URLSearchParams();
  const dbSecret = getFirebaseDbSecret();
  if (dbSecret) {
    params.set("auth", dbSecret);
  }
  params.set("_ts", String(Date.now()));
  return `${getFirebaseDbUrl()}/${cleanPath}.json?${params.toString()}`;
};
async function getAuthSecret() {
  const envAuthSecret = normalizeEnvString(process.env.AUTH_SECRET);
  if (envAuthSecret) {
    resolvedAuthSecret = envAuthSecret;
    return envAuthSecret;
  }
  if (resolvedAuthSecret) return resolvedAuthSecret;
  if (authSecretPromise) return authSecretPromise;
  authSecretPromise = (async () => {
    try {
      const stored = await fbGet("app_config/_auth_hmac_secret");
      if (typeof stored === "string" && stored.trim().length >= 32) {
        resolvedAuthSecret = stored.trim();
        return resolvedAuthSecret;
      }
    } catch {
    }
    const generated = crypto.randomBytes(32).toString("hex");
    resolvedAuthSecret = generated;
    await fbPut("app_config/_auth_hmac_secret", generated).catch(() => {
    });
    return generated;
  })();
  try {
    return await authSecretPromise;
  } finally {
    authSecretPromise = null;
  }
}
var DatabaseHttpError = class extends Error {
  status;
  operation;
  constructor(operation, status, message) {
    super(message || `Database ${operation} failed (${status})`);
    this.name = "DatabaseHttpError";
    this.status = status;
    this.operation = operation;
  }
};
function formatAuthServerError(err, fallbackMessage) {
  const errMsg = err instanceof Error ? err.message : String(err);
  console.error("[Auth Error]", errMsg);
  if (err instanceof DatabaseHttpError) {
    if (err.status === 401 || err.status === 403) {
      if (!getFirebaseDbSecret()) {
        return {
          status: 500,
          message: "Database authentication is not configured on this server (missing FIREBASE_DATABASE_SECRET). Add FIREBASE_DATABASE_SECRET and FIREBASE_DATABASE_URL in your deployment environment variables and redeploy."
        };
      }
      return {
        status: 500,
        message: "Database authentication was rejected (HTTP 401/403). Verify FIREBASE_DATABASE_SECRET and FIREBASE_DATABASE_URL in your deployment environment variables."
      };
    }
    if (err.status === 404) {
      return {
        status: 500,
        message: "Database endpoint returned 404. Verify FIREBASE_DATABASE_URL in your deployment environment variables."
      };
    }
  }
  return { status: 500, message: fallbackMessage };
}
async function fbGet(dbPath) {
  const res = await fetch(buildDbUrl(dbPath), { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new DatabaseHttpError("read", res.status);
  }
  return await res.json();
}
async function fbPut(dbPath, payload) {
  const res = await fetch(buildDbUrl(dbPath), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    throw new DatabaseHttpError("write", res.status);
  }
}
async function fbPatch(dbPath, payload) {
  const res = await fetch(buildDbUrl(dbPath), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    throw new DatabaseHttpError("update", res.status);
  }
}
async function fbDelete(dbPath) {
  const res = await fetch(buildDbUrl(dbPath), { method: "DELETE" });
  if (!res.ok && res.status !== 404) {
    throw new DatabaseHttpError("delete", res.status);
  }
}
function listStoredUsers(usersObj) {
  if (!usersObj || typeof usersObj !== "object") return [];
  const result = [];
  for (const [key, raw] of Object.entries(usersObj)) {
    if (!raw || typeof raw !== "object") continue;
    const cleanUsername = typeof raw.username === "string" ? raw.username.trim() : "";
    if (!cleanUsername) continue;
    const cleanId = typeof raw.id === "string" && raw.id.trim() || key;
    const cleanEmail = typeof raw.email === "string" ? raw.email.trim() : "";
    result.push({
      ...raw,
      id: cleanId,
      username: cleanUsername,
      email: cleanEmail,
      dbKey: key
    });
  }
  return result;
}
async function findStoredUserById(userId) {
  const cleanId = userId.trim();
  if (!cleanId) return null;
  const direct = await fbGet(`app_users/${cleanId}`);
  if (direct && typeof direct === "object" && typeof direct.username === "string" && direct.username.trim()) {
    return {
      ...direct,
      id: typeof direct.id === "string" && direct.id.trim() || cleanId,
      username: direct.username.trim(),
      email: typeof direct.email === "string" ? direct.email.trim() : "",
      dbKey: cleanId
    };
  }
  const usersObj = await fbGet("app_users");
  return listStoredUsers(usersObj).find((u) => u.id === cleanId || u.dbKey === cleanId) || null;
}
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${derived}`;
}
function verifyPasswordHash(password, storedHash) {
  try {
    const parts = storedHash.split("$");
    if (parts.length !== 3 || parts[0] !== "scrypt") return false;
    const [, salt, hashHex] = parts;
    if (!salt || !hashHex) return false;
    const derivedBuf = crypto.scryptSync(password, salt, 64);
    const expectedBuf = Buffer.from(hashHex, "hex");
    if (derivedBuf.length !== expectedBuf.length) return false;
    return crypto.timingSafeEqual(derivedBuf, expectedBuf);
  } catch {
    return false;
  }
}
function timingSafeStringEqual(a, b) {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}
async function verifyAndUpgradeUserPassword(user, plainPassword) {
  const dbKey = user.dbKey || user.id;
  if (typeof user.passwordHash === "string" && user.passwordHash.startsWith("scrypt$")) {
    return verifyPasswordHash(plainPassword, user.passwordHash);
  }
  if (typeof user.password === "string" && user.password.length > 0) {
    const matched = timingSafeStringEqual(plainPassword, user.password);
    if (matched) {
      const upgradedHash = hashPassword(plainPassword);
      await fbPatch(`app_users/${dbKey}`, {
        passwordHash: upgradedHash,
        password: null
      }).catch(() => {
      });
    }
    return matched;
  }
  return false;
}
async function signSessionToken(payload) {
  const secret = await getAuthSecret();
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(encodedPayload).digest("base64url");
  return `${encodedPayload}.${signature}`;
}
async function verifySessionToken(token) {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [encodedPayload, signature] = parts;
  const secret = await getAuthSecret();
  const expectedSig = crypto.createHmac("sha256", secret).update(encodedPayload).digest("base64url");
  if (!timingSafeStringEqual(signature, expectedSig)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    if (!parsed || !parsed.uid || !parsed.username || !parsed.role || !parsed.exp) return null;
    if (Date.now() > parsed.exp) return null;
    return parsed;
  } catch {
    return null;
  }
}
var PIN_CHALLENGE_TTL_MS = 15 * 60 * 1e3;
async function signPinChallengeToken(uid) {
  const now = Date.now();
  const payload = {
    purpose: "pin_activation",
    uid,
    iat: now,
    exp: now + PIN_CHALLENGE_TTL_MS
  };
  const secret = await getAuthSecret();
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(encodedPayload).digest("base64url");
  return `${encodedPayload}.${signature}`;
}
async function verifyPinChallengeToken(token) {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [encodedPayload, signature] = parts;
  const secret = await getAuthSecret();
  const expectedSig = crypto.createHmac("sha256", secret).update(encodedPayload).digest("base64url");
  if (!timingSafeStringEqual(signature, expectedSig)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    if (!parsed || parsed.purpose !== "pin_activation" || !parsed.uid || !parsed.exp) return null;
    if (Date.now() > parsed.exp) return null;
    return parsed;
  } catch {
    return null;
  }
}
var QR_TOKEN_VALIDITY_MS = 15 * 1e3;
var CHECKIN_GRANT_VALIDITY_MS = 2 * 60 * 1e3;
var activePinCache = /* @__PURE__ */ new Map();
var usedScanNonces = /* @__PURE__ */ new Map();
var lastDbMaintenanceAt = 0;
function pruneUsedScanNonces(now) {
  if (usedScanNonces.size >= 200) {
    for (const [nonce, exp] of usedScanNonces.entries()) {
      if (now > exp) {
        usedScanNonces.delete(nonce);
      }
    }
  }
  if (now - lastDbMaintenanceAt > 10 * 60 * 1e3) {
    lastDbMaintenanceAt = now;
    const todayPrefix = `${getSessionDateId()}_`;
    void (async () => {
      try {
        const [noncesObj, pinsObj] = await Promise.all([
          fbGet("used_qr_nonces"),
          fbGet("classroom_pins")
        ]);
        if (noncesObj && typeof noncesObj === "object") {
          const expiredPatch = {};
          for (const [k, exp] of Object.entries(noncesObj)) {
            if (typeof exp === "number" && now > exp) {
              expiredPatch[k] = null;
            }
          }
          if (Object.keys(expiredPatch).length > 0) {
            await fbPatch("used_qr_nonces", expiredPatch).catch(() => {
            });
          }
        }
        if (pinsObj && typeof pinsObj === "object") {
          const oldPinPatch = {};
          for (const k of Object.keys(pinsObj)) {
            if (/^\d{4}-\d{2}-\d{2}_/.test(k) && !k.startsWith(todayPrefix)) {
              oldPinPatch[k] = null;
              activePinCache.delete(k);
            }
          }
          if (Object.keys(oldPinPatch).length > 0) {
            await fbPatch("classroom_pins", oldPinPatch).catch(() => {
            });
          }
        }
      } catch {
      }
    })();
  }
}
function generateClassroomPin() {
  return String(crypto.randomInt(1e3, 1e4));
}
function buildCourseSessionSegment(params) {
  const course = params.matchedCourse || null;
  if (course) {
    const baseKey = toCourseKey(course.courseName);
    return course.id && course.id !== baseKey ? sanitizeCoursePath(course.id) : sanitizeCoursePath(course.courseName);
  }
  const cleanId = String(params.courseId || "").trim();
  if (cleanId) {
    return sanitizeCoursePath(cleanId);
  }
  const cleanName = String(params.courseName || "").trim();
  return cleanName ? sanitizeCoursePath(cleanName) : "";
}
function buildPinSessionKey(params) {
  const seg = buildCourseSessionSegment(params) || sanitizeCoursePath("General Session");
  return toFirebaseKey(`${getSessionDateId()}_${seg}`);
}
function buildLiveSessionPath(params) {
  const seg = buildCourseSessionSegment(params);
  return seg ? `${getSessionDateId()}_${seg}` : getSessionDateId();
}
async function readPinConfig(sessionKey) {
  try {
    const remote = await fbGet(`classroom_pins/${sessionKey}`);
    if (remote && typeof remote === "object" && typeof remote.pin === "string") {
      activePinCache.set(sessionKey, remote);
      return remote;
    }
  } catch {
  }
  return activePinCache.get(sessionKey) || null;
}
async function getOrUpdatePinConfig(params) {
  const existing = await readPinConfig(params.sessionKey);
  const now = Date.now();
  const nextEnabled = params.requirePin !== void 0 ? Boolean(params.requirePin) : existing ? existing.enabled : true;
  const needNewPin = Boolean(params.rotatePin) || !existing || !/^\d{4}$/.test(existing.pin);
  if (!existing || nextEnabled !== existing.enabled || needNewPin) {
    const nextConfig = {
      enabled: nextEnabled,
      pin: needNewPin ? generateClassroomPin() : existing.pin,
      courseName: params.courseName,
      week: params.week,
      updatedAt: now,
      updatedBy: params.updatedBy || existing?.updatedBy
    };
    activePinCache.set(params.sessionKey, nextConfig);
    await fbPut(`classroom_pins/${params.sessionKey}`, nextConfig).catch(() => {
    });
    return nextConfig;
  }
  return existing;
}
async function signQrToken(payload) {
  const secret = await getAuthSecret();
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(`qr:${encoded}`).digest("base64url");
  return `${encoded}.${sig}`;
}
async function verifyQrToken(token) {
  const parts = String(token || "").trim().split(".");
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const secret = await getAuthSecret();
  const expectedSig = crypto.createHmac("sha256", secret).update(`qr:${encoded}`).digest("base64url");
  if (!timingSafeStringEqual(sig, expectedSig)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (!parsed || parsed.v !== 1 || !parsed.iat || !parsed.exp || !parsed.sessionKey) return null;
    return parsed;
  } catch {
    return null;
  }
}
async function signCheckinGrant(payload) {
  const secret = await getAuthSecret();
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(`grant:${encoded}`).digest("base64url");
  return `${encoded}.${sig}`;
}
async function verifyCheckinGrant(token) {
  const parts = String(token || "").trim().split(".");
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const secret = await getAuthSecret();
  const expectedSig = crypto.createHmac("sha256", secret).update(`grant:${encoded}`).digest("base64url");
  if (!timingSafeStringEqual(sig, expectedSig)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (!parsed || parsed.v !== 1 || !parsed.nonce || !parsed.exp || !parsed.sessionKey) return null;
    if (Date.now() > parsed.exp) return null;
    return parsed;
  } catch {
    return null;
  }
}
function sanitizeUser(user) {
  const rest = { ...user };
  delete rest.password;
  delete rest.passwordHash;
  delete rest.activationPin;
  delete rest.activationToken;
  return {
    ...rest,
    role: rest.username?.toLowerCase() === "admin" ? "admin" : rest.role || "lecturer",
    status: rest.status || "active",
    email: rest.email || "",
    createdAt: rest.createdAt || 0
  };
}
function normalizeCourse(raw) {
  return {
    ...raw,
    selectedWeek: raw.selectedWeek || "W1",
    students: Array.isArray(raw.students) ? raw.students : [],
    sharedWith: Array.isArray(raw.sharedWith) ? raw.sharedWith : []
  };
}
function normalizeStudentsList(rawList) {
  if (!Array.isArray(rawList)) return [];
  const seen = /* @__PURE__ */ new Set();
  const normalized = [];
  for (const item of rawList) {
    const rec = item;
    const id = String(rec?.id || "").trim().toUpperCase();
    const name = String(rec?.name || "").trim().toUpperCase();
    if (id && name && !seen.has(id)) {
      seen.add(id);
      normalized.push({ id, name });
    }
  }
  return normalized;
}
function areStudentRostersEqual(a = [], b = []) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const sa = a[i];
    const sb = b[i];
    if (String(sa?.id || "").trim().toUpperCase() !== String(sb?.id || "").trim().toUpperCase() || String(sa?.name || "").trim().toUpperCase() !== String(sb?.name || "").trim().toUpperCase()) {
      return false;
    }
  }
  return true;
}
function canAccessCourse(course, auth) {
  if (auth.role === "admin") return true;
  if (course.ownerId && course.ownerId === auth.uid) return true;
  if (!course.ownerId && course.createdBy && course.createdBy.toLowerCase() === auth.username.toLowerCase()) {
    return true;
  }
  if (Array.isArray(course.sharedWith) && (course.sharedWith.includes(auth.uid) || course.sharedWith.some((entry) => entry.toLowerCase() === auth.username.toLowerCase()))) {
    return true;
  }
  return false;
}
function findCoursesMatching(coursesObj, params) {
  if (!coursesObj || typeof coursesObj !== "object") return [];
  const allCourses = Object.values(coursesObj).filter((c) => Boolean(c && c.id && c.courseName)).map(normalizeCourse);
  const cleanId = String(params.courseId || "").trim();
  if (cleanId) {
    const byId = allCourses.find((c) => c.id === cleanId);
    if (byId) return [byId];
  }
  const cleanName = String(params.courseName || "").trim();
  if (cleanName) {
    return allCourses.filter((c) => isSameCourse(c, cleanName));
  }
  return [];
}
function resolveCourseAccess(params) {
  const matches = findCoursesMatching(params.coursesObj, {
    courseId: params.courseId,
    courseName: params.courseName
  });
  if (matches.length === 0) {
    return { allowed: true, course: null };
  }
  const accessible = matches.find((c) => canAccessCourse(c, params.auth)) || null;
  if (!accessible) {
    return { allowed: false, course: matches[0] };
  }
  return { allowed: true, course: accessible };
}
function isDirectOwnerOrShared(course, auth) {
  if (course.ownerId && course.ownerId === auth.uid) return true;
  if (!course.ownerId && course.createdBy && course.createdBy.toLowerCase() === auth.username.toLowerCase()) {
    return true;
  }
  if (!course.ownerId && !course.createdBy && auth.role === "admin") {
    return true;
  }
  if (Array.isArray(course.sharedWith) && (course.sharedWith.includes(auth.uid) || course.sharedWith.some((entry) => entry.toLowerCase() === auth.username.toLowerCase()))) {
    return true;
  }
  return false;
}
function sanitizeSharedWithIds(rawIds, allUsers, excludeOwnerId) {
  if (!Array.isArray(rawIds)) return [];
  const validIds = new Set(allUsers.filter((u) => u && u.id && (u.status || "active") === "active").map((u) => u.id));
  const seen = /* @__PURE__ */ new Set();
  const cleaned = [];
  for (const item of rawIds) {
    const id = String(item || "").trim();
    if (!id || id === excludeOwnerId || !validIds.has(id) || seen.has(id)) continue;
    seen.add(id);
    cleaned.push(id);
  }
  return cleaned;
}
function parseOwnerTokens(rawOwner) {
  return String(rawOwner || "").split(/[,;]+/).map((s) => s.trim()).filter(Boolean);
}
function resolveSheetTabOwner(rawOwner, ownerExplicit, allUsers) {
  const tokens = parseOwnerTokens(rawOwner);
  if (tokens.length === 0) {
    return { recognized: false, tokens: [], matchedUsers: [], displayLabel: "" };
  }
  const matchedUsers = [];
  const seenIds = /* @__PURE__ */ new Set();
  for (const token of tokens) {
    const lower = token.toLowerCase();
    const user = allUsers.find(
      (u) => u.username?.trim().toLowerCase() === lower || u.email && u.email.trim().toLowerCase() === lower
    );
    if (user && !seenIds.has(user.id)) {
      seenIds.add(user.id);
      matchedUsers.push(user);
    }
  }
  const looksLikeEmail = tokens.some((t) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t));
  const recognized = ownerExplicit || matchedUsers.length > 0 || looksLikeEmail;
  const displayLabel = matchedUsers.length > 0 ? matchedUsers.map((u) => u.username).join(", ") : tokens.join(", ");
  return { recognized, tokens, matchedUsers, displayLabel };
}
function doesAuthMatchSheetOwner(tokens, auth, authUser) {
  const authUsername = auth.username.trim().toLowerCase();
  const authEmail = (authUser?.email || "").trim().toLowerCase();
  return tokens.some((token) => {
    const lower = token.toLowerCase();
    return lower === authUsername || authEmail !== "" && lower === authEmail;
  });
}
function getDeviceLabel(ua) {
  let os = "Desktop";
  if (/iPhone/i.test(ua)) os = "iPhone";
  else if (/iPad/i.test(ua)) os = "iPad";
  else if (/Android/i.test(ua)) os = "Android";
  else if (/Windows/i.test(ua)) os = "Windows";
  else if (/Mac OS X|Macintosh/i.test(ua)) os = "macOS";
  else if (/Linux/i.test(ua)) os = "Linux";
  let browser = "Browser";
  if (/Edg\//i.test(ua)) browser = "Edge";
  else if (/OPR\/|Opera/i.test(ua)) browser = "Opera";
  else if (/Chrome\//i.test(ua) && !/Edg\//i.test(ua)) browser = "Chrome";
  else if (/Firefox\//i.test(ua)) browser = "Firefox";
  else if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) browser = "Safari";
  return `${browser} \u2022 ${os}`;
}
function sanitizePublicAppUrl(rawUrl, req) {
  if (typeof rawUrl === "string" && /^https?:\/\//i.test(rawUrl.trim())) {
    const clean = rawUrl.trim().split("?")[0].split("#")[0];
    return clean.replace(/^https:\/\/ais-dev-/i, "https://ais-pre-");
  }
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "https";
  const host = req.headers["x-forwarded-host"] || req.get("host") || "localhost:3000";
  return `${proto}://${host}/`.replace(/^https:\/\/ais-dev-/i, "https://ais-pre-");
}
async function ensureAdminUserExists() {
  const existing = await fbGet("app_users/admin");
  if (existing && existing.id) {
    if (!existing.passwordHash) {
      const shouldUpgradeLegacy = !process.env.ADMIN_DEFAULT_PASSWORD && (!existing.password || existing.password === LEGACY_DEFAULT_ADMIN_PASSWORD);
      const pwd = shouldUpgradeLegacy ? DEFAULT_ADMIN_PASSWORD : existing.password || DEFAULT_ADMIN_PASSWORD;
      const hash = hashPassword(pwd);
      await fbPatch("app_users/admin", {
        passwordHash: hash,
        password: null,
        role: "admin",
        status: "active"
      });
      return { ...existing, passwordHash: hash, role: "admin", status: "active" };
    }
    if (!process.env.ADMIN_DEFAULT_PASSWORD && DEFAULT_ADMIN_PASSWORD !== LEGACY_DEFAULT_ADMIN_PASSWORD && verifyPasswordHash(LEGACY_DEFAULT_ADMIN_PASSWORD, existing.passwordHash)) {
      const upgradedHash = hashPassword(DEFAULT_ADMIN_PASSWORD);
      await fbPatch("app_users/admin", {
        passwordHash: upgradedHash,
        password: null,
        role: "admin",
        status: "active"
      });
      return { ...existing, passwordHash: upgradedHash, role: "admin", status: "active" };
    }
    return existing;
  }
  const adminUser = {
    id: "admin",
    username: "admin",
    email: "",
    passwordHash: hashPassword(DEFAULT_ADMIN_PASSWORD),
    role: "admin",
    status: "active",
    createdAt: 0
  };
  await fbPut("app_users/admin", adminUser);
  return adminUser;
}
async function getAppConfig() {
  const cfg = await fbGet("app_config") || {};
  const scriptUrl = typeof cfg.script_url === "string" && cfg.script_url.trim().startsWith("https://script.google.com/") ? cfg.script_url.trim() : DEFAULT_SCRIPT_URL;
  const envSecret = (process.env.APPS_SCRIPT_SECRET || process.env.GOOGLE_SCRIPT_SECRET || "").trim();
  const dbSecret = typeof cfg.script_secret === "string" ? cfg.script_secret.trim() : "";
  const scriptSecret = envSecret || dbSecret;
  const integrationType = cfg.integration_type === "google_sheets" || cfg.integration_type === "airtable" || cfg.integration_type === "firebase" ? cfg.integration_type : "google_sheets";
  const adminEmail = typeof cfg.admin_email === "string" ? cfg.admin_email.trim() : "";
  const knownStudentsV2 = Array.isArray(cfg.known_students_v2) ? cfg.known_students_v2 : PRE_REGISTERED_STUDENTS;
  return {
    scriptUrl,
    scriptSecret,
    scriptSecretFromEnv: Boolean(envSecret),
    integrationType,
    adminEmail,
    knownStudentsV2
  };
}
function buildGoogleScriptUrl(scriptUrl, queryParams, scriptSecret) {
  const url = new URL(scriptUrl.trim());
  for (const [k, v] of Object.entries(queryParams)) {
    if (v !== void 0 && v !== "") {
      url.searchParams.set(k, v);
    }
  }
  const cleanSecret = (scriptSecret || "").trim();
  if (cleanSecret) {
    url.searchParams.set("key", cleanSecret);
  }
  return url.toString();
}
function formatCloudPayload(r, fallbackWeek = "W1") {
  const targetWeek = r.week || fallbackWeek || "W1";
  return {
    "Student ID": r.studentId,
    Name: r.name,
    "Course Name": r.courseName || "General Session",
    Week: targetWeek,
    Status: r.status,
    "[Course Name Here]": r.courseName || "General Session",
    "[Date Here 1]": new Date(r.timestamp).toLocaleDateString(),
    "[Status Here]": r.status,
    [targetWeek]: r.status,
    Reason: r.absenceReason || "",
    Timestamp: new Date(r.timestamp).toISOString()
  };
}
function toAttendanceHistoryKey(rec) {
  return toFirebaseKey(`${normalizeStudentId(rec.studentId || "")}__${rec.timestamp}`);
}
async function readAttendanceHistoryEntries() {
  const histRaw = await fbGet("attendance_history");
  if (!histRaw) return [];
  const entries = Array.isArray(histRaw) ? histRaw.map((record, idx) => [String(idx), record]) : typeof histRaw === "object" ? Object.entries(histRaw) : [];
  return entries.filter((entry) => Boolean(entry[1] && entry[1].studentId && entry[1].timestamp)).map(([key, record]) => ({ key, record }));
}
async function upsertAttendanceHistory(incoming) {
  if (!Array.isArray(incoming) || incoming.length === 0) return;
  const patchMap = {};
  for (const rec of incoming) {
    if (!rec || !rec.studentId || !rec.timestamp) continue;
    patchMap[toAttendanceHistoryKey(rec)] = rec;
  }
  if (Object.keys(patchMap).length === 0) return;
  await fbPatch("attendance_history", patchMap).catch(() => {
  });
}
async function postToGoogleScript(scriptUrl, bodyPayload, scriptSecret) {
  const cleanUrl = scriptUrl.trim();
  if (!cleanUrl || cleanUrl === DEFAULT_SCRIPT_URL || !cleanUrl.startsWith("https://script.google.com/") || cleanUrl.endsWith("/dev")) {
    return {
      ok: false,
      error: "Google Apps Script /exec URL is not configured or points to a /dev test URL."
    };
  }
  try {
    let effectiveSecret = (scriptSecret ?? "").trim();
    if (scriptSecret === void 0) {
      const envSecret = (process.env.APPS_SCRIPT_SECRET || process.env.GOOGLE_SCRIPT_SECRET || "").trim();
      if (envSecret) {
        effectiveSecret = envSecret;
      } else {
        const dbSecret = await fbGet("app_config/script_secret").catch(() => null);
        effectiveSecret = typeof dbSecret === "string" ? dbSecret.trim() : "";
      }
    }
    const targetUrl = buildGoogleScriptUrl(cleanUrl, {}, effectiveSecret);
    const res = await fetch(targetUrl, {
      method: "POST",
      redirect: "follow",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(bodyPayload)
    });
    const text = await res.text();
    if (!res.ok || text.trim().startsWith("<")) {
      return {
        ok: false,
        error: `Apps Script returned HTTP ${res.status} or HTML instead of JSON. Check Web App access = Anyone.`
      };
    }
    try {
      const parsed = JSON.parse(text);
      if (parsed && parsed.success === false && typeof parsed.error === "string") {
        return { ok: false, json: parsed, error: parsed.error };
      }
      return { ok: true, json: parsed };
    } catch {
      return { ok: true };
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to reach Google Apps Script URL."
    };
  }
}
function escapeHtml(raw) {
  return raw.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function getEmailDeliveryStatus(scriptUrl) {
  const resendKey = (process.env.RESEND_API_KEY || "").trim();
  const smtpUrl = (process.env.SMTP_URL || "").trim();
  const smtpHost = (process.env.SMTP_HOST || "").trim();
  const smtpUser = (process.env.SMTP_USER || "").trim();
  const smtpPass = (process.env.SMTP_PASS || "").trim();
  const emailFrom = (process.env.EMAIL_FROM || "").trim();
  if (resendKey) {
    return {
      provider: "resend",
      label: "Built-in Resend API",
      configured: true,
      fromAddress: emailFrom || "Smart Attendance <onboarding@resend.dev>"
    };
  }
  if (smtpUrl || smtpHost && smtpUser && smtpPass) {
    return {
      provider: "smtp",
      label: "Built-in SMTP Server",
      configured: true,
      fromAddress: emailFrom || (smtpUser ? `Smart Attendance <${smtpUser}>` : "Smart Attendance")
    };
  }
  const cleanScript = (scriptUrl || "").trim();
  if (cleanScript && cleanScript !== DEFAULT_SCRIPT_URL && !cleanScript.endsWith("/dev")) {
    return {
      provider: "apps_script",
      label: "Google Apps Script (MailApp)",
      configured: true
    };
  }
  return {
    provider: "none",
    label: "Not Configured",
    configured: false
  };
}
async function sendDirectEmail(params) {
  const recipient = params.to.trim();
  if (!recipient) {
    return { ok: false, provider: "none", error: "Recipient email address is empty." };
  }
  const resendKey = (process.env.RESEND_API_KEY || "").trim();
  const emailFrom = (process.env.EMAIL_FROM || "").trim();
  if (resendKey) {
    const fromAddr = emailFrom || "Smart Attendance <onboarding@resend.dev>";
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from: fromAddr,
          to: [recipient],
          subject: params.subject,
          text: params.text,
          html: params.html
        })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          ok: false,
          provider: "resend",
          error: body?.message || body?.error?.message || `Resend API error (${res.status})`
        };
      }
      return { ok: true, provider: "resend" };
    } catch (err) {
      return {
        ok: false,
        provider: "resend",
        error: err instanceof Error ? err.message : "Failed to reach Resend API."
      };
    }
  }
  const smtpUrl = (process.env.SMTP_URL || "").trim();
  const smtpHost = (process.env.SMTP_HOST || "").trim();
  const smtpUser = (process.env.SMTP_USER || "").trim();
  const smtpPass = (process.env.SMTP_PASS || "").trim();
  const smtpPort = Number(process.env.SMTP_PORT || 587);
  const smtpSecure = String(process.env.SMTP_SECURE || "").toLowerCase() === "true" || smtpPort === 465;
  if (smtpUrl || smtpHost && smtpUser && smtpPass) {
    const fromAddr = emailFrom || (smtpUser ? `Smart Attendance <${smtpUser}>` : "no-reply@localhost");
    try {
      const transporter = smtpUrl ? nodemailer.createTransport(smtpUrl) : nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpSecure,
        auth: { user: smtpUser, pass: smtpPass }
      });
      await transporter.sendMail({
        from: fromAddr,
        to: recipient,
        subject: params.subject,
        text: params.text,
        html: params.html
      });
      return { ok: true, provider: "smtp" };
    } catch (err) {
      return {
        ok: false,
        provider: "smtp",
        error: err instanceof Error ? err.message : "SMTP delivery failed."
      };
    }
  }
  return { ok: false, provider: "none", error: "No built-in email provider configured." };
}
async function dispatchSignupApprovalEmails(params) {
  const status = getEmailDeliveryStatus(params.cfg.scriptUrl);
  if (status.provider === "resend" || status.provider === "smtp") {
    const safeUser = escapeHtml(params.username);
    const safeEmail = escapeHtml(params.toEmail);
    let adminEmailSent = false;
    if (params.cfg.adminEmail) {
      const adminRes = await sendDirectEmail({
        to: params.cfg.adminEmail,
        subject: `[Smart Attendance] Approval Needed: New User Signup (${params.username})`,
        text: `A new user signed up on the Smart QR Attendance System and is waiting for Admin approval.

Username: ${params.username}
Email: ${params.toEmail}
Status: Pending Admin Approval

Open the Admin Control Center -> Users tab to approve and activate this account.
`,
        html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:20px;border:1px solid #e5e7eb;border-radius:12px;"><h3 style="color:#111827;margin:0 0 8px;">New User Signup \u2014 Approval Needed</h3><p style="color:#374151;font-size:14px;"><strong>Username:</strong> ${safeUser}<br/><strong>Email:</strong> ${safeEmail}<br/><strong>Status:</strong> Pending Admin Approval</p><p style="color:#6b7280;font-size:12px;">Open the Admin Control Center &rarr; Users tab in Smart Attendance to approve and activate this account.</p></div>`
      }).catch(() => ({ ok: false, provider: status.provider, error: "Failed to notify admin" }));
      adminEmailSent = Boolean(adminRes.ok);
    }
    const userRes = await sendDirectEmail({
      to: params.toEmail,
      subject: "Smart Attendance Registration Received (Pending Admin Approval)",
      text: `Hello ${params.username},

Thank you for signing up for the Smart QR Attendance System.

Your account has been created and is waiting for Administrator approval before it can be used.
You will receive another confirmation email once the Administrator approves and activates your account.
`,
      html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;border:1px solid #e5e7eb;border-radius:12px;"><h2 style="color:#111827;margin:0 0 10px;">Registration Pending Approval</h2><p style="color:#4b5563;font-size:14px;">Hello <strong>${safeUser}</strong>,</p><p style="color:#4b5563;font-size:14px;">Thank you for signing up for the Smart QR Attendance System. Your account is currently <strong>pending Administrator approval</strong> and cannot be used until it is approved.</p><p style="color:#6b7280;font-size:12px;">You will receive a confirmation email once the Administrator activates your account.</p></div>`
    }).catch(() => ({ ok: false, provider: status.provider, error: "Failed to notify user" }));
    return {
      emailSent: Boolean(userRes.ok || adminEmailSent),
      provider: status.provider,
      error: userRes.error || (!adminEmailSent ? "Could not deliver signup approval emails." : void 0)
    };
  }
  const emailRes = await postToGoogleScript(params.cfg.scriptUrl, {
    action: "SEND_ACTIVATION_EMAIL",
    toEmail: params.toEmail,
    username: params.username,
    activationUrl: "",
    expiresAtText: "",
    adminEmail: params.cfg.adminEmail
  });
  const ok = Boolean(emailRes.ok && emailRes.json?.success && emailRes.json?.emailSent !== false);
  return {
    emailSent: ok,
    provider: status.provider,
    error: !ok ? typeof emailRes.json?.error === "string" ? emailRes.json.error : emailRes.error || "Apps Script email failed." : void 0
  };
}
async function dispatchDeleteRequestEmail(params) {
  const status = getEmailDeliveryStatus(params.cfg.scriptUrl);
  if (status.provider === "resend" || status.provider === "smtp") {
    const targetAdmin = params.cfg.adminEmail || (process.env.EMAIL_FROM || "").trim() || (process.env.SMTP_USER || "").trim();
    if (!targetAdmin) {
      return { emailSent: false, provider: status.provider, error: "Admin notification email address is not set." };
    }
    const safeUser = escapeHtml(params.username);
    const safeEmail = escapeHtml(params.userEmail || "N/A");
    const safeReason = escapeHtml(params.reason);
    const res = await sendDirectEmail({
      to: targetAdmin,
      subject: `[Smart Attendance] Account Deletion Request: ${params.username}`,
      text: `A user submitted an account deletion request from the Smart QR Attendance app.

Username: ${params.username}
Email: ${params.userEmail}
Reason: ${params.reason}

Open the Admin Control Center to review and remove this account.`,
      html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:20px;border:1px solid #e5e7eb;border-radius:12px;"><h3 style="color:#991b1b;margin:0 0 8px;">Account Deletion Request</h3><p style="color:#374151;font-size:14px;"><strong>Username:</strong> ${safeUser}<br/><strong>Email:</strong> ${safeEmail}<br/><strong>Reason:</strong> ${safeReason}</p><p style="color:#6b7280;font-size:12px;">Open the Admin Control Center in the app to review and remove this account.</p></div>`
    });
    return { emailSent: res.ok, provider: res.provider, error: res.error };
  }
  const emailRes = await postToGoogleScript(params.cfg.scriptUrl, {
    action: "SEND_DELETE_REQUEST_EMAIL",
    username: params.username,
    userEmail: params.userEmail,
    reason: params.reason,
    adminEmail: params.cfg.adminEmail
  });
  const ok = Boolean(emailRes.ok && emailRes.json?.success && emailRes.json?.emailSent !== false);
  return {
    emailSent: ok,
    provider: status.provider,
    error: !ok ? typeof emailRes.json?.error === "string" ? emailRes.json.error : emailRes.error || "Apps Script delete request email failed." : void 0
  };
}
async function dispatchApprovalPinEmail(params) {
  const status = getEmailDeliveryStatus(params.cfg.scriptUrl);
  const expiryLine = params.expiresAtText ? `This Activation PIN expires in 24 hours (${params.expiresAtText}).` : "This Activation PIN expires within 24 hours.";
  if (status.provider === "resend" || status.provider === "smtp") {
    const safeUser = escapeHtml(params.username);
    const safePin = escapeHtml(params.pin);
    const safeExpiry = escapeHtml(expiryLine);
    const res = await sendDirectEmail({
      to: params.toEmail,
      subject: "Your Smart Attendance Account Is Approved \u2014 Activation PIN",
      text: `Hello ${params.username},

Good news! Your Smart QR Attendance account has been approved by the Administrator.

Your 6-digit Activation PIN is: ${params.pin}

How to complete activation:
1. Open the Smart Attendance Sign In page and log in with your User Name and Password first.
2. Key in this 6-digit Activation PIN when prompted to complete activation and start using your account.

${expiryLine}
`,
      html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;border:1px solid #e5e7eb;border-radius:12px;"><h2 style="color:#111827;margin:0 0 10px;">Account Approved \u2014 Activation PIN</h2><p style="color:#4b5563;font-size:14px;">Hello <strong>${safeUser}</strong>,</p><p style="color:#4b5563;font-size:14px;">Your Smart QR Attendance account has been approved by the Administrator. Sign in with your User Name and Password first, then key in this 6-digit Activation PIN when prompted to complete activation and access your account:</p><div style="margin:20px 0;padding:14px 20px;background:#eef2ff;border:2px solid #c7d2fe;border-radius:12px;text-align:center;font-family:monospace;font-size:28px;font-weight:900;letter-spacing:0.25em;color:#3730a3;">${safePin}</div><p style="color:#92400e;background:#fffbeb;border:1px solid #fde68a;padding:10px 12px;border-radius:8px;font-size:12px;font-weight:bold;">${safeExpiry}</p></div>`
    }).catch(() => ({ ok: false, provider: status.provider, error: "Failed to send PIN email" }));
    return {
      emailSent: Boolean(res.ok),
      provider: status.provider,
      error: res.error
    };
  }
  const emailRes = await postToGoogleScript(params.cfg.scriptUrl, {
    action: "SEND_ACTIVATION_EMAIL",
    toEmail: params.toEmail,
    username: params.username,
    activationPin: params.pin,
    activationUrl: "",
    expiresAtText: params.expiresAtText,
    adminEmail: params.cfg.adminEmail
  });
  const ok = Boolean(emailRes.ok && emailRes.json?.success && emailRes.json?.emailSent !== false);
  return {
    emailSent: ok,
    provider: status.provider,
    error: !ok ? typeof emailRes.json?.error === "string" ? emailRes.json.error : emailRes.error || "Apps Script PIN email failed." : void 0
  };
}
async function dispatchPasswordResetPinEmail(params) {
  const status = getEmailDeliveryStatus(params.cfg.scriptUrl);
  const expiryLine = params.expiresAtText ? `This Password Reset PIN expires in 15 minutes (${params.expiresAtText}).` : "This Password Reset PIN expires in 15 minutes.";
  if (status.provider === "resend" || status.provider === "smtp") {
    const safeUser = escapeHtml(params.username);
    const safePin = escapeHtml(params.pin);
    const safeExpiry = escapeHtml(expiryLine);
    const res = await sendDirectEmail({
      to: params.toEmail,
      subject: "Smart Attendance \u2014 Password Reset Verification PIN",
      text: `Hello ${params.username},

We received a request to reset your Smart QR Attendance password.

Your 6-digit Password Reset PIN is: ${params.pin}

Enter this PIN along with your new strong password on the Forgot Password screen.

${expiryLine}

If you did not request a password reset, you can safely ignore this email.
`,
      html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;border:1px solid #e5e7eb;border-radius:12px;"><h2 style="color:#111827;margin:0 0 10px;">Password Reset Verification PIN</h2><p style="color:#4b5563;font-size:14px;">Hello <strong>${safeUser}</strong>,</p><p style="color:#4b5563;font-size:14px;">Use this 6-digit Password Reset PIN on the Smart Attendance Forgot Password screen to set a new password:</p><div style="margin:20px 0;padding:14px 20px;background:#eef2ff;border:2px solid #c7d2fe;border-radius:12px;text-align:center;font-family:monospace;font-size:28px;font-weight:900;letter-spacing:0.25em;color:#3730a3;">${safePin}</div><p style="color:#92400e;background:#fffbeb;border:1px solid #fde68a;padding:10px 12px;border-radius:8px;font-size:12px;font-weight:bold;">${safeExpiry}</p><p style="color:#6b7280;font-size:12px;margin-top:12px;">If you did not request this reset, you can safely ignore this message.</p></div>`
    }).catch(() => ({ ok: false, provider: status.provider, error: "Failed to send password reset PIN email" }));
    return {
      emailSent: Boolean(res.ok),
      provider: status.provider,
      error: res.error
    };
  }
  const emailRes = await postToGoogleScript(params.cfg.scriptUrl, {
    action: "SEND_PASSWORD_RESET_EMAIL",
    toEmail: params.toEmail,
    username: params.username,
    resetPin: params.pin,
    expiresAtText: params.expiresAtText,
    adminEmail: params.cfg.adminEmail
  });
  const ok = Boolean(emailRes.ok && emailRes.json?.success && emailRes.json?.emailSent !== false);
  return {
    emailSent: ok,
    provider: status.provider,
    error: !ok ? typeof emailRes.json?.error === "string" ? emailRes.json.error : emailRes.error || "Apps Script password reset email failed." : void 0
  };
}
async function createUserSystemNotification(params) {
  const cleanUid = String(params.userId || "").trim();
  if (!cleanUid) return null;
  const now = Date.now();
  const notifId = `unotif_${now}_${crypto.randomBytes(3).toString("hex")}`;
  const notif = {
    id: notifId,
    userId: cleanUid,
    type: params.type,
    title: params.title,
    message: params.message,
    createdAt: now,
    read: false,
    ...params.courseName ? { courseName: params.courseName } : {}
  };
  await fbPut(`user_notifications/${cleanUid}/${notifId}`, notif).catch(() => {
  });
  return notif;
}
async function createAdminAlertNotification(params) {
  const now = Date.now();
  const notifId = `admalert_${now}_${crypto.randomBytes(3).toString("hex")}`;
  const notif = {
    id: notifId,
    type: params.type,
    userId: params.userId || "system",
    username: params.username || "System",
    email: params.email || "",
    createdAt: now,
    read: false,
    emailSent: Boolean(params.emailSent),
    message: params.message,
    ...params.reason ? { reason: params.reason } : {},
    ...params.courseName ? { courseName: params.courseName } : {}
  };
  await fbPut(`admin_notifications/${notifId}`, notif).catch(() => {
  });
  return notif;
}
async function createEmailDeliveryFailureAlert(params) {
  const providerLabel = params.provider === "resend" ? "Resend API" : params.provider === "smtp" ? "SMTP" : params.provider === "apps_script" ? "Google Apps Script" : "Unconfigured Provider";
  const targetLabel = params.targetEmail ? ` to ${params.targetEmail}` : "";
  const detail = params.error ? ` \u2014 ${params.error}` : "";
  return createAdminAlertNotification({
    type: "email_delivery_failure",
    userId: params.userId || "system",
    username: params.username || "System",
    email: params.targetEmail || "",
    emailSent: false,
    reason: params.error || `Failed via ${providerLabel}`,
    message: `Email delivery failed (${params.context}${targetLabel}) via ${providerLabel}${detail}`
  });
}
function resolveCourseSharedUserIds(entries, allUsers) {
  if (!Array.isArray(entries)) return [];
  const resolved = [];
  const seen = /* @__PURE__ */ new Set();
  for (const raw of entries) {
    const token = String(raw || "").trim();
    if (!token) continue;
    const matched = allUsers.find(
      (u) => u && u.id && (u.id === token || u.username.toLowerCase() === token.toLowerCase())
    );
    const finalId = matched ? matched.id : token;
    if (!seen.has(finalId)) {
      seen.add(finalId);
      resolved.push(finalId);
    }
  }
  return resolved;
}
async function createActivationNotifications(userRecord, activatedBy) {
  const now = Date.now();
  const suffix = crypto.randomBytes(2).toString("hex");
  const adminNotifId = `activated_${now}_${suffix}`;
  const userNotifId = `user_activated_${now}_${suffix}`;
  const [cfg, existingAdminNotifs] = await Promise.all([
    getAppConfig(),
    fbGet("admin_notifications").catch(() => null)
  ]);
  if (existingAdminNotifs && typeof existingAdminNotifs === "object") {
    await Promise.all(
      Object.values(existingAdminNotifs).filter((n) => n && !n.read && n.type === "user_signup" && n.userId === userRecord.id).map((n) => fbPatch(`admin_notifications/${n.id}`, { read: true }).catch(() => {
      }))
    );
  }
  let emailSent = false;
  try {
    const status = getEmailDeliveryStatus(cfg.scriptUrl);
    if (status.provider === "resend" || status.provider === "smtp") {
      const safeUser = escapeHtml(userRecord.username);
      const actorText = activatedBy === "email_pin" ? "with your Activation PIN after Admin approval" : "by the Administrator";
      if (userRecord.email) {
        const userEmailRes = await sendDirectEmail({
          to: userRecord.email,
          subject: "Your Smart Attendance Account Is Now Active",
          text: `Hello ${userRecord.username},

Your lecturer account on the Smart Attendance system is now active (${actorText}).
You can sign in and manage your attendance sessions anytime.
`,
          html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;border:1px solid #e5e7eb;border-radius:12px;"><h2 style="color:#065f46;margin:0 0 10px;">Account Activated</h2><p style="color:#374151;font-size:14px;">Hello <strong>${safeUser}</strong>,</p><p style="color:#374151;font-size:14px;">Your Smart Attendance lecturer account is now active and ready to use.</p></div>`
        });
        if (userEmailRes.ok) {
          emailSent = true;
        } else {
          await createEmailDeliveryFailureAlert({
            context: "Account Activated Confirmation Email",
            targetEmail: userRecord.email,
            username: userRecord.username,
            userId: userRecord.id,
            provider: status.provider,
            error: userEmailRes.error || "Failed to send activation confirmation email."
          });
        }
      }
    }
  } catch (err) {
    await createEmailDeliveryFailureAlert({
      context: "Account Activated Confirmation Email",
      targetEmail: userRecord.email,
      username: userRecord.username,
      userId: userRecord.id,
      error: err instanceof Error ? err.message : "Unexpected email transport error."
    }).catch(() => {
    });
  }
  const adminNotification = {
    id: adminNotifId,
    type: "account_activated",
    userId: userRecord.id,
    username: userRecord.username,
    email: userRecord.email || "",
    createdAt: now,
    read: false,
    emailSent,
    message: activatedBy === "email_pin" ? `${userRecord.username} (${userRecord.email || "no email"}) entered their Activation PIN and is now active.` : `${userRecord.username} (${userRecord.email || "no email"}) account has been activated by Admin.`
  };
  const userNotification = {
    id: userNotifId,
    userId: userRecord.id,
    type: "account_activated",
    title: "Account Activated",
    message: `Your lecturer account (${userRecord.username}) is now active and ready to use.`,
    createdAt: now,
    read: false
  };
  await Promise.all([
    fbPut(`admin_notifications/${adminNotifId}`, adminNotification),
    fbPut(`user_notifications/${userRecord.id}/${userNotifId}`, userNotification)
  ]);
  return { adminNotification, userNotification };
}
async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }
  const payload = await verifySessionToken(token);
  if (!payload) {
    res.status(401).json({ error: "Session expired or invalid. Please sign in again." });
    return;
  }
  try {
    const [userRecord, sessionRecord] = await Promise.all([
      findStoredUserById(payload.uid),
      payload.sid ? fbGet(`admin_logins/${payload.sid}`) : Promise.resolve(null)
    ]);
    if (!userRecord || !userRecord.id) {
      res.status(401).json({ error: "Your account access was removed by the Administrator." });
      return;
    }
    const effectiveStatus = userRecord.status || "active";
    if (userRecord.role !== "admin" && effectiveStatus !== "active") {
      res.status(401).json({ error: "Your account is deactivated. Contact the Administrator." });
      return;
    }
    if (sessionRecord && sessionRecord.status === "signed_out") {
      res.status(401).json({ error: "Your session was signed out by the Administrator." });
      return;
    }
    req.auth = {
      ...payload,
      role: userRecord.username.toLowerCase() === "admin" ? "admin" : userRecord.role || payload.role
    };
    next();
  } catch {
    res.status(500).json({ error: "Unable to verify authentication session." });
  }
}
function requireAdmin(req, res, next) {
  if (!req.auth || req.auth.role !== "admin") {
    res.status(403).json({ error: "Administrator privileges required." });
    return;
  }
  next();
}
async function resolveRosterForCourse(params) {
  const cleanCourse = (params.courseName || "").trim();
  const cleanId = (params.courseId || "").trim();
  const cfg = await getAppConfig();
  let sheetTabMatched = false;
  if (cfg.integrationType === "google_sheets" && cfg.scriptUrl && cfg.scriptUrl !== DEFAULT_SCRIPT_URL && !cfg.scriptUrl.endsWith("/dev")) {
    try {
      const sheetUrl = buildGoogleScriptUrl(
        cfg.scriptUrl,
        {
          action: "getCourse",
          course: cleanCourse || void 0,
          t: String(Date.now())
        },
        cfg.scriptSecret
      );
      const res = await fetch(sheetUrl, { method: "GET", redirect: "follow" });
      const rawText = await res.text();
      if (res.ok && !rawText.trim().startsWith("<")) {
        const data = JSON.parse(rawText);
        if (data?.success) {
          const sheetsArr = Array.isArray(data.sheets) ? data.sheets : [];
          const targetNorm = normalizeCourseNameKey(cleanCourse);
          const matchedTab = targetNorm ? sheetsArr.find((s) => normalizeCourseNameKey(String(s?.courseName || "")) === targetNorm) : void 0;
          if (matchedTab) sheetTabMatched = true;
          const rawStudents = targetNorm && sheetsArr.length > 0 ? matchedTab && Array.isArray(matchedTab.students) ? matchedTab.students : [] : Array.isArray(data.students) ? data.students : [];
          if (rawStudents.length > 0) {
            const normalized = normalizeStudentsList(rawStudents);
            if (normalized.length > 0) return normalized;
          }
          if (matchedTab && Array.isArray(matchedTab.students)) {
            return [];
          }
        }
      }
    } catch {
    }
  }
  const coursesObj = await fbGet("courses");
  if (coursesObj && typeof coursesObj === "object") {
    const matches = findCoursesMatching(coursesObj, { courseId: cleanId, courseName: cleanCourse });
    if (matches.length > 0) {
      const preferred = matches.find((c) => Array.isArray(c.students) && c.students.length > 0) || matches[0];
      return Array.isArray(preferred.students) ? preferred.students : [];
    }
  }
  if (sheetTabMatched) {
    return [];
  }
  if (cleanCourse && normalizeCourseNameKey(cleanCourse) !== normalizeCourseNameKey("General Session")) {
    return [];
  }
  return cfg.knownStudentsV2;
}
function createApiApp() {
  const app2 = express();
  app2.use((req, _res, next) => {
    const rawReq = req;
    if (req.body !== void 0 && rawReq._body === void 0) {
      rawReq._body = true;
    }
    next();
  });
  app2.use(express.json({ limit: "5mb" }));
  void getAuthSecret().catch(() => {
  });
  void ensureAdminUserExists().catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("Could not initialize admin record on boot:", msg);
  });
  app2.get("/api/config/public", async (_req, res) => {
    try {
      const cfg = await getAppConfig();
      res.json({
        integrationType: cfg.integrationType,
        adminEmailConfigured: Boolean(cfg.adminEmail)
      });
    } catch {
      res.json({
        integrationType: "google_sheets",
        adminEmailConfigured: false
      });
    }
  });
  app2.post("/api/auth/login", async (req, res) => {
    try {
      const usernameOrEmail = String(req.body?.usernameOrEmail || "").trim().toLowerCase();
      const password = String(req.body?.password || "");
      if (!usernameOrEmail || !password) {
        res.status(400).json({ success: false, message: "Username/Email and Password are required." });
        return;
      }
      await ensureAdminUserExists();
      const usersObj = await fbGet("app_users") || {};
      const allUsers = listStoredUsers(usersObj);
      const matched = allUsers.find(
        (u) => u.username.toLowerCase() === usernameOrEmail || u.email && u.email.toLowerCase() === usernameOrEmail
      );
      if (!matched) {
        res.status(401).json({ success: false, message: "Invalid User Name / Email or Password." });
        return;
      }
      const passwordOk = await verifyAndUpgradeUserPassword(matched, password);
      if (!passwordOk) {
        res.status(401).json({ success: false, message: "Invalid User Name / Email or Password." });
        return;
      }
      const role = matched.username.toLowerCase() === "admin" ? "admin" : matched.role || "lecturer";
      const effectiveStatus = matched.status || "active";
      if (effectiveStatus === "pending" && role !== "admin") {
        res.status(403).json({
          success: false,
          message: "Your account is waiting for Admin approval. An activation PIN will be emailed to you once approved."
        });
        return;
      }
      if (effectiveStatus === "approved_pending_pin" && role !== "admin") {
        const challengeToken = await signPinChallengeToken(matched.id);
        res.status(403).json({
          success: false,
          requiresActivationPin: true,
          username: matched.username,
          challengeToken,
          message: "Your account has been approved! Enter the 6-digit Activation PIN sent to your email to complete activation."
        });
        return;
      }
      if (effectiveStatus !== "active" && role !== "admin") {
        res.status(403).json({
          success: false,
          message: "Your account is currently deactivated. Contact the Administrator."
        });
        return;
      }
      const now = Date.now();
      const sessionId = `${toFirebaseKey(matched.username.toLowerCase())}_${now}`;
      const device = getDeviceLabel(String(req.headers["user-agent"] || ""));
      const newSession = {
        id: sessionId,
        adminName: matched.username,
        email: matched.email || "",
        device,
        date: new Date(now).toISOString().slice(0, 10),
        loginTime: now,
        lastActiveTime: now,
        status: "active",
        currentAction: "Dashboard"
      };
      await Promise.all([
        fbPut(`admin_logins/${sessionId}`, newSession),
        fbPatch(`app_users/${matched.dbKey}`, {
          lastLoginAt: now,
          ...matched.status ? {} : { status: "active" },
          ...matched.id ? { id: matched.id } : {}
        })
      ]);
      const token = await signSessionToken({
        uid: matched.id,
        username: matched.username,
        role,
        sid: sessionId,
        iat: now,
        exp: now + SESSION_TTL_MS
      });
      res.json({
        success: true,
        token,
        user: sanitizeUser({ ...matched, role }),
        session: newSession
      });
    } catch (err) {
      const formatted = formatAuthServerError(err, "Server error during sign in.");
      res.status(formatted.status).json({ success: false, message: formatted.message });
    }
  });
  app2.post("/api/auth/signup", async (req, res) => {
    try {
      const cleanUser = String(req.body?.username || "").trim();
      const cleanEmail = String(req.body?.email || "").trim().toLowerCase();
      const password = String(req.body?.password || "");
      if (!cleanUser || !cleanEmail || !password) {
        res.status(400).json({ success: false, message: "All fields are required." });
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        res.status(400).json({ success: false, message: "Please enter a valid email address." });
        return;
      }
      const passwordCheck = validateSignupPassword(password);
      if (!passwordCheck.valid) {
        res.status(400).json({
          success: false,
          message: passwordCheck.errorMessage || "Password does not meet security requirements."
        });
        return;
      }
      if (cleanUser.toLowerCase() === "admin") {
        res.status(409).json({ success: false, message: 'Username "admin" is reserved.' });
        return;
      }
      await ensureAdminUserExists();
      const usersObj = await fbGet("app_users") || {};
      const latestUsers = listStoredUsers(usersObj);
      if (latestUsers.some((u) => u.username.toLowerCase() === cleanUser.toLowerCase())) {
        res.status(409).json({ success: false, message: "Username already exists." });
        return;
      }
      if (latestUsers.some((u) => u.email && u.email.toLowerCase() === cleanEmail)) {
        res.status(409).json({ success: false, message: "Email address is already registered." });
        return;
      }
      const now = Date.now();
      const userId = `${toFirebaseKey(cleanUser.toLowerCase())}_${now.toString(36)}`;
      const newUser = {
        id: userId,
        username: cleanUser,
        email: cleanEmail,
        passwordHash: hashPassword(password),
        role: "lecturer",
        status: "pending",
        createdAt: now
      };
      await fbPut(`app_users/${userId}`, newUser);
      const cfg = await getAppConfig();
      const signupEmailRes = await dispatchSignupApprovalEmails({
        toEmail: cleanEmail,
        username: cleanUser,
        cfg
      });
      const notifId = `notif_${now}_${crypto.randomBytes(2).toString("hex")}`;
      const notif = {
        id: notifId,
        type: "user_signup",
        userId,
        username: cleanUser,
        email: cleanEmail,
        createdAt: now,
        read: false,
        emailSent: signupEmailRes.emailSent,
        message: `${cleanUser} (${cleanEmail}) signed up and is waiting for Admin approval.`
      };
      await fbPut(`admin_notifications/${notifId}`, notif).catch(() => {
      });
      if (!signupEmailRes.emailSent) {
        await createEmailDeliveryFailureAlert({
          context: "New Signup Notification Email",
          targetEmail: cleanEmail,
          username: cleanUser,
          userId,
          provider: signupEmailRes.provider,
          error: signupEmailRes.error
        });
      }
      res.json({
        success: true,
        message: "Account created! Once Admin approves your request, a 6-digit Activation PIN will be emailed to you to complete activation."
      });
    } catch (err) {
      const formatted = formatAuthServerError(err, "Failed to save user registration to cloud.");
      res.status(formatted.status).json({ success: false, message: formatted.message });
    }
  });
  app2.post("/api/auth/activate", async (req, res) => {
    try {
      const lookup = String(req.body?.usernameOrEmail || "").trim().toLowerCase();
      const rawPin = String(req.body?.pin || "").trim().replace(/\D/g, "");
      const challengeToken = String(req.body?.challengeToken || "").trim();
      if (!lookup || rawPin.length !== 6) {
        res.status(400).json({
          success: false,
          message: "Please enter your User Name or Email and the 6-digit Activation PIN."
        });
        return;
      }
      const usersObj = await fbGet("app_users") || {};
      const userRecord = listStoredUsers(usersObj).find(
        (u) => u.username.toLowerCase() === lookup || u.email && u.email.toLowerCase() === lookup
      );
      if (!userRecord || !userRecord.id) {
        res.status(404).json({
          success: false,
          message: "Account not found. Please sign up first or check your username/email."
        });
        return;
      }
      if (userRecord.status === "active") {
        res.json({
          success: true,
          message: `Account "${userRecord.username}" is already active. You can sign in below.`
        });
        return;
      }
      if (userRecord.status === "pending") {
        res.status(403).json({
          success: false,
          message: "Your account is still waiting for Admin approval. You will receive an email with your Activation PIN once approved."
        });
        return;
      }
      if ((userRecord.pinFailedAttempts || 0) >= MAX_PIN_FAILED_ATTEMPTS) {
        res.status(429).json({
          success: false,
          message: "Too many invalid PIN attempts. Ask the Administrator to resend a new Activation PIN."
        });
        return;
      }
      if (!userRecord.activationPin || !timingSafeStringEqual(rawPin, userRecord.activationPin)) {
        const nextAttempts = (userRecord.pinFailedAttempts || 0) + 1;
        if (nextAttempts >= MAX_PIN_FAILED_ATTEMPTS) {
          await fbPatch(`app_users/${userRecord.dbKey}`, {
            pinFailedAttempts: nextAttempts,
            activationPin: null,
            activationExpiresAt: null
          }).catch(() => {
          });
          res.status(429).json({
            success: false,
            message: "Too many invalid PIN attempts. This PIN has been invalidated; ask Admin to resend a new PIN."
          });
          return;
        }
        await fbPatch(`app_users/${userRecord.dbKey}`, {
          pinFailedAttempts: nextAttempts
        }).catch(() => {
        });
        res.status(403).json({
          success: false,
          message: "Invalid Activation PIN. Please check the 6-digit PIN sent to your email."
        });
        return;
      }
      if (userRecord.activationExpiresAt && Date.now() > userRecord.activationExpiresAt) {
        res.status(410).json({
          success: false,
          message: "This Activation PIN has expired. Please ask Admin to resend a new PIN."
        });
        return;
      }
      const now = Date.now();
      const challenge = challengeToken ? await verifyPinChallengeToken(challengeToken) : null;
      const canAutoSignIn = Boolean(challenge && challenge.uid === userRecord.id);
      await fbPatch(`app_users/${userRecord.dbKey}`, {
        status: "active",
        activatedAt: now,
        activationPin: null,
        activationExpiresAt: null,
        pinFailedAttempts: null,
        ...canAutoSignIn ? { lastLoginAt: now } : {}
      });
      await createActivationNotifications(userRecord, "email_pin").catch(() => {
      });
      if (canAutoSignIn) {
        const role = userRecord.username.toLowerCase() === "admin" ? "admin" : userRecord.role || "lecturer";
        const sessionId = `${toFirebaseKey(userRecord.username.toLowerCase())}_${now}`;
        const device = getDeviceLabel(String(req.headers["user-agent"] || ""));
        const newSession = {
          id: sessionId,
          adminName: userRecord.username,
          email: userRecord.email || "",
          device,
          date: new Date(now).toISOString().slice(0, 10),
          loginTime: now,
          lastActiveTime: now,
          status: "active",
          currentAction: "Dashboard"
        };
        await fbPut(`admin_logins/${sessionId}`, newSession);
        const token = await signSessionToken({
          uid: userRecord.id,
          username: userRecord.username,
          role,
          sid: sessionId,
          iat: now,
          exp: now + SESSION_TTL_MS
        });
        res.json({
          success: true,
          token,
          user: sanitizeUser({ ...userRecord, status: "active", activatedAt: now, role }),
          session: newSession,
          message: `Account "${userRecord.username}" activated and ready to use!`
        });
        return;
      }
      res.json({
        success: true,
        message: `Account "${userRecord.username}" activated! You can now sign in.`
      });
    } catch (err) {
      const formatted = formatAuthServerError(err, "Server error while verifying activation PIN.");
      res.status(formatted.status).json({ success: false, message: formatted.message });
    }
  });
  app2.post("/api/auth/forgot-password", async (req, res) => {
    try {
      const lookup = String(req.body?.usernameOrEmail || "").trim().toLowerCase();
      if (!lookup) {
        res.status(400).json({
          success: false,
          message: "Please enter your User Name or Email address."
        });
        return;
      }
      const genericMsg = "If an active account matches that username or email, a 6-digit password reset PIN has been sent.";
      await ensureAdminUserExists();
      const [usersObj, cfg] = await Promise.all([
        fbGet("app_users"),
        getAppConfig()
      ]);
      const allUsers = listStoredUsers(usersObj);
      let matched = allUsers.find(
        (u) => u.username.toLowerCase() === lookup || u.email && u.email.toLowerCase() === lookup
      );
      if (!matched && cfg.adminEmail && cfg.adminEmail.toLowerCase() === lookup) {
        matched = allUsers.find((u) => u.username.toLowerCase() === "admin" || u.role === "admin");
      }
      if (!matched || !matched.id) {
        res.json({ success: true, message: genericMsg });
        return;
      }
      const role = matched.username.toLowerCase() === "admin" ? "admin" : matched.role || "lecturer";
      const effectiveStatus = matched.status || "active";
      if (effectiveStatus !== "active" && role !== "admin") {
        res.json({ success: true, message: genericMsg });
        return;
      }
      const now = Date.now();
      if (matched.resetRequestedAt && now - matched.resetRequestedAt < RESET_RESEND_COOLDOWN_MS) {
        res.json({ success: true, message: genericMsg });
        return;
      }
      const targetEmail = (matched.email || (role === "admin" ? cfg.adminEmail : "")).trim();
      if (!targetEmail) {
        await createEmailDeliveryFailureAlert({
          context: "Password Reset Request",
          username: matched.username,
          userId: matched.id,
          error: role === "admin" ? "No email address or Admin Notification Email configured for admin recovery." : "No email address configured on this user account."
        }).catch(() => {
        });
        res.json({ success: true, message: genericMsg });
        return;
      }
      const pin = generateActivationPin();
      const resetExpiresAt = now + RESET_PIN_EXPIRY_MS;
      const expiresAtText = new Date(resetExpiresAt).toLocaleString();
      await fbPatch(`app_users/${matched.dbKey}`, {
        resetPinHash: hashResetPin(matched.id, pin),
        resetExpiresAt,
        resetRequestedAt: now,
        resetFailedAttempts: 0
      });
      const emailRes = await dispatchPasswordResetPinEmail({
        toEmail: targetEmail,
        username: matched.username,
        pin,
        expiresAtText,
        cfg
      });
      if (!emailRes.emailSent) {
        await createEmailDeliveryFailureAlert({
          context: "Password Reset PIN Email",
          targetEmail,
          username: matched.username,
          userId: matched.id,
          provider: emailRes.provider,
          error: emailRes.error
        }).catch(() => {
        });
      }
      res.json({ success: true, message: genericMsg });
    } catch (err) {
      const formatted = formatAuthServerError(err, "Server error while requesting password reset.");
      res.status(formatted.status).json({ success: false, message: formatted.message });
    }
  });
  app2.post("/api/auth/reset-password", async (req, res) => {
    try {
      const lookup = String(req.body?.usernameOrEmail || "").trim().toLowerCase();
      const rawPin = String(req.body?.pin || "").trim().replace(/\D/g, "");
      const newPassword = String(req.body?.newPassword || "");
      if (!lookup || rawPin.length !== 6) {
        res.status(400).json({
          success: false,
          message: "Please enter your User Name or Email and the 6-digit Reset PIN."
        });
        return;
      }
      const passwordCheck = validateSignupPassword(newPassword);
      if (!passwordCheck.valid) {
        res.status(400).json({
          success: false,
          message: passwordCheck.errorMessage || "Password does not meet security requirements."
        });
        return;
      }
      await ensureAdminUserExists();
      const [usersObj, cfg] = await Promise.all([
        fbGet("app_users"),
        getAppConfig()
      ]);
      const allUsers = listStoredUsers(usersObj);
      let matched = allUsers.find(
        (u) => u.username.toLowerCase() === lookup || u.email && u.email.toLowerCase() === lookup
      );
      if (!matched && cfg.adminEmail && cfg.adminEmail.toLowerCase() === lookup) {
        matched = allUsers.find((u) => u.username.toLowerCase() === "admin" || u.role === "admin");
      }
      if (!matched || !matched.id) {
        res.status(400).json({
          success: false,
          message: "Invalid or expired Password Reset PIN."
        });
        return;
      }
      const role = matched.username.toLowerCase() === "admin" ? "admin" : matched.role || "lecturer";
      const effectiveStatus = matched.status || "active";
      if (effectiveStatus !== "active" && role !== "admin") {
        res.status(403).json({
          success: false,
          message: "Your account is not active. Contact the Administrator."
        });
        return;
      }
      if ((matched.resetFailedAttempts || 0) >= MAX_RESET_FAILED_ATTEMPTS) {
        res.status(429).json({
          success: false,
          message: "Too many invalid reset PIN attempts. Please request a new reset PIN."
        });
        return;
      }
      if (!matched.resetPinHash) {
        res.status(400).json({
          success: false,
          message: "Invalid or expired Password Reset PIN. Please request a new reset PIN."
        });
        return;
      }
      const now = Date.now();
      if (matched.resetExpiresAt && now > matched.resetExpiresAt) {
        await fbPatch(`app_users/${matched.dbKey}`, {
          resetPinHash: null,
          resetExpiresAt: null,
          resetFailedAttempts: null
        }).catch(() => {
        });
        res.status(410).json({
          success: false,
          message: "This Password Reset PIN has expired. Please request a new PIN."
        });
        return;
      }
      const candidateHash = hashResetPin(matched.id, rawPin);
      if (!timingSafeStringEqual(candidateHash, matched.resetPinHash)) {
        const nextAttempts = (matched.resetFailedAttempts || 0) + 1;
        if (nextAttempts >= MAX_RESET_FAILED_ATTEMPTS) {
          await fbPatch(`app_users/${matched.dbKey}`, {
            resetFailedAttempts: nextAttempts,
            resetPinHash: null,
            resetExpiresAt: null
          }).catch(() => {
          });
          res.status(429).json({
            success: false,
            message: "Too many invalid reset PIN attempts. This PIN has been invalidated; please request a new one."
          });
          return;
        }
        await fbPatch(`app_users/${matched.dbKey}`, {
          resetFailedAttempts: nextAttempts
        }).catch(() => {
        });
        res.status(403).json({
          success: false,
          message: "Invalid Password Reset PIN. Please check the 6-digit PIN sent to your email."
        });
        return;
      }
      await fbPatch(`app_users/${matched.dbKey}`, {
        passwordHash: hashPassword(newPassword),
        password: null,
        resetPinHash: null,
        resetExpiresAt: null,
        resetRequestedAt: null,
        resetFailedAttempts: null
      });
      const sessionsObj = await fbGet("admin_logins") || {};
      const activeUserSessions = Object.values(sessionsObj).filter(
        (s) => s && s.id && s.adminName?.toLowerCase() === matched.username.toLowerCase() && s.status !== "signed_out"
      );
      if (activeUserSessions.length > 0) {
        await Promise.all(
          activeUserSessions.map(
            (s) => fbPatch(`admin_logins/${s.id}`, {
              status: "signed_out",
              lastActiveTime: now,
              currentAction: "Password Reset"
            }).catch(() => {
            })
          )
        );
      }
      await createUserSystemNotification({
        userId: matched.id,
        type: "system_update",
        title: "Password Updated",
        message: "Your password was reset via email PIN and all previous active sessions were signed out."
      }).catch(() => {
      });
      res.json({
        success: true,
        message: "Password updated! Please sign in with your new password."
      });
    } catch (err) {
      const formatted = formatAuthServerError(err, "Server error while resetting password.");
      res.status(formatted.status).json({ success: false, message: formatted.message });
    }
  });
  app2.post("/api/auth/delete-request", requireAuth, async (req, res) => {
    try {
      const auth = req.auth;
      const reason = String(req.body?.reason || "Requested via app").trim();
      const requestedLookup = String(req.body?.usernameOrEmail || "").trim().toLowerCase();
      const matched = await fbGet(`app_users/${auth.uid}`);
      if (!matched || !matched.id || matched.role === "admin" || matched.username.toLowerCase() === "admin") {
        res.status(403).json({
          success: false,
          message: "Only lecturer accounts can submit a deletion request."
        });
        return;
      }
      if (requestedLookup && requestedLookup !== matched.username.toLowerCase() && (!matched.email || requestedLookup !== matched.email.toLowerCase())) {
        res.status(403).json({
          success: false,
          message: "You can only request deletion for your own account."
        });
        return;
      }
      const now = Date.now();
      await fbPatch(`app_users/${matched.id}`, {
        deletionRequestedAt: now,
        deletionReason: reason
      });
      const cfg = await getAppConfig();
      const delEmailRes = await dispatchDeleteRequestEmail({
        username: matched.username,
        userEmail: matched.email || "",
        reason,
        cfg
      });
      const notifId = `delreq_${now}_${crypto.randomBytes(2).toString("hex")}`;
      const notif = {
        id: notifId,
        type: "delete_request",
        userId: matched.id,
        username: matched.username,
        email: matched.email || "",
        createdAt: now,
        read: false,
        emailSent: delEmailRes.emailSent,
        reason,
        message: `${matched.username} (${matched.email || "no email"}) requested account deletion: ${reason}`
      };
      await fbPut(`admin_notifications/${notifId}`, notif);
      if (!delEmailRes.emailSent) {
        await createEmailDeliveryFailureAlert({
          context: "Account Deletion Request Email",
          targetEmail: cfg.adminEmail || matched.email || "",
          username: matched.username,
          userId: matched.id,
          provider: delEmailRes.provider,
          error: delEmailRes.error
        });
      }
      res.json({
        success: true,
        message: "Deletion request sent to the Administrator for review."
      });
    } catch {
      res.status(500).json({ success: false, message: "Could not submit deletion request." });
    }
  });
  app2.post("/api/auth/logout", requireAuth, async (req, res) => {
    const sid = req.auth?.sid;
    if (sid) {
      await fbPatch(`admin_logins/${sid}`, {
        status: "signed_out",
        lastActiveTime: Date.now(),
        currentAction: "Signed Out"
      }).catch(() => {
      });
    }
    res.json({ success: true });
  });
  app2.post("/api/auth/heartbeat", requireAuth, async (req, res) => {
    const auth = req.auth;
    if (!auth.sid) {
      res.json({ success: true });
      return;
    }
    const now = Date.now();
    const currentAction = String(req.body?.currentAction || "Dashboard").slice(0, 60);
    await fbPatch(`admin_logins/${auth.sid}`, {
      id: auth.sid,
      adminName: auth.username,
      device: getDeviceLabel(String(req.headers["user-agent"] || "")),
      date: new Date(now).toISOString().slice(0, 10),
      lastActiveTime: now,
      status: "active",
      currentAction
    }).catch(() => {
    });
    res.json({ success: true });
  });
  app2.get("/api/student/roster", async (req, res) => {
    try {
      const authHeader = String(req.headers.authorization || "");
      const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
      let authedUser = null;
      if (bearerToken) {
        const verified = await verifySessionToken(bearerToken);
        if (verified) {
          const userRecord = await fbGet(`app_users/${verified.uid}`).catch(() => null);
          if (userRecord && userRecord.id && (userRecord.role === "admin" || userRecord.status === "active")) {
            authedUser = {
              ...verified,
              role: userRecord.username.toLowerCase() === "admin" ? "admin" : userRecord.role || verified.role
            };
          }
        }
      }
      const rawGrant = String(req.headers["x-checkin-token"] || req.query.checkinToken || "").trim();
      const grant = rawGrant ? await verifyCheckinGrant(rawGrant) : null;
      if (!authedUser && !grant) {
        res.status(401).json({ success: false, error: "Authentication or valid QR check-in token required." });
        return;
      }
      let courseName = String(req.query.course || "").trim();
      let courseId = String(req.query.courseId || "").trim();
      if (grant && !authedUser) {
        if (courseName && grant.courseName && normalizeCourseNameKey(courseName) !== normalizeCourseNameKey(grant.courseName) || courseId && grant.courseId && courseId !== grant.courseId) {
          res.status(403).json({ success: false, error: "Check-in token is not valid for this subject." });
          return;
        }
        courseName = grant.courseName || courseName;
        courseId = grant.courseId || courseId;
      } else if (authedUser && authedUser.role !== "admin") {
        const coursesObj = await fbGet("courses") || {};
        const access = resolveCourseAccess({ coursesObj, courseId, courseName, auth: authedUser });
        if (!access.allowed) {
          res.status(403).json({ success: false, error: "Access denied for this subject roster." });
          return;
        }
      }
      const students = await resolveRosterForCourse({ courseName, courseId });
      res.json({ success: true, students });
    } catch {
      res.status(500).json({ success: false, error: "Failed to load student roster." });
    }
  });
  app2.post("/api/qr/token", requireAuth, async (req, res) => {
    try {
      const auth = req.auth;
      const courseName = String(req.body?.courseName || "General Session").trim() || "General Session";
      const courseId = String(req.body?.courseId || "").trim();
      const week = String(req.body?.week || "W1").trim().toUpperCase() || "W1";
      const requirePin = typeof req.body?.requirePin === "boolean" ? req.body.requirePin : void 0;
      const rotatePin = Boolean(req.body?.rotatePin);
      const coursesObj = await fbGet("courses") || {};
      const access = resolveCourseAccess({ coursesObj, courseId, courseName, auth });
      if (!access.allowed) {
        res.status(403).json({ success: false, error: "You do not have permission to generate a QR for this subject." });
        return;
      }
      const resolvedCourseName = access.course?.courseName || courseName;
      const resolvedCourseId = access.course?.id || courseId;
      const sessionKey = buildPinSessionKey({
        courseName: resolvedCourseName,
        courseId: resolvedCourseId,
        matchedCourse: access.course
      });
      const pinConfig = await getOrUpdatePinConfig({
        sessionKey,
        courseName: resolvedCourseName,
        week,
        requirePin,
        rotatePin,
        updatedBy: auth.username
      });
      const iat = Date.now();
      pruneUsedScanNonces(iat);
      const exp = iat + QR_TOKEN_VALIDITY_MS;
      const qrToken = await signQrToken({
        v: 1,
        iat,
        exp,
        courseName: resolvedCourseName,
        courseId: resolvedCourseId,
        week,
        sessionKey,
        pinRequired: pinConfig.enabled
      });
      res.json({
        success: true,
        qrToken,
        iat,
        exp,
        ttlMs: QR_TOKEN_VALIDITY_MS,
        pinRequired: pinConfig.enabled,
        pin: pinConfig.pin
      });
    } catch {
      res.status(500).json({ success: false, message: "Failed to issue signed QR token." });
    }
  });
  app2.post("/api/qr/verify", async (req, res) => {
    try {
      const sig = String(req.body?.sig || "").trim();
      if (!sig) {
        res.status(403).json({
          success: false,
          code: "QR_UNVERIFIED",
          message: "Unverified or outdated QR code. Please scan the live attendance QR code in class."
        });
        return;
      }
      const payload = await verifyQrToken(sig);
      if (!payload) {
        res.status(403).json({
          success: false,
          code: "QR_INVALID",
          message: "Invalid or tampered QR code. Please scan the live QR code in class."
        });
        return;
      }
      const now = Date.now();
      if (now > payload.exp) {
        res.status(410).json({
          success: false,
          code: "QR_EXPIRED",
          message: "QR Code expired (15s limit). Scan the newest live code in class."
        });
        return;
      }
      const latestPinConfig = await readPinConfig(payload.sessionKey);
      const pinRequired = latestPinConfig ? latestPinConfig.enabled : payload.pinRequired;
      const grantExp = now + CHECKIN_GRANT_VALIDITY_MS;
      const checkinToken = await signCheckinGrant({
        v: 1,
        nonce: crypto.randomBytes(12).toString("hex"),
        iat: now,
        exp: grantExp,
        courseName: payload.courseName,
        courseId: payload.courseId,
        week: payload.week,
        sessionKey: payload.sessionKey,
        pinRequired
      });
      res.json({
        success: true,
        checkinToken,
        expiresAt: grantExp,
        pinRequired,
        courseName: payload.courseName,
        courseId: payload.courseId,
        week: payload.week
      });
    } catch {
      res.status(500).json({ success: false, message: "Could not verify QR code. Please try again." });
    }
  });
  app2.post("/api/student/checkin", async (req, res) => {
    try {
      const name = String(req.body?.name || "").trim();
      const studentId = String(req.body?.studentId || "").trim();
      const status = String(req.body?.status || "P").trim().toUpperCase();
      let courseName = String(req.body?.courseName || "General Session").trim();
      let courseId = String(req.body?.courseId || "").trim();
      let week = String(req.body?.week || "W1").trim().toUpperCase();
      if (!name || !studentId) {
        res.status(400).json({ success: false, message: "Name and Student ID are required." });
        return;
      }
      let kioskAuth = null;
      const authHeader = String(req.headers.authorization || "");
      if (authHeader.startsWith("Bearer ")) {
        const bearerToken = authHeader.slice(7).trim();
        const authPayload = bearerToken ? await verifySessionToken(bearerToken) : null;
        if (authPayload) {
          const userRecord = await fbGet(`app_users/${authPayload.uid}`).catch(() => null);
          if (userRecord && userRecord.id && (userRecord.role === "admin" || userRecord.status === "active")) {
            kioskAuth = {
              ...authPayload,
              role: userRecord.username.toLowerCase() === "admin" ? "admin" : userRecord.role || authPayload.role
            };
          }
        }
      }
      const coursesObj = await fbGet("courses") || {};
      let verifiedGrant = null;
      if (!kioskAuth) {
        const checkinToken = String(req.body?.checkinToken || "").trim();
        verifiedGrant = await verifyCheckinGrant(checkinToken);
        if (!verifiedGrant) {
          res.status(401).json({
            success: false,
            code: "GRANT_EXPIRED",
            message: "QR verification expired. Please scan the live QR code again."
          });
          return;
        }
        const now = Date.now();
        pruneUsedScanNonces(now);
        const alreadyUsedMem = usedScanNonces.has(verifiedGrant.nonce);
        const alreadyUsedDb = !alreadyUsedMem ? await fbGet(`used_qr_nonces/${verifiedGrant.nonce}`).catch(() => null) : 1;
        if (alreadyUsedMem || alreadyUsedDb) {
          res.status(409).json({
            success: false,
            code: "QR_ALREADY_USED",
            message: "This QR scan has already been used. Please scan the live QR code again."
          });
          return;
        }
        courseName = verifiedGrant.courseName || courseName;
        courseId = verifiedGrant.courseId || courseId;
        week = verifiedGrant.week || week;
        const pinConfig = await readPinConfig(verifiedGrant.sessionKey);
        const pinMustMatch = pinConfig ? pinConfig.enabled : verifiedGrant.pinRequired;
        if (pinMustMatch) {
          const submittedPin = String(req.body?.pin || "").trim();
          if (!submittedPin || !pinConfig || !timingSafeStringEqual(submittedPin, pinConfig.pin)) {
            res.status(403).json({
              success: false,
              code: "INVALID_PIN",
              message: "Invalid Classroom PIN. Ask your lecturer for the current 4-digit PIN."
            });
            return;
          }
        }
      } else if (kioskAuth.role !== "admin") {
        const access = resolveCourseAccess({ coursesObj, courseId, courseName, auth: kioskAuth });
        if (!access.allowed) {
          res.status(403).json({ success: false, message: "Access denied for this subject." });
          return;
        }
      }
      const matchedCourses = findCoursesMatching(coursesObj, { courseId, courseName });
      const resolvedCourse = (kioskAuth ? matchedCourses.find((c) => canAccessCourse(c, kioskAuth)) : null) || matchedCourses[0] || null;
      const roster = await resolveRosterForCourse({ courseName, courseId: resolvedCourse?.id || courseId });
      const normalizeRegName = (val) => val.trim().replace(/\s+/g, " ").toUpperCase();
      const normalizeRegId = (val) => val.trim().replace(/\s+/g, "").toUpperCase();
      const cleanSubmittedName = normalizeRegName(name);
      const cleanSubmittedId = normalizeRegId(studentId);
      const nameMatches = roster.filter((s) => normalizeRegName(s.name) === cleanSubmittedName);
      if (nameMatches.length === 0) {
        res.status(403).json({
          success: false,
          message: "Your name is not registered in the system. Please consult with your Lecturer."
        });
        return;
      }
      if (!nameMatches.some((s) => normalizeRegId(s.id) === cleanSubmittedId)) {
        res.status(403).json({
          success: false,
          message: "Warning: Student ID does not match the registered student name."
        });
        return;
      }
      const sessionPath = verifiedGrant?.sessionKey ? verifiedGrant.sessionKey : buildLiveSessionPath({ courseName, courseId, matchedCourse: resolvedCourse });
      const studentKey = toStudentFirebaseKey(cleanSubmittedId);
      const liveSessionMap = await fbGet(`live_sessions/${sessionPath}`);
      const existingData = liveSessionMap && typeof liveSessionMap === "object" ? liveSessionMap[studentKey] || Object.values(liveSessionMap).find(
        (s) => s && normalizeStudentId(s.studentId || "") === cleanSubmittedId
      ) : null;
      if (existingData && existingData.status === "P" && status === "P" && (existingData.week || "W1").trim().toUpperCase() === week) {
        res.status(409).json({ success: false, message: "You have already checked in for this session." });
        return;
      }
      const resolvedCourseId = resolvedCourse?.id || courseId || void 0;
      const timestamp = Date.now();
      const normalizedEmail = req.body?.email ? String(req.body.email).trim() : `${cleanSubmittedId}@student.edu.my`;
      const studentData = {
        name: cleanSubmittedName,
        studentId: cleanSubmittedId,
        email: normalizedEmail || `${cleanSubmittedId}@student.edu.my`,
        status,
        timestamp,
        courseName,
        ...resolvedCourseId ? { courseId: resolvedCourseId } : {},
        week
      };
      const pendingKey = toFirebaseKey(`${resolvedCourseId || toCourseKey(courseName)}__${studentKey}`);
      await Promise.all([
        fbPut(`pending/${pendingKey}`, studentData),
        fbPut(`live_sessions/${sessionPath}/${studentKey}`, studentData),
        upsertAttendanceHistory([studentData])
      ]);
      if (verifiedGrant) {
        usedScanNonces.set(verifiedGrant.nonce, verifiedGrant.exp);
        void fbPut(`used_qr_nonces/${verifiedGrant.nonce}`, verifiedGrant.exp).catch(() => {
        });
      }
      const cfg = await getAppConfig();
      if (cfg.integrationType === "google_sheets" && cfg.scriptUrl) {
        void postToGoogleScript(cfg.scriptUrl, formatCloudPayload(studentData, week)).then((r) => {
          if (r.ok && !r.json?.error && r.json?.success !== false) {
            return fbDelete(`pending/${pendingKey}`).catch(() => {
            });
          }
        }).catch(() => {
        });
      }
      res.json({ success: true, message: "Record submitted successfully.", record: studentData });
    } catch {
      res.status(500).json({ success: false, message: "Connection lost. Please try again." });
    }
  });
  app2.get("/api/dashboard/sync", requireAuth, async (req, res) => {
    try {
      const auth = req.auth;
      const [cfg, coursesObj, userPref, historyRaw, usersObj, sessionsObj, notifsObj, userNotifsObj] = await Promise.all([
        getAppConfig(),
        fbGet("courses"),
        fbGet(`user_preferences/${auth.uid}`),
        fbGet("attendance_history"),
        fbGet("app_users"),
        auth.role === "admin" ? fbGet("admin_logins") : Promise.resolve(null),
        auth.role === "admin" ? fbGet("admin_notifications") : Promise.resolve(null),
        fbGet(`user_notifications/${auth.uid}`)
      ]);
      const allCourses = coursesObj && typeof coursesObj === "object" ? Object.values(coursesObj).filter((c) => c && c.id && c.courseName).map(normalizeCourse) : [];
      const scopedCourses = allCourses.filter((c) => canAccessCourse(c, auth)).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      const ownedCourseIds = new Set(scopedCourses.map((c) => c.id));
      const ownedCourseNames = new Set(scopedCourses.map((c) => normalizeCourseNameKey(c.courseName)));
      const allHistory = Array.isArray(historyRaw) ? historyRaw.filter((h) => h && h.studentId && h.timestamp) : historyRaw && typeof historyRaw === "object" ? Object.values(historyRaw).filter((h) => h && h.studentId && h.timestamp) : [];
      const scopedHistory = (auth.role === "admin" ? allHistory : allHistory.filter(
        (h) => h.courseId ? ownedCourseIds.has(h.courseId) : ownedCourseNames.has(normalizeCourseNameKey(h.courseName || ""))
      )).sort((a, b) => b.timestamp - a.timestamp);
      const allUserRecords = listStoredUsers(usersObj);
      const coLecturerOptions = allUserRecords.filter((u) => (u.status || "active") === "active").map((u) => ({
        id: u.id,
        username: u.username,
        role: u.username.toLowerCase() === "admin" ? "admin" : u.role || "lecturer"
      })).sort((a, b) => {
        if (a.role === "admin" && b.role !== "admin") return -1;
        if (b.role === "admin" && a.role !== "admin") return 1;
        return a.username.localeCompare(b.username);
      });
      const sanitizedUsers = auth.role === "admin" ? allUserRecords.map(sanitizeUser).sort((a, b) => {
        if (a.role === "admin") return -1;
        if (b.role === "admin") return 1;
        return (b.createdAt || 0) - (a.createdAt || 0);
      }) : [];
      const sessions = auth.role === "admin" && sessionsObj && typeof sessionsObj === "object" ? Object.values(sessionsObj).filter((s) => s && s.id && s.adminName).sort((a, b) => (b.lastActiveTime || b.loginTime || 0) - (a.lastActiveTime || a.loginTime || 0)) : [];
      const notifications = auth.role === "admin" && notifsObj && typeof notifsObj === "object" ? Object.values(notifsObj).filter((n) => n && n.id).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)) : [];
      const userNotifications = userNotifsObj && typeof userNotifsObj === "object" ? Object.values(userNotifsObj).filter((n) => n && n.id).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)) : [];
      res.json({
        success: true,
        user: { id: auth.uid, username: auth.username, role: auth.role },
        config: {
          scriptUrl: auth.role === "admin" ? cfg.scriptUrl : "",
          scriptConfigured: Boolean(
            cfg.scriptUrl && cfg.scriptUrl !== DEFAULT_SCRIPT_URL && !cfg.scriptUrl.trim().endsWith("/dev")
          ),
          scriptSecret: auth.role === "admin" && !cfg.scriptSecretFromEnv ? cfg.scriptSecret : "",
          scriptSecretConfigured: Boolean(cfg.scriptSecret),
          scriptSecretFromEnv: auth.role === "admin" ? cfg.scriptSecretFromEnv : false,
          databaseUrl: auth.role === "admin" ? getFirebaseDbUrl() : "",
          integrationType: cfg.integrationType,
          adminEmail: auth.role === "admin" ? cfg.adminEmail : "",
          emailDelivery: auth.role === "admin" ? getEmailDeliveryStatus(cfg.scriptUrl) : void 0
        },
        courses: scopedCourses,
        userPref: userPref || null,
        history: scopedHistory,
        users: sanitizedUsers,
        coLecturerOptions,
        sessions,
        notifications,
        userNotifications
      });
    } catch {
      res.status(500).json({ success: false, error: "Failed to sync dashboard state." });
    }
  });
  app2.get("/api/courses/sheet-tabs", requireAuth, async (req, res) => {
    try {
      const auth = req.auth;
      const courseQuery = String(req.query.course || "").trim();
      const cfg = await getAppConfig();
      if (cfg.integrationType !== "google_sheets") {
        res.status(400).json({ success: false, error: "Google Sheets integration is not active." });
        return;
      }
      if (!cfg.scriptUrl || cfg.scriptUrl === DEFAULT_SCRIPT_URL) {
        res.status(400).json({ success: false, error: "Configure Google Sheets Apps Script URL in Settings first." });
        return;
      }
      if (cfg.scriptUrl.trim().endsWith("/dev")) {
        res.status(400).json({ success: false, error: "Apps Script URL uses /dev. Deploy as Web App and paste the /exec URL in Settings." });
        return;
      }
      const sheetUrl = buildGoogleScriptUrl(
        cfg.scriptUrl,
        {
          action: "getCourse",
          course: courseQuery || void 0,
          t: String(Date.now())
        },
        cfg.scriptSecret
      );
      const sheetRes = await fetch(sheetUrl, { method: "GET", redirect: "follow" });
      const rawText = await sheetRes.text();
      if (sheetRes.status === 404 || rawText.trim().startsWith("<")) {
        res.status(502).json({
          success: false,
          error: sheetRes.status === 404 ? "Apps Script URL returned 404. Paste your deployed /exec URL in Settings." : 'Apps Script returned HTML instead of JSON. Set Web App access to "Anyone" and use the /exec URL.'
        });
        return;
      }
      let data;
      try {
        data = JSON.parse(rawText);
      } catch {
        res.status(502).json({ success: false, error: "Apps Script returned invalid JSON." });
        return;
      }
      if (!data || !data.success) {
        res.status(502).json({
          success: false,
          error: data?.error ? `Sheet error: ${data.error}` : "Could not read Course Name from Google Sheet."
        });
        return;
      }
      const [coursesObj, usersObj] = await Promise.all([
        fbGet("courses"),
        fbGet("app_users")
      ]);
      const allCourses = coursesObj && typeof coursesObj === "object" ? Object.values(coursesObj).filter((c) => c && c.id).map(normalizeCourse) : [];
      const allUsers = usersObj && typeof usersObj === "object" ? Object.values(usersObj).filter((u) => u && u.id) : [];
      const authUser = allUsers.find((u) => u.id === auth.uid) || null;
      const rawSheets = Array.isArray(data.sheets) ? data.sheets : [];
      const seenCourses = /* @__PURE__ */ new Set();
      const sanitizedSheets = [];
      const updatedCourses = [];
      const now = Date.now();
      for (const tab of rawSheets) {
        if (!tab) continue;
        const cleanCourse = String(tab.courseName || "").trim();
        if (!cleanCourse) continue;
        const key = normalizeCourseNameKey(cleanCourse);
        if (seenCourses.has(key)) continue;
        seenCourses.add(key);
        const hasStudentsArray = Array.isArray(tab.students);
        const normalizedStudents = normalizeStudentsList(tab.students);
        const cleanSheetName = String(tab.sheetName || "").trim();
        const rawOwnerStr = typeof tab.owner === "string" ? tab.owner.trim() : "";
        const ownerExplicit = Boolean(tab.ownerExplicit);
        const matchingCourses = allCourses.filter((c) => isSameCourse(c, cleanCourse));
        const directMine = matchingCourses.find((c) => isDirectOwnerOrShared(c, auth));
        const otherCourse = matchingCourses.find((c) => !isDirectOwnerOrShared(c, auth));
        const sheetOwner = resolveSheetTabOwner(rawOwnerStr, ownerExplicit, allUsers);
        const ownedByOtherInSheet = auth.role !== "admin" && !directMine && (Boolean(otherCourse) || sheetOwner.recognized && !doesAuthMatchSheetOwner(sheetOwner.tokens, auth, authUser));
        if (hasStudentsArray && !ownedByOtherInSheet && matchingCourses.length > 0) {
          const accessibleMatches = matchingCourses.filter((c) => canAccessCourse(c, auth));
          for (const existingCourse of accessibleMatches) {
            if (sheetOwner.recognized && auth.role !== "admin" && !doesAuthMatchSheetOwner(sheetOwner.tokens, auth, authUser) && !isDirectOwnerOrShared(existingCourse, auth)) {
              continue;
            }
            const currentStudents = normalizeStudentsList(existingCourse.students);
            const studentsChanged = !areStudentRostersEqual(currentStudents, normalizedStudents);
            const sheetNameChanged = Boolean(
              cleanSheetName && cleanSheetName !== String(existingCourse.sheetName || "").trim()
            );
            if (studentsChanged || sheetNameChanged) {
              const updatedCourse = {
                ...existingCourse,
                sheetName: cleanSheetName || existingCourse.sheetName || "",
                students: normalizedStudents,
                updatedAt: now
              };
              await fbPut(`courses/${updatedCourse.id}`, updatedCourse);
              updatedCourses.push(updatedCourse);
            }
          }
        }
        if (auth.role === "admin") {
          sanitizedSheets.push({
            sheetName: cleanSheetName,
            courseName: cleanCourse,
            owner: rawOwnerStr,
            ownerExplicit,
            students: normalizedStudents
          });
          continue;
        }
        if (ownedByOtherInSheet) {
          const safeOwnerDisplay = sheetOwner.matchedUsers.length > 0 ? sheetOwner.matchedUsers.map((u) => u.username).join(", ") : otherCourse?.createdBy || "Another Lecturer";
          sanitizedSheets.push({
            sheetName: cleanSheetName,
            courseName: cleanCourse,
            owner: safeOwnerDisplay,
            ownerExplicit: true,
            students: []
          });
        } else {
          sanitizedSheets.push({
            sheetName: cleanSheetName,
            courseName: cleanCourse,
            owner: rawOwnerStr,
            ownerExplicit,
            students: normalizedStudents
          });
        }
      }
      res.json({ success: true, sheets: sanitizedSheets, updatedCourses });
    } catch {
      res.status(502).json({
        success: false,
        error: "Could not read Google Sheet. Check Settings \u2192 Apps Script URL."
      });
    }
  });
  app2.patch("/api/user/notifications/:id/read", requireAuth, async (req, res) => {
    const auth = req.auth;
    const notifId = String(req.params.id || "").trim();
    if (!notifId) {
      res.status(400).json({ success: false, error: "Notification ID is required." });
      return;
    }
    await fbPatch(`user_notifications/${auth.uid}/${notifId}`, { read: true });
    res.json({ success: true });
  });
  app2.post("/api/user/notifications/read-all", requireAuth, async (req, res) => {
    const auth = req.auth;
    const notifsObj = await fbGet(`user_notifications/${auth.uid}`) || {};
    await Promise.all(
      Object.values(notifsObj).filter((n) => n && !n.read).map((n) => fbPatch(`user_notifications/${auth.uid}/${n.id}`, { read: true }))
    );
    res.json({ success: true });
  });
  app2.delete("/api/user/notifications", requireAuth, async (req, res) => {
    const auth = req.auth;
    await fbDelete(`user_notifications/${auth.uid}`);
    res.json({ success: true });
  });
  app2.put("/api/user/preferences", requireAuth, async (req, res) => {
    const auth = req.auth;
    const activeCourse = String(req.body?.activeCourse || "").trim();
    const selectedWeek = String(req.body?.selectedWeek || "W1").trim();
    await fbPatch(`user_preferences/${auth.uid}`, {
      activeCourse,
      selectedWeek,
      updatedAt: Date.now()
    });
    res.json({ success: true });
  });
  app2.post("/api/courses", requireAuth, async (req, res) => {
    try {
      const auth = req.auth;
      const cleanName = String(req.body?.courseName || "").trim();
      const initialStudents = Array.isArray(req.body?.students) ? req.body.students : [];
      const selectedWeek = String(req.body?.selectedWeek || "W1").trim() || "W1";
      const requestedOwnerId = auth.role === "admin" && typeof req.body?.ownerId === "string" ? req.body.ownerId.trim() : "";
      if (!cleanName) {
        res.status(400).json({ success: false, error: "Course name is required." });
        return;
      }
      const [coursesObj, usersObj] = await Promise.all([
        fbGet("courses"),
        fbGet("app_users")
      ]);
      const allCourses = coursesObj && typeof coursesObj === "object" ? Object.values(coursesObj).filter((c) => c && c.id).map(normalizeCourse) : [];
      const allUsers = usersObj && typeof usersObj === "object" ? Object.values(usersObj).filter((u) => u && u.id) : [];
      const requestedOwnerUser = requestedOwnerId ? allUsers.find((u) => u.id === requestedOwnerId) || null : null;
      let targetOwnerId = auth.uid;
      let targetCreatedBy = auth.username;
      if (auth.role === "admin" && requestedOwnerUser) {
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
        coursesObj && coursesObj[baseId] && !canAccessCourse(normalizeCourse(coursesObj[baseId]), auth)
      );
      const finalId = idTakenByOther ? `${baseId}__${toFirebaseKey(targetOwnerId)}` : baseId;
      const now = Date.now();
      const newCourse = {
        id: finalId,
        courseName: cleanName,
        selectedWeek,
        students: initialStudents,
        ownerId: targetOwnerId,
        createdBy: targetCreatedBy,
        sharedWith: targetSharedWith,
        createdAt: now,
        updatedAt: now
      };
      await fbPut(`courses/${finalId}`, newCourse);
      await fbPatch(`user_preferences/${auth.uid}`, {
        activeCourse: newCourse.courseName,
        selectedWeek: newCourse.selectedWeek,
        updatedAt: now
      });
      const notifTasks = [];
      const assignedToLecturer = auth.role === "admin" && Boolean(requestedOwnerUser) && targetOwnerId !== auth.uid;
      if (assignedToLecturer) {
        notifTasks.push(
          createUserSystemNotification({
            userId: targetOwnerId,
            type: "course_assigned",
            title: "Subject Assigned",
            courseName: newCourse.courseName,
            message: `Administrator (${auth.username}) assigned the subject "${newCourse.courseName}" to you.`
          })
        );
      }
      const addedCoNames = [];
      for (const coId of targetSharedWith) {
        const coUser = allUsers.find((u) => u.id === coId);
        if (coUser) addedCoNames.push(coUser.username);
        if (coId !== auth.uid) {
          notifTasks.push(
            createUserSystemNotification({
              userId: coId,
              type: "co_lecturer_added",
              title: "Co-Lecturer Added",
              courseName: newCourse.courseName,
              message: `${auth.username} added you as a co-lecturer for "${newCourse.courseName}".`
            })
          );
        }
      }
      if (assignedToLecturer || addedCoNames.length > 0) {
        const parts = [];
        if (assignedToLecturer) parts.push(`owner assigned to ${targetCreatedBy}`);
        if (addedCoNames.length > 0) parts.push(`co-lecturers: ${addedCoNames.join(", ")}`);
        notifTasks.push(
          createAdminAlertNotification({
            type: "course_ownership_changed",
            userId: auth.uid,
            username: auth.username,
            courseName: newCourse.courseName,
            message: `Subject "${newCourse.courseName}" created by ${auth.username} (${parts.join("; ")}).`
          })
        );
      }
      if (notifTasks.length > 0) {
        await Promise.all(notifTasks).catch(() => {
        });
      }
      res.json({ success: true, course: newCourse });
    } catch {
      res.status(500).json({ success: false, error: "Failed to create course." });
    }
  });
  app2.put("/api/courses/:id", requireAuth, async (req, res) => {
    try {
      const auth = req.auth;
      const courseId = String(req.params.id || "").trim();
      if (!courseId) {
        res.status(400).json({ success: false, error: "Course ID is required." });
        return;
      }
      const existing = await fbGet(`courses/${courseId}`);
      if (existing) {
        const normalized = normalizeCourse(existing);
        if (!canAccessCourse(normalized, auth)) {
          res.status(403).json({ success: false, error: "You do not have permission to edit this subject." });
          return;
        }
        const updated = {
          ...normalized,
          courseName: typeof req.body?.courseName === "string" && req.body.courseName.trim() ? req.body.courseName.trim() : normalized.courseName,
          selectedWeek: typeof req.body?.selectedWeek === "string" && req.body.selectedWeek.trim() ? req.body.selectedWeek.trim() : normalized.selectedWeek,
          students: Array.isArray(req.body?.students) ? req.body.students : normalized.students,
          sheetName: typeof req.body?.sheetName === "string" ? req.body.sheetName : normalized.sheetName,
          ownerId: normalized.ownerId || auth.uid,
          createdBy: normalized.createdBy || auth.username,
          updatedAt: Date.now()
        };
        await fbPut(`courses/${courseId}`, updated);
        res.json({ success: true, course: updated });
        return;
      }
      const cleanName = String(req.body?.courseName || "").trim();
      if (!cleanName) {
        res.status(404).json({ success: false, error: "Course not found." });
        return;
      }
      const now = Date.now();
      const created = {
        id: courseId,
        courseName: cleanName,
        selectedWeek: String(req.body?.selectedWeek || "W1"),
        students: Array.isArray(req.body?.students) ? req.body.students : [],
        ownerId: auth.uid,
        createdBy: auth.username,
        sharedWith: [],
        createdAt: now,
        updatedAt: now
      };
      await fbPut(`courses/${courseId}`, created);
      res.json({ success: true, course: created });
    } catch {
      res.status(500).json({ success: false, error: "Failed to update course." });
    }
  });
  app2.delete("/api/courses/:id", requireAuth, async (req, res) => {
    try {
      const auth = req.auth;
      const courseId = String(req.params.id || "").trim();
      const existing = await fbGet(`courses/${courseId}`);
      if (!existing) {
        res.json({ success: true });
        return;
      }
      if (!canAccessCourse(normalizeCourse(existing), auth)) {
        res.status(403).json({ success: false, error: "You do not have permission to delete this subject." });
        return;
      }
      await fbDelete(`courses/${courseId}`);
      res.json({ success: true });
    } catch {
      res.status(500).json({ success: false, error: "Failed to delete course." });
    }
  });
  app2.post("/api/courses/check-tab-ownership", requireAuth, async (req, res) => {
    try {
      const auth = req.auth;
      const tabs = Array.isArray(req.body?.tabs) ? req.body.tabs : [];
      if (tabs.length === 0) {
        res.json({ success: true, results: [] });
        return;
      }
      const [coursesObj, usersObj] = await Promise.all([
        fbGet("courses"),
        fbGet("app_users")
      ]);
      const allCourses = coursesObj && typeof coursesObj === "object" ? Object.values(coursesObj).filter((c) => c && c.id).map(normalizeCourse) : [];
      const allUsers = usersObj && typeof usersObj === "object" ? Object.values(usersObj).filter((u) => u && u.id) : [];
      const authUser = allUsers.find((u) => u.id === auth.uid) || null;
      const results = [];
      const seenCheckKeys = /* @__PURE__ */ new Set();
      for (const tab of tabs) {
        const cleanName = String(tab?.courseName || "").trim();
        if (!cleanName) continue;
        const normKey = normalizeCourseNameKey(cleanName);
        if (seenCheckKeys.has(normKey)) continue;
        seenCheckKeys.add(normKey);
        const matchingCourses = allCourses.filter((c) => isSameCourse(c, cleanName));
        const directMine = matchingCourses.find((c) => isDirectOwnerOrShared(c, auth));
        const otherCourse = matchingCourses.find((c) => !isDirectOwnerOrShared(c, auth));
        const sheetOwner = resolveSheetTabOwner(tab?.owner, Boolean(tab?.ownerExplicit), allUsers);
        const isCoLecturerOnMine = Boolean(
          directMine && directMine.ownerId && directMine.ownerId !== auth.uid && Array.isArray(directMine.sharedWith) && (directMine.sharedWith.includes(auth.uid) || directMine.sharedWith.some((entry) => entry.toLowerCase() === auth.username.toLowerCase()))
        );
        if (directMine) {
          results.push({
            courseName: cleanName,
            status: "mine",
            alreadySynced: true,
            ownerId: directMine.ownerId || auth.uid,
            ownerLabel: directMine.createdBy || auth.username,
            sharedWith: directMine.sharedWith || [],
            sharedBy: isCoLecturerOnMine ? directMine.createdBy || "Owner" : void 0
          });
          continue;
        }
        if (otherCourse) {
          const ownerName = otherCourse.createdBy || "another lecturer";
          results.push({
            courseName: cleanName,
            status: auth.role === "admin" ? "other_managed" : "other",
            alreadySynced: true,
            ownerId: auth.role === "admin" ? otherCourse.ownerId : void 0,
            ownerLabel: ownerName,
            sharedWith: auth.role === "admin" ? otherCourse.sharedWith || [] : void 0,
            reason: auth.role === "admin" ? `Already synced (Owner: ${ownerName})` : `Owned by ${ownerName}`
          });
          continue;
        }
        if (sheetOwner.recognized) {
          const matchesCaller = doesAuthMatchSheetOwner(sheetOwner.tokens, auth, authUser);
          if (!matchesCaller) {
            if (auth.role !== "admin") {
              results.push({
                courseName: cleanName,
                status: "other",
                alreadySynced: false,
                ownerLabel: sheetOwner.displayLabel,
                reason: `Assigned to ${sheetOwner.displayLabel} in Google Sheet`
              });
            } else {
              results.push({
                courseName: cleanName,
                status: "other_managed",
                alreadySynced: false,
                ownerId: sheetOwner.matchedUsers[0]?.id,
                ownerLabel: sheetOwner.displayLabel,
                sharedWith: [],
                reason: `Assigned to ${sheetOwner.displayLabel} in Google Sheet`
              });
            }
          } else {
            results.push({
              courseName: cleanName,
              status: "assigned_to_me",
              alreadySynced: false,
              ownerId: auth.uid,
              ownerLabel: auth.username,
              sharedWith: []
            });
          }
          continue;
        }
        results.push({
          courseName: cleanName,
          status: "unclaimed",
          alreadySynced: false
        });
      }
      res.json({ success: true, results });
    } catch {
      res.status(500).json({ success: false, error: "Failed to check sheet tab ownership." });
    }
  });
  app2.post("/api/courses/sync-tabs", requireAuth, async (req, res) => {
    try {
      const auth = req.auth;
      const tabs = Array.isArray(req.body?.tabs) ? req.body.tabs : [];
      if (tabs.length === 0) {
        res.json({ success: true, courses: [], skippedCourses: [] });
        return;
      }
      const [coursesObj, usersObj] = await Promise.all([
        fbGet("courses"),
        fbGet("app_users")
      ]);
      const allCourses = coursesObj && typeof coursesObj === "object" ? Object.values(coursesObj).filter((c) => c && c.id).map(normalizeCourse) : [];
      const allUsers = usersObj && typeof usersObj === "object" ? Object.values(usersObj).filter((u) => u && u.id) : [];
      const authUser = allUsers.find((u) => u.id === auth.uid) || null;
      const allowUpdateExisting = Boolean(req.body?.allowUpdateExisting);
      const now = Date.now();
      const synced = [];
      const skippedCourses = [];
      const seenSyncKeys = /* @__PURE__ */ new Set();
      const mutableCoursesMap = coursesObj && typeof coursesObj === "object" ? { ...coursesObj } : {};
      for (const tab of tabs) {
        const cleanName = String(tab.courseName || "").trim();
        if (!cleanName) continue;
        const normKey = normalizeCourseNameKey(cleanName);
        if (seenSyncKeys.has(normKey)) continue;
        seenSyncKeys.add(normKey);
        const students = normalizeStudentsList(tab.students);
        const sheetOwner = resolveSheetTabOwner(tab.owner, Boolean(tab.ownerExplicit), allUsers);
        const existingCourse = allCourses.find((c) => isSameCourse(c, cleanName));
        if (existingCourse) {
          if (!allowUpdateExisting) {
            const ownerName = existingCourse.createdBy || "another lecturer";
            skippedCourses.push({
              courseName: cleanName,
              owner: ownerName,
              reason: canAccessCourse(existingCourse, auth) ? "Already exists in Subjects (not re-synced)" : `Already owned by ${ownerName}`
            });
            continue;
          }
          if (!canAccessCourse(existingCourse, auth)) {
            const ownerName = existingCourse.createdBy || "another lecturer";
            skippedCourses.push({
              courseName: cleanName,
              owner: ownerName,
              reason: `Already owned by ${ownerName}`
            });
            continue;
          }
          if (sheetOwner.recognized && auth.role !== "admin") {
            if (!doesAuthMatchSheetOwner(sheetOwner.tokens, auth, authUser) && !isDirectOwnerOrShared(existingCourse, auth)) {
              skippedCourses.push({
                courseName: cleanName,
                owner: sheetOwner.displayLabel,
                reason: `Assigned to ${sheetOwner.displayLabel} in Google Sheet`
              });
              continue;
            }
          }
          const cleanSheetName = typeof tab.sheetName === "string" ? tab.sheetName.trim() : "";
          const updated = {
            ...existingCourse,
            sheetName: cleanSheetName || existingCourse.sheetName,
            students,
            updatedAt: now
          };
          await fbPut(`courses/${updated.id}`, updated);
          synced.push(updated);
          continue;
        }
        if (sheetOwner.recognized && auth.role !== "admin") {
          if (!doesAuthMatchSheetOwner(sheetOwner.tokens, auth, authUser)) {
            skippedCourses.push({
              courseName: cleanName,
              owner: sheetOwner.displayLabel,
              reason: `Assigned to ${sheetOwner.displayLabel} in Google Sheet`
            });
            continue;
          }
        }
        const requestedTabOwner = auth.role === "admin" && typeof tab.ownerId === "string" && tab.ownerId.trim() ? allUsers.find((u) => u.id === tab.ownerId.trim()) || null : null;
        let targetOwnerId = auth.uid;
        let targetCreatedBy = auth.username;
        let targetSharedWith = [];
        if (requestedTabOwner) {
          targetOwnerId = requestedTabOwner.id;
          targetCreatedBy = requestedTabOwner.username;
        } else if (auth.role === "admin" && sheetOwner.recognized && sheetOwner.matchedUsers.length > 0) {
          targetOwnerId = sheetOwner.matchedUsers[0].id;
          targetCreatedBy = sheetOwner.matchedUsers[0].username;
          if (sheetOwner.matchedUsers.length > 1) {
            targetSharedWith = sheetOwner.matchedUsers.slice(1).map((u) => u.id);
          }
        }
        if (auth.role === "admin" && Array.isArray(tab.sharedWith)) {
          targetSharedWith = sanitizeSharedWithIds(tab.sharedWith, allUsers, targetOwnerId);
        }
        const baseId = toCourseKey(cleanName);
        const idTaken = Boolean(mutableCoursesMap[baseId]);
        const finalId = idTaken ? `${baseId}__${toFirebaseKey(targetOwnerId)}` : baseId;
        const created = {
          id: finalId,
          courseName: cleanName,
          sheetName: tab.sheetName || "",
          selectedWeek: "W1",
          students,
          ownerId: targetOwnerId,
          createdBy: targetCreatedBy,
          sharedWith: targetSharedWith,
          createdAt: now,
          updatedAt: now
        };
        await fbPut(`courses/${finalId}`, created);
        mutableCoursesMap[finalId] = created;
        allCourses.push(created);
        synced.push(created);
        const syncCourseNotifs = [];
        const assignedToOtherOwner = auth.role === "admin" && targetOwnerId !== auth.uid;
        if (assignedToOtherOwner) {
          syncCourseNotifs.push(
            createUserSystemNotification({
              userId: targetOwnerId,
              type: "course_assigned",
              title: "Subject Assigned",
              courseName: created.courseName,
              message: `Administrator (${auth.username}) synced and assigned "${created.courseName}" to you.`
            })
          );
        }
        const syncedCoNames = [];
        for (const coId of targetSharedWith) {
          const coUser = allUsers.find((u) => u.id === coId);
          if (coUser) syncedCoNames.push(coUser.username);
          if (coId !== auth.uid) {
            syncCourseNotifs.push(
              createUserSystemNotification({
                userId: coId,
                type: "co_lecturer_added",
                title: "Co-Lecturer Added",
                courseName: created.courseName,
                message: `${auth.username} added you as a co-lecturer for "${created.courseName}" during Google Sheet sync.`
              })
            );
          }
        }
        if (assignedToOtherOwner || syncedCoNames.length > 0 || sheetOwner.recognized) {
          const detailParts = [`owner: ${targetCreatedBy}`];
          if (syncedCoNames.length > 0) detailParts.push(`co-lecturers: ${syncedCoNames.join(", ")}`);
          syncCourseNotifs.push(
            createAdminAlertNotification({
              type: "course_ownership_changed",
              userId: auth.uid,
              username: auth.username,
              courseName: created.courseName,
              message: `Google Sheet tab "${created.courseName}" synced by ${auth.username} (${detailParts.join("; ")}).`
            })
          );
        }
        if (syncCourseNotifs.length > 0) {
          await Promise.all(syncCourseNotifs).catch(() => {
          });
        }
      }
      if (skippedCourses.length > 0) {
        const preview = skippedCourses.slice(0, 4).map((item) => `${item.courseName} (${item.reason})`).join("; ");
        const extra = skippedCourses.length > 4 ? ` +${skippedCourses.length - 4} more` : "";
        await createAdminAlertNotification({
          type: "sheet_sync_skipped",
          userId: auth.uid,
          username: auth.username,
          courseName: skippedCourses.map((s) => s.courseName).join(", "),
          reason: preview,
          message: `Google Sheet sync by ${auth.username} skipped ${skippedCourses.length} tab${skippedCourses.length === 1 ? "" : "s"}: ${preview}${extra}.`
        }).catch(() => {
        });
      }
      res.json({ success: true, courses: synced, skippedCourses });
    } catch {
      res.status(500).json({ success: false, error: "Failed to sync sheet tabs." });
    }
  });
  app2.patch("/api/courses/:id/owner", requireAuth, requireAdmin, async (req, res) => {
    try {
      const auth = req.auth;
      const courseId = String(req.params.id || "").trim();
      const newOwnerId = String(req.body?.ownerId || "").trim();
      const sharedWith = Array.isArray(req.body?.sharedWith) ? req.body.sharedWith.map(String) : void 0;
      const [existingRaw, usersObj] = await Promise.all([
        fbGet(`courses/${courseId}`),
        fbGet("app_users")
      ]);
      if (!existingRaw) {
        res.status(404).json({ success: false, error: "Course not found." });
        return;
      }
      const existing = normalizeCourse(existingRaw);
      const allUsers = usersObj && typeof usersObj === "object" ? Object.values(usersObj) : [];
      let nextCreatedBy = existing.createdBy || "admin";
      if (newOwnerId) {
        const ownerUser = allUsers.find((u) => u && u.id === newOwnerId) || await fbGet(`app_users/${newOwnerId}`);
        if (!ownerUser) {
          res.status(404).json({ success: false, error: "Selected owner account not found." });
          return;
        }
        nextCreatedBy = ownerUser.username;
      }
      const prevOwnerId = existing.ownerId || "";
      const prevOwnerLabel = existing.createdBy || "Unassigned";
      const prevSharedIds = resolveCourseSharedUserIds(existing.sharedWith, allUsers);
      const effectiveOwnerId = newOwnerId || existing.ownerId;
      const patchPayload = {
        updatedAt: Date.now()
      };
      if (newOwnerId) {
        patchPayload.ownerId = newOwnerId;
        patchPayload.createdBy = nextCreatedBy;
      }
      if (sharedWith !== void 0) {
        patchPayload.sharedWith = sanitizeSharedWithIds(sharedWith, allUsers, effectiveOwnerId);
      } else if (newOwnerId && Array.isArray(existing.sharedWith)) {
        patchPayload.sharedWith = existing.sharedWith.filter((id) => id !== newOwnerId);
      }
      await fbPatch(`courses/${courseId}`, patchPayload);
      const updated = normalizeCourse({ ...existing, ...patchPayload });
      const nextSharedIds = resolveCourseSharedUserIds(updated.sharedWith, allUsers);
      const notifTasks = [];
      const ownerChanged = Boolean(newOwnerId && newOwnerId !== prevOwnerId);
      if (ownerChanged) {
        if (newOwnerId !== auth.uid) {
          notifTasks.push(
            createUserSystemNotification({
              userId: newOwnerId,
              type: "course_assigned",
              title: "Subject Assigned",
              courseName: updated.courseName,
              message: `Administrator (${auth.username}) assigned the subject "${updated.courseName}" to you.`
            })
          );
        }
        if (prevOwnerId && prevOwnerId !== auth.uid) {
          notifTasks.push(
            createUserSystemNotification({
              userId: prevOwnerId,
              type: "system_update",
              title: "Subject Reassigned",
              courseName: updated.courseName,
              message: `Administrator (${auth.username}) reassigned "${updated.courseName}" to ${nextCreatedBy}.`
            })
          );
        }
        notifTasks.push(
          createAdminAlertNotification({
            type: "course_ownership_changed",
            userId: auth.uid,
            username: auth.username,
            courseName: updated.courseName,
            message: `Subject "${updated.courseName}" ownership changed from ${prevOwnerLabel} to ${nextCreatedBy} (by ${auth.username}).`
          })
        );
      }
      if (sharedWith !== void 0) {
        const addedIds = nextSharedIds.filter((id) => !prevSharedIds.includes(id));
        const removedIds = prevSharedIds.filter((id) => !nextSharedIds.includes(id) && id !== effectiveOwnerId);
        for (const coId of addedIds) {
          if (coId !== auth.uid) {
            notifTasks.push(
              createUserSystemNotification({
                userId: coId,
                type: "co_lecturer_added",
                title: "Co-Lecturer Added",
                courseName: updated.courseName,
                message: `Administrator (${auth.username}) added you as a co-lecturer for "${updated.courseName}".`
              })
            );
          }
        }
        for (const coId of removedIds) {
          if (coId !== auth.uid) {
            notifTasks.push(
              createUserSystemNotification({
                userId: coId,
                type: "co_lecturer_removed",
                title: "Co-Lecturer Removed",
                courseName: updated.courseName,
                message: `Administrator (${auth.username}) removed your co-lecturer access for "${updated.courseName}".`
              })
            );
          }
        }
        if (!ownerChanged && (addedIds.length > 0 || removedIds.length > 0)) {
          const resolveNames = (ids) => ids.map((id) => allUsers.find((u) => u.id === id)?.username || id).join(", ");
          const changes = [];
          if (addedIds.length > 0) changes.push(`added ${resolveNames(addedIds)}`);
          if (removedIds.length > 0) changes.push(`removed ${resolveNames(removedIds)}`);
          notifTasks.push(
            createAdminAlertNotification({
              type: "course_ownership_changed",
              userId: auth.uid,
              username: auth.username,
              courseName: updated.courseName,
              message: `Co-lecturer sharing updated for "${updated.courseName}" by ${auth.username}: ${changes.join("; ")}.`
            })
          );
        }
      }
      if (notifTasks.length > 0) {
        await Promise.all(notifTasks).catch(() => {
        });
      }
      res.json({ success: true, course: updated });
    } catch {
      res.status(500).json({ success: false, error: "Failed to update course ownership." });
    }
  });
  app2.patch("/api/courses/:id/co-lecturers", requireAuth, async (req, res) => {
    try {
      const auth = req.auth;
      const courseId = String(req.params.id || "").trim();
      if (!courseId) {
        res.status(400).json({ success: false, error: "Course ID is required." });
        return;
      }
      const [existingRaw, usersObj] = await Promise.all([
        fbGet(`courses/${courseId}`),
        fbGet("app_users")
      ]);
      if (!existingRaw) {
        res.status(404).json({ success: false, error: "Subject not found." });
        return;
      }
      const existing = normalizeCourse(existingRaw);
      const isPrimaryOwner = auth.role === "admin" || existing.ownerId && existing.ownerId === auth.uid || !existing.ownerId && existing.createdBy && existing.createdBy.toLowerCase() === auth.username.toLowerCase();
      if (!isPrimaryOwner) {
        res.status(403).json({ success: false, error: "Only the subject owner or Administrator can manage co-lecturers." });
        return;
      }
      const allUsers = usersObj && typeof usersObj === "object" ? Object.values(usersObj) : [];
      const prevSharedIds = resolveCourseSharedUserIds(existing.sharedWith, allUsers);
      const cleanedSharedWith = sanitizeSharedWithIds(req.body?.sharedWith, allUsers, existing.ownerId);
      const patchPayload = {
        sharedWith: cleanedSharedWith,
        updatedAt: Date.now()
      };
      await fbPatch(`courses/${courseId}`, patchPayload);
      const updated = normalizeCourse({ ...existing, ...patchPayload });
      const addedIds = cleanedSharedWith.filter((id) => !prevSharedIds.includes(id));
      const removedIds = prevSharedIds.filter(
        (id) => !cleanedSharedWith.includes(id) && id !== existing.ownerId
      );
      const notifTasks = [];
      for (const coId of addedIds) {
        if (coId !== auth.uid) {
          notifTasks.push(
            createUserSystemNotification({
              userId: coId,
              type: "co_lecturer_added",
              title: "Co-Lecturer Added",
              courseName: updated.courseName,
              message: `${auth.username} added you as a co-lecturer for "${updated.courseName}".`
            })
          );
        }
      }
      for (const coId of removedIds) {
        if (coId !== auth.uid) {
          notifTasks.push(
            createUserSystemNotification({
              userId: coId,
              type: "co_lecturer_removed",
              title: "Co-Lecturer Removed",
              courseName: updated.courseName,
              message: `${auth.username} removed your co-lecturer access for "${updated.courseName}".`
            })
          );
        }
      }
      if (addedIds.length > 0 || removedIds.length > 0) {
        const resolveNames = (ids) => ids.map((id) => allUsers.find((u) => u.id === id)?.username || id).join(", ");
        const changes = [];
        if (addedIds.length > 0) changes.push(`added ${resolveNames(addedIds)}`);
        if (removedIds.length > 0) changes.push(`removed ${resolveNames(removedIds)}`);
        notifTasks.push(
          createAdminAlertNotification({
            type: "course_ownership_changed",
            userId: auth.uid,
            username: auth.username,
            courseName: updated.courseName,
            message: `Co-lecturer sharing updated for "${updated.courseName}" by ${auth.username}: ${changes.join("; ")}.`
          })
        );
      }
      if (notifTasks.length > 0) {
        await Promise.all(notifTasks).catch(() => {
        });
      }
      res.json({ success: true, course: updated });
    } catch {
      res.status(500).json({ success: false, error: "Failed to update co-lecturers." });
    }
  });
  app2.get("/api/attendance/live", requireAuth, async (req, res) => {
    try {
      const auth = req.auth;
      const courseName = String(req.query.course || "").trim();
      const courseId = String(req.query.courseId || "").trim();
      if (!courseName && !courseId && auth.role !== "admin") {
        res.status(400).json({ success: false, error: "Subject is required." });
        return;
      }
      const coursesObj = await fbGet("courses") || {};
      const access = resolveCourseAccess({ coursesObj, courseId, courseName, auth });
      if (!access.allowed) {
        res.status(403).json({ success: false, error: "Access denied for this subject." });
        return;
      }
      const sessionPath = buildLiveSessionPath({
        courseName: access.course?.courseName || courseName,
        courseId: access.course?.id || courseId,
        matchedCourse: access.course
      });
      const data = await fbGet(`live_sessions/${sessionPath}`);
      const students = data && typeof data === "object" ? Object.values(data).sort((a, b) => b.timestamp - a.timestamp) : [];
      res.json({ success: true, students });
    } catch {
      res.status(500).json({ success: false, error: "Failed to fetch live attendance." });
    }
  });
  app2.post("/api/attendance/manual", requireAuth, async (req, res) => {
    try {
      const auth = req.auth;
      const name = String(req.body?.name || "").trim();
      const studentId = String(req.body?.studentId || "").trim();
      const status = String(req.body?.status || "P").trim().toUpperCase();
      const courseName = String(req.body?.courseName || "General Session").trim();
      const courseId = String(req.body?.courseId || "").trim();
      const absenceReason = typeof req.body?.absenceReason === "string" ? req.body.absenceReason : void 0;
      const week = String(req.body?.week || "W1").trim().toUpperCase();
      const overrideTimestamp = typeof req.body?.overrideTimestamp === "number" ? req.body.overrideTimestamp : void 0;
      if (!name || !studentId) {
        res.status(400).json({ success: false, message: "Name and Student ID are required." });
        return;
      }
      const coursesObj = await fbGet("courses") || {};
      const access = resolveCourseAccess({ coursesObj, courseId, courseName, auth });
      if (!access.allowed) {
        res.status(403).json({ success: false, message: "You do not have permission to edit attendance for this subject." });
        return;
      }
      const cleanStudentId = normalizeStudentId(studentId);
      const studentKey = toStudentFirebaseKey(cleanStudentId);
      const sessionPath = buildLiveSessionPath({
        courseName: access.course?.courseName || courseName,
        courseId: access.course?.id || courseId,
        matchedCourse: access.course
      });
      if (status === "P") {
        const liveSessionMap = await fbGet(`live_sessions/${sessionPath}`);
        const existingData = liveSessionMap && typeof liveSessionMap === "object" ? liveSessionMap[studentKey] || Object.values(liveSessionMap).find(
          (s) => s && normalizeStudentId(s.studentId || "") === cleanStudentId
        ) : null;
        if (existingData && existingData.status === "P" && (existingData.week || "W1").trim().toUpperCase() === week) {
          res.status(409).json({ success: false, message: "You have already checked in for this session." });
          return;
        }
      }
      const resolvedCourseId = access.course?.id || courseId || void 0;
      const timestamp = overrideTimestamp || Date.now();
      const studentData = {
        name,
        studentId: cleanStudentId,
        email: req.body?.email ? String(req.body.email).trim() : `${cleanStudentId}@student.edu.my`,
        status,
        timestamp,
        courseName: access.course?.courseName || courseName,
        ...resolvedCourseId ? { courseId: resolvedCourseId } : {},
        absenceReason,
        week
      };
      const pendingKey = toFirebaseKey(`${resolvedCourseId || toCourseKey(studentData.courseName)}__${studentKey}`);
      await Promise.all([
        fbPut(`pending/${pendingKey}`, studentData),
        fbPut(`live_sessions/${sessionPath}/${studentKey}`, studentData),
        upsertAttendanceHistory([studentData])
      ]);
      const cfg = await getAppConfig();
      if (cfg.integrationType === "google_sheets" && cfg.scriptUrl) {
        void postToGoogleScript(cfg.scriptUrl, formatCloudPayload(studentData, week)).then((r) => {
          if (r.ok && !r.json?.error && r.json?.success !== false) {
            return fbDelete(`pending/${pendingKey}`).catch(() => {
            });
          }
        }).catch(() => {
        });
      }
      res.json({ success: true, message: "Record submitted successfully.", record: studentData });
    } catch {
      res.status(500).json({ success: false, message: "Connection lost. Please try again." });
    }
  });
  app2.post("/api/attendance/bulk", requireAuth, async (req, res) => {
    try {
      const auth = req.auth;
      const records = Array.isArray(req.body?.records) ? req.body.records : [];
      const courseName = String(req.body?.courseName || "").trim();
      const courseId = String(req.body?.courseId || "").trim();
      const week = String(req.body?.week || "W1").trim().toUpperCase();
      if (records.length === 0) {
        res.json({ success: true });
        return;
      }
      const coursesObj = await fbGet("courses") || {};
      const access = resolveCourseAccess({
        coursesObj,
        courseId,
        courseName: courseName || String(records[0]?.courseName || ""),
        auth
      });
      if (!access.allowed) {
        res.status(403).json({ success: false, error: "You do not have permission to update attendance for this subject." });
        return;
      }
      if (auth.role !== "admin") {
        for (const rec of records) {
          if (rec?.courseName) {
            const recAccess = resolveCourseAccess({ coursesObj, courseName: rec.courseName, auth });
            if (!recAccess.allowed) {
              res.status(403).json({ success: false, error: "You do not have permission to update attendance for one or more subjects." });
              return;
            }
          }
        }
      }
      const sessionPath = buildLiveSessionPath({
        courseName: access.course?.courseName || courseName,
        courseId: access.course?.id || courseId,
        matchedCourse: access.course
      });
      const resolvedBulkCourseId = access.course?.id || courseId || void 0;
      const enrichedRecords = records.map((r) => ({
        ...r,
        ...r.courseId || resolvedBulkCourseId ? { courseId: r.courseId || resolvedBulkCourseId } : {}
      }));
      const pendingKeys = enrichedRecords.map((r) => {
        const sk = toStudentFirebaseKey(r.studentId || "");
        return sk ? toFirebaseKey(`${r.courseId || toCourseKey(r.courseName || courseName)}__${sk}`) : "";
      }).filter(Boolean);
      await Promise.all([
        ...enrichedRecords.flatMap((r) => {
          const key = toStudentFirebaseKey(r.studentId || "");
          const pKey = toFirebaseKey(`${r.courseId || toCourseKey(r.courseName || courseName)}__${key}`);
          return [
            fbPut(`pending/${pKey}`, r),
            fbPut(`live_sessions/${sessionPath}/${key}`, r)
          ];
        }),
        upsertAttendanceHistory(enrichedRecords)
      ]);
      const cfg = await getAppConfig();
      if (cfg.integrationType === "google_sheets" && cfg.scriptUrl) {
        void postToGoogleScript(
          cfg.scriptUrl,
          enrichedRecords.map((r) => formatCloudPayload(r, week))
        ).then((r) => {
          if (r.ok && !r.json?.error && r.json?.success !== false) {
            return Promise.all(pendingKeys.map((k) => fbDelete(`pending/${k}`).catch(() => {
            })));
          }
        }).catch(() => {
        });
      }
      res.json({ success: true });
    } catch {
      res.status(500).json({ success: false, error: "Bulk update failed." });
    }
  });
  app2.post("/api/attendance/remove", requireAuth, async (req, res) => {
    try {
      const auth = req.auth;
      const removals = Array.isArray(req.body?.removals) ? req.body.removals : [];
      const courseName = String(req.body?.courseName || "").trim();
      const courseId = String(req.body?.courseId || "").trim();
      const coursesObj = await fbGet("courses") || {};
      const access = resolveCourseAccess({
        coursesObj,
        courseId,
        courseName: courseName || String(removals[0]?.courseName || ""),
        auth
      });
      if (!access.allowed) {
        res.status(403).json({ success: false, error: "You do not have permission to remove students from this subject." });
        return;
      }
      if (auth.role !== "admin") {
        for (const rem of removals) {
          if (rem?.courseName) {
            const recAccess = resolveCourseAccess({ coursesObj, courseId: rem.courseId || courseId, courseName: rem.courseName, auth });
            if (!recAccess.allowed) {
              res.status(403).json({ success: false, error: "You do not have permission to modify one or more subjects." });
              return;
            }
          }
        }
      }
      const sessionPath = buildLiveSessionPath({
        courseName: access.course?.courseName || courseName,
        courseId: access.course?.id || courseId,
        matchedCourse: access.course
      });
      const resolvedRemoveCourseId = access.course?.id || courseId || void 0;
      const enrichedRemovals = removals.map((r) => ({
        ...r,
        ...r.courseId || resolvedRemoveCourseId ? { courseId: r.courseId || resolvedRemoveCourseId } : {}
      }));
      const pendingKeys = enrichedRemovals.map((r) => {
        const sk = toStudentFirebaseKey(r.studentId || "");
        return sk ? toFirebaseKey(`${r.courseId || toCourseKey(r.courseName || courseName)}__${sk}`) : "";
      }).filter(Boolean);
      await Promise.all([
        ...enrichedRemovals.flatMap((r) => {
          const rawId = String(r.studentId || "").trim();
          const key = toStudentFirebaseKey(rawId);
          const pKey = toFirebaseKey(`${r.courseId || toCourseKey(r.courseName || courseName)}__${key}`);
          const tasks = [
            fbPut(`pending/${pKey}`, r),
            fbDelete(`live_sessions/${sessionPath}/${key}`)
          ];
          if (rawId && rawId !== key) {
            tasks.push(fbDelete(`live_sessions/${sessionPath}/${rawId}`));
          }
          return tasks;
        }),
        upsertAttendanceHistory(enrichedRemovals)
      ]);
      const cfg = await getAppConfig();
      if (cfg.integrationType === "google_sheets" && cfg.scriptUrl && enrichedRemovals.length > 0) {
        void postToGoogleScript(
          cfg.scriptUrl,
          enrichedRemovals.map((r) => formatCloudPayload(r, r.week || "W1"))
        ).then((r) => {
          if (r.ok && !r.json?.error && r.json?.success !== false) {
            return Promise.all(pendingKeys.map((k) => fbDelete(`pending/${k}`).catch(() => {
            })));
          }
        }).catch(() => {
        });
      }
      res.json({ success: true });
    } catch {
      res.status(500).json({ success: false, error: "Failed to remove students." });
    }
  });
  app2.put("/api/attendance/matrix-cell", requireAuth, async (req, res) => {
    try {
      const auth = req.auth;
      const rawStudentId = String(req.body?.studentId || "").trim();
      const studentId = normalizeStudentId(rawStudentId);
      const studentKey = toStudentFirebaseKey(studentId);
      const name = String(req.body?.name || "").trim();
      const courseName = String(req.body?.courseName || "General Session").trim();
      const courseId = String(req.body?.courseId || "").trim();
      const week = String(req.body?.week || "W1").trim().toUpperCase();
      const status = String(req.body?.status || "P").trim().toUpperCase();
      const absenceReason = typeof req.body?.absenceReason === "string" ? req.body.absenceReason.trim() : "";
      const updateLiveSession = Boolean(req.body?.updateLiveSession);
      if (!studentId || !name || !/^W([1-9]|1[0-4])$/.test(week)) {
        res.status(400).json({ success: false, error: "Valid Student ID, Name, and Week (W1\u2013W14) are required." });
        return;
      }
      const coursesObj = await fbGet("courses") || {};
      const access = resolveCourseAccess({ coursesObj, courseId, courseName, auth });
      if (!access.allowed) {
        res.status(403).json({ success: false, error: "You do not have permission to edit this subject." });
        return;
      }
      const resolvedMatrixCourseId = access.course?.id || courseId || void 0;
      const timestamp = Date.now();
      const record = {
        studentId,
        name,
        email: `${studentId}@student.edu.my`,
        status,
        timestamp,
        courseName: access.course?.courseName || courseName,
        ...resolvedMatrixCourseId ? { courseId: resolvedMatrixCourseId } : {},
        absenceReason: status === "P" ? "" : absenceReason || void 0,
        week
      };
      const pendingKey = toFirebaseKey(`${resolvedMatrixCourseId || toCourseKey(record.courseName)}__${studentKey}`);
      const writes = [
        fbPut(`pending/${pendingKey}`, record),
        upsertAttendanceHistory([record])
      ];
      if (updateLiveSession) {
        const sessionPath = buildLiveSessionPath({
          courseName: access.course?.courseName || courseName,
          courseId: access.course?.id || courseId,
          matchedCourse: access.course
        });
        writes.push(fbPut(`live_sessions/${sessionPath}/${studentKey}`, record));
      }
      await Promise.all(writes);
      const cfg = await getAppConfig();
      if (cfg.integrationType === "google_sheets" && cfg.scriptUrl) {
        void postToGoogleScript(cfg.scriptUrl, formatCloudPayload(record, week)).then((r) => {
          if (r.ok && !r.json?.error && r.json?.success !== false) {
            return fbDelete(`pending/${pendingKey}`).catch(() => {
            });
          }
        }).catch(() => {
        });
      }
      res.json({ success: true, record });
    } catch {
      res.status(500).json({ success: false, error: "Failed to update matrix cell." });
    }
  });
  app2.delete("/api/attendance/session", requireAuth, async (req, res) => {
    try {
      const auth = req.auth;
      const courseName = String(req.query.course || "").trim();
      const courseId = String(req.query.courseId || "").trim();
      const coursesObj = await fbGet("courses") || {};
      const access = resolveCourseAccess({ coursesObj, courseId, courseName, auth });
      if (!access.allowed) {
        res.status(403).json({ success: false, error: "You do not have permission to clear this subject session." });
        return;
      }
      const sessionPath = buildLiveSessionPath({
        courseName: access.course?.courseName || courseName,
        courseId: access.course?.id || courseId,
        matchedCourse: access.course
      });
      await fbDelete(`live_sessions/${sessionPath}`);
      res.json({ success: true });
    } catch {
      res.status(500).json({ success: false, error: "Failed to clear session." });
    }
  });
  app2.delete("/api/history/item", requireAuth, async (req, res) => {
    try {
      const auth = req.auth;
      const timestamp = Number(req.query.timestamp);
      const studentId = String(req.query.studentId || "").trim();
      const normId = normalizeStudentId(studentId);
      const entries = await readAttendanceHistoryEntries();
      let allowedCourseIds = null;
      let allowedCourses = null;
      if (auth.role !== "admin") {
        const coursesObj = await fbGet("courses") || {};
        const accessible = Object.values(coursesObj).filter(
          (c) => c && c.courseName && canAccessCourse(normalizeCourse(c), auth)
        );
        allowedCourseIds = new Set(accessible.map((c) => c.id));
        allowedCourses = new Set(accessible.map((c) => normalizeCourseNameKey(c.courseName)));
      }
      const deletePatch = {};
      for (const { key, record } of entries) {
        if (record.timestamp === timestamp && (record.studentId === studentId || normalizeStudentId(record.studentId) === normId)) {
          const hasPermission = record.courseId ? Boolean(allowedCourseIds?.has(record.courseId)) : Boolean(allowedCourses?.has(normalizeCourseNameKey(record.courseName || "")));
          if (allowedCourses && !hasPermission) {
            res.status(403).json({ success: false, error: "You do not have permission to delete this history record." });
            return;
          }
          deletePatch[key] = null;
        }
      }
      if (Object.keys(deletePatch).length > 0) {
        await fbPatch("attendance_history", deletePatch);
      }
      res.json({ success: true });
    } catch {
      res.status(500).json({ success: false, error: "Failed to delete history item." });
    }
  });
  app2.delete("/api/history", requireAuth, async (req, res) => {
    try {
      const auth = req.auth;
      if (auth.role === "admin") {
        await fbDelete("attendance_history");
        res.json({ success: true });
        return;
      }
      const coursesObj = await fbGet("courses") || {};
      const accessible = Object.values(coursesObj).filter(
        (c) => c && c.courseName && canAccessCourse(normalizeCourse(c), auth)
      );
      const ownedCourseIds = new Set(accessible.map((c) => c.id));
      const ownedNames = new Set(accessible.map((c) => normalizeCourseNameKey(c.courseName)));
      const entries = await readAttendanceHistoryEntries();
      const deletePatch = {};
      for (const { key, record } of entries) {
        const hasPermission = record.courseId ? ownedCourseIds.has(record.courseId) : ownedNames.has(normalizeCourseNameKey(record.courseName || ""));
        if (hasPermission) {
          deletePatch[key] = null;
        }
      }
      if (Object.keys(deletePatch).length > 0) {
        await fbPatch("attendance_history", deletePatch);
      }
      res.json({ success: true });
    } catch {
      res.status(500).json({ success: false, error: "Failed to clear history." });
    }
  });
  app2.post("/api/queue/test", requireAuth, async (req, res) => {
    try {
      const auth = req.auth;
      const courseName = String(req.body?.courseName || "Connectivity Test").trim();
      const week = String(req.body?.week || "W1").trim().toUpperCase();
      const coursesObj = await fbGet("courses") || {};
      const access = resolveCourseAccess({ coursesObj, courseName, auth });
      if (!access.allowed) {
        res.status(403).json({ success: false, message: "Access denied for this subject." });
        return;
      }
      const testRecord = {
        name: "CONNECTION TEST",
        studentId: "TEST999",
        email: "test@student.edu.my",
        status: "P",
        timestamp: Date.now(),
        courseName,
        absenceReason: "",
        week
      };
      const cfg = await getAppConfig();
      if (cfg.integrationType === "google_sheets") {
        if (!cfg.scriptUrl || cfg.scriptUrl === DEFAULT_SCRIPT_URL) {
          res.status(400).json({ success: false, message: "Google Apps Script URL is not configured." });
          return;
        }
        const scriptRes = await postToGoogleScript(cfg.scriptUrl, formatCloudPayload(testRecord, week));
        await fbDelete("pending/TEST999").catch(() => {
        });
        if (!scriptRes.ok || scriptRes.json?.success === false || scriptRes.json?.error) {
          const errMsg = typeof scriptRes.json?.error === "string" && scriptRes.json.error || scriptRes.error || "Google Apps Script test failed.";
          res.status(502).json({ success: false, message: errMsg });
          return;
        }
        res.json({ success: true, message: `Test signal delivered to Google Sheets (${week}).` });
        return;
      }
      res.json({ success: true, message: `Test signal verified (${week}).` });
    } catch {
      res.status(500).json({ success: false, message: "Cloud test failed." });
    }
  });
  app2.get("/api/queue", requireAuth, async (req, res) => {
    try {
      const auth = req.auth;
      const [data, coursesObj] = await Promise.all([
        fbGet("pending"),
        auth.role === "admin" ? Promise.resolve(null) : fbGet("courses")
      ]);
      const scoped = {};
      if (data && typeof data === "object") {
        for (const [key, rec] of Object.entries(data)) {
          if (!rec || key === "TEST999" || normalizeStudentId(rec.studentId || "") === "TEST999") continue;
          if (auth.role === "admin") {
            scoped[key] = rec;
          } else {
            const access = resolveCourseAccess({
              coursesObj,
              courseId: rec.courseId || "",
              courseName: rec.courseName || "",
              auth
            });
            if (access.allowed && access.course) {
              scoped[key] = rec;
            }
          }
        }
      }
      const count = Object.keys(scoped).length;
      res.json({
        success: true,
        message: count > 0 ? `Queue length: ${count}` : "Synchronization queue is empty.",
        count,
        data: scoped
      });
    } catch {
      res.status(500).json({ success: false, message: "Status check failed.", count: 0 });
    }
  });
  app2.delete("/api/queue", requireAuth, requireAdmin, async (_req, res) => {
    try {
      await fbDelete("pending");
      res.json({ success: true, message: "Queue cleared. Queue length: 0" });
    } catch {
      res.status(500).json({ success: false, message: "Failed to clear queue." });
    }
  });
  app2.post("/api/queue/sync", requireAuth, async (req, res) => {
    try {
      const auth = req.auth;
      const selectedWeek = String(req.body?.week || "W1").trim().toUpperCase();
      const cfg = await getAppConfig();
      if (cfg.integrationType === "firebase") {
        res.json({ success: true, message: "Firebase syncs automatically.", syncedCount: 0, errorCount: 0, total: 0 });
        return;
      }
      const [pendingData, coursesObj] = await Promise.all([
        fbGet("pending"),
        auth.role === "admin" ? Promise.resolve(null) : fbGet("courses")
      ]);
      const scopedEntries = [];
      if (pendingData && typeof pendingData === "object") {
        for (const [key, rec] of Object.entries(pendingData)) {
          if (!rec || key === "TEST999" || normalizeStudentId(rec.studentId || "") === "TEST999") continue;
          if (auth.role === "admin") {
            scopedEntries.push([key, rec]);
          } else {
            const access = resolveCourseAccess({
              coursesObj,
              courseId: rec.courseId || "",
              courseName: rec.courseName || "",
              auth
            });
            if (access.allowed && access.course) {
              scopedEntries.push([key, rec]);
            }
          }
        }
      }
      const records = scopedEntries.map(([, rec]) => rec);
      if (cfg.integrationType === "airtable") {
        res.json({
          success: true,
          message: records.length > 0 ? "Pending records ready for Airtable sync." : "No pending records to sync.",
          syncedCount: records.length,
          errorCount: 0,
          total: records.length,
          records
        });
        return;
      }
      if (!cfg.scriptUrl || cfg.scriptUrl === DEFAULT_SCRIPT_URL) {
        res.status(400).json({ success: false, message: "Google Apps Script URL is not configured.", syncedCount: 0, errorCount: 0, total: 0 });
        return;
      }
      if (records.length > 0) {
        const bulkPayload = records.map((r) => formatCloudPayload({ ...r, week: r.week || selectedWeek }, selectedWeek));
        const scriptRes = await postToGoogleScript(cfg.scriptUrl, bulkPayload);
        if (!scriptRes.ok || scriptRes.json?.success === false || scriptRes.json?.error) {
          const errMsg = typeof scriptRes.json?.error === "string" && scriptRes.json.error || scriptRes.error || "Google Apps Script sync failed.";
          res.status(502).json({
            success: false,
            message: errMsg,
            syncedCount: 0,
            errorCount: records.length,
            total: records.length
          });
          return;
        }
        await Promise.all(scopedEntries.map(([key]) => fbDelete(`pending/${key}`).catch(() => {
        })));
        res.json({
          success: true,
          message: `Synced ${records.length} record(s) to ${selectedWeek}.`,
          syncedCount: records.length,
          errorCount: 0,
          total: records.length
        });
        return;
      }
      const pingRes = await postToGoogleScript(cfg.scriptUrl, { action: "SYNC_QUEUE", week: selectedWeek });
      if (!pingRes.ok || pingRes.json?.success === false || pingRes.json?.error) {
        const errMsg = typeof pingRes.json?.error === "string" && pingRes.json.error || pingRes.error || "Google Apps Script sync trigger failed.";
        res.status(502).json({ success: false, message: errMsg, syncedCount: 0, errorCount: 1, total: 0 });
        return;
      }
      res.json({ success: true, message: `Cloud sync triggered (${selectedWeek}).`, syncedCount: 0, errorCount: 0, total: 0 });
    } catch {
      res.status(500).json({ success: false, message: "Trigger failed.", syncedCount: 0, errorCount: 0, total: 0 });
    }
  });
  app2.patch("/api/admin/config", requireAuth, requireAdmin, async (req, res) => {
    try {
      const updates = {};
      if (typeof req.body?.scriptUrl === "string") {
        const trimmed = req.body.scriptUrl.trim();
        if (trimmed.startsWith("https://script.google.com/")) {
          await fbPut("app_config/script_url", trimmed);
          updates.scriptUrl = trimmed;
        }
      }
      if (typeof req.body?.scriptSecret === "string") {
        const trimmedSecret = req.body.scriptSecret.trim();
        if (trimmedSecret) {
          await fbPut("app_config/script_secret", trimmedSecret);
        } else {
          await fbDelete("app_config/script_secret");
        }
        updates.scriptSecretConfigured = Boolean(trimmedSecret);
      }
      if (req.body?.integrationType === "google_sheets" || req.body?.integrationType === "airtable" || req.body?.integrationType === "firebase") {
        await fbPut("app_config/integration_type", req.body.integrationType);
        updates.integrationType = req.body.integrationType;
      }
      if (typeof req.body?.adminEmail === "string") {
        await fbPut("app_config/admin_email", req.body.adminEmail.trim());
        updates.adminEmail = req.body.adminEmail.trim();
      }
      res.json({ success: true, updates });
    } catch {
      res.status(500).json({ success: false, error: "Failed to update system configuration." });
    }
  });
  app2.post("/api/admin/test-email", requireAuth, requireAdmin, async (req, res) => {
    try {
      const cfg = await getAppConfig();
      const recipient = String(req.body?.targetEmail ?? cfg.adminEmail).trim();
      if (!recipient) {
        res.json({ success: false, message: "Enter an Admin Notification Email first." });
        return;
      }
      const deliveryStatus = getEmailDeliveryStatus(cfg.scriptUrl);
      const baseAppUrl = sanitizePublicAppUrl(req.body?.publicAppUrl, req);
      const testLink = `${baseAppUrl}?test_email=verified`;
      if (deliveryStatus.provider === "resend" || deliveryStatus.provider === "smtp") {
        const directRes = await sendDirectEmail({
          to: recipient,
          subject: "Smart Attendance \u2014 Email Delivery Test",
          text: `Your built-in email delivery (${deliveryStatus.label}) is working properly.

Verification link: ${testLink}
`,
          html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:20px;border:1px solid #e5e7eb;border-radius:12px;"><h2 style="color:#111827;margin:0 0 8px;">Email Delivery Verified</h2><p style="color:#4b5563;font-size:14px;">Your Smart Attendance backend delivered this test email via <strong>${escapeHtml(deliveryStatus.label)}</strong>.</p><p style="color:#6b7280;font-size:12px;word-break:break-all;">Test URL: ${escapeHtml(testLink)}</p></div>`
        });
        if (directRes.ok) {
          res.json({
            success: true,
            provider: deliveryStatus.provider,
            message: `Test email sent to ${recipient} via ${deliveryStatus.label}. Check Inbox/Spam!`
          });
          return;
        }
        const failMsg = directRes.error || `Failed to send via ${deliveryStatus.label}.`;
        await createEmailDeliveryFailureAlert({
          context: "Test Email Delivery",
          targetEmail: recipient,
          provider: deliveryStatus.provider,
          error: failMsg
        });
        res.json({
          success: false,
          provider: deliveryStatus.provider,
          message: failMsg
        });
        return;
      }
      if (!cfg.scriptUrl || cfg.scriptUrl === DEFAULT_SCRIPT_URL || cfg.scriptUrl.endsWith("/dev")) {
        const failMsg = "No email service configured yet. Deploy your Google Apps Script /exec URL in Settings, or use the Copy Link button for pending accounts.";
        await createEmailDeliveryFailureAlert({
          context: "Test Email Delivery",
          targetEmail: recipient,
          provider: "none",
          error: failMsg
        });
        res.json({
          success: false,
          provider: "none",
          message: failMsg
        });
        return;
      }
      const emailRes = await postToGoogleScript(cfg.scriptUrl, {
        action: "SEND_ACTIVATION_EMAIL",
        toEmail: recipient,
        username: "Admin Email Test",
        activationUrl: testLink,
        adminEmail: recipient
      });
      if (!emailRes.ok) {
        const failMsg = emailRes.error || "Apps Script returned HTML or failed. Check Web App access = Anyone.";
        await createEmailDeliveryFailureAlert({
          context: "Test Email Delivery",
          targetEmail: recipient,
          provider: "apps_script",
          error: failMsg
        });
        res.json({ success: false, message: "Apps Script returned HTML or failed. Check Web App access = Anyone." });
        return;
      }
      if (emailRes.json?.success && emailRes.json?.emailSent !== false) {
        res.json({
          success: true,
          provider: "apps_script",
          message: `Test email sent to ${recipient} via Google Apps Script. Check Inbox/Spam!`
        });
        return;
      }
      const errText = String(emailRes.json?.error || "Email could not be sent.");
      if (errText.includes("script.send_mail") || errText.includes("MailApp")) {
        const failMsg = "Apps Script lacks email permission (script.send_mail). Please re-authorize Apps Script MailApp in your deployment.";
        await createEmailDeliveryFailureAlert({
          context: "Test Email Delivery",
          targetEmail: recipient,
          provider: "apps_script",
          error: failMsg
        });
        res.json({
          success: false,
          message: failMsg
        });
        return;
      }
      await createEmailDeliveryFailureAlert({
        context: "Test Email Delivery",
        targetEmail: recipient,
        provider: "apps_script",
        error: errText
      });
      res.json({ success: false, message: errText });
    } catch {
      res.json({ success: false, message: "Server error while sending test email." });
    }
  });
  app2.post("/api/admin/users/:id/activate", requireAuth, requireAdmin, async (req, res) => {
    const userId = String(req.params.id || "").trim();
    const userRecord = await findStoredUserById(userId);
    if (!userRecord || !userRecord.id) {
      res.status(404).json({ success: false, error: "User not found." });
      return;
    }
    if (userRecord.status === "active") {
      res.json({
        success: true,
        status: "active",
        activatedAt: userRecord.activatedAt || Date.now(),
        alreadyActive: true
      });
      return;
    }
    const now = Date.now();
    const pin = generateActivationPin();
    const activationExpiresAt = now + ACTIVATION_PIN_EXPIRY_MS;
    await fbPatch(`app_users/${userRecord.dbKey}`, {
      status: "approved_pending_pin",
      activationPin: pin,
      pinFailedAttempts: 0,
      approvedAt: userRecord.approvedAt || now,
      activationSentAt: now,
      activationExpiresAt
    });
    const existingAdminNotifs = await fbGet("admin_notifications").catch(() => null);
    if (existingAdminNotifs && typeof existingAdminNotifs === "object") {
      await Promise.all(
        Object.values(existingAdminNotifs).filter((n) => n && !n.read && n.type === "user_signup" && n.userId === userRecord.id).map((n) => fbPatch(`admin_notifications/${n.id}`, { read: true }).catch(() => {
        }))
      );
    }
    let emailSent = false;
    let provider = "none";
    if (userRecord.email) {
      const cfg = await getAppConfig();
      const emailRes = await dispatchApprovalPinEmail({
        toEmail: userRecord.email,
        username: userRecord.username,
        pin,
        expiresAtText: new Date(activationExpiresAt).toLocaleString(),
        cfg
      });
      emailSent = emailRes.emailSent;
      provider = emailRes.provider;
      if (!emailSent) {
        await createEmailDeliveryFailureAlert({
          context: "Account Approval PIN Email",
          targetEmail: userRecord.email,
          username: userRecord.username,
          userId: userRecord.id,
          provider,
          error: emailRes.error
        });
      }
    }
    res.json({
      success: true,
      status: "approved_pending_pin",
      approvedAt: userRecord.approvedAt || now,
      emailSent,
      provider,
      email: userRecord.email || "",
      pin: emailSent ? void 0 : pin
    });
  });
  app2.post("/api/admin/users/:id/reset-password", requireAuth, requireAdmin, async (req, res) => {
    const userId = String(req.params.id || "").trim();
    const newPassword = String(req.body?.newPassword || "");
    const activateAccount = Boolean(req.body?.activateAccount);
    if (newPassword.trim().length < 4) {
      res.status(400).json({ success: false, error: "New password must be at least 4 characters." });
      return;
    }
    const target = await findStoredUserById(userId);
    if (!target || !target.id) {
      res.status(404).json({ success: false, error: "User not found." });
      return;
    }
    if (target.role === "admin" || target.username.toLowerCase() === "admin") {
      res.status(400).json({ success: false, error: "Cannot reset protected admin account here." });
      return;
    }
    const now = Date.now();
    const shouldActivate = activateAccount || !target.status;
    await fbPatch(`app_users/${target.dbKey}`, {
      id: target.id,
      passwordHash: hashPassword(newPassword),
      password: null,
      pinFailedAttempts: null,
      ...shouldActivate ? {
        status: "active",
        activatedAt: target.activatedAt || now,
        approvedAt: target.approvedAt || now,
        activationPin: null,
        activationExpiresAt: null
      } : {}
    });
    res.json({
      success: true,
      status: shouldActivate ? "active" : target.status,
      activatedAt: shouldActivate ? target.activatedAt || now : target.activatedAt
    });
  });
  app2.delete("/api/admin/users/:id", requireAuth, requireAdmin, async (req, res) => {
    const userId = String(req.params.id || "").trim();
    const target = await findStoredUserById(userId);
    if (!target || target.role === "admin" || target.username.toLowerCase() === "admin") {
      res.status(400).json({ success: false, error: "Cannot delete admin user." });
      return;
    }
    await fbDelete(`app_users/${target.dbKey}`);
    const sessionsObj = await fbGet("admin_logins") || {};
    const matching = Object.values(sessionsObj).filter(
      (s) => s && s.adminName?.toLowerCase() === target.username.toLowerCase() && s.status === "active"
    );
    await Promise.all(
      matching.map(
        (s) => fbPatch(`admin_logins/${s.id}`, {
          status: "signed_out",
          lastActiveTime: Date.now(),
          currentAction: "Account Removed"
        })
      )
    );
    res.json({ success: true });
  });
  app2.post("/api/admin/users/:id/resend-activation", requireAuth, requireAdmin, async (req, res) => {
    const userId = String(req.params.id || "").trim();
    const userRecord = await findStoredUserById(userId);
    if (!userRecord || !userRecord.id) {
      res.status(404).json({ sent: false, error: "User not found." });
      return;
    }
    if (userRecord.status === "active") {
      res.json({ sent: false, error: "Account is already active." });
      return;
    }
    const now = Date.now();
    const pin = generateActivationPin();
    const activationExpiresAt = now + ACTIVATION_PIN_EXPIRY_MS;
    await fbPatch(`app_users/${userRecord.dbKey}`, {
      status: "approved_pending_pin",
      activationPin: pin,
      pinFailedAttempts: 0,
      approvedAt: userRecord.approvedAt || now,
      activationSentAt: now,
      activationExpiresAt
    });
    if (!userRecord.email) {
      res.json({ sent: false, pin });
      return;
    }
    const cfg = await getAppConfig();
    const { emailSent, provider, error } = await dispatchApprovalPinEmail({
      toEmail: userRecord.email,
      username: userRecord.username,
      pin,
      expiresAtText: new Date(activationExpiresAt).toLocaleString(),
      cfg
    });
    if (!emailSent) {
      await createEmailDeliveryFailureAlert({
        context: "Resend Activation PIN Email",
        targetEmail: userRecord.email,
        username: userRecord.username,
        userId: userRecord.id,
        provider,
        error
      });
    }
    res.json({ sent: emailSent, provider, email: userRecord.email, pin: emailSent ? void 0 : pin });
  });
  app2.post("/api/admin/sessions/:id/revoke", requireAuth, requireAdmin, async (req, res) => {
    const sessionId = String(req.params.id || "").trim();
    await fbPatch(`admin_logins/${sessionId}`, {
      status: "signed_out",
      lastActiveTime: Date.now(),
      currentAction: "Revoked by Admin"
    });
    res.json({ success: true });
  });
  app2.delete("/api/admin/sessions/inactive", requireAuth, requireAdmin, async (_req, res) => {
    const sessionsObj = await fbGet("admin_logins") || {};
    const staleThreshold = Date.now() - 2 * 60 * 1e3;
    const toRemove = Object.values(sessionsObj).filter(
      (s) => s && (s.status === "signed_out" || (s.lastActiveTime || 0) < staleThreshold)
    );
    await Promise.all(toRemove.map((s) => fbDelete(`admin_logins/${s.id}`)));
    res.json({ success: true });
  });
  app2.patch("/api/admin/notifications/:id/read", requireAuth, requireAdmin, async (req, res) => {
    const notifId = String(req.params.id || "").trim();
    await fbPatch(`admin_notifications/${notifId}`, { read: true });
    res.json({ success: true });
  });
  app2.post("/api/admin/notifications/read-all", requireAuth, requireAdmin, async (_req, res) => {
    const notifsObj = await fbGet("admin_notifications") || {};
    await Promise.all(
      Object.values(notifsObj).filter((n) => n && !n.read).map((n) => fbPatch(`admin_notifications/${n.id}`, { read: true }))
    );
    res.json({ success: true });
  });
  app2.delete("/api/admin/notifications", requireAuth, requireAdmin, async (_req, res) => {
    await fbDelete("admin_notifications");
    res.json({ success: true });
  });
  app2.use((err, req, res, next) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    const status = typeof err?.status === "number" ? err.status : typeof err?.statusCode === "number" ? err.statusCode : 500;
    if (req.path.startsWith("/api")) {
      if (status === 400 && err?.type === "entity.parse.failed") {
        res.status(400).json({ success: false, error: "Invalid JSON request body.", message: "Invalid JSON request body." });
        return;
      }
      const formatted = formatAuthServerError(err, "Unexpected server error.");
      res.status(status >= 400 && status < 600 ? status : formatted.status).json({
        success: false,
        error: formatted.message,
        message: formatted.message
      });
      return;
    }
    next(err);
  });
  return app2;
}

// api/_entry.ts
var app = createApiApp();
function handler(req, res) {
  const rawUrl = req.url || "/";
  const parsed = new URL(rawUrl, "http://localhost");
  const vpath = parsed.searchParams.get("__vpath");
  if (vpath !== null) {
    parsed.searchParams.delete("__vpath");
    const qs = parsed.searchParams.toString();
    const normalizedPath = vpath.startsWith("/") ? vpath : `/${vpath}`;
    const targetPath = normalizedPath.startsWith("/api/") ? normalizedPath : `/api${normalizedPath === "/" ? "" : normalizedPath}`;
    req.url = `${targetPath}${qs ? `?${qs}` : ""}`;
  }
  return app(req, res);
}
export {
  handler as default
};
