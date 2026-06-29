import { describe, it, expect } from 'vitest';
import { ExportTarget } from '@knowledge-extractor/types';
import { createSerializerRegistry } from '../src/background/export/registry.js';

describe('createSerializerRegistry', () => {
  it('registers JSON and Markdown serializers', () => {
    const registry = createSerializerRegistry();
    expect(registry.get(ExportTarget.JSON)?.target).toBe(ExportTarget.JSON);
    expect(registry.get(ExportTarget.MARKDOWN)?.target).toBe(ExportTarget.MARKDOWN);
  });

  it('registers the Obsidian serializer (M5)', () => {
    const registry = createSerializerRegistry();
    expect(registry.get(ExportTarget.OBSIDIAN)?.target).toBe(ExportTarget.OBSIDIAN);
  });

  it('each serializer reports a target matching its registry key', () => {
    const registry = createSerializerRegistry();
    for (const [target, serializer] of registry) {
      expect(serializer.target).toBe(target);
    }
  });

  it('returns an independent map per call (no shared mutable singleton)', () => {
    const a = createSerializerRegistry();
    const b = createSerializerRegistry();
    expect(a).not.toBe(b);
  });
});
