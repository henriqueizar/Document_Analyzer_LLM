/**
 * End-to-end test of the main flow over HTTP:
 *   upload -> process (real OCR) -> get -> ask, plus auth and error paths.
 *
 * Requires the Postgres container (`docker compose up -d postgres`) and
 * DATABASE_URL (read from backend/.env if present). The LLM is replaced by a
 * stub so the test is deterministic and needs no Ollama/GPU.
 */
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SignJWT } from 'jose';
import { join } from 'path';
import { AppModule } from '../src/app.module';
import { LlmService } from '../src/llm/llm.service';
import { JWT_AUDIENCE, JWT_ISSUER } from '../src/auth/auth.constants';
import { PrismaService } from '../src/prisma/prisma.service';
import { hashPassword } from '../src/auth/password';

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
  explainDocument: jest.fn(async (doc: { text: string }) => `EXPLANATION OF: ${doc.text.slice(0, 40)}`),
  askQuestion: jest.fn(async (_doc: unknown, question: string) => `ANSWER TO: ${question}`),
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

  it('main flow: upload -> process -> get -> ask (multi-page PDF)', async () => {
    const upload = await http()
      .post('/documents/upload')
      .set('Authorization', alice)
      .attach('file', fixture('three-pages.pdf'))
      .expect(201);
    const id = upload.body.id;
    expect(upload.body.status).toBe('PENDING');
    expect(upload.body).not.toHaveProperty('filePath');

    await http().post(`/documents/${id}/process`).set('Authorization', alice).expect(201);

    const doc = await http().get(`/documents/${id}`).set('Authorization', alice).expect(200);
    expect(doc.body.document.status).toBe('COMPLETED');
    expect(doc.body.document.extractedText).toMatch(/PAGE 1/);
    expect(doc.body.document.extractedText).toMatch(/PAGE 3/);
    expect(doc.body.interactions).toEqual([
      expect.objectContaining({ role: 'EXPLANATION' }),
    ]);

    const ask = await http()
      .post(`/documents/${id}/ask`)
      .set('Authorization', alice)
      .send({ question: 'What is the due date?' })
      .expect(201);
    expect(ask.body).toMatchObject({ role: 'QUESTION', answer: 'ANSWER TO: What is the due date?' });

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
    await http().post(`/documents/${body.id}/process`).set('Authorization', alice).expect(201);
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

    it('409 when asking before processing', async () => {
      const { body } = await http()
        .post('/documents/upload')
        .set('Authorization', alice)
        .attach('file', fixture('doc-b.pdf'))
        .expect(201);
      await http()
        .post(`/documents/${body.id}/ask`)
        .set('Authorization', alice)
        .send({ question: 'too early?' })
        .expect(409);
    });
  });
});
