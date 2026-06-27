import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { IControlStateStore } from '@knowledge-extractor/types';
import { IndexedDbStorageEngine } from '../src/indexeddb/indexeddb-storage.js';

// Fresh IDB factory per test for isolation (fake-indexeddb installs a global).
beforeEach(() => {
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
});

let dbCounter = 0;
function uniqueDbName(): string {
  return `ke-cs-test-${Date.now()}-${dbCounter++}`;
}

describe('IndexedDbStorageEngine — IControlStateStore contract', () => {
  it('implements IControlStateStore at the type level', () => {
    // Compile-time assertion that the class satisfies the interface.
    const engine = new IndexedDbStorageEngine(uniqueDbName());
    const _store: IControlStateStore = engine;
    expect(_store).toBe(engine);
  });

  it('round-trips sessions and lists history', async () => {
    const store: IControlStateStore = new IndexedDbStorageEngine(uniqueDbName());
    await store.saveSession({
      sessionId: 's1',
      startedAt: new Date().toISOString(),
      isRunning: true,
      isPaused: false,
      isCancelled: false,
      currentResource: '',
      navigationStatus: 'idle',
      queueDepth: 0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      metrics: {} as any,
    });
    expect(await store.getSession('s1')).not.toBeNull();
    expect(await store.getSession('missing')).toBeNull();
    expect(await store.listSessions()).toHaveLength(1);
  });

  it('round-trips diagnostics', async () => {
    const store: IControlStateStore = new IndexedDbStorageEngine(uniqueDbName());
    await store.saveDiagnostics({
      sessionId: 'd1',
      startedAt: '',
      endedAt: '',
      pageUrl: '',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      metrics: {} as any,
      failures: [],
      strategyUsage: {},
    });
    const got = await store.getDiagnostics('d1');
    expect(got?.sessionId).toBe('d1');
  });

  it('round-trips arbitrary crawl-state values keyed by string', async () => {
    const store: IControlStateStore = new IndexedDbStorageEngine(uniqueDbName());
    await store.saveCrawlState('queue', [{ id: 'a' }, { id: 'b' }]);
    const loaded = await store.getCrawlState<{ id: string }[]>('queue');
    expect(loaded).toHaveLength(2);
    expect(loaded?.[0].id).toBe('a');

    await store.deleteCrawlState('queue');
    expect(await store.getCrawlState('queue')).toBeNull();
  });

  it('persists across a simulated restart (fresh engine, same DB name)', async () => {
    const name = uniqueDbName();
    const first: IControlStateStore = new IndexedDbStorageEngine(name);
    await first.saveCrawlState('current_session', { sessionId: 'restart-me' });

    const second: IControlStateStore = new IndexedDbStorageEngine(name);
    const restored = await second.getCrawlState<{ sessionId: string }>('current_session');
    expect(restored?.sessionId).toBe('restart-me');
  });
});
