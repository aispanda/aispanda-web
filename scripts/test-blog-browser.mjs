import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const env = { ...process.env, CI: 'true', XDG_CONFIG_HOME: fileURLToPath(new URL('../.test-config', import.meta.url)) };
delete env.GOOGLE_APPLICATION_CREDENTIALS;
const child = spawn(process.execPath, ['node_modules/firebase-tools/lib/bin/firebase.js', 'emulators:exec', '--only', 'auth,firestore', '--project', 'demo-blog-community', '--config', 'firebase.blog-test.json', 'node --test tests/blog-adoption.test.mjs'], { cwd: root, env, stdio: 'inherit', windowsHide: true });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
