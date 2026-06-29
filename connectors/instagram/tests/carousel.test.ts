import { describe, it, expect, afterEach } from 'vitest';
import { findCarouselNext } from '../src/carousel.js';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('findCarouselNext (RCA-7)', () => {
  it('finds an explicit Next button', () => {
    document.body.innerHTML = `<article><button aria-label="Next">›</button></article>`;
    const next = findCarouselNext(document.querySelector('article')!);
    expect(next).not.toBeNull();
    expect(next?.getAttribute('aria-label')).toBe('Next');
  });

  it('falls back to the button wrapping a labelled Next icon', () => {
    document.body.innerHTML = `
      <article><button><svg aria-label="Next"></svg></button></article>`;
    const next = findCarouselNext(document.querySelector('article')!);
    expect(next?.tagName).toBe('BUTTON');
  });

  it('returns null on the last slide (no Next control)', () => {
    document.body.innerHTML = `<article><img src="last.jpg" /></article>`;
    expect(findCarouselNext(document.querySelector('article')!)).toBeNull();
  });

  it('is scoped — ignores a Next control in a different post', () => {
    document.body.innerHTML = `
      <article id="a"><img src="single.jpg" /></article>
      <article id="b"><button aria-label="Next">›</button></article>`;
    expect(findCarouselNext(document.querySelector('#a')!)).toBeNull();
    expect(findCarouselNext(document.querySelector('#b')!)).not.toBeNull();
  });
});
