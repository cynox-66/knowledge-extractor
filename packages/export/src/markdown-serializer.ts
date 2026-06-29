import { ExportTarget } from '@knowledge-extractor/types';
import type {
  ISerializer,
  IExportItem,
  IExportPart,
  IExportMediaRef,
} from '@knowledge-extractor/types';
import { renderBlock } from './block-renderer.js';

/**
 * Serializes each IExportItem to a Markdown note (.md) plus binary parts for
 * any locally-present media blobs.
 *
 * Output layout:
 *   {resourceId}.md   — YAML frontmatter + body blocks + media links
 *   {media.localPath} — one binary part per media ref that has a localPath
 *
 * Children are each serialized to their own .md file (one note per resource).
 * Text parts are never shared across items (each has a unique path), so there
 * is no append-by-path accumulation — this differs from NDJSON intentionally.
 */
export class MarkdownSerializer implements ISerializer {
  readonly target = ExportTarget.MARKDOWN;

  serializeItem(item: IExportItem): IExportPart[] {
    const parts: IExportPart[] = [];

    parts.push({
      path: `${item.resourceId}.md`,
      kind: 'text',
      text: renderNote(item),
    });

    for (const mediaRef of item.media) {
      if (mediaRef.localPath !== undefined) {
        parts.push({
          path: mediaRef.localPath,
          kind: 'binary',
          mediaId: mediaRef.mediaId,
        });
      }
    }

    for (const child of item.children ?? []) {
      parts.push(...this.serializeItem(child));
    }

    return parts;
  }
}

function renderNote(item: IExportItem): string {
  const sections: string[] = [];

  sections.push(renderFrontmatter(item.frontmatter));

  if (item.body.length > 0) {
    sections.push(item.body.map(renderBlock).join('\n\n'));
  }

  const mediaSection = renderMediaSection(item.media);
  if (mediaSection.length > 0) {
    sections.push(mediaSection.join('\n\n'));
  }

  return sections.join('\n\n') + '\n';
}

function renderFrontmatter(fm: Record<string, unknown>): string {
  const lines = ['---'];
  for (const [key, value] of Object.entries(fm)) {
    lines.push(`${key}: ${serializeYamlValue(value)}`);
  }
  lines.push('---');
  return lines.join('\n');
}

function serializeYamlValue(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  if (typeof value === 'string') return quoteYamlString(value);
  // Nested objects and arrays: inline JSON (valid YAML superset).
  return JSON.stringify(value);
}

function quoteYamlString(s: string): string {
  // Quote strings that contain YAML-special characters or leading/trailing space.
  if (
    s === '' ||
    s.includes('\n') ||
    s.includes(':') ||
    s.includes('#') ||
    s.includes('"') ||
    s.includes("'") ||
    s.startsWith(' ') ||
    s.endsWith(' ')
  ) {
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
  }
  return s;
}

function renderMediaSection(media: IExportMediaRef[]): string[] {
  return media.map((m) => {
    const href = m.localPath ?? m.sourceUri;
    const alt = m.type;
    return `![${alt}](${href})`;
  });
}
