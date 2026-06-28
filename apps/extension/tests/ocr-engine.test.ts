import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import {
  type IStorageEngine,
  type IMediaStore,
  type IEnrichmentWorkItem,
  type IResource,
  MediaType,
  ResourceState,
  BlockType,
} from '@knowledge-extractor/types';
import { OcrEngine } from '../src/background/ocr-engine.js';

// ---------------------------------------------------------------------------
// Chrome API mock
// ---------------------------------------------------------------------------

const sendMessageMock = vi.fn();
const hasDocumentMock = vi.fn<() => Promise<boolean>>();
const createDocumentMock = vi.fn<() => Promise<void>>();
const closeDocumentMock = vi.fn<() => Promise<void>>();

const chromeMock = {
  offscreen: {
    hasDocument: hasDocumentMock,
    createDocument: createDocumentMock,
    closeDocument: closeDocumentMock,
    Reason: { WORKERS: 'WORKERS' },
  },
  runtime: {
    sendMessage: sendMessageMock,
    getURL: (path: string) => `chrome-extension://fake/${path}`,
  },
};

// ---------------------------------------------------------------------------
// Storage / media doubles
// ---------------------------------------------------------------------------

const saveResourceMock = vi.fn<(r: IResource) => Promise<void>>();
const getMediaMock = vi.fn<(id: string) => Promise<Blob | null>>();

const mockStorage = { saveResource: saveResourceMock } as unknown as IStorageEngine;
const mockMediaStore = { get: getMediaMock } as unknown as IMediaStore;

// ---------------------------------------------------------------------------
// Resource factory
// ---------------------------------------------------------------------------

function makeResource(
  mediaItems: Array<{ id: string; type: MediaType; mimeType?: string }> = [],
): IResource {
  return {
    id: 'res-1',
    state: ResourceState.HYDRATED,
    media: mediaItems as IResource['media'],
    content: [],
    completeness: { ocr: false } as IResource['completeness'],
  } as unknown as IResource;
}

function makeWorkItem(resource: IResource, resolvedMediaIds: string[] = []): IEnrichmentWorkItem {
  const resolvedMedia: IEnrichmentWorkItem['resolvedMedia'] = {};
  for (const id of resolvedMediaIds) {
    resolvedMedia[id] = {
      id,
      type: MediaType.IMAGE,
    } as IEnrichmentWorkItem['resolvedMedia'][string];
  }
  return { resource, resolvedMedia };
}

// ---------------------------------------------------------------------------
// Suite setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.stubGlobal('chrome', chromeMock);
  hasDocumentMock.mockResolvedValue(false);
  createDocumentMock.mockResolvedValue(undefined);
  closeDocumentMock.mockResolvedValue(undefined);
  saveResourceMock.mockResolvedValue(undefined);
  getMediaMock.mockResolvedValue(null);
  sendMessageMock.mockResolvedValue({ success: true, blocks: [] });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OcrEngine.process', () => {
  it('happy path: extracts text, appends blocks, advances resource to ENRICHED', async () => {
    const resource = makeResource([{ id: 'img-1', type: MediaType.IMAGE, mimeType: 'image/png' }]);
    const item = makeWorkItem(resource, ['img-1']);
    const expectedBlock = { type: BlockType.TRANSCRIPT, value: 'Hello world' };

    const blob = new Blob(['fake-png'], { type: 'image/png' });
    getMediaMock.mockResolvedValue(blob);
    sendMessageMock.mockResolvedValue({ success: true, blocks: [expectedBlock] });

    const engine = new OcrEngine(mockStorage, mockMediaStore);
    await engine.process(item);

    expect(resource.content).toContainEqual(expectedBlock);
    expect(resource.completeness.ocr).toBe(true);
    expect(resource.state).toBe(ResourceState.ENRICHED);
    expect(saveResourceMock).toHaveBeenCalledWith(resource);
  });

  it('creates offscreen document when not yet open', async () => {
    hasDocumentMock.mockResolvedValue(false);
    const resource = makeResource([{ id: 'img-1', type: MediaType.IMAGE }]);
    const item = makeWorkItem(resource, ['img-1']);
    getMediaMock.mockResolvedValue(new Blob(['x']));

    const engine = new OcrEngine(mockStorage, mockMediaStore);
    await engine.process(item);

    expect(createDocumentMock).toHaveBeenCalledOnce();
    expect(createDocumentMock).toHaveBeenCalledWith(
      expect.objectContaining({ reasons: expect.arrayContaining(['WORKERS']) }),
    );
  });

  it('skips createDocument when offscreen doc already exists', async () => {
    hasDocumentMock.mockResolvedValue(true);
    const resource = makeResource([{ id: 'img-1', type: MediaType.IMAGE }]);
    const item = makeWorkItem(resource, ['img-1']);
    getMediaMock.mockResolvedValue(new Blob(['x']));

    const engine = new OcrEngine(mockStorage, mockMediaStore);
    await engine.process(item);

    expect(createDocumentMock).not.toHaveBeenCalled();
  });

  it('null blob: skips image, still advances resource', async () => {
    getMediaMock.mockResolvedValue(null);
    const resource = makeResource([{ id: 'img-1', type: MediaType.IMAGE }]);
    const item = makeWorkItem(resource, ['img-1']);

    const engine = new OcrEngine(mockStorage, mockMediaStore);
    await engine.process(item);

    expect(sendMessageMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'OCR_REQUEST' }),
    );
    expect(resource.completeness.ocr).toBe(true);
    expect(resource.state).toBe(ResourceState.ENRICHED);
    expect(saveResourceMock).toHaveBeenCalledOnce();
  });

  it('OCR error response: logs and continues, resource still advances', async () => {
    getMediaMock.mockResolvedValue(new Blob(['img']));
    sendMessageMock.mockResolvedValue({ success: false, error: 'WASM OOM' });

    const resource = makeResource([{ id: 'img-1', type: MediaType.IMAGE }]);
    const item = makeWorkItem(resource, ['img-1']);

    const engine = new OcrEngine(mockStorage, mockMediaStore);
    await engine.process(item);

    expect(resource.content).toHaveLength(0);
    expect(resource.completeness.ocr).toBe(true);
    expect(resource.state).toBe(ResourceState.ENRICHED);
    expect(saveResourceMock).toHaveBeenCalledOnce();
  });

  it('no image media: advances resource without dispatching OCR', async () => {
    const resource = makeResource([]);
    const item = makeWorkItem(resource, []);

    const engine = new OcrEngine(mockStorage, mockMediaStore);
    await engine.process(item);

    expect(sendMessageMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'OCR_REQUEST' }),
    );
    expect(resource.completeness.ocr).toBe(true);
    expect(resource.state).toBe(ResourceState.ENRICHED);
    expect(saveResourceMock).toHaveBeenCalledOnce();
  });

  it('non-image media type is skipped', async () => {
    const resource = makeResource([{ id: 'vid-1', type: MediaType.VIDEO }]);
    const item = makeWorkItem(resource, ['vid-1']);

    const engine = new OcrEngine(mockStorage, mockMediaStore);
    await engine.process(item);

    expect(getMediaMock).not.toHaveBeenCalled();
    expect(resource.completeness.ocr).toBe(true);
    expect(resource.state).toBe(ResourceState.ENRICHED);
  });

  it('media not in resolvedMedia is skipped', async () => {
    const resource = makeResource([{ id: 'img-1', type: MediaType.IMAGE }]);
    const item = makeWorkItem(resource, []); // resolvedMedia is empty

    const engine = new OcrEngine(mockStorage, mockMediaStore);
    await engine.process(item);

    expect(getMediaMock).not.toHaveBeenCalled();
    expect(resource.completeness.ocr).toBe(true);
  });

  it('OCR blocks have BlockType.TRANSCRIPT', async () => {
    getMediaMock.mockResolvedValue(new Blob(['img']));
    const block = { type: BlockType.TRANSCRIPT, value: 'Extracted text' };
    sendMessageMock.mockResolvedValue({ success: true, blocks: [block] });

    const resource = makeResource([{ id: 'img-1', type: MediaType.IMAGE }]);
    const item = makeWorkItem(resource, ['img-1']);

    const engine = new OcrEngine(mockStorage, mockMediaStore);
    await engine.process(item);

    expect(resource.content).toHaveLength(1);
    expect(resource.content[0]).toMatchObject({ type: BlockType.TRANSCRIPT });
  });
});

