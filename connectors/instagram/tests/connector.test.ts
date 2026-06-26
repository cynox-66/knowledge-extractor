import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { JSDOM } from 'jsdom';
import { InstagramConnector } from '../src/index.js';
import { SemanticArticleStrategy } from '../src/strategies.js';
import type { IResource } from '@knowledge-extractor/types';

const FIXTURES_DIR = resolve(__dirname, './fixtures');

function loadFixture(name: string): Element {
  const html = readFileSync(resolve(FIXTURES_DIR, `${name}.html`), 'utf-8');
  const dom = new JSDOM(html, { url: 'https://www.instagram.com/' });
  const article = dom.window.document.querySelector('article');
  if (!article) throw new Error(`No <article> found in fixture: ${name}`);
  return article;
}

function loadExpected(name: string): Partial<IResource> {
  return JSON.parse(readFileSync(resolve(FIXTURES_DIR, `${name}.expected.json`), 'utf-8'));
}

// Helper: compares the essential fields only (excludes extractedAt timestamps)
function assertResource(actual: IResource, expected: Partial<IResource>): void {
  expect(actual.id).toBe(expected.id);
  expect(actual.kind).toBe(expected.kind);
  expect(actual.state).toBe(expected.state);
  expect(actual.source.providerName).toBe(expected.source?.providerName);
  expect(actual.source.externalId).toBe(expected.source?.externalId);
  expect(actual.author?.handle).toBe(expected.author?.handle);
  expect(actual.content.length).toBe(expected.content?.length ?? 0);
  expect(actual.media.length).toBe(expected.media?.length ?? 0);
  expect(actual.children?.length ?? 0).toBe(expected.children?.length ?? 0);
}

describe('Instagram Connector — Fixture Regression Tests', () => {
  const connector = new InstagramConnector();
  const strategy = new SemanticArticleStrategy();

  it('correctly parses a single-image post', async () => {
    const article = loadFixture('single-image-post');
    const expected = loadExpected('single-image-post');
    const stratResult = strategy.execute(article);

    expect(stratResult.applicable).toBe(true);
    expect(stratResult.confidence).toBeGreaterThanOrEqual(0.8);
    expect(stratResult.data?.layout).toBe('single-image');

    const resource = await connector.normalize(stratResult.data!);
    assertResource(resource, expected);
    expect(resource.media[0].type).toBe('image');
  });

  it('correctly parses a carousel post', async () => {
    const article = loadFixture('carousel-post');
    const expected = loadExpected('carousel-post');
    const stratResult = strategy.execute(article);

    expect(stratResult.applicable).toBe(true);
    expect(stratResult.data?.layout).toBe('carousel');

    const resource = await connector.normalize(stratResult.data!);
    assertResource(resource, expected);
    expect(resource.media.length).toBe(3);
    expect(resource.children?.length).toBe(3);
    resource.children?.forEach((child: any) => {
      expect(child.kind).toBe('instagram-slide');
    });
  });

  it('correctly parses a reel post', async () => {
    const article = loadFixture('reel-post');
    const expected = loadExpected('reel-post');
    const stratResult = strategy.execute(article);

    expect(stratResult.applicable).toBe(true);
    expect(stratResult.data?.layout).toBe('reel');

    const resource = await connector.normalize(stratResult.data!);
    assertResource(resource, expected);
    expect(resource.kind).toBe('instagram-reel');
    const videoMedia = resource.media.find((m: any) => m.type === 'video');
    expect(videoMedia).toBeDefined();
  });

  it('strategy chain falls back when semantic selectors fail', () => {
    // Minimal article with no semantic markers
    const dom = new JSDOM(
      '<html><body><article><img src="x.jpg" width="200" /><a href="/p/fallback123/">link</a></article></body></html>',
      { url: 'https://www.instagram.com/' },
    );
    const article = dom.window.document.querySelector('article')!;
    const result = strategy.execute(article);

    // SemanticArticleStrategy should still find the /p/ link
    expect(result.applicable).toBe(true);
    expect(result.data?.externalId).toBe('fallback123');
  });
});
