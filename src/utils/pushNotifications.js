import { getToken, onMessage } from 'firebase/messaging'
import { firebaseApp, getFirebaseMessaging } from '../firebase.js'

const FCM_TOKEN_KEY = 'triggerEngineFcmToken'

export async function isPushSupported() {
  if (typeof window === 'undefined') return false
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return false
  return Boolean(await getFirebaseMessaging())
}

export async function requestPushPermission() {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    throw new Error('Push notifications are not supported in this browser.')
  }

  if (Notification.permission === 'granted') return 'granted'

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error('Notification permission was not granted.')
  }
  return permission
}

export async function getFcmToken() {
  if (!firebaseApp) {
    throw new Error('Firebase is not configured.')
  }

  const messaging = await getFirebaseMessaging()
  if (!messaging) {
    throw new Error('Push notifications are not supported in this browser.')
  }

  await requestPushPermission()

  const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY
  if (!vapidKey) {
    throw new Error('Firebase VAPID key is missing.')
  }

  const token = await getToken(messaging, { vapidKey })
  if (!token) {
    throw new Error('Could not create a push token.')
  }

  saveFcmTokenToLocalStorage(token)
  return token
}

export function saveFcmTokenToLocalStorage(token) {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(FCM_TOKEN_KEY, token)
}

export function loadFcmTokenFromLocalStorage() {
  if (typeof localStorage === 'undefined') return null
  return localStorage.getItem(FCM_TOKEN_KEY)
}

export function clearFcmToken() {
  if (typeof localStorage === 'undefined') return
  localStorage.removeItem(FCM_TOKEN_KEY)
}

export async function listenForForegroundMessages(callback) {
  const messaging = await getFirebaseMessaging()
  if (!messaging) return () => {}
  return onMessage(messaging, callback)
}
