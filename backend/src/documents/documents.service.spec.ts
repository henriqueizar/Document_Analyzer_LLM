import { Test, TestingModule } from '@nestjs/testing';
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

function makePrisma(originalName: string) {
  const doc = { ...baseDoc, originalName };
  return {
    document: {
      findUnique: jest.fn().mockResolvedValue(doc),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...doc, ...data })),
    },
    llmInteraction: { create: jest.fn().mockResolvedValue({}) },
    user: {},
  };
}

describe('DocumentsService', () => {
  let service: DocumentsService;
  let prisma: ReturnType<typeof makePrisma>;
  let ocr: { recognizePdf: jest.Mock; extractText: jest.Mock };
  let llm: { explainDocument: jest.Mock; askQuestion: jest.Mock };

  async function build(originalName: string) {
    prisma = makePrisma(originalName);
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
    await expect(service.process('doc-1')).rejects.toThrow(/Unsupported file type/);
    expect(ocr.extractText).not.toHaveBeenCalled();
    expect(prisma.document.update).toHaveBeenLastCalledWith({
      where: { id: 'doc-1' },
      data: { status: 'FAILED' },
    });
  });
});
