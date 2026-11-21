export interface ExtendedScreenInfo {
  availLeft: number;
  availTop: number;
  availWidth: number;
  availHeight: number;
  left: number;
  top: number;
  width: number;
  height: number;
  isPrimary?: boolean;
  isInternal?: boolean;
  label?: string;
}

export interface ScreenDetailsLike {
  screens: ExtendedScreenInfo[];
  currentScreen: ExtendedScreenInfo;
}

export interface ClassroomSyncPayload {
  active: boolean;
  geoPending?: boolean;
  baseUrl: string;
  courseName: string;
  courseId?: string;
  selectedWeek: string;
  isOfflineMode: boolean;
  isGeoEnabled: boolean;
  teacherLocation: { lat: number; lng: number } | null;
  qrErrorCorrection: 'L' | 'M' | 'Q' | 'H';
  qrMargin: number;
  qrToken?: string;
  qrTokenIat?: number;
  qrTokenExpiresAt?: number;
  pinRequired?: boolean;
  classroomPin?: string;
  pinDisplayMode?: 'hidden' | 'flash' | 'visible';
  pinVisibleUntil?: number;
  updatedAt: number;
}

export const CLASSROOM_CHANNEL_NAME = 'smart-attendance-classroom-sync';
export const CLASSROOM_STORAGE_KEY = 'smart-attendance-classroom-state-v1';
export const DEMO_CLASSROOM_CHANNEL_NAME = 'smart-attendance-classroom-sync-demo';
export const DEMO_CLASSROOM_STORAGE_KEY = 'smart-attendance-classroom-state-demo-v1';

export function isDemoClassroomMode(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('demo') === '1';
}

export function getClassroomChannelName(): string {
  return isDemoClassroomMode() ? DEMO_CLASSROOM_CHANNEL_NAME : CLASSROOM_CHANNEL_NAME;
}

export function getClassroomStorageKey(): string {
  return isDemoClassroomMode() ? DEMO_CLASSROOM_STORAGE_KEY : CLASSROOM_STORAGE_KEY;
}

export function buildAttendanceQrUrl(params: {
  baseUrl: string;
  selectedWeek: string;
  courseName?: string;
  courseId?: string;
  isOfflineMode?: boolean;
  isGeoEnabled?: boolean;
  teacherLocation?: { lat: number; lng: number } | null;
  qrToken?: string;
  qrTokenIat?: number;
  pinRequired?: boolean;
}): string {
  const issuedAt = params.qrTokenIat || Date.now();
  let query = `t=${issuedAt}&w=${encodeURIComponent(params.selectedWeek || 'W1')}`;
  if (params.qrToken) {
    query += `&sig=${encodeURIComponent(params.qrToken)}`;
  }
  if (params.pinRequired) {
    query += '&pin=1';
  }
  if (params.courseName) {
    query += `&c=${encodeURIComponent(params.courseName)}`;
    if (params.courseId) {
      query += `&cid=${encodeURIComponent(params.courseId)}`;
    }
  }
  if (params.isOfflineMode) {
    query += '&offline=true';
  }
  if (params.isGeoEnabled && params.teacherLocation) {
    query += `&lat=${params.teacherLocation.lat.toFixed(6)}&lng=${params.teacherLocation.lng.toFixed(6)}&rad=150`;
  }
  return `${params.baseUrl}?${query}`;
}

export function buildStandaloneClassroomUrl(payload: ClassroomSyncPayload): string {
  const url = new URL(payload.baseUrl || (window.location.origin + window.location.pathname));
  url.search = '';
  url.searchParams.set('view', 'classroom');
  url.searchParams.set('w', payload.selectedWeek || 'W1');
  if (payload.courseName) url.searchParams.set('c', payload.courseName);
  if (payload.courseId) url.searchParams.set('cid', payload.courseId);
  if (payload.isOfflineMode) url.searchParams.set('offline', 'true');
  if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('demo') === '1') {
    url.searchParams.set('demo', '1');
  }
  if (payload.isGeoEnabled && payload.teacherLocation) {
    url.searchParams.set('lat', payload.teacherLocation.lat.toFixed(6));
    url.searchParams.set('lng', payload.teacherLocation.lng.toFixed(6));
    url.searchParams.set('rad', '150');
  }
  return url.toString();
}

