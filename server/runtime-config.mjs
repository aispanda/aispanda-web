const RUNTIME_KEYS = [
  'RUNTIME_ENVIRONMENT',
  'RUNTIME_FIREBASE_API_KEY',
  'RUNTIME_FIREBASE_AUTH_DOMAIN',
  'RUNTIME_FIREBASE_PROJECT_ID',
  'RUNTIME_FIREBASE_STORAGE_BUCKET',
  'RUNTIME_FIREBASE_MESSAGING_SENDER_ID',
  'RUNTIME_FIREBASE_APP_ID',
  'RUNTIME_GOOGLE_CLIENT_ID',
];

const value = (environment, key) => String(environment[key] ?? '').trim();

const validateAuthDomain = (authDomain) => {
  if (!/^[a-z0-9.-]+$/i.test(authDomain) || authDomain.includes('..')) {
    throw new Error('RUNTIME_FIREBASE_AUTH_DOMAIN must be a hostname without a scheme or path.');
  }
};

export const buildRuntimePublicConfig = (environment = process.env) => {
  const hasRuntimeInput = RUNTIME_KEYS.some((key) => value(environment, key).length > 0);
  if (!hasRuntimeInput) return null;

  const missing = RUNTIME_KEYS.filter((key) => value(environment, key).length === 0);
  if (missing.length) throw new Error(`Missing runtime public configuration: ${missing.join(', ')}`);

  const runtimeEnvironment = value(environment, 'RUNTIME_ENVIRONMENT');
  if (!['staging', 'production'].includes(runtimeEnvironment)) {
    throw new Error('RUNTIME_ENVIRONMENT must be staging or production.');
  }

  const projectId = value(environment, 'RUNTIME_FIREBASE_PROJECT_ID');
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)) {
    throw new Error('RUNTIME_FIREBASE_PROJECT_ID is not a valid Google Cloud project ID.');
  }
  const ambientProject = value(environment, 'GOOGLE_CLOUD_PROJECT');
  if (ambientProject && ambientProject !== projectId) {
    throw new Error('Runtime Firebase project does not match GOOGLE_CLOUD_PROJECT.');
  }

  const authDomain = value(environment, 'RUNTIME_FIREBASE_AUTH_DOMAIN');
  validateAuthDomain(authDomain);

  return Object.freeze({
    environment: runtimeEnvironment,
    firebase: Object.freeze({
      apiKey: value(environment, 'RUNTIME_FIREBASE_API_KEY'),
      authDomain,
      projectId,
      storageBucket: value(environment, 'RUNTIME_FIREBASE_STORAGE_BUCKET'),
      messagingSenderId: value(environment, 'RUNTIME_FIREBASE_MESSAGING_SENDER_ID'),
      appId: value(environment, 'RUNTIME_FIREBASE_APP_ID'),
    }),
    googleClientId: value(environment, 'RUNTIME_GOOGLE_CLIENT_ID'),
  });
};

const serializeForInlineScript = (payload) => JSON.stringify(payload)
  .replaceAll('<', '\\u003c')
  .replaceAll('\u2028', '\\u2028')
  .replaceAll('\u2029', '\\u2029');

export const injectRuntimePublicConfig = (html, runtimeConfig) => {
  if (!runtimeConfig) return html;
  const script = `<script data-aispanda-runtime-config>globalThis.__AISPANDA_RUNTIME_CONFIG__=${serializeForInlineScript(runtimeConfig)};</script>`;
  const headStart = html.match(/<head(?:\s[^>]*)?>/i);
  if (!headStart || headStart.index === undefined) return html.startsWith(script) ? html : `${script}${html}`;
  const insertionPoint = headStart.index + headStart[0].length;
  if (html.startsWith(script, insertionPoint)) return html;
  return `${html.slice(0, insertionPoint)}${script}${html.slice(insertionPoint)}`;
};
