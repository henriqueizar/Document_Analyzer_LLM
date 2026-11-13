/**
 * End-to-end test of the main flow over HTTP:
 *   upload -> background processing (real OCR) -> get -> ask, plus auth and error paths.
 *
 * Requires the Postgres container (`docker compose up -d postgres`) and
 * DATABASE_URL (read from backend/.env if present). The LLM is replaced by a
 * stub so the test is deterministic and needs no Ollama/GPU.
 */
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SignJWT } from 'jose';
import { join, resolve } from 'path';
import { existsSync } from 'fs';
import { unlink } from 'fs/promises';
import { AppModule } from '../src/app.module';
import { LlmService } from '../src/llm/llm.service';
import { JWT_AUDIENCE, JWT_ISSUER } from '../src/auth/auth.constants';
import { PrismaService } from '../src/prisma/prisma.service';
import { hashPassword } from '../src/auth/password';
import { ProcessingService } from '../src/documents/processing.service';

try {
  process.loadEnvFile();
} catch {
  // rely on the process environment
}
process.env.BACKEND_JWT_SECRET = 'e2e-secret-that-is-at-least-32-characters-long';

const fixture = (name: string) => join(__dirname, 'fixtures', name);
const runId = Date.now();
const ALICE = `alice-${runId}@example.com`;
const MALLORY = `mallory-${runId}@example.com`;

const llmStub = {
  explainDocument: jest.fn(async (doc: { text: string }) => ({
    text: `EXPLANATION OF: ${doc.text.slice(0, 40)} [p. 1]`,
    sources: [{ page: 1, text: doc.text.slice(0, 200) }],
  })),
  translate: jest.fn(async (text: string, to: string) => ({ text: `[${to}] ${text}`, verified: true })),
  status: jest.fn(async () => ({ model: 'stub', url: 'http://localhost:11434', reachable: true, modelInstalled: true })),
  askQuestion: jest.fn(async (_doc: unknown, question: string) => ({
    text: `ANSWER TO: ${question}`,
    sources: [{ page: 3, text: 'PAGE 3 DUE DATE DECEMBER' }],
  })),
};

function tokenFor(email: string) {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(email)
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(process.env.BACKEND_JWT_SECRET));
}

jest.setTimeout(120_000);

/**
 * The e2e tests share the development database, so everything they create is
 * removed at the end: this run's data and leftovers of earlier runs. Only data
 * the tests create is matched: users on the reserved example.com domain with a
 * run timestamp, and the teams named after a run.
 */
const TEST_USER = /^(alice|mallory|ghost|admin|admin2|admin3|bruna|carlos|dora|eva|fabio|gustavo)-\d{13}@example\.com$/;
const TEST_TEAM = /^(Jurídico|RH|Financeiro|Diretoria) \d{13}$/;

