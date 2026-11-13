import { UsersService } from './users.service';

/** Minimal in-memory stand-in for the Prisma user table. */
function fakePrisma() {
  const rows: Record<string, unknown>[] = [];
  let seq = 0;
  const match = (
    row: Record<string, unknown>,
    where: Record<string, unknown> = {},
  ) =>
    Object.entries(where).every(([k, v]) =>
      v && typeof v === 'object' && 'not' in v
        ? row[k] !== (v as { not: unknown }).not
        : row[k] === v,
    );
  return {
    rows,
    user: {
      count: jest.fn(
        async ({ where }) => rows.filter((r) => match(r, where)).length,
      ),
      findUnique: jest.fn(
        async ({ where }) => rows.find((r) => match(r, where)) ?? null,
      ),
      findMany: jest.fn(async () => [...rows]),
      create: jest.fn(async ({ data }) => {
        const row = {
          id: `u${++seq}`,
          createdAt: new Date(),
          name: null,
          passwordHash: null,
          role: 'USER',
          ...data,
        };
        rows.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }) => {
        const row = rows.find((r) => match(r, where))!;
        Object.assign(row, data);
        return row;
      }),
    },
  };
}

describe('UsersService', () => {
  let prisma: ReturnType<typeof fakePrisma>;
  let users: UsersService;
  const admin = {
    name: 'Ana Admin',
    email: 'Ana@Example.com',
    password: 'admin-password',
  };

  beforeEach(() => {
    prisma = fakePrisma();

    users = new UsersService(prisma as any, { record: jest.fn() } as any);
  });

  describe('first-run setup', () => {
    it('needs setup until an administrator with a password exists', async () => {
      await expect(users.needsSetup()).resolves.toBe(true);
      const created = await users.createFirstAdmin(admin);
      expect(created).toMatchObject({
        email: 'ana@example.com',
        role: 'ADMIN',
        active: true,
      });
      expect(created).not.toHaveProperty('passwordHash');
      await expect(users.needsSetup()).resolves.toBe(false);
    });

    it('refuses a second setup', async () => {
      await users.createFirstAdmin(admin);
      await expect(
        users.createFirstAdmin({ ...admin, email: 'other@example.com' }),
      ).rejects.toThrow(/already exists/);
    });

    it('turns an account from before local login into the admin, keeping its id (and documents)', async () => {
      prisma.rows.push({
        id: 'old',
        email: 'ana@example.com',
        name: null,
        passwordHash: null,
        role: 'USER',
        createdAt: new Date(),
      });
      const created = await users.createFirstAdmin(admin);
      expect(created.id).toBe('old');
      expect(created.role).toBe('ADMIN');
    });
  });

  describe('login', () => {
    beforeEach(async () => {
      await users.createFirstAdmin(admin);
    });

    it('accepts the right password (e-mail is case-insensitive)', async () => {
      await expect(
        users.authenticate(' ANA@example.com ', 'admin-password'),
      ).resolves.toMatchObject({
        role: 'ADMIN',
      });
    });

    it('gives the same message for a wrong password and an unknown e-mail', async () => {
      await expect(
        users.authenticate('ana@example.com', 'nope-nope'),
      ).rejects.toThrow('Incorrect e-mail or password.');
      await expect(
        users.authenticate('ghost@example.com', 'nope-nope'),
      ).rejects.toThrow('Incorrect e-mail or password.');
    });

    it('blocks an e-mail after 5 failed attempts, even with the right password', async () => {
      for (let i = 0; i < 5; i++) {
        await expect(
          users.authenticate('ana@example.com', 'wrong-password'),
        ).rejects.toThrow();
      }
      await expect(
        users.authenticate('ana@example.com', 'admin-password'),
      ).rejects.toThrow(/Too many failed attempts/);
    });

    it('accounts without a password cannot sign in', async () => {
      prisma.rows.push({
        id: 'g',
        email: 'google@example.com',
        name: null,
        passwordHash: null,
        role: 'USER',
        createdAt: new Date(),
      });
      await expect(
        users.authenticate('google@example.com', ''),
      ).rejects.toThrow('Incorrect e-mail or password.');
    });
  });

  describe('administration', () => {
    it('validates new users with messages meant for the screen', async () => {
      await expect(
        users.create({
          name: 'Bob',
          email: 'not-an-email',
          password: 'password1',
        }),
      ).rejects.toThrow('Enter a valid e-mail address.');
      await expect(
        users.create({
          name: ' ',
          email: 'bob@example.com',
          password: 'password1',
        }),
      ).rejects.toThrow('Enter a name.');
      await expect(
        users.create({
          name: 'Bob',
          email: 'bob@example.com',
          password: 'short',
        }),
      ).rejects.toThrow(/at least 8 characters/);
    });

    it('creates regular users by default and refuses duplicates', async () => {
      const bob = await users.create({
        name: 'Bob',
        email: 'bob@example.com',
        password: 'password1',
      });
      expect(bob.role).toBe('USER');
      await expect(
        users.create({
          name: 'Bob 2',
          email: 'BOB@example.com',
          password: 'password2',
        }),
      ).rejects.toThrow('A user with this e-mail already exists.');
    });

    it('resets a password', async () => {
      const bob = await users.create({
        name: 'Bob',
        email: 'bob@example.com',
        password: 'password1',
      });
      await users.resetPassword(bob.id, 'new-password');
      await expect(
        users.authenticate('bob@example.com', 'new-password'),
      ).resolves.toBeTruthy();
    });

    it('changing your own password requires the current one', async () => {
      await users.create({
        name: 'Bob',
        email: 'bob@example.com',
        password: 'password1',
      });
      await expect(
        users.changeOwnPassword('bob@example.com', 'wrong', 'password2'),
      ).rejects.toThrow('The current password is incorrect.');
      await users.changeOwnPassword(
        'bob@example.com',
        'password1',
        'password2',
      );
      await expect(
        users.authenticate('bob@example.com', 'password2'),
      ).resolves.toBeTruthy();
    });
  });

  describe('privacy notice', () => {
    it('is pending for a new user and recorded once accepted', async () => {
      await users.createFirstAdmin(admin);
      expect((await users.me('ana@example.com')).privacyAcceptedAt).toBeNull();
      const accepted = await users.acceptPrivacyNotice('ana@example.com');
      expect(accepted.privacyAcceptedAt).toBeInstanceOf(Date);
    });
  });

  describe('language', () => {
    it('new accounts get the installation language; users can change theirs', async () => {
      const created = await users.createFirstAdmin(admin);
      expect(created.language).toBe('pt');
      await expect(
        users.setLanguage('ana@example.com', 'en'),
      ).resolves.toMatchObject({ language: 'en' });
      await expect(users.setLanguage('ana@example.com', 'fr')).rejects.toThrow(
        'Language must be "pt" or "en".',
      );
    });
  });
});
