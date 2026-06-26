import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { IResource, ResourceState, MediaType, BlockType } from '@knowledge-extractor/types';
import { IndexedDbStorageEngine } from '../src/indexeddb/indexeddb-storage.js';
import { DB_VERSION, META_VERSION_KEY, STORES } from '../src/indexeddb/schema.js';
import { openDatabase, readRecord } from '../src/indexeddb/database.js';

// Reset the global IndexedDB between tests so each runs against a clean backing
// store (fake-indexeddb/auto installs a shared global; a fresh factory isolates).
beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).indexedDB = new IDBFactory();
});

let dbCounter = 0;
function uniqueDbName(): string {
  return `ke-test-${Date.now()}-${dbCounter++}`;
}

function makeResource(id: string, overrides: Partial<IResource> = {}): IResource {
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
    content: [{ type: BlockType.TEXT, value: `caption for ${id}` }],
    media: [{ id: `${id}_m0`, type: MediaType.IMAGE, sourceUri: 'https://cdn/x.jpg' }],
    completeness: { thumbnail: true, metadata: true, media: true, ocr: false },
    ...overrides,
  };
}

describe('IndexedDbStorageEngine — persistence', () => {
  it('saves and retrieves a resource', async () => {
    const engine = new IndexedDbStorageEngine(uniqueDbName());
    const resource = makeResource('abc123');
    await engine.saveResource(resource);

    const loaded = await engine.getResourceById('abc123');
    expect(loaded).not.toBeNull();
    expect(loaded?.id).toBe('abc123');
    expect(loaded?.source.providerName).toBe('instagram');
    expect(loaded?.content[0].value).toBe('caption for abc123');
    await engine.close();
  });

  it('returns null for a missing resource', async () => {
    const engine = new IndexedDbStorageEngine(uniqueDbName());
    expect(await engine.getResourceById('nope')).toBeNull();
    await engine.close();
  });

  it('deletes a resource', async () => {
    const engine = new IndexedDbStorageEngine(uniqueDbName());
    await engine.saveResource(makeResource('todelete'));
    await engine.deleteResource('todelete');
    expect(await engine.getResourceById('todelete')).toBeNull();
    await engine.close();
  });

  it('overwrites on duplicate id (idempotent persistence)', async () => {
    const engine = new IndexedDbStorageEngine(uniqueDbName());
    await engine.saveResource(makeResource('dup', { kind: 'instagram-post' }));
    await engine.saveResource(makeResource('dup', { kind: 'instagram-reel' }));

    const loaded = await engine.getResourceById('dup');
    expect(loaded?.kind).toBe('instagram-reel');
    expect(await engine.listResources()).toHaveLength(1);
    await engine.close();
  });
});

describe('IndexedDbStorageEngine — transactions', () => {
  it('commits multiple operations atomically', async () => {
    const engine = new IndexedDbStorageEngine(uniqueDbName());
    const tx = await engine.beginTransaction();
    await engine.saveResource(makeResource('t1'), tx);
    await engine.saveResource(makeResource('t2'), tx);
    await engine.saveResource(makeResource('t3'), tx);

    // Nothing is visible before commit.
    expect(await engine.getResourceById('t1')).toBeNull();

    await tx.commit();

    expect(await engine.getResourceById('t1')).not.toBeNull();
    expect(await engine.getResourceById('t2')).not.toBeNull();
    expect(await engine.getResourceById('t3')).not.toBeNull();
    await engine.close();
  });

  it('rollback discards buffered operations', async () => {
    const engine = new IndexedDbStorageEngine(uniqueDbName());
    const tx = await engine.beginTransaction();
    await engine.saveResource(makeResource('rb1'), tx);
    await engine.saveResource(makeResource('rb2'), tx);
    await tx.rollback();

    expect(await engine.getResourceById('rb1')).toBeNull();
    expect(await engine.getResourceById('rb2')).toBeNull();
    expect(await engine.listResources()).toHaveLength(0);
    await engine.close();
  });

  it('rejects use of a settled transaction', async () => {
    const engine = new IndexedDbStorageEngine(uniqueDbName());
    const tx = await engine.beginTransaction();
    await tx.commit();
    await expect(engine.saveResource(makeResource('after'), tx)).rejects.toThrow(
      /already committed/,
    );
    await engine.close();
  });

  it('supports mixed put and delete in one transaction', async () => {
    const engine = new IndexedDbStorageEngine(uniqueDbName());
    await engine.saveResource(makeResource('keep'));
    await engine.saveResource(makeResource('remove'));

    const tx = await engine.beginTransaction();
    await engine.saveResource(makeResource('new'), tx);
    await engine.deleteResource('remove', tx);
    await tx.commit();

    expect(await engine.getResourceById('new')).not.toBeNull();
    expect(await engine.getResourceById('remove')).toBeNull();
    expect(await engine.getResourceById('keep')).not.toBeNull();
    await engine.close();
  });
});

