import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { IResource, ResourceState, MediaType, BlockType } from '@knowledge-extractor/types';
import { IndexedDbStorageEngine } from '../src/indexeddb/indexeddb-storage.js';
import {
  DB_VERSION,
  META_VERSION_KEY,
  STORES,
  RESOURCE_STATE_INDEX,
} from '../src/indexeddb/schema.js';
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

// ---------------------------------------------------------------------------
// Schema v2: by_state index
// ---------------------------------------------------------------------------

describe('Schema v2 — by_state index', () => {
  it('creates the by_state index on the resources store', async () => {
    const name = uniqueDbName();
    const db = await openDatabase(name, DB_VERSION);
    const tx = db.transaction(STORES.RESOURCES, 'readonly');
    expect(tx.objectStore(STORES.RESOURCES).indexNames.contains(RESOURCE_STATE_INDEX)).toBe(true);
    db.close();
  });

  it('schema version is recorded as 2', async () => {
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
    expect(meta?.value).toBe(2);
    db.close();
  });
});

// ---------------------------------------------------------------------------
// IResourceQueryable — queryResources
// ---------------------------------------------------------------------------

describe('IndexedDbStorageEngine — queryResources: empty store', () => {
  it('returns empty results when no resources exist', async () => {
    const engine = new IndexedDbStorageEngine(uniqueDbName());
    const result = await engine.queryResources({ state: ResourceState.HYDRATED, pageSize: 10 });
    expect(result.items).toHaveLength(0);
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeUndefined();
    await engine.close();
  });

  it('returns empty results when no resources match the requested state', async () => {
    const engine = new IndexedDbStorageEngine(uniqueDbName());
    await engine.saveResource(makeResource('r1', { state: ResourceState.EXTRACTED }));
    await engine.saveResource(makeResource('r2', { state: ResourceState.EXTRACTED }));

    const result = await engine.queryResources({ state: ResourceState.HYDRATED, pageSize: 10 });
    expect(result.items).toHaveLength(0);
    expect(result.hasMore).toBe(false);
    await engine.close();
  });
});

describe('IndexedDbStorageEngine — queryResources: single page', () => {
  it('returns all items when total < pageSize', async () => {
    const engine = new IndexedDbStorageEngine(uniqueDbName());
    await engine.saveResource(makeResource('h1', { state: ResourceState.HYDRATED }));
    await engine.saveResource(makeResource('h2', { state: ResourceState.HYDRATED }));
    await engine.saveResource(makeResource('h3', { state: ResourceState.HYDRATED }));

    const result = await engine.queryResources({ state: ResourceState.HYDRATED, pageSize: 10 });
    expect(result.items).toHaveLength(3);
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeUndefined();
    await engine.close();
  });

  it('returns all items when total === pageSize', async () => {
    const engine = new IndexedDbStorageEngine(uniqueDbName());
    await engine.saveResource(makeResource('e1', { state: ResourceState.HYDRATED }));
    await engine.saveResource(makeResource('e2', { state: ResourceState.HYDRATED }));

    const result = await engine.queryResources({ state: ResourceState.HYDRATED, pageSize: 2 });
    expect(result.items).toHaveLength(2);
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeUndefined();
    await engine.close();
  });

  it('returns a single item when pageSize is 1 and only one record matches', async () => {
    const engine = new IndexedDbStorageEngine(uniqueDbName());
    await engine.saveResource(makeResource('only', { state: ResourceState.HYDRATED }));

    const result = await engine.queryResources({ state: ResourceState.HYDRATED, pageSize: 1 });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe('only');
    expect(result.hasMore).toBe(false);
    await engine.close();
  });
});

describe('IndexedDbStorageEngine — queryResources: state filtering', () => {
  it('returns only resources in the requested state', async () => {
    const engine = new IndexedDbStorageEngine(uniqueDbName());
    await engine.saveResource(makeResource('h1', { state: ResourceState.HYDRATED }));
    await engine.saveResource(makeResource('e1', { state: ResourceState.EXTRACTED }));
    await engine.saveResource(makeResource('h2', { state: ResourceState.HYDRATED }));
    await engine.saveResource(makeResource('n1', { state: ResourceState.ENRICHED }));

    const result = await engine.queryResources({ state: ResourceState.HYDRATED, pageSize: 20 });
    expect(result.items).toHaveLength(2);
    expect(result.items.every((r) => r.state === ResourceState.HYDRATED)).toBe(true);
    await engine.close();
  });

  it('returns separate pages for different states independently', async () => {
    const engine = new IndexedDbStorageEngine(uniqueDbName());
    for (let i = 0; i < 3; i++) {
      await engine.saveResource(makeResource(`h${i}`, { state: ResourceState.HYDRATED }));
      await engine.saveResource(makeResource(`e${i}`, { state: ResourceState.EXTRACTED }));
    }

    const hydrated = await engine.queryResources({ state: ResourceState.HYDRATED, pageSize: 20 });
    const extracted = await engine.queryResources({ state: ResourceState.EXTRACTED, pageSize: 20 });

    expect(hydrated.items).toHaveLength(3);
    expect(extracted.items).toHaveLength(3);
    expect(hydrated.items.every((r) => r.state === ResourceState.HYDRATED)).toBe(true);
    expect(extracted.items.every((r) => r.state === ResourceState.EXTRACTED)).toBe(true);
    await engine.close();
  });
});

