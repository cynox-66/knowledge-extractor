import { describe, it, expect } from 'vitest';
import { ExportTarget } from '@knowledge-extractor/types';
import { createSerializerRegistry } from '../src/background/export/registry.js';

describe('createSerializerRegistry', () => {
  it('registers JSON and Markdown serializers', () => {
    const registry = createSerializerRegistry();
    expect(registry.get(ExportTarget.JSON)?.target).toBe(ExportTarget.JSON);
    expect(registry.get(ExportTarget.MARKDOWN)?.target).toBe(ExportTarget.MARKDOWN);
  });

  it('does not register Obsidian (deferred to M5)', () => {
    const registry = createSerializerRegistry();
    expect(registry.has(ExportTarget.OBSIDIAN)).toBe(false);
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
