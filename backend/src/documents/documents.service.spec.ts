import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { PrismaService } from '../prisma/prisma.service';
import { OcrService } from '../ocr/ocr.service';
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
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...doc, ...data })),
    },
    llmInteraction: {
      create: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
    user: {},
  };
}

describe('DocumentsService', () => {
  let service: DocumentsService;
  let prisma: ReturnType<typeof makePrisma>;
  let ocr: { recognizePdf: jest.Mock; extractText: jest.Mock };
  let llm: { explainDocument: jest.Mock; askQuestion: jest.Mock };

  async function build(originalName: string, overrides: Record<string, unknown> = {}) {
    prisma = makePrisma(originalName, overrides);
    ocr = {
      recognizePdf: jest.fn().mockResolvedValue('pdf text'),
      extractText: jest.fn().mockResolvedValue('image text'),
    };
    llm = {
      explainDocument: jest.fn().mockResolvedValue('explanation'),
      askQuestion: jest.fn().mockResolvedValue('answer'),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentsService,
        { provide: PrismaService, useValue: prisma },
        { provide: OcrService, useValue: ocr },
        { provide: LlmService, useValue: llm },
      ],
    }).compile();
    service = module.get(DocumentsService);
  }

  it('routes an upper-case .PDF to the PDF pipeline', async () => {
    await build('SCAN.PDF');
    await service.process('doc-1', OWNER);
    expect(ocr.recognizePdf).toHaveBeenCalled();
    expect(ocr.extractText).not.toHaveBeenCalled();
  });

  it('routes images to image OCR and stores the explanation', async () => {
    await build('photo.JPG');
    await service.process('doc-1', OWNER);
    expect(ocr.extractText).toHaveBeenCalled();
    expect(llm.explainDocument).toHaveBeenCalledWith('image text');
    expect(prisma.llmInteraction.create).toHaveBeenCalled();
  });

  it('marks unsupported files as FAILED without calling OCR', async () => {
    await build('notes.txt');
    const result = service.process('doc-1', OWNER);
    await expect(result).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(result).rejects.toThrow(/Unsupported file type/);
    expect(ocr.extractText).not.toHaveBeenCalled();
    expect(prisma.document.update).toHaveBeenLastCalledWith({
      where: { id: 'doc-1' },
      data: { status: 'FAILED' },
    });
  });

  describe('HTTP errors', () => {
    it('process: 404 for an unknown document', async () => {
      await build('a.png');
      prisma.document.findFirst.mockResolvedValue(null);
      await expect(service.process('nope', OWNER)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('process: OCR failure marks FAILED and returns 422', async () => {
      await build('a.png');
      ocr.extractText.mockRejectedValue(new Error('OCR failed for a.png'));
      await expect(service.process('doc-1', OWNER)).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
      expect(prisma.document.update).toHaveBeenLastCalledWith({
        where: { id: 'doc-1' },
        data: { status: 'FAILED' },
      });
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
      expect(llm.askQuestion).toHaveBeenCalledWith('text', 'What is the total?');
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
      expect(ocr.extractText).not.toHaveBeenCalled();
      expect(llm.askQuestion).not.toHaveBeenCalled();
    });

    it('does not expose server file paths', async () => {
      await build('a.png', { status: 'COMPLETED', extractedText: 'text' });
      const { document } = await service.findOne('doc-1', OWNER);
      expect(document).not.toHaveProperty('filePath');
      expect(document).not.toHaveProperty('filename');
    });

    it('refuses to re-process a document that is already PROCESSING', async () => {
      await build('a.png', { status: 'PROCESSING' });
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
});
