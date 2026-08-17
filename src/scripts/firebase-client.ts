import { getApp, getApps, initializeApp } from 'firebase/app';

const firebaseConfig = {
  apiKey: import.meta.env.PUBLIC_FIREBASE_API_KEY,
  authDomain: import.meta.env.PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.PUBLIC_FIREBASE_APP_ID,
};

export const googleClientId = import.meta.env.PUBLIC_GOOGLE_CLIENT_ID;

export const isFirebaseConfigured = Object.values(firebaseConfig).every(
  (value) => typeof value === 'string' && value.trim().length > 0,
) && typeof googleClientId === 'string' && googleClientId.trim().length > 0;

export const getFirebaseClientApp = () => (
  getApps().length > 0 ? getApp() : initializeApp(firebaseConfig)
);