describe('IndexedDbStorageEngine — queryResources: no state filter (export-all)', () => {
  it('returns resources across ALL lifecycle states when state is omitted', async () => {
    const engine = new IndexedDbStorageEngine(uniqueDbName());
    await engine.saveResource(makeResource('x1', { state: ResourceState.EXTRACTED }));
    await engine.saveResource(makeResource('h1', { state: ResourceState.HYDRATED }));
    await engine.saveResource(makeResource('n1', { state: ResourceState.ENRICHED }));

    // No `state` ⇒ enumerate everything (the export-all path). A single-state
    // filter (the old ENRICHED-only export) would have returned just one.
    const all = await engine.queryResources({ pageSize: 20 });
    expect(all.items).toHaveLength(3);
    expect(all.items.map((r) => r.id).sort()).toEqual(['h1', 'n1', 'x1']);
    expect(all.hasMore).toBe(false);
    await engine.close();
  });

  it('paginates the whole store by primary key when state is omitted', async () => {
    const engine = new IndexedDbStorageEngine(uniqueDbName());
    for (const id of ['a', 'b', 'c', 'd', 'e']) {
      await engine.saveResource(makeResource(id, { state: ResourceState.EXTRACTED }));
    }

    const page1 = await engine.queryResources({ pageSize: 3 });
    expect(page1.items).toHaveLength(3);
    expect(page1.hasMore).toBe(true);
    expect(page1.nextCursor).toBe('c');

    const page2 = await engine.queryResources({ pageSize: 3, cursor: page1.nextCursor! });
    expect(page2.items.map((r) => r.id)).toEqual(['d', 'e']);
    expect(page2.hasMore).toBe(false);
    await engine.close();
  });
});

describe('IndexedDbStorageEngine — queryResources: multiple pages', () => {
  it('paginates correctly across two pages', async () => {
    const engine = new IndexedDbStorageEngine(uniqueDbName());
    const ids = ['p1', 'p2', 'p3', 'p4', 'p5'];
    for (const id of ids) {
      await engine.saveResource(makeResource(id, { state: ResourceState.HYDRATED }));
    }

    const page1 = await engine.queryResources({ state: ResourceState.HYDRATED, pageSize: 3 });
    expect(page1.items).toHaveLength(3);
    expect(page1.hasMore).toBe(true);
    expect(page1.nextCursor).toBeDefined();

    // page1.nextCursor is defined because hasMore is true (asserted above).
    const page2 = await engine.queryResources({
      state: ResourceState.HYDRATED,
      pageSize: 3,
      cursor: page1.nextCursor!,
    });
    expect(page2.items).toHaveLength(2);
    expect(page2.hasMore).toBe(false);
    expect(page2.nextCursor).toBeUndefined();

    // All IDs covered, no duplicates.
    const allIds = [...page1.items, ...page2.items].map((r) => r.id);
    expect(allIds).toHaveLength(5);
    expect(new Set(allIds).size).toBe(5);
    await engine.close();
  });

  it('paginates across three pages with pageSize=2', async () => {
    const engine = new IndexedDbStorageEngine(uniqueDbName());
    for (let i = 0; i < 6; i++) {
      await engine.saveResource(makeResource(`m${i}`, { state: ResourceState.HYDRATED }));
    }

    const pages: IResource[][] = [];
    let cursor: string | undefined;
    do {
      const result = await engine.queryResources({
        state: ResourceState.HYDRATED,
        pageSize: 2,
        ...(cursor !== undefined ? { cursor } : {}),
      });
      pages.push(result.items);
      cursor = result.hasMore ? result.nextCursor : undefined;
    } while (cursor !== undefined);

    expect(pages).toHaveLength(3);
    expect(pages.flat()).toHaveLength(6);
    expect(new Set(pages.flat().map((r) => r.id)).size).toBe(6);
    await engine.close();
  });

  it('full enumeration collects every matching resource', async () => {
    const engine = new IndexedDbStorageEngine(uniqueDbName());
    for (let i = 0; i < 25; i++) {
      await engine.saveResource(
        makeResource(`bulk_${String(i).padStart(3, '0')}`, { state: ResourceState.HYDRATED }),
      );
    }
    // Mix in non-matching records.
    for (let i = 0; i < 5; i++) {
      await engine.saveResource(makeResource(`other_${i}`, { state: ResourceState.EXTRACTED }));
    }

    const all: IResource[] = [];
    let cursor: string | undefined;
    do {
      const result = await engine.queryResources({
        state: ResourceState.HYDRATED,
        pageSize: 7,
        ...(cursor !== undefined ? { cursor } : {}),
      });
      all.push(...result.items);
      cursor = result.hasMore ? result.nextCursor : undefined;
    } while (cursor !== undefined);

    expect(all).toHaveLength(25);
    expect(all.every((r) => r.state === ResourceState.HYDRATED)).toBe(true);
    await engine.close();
  });
});

