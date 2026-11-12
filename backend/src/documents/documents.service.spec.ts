import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { existsSync } from 'fs';
import { mkdtemp, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { ProcessingService } from './processing.service';
import { LlmService } from '../llm/llm.service';

const OWNER = 'alice@example.com';

const baseDoc = {
  id: 'doc-1',
  userId: 'user-1',
  filename: 'stored',
  filePath: 'uploads/stored',
  extractedText: null,
  status: 'PENDING',
  createdAt: new Date(),
};

function makePrisma(originalName: string, overrides: Record<string, unknown> = {}) {
  const doc = { ...baseDoc, originalName, ...overrides };
  return {
    document: {
      findFirst: jest.fn().mockResolvedValue(doc),
      delete: jest.fn().mockResolvedValue(doc),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...doc, ...data })),
    },
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    llmInteraction: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      create: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve(data)),
    },
    user: {},
  };
}

describe('DocumentsService', () => {
  let service: DocumentsService;
  let prisma: ReturnType<typeof makePrisma>;
  let processing: { enqueue: jest.Mock; isQueued: jest.Mock };
  let llm: { explainDocument: jest.Mock; askQuestion: jest.Mock; translate: jest.Mock };

  async function build(originalName: string, overrides: Record<string, unknown> = {}) {
    prisma = makePrisma(originalName, overrides);
    processing = { enqueue: jest.fn(), isQueued: jest.fn().mockReturnValue(false) };
    llm = {
      explainDocument: jest.fn().mockResolvedValue({ text: 'explanation', sources: [{ page: 1, text: 'src' }] }),
      askQuestion: jest.fn().mockResolvedValue({ text: 'answer', sources: [{ page: 1, text: 'src' }] }),
      translate: jest.fn().mockResolvedValue({ text: 'translated [p. 1]', verified: true }),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ProcessingService, useValue: processing },
        { provide: LlmService, useValue: llm },
      ],
    }).compile();
    service = module.get(DocumentsService);
  }

  describe('HTTP errors', () => {
    it('process: 404 for an unknown document', async () => {
      await build('a.png');
      prisma.document.findFirst.mockResolvedValue(null);
      await expect(service.process('nope', OWNER)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('ask: 404 for an unknown document', async () => {
      await build('a.png');
      prisma.document.findFirst.mockResolvedValue(null);
      await expect(service.ask('nope', 'q?', OWNER)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('ask: 409 while the document is not processed yet', async () => {
      await build('a.png', { status: 'PROCESSING' });
      await expect(service.ask('doc-1', 'q?', OWNER)).rejects.toBeInstanceOf(ConflictException);
      expect(llm.askQuestion).not.toHaveBeenCalled();
    });

    it('ask: 400 for an empty question', async () => {
      await build('a.png', { status: 'COMPLETED', extractedText: 'text' });
      await expect(service.ask('doc-1', '   ', OWNER)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('ask: answers a completed document and stores the interaction', async () => {
      await build('a.png', { status: 'COMPLETED', extractedText: 'text' });
      await service.ask('doc-1', 'What is the total?', OWNER);
      expect(llm.askQuestion).toHaveBeenCalledWith(
        { name: 'a.png', text: 'text' },
        'What is the total?',
        [],
        'STRICT',
        'pt',
      );
      expect(prisma.llmInteraction.create).toHaveBeenCalled();
    });

    it('findOne: 404 for an unknown document', async () => {
      await build('a.png');
      prisma.document.findFirst.mockResolvedValue(null);
      await expect(service.findOne('nope', OWNER)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('ownership', () => {
    it('only looks documents up among the caller\'s own', async () => {
      await build('a.png', { status: 'COMPLETED', extractedText: 'text' });
      await service.findOne('doc-1', OWNER);
      expect(prisma.document.findFirst).toHaveBeenCalledWith({
        where: { id: 'doc-1', user: { email: OWNER } },
      });
    });

    it('answers 404 (not 403) for another user\'s document', async () => {
      await build('a.png');
      prisma.document.findFirst.mockResolvedValue(null);
      await expect(service.findOne('doc-1', 'mallory@example.com')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.ask('doc-1', 'q?', 'mallory@example.com')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.process('doc-1', 'mallory@example.com')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(processing.enqueue).not.toHaveBeenCalled();
      expect(llm.askQuestion).not.toHaveBeenCalled();
    });

    it('does not expose server file paths', async () => {
      await build('a.png', { status: 'COMPLETED', extractedText: 'text' });
      const { document } = await service.findOne('doc-1', OWNER);
      expect(document).not.toHaveProperty('filePath');
      expect(document).not.toHaveProperty('filename');
    });

    it('refuses to re-process a document that is already being processed', async () => {
      await build('a.png', { status: 'PROCESSING' });
      await expect(service.process('doc-1', OWNER)).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('background processing', () => {
    it('process queues the document again and returns at once', async () => {
      await build('a.png', { status: 'FAILED', failureReason: 'old' });
      const doc = await service.process('doc-1', OWNER);
      expect(doc).toMatchObject({ status: 'PENDING', failureReason: null });
      expect(processing.enqueue).toHaveBeenCalledWith('doc-1');
    });

    it('explain re-queues only the explanation of a document that was read', async () => {
      await build('a.png', { status: 'COMPLETED', extractedText: 't', explanationStatus: 'FAILED' });
      const doc = await service.explain('doc-1', OWNER);
      expect(doc).toMatchObject({ status: 'COMPLETED', explanationStatus: 'PENDING' });
      expect(processing.enqueue).toHaveBeenCalledWith('doc-1');
    });

    it('explain refuses a document that has not been read', async () => {
      await build('a.png', { status: 'FAILED' });
      await expect(service.explain('doc-1', OWNER)).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses work on a document that is already queued', async () => {
      await build('a.png', { status: 'COMPLETED', extractedText: 't', explanationStatus: 'COMPLETED' });
      processing.isQueued.mockReturnValue(true);
      await expect(service.process('doc-1', OWNER)).rejects.toBeInstanceOf(ConflictException);
    });
  });

  it('findOne strips filler from explanations stored earlier', async () => {
    await build('a.png', { status: 'COMPLETED', extractedText: 'text' });
    prisma.llmInteraction.findMany.mockResolvedValue([
      { id: 'i1', role: 'EXPLANATION', question: '', answer: "Sure, here's the explanation:\nIt is a receipt." },
    ]);
    const { interactions } = await service.findOne('doc-1', OWNER);
    expect(interactions[0].answer).toBe('It is a receipt.');
  });

  it('ask sends the last questions as history, oldest first, without warnings', async () => {
    await build('a.png', { status: 'COMPLETED', extractedText: 'text' });
    prisma.llmInteraction.findMany.mockResolvedValue([
      { question: 'q2', answer: 'a2 [p. 1]\n\n⚠ Verificação automática: ...' },
      { question: 'q1', answer: 'a1 [p. 1]' },
    ]);
    await service.ask('doc-1', 'q3', OWNER);
    expect(prisma.llmInteraction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { documentId: 'doc-1', role: 'QUESTION' }, take: 50 }),
    );
    expect(llm.askQuestion).toHaveBeenCalledWith(
      expect.anything(),
      'q3',
      [
        { question: 'q1', answer: 'a1 [p. 1]' },
        { question: 'q2', answer: 'a2 [p. 1]' },
      ],
      'STRICT',
      'pt',
    );
  });

  describe('deletion', () => {
    it('deletes the interactions, the document and the file', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'del-'));
      const file = join(dir, 'doc.pdf');
      await writeFile(file, 'x');
      await build('a.pdf', { status: 'COMPLETED', extractedText: 't', explanationStatus: 'COMPLETED', filePath: file });
      await service.remove('doc-1', OWNER);
      expect(prisma.llmInteraction.deleteMany).toHaveBeenCalledWith({ where: { documentId: 'doc-1' } });
      expect(prisma.document.delete).toHaveBeenCalledWith({ where: { id: 'doc-1' } });
      expect(existsSync(file)).toBe(false);
    });

    it("answers 404 for another user's document and deletes nothing", async () => {
      await build('a.pdf');
      prisma.document.findFirst.mockResolvedValue(null);
      await expect(service.remove('doc-1', 'mallory@example.com')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.document.delete).not.toHaveBeenCalled();
    });

    it('refuses while the document is being processed', async () => {
      await build('a.pdf', { status: 'PROCESSING' });
      await expect(service.remove('doc-1', OWNER)).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.document.delete).not.toHaveBeenCalled();
    });

    it('still succeeds when the file was already gone', async () => {
      await build('a.pdf', { status: 'FAILED', filePath: '/nonexistent/file.pdf' });
      await expect(service.remove('doc-1', OWNER)).resolves.toBeUndefined();
    });
  });

  describe('answer modes', () => {
    it('stores interpretation answers as such when explicitly requested', async () => {
      await build('a.png', { status: 'COMPLETED', extractedText: 'text' });
      await service.ask('doc-1', 'Quais os riscos?', OWNER, true);
      expect(llm.askQuestion).toHaveBeenCalledWith(expect.anything(), 'Quais os riscos?', [], 'INTERPRETATION', 'pt');
      expect(prisma.llmInteraction.create).toHaveBeenCalledWith({ data: expect.objectContaining({ mode: 'INTERPRETATION' }) });
    });

    it('marks earlier interpretations in the history so they are not read as document facts', async () => {
      await build('a.png', { status: 'COMPLETED', extractedText: 'text' });
      prisma.llmInteraction.findMany.mockResolvedValue([{ question: 'q1', answer: 'parece arriscado', mode: 'INTERPRETATION' }]);
      await service.ask('doc-1', 'q2', OWNER);
      expect(llm.askQuestion).toHaveBeenCalledWith(
        expect.anything(),
        'q2',
        [{ question: 'q1', answer: '[interpretation] parece arriscado' }],
        'STRICT',
        'pt',
      );
    });
  });

  describe('languages', () => {
    it('answers in the language of whoever asks, and stores it', async () => {
      await build('a.png', { status: 'COMPLETED', extractedText: 'text' });
      await service.ask('doc-1', 'What is the total?', OWNER, false, 'en');
      expect(llm.askQuestion).toHaveBeenCalledWith(expect.anything(), 'What is the total?', [], 'STRICT', 'en');
      expect(prisma.llmInteraction.create).toHaveBeenCalledWith({ data: expect.objectContaining({ language: 'en' }) });
    });

    it('translates an answer once and then serves the stored translation', async () => {
      await build('a.png', { status: 'COMPLETED', extractedText: 'text' });
      const interaction = { id: 'i1', documentId: 'doc-1', answer: 'Resposta [p. 1].', translations: null };
      prisma.llmInteraction.findFirst.mockResolvedValue(interaction);
      await expect(service.translate('doc-1', 'i1', OWNER, 'en')).resolves.toEqual({
        language: 'en',
        text: 'translated [p. 1]',
        verified: true,
      });
      expect(prisma.llmInteraction.update).toHaveBeenCalledWith({
        where: { id: 'i1' },
        data: { translations: { en: { text: 'translated [p. 1]', verified: true } } },
      });
      prisma.llmInteraction.findFirst.mockResolvedValue({ ...interaction, translations: { en: { text: 'stored', verified: true } } });
      await expect(service.translate('doc-1', 'i1', OWNER, 'en')).resolves.toMatchObject({ text: 'stored' });
      expect(llm.translate).toHaveBeenCalledTimes(1);
    });

    it("refuses other languages and other users' documents", async () => {
      await build('a.png', { status: 'COMPLETED', extractedText: 'text' });
      await expect(service.translate('doc-1', 'i1', OWNER, 'fr')).rejects.toBeInstanceOf(BadRequestException);
      prisma.document.findFirst.mockResolvedValue(null);
      await expect(service.translate('doc-1', 'i1', 'mallory@example.com', 'en')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
