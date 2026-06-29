import { describe, it, expect, afterEach } from 'vitest';
import { DiscoveryEngine } from '../src/discovery-engine.js';
import type { SurfaceDescriptor } from '../src/surface.js';

/** A surface stub with a controllable route-guard verdict and kind. */
function surfaceStub(
  onSurface: boolean,
  kind: SurfaceDescriptor['kind'] = 'grid',
): SurfaceDescriptor {
  return {
    kind,
    openMode: kind === 'home-feed' ? 'in-place' : 'modal',
    scrollContainerSelectors: [],
    isOnSurface: () => onSurface,
  };
}

/** Collects the targetUri pathnames discovered during a synchronous scan. */
function discoveredPaths(surface: SurfaceDescriptor): string[] {
  const engine = new DiscoveryEngine();
  const found: string[] = [];
  engine.start((resource) => {
    found.push(new URL(resource.targetUri).pathname);
  }, surface);
  engine.stop();
  return found;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('DiscoveryEngine — route guard (RCA-2/5)', () => {
  it('excludes links inside an open post modal, keeps grid thumbnails', () => {
    document.body.innerHTML = `
      <main>
        <a href="/p/GRID1/"><img src="t1.jpg" /></a>
        <a href="/p/GRID2/"><img src="t2.jpg" /></a>
        <div role="dialog">
          <article>
            <a href="/p/MODAL_SUGGESTION/">more from author</a>
          </article>
        </div>
      </main>`;

    const paths = discoveredPaths(surfaceStub(true));

    expect(paths).toContain('/p/GRID1/');
    expect(paths).toContain('/p/GRID2/');
    expect(paths).not.toContain('/p/MODAL_SUGGESTION/');
  });

  it('skips scanning entirely when the page has navigated off-surface', () => {
    document.body.innerHTML = `
      <main><a href="/p/SHOULD_NOT_QUEUE/"><img src="x.jpg" /></a></main>`;

    const paths = discoveredPaths(surfaceStub(false));

    expect(paths).toHaveLength(0);
  });
});

describe('DiscoveryEngine — surface-specific discovery (RCA-5)', () => {
  it('home-feed scans articles, not bare grid links', () => {
    document.body.innerHTML = `
      <main>
        <article><a href="/p/FEEDPOST/"><img src="i.jpg" /></a></article>
        <a href="/p/BARE_GRID_LINK/"><img src="g.jpg" /></a>
      </main>`;

    const paths = discoveredPaths(surfaceStub(true, 'home-feed'));

    expect(paths).toContain('/p/FEEDPOST/');
    expect(paths).not.toContain('/p/BARE_GRID_LINK/');
  });

  it('grid scans thumbnail links', () => {
    document.body.innerHTML = `
      <main><a href="/p/THUMB/"><img src="t.jpg" /></a></main>`;

    const paths = discoveredPaths(surfaceStub(true, 'grid'));

    expect(paths).toContain('/p/THUMB/');
  });
});

describe('DiscoveryEngine — incremental scan (RCA-9 / RFC-0001 A4)', () => {
  it('discovers nodes appended after start via the MutationObserver', async () => {
    document.body.innerHTML = `<main></main>`;
    const engine = new DiscoveryEngine();
    const found: string[] = [];
    engine.start(
      (resource) => {
        found.push(new URL(resource.targetUri).pathname);
      },
      surfaceStub(true, 'grid'),
    );

    // Append a new thumbnail after the initial scan (simulates infinite scroll).
    const link = document.createElement('a');
    link.href = '/p/LAZY_LOADED/';
    link.innerHTML = '<img src="z.jpg" />';
    document.querySelector('main')!.appendChild(link);

    // MutationObserver callbacks are microtask-scheduled; let them flush.
    await new Promise((r) => setTimeout(r, 0));
    engine.stop();

    expect(found).toContain('/p/LAZY_LOADED/');
  });
});
