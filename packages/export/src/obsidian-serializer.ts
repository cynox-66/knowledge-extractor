import { ExportTarget } from '@knowledge-extractor/types';
import type {
  ISerializer,
  IExportItem,
  IExportPart,
  IExportMediaRef,
} from '@knowledge-extractor/types';
import { renderBlock } from './block-renderer.js';
import { sanitizePath } from './path-utils.js';

/**
 * Serializes each IExportItem into an Obsidian-compatible vault structure.
 *
 * Vault layout:
 *   {kind}/{sanitizePath(resourceId)}.md   — one note per resource
 *   attachments/{sanitizePath(mediaId)}    — one binary file per locally-present blob
 *
 * Each note contains:
 *   - YAML frontmatter with `tags:` (kind + providerName), plus all IExportItem.frontmatter fields
 *   - Body rendered via renderBlock() (shared with MarkdownSerializer)
 *   - Media as Obsidian embed wikilinks `![[attachments/...]]` when blob is present,
 *     falling back to standard Markdown image links for remote-only media
 *   - `## Children` section with [[wikilinks]] to each child note
 *
 * Children are each serialized recursively to their own note in the same vault.
 */
export class ObsidianSerializer implements ISerializer {
  readonly target = ExportTarget.OBSIDIAN;

  serializeItem(item: IExportItem): IExportPart[] {
    const parts: IExportPart[] = [];

    parts.push({
      path: notePath(item),
      kind: 'text',
      text: renderVaultNote(item),
    });

    for (const mediaRef of item.media) {
      if (mediaRef.localPath !== undefined) {
        parts.push({
          path: attachmentPath(mediaRef.mediaId),
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

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

export function notePath(item: IExportItem): string {
  return `${item.kind}/${sanitizePath(item.resourceId)}.md`;
}

export function attachmentPath(mediaId: string): string {
  return `attachments/${sanitizePath(mediaId)}`;
}

// ---------------------------------------------------------------------------
// Note rendering
// ---------------------------------------------------------------------------

function renderVaultNote(item: IExportItem): string {
  const sections: string[] = [];

  sections.push(renderFrontmatter(item));

  if (item.body.length > 0) {
    sections.push(item.body.map(renderBlock).join('\n\n'));
  }

  const mediaLinks = renderMediaSection(item.media);
  if (mediaLinks.length > 0) {
    sections.push(mediaLinks.join('\n\n'));
  }

  const children = item.children ?? [];
  if (children.length > 0) {
    // Obsidian wikilinks omit the .md extension — the vault resolves them automatically.
    const childLinks = children
      .map((c) => `- [[${c.kind}/${sanitizePath(c.resourceId)}]]`)
      .join('\n');
    sections.push(`## Children\n\n${childLinks}`);
  }

  return sections.join('\n\n') + '\n';
}

function renderFrontmatter(item: IExportItem): string {
  const tags = buildTags(item);
  const lines = ['---'];

  if (tags.length > 0) {
    lines.push(`tags: [${tags.join(', ')}]`);
  }

  lines.push(`kind: ${item.kind}`);

  for (const [key, value] of Object.entries(item.frontmatter)) {
    lines.push(`${key}: ${serializeYamlValue(value)}`);
  }

  lines.push('---');
  return lines.join('\n');
}

function buildTags(item: IExportItem): string[] {
  const tags: string[] = [item.kind];
  const provider = item.frontmatter['providerName'];
  if (typeof provider === 'string' && provider !== item.kind) {
    tags.push(provider);
  }
  return tags;
}

function renderMediaSection(media: IExportMediaRef[]): string[] {
  return media.map((m) => {
    if (m.localPath !== undefined) {
      return `![[${attachmentPath(m.mediaId)}]]`;
    }
    return `![${m.type}](${m.sourceUri})`;
  });
}

// ---------------------------------------------------------------------------
// YAML serialization (mirrors MarkdownSerializer private helpers;
// cannot be shared without modifying MarkdownSerializer, which is out of scope)
// ---------------------------------------------------------------------------

function serializeYamlValue(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  if (typeof value === 'string') return quoteYamlString(value);
  return JSON.stringify(value);
}

function quoteYamlString(s: string): string {
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
