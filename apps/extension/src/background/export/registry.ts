import { ExportTarget, type ISerializer } from '@knowledge-extractor/types';
import { JsonSerializer, MarkdownSerializer } from '@knowledge-extractor/export';

/**
 * The serializer lookup table — the single export seam (ADR-013).
 *
 * Adding a target is two edits: implement an `ISerializer` in `packages/export`,
 * then add one line here. No dynamic discovery, no plugin framework. This factory
 * is invoked once by the composition root; the `Map` lives nowhere else.
 *
 * Obsidian (`ExportTarget.OBSIDIAN`) is intentionally absent — it is M5 scope.
 */
export function createSerializerRegistry(): Map<ExportTarget, ISerializer> {
  return new Map<ExportTarget, ISerializer>([
    [ExportTarget.JSON, new JsonSerializer()],
    [ExportTarget.MARKDOWN, new MarkdownSerializer()],
  ]);
}