export function isExtendedScreenReported(): boolean {
  if (typeof window === 'undefined' || !window.screen) return false;
  return Boolean((window.screen as Screen & { isExtended?: boolean }).isExtended);
}

export async function getScreenDetailsSafe(): Promise<ScreenDetailsLike | null> {
  if (typeof window === 'undefined') return null;
  const winWithScreens = window as unknown as {
    getScreenDetails?: () => Promise<ScreenDetailsLike>;
  };
  if (typeof winWithScreens.getScreenDetails !== 'function') {
    return null;
  }
  try {
    return await winWithScreens.getScreenDetails();
  } catch {
    return null;
  }
}

export async function prefetchGrantedScreenDetails(): Promise<ScreenDetailsLike | null> {
  if (typeof window === 'undefined') return null;
  const winWithScreens = window as unknown as {
    getScreenDetails?: () => Promise<ScreenDetailsLike>;
  };
  if (typeof winWithScreens.getScreenDetails !== 'function') {
    return null;
  }
  try {
    if (navigator.permissions?.query) {
      const status = await navigator.permissions.query({
        name: 'window-management' as PermissionName,
      });
      if (status.state !== 'granted') {
        return null;
      }
    } else {
      return null;
    }
    return await winWithScreens.getScreenDetails();
  } catch {
    return null;
  }
}

export function pickExtendedScreen(details: ScreenDetailsLike | null): ExtendedScreenInfo | null {
  if (!details || !Array.isArray(details.screens) || details.screens.length <= 1) {
    return null;
  }
  const current = details.currentScreen;
  return (
    details.screens.find((s) => s !== current && s.isPrimary === false) ||
    details.screens.find((s) => s !== current) ||
    null
  );
}

export function openExtendedClassroomWindow(
  classroomUrl: string,
  extendedScreen: ExtendedScreenInfo
): Window | null {
  const left = Math.round(extendedScreen.availLeft ?? extendedScreen.left ?? 0);
  const top = Math.round(extendedScreen.availTop ?? extendedScreen.top ?? 0);
  const width = Math.max(480, Math.round(extendedScreen.availWidth || extendedScreen.width || 1280));
  const height = Math.max(360, Math.round(extendedScreen.availHeight || extendedScreen.height || 720));
  const features = `popup=yes,fullscreen=yes,left=${left},top=${top},width=${width},height=${height}`;

  try {
    const popup = window.open(classroomUrl, 'SmartAttendanceClassroomView', features);
    if (!popup || popup.closed) {
      return null;
    }
    try {
      popup.moveTo(left, top);
      popup.resizeTo(width, height);
      popup.focus();
    } catch {
      // Some browsers restrict moveTo/resizeTo after placement; features already positioned it.
    }
    return popup;
  } catch {
    return null;
  }
}

export async function requestAdaptiveFullscreen(preferredScreen?: ExtendedScreenInfo | null): Promise<boolean> {
  if (typeof document === 'undefined' || !document.documentElement?.requestFullscreen) {
    return false;
  }
  try {
    if (preferredScreen) {
      await (
        document.documentElement.requestFullscreen as unknown as (opts?: {
          screen?: ExtendedScreenInfo;
        }) => Promise<void>
      )({ screen: preferredScreen });
      return true;
    }
    await document.documentElement.requestFullscreen();
    return true;
  } catch {
    if (preferredScreen) {
      try {
        await document.documentElement.requestFullscreen();
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
}

export function publishClassroomSyncState(payload: ClassroomSyncPayload): void {
  try {
    localStorage.setItem(getClassroomStorageKey(), JSON.stringify(payload));
  } catch {
    // Ignore storage quota errors
  }
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      const ch = new BroadcastChannel(getClassroomChannelName());
      ch.postMessage({ type: 'CLASSROOM_STATE_UPDATE', payload });
      ch.close();
    } catch {
      // Ignore channel errors
    }
  }
}

export function readClassroomSyncState(): ClassroomSyncPayload | null {
  try {
    const raw = localStorage.getItem(getClassroomStorageKey());
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ClassroomSyncPayload;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function postClassroomWindowClosed(): void {
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      const ch = new BroadcastChannel(getClassroomChannelName());
      ch.postMessage({ type: 'CLASSROOM_WINDOW_CLOSED' });
      ch.close();
    } catch {
      // Ignore
    }
  }
}
