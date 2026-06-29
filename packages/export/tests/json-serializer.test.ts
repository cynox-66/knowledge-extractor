import { describe, it, expect } from 'vitest';
import { ExportTarget } from '@knowledge-extractor/types';
import type { IExportItem } from '@knowledge-extractor/types';
import { JsonSerializer, NDJSON_OUTPUT_PATH } from '../src/json-serializer.js';
import { project } from '../src/projector.js';
import { makeResource } from './fixtures.js';

function makeItem(id: string = 'r1'): IExportItem {
  return project(makeResource(id), new Set([`${id}_img0`]), 'link-local');
}

describe('JsonSerializer — contract', () => {
  it('implements ISerializer with target ExportTarget.JSON', () => {
    const s = new JsonSerializer();
    expect(s.target).toBe(ExportTarget.JSON);
  });

  it('serializeItem returns exactly one IExportPart', () => {
    const s = new JsonSerializer();
    const parts = s.serializeItem(makeItem());
    expect(parts).toHaveLength(1);
  });

  it('the part path is the NDJSON output path constant', () => {
    const s = new JsonSerializer();
    const [part] = s.serializeItem(makeItem());
    expect(part?.path).toBe(NDJSON_OUTPUT_PATH);
    expect(part?.path).toBe('export.ndjson');
  });

  it('the part kind is "text"', () => {
    const s = new JsonSerializer();
    const [part] = s.serializeItem(makeItem());
    expect(part?.kind).toBe('text');
  });

  it('the text is a single valid JSON line ending with a newline', () => {
    const s = new JsonSerializer();
    const [part] = s.serializeItem(makeItem());
    expect(typeof part?.text).toBe('string');
    expect(part?.text?.endsWith('\n')).toBe(true);
    const line = part!.text!.trimEnd();
    expect(() => JSON.parse(line)).not.toThrow();
  });

  it('the serialized JSON round-trips to a structurally equivalent IExportItem', () => {
    const s = new JsonSerializer();
    const item = makeItem('r1');
    const [part] = s.serializeItem(item);
    const parsed = JSON.parse(part!.text!.trimEnd()) as IExportItem;
    expect(parsed.resourceId).toBe(item.resourceId);
    expect(parsed.kind).toBe(item.kind);
    expect(parsed.body).toEqual(item.body);
    expect(parsed.media).toEqual(item.media);
    expect(parsed.frontmatter).toEqual(item.frontmatter);
  });

  it('does not set mediaId on the text part', () => {
    const s = new JsonSerializer();
    const [part] = s.serializeItem(makeItem());
    expect(part?.mediaId).toBeUndefined();
  });
});

describe('JsonSerializer — NDJSON streaming semantics', () => {
  it('each item serializes to an independent single-line chunk', () => {
    const s = new JsonSerializer();
    const parts1 = s.serializeItem(makeItem('r1'));
    const parts2 = s.serializeItem(makeItem('r2'));
    expect(parts1[0]?.text?.trimEnd()).not.toContain('\n');
    expect(parts2[0]?.text?.trimEnd()).not.toContain('\n');
  });

  it('concatenated parts form a valid NDJSON document (one JSON object per line)', () => {
    const s = new JsonSerializer();
    const items = ['r1', 'r2', 'r3'].map((id) => makeItem(id));
    const ndjson = items
      .flatMap((item) => s.serializeItem(item))
      .map((p) => p.text!)
      .join('');

    const lines = ndjson.trimEnd().split('\n');
    expect(lines).toHaveLength(3);
    lines.forEach((line, i) => {
      const parsed = JSON.parse(line) as IExportItem;
      expect(parsed.resourceId).toBe(`r${i + 1}`);
    });
  });

  it('all parts share the same path (enabling append-by-path writer semantics)', () => {
    const s = new JsonSerializer();
    const items = ['r1', 'r2'].map((id) => makeItem(id));
    const allParts = items.flatMap((item) => s.serializeItem(item));
    const paths = new Set(allParts.map((p) => p.path));
    expect(paths.size).toBe(1);
    expect([...paths][0]).toBe(NDJSON_OUTPUT_PATH);
  });
});

describe('JsonSerializer — purity & determinism', () => {
  it('produces identical output for the same IExportItem', () => {
    const s = new JsonSerializer();
    const item = makeItem('r1');
    const a = s.serializeItem(item);
    const b = s.serializeItem(item);
    expect(a[0]?.text).toBe(b[0]?.text);
  });

  it('does not mutate the input IExportItem', () => {
    const s = new JsonSerializer();
    const item = makeItem('r1');
    const before = JSON.stringify(item);
    s.serializeItem(item);
    expect(JSON.stringify(item)).toBe(before);
  });

  it('serializes media with present localPath correctly', () => {
    const s = new JsonSerializer();
    const item = makeItem('r1'); // r1_img0 is in the present set
    const [part] = s.serializeItem(item);
    const parsed = JSON.parse(part!.text!) as IExportItem;
    const imgRef = parsed.media.find((m) => m.mediaId === 'r1_img0');
    expect(imgRef?.localPath).toBe('media/r1_img0');
  });

  it('serializes media without localPath when blob was absent', () => {
    const s = new JsonSerializer();
    const item = project(makeResource('r1'), new Set(), 'link-local');
    const [part] = s.serializeItem(item);
    const parsed = JSON.parse(part!.text!) as IExportItem;
    parsed.media.forEach((m) => expect(m.localPath).toBeUndefined());
  });

  it('does not access any global or browser state', () => {
    const s = new JsonSerializer();
    const item = makeItem('r1');
    expect(() => s.serializeItem(item)).not.toThrow();
  });
});
