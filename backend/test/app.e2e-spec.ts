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
    expect(llmStub.askQuestion).toHaveBeenLastCalledWith(expect.anything(), 'Is the due date reasonable?', expect.any(Array), 'INTERPRETATION');
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