describe('OcrEngine.terminate', () => {
  it('sends OCR_TERMINATE and closes offscreen document', async () => {
    const engine = new OcrEngine(mockStorage, mockMediaStore);
    await engine.terminate();

    expect(sendMessageMock).toHaveBeenCalledWith({ action: 'OCR_TERMINATE' });
    expect(closeDocumentMock).toHaveBeenCalledOnce();
  });

  it('survives sendMessage rejection (offscreen not open)', async () => {
    sendMessageMock.mockRejectedValue(new Error('No offscreen doc'));

    const engine = new OcrEngine(mockStorage, mockMediaStore);
    await expect(engine.terminate()).resolves.not.toThrow();
    expect(closeDocumentMock).toHaveBeenCalledOnce();
  });

  it('survives closeDocument rejection (doc already closed)', async () => {
    closeDocumentMock.mockRejectedValue(new Error('No document'));

    const engine = new OcrEngine(mockStorage, mockMediaStore);
    await expect(engine.terminate()).resolves.not.toThrow();
  });
});

describe('OcrEngine.extractText', () => {
  it('returns IContentBlock array from offscreen response', async () => {
    const block = { type: BlockType.TRANSCRIPT, value: 'OCR text' };
    sendMessageMock.mockResolvedValue({ success: true, blocks: [block] });
    getMediaMock.mockResolvedValue(new Blob(['img']));

    const media = {
      id: 'img-1',
      type: MediaType.IMAGE,
      mimeType: 'image/jpeg',
    } as IResource['media'][number];
    const engine = new OcrEngine(mockStorage, mockMediaStore);
    const blocks = await engine.extractText(media);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: BlockType.TRANSCRIPT, value: 'OCR text' });
  });

  it('returns empty array when blob is null', async () => {
    getMediaMock.mockResolvedValue(null);
    const media = { id: 'img-1', type: MediaType.IMAGE } as IResource['media'][number];

    const engine = new OcrEngine(mockStorage, mockMediaStore);
    const blocks = await engine.extractText(media);

    expect(blocks).toHaveLength(0);
  });

  it('throws when offscreen returns error', async () => {
    getMediaMock.mockResolvedValue(new Blob(['img']));
    sendMessageMock.mockResolvedValue({ success: false, error: 'Tesseract failure' });

    const media = {
      id: 'img-1',
      type: MediaType.IMAGE,
      mimeType: 'image/jpeg',
    } as IResource['media'][number];
    const engine = new OcrEngine(mockStorage, mockMediaStore);

    await expect(engine.extractText(media)).rejects.toThrow('Tesseract failure');
  });
});
