// Run by ../verify-egress.sh inside the backend container:
//   node check.cjs <subnet of the isolated network, e.g. 172.19.0.0/16> <canary>
// <canary> is the outside name the script tried on purpose: it must appear
// (proof the monitor sees attempts) and is the only outside name tolerated.
// Reads what the monitor recorded and fails if any lookup or connection was
// for something other than this installation's services, the loopback
// interface or an address inside the isolated network.
'use strict';
const fs = require('fs');
const [base, bits] = process.argv[2].split('/');
const CANARY = process.argv[3];
const toInt = (ip) => ip.split('.').reduce((n, part) => (n << 8) + Number(part), 0) >>> 0;
const mask = bits === '0' ? 0 : (~0 << (32 - Number(bits))) >>> 0;
const inSubnet = (ip) => /^\d+\.\d+\.\d+\.\d+$/.test(ip) && (toInt(ip) & mask) === (toInt(base) & mask);
const SERVICES = new Set(['localhost', 'db', 'backend', 'frontend', 'proxy', 'ollama']);
const allowed = (target) => {
  const host = target.replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  // 0.0.0.0 and :: are the "unspecified" address (a server resolving where it
  // listens, e.g. Next.js at startup): IP literals, never a network destination.
  const unspecified = host === '0.0.0.0' || host === '::';
  return SERVICES.has(host) || /^127\./.test(host) || host === '::1' || unspecified || inSubnet(host);
};

const events = fs
  .readdirSync('/egress')
  .filter((file) => file.endsWith('.jsonl'))
  .flatMap((file) =>
    fs
      .readFileSync(`/egress/${file}`, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => ({ ...JSON.parse(line), source: file.split('-')[0] })),
  );
const counts = new Map();
for (const e of events) {
  const key = `${e.source}: ${e.kind} ${e.target}`;
  counts.set(key, (counts.get(key) || 0) + 1);
}
for (const [key, n] of [...counts].sort((a, b) => b[1] - a[1])) {
  const target = key.split(' ').at(-1);
  const note = target.startsWith(CANARY) ? '   (control, made on purpose)' : allowed(target) ? '' : '   <-- OUTSIDE';
  console.log(`   ${String(n).padStart(4)}  ${key}${note}`);
}
if (CANARY && ![...counts.keys()].some((k) => k.split(' ').at(-1).startsWith(CANARY))) {
  console.log(`FAILED: the control attempt to ${CANARY} was not recorded: the monitor is not seeing connections.`);
  process.exit(1);
}
const outside = [...counts.keys()].filter((k) => {
  const target = k.split(' ').at(-1);
  return !allowed(target) && !(CANARY && target.startsWith(CANARY) && k.startsWith('backend:'));
});
if (!events.length) {
  console.log('FAILED: the monitor recorded nothing (did it load?).');
  process.exit(1);
}
if (outside.length) {
  console.log(`FAILED: ${outside.length} destination(s) outside this installation.`);
  process.exit(1);
}
const application = events.filter((e) => !(CANARY && e.target.startsWith(CANARY))).length;
console.log(`Passed: ${application} lookups and connections by the application, all inside this installation (network ${process.argv[2]}); the control attempt was seen.`);
