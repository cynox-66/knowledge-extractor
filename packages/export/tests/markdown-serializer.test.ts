import { describe, it, expect } from 'vitest';
import { ExportTarget, BlockType } from '@knowledge-extractor/types';
import type { IExportItem } from '@knowledge-extractor/types';
import { MarkdownSerializer } from '../src/markdown-serializer.js';
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

function textPart(parts: ReturnType<MarkdownSerializer['serializeItem']>): string {
  const p = parts.find((x) => x.kind === 'text');
  if (!p?.text) throw new Error('no text part');
  return p.text;
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

describe('MarkdownSerializer — contract', () => {
  it('implements ISerializer with target ExportTarget.MARKDOWN', () => {
    const s = new MarkdownSerializer();
    expect(s.target).toBe(ExportTarget.MARKDOWN);
  });

  it('returns at least one text IExportPart', () => {
    const s = new MarkdownSerializer();
    const parts = s.serializeItem(makeItem());
    expect(parts.some((p) => p.kind === 'text')).toBe(true);
  });

  it('the text part path is "{resourceId}.md"', () => {
    const s = new MarkdownSerializer();
    const parts = s.serializeItem(makeItem('abc123'));
    const tp = parts.find((p) => p.kind === 'text');
    expect(tp?.path).toBe('abc123.md');
  });

  it('the text part contains a YAML frontmatter block', () => {
    const s = new MarkdownSerializer();
    const md = textPart(s.serializeItem(makeItem()));
    expect(md.startsWith('---\n')).toBe(true);
    expect(md).toContain('\n---\n');
  });

  it('the markdown ends with a newline', () => {
    const s = new MarkdownSerializer();
    const md = textPart(s.serializeItem(makeItem()));
    expect(md.endsWith('\n')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Frontmatter
// ---------------------------------------------------------------------------

describe('MarkdownSerializer — YAML frontmatter', () => {
  it('includes sourceUrl in frontmatter', () => {
    const s = new MarkdownSerializer();
    const md = textPart(s.serializeItem(makeItem('r1')));
    expect(md).toContain('sourceUrl:');
    expect(md).toContain('instagram.com');
  });

  it('includes providerName, externalId, extractedAt', () => {
    const s = new MarkdownSerializer();
    const md = textPart(s.serializeItem(makeItem('r1')));
    expect(md).toContain('providerName: instagram');
    expect(md).toContain('externalId: r1');
    expect(md).toContain('extractedAt:');
  });

  it('includes serialized author object', () => {
    const s = new MarkdownSerializer();
    const md = textPart(s.serializeItem(makeItem('r1')));
    expect(md).toContain('author:');
    expect(md).toContain('@testuser');
  });

  it('renders null values as "null"', () => {
    const s = new MarkdownSerializer();
    // makeResource without originalUri → sourceUrl is null
    const base = makeResource('no-url', {
      source: {
        providerName: 'web',
        externalId: 'no-url',
        extractedAt: '2024-01-01T00:00:00.000Z',
      },
    });
    const item = project(base, new Set(), 'none');
    const md = textPart(s.serializeItem(item));
    expect(md).toContain('sourceUrl: null');
  });
});

// ---------------------------------------------------------------------------
// Block rendering
// ---------------------------------------------------------------------------

describe('MarkdownSerializer — body block types', () => {
  it('TEXT blocks render as plain paragraphs', () => {
    const s = new MarkdownSerializer();
    const md = textPart(s.serializeItem(itemWithBody([{ type: BlockType.TEXT, value: 'Hello' }])));
    expect(md).toContain('Hello');
    expect(md).not.toContain('## Hello');
    expect(md).not.toContain('> Hello');
  });

  it('HEADING blocks render as h2', () => {
    const s = new MarkdownSerializer();
    const md = textPart(
      s.serializeItem(itemWithBody([{ type: BlockType.HEADING, value: 'My Section' }])),
    );
    expect(md).toContain('## My Section');
  });

  it('QUOTE blocks render as blockquotes', () => {
    const s = new MarkdownSerializer();
    const md = textPart(
      s.serializeItem(itemWithBody([{ type: BlockType.QUOTE, value: 'Wise words' }])),
    );
    expect(md).toContain('> Wise words');
  });

  it('CODE blocks render as fenced code blocks', () => {
    const s = new MarkdownSerializer();
    const md = textPart(s.serializeItem(itemWithBody([{ type: BlockType.CODE, value: 'x = 1' }])));
    expect(md).toContain('```\nx = 1\n```');
  });

  it('LIST_ITEM blocks render as bullet points', () => {
    const s = new MarkdownSerializer();
    const md = textPart(
      s.serializeItem(itemWithBody([{ type: BlockType.LIST_ITEM, value: 'Point A' }])),
    );
    expect(md).toContain('- Point A');
  });

  it('TRANSCRIPT blocks render with bold header', () => {
    const s = new MarkdownSerializer();
    const md = textPart(
      s.serializeItem(itemWithBody([{ type: BlockType.TRANSCRIPT, value: 'She said hi.' }])),
    );
    expect(md).toContain('**[Transcript]**');
    expect(md).toContain('She said hi.');
  });

  it('multiple blocks are separated by double newlines', () => {
    const s = new MarkdownSerializer();
    const md = textPart(
      s.serializeItem(
        itemWithBody([
          { type: BlockType.TEXT, value: 'First' },
          { type: BlockType.TEXT, value: 'Second' },
        ]),
      ),
    );
    expect(md).toContain('First\n\nSecond');
  });

  it('a resource with no body blocks produces no body section (only frontmatter)', () => {
    const s = new MarkdownSerializer();
    const base = makeResource('empty-body', { content: [], media: [] });
    const item = project(base, new Set(), 'none');
    const md = textPart(s.serializeItem(item));
    const fmEnd = md.indexOf('\n---\n', 1);
    // After the closing ---, only a newline should remain (no extra body sections)
    const afterFm = md.slice(fmEnd + 5); // skip '\n---\n'
    expect(afterFm.trim()).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Media handling
// ---------------------------------------------------------------------------

describe('MarkdownSerializer — media links', () => {
  it('uses localPath for present blobs (link-local)', () => {
    const s = new MarkdownSerializer();
    const item = project(makeResource('r1'), new Set(['r1_img0']), 'link-local');
    const md = textPart(s.serializeItem(item));
    expect(md).toContain('(media/r1_img0)');
  });

  it('uses sourceUri when blob is absent', () => {
    const s = new MarkdownSerializer();
    const item = project(makeResource('r1'), new Set(), 'link-local');
    const md = textPart(s.serializeItem(item));
    expect(md).toContain('https://cdn.example.com/img0.jpg');
  });

  it('uses sourceUri for all media when inclusion is "none"', () => {
    const s = new MarkdownSerializer();
    const item = project(makeResource('r1'), new Set(['r1_img0', 'r1_vid1']), 'none');
    const md = textPart(s.serializeItem(item));
    expect(md).toContain('https://cdn.example.com/img0.jpg');
    expect(md).not.toContain('media/r1_img0');
  });

  it('produces binary IExportParts for present blobs', () => {
    const s = new MarkdownSerializer();
    const item = project(makeResource('r1'), new Set(['r1_img0']), 'link-local');
    const parts = s.serializeItem(item);
    const binaryParts = parts.filter((p) => p.kind === 'binary');
    expect(binaryParts).toHaveLength(1);
    expect(binaryParts[0]?.path).toBe('media/r1_img0');
    expect(binaryParts[0]?.mediaId).toBe('r1_img0');
  });

  it('produces no binary parts when inclusion is "none"', () => {
    const s = new MarkdownSerializer();
    const item = project(makeResource('r1'), new Set(['r1_img0']), 'none');
    const parts = s.serializeItem(item);
    expect(parts.filter((p) => p.kind === 'binary')).toHaveLength(0);
  });

  it('produces no binary parts when no blobs are present', () => {
    const s = new MarkdownSerializer();
    const item = project(makeResource('r1'), new Set(), 'link-local');
    const parts = s.serializeItem(item);
    expect(parts.filter((p) => p.kind === 'binary')).toHaveLength(0);
  });

  it('renders media links using the type as alt text', () => {
    const s = new MarkdownSerializer();
    const item = project(makeResource('r1'), new Set(), 'none');
    const md = textPart(s.serializeItem(item));
    expect(md).toContain('![image](');
    expect(md).toContain('![video](');
  });

  it('a resource with no media produces no media section', () => {
    const s = new MarkdownSerializer();
    const base = makeResource('no-media', { media: [] });
    const item = project(base, new Set(), 'none');
    const md = textPart(s.serializeItem(item));
    expect(md).not.toContain('![');
  });
});

// ---------------------------------------------------------------------------
// Children
// ---------------------------------------------------------------------------

describe('MarkdownSerializer — children', () => {
  it('produces a separate .md text part for each child', () => {
    const child = makeResource('child1');
    const parent = makeResource('parent', { children: [child], media: [] });
    const item = project(parent, new Set(), 'none');
    const s = new MarkdownSerializer();
    const parts = s.serializeItem(item);
    const textPaths = parts.filter((p) => p.kind === 'text').map((p) => p.path);
    expect(textPaths).toContain('parent.md');
    expect(textPaths).toContain('child1.md');
  });

  it('child binary parts are included in the parent serializeItem output', () => {
    const child = makeResource('child1');
    const parent = makeResource('parent', { children: [child], media: [] });
    const item = project(parent, new Set(['child1_img0']), 'link-local');
    const s = new MarkdownSerializer();
    const parts = s.serializeItem(item);
    const binaryPaths = parts.filter((p) => p.kind === 'binary').map((p) => p.path);
    expect(binaryPaths).toContain('media/child1_img0');
  });

  it('a resource without children produces no child .md parts', () => {
    const s = new MarkdownSerializer();
    const item = project(makeResource('r1'), new Set(), 'none');
    const parts = s.serializeItem(item);
    const textParts = parts.filter((p) => p.kind === 'text');
    expect(textParts).toHaveLength(1);
    expect(textParts[0]?.path).toBe('r1.md');
  });
});

// ---------------------------------------------------------------------------
// Purity & determinism
// ---------------------------------------------------------------------------

describe('MarkdownSerializer — purity & determinism', () => {
  it('produces identical output for the same IExportItem', () => {
    const s = new MarkdownSerializer();
    const item = makeItem('r1', ['r1_img0']);
    const a = s.serializeItem(item);
    const b = s.serializeItem(item);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('does not mutate the input IExportItem', () => {
    const s = new MarkdownSerializer();
    const item = makeItem('r1', ['r1_img0']);
    const before = JSON.stringify(item);
    s.serializeItem(item);
    expect(JSON.stringify(item)).toBe(before);
  });

  it('does not access any global or browser state', () => {
    const s = new MarkdownSerializer();
    const item = makeItem('r1');
    expect(() => s.serializeItem(item)).not.toThrow();
  });
});
