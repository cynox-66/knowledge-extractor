import { describe, it, expect } from 'vitest';
import { BlockType, MediaType, ResourceState } from '@knowledge-extractor/types';
import type { IResource } from '@knowledge-extractor/types';
import { project } from '../src/projector.js';
import { makeResource } from './fixtures.js';

describe('project() — IResource → IExportItem', () => {
  it('maps resourceId and kind from the source resource', () => {
    const r = makeResource('abc');
    const item = project(r, new Set(), 'none');
    expect(item.resourceId).toBe('abc');
    expect(item.kind).toBe('post');
  });

  it('carries the structured content blocks through unmodified', () => {
    const r = makeResource('abc');
    const item = project(r, new Set(), 'none');
    expect(item.body).toHaveLength(2);
    expect(item.body[0]).toEqual({ type: BlockType.TEXT, value: 'Hello world' });
    expect(item.body[1]).toEqual({ type: BlockType.HEADING, value: 'Section A' });
  });

  it('builds frontmatter with source fields', () => {
    const r = makeResource('abc');
    const item = project(r, new Set(), 'none');
    expect(item.frontmatter['sourceUrl']).toBe('https://www.instagram.com/p/abc/');
    expect(item.frontmatter['providerName']).toBe('instagram');
    expect(item.frontmatter['externalId']).toBe('abc');
    expect(item.frontmatter['extractedAt']).toBe('2024-01-15T10:00:00.000Z');
  });

  it('includes author in frontmatter when present', () => {
    const r = makeResource('abc');
    const item = project(r, new Set(), 'none');
    const author = item.frontmatter['author'] as Record<string, unknown>;
    expect(author['handle']).toBe('@testuser');
    expect(author['displayName']).toBe('Test User');
  });

  it('omits author from frontmatter when absent', () => {
    // Build a resource without author by spreading and deleting (exactOptionalPropertyTypes
    // disallows author: undefined in object literals, but delete is valid on optional props).
    const base = makeResource('abc');
    const r = { ...base };
    delete r.author;
    const item = project(r, new Set(), 'none');
    expect(item.frontmatter['author']).toBeUndefined();
  });

  it('sets sourceUrl to null when originalUri is absent', () => {
    const r = makeResource('abc', {
      source: {
        providerName: 'reddit',
        externalId: 'xyz',
        extractedAt: '2024-01-01T00:00:00.000Z',
      },
    });
    const item = project(r, new Set(), 'none');
    expect(item.frontmatter['sourceUrl']).toBeNull();
  });
});

describe('project() — media ref resolution', () => {
  it('creates one IExportMediaRef per IMedia item', () => {
    const r = makeResource('r1');
    const item = project(r, new Set(), 'none');
    expect(item.media).toHaveLength(2);
  });

  it('maps mediaId, type, and sourceUri from IMedia', () => {
    const r = makeResource('r1');
    const item = project(r, new Set(), 'none');
    expect(item.media[0]?.mediaId).toBe('r1_img0');
    expect(item.media[0]?.type).toBe(MediaType.IMAGE);
    expect(item.media[0]?.sourceUri).toBe('https://cdn.example.com/img0.jpg');
  });

  it('does NOT assign localPath when inclusion is "none" even if blob is present', () => {
    const r = makeResource('r1');
    const present = new Set(['r1_img0', 'r1_vid1']);
    const item = project(r, present, 'none');
    expect(item.media[0]?.localPath).toBeUndefined();
    expect(item.media[1]?.localPath).toBeUndefined();
  });

  it('does NOT assign localPath when blob is absent and inclusion is "link-local"', () => {
    const r = makeResource('r1');
    const item = project(r, new Set(), 'link-local');
    expect(item.media[0]?.localPath).toBeUndefined();
  });

  it('assigns localPath when blob is present AND inclusion is "link-local"', () => {
    const r = makeResource('r1');
    const present = new Set(['r1_img0']);
    const item = project(r, present, 'link-local');
    expect(item.media[0]?.localPath).toBe('media/r1_img0');
  });

  it('assigns localPath only to present blobs, skips absent ones', () => {
    const r = makeResource('r1');
    const present = new Set(['r1_img0']); // vid1 absent
    const item = project(r, present, 'link-local');
    expect(item.media[0]?.localPath).toBe('media/r1_img0');
    expect(item.media[1]?.localPath).toBeUndefined();
  });

  it('produces a deterministic localPath from mediaId', () => {
    const r = makeResource('r1');
    const present = new Set(['r1_img0']);
    const item1 = project(r, present, 'link-local');
    const item2 = project(r, present, 'link-local');
    expect(item1.media[0]?.localPath).toBe(item2.media[0]?.localPath);
  });
});

describe('project() — children', () => {
  it('omits the children field when the resource has no children', () => {
    const r = makeResource('r1');
    const item = project(r, new Set(), 'none');
    expect(item.children).toBeUndefined();
  });

  it('recursively projects child resources', () => {
    const child = makeResource('child1');
    const parent = makeResource('parent', { children: [child] });
    const item = project(parent, new Set(), 'none');
    expect(item.children).toHaveLength(1);
    expect(item.children?.[0]?.resourceId).toBe('child1');
  });

  it('propagates presence and inclusion into child projections', () => {
    const child = makeResource('child1');
    const parent = makeResource('parent', { children: [child] });
    const present = new Set(['child1_img0']);
    const item = project(parent, present, 'link-local');
    expect(item.children?.[0]?.media[0]?.localPath).toBe('media/child1_img0');
  });
});

describe('project() — purity', () => {
  it('does not mutate the input IResource', () => {
    const r = makeResource('r1');
    const original = JSON.stringify(r);
    project(r, new Set(['r1_img0']), 'link-local');
    expect(JSON.stringify(r)).toBe(original);
  });

  it('produces identical output for the same inputs (deterministic)', () => {
    const r = makeResource('r1');
    const present = new Set(['r1_img0']);
    const a = project(r, present, 'link-local');
    const b = project(r, present, 'link-local');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('is referentially transparent — different resources yield different items', () => {
    const r1 = makeResource('r1');
    const r2 = makeResource('r2');
    const item1 = project(r1, new Set(), 'none');
    const item2 = project(r2, new Set(), 'none');
    expect(item1.resourceId).not.toBe(item2.resourceId);
  });

  it('does not access any global or storage state', () => {
    // Pure function: depends only on its arguments.
    // This test documents the contract; it fails only if project() throws
    // when called without any environment setup.
    const r = makeResource('r1');
    expect(() => project(r, new Set(), 'none')).not.toThrow();
  });
});

describe('project() — resource without media', () => {
  it('produces an empty media array when the resource has no media', () => {
    const r: IResource = {
      id: 'text-only',
      kind: 'article',
      state: ResourceState.ENRICHED,
      source: {
        providerName: 'web',
        externalId: 'text-only',
        extractedAt: '2024-01-01T00:00:00.000Z',
      },
      content: [{ type: BlockType.TEXT, value: 'Pure text' }],
      media: [],
      completeness: { thumbnail: false, metadata: true, media: true, ocr: false },
    };
    const item = project(r, new Set(), 'link-local');
    expect(item.media).toEqual([]);
  });
});
