import { notificationApi } from '../api/endpoints.js';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export function isPushSupported() {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

// iOS/iPadOS Safari only exposes Web Push to a PWA that's been added to the
// Home Screen (running in standalone display mode) — spec §2A.
export function isIosStandalone() {
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone = window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
  return { isIos, isStandalone };
}

export function needsHomeScreenInstall() {
  const { isIos, isStandalone } = isIosStandalone();
  return isIos && !isStandalone;
}

export function getPermissionState() {
  if (!isPushSupported()) return 'unsupported';
  return Notification.permission; // 'default' | 'granted' | 'denied'
}

/**
 * Requests permission (if not already decided) and, if granted, subscribes
 * this device with the Push API and registers it with the server. Never
 * throws — in-app notifications work regardless of push, per spec §25.
 */
export async function enablePush() {
  if (!isPushSupported()) return { ok: false, reason: 'unsupported' };
  if (needsHomeScreenInstall()) return { ok: false, reason: 'ios-needs-install' };

  let permission = Notification.permission;
  if (permission === 'default') permission = await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, reason: permission };

  try {
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      const { data } = await notificationApi.vapidPublicKey();
      if (!data.publicKey) return { ok: false, reason: 'no-server-key' };
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(data.publicKey),
      });
    }

    const json = subscription.toJSON();
    await notificationApi.subscribePush({ endpoint: json.endpoint, keys: json.keys, userAgent: navigator.userAgent });
    return { ok: true };
  } catch (err) {
    console.error('[push] subscribe failed', err);
    return { ok: false, reason: 'subscribe-failed' };
  }
}

export async function disablePush() {
  if (!isPushSupported()) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      await notificationApi.unsubscribePush(subscription.endpoint).catch(() => {});
      await subscription.unsubscribe();
    }
  } catch (err) {
    console.error('[push] unsubscribe failed', err);
  }
}
