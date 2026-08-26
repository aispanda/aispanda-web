import { getApp, getApps, initializeApp } from 'firebase/app';

type RuntimePublicConfig = {
  environment: 'staging' | 'production';
  firebase: {
    apiKey: string;
    authDomain: string;
    projectId: string;
    storageBucket: string;
    messagingSenderId: string;
    appId: string;
  };
  googleClientId: string;
};

const runtimeConfig = (globalThis as typeof globalThis & {
  __AISPANDA_RUNTIME_CONFIG__?: RuntimePublicConfig;
}).__AISPANDA_RUNTIME_CONFIG__;

const buildTimeFirebaseConfig = {
  apiKey: import.meta.env.PUBLIC_FIREBASE_API_KEY,
  authDomain: import.meta.env.PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.PUBLIC_FIREBASE_APP_ID,
};

const firebaseConfig = runtimeConfig?.firebase ?? buildTimeFirebaseConfig;

export const googleClientId = runtimeConfig?.googleClientId ?? import.meta.env.PUBLIC_GOOGLE_CLIENT_ID;
export const runtimeEnvironment = runtimeConfig?.environment ?? 'static-build';

export const isFirebaseConfigured = Object.values(firebaseConfig).every(
  (value) => typeof value === 'string' && value.trim().length > 0,
) && typeof googleClientId === 'string' && googleClientId.trim().length > 0;

export const getFirebaseClientApp = () => (
  getApps().length > 0 ? getApp() : initializeApp(firebaseConfig)
);
