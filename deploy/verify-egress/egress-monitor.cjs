/**
 * Loaded into the backend and frontend processes during ./verify-egress.sh
 * (NODE_OPTIONS=--require). Records every DNS lookup and every TCP/TLS
 * connection the process ATTEMPTS, before the network has a chance to block
 * it, so a connection that would fail silently on the isolated network is
 * still seen. It never changes what the application does.
 *
 * Out of its reach: native code that opens sockets itself (Prisma's query
 * engine, which only talks to the database); the isolated Docker network
 * still confines that.
 */
'use strict';
const net = require('net');
const dns = require('dns');
const fs = require('fs');

const OUT = `/egress/${process.env.EGRESS_NAME || 'process'}-${process.pid}.jsonl`;

function record(kind, target) {
  try {
    fs.appendFileSync(OUT, JSON.stringify({ kind, target, at: new Date().toISOString() }) + '\n');
  } catch {
    // never break the application
  }
}

function describe(args) {
  const [a, b] = args;
  if (a && typeof a === 'object' && !Array.isArray(a)) {
    if (a.path) return { path: a.path };
    return { host: a.host || a.hostname || 'localhost', port: a.port };
  }
  if (typeof a === 'string' && Number.isNaN(Number(a))) return { path: a };
  return { host: typeof b === 'string' ? b : 'localhost', port: a };
}

const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const target = describe(Array.isArray(args[0]) ? args[0] : args);
  if (!target.path) record('connect', `${target.host}:${target.port}`);
  return connect.apply(this, args);
};

const lookup = dns.lookup;
dns.lookup = function (hostname, ...rest) {
  record('dns', String(hostname));
  return lookup.call(this, hostname, ...rest);
};
const promiseLookup = dns.promises.lookup;
dns.promises.lookup = function (hostname, ...rest) {
  record('dns', String(hostname));
  return promiseLookup.call(this, hostname, ...rest);
};
for (const method of ['resolve', 'resolve4', 'resolve6', 'resolveAny']) {
  const original = dns[method];
  dns[method] = function (hostname, ...rest) {
    record('dns', String(hostname));
    return original.call(this, hostname, ...rest);
  };
}
