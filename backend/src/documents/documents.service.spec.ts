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
      findUnique: jest.fn().mockResolvedValue(doc),
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
    await service.process('doc-1');
    expect(ocr.recognizePdf).toHaveBeenCalled();
    expect(ocr.extractText).not.toHaveBeenCalled();
  });

  it('routes images to image OCR and stores the explanation', async () => {
    await build('photo.JPG');
    await service.process('doc-1');
    expect(ocr.extractText).toHaveBeenCalled();
    expect(llm.explainDocument).toHaveBeenCalledWith('image text');
    expect(prisma.llmInteraction.create).toHaveBeenCalled();
  });

  it('marks unsupported files as FAILED without calling OCR', async () => {
    await build('notes.txt');
    const result = service.process('doc-1');
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
      prisma.document.findUnique.mockResolvedValue(null);
      await expect(service.process('nope')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('process: OCR failure marks FAILED and returns 422', async () => {
      await build('a.png');
      ocr.extractText.mockRejectedValue(new Error('OCR failed for a.png'));
      await expect(service.process('doc-1')).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
      expect(prisma.document.update).toHaveBeenLastCalledWith({
        where: { id: 'doc-1' },
        data: { status: 'FAILED' },
      });
    });

    it('ask: 404 for an unknown document', async () => {
      await build('a.png');
      prisma.document.findUnique.mockResolvedValue(null);
      await expect(service.ask('nope', 'q?')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('ask: 409 while the document is not processed yet', async () => {
      await build('a.png', { status: 'PROCESSING' });
      await expect(service.ask('doc-1', 'q?')).rejects.toBeInstanceOf(ConflictException);
      expect(llm.askQuestion).not.toHaveBeenCalled();
    });

    it('ask: 400 for an empty question', async () => {
      await build('a.png', { status: 'COMPLETED', extractedText: 'text' });
      await expect(service.ask('doc-1', '   ')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('ask: answers a completed document and stores the interaction', async () => {
      await build('a.png', { status: 'COMPLETED', extractedText: 'text' });
      await service.ask('doc-1', 'What is the total?');
      expect(llm.askQuestion).toHaveBeenCalledWith('text', 'What is the total?');
      expect(prisma.llmInteraction.create).toHaveBeenCalled();
    });

    it('findOne: 404 for an unknown document', async () => {
      await build('a.png');
      prisma.document.findUnique.mockResolvedValue(null);
      await expect(service.findOne('nope')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
