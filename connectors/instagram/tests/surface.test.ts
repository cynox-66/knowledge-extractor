import { describe, it, expect } from 'vitest';
import { detectSurface, findOpenPostModal } from '../src/surface.js';

const IG = 'https://www.instagram.com';

describe('detectSurface — classification', () => {
  it('classifies the home feed as in-place', () => {
    const s = detectSurface(`${IG}/`);
    expect(s.kind).toBe('home-feed');
    expect(s.openMode).toBe('in-place');
  });

  it('classifies saved as a modal grid', () => {
    const s = detectSurface(`${IG}/dev/saved/all-posts/`);
    expect(s.kind).toBe('grid');
    expect(s.openMode).toBe('modal');
  });

  it('classifies a profile as a modal grid', () => {
    const s = detectSurface(`${IG}/nasa/`);
    expect(s.kind).toBe('grid');
    expect(s.openMode).toBe('modal');
  });

  it('classifies explore as a modal grid', () => {
    expect(detectSurface(`${IG}/explore/`).kind).toBe('grid');
    expect(detectSurface(`${IG}/explore/tags/cats/`).openMode).toBe('modal');
  });

  it('classifies reels as in-place', () => {
    expect(detectSurface(`${IG}/reels/`).kind).toBe('reels');
  });
});

describe('SurfaceDescriptor.isOnSurface — route guard', () => {
  it('home feed: a post permalink is OFF surface (real navigation away)', () => {
    const home = detectSurface(`${IG}/`);
    expect(home.isOnSurface(`${IG}/`)).toBe(true);
    expect(home.isOnSurface(`${IG}/p/ABC123/`)).toBe(false);
    expect(home.isOnSurface(`${IG}/nasa/`)).toBe(false);
  });

  it('grid: a post permalink is STILL on surface (modal overlay)', () => {
    const saved = detectSurface(`${IG}/dev/saved/all-posts/`);
    expect(saved.isOnSurface(`${IG}/dev/saved/all-posts/`)).toBe(true);
    // Modal pushes a permalink onto the URL — crawl is still on the grid.
    expect(saved.isOnSurface(`${IG}/p/ABC123/`)).toBe(true);
    expect(saved.isOnSurface(`${IG}/reel/XYZ/`)).toBe(true);
  });

  it('grid: navigating to a different profile is OFF surface', () => {
    const profile = detectSurface(`${IG}/nasa/`);
    expect(profile.isOnSurface(`${IG}/nasa/`)).toBe(true);
    expect(profile.isOnSurface(`${IG}/someoneelse/`)).toBe(false);
  });
});

describe('findOpenPostModal — robust detection', () => {
  it('finds a role=dialog modal that contains a post permalink', () => {
    document.body.innerHTML = `
      <div role="dialog">
        <article><a href="/p/ABC123/">post</a></article>
      </div>`;
    expect(findOpenPostModal(document)).not.toBeNull();
  });

  it('ignores a non-post dialog (e.g. a notification prompt)', () => {
    document.body.innerHTML = `
      <div role="dialog"><button>Turn on Notifications</button></div>`;
    expect(findOpenPostModal(document)).toBeNull();
  });

  it('falls back to the legacy article[role=presentation] container', () => {
    document.body.innerHTML = `
      <article role="presentation"><a href="/reel/XYZ/">reel</a></article>`;
    expect(findOpenPostModal(document)).not.toBeNull();
  });

  it('returns null when no modal is open', () => {
    document.body.innerHTML = `<main><article><a href="/p/Z/">feed post</a></article></main>`;
    expect(findOpenPostModal(document)).toBeNull();
  });
});
