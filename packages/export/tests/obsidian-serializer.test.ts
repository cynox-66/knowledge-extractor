import { describe, it, expect } from 'vitest';
import { ExportTarget, BlockType } from '@knowledge-extractor/types';
import type { IExportItem } from '@knowledge-extractor/types';
import { ObsidianSerializer } from '../src/obsidian-serializer.js';
import { sanitizePath } from '../src/path-utils.js';
import { project } from '../src/projector.js';
import { makeResource } from './fixtures.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeItem(id: string = 'r1', presentIds: string[] = []): IExportItem {
  return project(makeResource(id), new Set(presentIds), 'link-local');
}

function itemWithBody(blocks: Array<{ type: BlockType; value: string }>): IExportItem {
  const base = makeResource('body-test', {
    content: blocks.map((b) => ({ type: b.type, value: b.value })),
    media: [],
  });
  return project(base, new Set(), 'none');
}

function textPart(parts: ReturnType<ObsidianSerializer['serializeItem']>): string {
  const p = parts.find((x) => x.kind === 'text');
  if (!p?.text) throw new Error('no text part');
  return p.text;
}

// ---------------------------------------------------------------------------
// sanitizePath — shared helper
// ---------------------------------------------------------------------------

describe('sanitizePath', () => {
  it('passes through clean alphanumeric ids unchanged', () => {
    expect(sanitizePath('abc123')).toBe('abc123');
  });

  it('replaces forward slashes with underscores', () => {
    expect(sanitizePath('a/b/c')).toBe('a_b_c');
  });

  it('replaces backslashes with underscores', () => {
    expect(sanitizePath('a\\b')).toBe('a_b');
  });

  it('replaces all illegal filesystem characters', () => {
    expect(sanitizePath('file:*?"<>|name')).toBe('file_______name');
  });

  it('collapses whitespace to underscores', () => {
    expect(sanitizePath('hello world')).toBe('hello_world');
  });

  it('strips leading/trailing dots and spaces', () => {
    expect(sanitizePath('..abc..')).toBe('abc');
    expect(sanitizePath('  name  ')).toBe('name');
  });

  it('truncates to 200 characters', () => {
    const long = 'a'.repeat(300);
    expect(sanitizePath(long)).toHaveLength(200);
  });

  it('returns "unnamed" for an empty string', () => {
    expect(sanitizePath('')).toBe('unnamed');
  });

  it('returns "unnamed" when all chars are illegal and result is empty after sanitization', () => {
    expect(sanitizePath('...')).toBe('unnamed');
  });

  it('is deterministic — same input same output', () => {
    const id = 'test/resource:123';
    expect(sanitizePath(id)).toBe(sanitizePath(id));
  });
});

// ---------------------------------------------------------------------------
// ObsidianSerializer — contract
// ---------------------------------------------------------------------------

