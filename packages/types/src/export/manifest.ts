import type { ExportTarget } from './exporter.js';

/**
 * Durable, per-target watermark record for incremental exports (M7).
 *
 * Persisted to {@link IControlStateStore} under `export_manifest_<target>`.
 * Updated only after a successful export run completes — never on cancellation
 * or mid-export — so an interrupted run leaves the previous watermark intact
 * and the resumed export correctly re-exports the same delta.
 *
 * The incremental filter compares {@link IResource.source.extractedAt} against
 * {@link lastExportedAt}. Resources extracted after the watermark are exported;
 * all others are skipped. When {@link lastExportedAt} is `null` (first run),
 * no filtering is applied — the export is a full snapshot.
 */
export interface IExportManifest {
  /** The export target this manifest tracks. */
  target: ExportTarget;
  /**
   * ISO 8601 timestamp of the most recently successfully completed export.
   * `null` when no export has completed yet; the next run will be a full snapshot.
   */
  lastExportedAt: string | null;
  /** Request ID of the most recently completed export. `null` before first run. */
  lastRequestId: string | null;
  /** Cumulative resource count across all completed incremental runs. */
  resourcesExportedTotal: number;
  /** Number of successfully completed export runs tracked by this manifest. */
  exportCount: number;
  /** ISO 8601 timestamp when this manifest record was first created. */
  createdAt: string;
  /** ISO 8601 timestamp when this manifest record was last updated. */
  updatedAt: string;
}
