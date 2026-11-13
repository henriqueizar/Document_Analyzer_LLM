import { hashPassword, passwordProblem, verifyPassword } from './password';

describe('password hashing', () => {
  it('verifies the right password and rejects a wrong one', async () => {
    const stored = await hashPassword('correct horse battery');
    expect(stored).toMatch(/^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    expect(stored).not.toContain('correct horse battery');
    await expect(verifyPassword('correct horse battery', stored)).resolves.toBe(true);
    await expect(verifyPassword('wrong password', stored)).resolves.toBe(false);
  });

  it('uses a random salt (same password, different hashes)', async () => {
    expect(await hashPassword('same-password')).not.toBe(await hashPassword('same-password'));
  });

  it('rejects accounts without a password and malformed hashes', async () => {
    await expect(verifyPassword('anything', null)).resolves.toBe(false);
    await expect(verifyPassword('anything', 'plain-text')).resolves.toBe(false);
  });

  it('requires at least 10 characters', () => {
    expect(passwordProblem('short')).toMatch(/at least 10/);
    expect(passwordProblem('9 letters')).toMatch(/at least 10/);
    expect(passwordProblem('long enough')).toBeNull();
  });

  it('refuses passwords attackers try first', () => {
    for (const weak of ['1234567890', 'senha123456', 'Password123', 'aaaaaaaaaaaa', '12345678901234567890']) {
      expect(passwordProblem(weak)).toMatch(/too common/);
    }
    expect(passwordProblem('cavalo-bateria-grampo')).toBeNull();
  });
});
