/* eslint-disable no-undef */
/* global firebase */

// Firebase Cloud Messaging service worker.
// Paste the same Firebase web app config values used in your .env file below.
// This file runs outside Vite, so it cannot read import.meta.env values.

importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js')

firebase.initializeApp({
  apiKey: "AIzaSyAD9hpgLHxGMdgqVFPQTkufQsI59PtK7AE",
  authDomain: "trigger-engine.firebaseapp.com",
  projectId: "trigger-engine",
  storageBucket: "trigger-engine.firebasestorage.app",
  messagingSenderId: "1058063235212",
  appId: "1:1058063235212:web:8b7b95c4742a43b86323a9",
});

const messaging = firebase.messaging()

messaging.onBackgroundMessage((payload) => {
  console.log("Background message received:", payload);

  const title =
    payload.notification?.title ||
    payload.data?.title ||
    "Trigger Engine";

  const body =
    payload.notification?.body ||
    payload.data?.body ||
    payload.data?.message ||
    "Time for a small movement reset.";

  self.registration.showNotification(title, {
    body,
    icon: '/vite.svg',
    badge: '/vite.svg',
    data: {
      url: payload.fcmOptions?.link || payload.data?.url || '/',
    },
  })
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || '/'
  event.waitUntil(clients.openWindow(url))
})
