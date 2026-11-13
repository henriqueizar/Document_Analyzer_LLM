// Plays the users' browser during ./verify-egress.sh, over real HTTPS through
// the proxy: setup, sign-in through the web server (NextAuth), upload with OCR,
// explanation, question, pages and the admin panel. Exits non-zero on failure.
import { readFileSync } from 'node:fs';

const BASE = 'https://proxy';
const jar = new Map();
const cookies = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
async function call(path, init = {}) {
  const headers = new Headers(init.headers);
  if (jar.size) headers.set('cookie', cookies());
  const res = await fetch(BASE + path, { ...init, headers, redirect: 'manual' });
  for (const c of res.headers.getSetCookie()) {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    jar.set(pair.slice(0, i), pair.slice(i + 1));
  }
  return res;
}
const step = (what) => console.log(`  - ${what}`);
const expectOk = async (res, what) => {
  if (!res.ok && !(res.status >= 300 && res.status < 400)) throw new Error(`${what}: HTTP ${res.status} ${await res.text()}`);
  return res;
};

const EMAIL = 'admin@verify.local';
const PASSWORD = 'verify-password-123';

step('first page (server-rendered by the frontend)');
await expectOk(await call('/'), 'home');
step('create the administrator');
await expectOk(
  await call('/backend/auth/setup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Verify', email: EMAIL, password: PASSWORD }) }),
  'setup',
);
step('sign in through the web server (NextAuth)');
const { csrfToken } = await (await expectOk(await call('/api/auth/csrf'), 'csrf')).json();
await expectOk(
  await call('/api/auth/callback/credentials', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrfToken, email: EMAIL, password: PASSWORD, json: 'true', callbackUrl: BASE }),
  }),
  'sign-in',
);
const { token } = await (await expectOk(await call('/api/backend-token'), 'backend token')).json();
if (!token) throw new Error('no backend token: sign-in failed');
const auth = { authorization: `Bearer ${token}` };

step('upload a PDF (read with OCR / text layer in the backend)');
const form = new FormData();
form.append('file', new Blob([readFileSync('/fixtures/contrato-exemplo.pdf')], { type: 'application/pdf' }), 'contrato-exemplo.pdf');
const doc = await (await expectOk(await call('/backend/documents/upload', { method: 'POST', headers: auth, body: form }), 'upload')).json();
step('wait for reading and the explanation');
let data;
for (let i = 0; i < 120; i++) {
  data = await (await call(`/backend/documents/${doc.id}`, { headers: auth })).json();
  const d = data.document;
  if (d.status === 'FAILED') throw new Error(`reading failed: ${d.failureReason}`);
  if (d.status === 'COMPLETED' && d.explanationStatus === 'COMPLETED') break;
  await new Promise((r) => setTimeout(r, 1000));
}
if (!data.interactions.some((i) => i.role === 'EXPLANATION')) throw new Error('no explanation');
step('ask a question');
const answer = await (
  await expectOk(
    await call(`/backend/documents/${doc.id}/ask`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ question: 'Qual é o valor mensal?' }) }),
    'ask',
  )
).json();
if (!/12\.500,00/.test(answer.answer)) throw new Error(`unexpected answer: ${answer.answer}`);
step('open the pages and the admin panel');
for (const page of ['/documents', `/documents/${doc.id}`, '/admin', '/privacy', '/account', '/users']) {
  await expectOk(await call(page), page);
}
await expectOk(await call(`/backend/documents/${doc.id}/file`, { headers: auth }), 'file');
await expectOk(await call('/backend/admin/overview', { headers: auth }), 'admin overview');
console.log('  full flow completed');