async function removeTestData(prisma: PrismaService) {
  const users = (await prisma.user.findMany({ where: { email: { endsWith: '@example.com' } }, select: { id: true, email: true } }))
    .filter((u) => TEST_USER.test(u.email))
    .map((u) => u.id);
  const documents = await prisma.document.findMany({ where: { userId: { in: users } }, select: { id: true, filePath: true } });
  const documentIds = documents.map((d) => d.id);
  await prisma.llmInteraction.deleteMany({ where: { OR: [{ documentId: { in: documentIds } }, { userId: { in: users } }] } });
  await prisma.document.deleteMany({ where: { id: { in: documentIds } } });
  const teams = (await prisma.team.findMany({ select: { id: true, name: true } })).filter((t) => TEST_TEAM.test(t.name));
  await prisma.team.deleteMany({ where: { id: { in: teams.map((t) => t.id) } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  const events = (await prisma.auditEvent.findMany({ where: { actorEmail: { endsWith: '@example.com' } }, select: { id: true, actorEmail: true } }))
    .filter((e) => TEST_USER.test(e.actorEmail))
    .map((e) => e.id);
  await prisma.auditEvent.deleteMany({ where: { id: { in: events } } });
  await Promise.all(documents.map((d) => unlink(resolve(d.filePath)).catch(() => undefined)));
}

describe('Documents API (e2e)', () => {
  let app: INestApplication;
  let alice: string;
  let mallory: string;
  /** Waits until the background queue has processed everything uploaded so far. */
  const processed = () => app.get(ProcessingService).idle();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LlmService)
      .useValue(llmStub)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    // Local accounts: the guard only accepts tokens of existing, active users.
    const prisma = app.get(PrismaService);
    const passwordHash = await hashPassword('e2e-password');
    for (const email of [ALICE, MALLORY]) {
      await prisma.user.create({ data: { email, name: email.split('@')[0], passwordHash } });
    }
    alice = `Bearer ${await tokenFor(ALICE)}`;
    mallory = `Bearer ${await tokenFor(MALLORY)}`;
  });

  afterAll(async () => {
    await processed();
    await removeTestData(app.get(PrismaService));
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  it('main flow: upload -> background processing -> get -> ask (multi-page PDF)', async () => {
    const upload = await http()
      .post('/documents/upload')
      .set('Authorization', alice)
      .attach('file', fixture('three-pages.pdf'))
      .expect(201);
    const id = upload.body.id;
    expect(upload.body.status).toBe('PENDING');
    expect(upload.body).not.toHaveProperty('filePath');

    // Upload returns at once; reading and explaining happen in the background.
    await processed();

    const doc = await http().get(`/documents/${id}`).set('Authorization', alice).expect(200);
    expect(doc.body.document.status).toBe('COMPLETED');
    expect(doc.body.document.explanationStatus).toBe('COMPLETED');
    expect(doc.body.document.extractedText).toMatch(/PAGE 1/);
    expect(doc.body.document.extractedText).toMatch(/PAGE 3/);
    expect(doc.body.interactions).toEqual([
      expect.objectContaining({ role: 'EXPLANATION', sources: [expect.objectContaining({ page: 1 })] }),
    ]);

    const ask = await http()
      .post(`/documents/${id}/ask`)
      .set('Authorization', alice)
      .send({ question: 'What is the due date?' })
      .expect(201);
    expect(ask.body).toMatchObject({ role: 'QUESTION', answer: 'ANSWER TO: What is the due date?' });
    expect(ask.body.sources).toEqual([{ page: 3, text: 'PAGE 3 DUE DATE DECEMBER' }]);
    expect(ask.body.mode).toBe('STRICT');

    // interpretation only when explicitly requested, and stored as such
    const interpreted = await http()
      .post(`/documents/${id}/ask`)
      .set('Authorization', alice)
      .send({ question: 'Is the due date reasonable?', interpret: true })
      .expect(201);
    expect(interpreted.body.mode).toBe('INTERPRETATION');
    expect(llmStub.askQuestion).toHaveBeenLastCalledWith(expect.anything(), 'Is the due date reasonable?', expect.any(Array), 'INTERPRETATION', 'pt');
    // anything but a literal true is a normal (strict) question
    const strict = await http()
      .post(`/documents/${id}/ask`)
      .set('Authorization', alice)
      .send({ question: 'And the total?', interpret: 'yes' })
      .expect(201);
    expect(strict.body.mode).toBe('STRICT');

    const list = await http().get('/documents').set('Authorization', alice).expect(200);
    expect(list.body.map((d: { id: string }) => d.id)).toContain(id);

    await http()
      .get(`/documents/${id}/file`)
      .set('Authorization', alice)
      .expect(200)
      .expect('Content-Type', /application\/pdf/);
  });

  it('image upload is OCR\'d', async () => {
    const { body } = await http()
      .post('/documents/upload')
      .set('Authorization', alice)
      .attach('file', fixture('receipt.png'))
      .expect(201);
    await processed();
    const doc = await http().get(`/documents/${body.id}`).set('Authorization', alice).expect(200);
    expect(doc.body.document.extractedText).toMatch(/RECEIPT TOTAL 42/);
  });

  describe('authentication and isolation', () => {
    let aliceDoc: string;

    beforeAll(async () => {
      const { body } = await http()
        .post('/documents/upload')
        .set('Authorization', alice)
        .attach('file', fixture('doc-a.pdf'))
        .expect(201);
      aliceDoc = body.id;
    });

    it('401 without a token, including the old user-id header', async () => {
      await http().get('/documents').expect(401);
      await http().get('/documents').set('user-id', ALICE).expect(401);
      await http().get(`/documents/${aliceDoc}`).expect(401);
    });

    it('another user cannot see, process, ask about or download the document', async () => {
      await http().get(`/documents/${aliceDoc}`).set('Authorization', mallory).expect(404);
      await http().get(`/documents/${aliceDoc}/file`).set('Authorization', mallory).expect(404);
      await http().post(`/documents/${aliceDoc}/process`).set('Authorization', mallory).expect(404);
      await http()
        .post(`/documents/${aliceDoc}/ask`)
        .set('Authorization', mallory)
        .send({ question: 'leak?' })
        .expect(404);
      const list = await http().get('/documents').set('Authorization', mallory).expect(200);
      expect(list.body).toEqual([]);
    });

    it('health check is public and says nothing but whether it works', async () => {
      const { body } = await http().get('/health').expect(200);
      expect(body).toEqual({ status: 'ok' });
    });

    it('uploads are no longer served publicly', async () => {
      await http().get('/uploads/anything.pdf').expect(404);
    });
  });

  describe('local accounts', () => {
    it('reports whether the first-run setup is needed', async () => {
      const { body } = await http().get('/auth/setup').expect(200);
      expect(typeof body.needsSetup).toBe('boolean');
    });

    it('logs in with the right password only, without exposing the hash', async () => {
      const { body } = await http()
        .post('/auth/login')
        .send({ email: ALICE.toUpperCase(), password: 'e2e-password' })
        .expect(200);
      expect(body).toMatchObject({ email: ALICE, role: 'USER' });
      expect(body).not.toHaveProperty('passwordHash');
      await http().post('/auth/login').send({ email: ALICE, password: 'wrong-password' }).expect(401);
    });

    it('returns the current user and refuses user management to non-admins', async () => {
      const { body } = await http().get('/auth/me').set('Authorization', alice).expect(200);
      expect(body.email).toBe(ALICE);
      expect(body.privacyAcceptedAt).toBeNull();
      const accepted = await http().post('/auth/me/privacy').set('Authorization', alice).expect(200);
      expect(accepted.body.privacyAcceptedAt).toEqual(expect.any(String));
      await http().get('/users').set('Authorization', alice).expect(403);
      await http().get('/users').expect(401);
    });

    it('rejects tokens of accounts that do not exist', async () => {
      const ghost = `Bearer ${await tokenFor(`ghost-${runId}@example.com`)}`;
      await http().get('/documents').set('Authorization', ghost).expect(401);
    });
  });

  describe('languages', () => {
    it('changes the user language, answers in it and translates on demand (stored)', async () => {
      await http().post('/auth/me/language').set('Authorization', alice).send({ language: 'fr' }).expect(400);
      const me = await http().post('/auth/me/language').set('Authorization', alice).send({ language: 'en' }).expect(200);
      expect(me.body.language).toBe('en');

      const { body } = await http()
        .post('/documents/upload')
        .set('Authorization', alice)
        .attach('file', fixture('receipt.png'))
        .expect(201);
      await processed();
      const ask = await http().post(`/documents/${body.id}/ask`).set('Authorization', alice).send({ question: 'total?' }).expect(201);
      expect(llmStub.askQuestion).toHaveBeenLastCalledWith(expect.anything(), 'total?', [], 'STRICT', 'en');
      expect(ask.body.language).toBe('en');

      const translated = await http()
        .post(`/documents/${body.id}/interactions/${ask.body.id}/translate`)
        .set('Authorization', alice)
        .send({ to: 'pt' })
        .expect(200);
      expect(translated.body).toEqual({ language: 'pt', text: '[pt] ANSWER TO: total?', verified: true });
      await http()
        .post(`/documents/${body.id}/interactions/${ask.body.id}/translate`)
        .set('Authorization', mallory)
        .send({ to: 'pt' })
        .expect(404);
      const doc = await http().get(`/documents/${body.id}`).set('Authorization', alice).expect(200);
      const stored = doc.body.interactions.find((i: { id: string }) => i.id === ask.body.id);
      expect(stored.translations.pt.text).toBe('[pt] ANSWER TO: total?');

      await http().post('/auth/me/language').set('Authorization', alice).send({ language: 'pt' }).expect(200);
    });

    it('tells the sign-in screens which language to use', async () => {
      const { body } = await http().get('/auth/setup').expect(200);
      expect(['pt', 'en']).toContain(body.defaultLanguage);
    });
  });

  describe('teams and sharing', () => {
    const ADMIN = `admin-${runId}@example.com`;
    const BRUNA = `bruna-${runId}@example.com`;
    const CARLOS = `carlos-${runId}@example.com`;
    let admin: string;
    let bruna: string;
    let carlos: string;
    let ids: Record<string, string>;
    let legal: string;
    let hr: string;
    let doc: string;

    beforeAll(async () => {
      const prisma = app.get(PrismaService);
      const passwordHash = await hashPassword('e2e-password');
      ids = {};
      for (const [email, role] of [[ADMIN, 'ADMIN'], [BRUNA, 'USER'], [CARLOS, 'USER']] as const) {
        ids[email] = (await prisma.user.create({ data: { email, name: email.split('@')[0], passwordHash, role } })).id;
      }
      ids[ALICE] = (await prisma.user.findUniqueOrThrow({ where: { email: ALICE } })).id;
      admin = `Bearer ${await tokenFor(ADMIN)}`;
      bruna = `Bearer ${await tokenFor(BRUNA)}`;
      carlos = `Bearer ${await tokenFor(CARLOS)}`;
    });

    it('only administrators manage teams; anyone can see their own teams', async () => {
      await http().get('/teams').set('Authorization', alice).expect(403);
      await http().post('/teams').set('Authorization', alice).send({ name: 'x' }).expect(403);
      // nobody is in a team yet: the app shows nothing about sharing
      expect((await http().get('/teams/mine').set('Authorization', alice).expect(200)).body).toEqual([]);

      legal = (await http().post('/teams').set('Authorization', admin).send({ name: `Jurídico ${runId}` }).expect(201)).body.id;
      hr = (await http().post('/teams').set('Authorization', admin).send({ name: `RH ${runId}` }).expect(201)).body.id;
      await http().post('/teams').set('Authorization', admin).send({ name: `RH ${runId}` }).expect(409);
      await http().post('/teams').set('Authorization', admin).send({ name: '  ' }).expect(400);

      for (const email of [ALICE, BRUNA]) {
        await http().post(`/teams/${legal}/members`).set('Authorization', admin).send({ userId: ids[email] }).expect(204);
      }
      await http().post(`/teams/${hr}/members`).set('Authorization', admin).send({ userId: ids[CARLOS] }).expect(204);
      expect((await http().get('/teams/mine').set('Authorization', alice).expect(200)).body).toEqual([
        { id: legal, name: `Jurídico ${runId}` },
      ]);
      const list = (await http().get('/teams').set('Authorization', admin).expect(200)).body;
      const legalTeam = list.find((t: { id: string }) => t.id === legal);
      expect(legalTeam.members.map((m: { email: string }) => m.email).sort()).toEqual([ALICE, BRUNA].sort());
    });

    it('a document stays private until its owner shares it with a team they belong to', async () => {
      doc = (await http().post('/documents/upload').set('Authorization', alice).attach('file', fixture('doc-a.pdf')).expect(201)).body.id;
      await processed();
      await http().get(`/documents/${doc}`).set('Authorization', bruna).expect(404);

      // not the owner, or a team the owner is not in
      await http().put(`/documents/${doc}/shares`).set('Authorization', bruna).send({ teamIds: [legal] }).expect(404);
      await http().put(`/documents/${doc}/shares`).set('Authorization', alice).send({ teamIds: [hr] }).expect(400);

      const shared = await http().put(`/documents/${doc}/shares`).set('Authorization', alice).send({ teamIds: [legal] }).expect(200);
      expect(shared.body.sharedWith).toEqual([{ id: legal, name: `Jurídico ${runId}` }]);
    });

    it('team members see the file and the explanation, and each has their own chat', async () => {
      await http().post(`/documents/${doc}/ask`).set('Authorization', alice).send({ question: 'alice private question' }).expect(201);
      await http().post(`/documents/${doc}/ask`).set('Authorization', bruna).send({ question: 'bruna question' }).expect(201);

      const seenByBruna = (await http().get(`/documents/${doc}`).set('Authorization', bruna).expect(200)).body;
      expect(seenByBruna.access).toEqual({ owner: false, ownerName: ALICE.split('@')[0] });
      expect(seenByBruna.interactions.map((i: { role: string; question: string }) => i.role === 'EXPLANATION' ? 'EXPLANATION' : i.question)).toEqual([
        'EXPLANATION',
        'bruna question',
      ]);
      const seenByAlice = (await http().get(`/documents/${doc}`).set('Authorization', alice).expect(200)).body;
      expect(seenByAlice.access.owner).toBe(true);
      expect(seenByAlice.interactions.map((i: { question: string }) => i.question)).not.toContain('bruna question');

      await http().get(`/documents/${doc}/file`).set('Authorization', bruna).expect(200);
      const sharedList = (await http().get('/documents/shared').set('Authorization', bruna).expect(200)).body;
      expect(sharedList.map((d: { id: string }) => d.id)).toContain(doc);
      expect(sharedList.find((d: { id: string }) => d.id === doc).user.email).toBe(ALICE);

      // translations: the explanation yes; someone else's answer no
      const aliceAnswer = seenByAlice.interactions.find((i: { question: string }) => i.question === 'alice private question');
      await http().post(`/documents/${doc}/interactions/${aliceAnswer.id}/translate`).set('Authorization', bruna).send({ to: 'en' }).expect(404);
      const explanation = seenByBruna.interactions[0];
      await http().post(`/documents/${doc}/interactions/${explanation.id}/translate`).set('Authorization', bruna).send({ to: 'en' }).expect(200);
    });

    it('only the owner reprocesses, deletes or changes the sharing; other teams see nothing', async () => {
      await http().post(`/documents/${doc}/process`).set('Authorization', bruna).expect(404);
      await http().delete(`/documents/${doc}`).set('Authorization', bruna).expect(404);
      await http().get(`/documents/${doc}/shares`).set('Authorization', bruna).expect(404);
      await http().get(`/documents/${doc}`).set('Authorization', carlos).expect(404);
      await http().get(`/documents/${doc}/file`).set('Authorization', carlos).expect(404);
      expect((await http().get('/documents/shared').set('Authorization', carlos).expect(200)).body).toEqual([]);
      // the administrator does not see documents either
      await http().get(`/documents/${doc}`).set('Authorization', admin).expect(404);
    });

    it('access ends when the member leaves the team, the sharing is removed or the team is deleted', async () => {
      await http().delete(`/teams/${legal}/members/${ids[BRUNA]}`).set('Authorization', admin).expect(204);
      await http().get(`/documents/${doc}`).set('Authorization', bruna).expect(404);
      await http().post(`/teams/${legal}/members`).set('Authorization', admin).send({ userId: ids[BRUNA] }).expect(204);
      await http().get(`/documents/${doc}`).set('Authorization', bruna).expect(200);

      await http().put(`/documents/${doc}/shares`).set('Authorization', alice).send({ teamIds: [] }).expect(200);
      await http().get(`/documents/${doc}`).set('Authorization', bruna).expect(404);

      await http().put(`/documents/${doc}/shares`).set('Authorization', alice).send({ teamIds: [legal] }).expect(200);
      await http().delete(`/teams/${legal}`).set('Authorization', admin).expect(204);
      await http().get(`/documents/${doc}`).set('Authorization', bruna).expect(404);
      // the document itself stays with its owner
      await http().get(`/documents/${doc}`).set('Authorization', alice).expect(200);
    });
  });

  describe('administrator panel', () => {
    const ADMIN2 = `admin2-${runId}@example.com`;
    const DORA = `dora-${runId}@example.com`;
    let admin: string;
    let dora: string;
    let team: string;
    let doc: string;
    let doraId: string;

    beforeAll(async () => {
      const prisma = app.get(PrismaService);
      const passwordHash = await hashPassword('e2e-password');
      await prisma.user.create({ data: { email: ADMIN2, name: 'admin2', passwordHash, role: 'ADMIN' } });
      doraId = (await prisma.user.create({ data: { email: DORA, name: 'dora', passwordHash } })).id;
      admin = `Bearer ${await tokenFor(ADMIN2)}`;
      dora = `Bearer ${await tokenFor(DORA)}`;
      const aliceId = (await prisma.user.findUniqueOrThrow({ where: { email: ALICE } })).id;
      team = (await http().post('/teams').set('Authorization', admin).send({ name: `Financeiro ${runId}` }).expect(201)).body.id;
      for (const userId of [aliceId, doraId]) {
        await http().post(`/teams/${team}/members`).set('Authorization', admin).send({ userId }).expect(204);
      }
      doc = (await http().post('/documents/upload').set('Authorization', alice).attach('file', fixture('doc-b.pdf')).expect(201)).body.id;
      await processed();
      await http().put(`/documents/${doc}/shares`).set('Authorization', alice).send({ teamIds: [team] }).expect(200);
      await http().post(`/documents/${doc}/ask`).set('Authorization', alice).send({ question: 'secret question' }).expect(201);
    });

    it('is for administrators only', async () => {
      await http().get('/admin/overview').set('Authorization', alice).expect(403);
      await http().delete(`/admin/teams/${team}/documents/${doc}`).set('Authorization', alice).expect(403);
    });

    it('shows health, teams with shared document names and usage counts, never content', async () => {
      const { body } = await http().get('/admin/overview').set('Authorization', admin).expect(200);
      expect(body.health.database.ok).toBe(true);
      expect(body.health.llm).toMatchObject({ reachable: true, modelInstalled: true });
      // counts over the whole database (shared with development), so only their shape is checked
      expect(body.health.queue).toEqual({ queued: expect.any(Number), reading: expect.any(Number), writingExplanation: expect.any(Number) });
      expect(body.health.storage.uploadsBytes).toBeGreaterThan(0);

      const finance = body.teams.find((t: { id: string }) => t.id === team);
      expect(finance.documents).toEqual([
        expect.objectContaining({ id: doc, name: 'doc-b.pdf', owner: ALICE.split('@')[0], status: 'COMPLETED' }),
      ]);
      expect(body.usage.find((u: { email: string }) => u.email === DORA).documents).toBe(0);
      expect(body.usage.find((u: { email: string }) => u.email === ALICE).documents).toBeGreaterThan(0);

      const raw = JSON.stringify(body);
      expect(raw).not.toContain('secret question');
      expect(raw).not.toContain('EXPLANATION OF');
      expect(raw).not.toMatch(/extractedText|filePath/);
    });

    it('removes a sharing: the team loses access, the owner keeps the document', async () => {
      await http().get(`/documents/${doc}`).set('Authorization', dora).expect(200);
      await http().delete(`/admin/teams/${team}/documents/${doc}`).set('Authorization', admin).expect(204);
      await http().delete(`/admin/teams/${team}/documents/${doc}`).set('Authorization', admin).expect(404);
      await http().get(`/documents/${doc}`).set('Authorization', dora).expect(404);
      await http().get(`/documents/${doc}`).set('Authorization', alice).expect(200);
    });
  });

  describe('account deletion and activity log', () => {
    const ADMIN3 = `admin3-${runId}@example.com`;
    const EVA = `eva-${runId}@example.com`;
    const FABIO = `fabio-${runId}@example.com`;
    const GUSTAVO = `gustavo-${runId}@example.com`;
    const ids: Record<string, string> = {};
    const auth: Record<string, string> = {};
    let aliceDoc: string;
    let evaDoc: string;
    let gustavoDoc: string;
    let evaFile: string;

    beforeAll(async () => {
      const prisma = app.get(PrismaService);
      const passwordHash = await hashPassword('e2e-password');
      for (const [email, role] of [[ADMIN3, 'ADMIN'], [EVA, 'USER'], [FABIO, 'USER'], [GUSTAVO, 'USER']] as const) {
        ids[email] = (await prisma.user.create({ data: { email, name: email.split('-')[0], passwordHash, role } })).id;
        auth[email] = `Bearer ${await tokenFor(email)}`;
      }
      // Eva can read one of Alice's documents through a team, and asks about it
      const team = (await http().post('/teams').set('Authorization', auth[ADMIN3]).send({ name: `Diretoria ${runId}` }).expect(201)).body.id;
      const aliceId = (await prisma.user.findUniqueOrThrow({ where: { email: ALICE } })).id;
      for (const userId of [aliceId, ids[EVA]]) {
        await http().post(`/teams/${team}/members`).set('Authorization', auth[ADMIN3]).send({ userId }).expect(204);
      }
      aliceDoc = (await http().post('/documents/upload').set('Authorization', alice).attach('file', fixture('doc-a.pdf')).expect(201)).body.id;
      evaDoc = (await http().post('/documents/upload').set('Authorization', auth[EVA]).attach('file', fixture('doc-b.pdf')).expect(201)).body.id;
      gustavoDoc = (await http().post('/documents/upload').set('Authorization', auth[GUSTAVO]).attach('file', fixture('receipt.png')).expect(201)).body.id;
      await processed();
      await http().put(`/documents/${aliceDoc}/shares`).set('Authorization', alice).send({ teamIds: [team] }).expect(200);
      await http().post(`/documents/${aliceDoc}/ask`).set('Authorization', auth[EVA]).send({ question: 'eva confidential salary question' }).expect(201);
      await http().post(`/documents/${gustavoDoc}/ask`).set('Authorization', auth[GUSTAVO]).send({ question: 'gustavo question' }).expect(201);
      evaFile = (await prisma.document.findUniqueOrThrow({ where: { id: evaDoc } })).filePath;
    });

    it('requires an administrator, their password and a choice for the documents', async () => {
      const del = (who: string, target: string, body: object) =>
        http().delete(`/users/${ids[target]}`).set('Authorization', auth[who]).send(body);
      await del(FABIO, EVA, { adminPassword: 'e2e-password', documents: 'delete' }).expect(403);
      await del(ADMIN3, EVA, { adminPassword: 'wrong-password', documents: 'delete' }).expect(403);
      await del(ADMIN3, ADMIN3, { adminPassword: 'e2e-password', documents: 'delete' }).expect(400);
      await del(ADMIN3, EVA, { adminPassword: 'e2e-password' }).expect(400);
      await del(ADMIN3, EVA, { adminPassword: 'e2e-password', documents: 'transfer', transferTo: ids[EVA] }).expect(400);
    });

    it('deletes the account with its documents, files and questions (also on shared documents)', async () => {
      const prisma = app.get(PrismaService);
      const res = await http().delete(`/users/${ids[EVA]}`).set('Authorization', auth[ADMIN3]).send({ adminPassword: 'e2e-password', documents: 'delete' }).expect(200);
      expect(res.body).toEqual({ documents: 1, mode: 'delete' });
      await http().get('/documents').set('Authorization', auth[EVA]).expect(401);
      expect(await prisma.document.findUnique({ where: { id: evaDoc } })).toBeNull();
      expect(existsSync(resolve(evaFile))).toBe(false);
      expect(await prisma.llmInteraction.count({ where: { question: 'eva confidential salary question' } })).toBe(0);
      // Alice's shared document is untouched
      await http().get(`/documents/${aliceDoc}`).set('Authorization', alice).expect(200);
    });

    it('or transfers the documents (with their explanation, without the old owner\'s questions)', async () => {
      await http().delete(`/users/${ids[GUSTAVO]}`).set('Authorization', auth[ADMIN3])
        .send({ adminPassword: 'e2e-password', documents: 'transfer', transferTo: ids[FABIO] }).expect(200);
      const { body } = await http().get(`/documents/${gustavoDoc}`).set('Authorization', auth[FABIO]).expect(200);
      expect(body.access.owner).toBe(true);
      expect(body.interactions.map((i: { role: string }) => i.role)).toEqual(['EXPLANATION']);
      const list = (await http().get('/documents').set('Authorization', auth[FABIO]).expect(200)).body;
      expect(list.map((d: { id: string }) => d.id)).toContain(gustavoDoc);
    });

    it('records who did what, on which document and when, never the text of questions', async () => {
      await http().get('/admin/audit').set('Authorization', alice).expect(403);
      await http().post('/auth/login').send({ email: FABIO, password: 'wrong-password' }).expect(401);
      await http().post('/auth/login').send({ email: FABIO, password: 'e2e-password' }).expect(200);
      // opening the same document twice in a row is recorded once
      await http().get(`/documents/${gustavoDoc}`).set('Authorization', auth[FABIO]).expect(200);

      const log = (await http().get('/admin/audit').query({ limit: 1000 }).set('Authorization', auth[ADMIN3]).expect(200)).body as {
        actorEmail: string; action: string; documentId: string | null; target: string | null; details: Record<string, unknown> | null;
      }[];
      const has = (actor: string, action: string, extra: object = {}) =>
        expect(log).toContainEqual(expect.objectContaining({ actorEmail: actor, action, ...extra }));
      has(FABIO, 'LOGIN_FAILED');
      has(FABIO, 'LOGIN');
      has(EVA, 'DOCUMENT_UPLOAD', { documentId: evaDoc, target: 'doc-b.pdf' });
      has(EVA, 'DOCUMENT_ASK', { documentId: aliceDoc, details: { mode: 'STRICT' } });
      has(ALICE, 'DOCUMENT_SHARING_CHANGED', { documentId: aliceDoc, details: { teams: [`Diretoria ${runId}`] } });
      has(ADMIN3, 'TEAM_MEMBER_ADDED', { target: `Diretoria ${runId}: ${EVA}` });
      has(ADMIN3, 'USER_DELETED', { target: EVA, details: { documents: 1, mode: 'delete' } });
      has(ADMIN3, 'USER_DELETED', { target: GUSTAVO, details: { documents: 1, mode: 'transfer', transferredTo: FABIO } });
      expect(log.filter((e) => e.actorEmail === FABIO && e.action === 'DOCUMENT_VIEW' && e.documentId === gustavoDoc)).toHaveLength(1);
      expect(JSON.stringify(log)).not.toContain('confidential salary');

      const onlyFabio = (await http().get('/admin/audit').query({ actor: FABIO }).set('Authorization', auth[ADMIN3]).expect(200)).body;
      expect(onlyFabio.every((e: { actorEmail: string }) => e.actorEmail === FABIO)).toBe(true);
    });
  });

  describe('deletion', () => {
    it('deletes the document, its file and its interactions; others cannot', async () => {
      const { body } = await http()
        .post('/documents/upload')
        .set('Authorization', alice)
        .attach('file', fixture('receipt.png'))
        .expect(201);
      await processed();
      await http().post(`/documents/${body.id}/ask`).set('Authorization', alice).send({ question: 'total?' }).expect(201);
      const prisma = app.get(PrismaService);
      const stored = await prisma.document.findUniqueOrThrow({ where: { id: body.id } });
      expect(existsSync(resolve(stored.filePath))).toBe(true);

      await http().delete(`/documents/${body.id}`).set('Authorization', mallory).expect(404);
      await http().delete(`/documents/${body.id}`).set('Authorization', alice).expect(204);

      await http().get(`/documents/${body.id}`).set('Authorization', alice).expect(404);
      expect(existsSync(resolve(stored.filePath))).toBe(false);
      expect(await prisma.llmInteraction.count({ where: { documentId: body.id } })).toBe(0);
    });
  });

  describe('errors', () => {
    it('400 for an unsupported file, and the server keeps running', async () => {
      await http()
        .post('/documents/upload')
        .set('Authorization', alice)
        .attach('file', fixture('not-an-image.txt'))
        .expect(400);
      await http().get('/').expect(200);
    });

    it('400 when no file is sent', async () => {
      await http().post('/documents/upload').set('Authorization', alice).expect(400);
    });

    it('404 for an unknown document', async () => {
      await http().get('/documents/does-not-exist').set('Authorization', alice).expect(404);
    });

    it('409 when asking before the document is read', async () => {
      const prisma = app.get(PrismaService);
      const owner = await prisma.user.findUniqueOrThrow({ where: { email: ALICE } });
      // a document still waiting in the queue
      const pending = await prisma.document.create({
        data: { userId: owner.id, originalName: 'x.pdf', filename: 'x.pdf', filePath: 'uploads/x.pdf', status: 'PENDING' },
      });
      await http()
        .post(`/documents/${pending.id}/ask`)
        .set('Authorization', alice)
        .send({ question: 'too early?' })
        .expect(409);
    });

    it('reprocessing returns 202 at once and processes again in the background', async () => {
      const { body } = await http()
        .post('/documents/upload')
        .set('Authorization', alice)
        .attach('file', fixture('receipt.png'))
        .expect(201);
      await processed();
      const queued = await http().post(`/documents/${body.id}/process`).set('Authorization', alice).expect(202);
      expect(queued.body.status).toBe('PENDING');
      await processed();
      const doc = await http().get(`/documents/${body.id}`).set('Authorization', alice).expect(200);
      expect(doc.body.document).toMatchObject({ status: 'COMPLETED', explanationStatus: 'COMPLETED' });
      expect(doc.body.interactions.filter((i: { role: string }) => i.role === 'EXPLANATION')).toHaveLength(1);
    });

    it('a failed explanation keeps the document usable, and can be retried alone', async () => {
      llmStub.explainDocument.mockRejectedValueOnce(new Error('LLM unavailable: Ollama is not reachable'));
      const { body } = await http()
        .post('/documents/upload')
        .set('Authorization', alice)
        .attach('file', fixture('receipt.png'))
        .expect(201);
      await processed();
      const failed = await http().get(`/documents/${body.id}`).set('Authorization', alice).expect(200);
      expect(failed.body.document).toMatchObject({
        status: 'COMPLETED',
        explanationStatus: 'FAILED',
        explanationError: 'LLM unavailable: Ollama is not reachable',
      });
      await http().post(`/documents/${body.id}/ask`).set('Authorization', alice).send({ question: 'total?' }).expect(201);
      await http().post(`/documents/${body.id}/explain`).set('Authorization', alice).expect(202);
      await processed();
      const retried = await http().get(`/documents/${body.id}`).set('Authorization', alice).expect(200);
      expect(retried.body.document.explanationStatus).toBe('COMPLETED');
    });
  });
});
