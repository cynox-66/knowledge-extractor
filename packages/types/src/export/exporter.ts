import { IContentBlock } from '../core/content.js';
import { MediaType } from '../core/media.js';
import { ResourceState } from '../core/resource.js';

/** The user-facing export targets. One enum — no separate format/target taxonomy. */
export enum ExportTarget {
  JSON = 'json', // NDJSON: one resource object per line
  MARKDOWN = 'markdown', // one .md note per resource + attachments/
  OBSIDIAN = 'obsidian', // vault: markdown + attachments/ + [[wikilinks]] + tags
}

/** How media bytes are treated for this export. */
export type MediaInclusion =
  | 'link-local' // write present blobs into the bundle and link them;
  // absent blobs fall back to a remote sourceUri link.
  | 'none'; // never write blobs; link to remote sourceUri (or omit if none).
// NOTE: download-on-demand ('embed-remote') is deferred to M7.

/** A resolved reference to one media asset within an export. */
export interface IExportMediaRef {
  mediaId: string; // == IMedia.id, key into IMediaStore
  type: MediaType;
  sourceUri: string; // provenance + remote fallback link
  localPath?: string; // relative bundle path; set only when the blob is present
  // AND inclusion === 'link-local'
}

/**
 * The canonical, format-agnostic projection of ONE resource.
 * Decoupled from IResource so the export schema never leaks internal fields
 * (state, completeness) and never churns when the domain model evolves.
 * Ephemeral: produced per-export, never persisted.
 */
export interface IExportItem {
  resourceId: string;
  kind: string;
  frontmatter: Record<string, unknown>; // title, author, sourceUrl, dates, tags
  body: IContentBlock[]; // the knowledge, still structured
  media: IExportMediaRef[]; // resolved manifest (no bytes inline)
  children?: IExportItem[]; // carousels / threads
}

/** One file (or one appended chunk) in the output bundle. */
export interface IExportPart {
  path: string; // relative path within the bundle
  kind: 'text' | 'binary';
  text?: string; // present when kind === 'text'
  mediaId?: string; // present when kind === 'binary'; coordinator resolves bytes
}
// WRITER SEMANTICS: text parts sharing one `path` are appended in stream order
// (this is how NDJSON accumulates into a single file); binary parts are written once.

/** A pure format renderer. Lives in packages/export. */
export interface ISerializer {
  readonly target: ExportTarget;
  serializeItem(item: IExportItem): IExportPart[];
}
// NOTE: no `finalize` and no IExportContext — removed as unused and as a 100k
// memory hazard. Add a finalize seam only if a future target needs a global index.

/** A user-initiated export request. Selection is by lifecycle state in Beta-3. */
export interface IExportRequest {
  target: ExportTarget;
  state: ResourceState; // e.g. ENRICHED
  media: MediaInclusion;
}

/** Persisted to control-state for MV3 resumability and UI progress. */
export interface IExportProgress {
  requestId: string;
  target: ExportTarget;
  cursor?: string; // IResourceQueryable continuation token
  resourcesWritten: number;
  mediaWritten: number;
  startedAt: string;
  updatedAt: string;
  done: boolean;
}

/** Returned to the UI when an export completes. */
export interface IExportResult {
  requestId: string;
  target: ExportTarget;
  resourcesExported: number;
  mediaIncluded: number;
  mediaMissing: number;
  bytes: number;
  completedAt: string;
}
