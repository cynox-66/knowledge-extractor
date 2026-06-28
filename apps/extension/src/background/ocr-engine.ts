import {
  type IOcrEngine,
  type IMedia,
  type IContentBlock,
  type IEnrichmentWorkItem,
  type IStorageEngine,
  type IMediaStore,
  MediaType,
  ResourceState,
} from '@knowledge-extractor/types';
import { Logger } from '@knowledge-extractor/shared';
import type { OcrResponse } from '../offscreen/ocr-host.js';

// CRXJS outputs offscreen HTML preserving the src/ prefix in the dist root.
const OFFSCREEN_URL = 'src/offscreen/ocr-host.html';

export class OcrEngine implements IOcrEngine {
  private readonly logger = new Logger('OcrEngine');

  constructor(
    private readonly storage: IStorageEngine,
    private readonly mediaStore: IMediaStore,
  ) {}

  private async ensureOffscreenDocument(): Promise<void> {
    if (await chrome.offscreen.hasDocument()) return;
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification:
        'Tesseract.js OCR requires a Web Worker; service workers cannot spawn nested workers (crbug.com/1219164).',
    });
  }

  async extractText(media: IMedia): Promise<IContentBlock[]> {
    await this.ensureOffscreenDocument();
    const blob = await this.mediaStore.get(media.id);
    if (blob === null) return [];
    const buffer = await blob.arrayBuffer();
    const response = (await chrome.runtime.sendMessage({
      action: 'OCR_REQUEST',
      mediaId: media.id,
      buffer,
      mimeType: media.mimeType ?? 'image/jpeg',
    })) as OcrResponse;
    if (!response.success) {
      throw new Error(response.error);
    }
    return response.blocks;
  }

  async process(item: IEnrichmentWorkItem): Promise<void> {
    await this.ensureOffscreenDocument();

    const imageIds = item.resource.media
      .filter((m) => m.type === MediaType.IMAGE && m.id in item.resolvedMedia)
      .map((m) => m.id);

    const allBlocks: IContentBlock[] = [];

    for (const mediaId of imageIds) {
      const blob = await this.mediaStore.get(mediaId);
      if (blob === null) {
        this.logger.warn(
          `Blob evicted for media ${mediaId} on resource ${item.resource.id} — skipping`,
        );
        continue;
      }
      const buffer = await blob.arrayBuffer();
      const mimeType = item.resource.media.find((m) => m.id === mediaId)?.mimeType ?? 'image/jpeg';
      try {
        const response = (await chrome.runtime.sendMessage({
          action: 'OCR_REQUEST',
          mediaId,
          buffer,
          mimeType,
        })) as OcrResponse;
        if (response.success) {
          allBlocks.push(...response.blocks);
        } else {
          this.logger.warn(`OCR failed for media ${mediaId}: ${response.error}`);
        }
      } catch (err) {
        this.logger.warn(`OCR dispatch error for media ${mediaId}`, err);
      }
    }

    const resource = item.resource;
    resource.content = [...resource.content, ...allBlocks];
    resource.completeness.ocr = true;
    resource.state = ResourceState.ENRICHED;
    await this.storage.saveResource(resource);
  }

  async terminate(): Promise<void> {
    try {
      await chrome.runtime.sendMessage({ action: 'OCR_TERMINATE' });
    } catch {
      // Offscreen doc may already be closed or was never opened.
    }
    try {
      await chrome.offscreen.closeDocument();
    } catch {
      // Document may not exist.
    }
  }
}
