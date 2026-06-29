import { describe, it, expect } from 'vitest';
import { IResource, IMedia, MediaType, ResourceState, BlockType } from '@knowledge-extractor/types';
import { MediaStore, InMemoryBlobBackend } from '@knowledge-extractor/storage';
import {
  MediaCaptureCoordinator,
  type ICaptureTransport,
  type ICaptureResponse,
} from '../src/background/media-capture.js';

/** The pinned crawl tab id threaded into every hydrate call (RCA-8). */
const TEST_TAB_ID = 42;

// ---- Builders --------------------------------------------------------------

function makeMedia(id: string, overrides: Partial<IMedia> = {}): IMedia {
  return {
    id,
    type: MediaType.IMAGE,
    sourceUri: `https://cdn.instagram.com/${id}.jpg`,
    ...overrides,
  };
}

function makeResource(id: string, media: IMedia[], children?: IResource[]): IResource {
  return {
    id,
    kind: 'instagram-post',
    state: ResourceState.EXTRACTED,
    source: {
      providerName: 'instagram',
      externalId: id,
      originalUri: `https://www.instagram.com/p/${id}/`,
      extractedAt: new Date().toISOString(),
    },
    content: [{ type: BlockType.TEXT, value: '' }],
    media,
    ...(children ? { children } : {}),
    completeness: { thumbnail: true, metadata: true, media: true, ocr: false },
  };
}

