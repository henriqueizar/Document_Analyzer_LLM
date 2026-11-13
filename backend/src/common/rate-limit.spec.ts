import { RateLimiter } from './rate-limit';
import { clientIp } from './client-ip';

describe('RateLimiter', () => {
  it('allows up to the limit, per key, within the window', () => {
    const limiter = new RateLimiter(3, 60_000);
    for (let i = 0; i < 3; i++) {
      expect(limiter.allowed('a')).toBe(true);
      limiter.hit('a');
    }
    expect(limiter.allowed('a')).toBe(false);
    expect(limiter.allowed('b')).toBe(true);
    limiter.reset('a');
    expect(limiter.allowed('a')).toBe(true);
  });

  it('forgets after the window', () => {
    jest.useFakeTimers();
    const limiter = new RateLimiter(1, 1000);
    limiter.hit('a');
    expect(limiter.allowed('a')).toBe(false);
    jest.advanceTimersByTime(1001);
    expect(limiter.allowed('a')).toBe(true);
    jest.useRealTimers();
  });
});

describe('clientIp', () => {
  const req = (peer: string, forwarded?: string) =>
    ({
      socket: { remoteAddress: peer },
      headers: forwarded ? { 'x-forwarded-for': forwarded } : {},
    }) as never;

  it('uses the forwarded address when the connection comes from the proxy or the web server', () => {
    expect(clientIp(req('172.18.0.5', '192.168.0.42'))).toBe('192.168.0.42');
    expect(clientIp(req('::ffff:127.0.0.1', '10.0.0.7, 192.168.0.42'))).toBe(
      '192.168.0.42',
    );
  });

  it('ignores a forwarded address sent directly by a client on the internet', () => {
    expect(clientIp(req('203.0.113.9', '127.0.0.1'))).toBe('203.0.113.9');
  });

  it('uses the connection address when nothing is forwarded', () => {
    expect(clientIp(req('::ffff:192.168.0.42'))).toBe('192.168.0.42');
  });
});