describe('ObsidianSerializer — contract', () => {
  it('implements ISerializer with target ExportTarget.OBSIDIAN', () => {
    const s = new ObsidianSerializer();
    expect(s.target).toBe(ExportTarget.OBSIDIAN);
  });

  it('returns at least one text IExportPart', () => {
    const s = new ObsidianSerializer();
    const parts = s.serializeItem(makeItem());
    expect(parts.some((p) => p.kind === 'text')).toBe(true);
  });

  it('the text part ends with a newline', () => {
    const s = new ObsidianSerializer();
    const text = textPart(s.serializeItem(makeItem()));
    expect(text.endsWith('\n')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Vault layout — note paths
// ---------------------------------------------------------------------------

describe('ObsidianSerializer — vault layout', () => {
  it('places the note in a {kind}/ subdirectory', () => {
    const s = new ObsidianSerializer();
    const parts = s.serializeItem(makeItem('abc'));
    const tp = parts.find((p) => p.kind === 'text');
    expect(tp?.path).toBe('post/abc.md');
  });

  it('uses sanitizePath for the note filename', () => {
    const s = new ObsidianSerializer();
    const resource = makeResource('my/weird:id', { kind: 'post' });
    const item = project(resource, new Set(), 'none');
    const parts = s.serializeItem(item);
    const tp = parts.find((p) => p.kind === 'text');
    expect(tp?.path).toBe('post/my_weird_id.md');
  });

  it('uses the resource kind as the subdirectory', () => {
    const s = new ObsidianSerializer();
    const resource = makeResource('vid1', { kind: 'video' });
    const item = project(resource, new Set(), 'none');
    const tp = s.serializeItem(item).find((p) => p.kind === 'text');
    expect(tp?.path).toMatch(/^video\//);
  });

  it('different resource ids produce different note paths', () => {
    const s = new ObsidianSerializer();
    const parts1 = s.serializeItem(makeItem('r1'));
    const parts2 = s.serializeItem(makeItem('r2'));
    const path1 = parts1.find((p) => p.kind === 'text')?.path;
    const path2 = parts2.find((p) => p.kind === 'text')?.path;
    expect(path1).not.toBe(path2);
  });
});

// ---------------------------------------------------------------------------
// Frontmatter
// ---------------------------------------------------------------------------

describe('ObsidianSerializer — frontmatter', () => {
  it('opens and closes with YAML fences', () => {
    const s = new ObsidianSerializer();
    const text = textPart(s.serializeItem(makeItem()));
    expect(text.startsWith('---\n')).toBe(true);
    expect(text).toContain('\n---\n');
  });

  it('includes a tags field with kind and providerName', () => {
    const s = new ObsidianSerializer();
    const text = textPart(s.serializeItem(makeItem('r1')));
    expect(text).toContain('tags: [post, instagram]');
  });

  it('includes kind in frontmatter', () => {
    const s = new ObsidianSerializer();
    const text = textPart(s.serializeItem(makeItem()));
    expect(text).toContain('kind: post');
  });

  it('includes sourceUrl in frontmatter', () => {
    const s = new ObsidianSerializer();
    const text = textPart(s.serializeItem(makeItem('r1')));
    expect(text).toContain('sourceUrl:');
    expect(text).toContain('instagram.com');
  });

  it('includes providerName, externalId, extractedAt', () => {
    const s = new ObsidianSerializer();
    const text = textPart(s.serializeItem(makeItem('r1')));
    expect(text).toContain('providerName: instagram');
    expect(text).toContain('externalId: r1');
    expect(text).toContain('extractedAt:');
  });

  it('includes serialized author object', () => {
    const s = new ObsidianSerializer();
    const text = textPart(s.serializeItem(makeItem('r1')));
    expect(text).toContain('author:');
    expect(text).toContain('@testuser');
  });

  it('renders null values as "null"', () => {
    const s = new ObsidianSerializer();
    const base = makeResource('no-url', {
      source: {
        providerName: 'web',
        externalId: 'no-url',
        extractedAt: '2024-01-01T00:00:00.000Z',
      },
    });
    const item = project(base, new Set(), 'none');
    const text = textPart(s.serializeItem(item));
    expect(text).toContain('sourceUrl: null');
  });

  it('deduplicates kind from tags when kind equals providerName', () => {
    const s = new ObsidianSerializer();
    const base = makeResource('r1', {
      kind: 'instagram',
      source: {
        providerName: 'instagram',
        externalId: 'r1',
        extractedAt: '2024-01-01T00:00:00.000Z',
      },
    });
    const item = project(base, new Set(), 'none');
    const text = textPart(s.serializeItem(item));
    expect(text).toContain('tags: [instagram]');
    expect(text).not.toContain('tags: [instagram, instagram]');
  });
});

// ---------------------------------------------------------------------------
// Body block rendering
// ---------------------------------------------------------------------------

describe('ObsidianSerializer — body block rendering', () => {
  it('TEXT blocks render as plain paragraphs', () => {
    const s = new ObsidianSerializer();
    const text = textPart(
      s.serializeItem(itemWithBody([{ type: BlockType.TEXT, value: 'Hello' }])),
    );
    expect(text).toContain('Hello');
    expect(text).not.toContain('## Hello');
  });

  it('HEADING blocks render as h2', () => {
    const s = new ObsidianSerializer();
    const text = textPart(
      s.serializeItem(itemWithBody([{ type: BlockType.HEADING, value: 'My Section' }])),
    );
    expect(text).toContain('## My Section');
  });

  it('QUOTE blocks render as blockquotes', () => {
    const s = new ObsidianSerializer();
    const text = textPart(
      s.serializeItem(itemWithBody([{ type: BlockType.QUOTE, value: 'Wise words' }])),
    );
    expect(text).toContain('> Wise words');
  });

  it('CODE blocks render as fenced code blocks', () => {
    const s = new ObsidianSerializer();
    const text = textPart(
      s.serializeItem(itemWithBody([{ type: BlockType.CODE, value: 'const x = 1;' }])),
    );
    expect(text).toContain('```\nconst x = 1;\n```');
  });

  it('LIST_ITEM blocks render as bullet points', () => {
    const s = new ObsidianSerializer();
    const text = textPart(
      s.serializeItem(itemWithBody([{ type: BlockType.LIST_ITEM, value: 'Point A' }])),
    );
    expect(text).toContain('- Point A');
  });

  it('TRANSCRIPT blocks render with bold header', () => {
    const s = new ObsidianSerializer();
    const text = textPart(
      s.serializeItem(itemWithBody([{ type: BlockType.TRANSCRIPT, value: 'She said hi.' }])),
    );
    expect(text).toContain('**[Transcript]**');
    expect(text).toContain('She said hi.');
  });

  it('multiple blocks are separated by double newlines', () => {
    const s = new ObsidianSerializer();
    const text = textPart(
      s.serializeItem(
        itemWithBody([
          { type: BlockType.TEXT, value: 'First' },
          { type: BlockType.TEXT, value: 'Second' },
        ]),
      ),
    );
    expect(text).toContain('First\n\nSecond');
  });

  it('a resource with no body produces only frontmatter', () => {
    const s = new ObsidianSerializer();
    const base = makeResource('empty', { content: [], media: [] });
    const item = project(base, new Set(), 'none');
    const text = textPart(s.serializeItem(item));
    const fmEnd = text.indexOf('\n---\n', 1);
    const afterFm = text.slice(fmEnd + 5);
    expect(afterFm.trim()).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Attachment paths
// ---------------------------------------------------------------------------

describe('ObsidianSerializer — attachment paths', () => {
  it('places binary parts under attachments/', () => {
    const s = new ObsidianSerializer();
    const item = project(makeResource('r1'), new Set(['r1_img0']), 'link-local');
    const parts = s.serializeItem(item);
    const binaryParts = parts.filter((p) => p.kind === 'binary');
    expect(binaryParts).toHaveLength(1);
    expect(binaryParts[0]?.path).toMatch(/^attachments\//);
  });

  it('the binary part path uses sanitizePath of the mediaId', () => {
    const s = new ObsidianSerializer();
    const item = project(makeResource('r1'), new Set(['r1_img0']), 'link-local');
    const parts = s.serializeItem(item);
    const binaryPart = parts.find((p) => p.kind === 'binary');
    expect(binaryPart?.path).toBe('attachments/r1_img0');
  });

  it('the binary part carries the correct mediaId for coordinator byte lookup', () => {
    const s = new ObsidianSerializer();
    const item = project(makeResource('r1'), new Set(['r1_img0']), 'link-local');
    const parts = s.serializeItem(item);
    const binaryPart = parts.find((p) => p.kind === 'binary');
    expect(binaryPart?.mediaId).toBe('r1_img0');
  });

  it('produces no binary parts when inclusion is "none"', () => {
    const s = new ObsidianSerializer();
    const item = project(makeResource('r1'), new Set(['r1_img0']), 'none');
    const parts = s.serializeItem(item);
    expect(parts.filter((p) => p.kind === 'binary')).toHaveLength(0);
  });

  it('produces no binary parts when no blobs are locally present', () => {
    const s = new ObsidianSerializer();
    const item = project(makeResource('r1'), new Set(), 'link-local');
    const parts = s.serializeItem(item);
    expect(parts.filter((p) => p.kind === 'binary')).toHaveLength(0);
  });

  it('produces one binary part per present blob', () => {
    const s = new ObsidianSerializer();
    const item = project(makeResource('r1'), new Set(['r1_img0', 'r1_vid1']), 'link-local');
    const parts = s.serializeItem(item);
    const binaryParts = parts.filter((p) => p.kind === 'binary');
    expect(binaryParts).toHaveLength(2);
  });

  it('sanitizes mediaId with special chars in the attachment path', () => {
    const s = new ObsidianSerializer();
    const base = makeResource('r1', {
      media: [
        {
          id: 'media/special:id',
          type: 'image' as never,
          sourceUri: 'https://cdn.example.com/img.jpg',
        },
      ],
    });
    const item = project(base, new Set(['media/special:id']), 'link-local');
    const parts = s.serializeItem(item);
    const binaryPart = parts.find((p) => p.kind === 'binary');
    expect(binaryPart?.path).toBe('attachments/media_special_id');
  });
});

// ---------------------------------------------------------------------------
// Media references in the note body
// ---------------------------------------------------------------------------

describe('ObsidianSerializer — media references in note', () => {
  it('uses Obsidian embed syntax ![[attachments/...]] for locally-present blobs', () => {
    const s = new ObsidianSerializer();
    const item = project(makeResource('r1'), new Set(['r1_img0']), 'link-local');
    const text = textPart(s.serializeItem(item));
    expect(text).toContain('![[attachments/r1_img0]]');
  });

  it('uses standard Markdown image link for absent blobs', () => {
    const s = new ObsidianSerializer();
    const item = project(makeResource('r1'), new Set(), 'link-local');
    const text = textPart(s.serializeItem(item));
    expect(text).toContain('https://cdn.example.com/img0.jpg');
    expect(text).not.toContain('![[attachments/');
  });

  it('uses sourceUri for all media when inclusion is "none"', () => {
    const s = new ObsidianSerializer();
    const item = project(makeResource('r1'), new Set(['r1_img0', 'r1_vid1']), 'none');
    const text = textPart(s.serializeItem(item));
    expect(text).toContain('https://cdn.example.com/img0.jpg');
    expect(text).not.toContain('![[attachments/');
  });

  it('produces no media section when resource has no media', () => {
    const s = new ObsidianSerializer();
    const base = makeResource('no-media', { media: [] });
    const item = project(base, new Set(), 'none');
    const text = textPart(s.serializeItem(item));
    expect(text).not.toContain('![[');
    expect(text).not.toContain('![');
  });

  it('mixes embed and remote links depending on blob presence', () => {
    const s = new ObsidianSerializer();
    // r1_img0 present, r1_vid1 absent
    const item = project(makeResource('r1'), new Set(['r1_img0']), 'link-local');
    const text = textPart(s.serializeItem(item));
    expect(text).toContain('![[attachments/r1_img0]]');
    expect(text).toContain('https://cdn.example.com/vid1.mp4');
  });
});

// ---------------------------------------------------------------------------
// Wikilinks — children
// ---------------------------------------------------------------------------

describe('ObsidianSerializer — wikilinks', () => {
  it('generates a ## Children section when children exist', () => {
    const child = makeResource('child1');
    const parent = makeResource('parent', { children: [child], media: [] });
    const item = project(parent, new Set(), 'none');
    const s = new ObsidianSerializer();
    const text = textPart(s.serializeItem(item));
    expect(text).toContain('## Children');
  });

  it('generates a [[wikilink]] for each child using {kind}/{sanitizedId} format', () => {
    const child = makeResource('child1');
    const parent = makeResource('parent', { children: [child], media: [] });
    const item = project(parent, new Set(), 'none');
    const s = new ObsidianSerializer();
    const text = textPart(s.serializeItem(item));
    expect(text).toContain('[[post/child1]]');
  });

  it('wikilink path matches the child note path in the ZIP', () => {
    const child = makeResource('child1');
    const parent = makeResource('parent', { children: [child], media: [] });
    const item = project(parent, new Set(), 'none');
    const s = new ObsidianSerializer();
    const parts = s.serializeItem(item);
    const childNotePart = parts
      .filter((p) => p.kind === 'text')
      .find((p) => p.path.includes('child1'));
    expect(childNotePart?.path).toBe('post/child1.md');
    const parentText = textPart(parts);
    expect(parentText).toContain('[[post/child1]]');
  });

  it('sanitizes child resource ids in wikilinks', () => {
    const child = makeResource('child/weird:id');
    const parent = makeResource('parent', { children: [child], media: [] });
    const item = project(parent, new Set(), 'none');
    const s = new ObsidianSerializer();
    const text = textPart(s.serializeItem(item));
    expect(text).toContain('[[post/child_weird_id]]');
    expect(text).not.toContain('[[post/child/weird:id]]');
  });

  it('produces no Children section when the resource has no children', () => {
    const s = new ObsidianSerializer();
    const item = project(makeResource('r1'), new Set(), 'none');
    const text = textPart(s.serializeItem(item));
    expect(text).not.toContain('## Children');
    expect(text).not.toContain('[[');
  });

  it('multiple children each get a list item wikilink', () => {
    const c1 = makeResource('c1');
    const c2 = makeResource('c2');
    const parent = makeResource('parent', { children: [c1, c2], media: [] });
    const item = project(parent, new Set(), 'none');
    const s = new ObsidianSerializer();
    const text = textPart(s.serializeItem(item));
    expect(text).toContain('- [[post/c1]]');
    expect(text).toContain('- [[post/c2]]');
  });
});

// ---------------------------------------------------------------------------
// Child note generation
// ---------------------------------------------------------------------------

describe('ObsidianSerializer — child note generation', () => {
  it('produces a separate text part for each child', () => {
    const child = makeResource('child1');
    const parent = makeResource('parent', { children: [child], media: [] });
    const item = project(parent, new Set(), 'none');
    const s = new ObsidianSerializer();
    const parts = s.serializeItem(item);
    const textPaths = parts.filter((p) => p.kind === 'text').map((p) => p.path);
    expect(textPaths).toContain('post/parent.md');
    expect(textPaths).toContain('post/child1.md');
  });

  it('child binary parts are included in the parent serializeItem output', () => {
    const child = makeResource('child1');
    const parent = makeResource('parent', { children: [child], media: [] });
    const item = project(parent, new Set(['child1_img0']), 'link-local');
    const s = new ObsidianSerializer();
    const parts = s.serializeItem(item);
    const binaryPaths = parts.filter((p) => p.kind === 'binary').map((p) => p.path);
    expect(binaryPaths).toContain('attachments/child1_img0');
  });

  it('a resource without children produces exactly one text part', () => {
    const s = new ObsidianSerializer();
    const item = project(makeResource('r1'), new Set(), 'none');
    const parts = s.serializeItem(item);
    expect(parts.filter((p) => p.kind === 'text')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Purity & determinism
// ---------------------------------------------------------------------------

describe('ObsidianSerializer — purity & determinism', () => {
  it('produces identical output for the same IExportItem', () => {
    const s = new ObsidianSerializer();
    const item = makeItem('r1', ['r1_img0']);
    const a = s.serializeItem(item);
    const b = s.serializeItem(item);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('does not mutate the input IExportItem', () => {
    const s = new ObsidianSerializer();
    const item = makeItem('r1', ['r1_img0']);
    const before = JSON.stringify(item);
    s.serializeItem(item);
    expect(JSON.stringify(item)).toBe(before);
  });

  it('does not access any global or browser state', () => {
    const s = new ObsidianSerializer();
    const item = makeItem('r1');
    expect(() => s.serializeItem(item)).not.toThrow();
  });

  it('two calls with the same item produce structurally equal arrays', () => {
    const s = new ObsidianSerializer();
    const item = makeItem('r2', ['r2_img0', 'r2_vid1']);
    const first = s.serializeItem(item);
    const second = s.serializeItem(item);
    expect(first.length).toBe(second.length);
    first.forEach((part, i) => {
      expect(part.path).toBe(second[i]?.path);
      expect(part.kind).toBe(second[i]?.kind);
    });
  });
});

// ---------------------------------------------------------------------------
// Serializer registration — ExportTarget.OBSIDIAN in the registry
// ---------------------------------------------------------------------------

describe('ObsidianSerializer — registry compatibility', () => {
  it('target field matches ExportTarget.OBSIDIAN', () => {
    const s = new ObsidianSerializer();
    expect(s.target).toBe(ExportTarget.OBSIDIAN);
    expect(s.target).toBe('obsidian');
  });

  it('is constructable with no arguments (suitable as a registry value)', () => {
    expect(() => new ObsidianSerializer()).not.toThrow();
  });

  it('satisfies the ISerializer interface — has target and serializeItem', () => {
    const s = new ObsidianSerializer();
    expect(typeof s.target).toBe('string');
    expect(typeof s.serializeItem).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// ExportWriter compatibility — IExportPart contract
// ---------------------------------------------------------------------------

describe('ObsidianSerializer — IExportPart contract', () => {
  it('text parts have kind "text", a path, and a text string', () => {
    const s = new ObsidianSerializer();
    const parts = s.serializeItem(makeItem('r1'));
    const textParts = parts.filter((p) => p.kind === 'text');
    for (const part of textParts) {
      expect(part.kind).toBe('text');
      expect(typeof part.path).toBe('string');
      expect(part.path.length).toBeGreaterThan(0);
      expect(typeof part.text).toBe('string');
    }
  });

  it('binary parts have kind "binary", a path, and a mediaId', () => {
    const s = new ObsidianSerializer();
    const item = project(makeResource('r1'), new Set(['r1_img0', 'r1_vid1']), 'link-local');
    const parts = s.serializeItem(item);
    const binaryParts = parts.filter((p) => p.kind === 'binary');
    for (const part of binaryParts) {
      expect(part.kind).toBe('binary');
      expect(typeof part.path).toBe('string');
      expect(part.path.length).toBeGreaterThan(0);
      expect(typeof part.mediaId).toBe('string');
    }
  });

  it('text parts do not carry a mediaId', () => {
    const s = new ObsidianSerializer();
    const parts = s.serializeItem(makeItem('r1'));
    for (const part of parts.filter((p) => p.kind === 'text')) {
      expect(part.mediaId).toBeUndefined();
    }
  });

  it('all paths are non-empty strings', () => {
    const s = new ObsidianSerializer();
    const item = project(makeResource('r1'), new Set(['r1_img0']), 'link-local');
    const parts = s.serializeItem(item);
    for (const part of parts) {
      expect(typeof part.path).toBe('string');
      expect(part.path.length).toBeGreaterThan(0);
    }
  });
});
