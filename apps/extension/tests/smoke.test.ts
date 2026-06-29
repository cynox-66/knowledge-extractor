// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { InstagramConnector } from '@knowledge-extractor/connector-instagram';
import { InMemoryStorage } from '@knowledge-extractor/storage';

/**
 * End-to-end pipeline smoke gate (P3).
 *
 * Locks the contract the navigation redesign restored: a real Instagram
 * `<article>` flows extract → normalize → persist and lands a non-empty
 * resource, and a carousel lands every slide (RCA-7). This is the CI-enforced
 * half of P3; the live-Instagram half is the SMOKE.md runbook + the in-extension
 * SmokeHarness.
 */

function articleFrom(html: string): Element {
  document.body.innerHTML = html;
  const article = document.querySelector('article');
  if (!article) throw new Error('fixture has no <article>');
  return article;
}

async function persist(resource: Parameters<InMemoryStorage['saveResource']>[0]): Promise<void> {
  const storage = new InMemoryStorage();
  const tx = await storage.beginTransaction();
  await storage.saveResource(resource, tx);
  await tx.commit();
  expect(await storage.getResourceById(resource.id)).not.toBeNull();
}

const connector = new InstagramConnector();

describe('Pipeline smoke — single-image post', () => {
  it('extracts, normalizes, and persists a non-empty resource', async () => {
    const article = articleFrom(`
      <article>
        <header><a role="link" href="/dev/">dev</a></header>
        <a href="/p/SINGLE1/"><img src="https://cdn.test/i.jpg" width="320" /></a>
        <time datetime="2024-01-01T00:00:00Z"></time>
      </article>`);

    const { post, strategyName } = connector.extract(article);
    expect(strategyName).toBeTruthy();
    expect(post.mediaUris.length).toBeGreaterThan(0);

    const resource = await connector.normalize(post);
    expect(resource.id).toBeTruthy();
    expect(resource.media.length).toBeGreaterThan(0);

    await persist(resource);
  });
});

describe('Pipeline smoke — carousel (RCA-7)', () => {
  it('captures every slide as carousel children', async () => {
    const article = articleFrom(`
      <article>
        <header><a role="link" href="/dev/">dev</a></header>
        <a href="/p/CARO1/"><img src="https://cdn.test/1.jpg" width="320" /></a>
        <img src="https://cdn.test/2.jpg" width="320" />
        <img src="https://cdn.test/3.jpg" width="320" />
        <div aria-label="slide 1"></div>
        <div aria-label="slide 2"></div>
      </article>`);

    const { post } = connector.extract(article);
    const resource = await connector.normalize(post);

    expect(resource.source.metadata?.layout).toBe('carousel');
    expect(resource.media.length).toBeGreaterThan(1);
    expect(resource.children?.length ?? 0).toBeGreaterThan(1);

    await persist(resource);
  });
});
