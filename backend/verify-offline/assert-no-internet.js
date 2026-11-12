// Fails if the container CAN reach the internet: the verification would be
// meaningless on a network that is not isolated.
const dns = require('dns').promises;
const net = require('net');

const attempts = [
  ['DNS lookup of example.com', () => dns.lookup('example.com')],
  ['TCP connection to 1.1.1.1:443', () => connect('1.1.1.1', 443)],
  ['HTTPS request to https://example.com', () => fetch('https://example.com', { signal: AbortSignal.timeout(5000) })],
];

function connect(host, port) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port, timeout: 5000 });
    socket.once('connect', () => { socket.destroy(); resolve(); });
    socket.once('timeout', () => { socket.destroy(); reject(new Error('timeout')); });
    socket.once('error', reject);
  });
}

(async () => {
  let reachable = false;
  for (const [label, attempt] of attempts) {
    try {
      await attempt();
      console.log(`   FAIL  ${label} succeeded: the network is NOT isolated`);
      reachable = true;
    } catch (error) {
      console.log(`   ok    ${label} blocked (${error.code || error.message})`);
    }
  }
  if (reachable) {
    console.error('This container can reach the internet, so the check would prove nothing. Aborting.');
    process.exit(1);
  }
})();
