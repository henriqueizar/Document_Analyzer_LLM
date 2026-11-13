import type { Request } from 'express';
import { classifyAddress } from './destinations';

/**
 * The address of the person making the request. Behind the proxy (and the web
 * server, for sign-in) the connection comes from an internal address, which
 * forwards the real one in X-Forwarded-For; that header is only trusted when
 * the connection itself is internal, so a browser cannot fake its address.
 */
export function clientIp(req: Pick<Request, 'headers' | 'socket'>): string {
  const peer = (req.socket?.remoteAddress ?? '').replace(/^::ffff:/, '');
  const internal = peer !== '' && classifyAddress(peer) !== 'public';
  const forwarded = req.headers['x-forwarded-for'];
  if (internal && typeof forwarded === 'string' && forwarded.trim()) {
    // the entry added by the nearest proxy is the last one
    const last = forwarded
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .at(-1);
    if (last) return last.replace(/^::ffff:/, '');
  }
  return peer || 'unknown';
}