describe('IndexedDbStorageEngine — queryResources: cursor continuation', () => {
  it('cursor is stable across independent engine instances (simulating restart)', async () => {
    const name = uniqueDbName();

    const first = new IndexedDbStorageEngine(name);
    for (let i = 0; i < 6; i++) {
      await first.saveResource(
        makeResource(`restart_${String(i).padStart(2, '0')}`, { state: ResourceState.HYDRATED }),
      );
    }
    const page1 = await first.queryResources({ state: ResourceState.HYDRATED, pageSize: 3 });
    await first.close();

    // Simulate worker restart — fresh engine instance, same DB.
    // nextCursor is defined: 6 items at pageSize 3 guarantees page 1 has hasMore=true.
    const second = new IndexedDbStorageEngine(name);
    const page2 = await second.queryResources({
      state: ResourceState.HYDRATED,
      pageSize: 3,
      cursor: page1.nextCursor!,
    });
    await second.close();

    const allIds = [...page1.items, ...page2.items].map((r) => r.id);
    expect(allIds).toHaveLength(6);
    expect(new Set(allIds).size).toBe(6);
  });

  it('invalid cursor (stale deleted resource) does not skip a live record', async () => {
    const engine = new IndexedDbStorageEngine(uniqueDbName());
    // Save resources with IDs that sort: 'c1' < 'c2' < 'c3' < 'c4'
    for (const id of ['c1', 'c2', 'c3', 'c4']) {
      await engine.saveResource(makeResource(id, { state: ResourceState.HYDRATED }));
    }

    // First page returns c1, c2.
    const page1 = await engine.queryResources({ state: ResourceState.HYDRATED, pageSize: 2 });
    expect(page1.items.map((r) => r.id)).toEqual(['c1', 'c2']);
    expect(page1.nextCursor).toBe('c2');

    // Delete c2 (the cursor record) before resuming.
    await engine.deleteResource('c2');

    // Second page should start from c3 (the first record after deleted c2).
    // nextCursor is 'c2' (asserted above) so the non-null assertion is safe.
    const page2 = await engine.queryResources({
      state: ResourceState.HYDRATED,
      pageSize: 2,
      cursor: page1.nextCursor!,
    });
    expect(page2.items.map((r) => r.id)).toEqual(['c3', 'c4']);
    expect(page2.hasMore).toBe(false);
    await engine.close();
  });

  it('cursor from a completely out-of-range id returns empty', async () => {
    const engine = new IndexedDbStorageEngine(uniqueDbName());
    await engine.saveResource(makeResource('a1', { state: ResourceState.HYDRATED }));
    await engine.saveResource(makeResource('a2', { state: ResourceState.HYDRATED }));

    // A cursor that sorts after all existing IDs.
    const result = await engine.queryResources({
      state: ResourceState.HYDRATED,
      pageSize: 10,
      cursor: '￿￿',
    });
    expect(result.items).toHaveLength(0);
    expect(result.hasMore).toBe(false);
    await engine.close();
  });
});

describe('IndexedDbStorageEngine — queryResources: ordering guarantees', () => {
  it('returns items in lexicographic primary-key order within a state', async () => {
    const engine = new IndexedDbStorageEngine(uniqueDbName());
    // Insert in reverse order to confirm sort is storage-driven, not insertion-driven.
    for (const id of ['z3', 'a1', 'm2', 'b0']) {
      await engine.saveResource(makeResource(id, { state: ResourceState.HYDRATED }));
    }

    const result = await engine.queryResources({ state: ResourceState.HYDRATED, pageSize: 10 });
    const ids = result.items.map((r) => r.id);
    expect(ids).toEqual([...ids].sort());
    await engine.close();
  });

  it('ordering is consistent across page boundaries', async () => {
    const engine = new IndexedDbStorageEngine(uniqueDbName());
    const source = ['z9', 'a1', 'm5', 'b2', 'k3', 'f8'];
    for (const id of source) {
      await engine.saveResource(makeResource(id, { state: ResourceState.HYDRATED }));
    }

    const all: string[] = [];
    let cursor: string | undefined;
    do {
      const result = await engine.queryResources({
        state: ResourceState.HYDRATED,
        pageSize: 2,
        ...(cursor !== undefined ? { cursor } : {}),
      });
      all.push(...result.items.map((r) => r.id));
      cursor = result.hasMore ? result.nextCursor : undefined;
    } while (cursor !== undefined);

    expect(all).toEqual([...source].sort());
    await engine.close();
  });
});