function bytesFor(s: string): ArrayBuffer {
  const u8 = new TextEncoder().encode(s);
  // Slice to a fresh ArrayBuffer (TextEncoder may share a backing buffer).
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

/** Transport that returns a programmable response. */
function transportFrom(response: ICaptureResponse): ICaptureTransport {
  return { capture: () => Promise.resolve(response) };
}

function freshStore(): MediaStore {
  return new MediaStore(new InMemoryBlobBackend());
}

// ---- Tests -----------------------------------------------------------------

describe('MediaCaptureCoordinator — success path', () => {
  it('persists all images and marks the resource HYDRATED', async () => {
    const store = freshStore();
    const resource = makeResource('r1', [makeMedia('r1_m0'), makeMedia('r1_m1')]);
    const transport = transportFrom({
      success: true,
      captured: [
        { id: 'r1_m0', bytes: bytesFor('a'), mimeType: 'image/jpeg', sizeBytes: 1, source: 'x' },
        { id: 'r1_m1', bytes: bytesFor('bb'), mimeType: 'image/jpeg', sizeBytes: 2, source: 'x' },
      ],
      failed: [],
    });
    const coordinator = new MediaCaptureCoordinator(transport, store);

    const outcome = await coordinator.hydrate(resource, TEST_TAB_ID);

    expect(outcome.persisted).toBe(2);
    expect(outcome.failures).toHaveLength(0);
    expect(resource.state).toBe(ResourceState.HYDRATED);
    expect(resource.media[0].localUri).toBeTruthy();
    expect(resource.media[1].localUri).toBeTruthy();
    expect(resource.completeness.media).toBe(true);
    expect(await store.exists('r1_m0')).toBe(true);
    expect(await store.exists('r1_m1')).toBe(true);
  });
});

describe('MediaCaptureCoordinator — partial / total failure', () => {
  it('keeps the resource EXTRACTED with completeness.media=false on partial failure', async () => {
    const store = freshStore();
    const resource = makeResource('r2', [makeMedia('r2_m0'), makeMedia('r2_m1')]);
    const transport = transportFrom({
      success: true,
      captured: [
        { id: 'r2_m0', bytes: bytesFor('a'), mimeType: 'image/jpeg', sizeBytes: 1, source: 'x' },
      ],
      failed: [{ id: 'r2_m1', error: 'HTTP 403' }],
    });
    const coordinator = new MediaCaptureCoordinator(transport, store);

    const outcome = await coordinator.hydrate(resource, TEST_TAB_ID);

    expect(outcome.persisted).toBe(1);
    expect(outcome.failures).toHaveLength(1);
    expect(outcome.failures[0].reason).toContain('403');
    expect(resource.state).toBe(ResourceState.EXTRACTED);
    expect(resource.completeness.media).toBe(false);
    expect(resource.media[0].localUri).toBeTruthy();
    expect(resource.media[1].localUri).toBeUndefined();
  });

  it('reports failures-only when nothing captures (controller decides retry)', async () => {
    const store = freshStore();
    const resource = makeResource('r3', [makeMedia('r3_m0')]);
    const transport = transportFrom({
      success: true,
      captured: [],
      failed: [{ id: 'r3_m0', error: 'HTTP 500' }],
    });
    const coordinator = new MediaCaptureCoordinator(transport, store);

    const outcome = await coordinator.hydrate(resource, TEST_TAB_ID);

    expect(outcome.persisted).toBe(0);
    expect(outcome.failures).toHaveLength(1);
    expect(resource.state).toBe(ResourceState.EXTRACTED);
  });
});

describe('MediaCaptureCoordinator — skip rules', () => {
  it('skips videos but still HYDRATES when no other media exists for them to gate', async () => {
    const store = freshStore();
    const resource = makeResource('r4', [
      makeMedia('r4_img', { type: MediaType.IMAGE }),
      makeMedia('r4_vid', { type: MediaType.VIDEO }),
    ]);
    const transport = transportFrom({
      success: true,
      captured: [
        { id: 'r4_img', bytes: bytesFor('a'), mimeType: 'image/jpeg', sizeBytes: 1, source: 'x' },
      ],
      failed: [],
    });
    const coordinator = new MediaCaptureCoordinator(transport, store);

    const outcome = await coordinator.hydrate(resource, TEST_TAB_ID);

    expect(outcome.persisted).toBe(1);
    expect(outcome.skipped).toBe(1);
    // Video was deferred → media not fully complete → no HYDRATED promotion.
    expect(resource.completeness.media).toBe(false);
    expect(resource.state).toBe(ResourceState.EXTRACTED);
    expect(resource.media[0].localUri).toBeTruthy();
    expect(resource.media[1].localUri).toBeUndefined();
  });

  it('leaves a media-less resource in EXTRACTED and does not call transport', async () => {
    const store = freshStore();
    let called = 0;
    const transport: ICaptureTransport = {
      capture: () => {
        called++;
        return Promise.resolve({ success: true, captured: [], failed: [] });
      },
    };
    const resource = makeResource('r5', []);
    const coordinator = new MediaCaptureCoordinator(transport, store);

    const outcome = await coordinator.hydrate(resource, TEST_TAB_ID);

    expect(called).toBe(0);
    expect(outcome.persisted).toBe(0);
    expect(resource.state).toBe(ResourceState.EXTRACTED);
  });

  it('skips data:/blob: media (already inline)', async () => {
    const store = freshStore();
    const resource = makeResource('r6', [
      makeMedia('r6_m0', { sourceUri: 'data:image/png;base64,AAA' }),
    ]);
    let called = 0;
    const transport: ICaptureTransport = {
      capture: () => {
        called++;
        return Promise.resolve({ success: true, captured: [], failed: [] });
      },
    };
    const coordinator = new MediaCaptureCoordinator(transport, store);

    const outcome = await coordinator.hydrate(resource, TEST_TAB_ID);

    expect(called).toBe(0);
    expect(outcome.skipped).toBe(1);
    expect(resource.media[0].localUri).toBeUndefined();
  });
});

describe('MediaCaptureCoordinator — carousels (children)', () => {
  it('hydrates parent + every child and HYDRATES each in turn', async () => {
    const store = freshStore();
    const child1 = makeResource('s1', [makeMedia('s1_m0')]);
    const child2 = makeResource('s2', [makeMedia('s2_m0')]);
    const parent = makeResource('p1', [makeMedia('p1_m0')], [child1, child2]);

    let calls = 0;
    const transport: ICaptureTransport = {
      capture: (items) => {
        calls++;
        return Promise.resolve({
          success: true,
          captured: items.map((i) => ({
            id: i.id,
            bytes: bytesFor(i.id),
            mimeType: 'image/jpeg',
            sizeBytes: i.id.length,
            source: i.sourceUri,
          })),
          failed: [],
        });
      },
    };
    const coordinator = new MediaCaptureCoordinator(transport, store);

    const outcome = await coordinator.hydrate(parent, TEST_TAB_ID);

    expect(calls).toBe(3); // one transport call per node with fetchable media
    expect(outcome.persisted).toBe(3);
    expect(parent.state).toBe(ResourceState.HYDRATED);
    expect(parent.children?.[0].state).toBe(ResourceState.HYDRATED);
    expect(parent.children?.[1].state).toBe(ResourceState.HYDRATED);
    expect(await store.exists('p1_m0')).toBe(true);
    expect(await store.exists('s1_m0')).toBe(true);
    expect(await store.exists('s2_m0')).toBe(true);
  });

  it('does NOT mark parent HYDRATED if a child fails', async () => {
    const store = freshStore();
    const child = makeResource('s1', [makeMedia('s1_m0')]);
    const parent = makeResource('p1', [makeMedia('p1_m0')], [child]);

    const transport: ICaptureTransport = {
      capture: (items) => {
        if (items[0].id === 'p1_m0') {
          return Promise.resolve({
            success: true,
            captured: [
              {
                id: 'p1_m0',
                bytes: bytesFor('a'),
                mimeType: 'image/jpeg',
                sizeBytes: 1,
                source: 'x',
              },
            ],
            failed: [],
          });
        }
        return Promise.resolve({
          success: true,
          captured: [],
          failed: [{ id: items[0].id, error: 'HTTP 403' }],
        });
      },
    };
    const coordinator = new MediaCaptureCoordinator(transport, store);

    await coordinator.hydrate(parent, TEST_TAB_ID);

    expect(parent.state).toBe(ResourceState.EXTRACTED);
    expect(parent.children?.[0].state).toBe(ResourceState.EXTRACTED);
  });
});

describe('MediaCaptureCoordinator — idempotency on retry', () => {
  it('a second hydrate over the same resource overwrites without orphans or duplicates', async () => {
    const store = freshStore();
    const resource = makeResource('rid', [makeMedia('rid_m0')]);
    const transport = transportFrom({
      success: true,
      captured: [
        { id: 'rid_m0', bytes: bytesFor('v1'), mimeType: 'image/jpeg', sizeBytes: 2, source: 'x' },
      ],
      failed: [],
    });
    const coordinator = new MediaCaptureCoordinator(transport, store);

    await coordinator.hydrate(resource, TEST_TAB_ID);
    const first = await store.list();

    // Retry: identical inputs.
    await coordinator.hydrate(resource, TEST_TAB_ID);
    const second = await store.list();

    expect(second).toHaveLength(first.length);
    expect(second).toHaveLength(1);
    expect(resource.media[0].localUri).toBeTruthy();
  });
});

describe('MediaCaptureCoordinator — size guard', () => {
  it('rejects an oversize blob and records a failure', async () => {
    const store = freshStore();
    const resource = makeResource('rbig', [makeMedia('rbig_m0')]);
    const oversize = new ArrayBuffer(21 * 1024 * 1024); // > 20 MB cap
    const transport = transportFrom({
      success: true,
      captured: [
        {
          id: 'rbig_m0',
          bytes: oversize,
          mimeType: 'image/jpeg',
          sizeBytes: oversize.byteLength,
          source: 'x',
        },
      ],
      failed: [],
    });
    const coordinator = new MediaCaptureCoordinator(transport, store);

    const outcome = await coordinator.hydrate(resource, TEST_TAB_ID);

    expect(outcome.persisted).toBe(0);
    expect(outcome.failures).toHaveLength(1);
    expect(outcome.failures[0].reason).toMatch(/too large/);
    expect(resource.state).toBe(ResourceState.EXTRACTED);
  });
});
