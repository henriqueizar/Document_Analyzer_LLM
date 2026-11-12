import { NO_TEXT_MESSAGE, ProcessingService } from './processing.service';

type Doc = Record<string, unknown> & { id: string };

/** In-memory stand-in for the parts of Prisma the queue uses. */
function fakePrisma(docs: Doc[]) {
  const interactions: Record<string, unknown>[] = [];
  const find = (id: string) => docs.find((d) => d.id === id);
  return {
    docs,
    interactions,
    document: {
      findUnique: jest.fn(async ({ where }) => (find(where.id) ? { ...find(where.id) } : null)),
      findMany: jest.fn(async () =>
        docs.filter((d) => ['PENDING', 'PROCESSING'].includes(d.status as string) || ['PENDING', 'PROCESSING'].includes(d.explanationStatus as string)),
      ),
      update: jest.fn(async ({ where, data }) => Object.assign(find(where.id)!, data)),
    },
    llmInteraction: {
      deleteMany: jest.fn(async ({ where }) => {
        for (let i = interactions.length - 1; i >= 0; i--) {
          if (interactions[i].documentId === where.documentId && interactions[i].role === where.role) interactions.splice(i, 1);
        }
      }),
      create: jest.fn(async ({ data }) => interactions.push(data)),
    },
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };
}

const doc = (overrides: Partial<Doc> = {}): Doc => ({
  id: 'd1',
  originalName: 'contrato.pdf',
  filePath: 'uploads/x.pdf',
  status: 'PENDING',
  extractedText: null,
  explanationStatus: null,
  ...overrides,
});

describe('ProcessingService', () => {
  let prisma: ReturnType<typeof fakePrisma>;
  let ocr: { recognizePdf: jest.Mock; extractText: jest.Mock };
  let llm: { explainDocument: jest.Mock };
  let queue: ProcessingService;

  function build(docs: Doc[]) {
    prisma = fakePrisma(docs);
    ocr = { recognizePdf: jest.fn().mockResolvedValue('--- Page 1 ---\nTEXTO'), extractText: jest.fn().mockResolvedValue('IMAGEM') };
    llm = { explainDocument: jest.fn().mockResolvedValue({ text: 'Explicação [p. 1].', sources: [{ page: 1, text: 'TEXTO' }] }) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    queue = new ProcessingService(prisma as any, ocr as any, llm as any);
  }

  async function processAll(...ids: string[]) {
    ids.forEach((id) => queue.enqueue(id));
    await queue.idle();
  }

  it('reads, explains and stores the explanation with its sources', async () => {
    build([doc()]);
    await processAll('d1');
    expect(prisma.docs[0]).toMatchObject({ status: 'COMPLETED', extractedText: '--- Page 1 ---\nTEXTO', explanationStatus: 'COMPLETED' });
    expect(prisma.interactions).toEqual([
      expect.objectContaining({ role: 'EXPLANATION', answer: 'Explicação [p. 1].', sources: [{ page: 1, text: 'TEXTO' }] }),
    ]);
  });

  it('routes an upper-case .PDF to the PDF pipeline and images to image OCR', async () => {
    build([doc({ originalName: 'SCAN.PDF' }), doc({ id: 'd2', originalName: 'foto.JPG' })]);
    await processAll('d1', 'd2');
    expect(ocr.recognizePdf).toHaveBeenCalledTimes(1);
    expect(ocr.extractText).toHaveBeenCalledTimes(1);
  });

  it('stores the reason when reading fails, and does not call the LLM', async () => {
    build([doc()]);
    ocr.recognizePdf.mockRejectedValue(new Error('OCR failed for x.pdf'));
    await processAll('d1');
    expect(prisma.docs[0]).toMatchObject({ status: 'FAILED', failureReason: 'OCR failed for x.pdf' });
    expect(llm.explainDocument).not.toHaveBeenCalled();
  });

  it('fails with a helpful message when no text is found', async () => {
    build([doc()]);
    ocr.recognizePdf.mockResolvedValue('   ');
    await processAll('d1');
    expect(prisma.docs[0]).toMatchObject({ status: 'FAILED', failureReason: NO_TEXT_MESSAGE });
  });

  it('marks unsupported files as FAILED without calling OCR', async () => {
    build([doc({ originalName: 'notas.txt' })]);
    await processAll('d1');
    expect(prisma.docs[0]).toMatchObject({ status: 'FAILED', failureReason: expect.stringMatching(/Unsupported file type/) });
    expect(ocr.extractText).not.toHaveBeenCalled();
  });

  it('keeps a document that was read usable when the LLM fails', async () => {
    build([doc()]);
    llm.explainDocument.mockRejectedValue(new Error('LLM unavailable: Ollama is not reachable'));
    await processAll('d1');
    expect(prisma.docs[0]).toMatchObject({
      status: 'COMPLETED',
      extractedText: '--- Page 1 ---\nTEXTO',
      explanationStatus: 'FAILED',
      explanationError: 'LLM unavailable: Ollama is not reachable',
    });
  });

  it('retrying only the explanation does not read the document again', async () => {
    build([doc({ status: 'COMPLETED', extractedText: 'TEXTO', explanationStatus: 'PENDING' })]);
    await processAll('d1');
    expect(ocr.recognizePdf).not.toHaveBeenCalled();
    expect(prisma.docs[0].explanationStatus).toBe('COMPLETED');
  });

  it('a new explanation replaces the previous one', async () => {
    build([doc()]);
    prisma.interactions.push({ documentId: 'd1', role: 'EXPLANATION', answer: 'antiga' }, { documentId: 'd1', role: 'QUESTION', answer: 'resposta' });
    await processAll('d1');
    expect(prisma.interactions.map((i) => i.answer)).toEqual(['resposta', 'Explicação [p. 1].']);
  });

  it('resumes work left unfinished by a restart', async () => {
    build([doc({ status: 'PROCESSING' }), doc({ id: 'd2', status: 'COMPLETED', extractedText: 'T', explanationStatus: 'COMPLETED' })]);
    await queue.onApplicationBootstrap();
    await queue.idle();
    expect(prisma.docs[0].status).toBe('COMPLETED');
    expect(ocr.recognizePdf).toHaveBeenCalledTimes(1);
  });

  it('processes one document at a time', async () => {
    build([doc(), doc({ id: 'd2' })]);
    let active = 0;
    let maxActive = 0;
    ocr.recognizePdf.mockImplementation(async () => {
      maxActive = Math.max(maxActive, ++active);
      await new Promise((r) => setTimeout(r, 20));
      active--;
      return 'TEXTO';
    });
    await processAll('d1', 'd2');
    expect(maxActive).toBe(1);
    expect(prisma.docs.every((d) => d.status === 'COMPLETED')).toBe(true);
  });
});
