import { getApp, getApps, initializeApp } from 'firebase/app';
import { browserLocalPersistence, browserPopupRedirectResolver, initializeAuth } from 'firebase/auth';

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

// The same image is staged and promoted. Never bake production Firebase facts into it.
const firebaseConfig = runtimeConfig?.firebase;

export const googleClientId = runtimeConfig?.googleClientId;
export const runtimeEnvironment = runtimeConfig?.environment ?? 'static-build';

export const isFirebaseConfigured = Boolean(firebaseConfig && Object.values(firebaseConfig).every(
  (value) => typeof value === 'string' && value.trim().length > 0,
) && typeof googleClientId === 'string' && googleClientId.trim().length > 0);

export const getFirebaseClientApp = () => {
  if (!isFirebaseConfigured || !firebaseConfig) throw new Error('Account services require the site runtime configuration.');
  const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  // Match the installed editorial runtime before Auth reads the shared session.
  try {
    initializeAuth(app, { persistence: browserLocalPersistence, popupRedirectResolver: browserPopupRedirectResolver });
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'auth/already-initialized')) throw error;
  }
  return app;
};