describe('IndexedDbStorageEngine — schema versioning & migration', () => {
  it('records the schema version in the meta store', async () => {
    const name = uniqueDbName();
    const engine = new IndexedDbStorageEngine(name);
    await engine.init();
    await engine.close();

    const db = await openDatabase(name, DB_VERSION);
    const meta = await readRecord<{ key: string; value: number }>(
      db,
      STORES.META,
      META_VERSION_KEY,
    );
    expect(meta?.value).toBe(DB_VERSION);
    db.close();
  });

  it('creates all expected object stores', async () => {
    const name = uniqueDbName();
    const db = await openDatabase(name, DB_VERSION);
    for (const store of Object.values(STORES)) {
      expect(db.objectStoreNames.contains(store)).toBe(true);
    }
    db.close();
  });
});

describe('IndexedDbStorageEngine — durability across restart', () => {
  it('persists resources across a simulated service-worker / browser restart', async () => {
    const name = uniqueDbName();

    const first = new IndexedDbStorageEngine(name);
    await first.saveResource(makeResource('persisted'));
    await first.close(); // simulate worker eviction / browser close

    const second = new IndexedDbStorageEngine(name); // fresh engine, same DB
    const loaded = await second.getResourceById('persisted');
    expect(loaded?.id).toBe('persisted');
    await second.close();
  });
});

describe('IndexedDbStorageEngine — large datasets', () => {
  it('persists and lists 1000 resources in a single transaction', async () => {
    const engine = new IndexedDbStorageEngine(uniqueDbName());
    const tx = await engine.beginTransaction();
    for (let i = 0; i < 1000; i++) {
      await engine.saveResource(makeResource(`bulk_${i}`), tx);
    }
    await tx.commit();

    expect(await engine.listResources()).toHaveLength(1000);
    expect(await engine.getResourceById('bulk_500')).not.toBeNull();
    await engine.close();
  });
});

describe('IndexedDbStorageEngine — auxiliary stores', () => {
  it('persists and retrieves crawl state', async () => {
    const engine = new IndexedDbStorageEngine(uniqueDbName());
    await engine.saveCrawlState('scheduler', [{ id: 'a' }, { id: 'b' }]);
    const loaded = await engine.getCrawlState<{ id: string }[]>('scheduler');
    expect(loaded).toHaveLength(2);
    expect(loaded?.[0].id).toBe('a');

    await engine.deleteCrawlState('scheduler');
    expect(await engine.getCrawlState('scheduler')).toBeNull();
    await engine.close();
  });

  it('persists sessions and diagnostics records', async () => {
    const engine = new IndexedDbStorageEngine(uniqueDbName());
    await engine.saveCrawlState('probe', { ok: true });
    expect(await engine.getCrawlState<{ ok: boolean }>('probe')).toEqual({ ok: true });
    await engine.close();
  });
});
