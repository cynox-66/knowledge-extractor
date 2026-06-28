import Tesseract from 'tesseract.js';
import { BlockType, type IContentBlock } from '@knowledge-extractor/types';

interface OcrRequestMessage {
  action: 'OCR_REQUEST';
  mediaId: string;
  buffer: ArrayBuffer;
  mimeType: string;
}

interface OcrTerminateMessage {
  action: 'OCR_TERMINATE';
}

type InboundMessage = OcrRequestMessage | OcrTerminateMessage;

export type OcrResponse =
  | { success: true; blocks: IContentBlock[] }
  | { success: false; error: string };

let tesseractWorker: Tesseract.Worker | null = null;

async function getWorker(): Promise<Tesseract.Worker> {
  if (tesseractWorker !== null) return tesseractWorker;

  tesseractWorker = await Tesseract.createWorker('eng', Tesseract.OEM.DEFAULT, {
    workerPath: chrome.runtime.getURL('tesseract/worker.min.js'),
    corePath: chrome.runtime.getURL('tesseract/'),
    langPath: chrome.runtime.getURL('tesseract/lang/'),
    workerBlobURL: false,
    logger: () => {},
  });

  return tesseractWorker;
}

chrome.runtime.onMessage.addListener(
  (
    message: InboundMessage,
    _sender,
    sendResponse: (response: OcrResponse | object) => void,
  ): boolean => {
    if (message.action === 'OCR_REQUEST') {
      void (async () => {
        try {
          const worker = await getWorker();
          const blob = new Blob([message.buffer], { type: message.mimeType });
          const result = await worker.recognize(blob);
          const text = result.data.text.trim();
          const blocks: IContentBlock[] =
            text.length > 0 ? [{ type: BlockType.TRANSCRIPT, value: text }] : [];
          sendResponse({ success: true, blocks } satisfies OcrResponse);
        } catch (err) {
          sendResponse({
            success: false,
            error: err instanceof Error ? err.message : String(err),
          } satisfies OcrResponse);
        }
      })();
      return true;
    }

    if (message.action === 'OCR_TERMINATE') {
      void (async () => {
        if (tesseractWorker !== null) {
          await tesseractWorker.terminate();
          tesseractWorker = null;
        }
        sendResponse({});
      })();
      return true;
    }

    return false;
  },
);
