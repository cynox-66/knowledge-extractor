/**
 * Surface awareness for the Instagram connector.
 *
 * Instagram presents fundamentally different interaction models per route, and
 * the original navigator assumed exactly one of them (grid + modal) everywhere
 * (RCA-1/2):
 *
 *  - the **home feed** (`/`) renders full posts inline. Clicking a post's
 *    permalink triggers a real SPA route change *away* from the feed, so home
 *    feed posts must be extracted **in place** — never clicked into;
 *  - **grid** surfaces (saved, profile, explore) render thumbnails that open a
 *    post **modal** overlaying the grid (the grid DOM stays mounted behind it);
 *  - **reels** is a vertical player (treated as in-place for now).
 *
 * A {@link SurfaceDescriptor} captures the per-route knowledge the Navigator and
 * DiscoveryEngine need: how a post is opened, which element scrolls to load more
 * content, and whether a given URL still belongs to this surface (the route
 * guard). This is Instagram DOM knowledge, so it lives in the connector — the
 * generic content-script Navigator merely consumes it.
 */

export type SurfaceKind = 'home-feed' | 'grid' | 'reels' | 'unknown';

/** How a discovered post is opened for extraction. */
export type OpenMode = 'in-place' | 'modal';

export interface SurfaceDescriptor {
  readonly kind: SurfaceKind;
  readonly openMode: OpenMode;
  /**
   * CSS selectors (most-specific first) for the element that scrolls to load
   * more content. The Navigator tries each in order and falls back to the
   * window/document scroller if none match (RCA-4). Empty = window only.
   */
  readonly scrollContainerSelectors: readonly string[];
  /**
   * Whether `url` still belongs to this surface. For grids this tolerates a
   * transient post permalink (`/p/…`, `/reel/…`) pushed onto the address bar by
   * an open modal — the crawl is still "on" the grid. For the home feed, which
   * never opens a modal, a permalink means a genuine navigation away, so it is
   * NOT on-surface. The discovery route guard uses this to stop queueing links
   * from a page the crawl has actually navigated away from (RCA-2/5).
   */
  isOnSurface(url: string): boolean;
}

function safePath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return '';
  }
}

/** A bare permalink to a post or reel (what a grid modal shows in the URL). */
function isPostPermalink(path: string): boolean {
  return /^\/(p|reel)\//.test(path);
}

/**
 * A single-segment path is a profile (`/username/`), optionally with a profile
 * sub-tab (`/username/tagged/`). Excludes reserved first segments that are not
 * usernames.
 */
const RESERVED_FIRST_SEGMENTS = new Set([
  'p',
  'reel',
  'reels',
  'explore',
  'stories',
  'direct',
  'accounts',
  'about',
  'developer',
]);

function isProfilePath(path: string): boolean {
  const segments = path.split('/').filter(Boolean);
  if (segments.length === 0) return false;
  if (RESERVED_FIRST_SEGMENTS.has(segments[0])) return false;
  // /username or /username/<tab> (saved is handled separately below).
  return segments.length <= 2;
}

function gridSurface(rootPath: string, scrollContainerSelectors: string[]): SurfaceDescriptor {
  return {
    kind: 'grid',
    openMode: 'modal',
    scrollContainerSelectors,
    isOnSurface(url: string): boolean {
      const p = safePath(url);
      // Still on the grid, or showing a post/reel modal overlaying the grid.
      return p === rootPath || p.startsWith(rootPath) || isPostPermalink(p);
    },
  };
}

const HOME_FEED: SurfaceDescriptor = {
  kind: 'home-feed',
  openMode: 'in-place',
  // The feed scrolls the window; no inner container.
  scrollContainerSelectors: [],
  isOnSurface(url: string): boolean {
    const p = safePath(url);
    // The home feed never opens a modal, so any permalink in the URL means a
    // real navigation away — explicitly off-surface (RCA-2).
    return p === '/' || p === '';
  },
};

const REELS: SurfaceDescriptor = {
  kind: 'reels',
  openMode: 'in-place',
  scrollContainerSelectors: [],
  isOnSurface(url: string): boolean {
    return safePath(url).startsWith('/reels');
  },
};

const UNKNOWN: SurfaceDescriptor = {
  kind: 'unknown',
  openMode: 'in-place',
  scrollContainerSelectors: [],
  isOnSurface(): boolean {
    return true;
  },
};

/**
 * Grid scroll containers, most-specific first. Instagram virtualizes the grid
 * inside an overflow container rather than the window; the Navigator probes
 * these and falls back to the window if none match (RCA-4). Kept broad and
 * resilient because Instagram class names are unstable.
 */
const GRID_SCROLL_SELECTORS = ['main [style*="overflow"]', 'main'];

/**
 * Classifies the current page into a {@link SurfaceDescriptor} from its URL.
 * Pure and DOM-free so it is trivially unit-testable.
 */
export function detectSurface(url: string): SurfaceDescriptor {
  const path = safePath(url);

  if (path === '/' || path === '') return HOME_FEED;
  if (path.startsWith('/explore')) return gridSurface('/explore', GRID_SCROLL_SELECTORS);
  if (path.startsWith('/reels') || path.startsWith('/reel/')) return REELS;

  // Saved lives under the profile (`/<user>/saved/...`). Match it before the
  // generic profile case so the grid root is the saved collection.
  const savedMatch = path.match(/^\/[^/]+\/saved(?:\/|$)/);
  if (savedMatch) return gridSurface(savedMatch[0].replace(/\/$/, ''), GRID_SCROLL_SELECTORS);

  if (isProfilePath(path)) {
    const root = '/' + path.split('/').filter(Boolean)[0];
    return gridSurface(root, GRID_SCROLL_SELECTORS);
  }

  return UNKNOWN;
}

/**
 * Multi-candidate selectors for the open post modal. The original navigator
 * pinned a single `article[role="presentation"]` string and timed out whenever
 * Instagram's markup drifted (RCA-1). This tries each candidate and validates
 * it is a real post modal (carries a permalink or an article body) so unrelated
 * dialogs — cookie banners, notification prompts — are never mistaken for it.
 */
const MODAL_CONTAINER_SELECTORS = ['div[role="dialog"]', 'article[role="presentation"]'];

export function findOpenPostModal(doc: Document = document): Element | null {
  for (const selector of MODAL_CONTAINER_SELECTORS) {
    for (const candidate of Array.from(doc.querySelectorAll(selector))) {
      const hasPermalink = candidate.querySelector('a[href*="/p/"], a[href*="/reel/"]') !== null;
      const hasArticle =
        candidate.matches('article') || candidate.querySelector('article') !== null;
      if (hasPermalink || hasArticle) return candidate;
    }
  }
  return null;
}
