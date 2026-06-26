import { IResource } from '../core/resource';

/**
 * Supported export formats.
 */
export enum ExportFormat {
  JSON = 'json',
  MARKDOWN = 'markdown',
  CSV = 'csv',
}

/**
 * The standard interface for exporting resources out of the platform.
 */
export interface IExporter {
  /**
   * The format this exporter produces.
   */
  readonly format: ExportFormat;

  /**
   * Exports a single resource.
   * @param resource The resource to export.
   * @returns A string representation of the exported resource.
   */
  export(resource: IResource): Promise<string>;

  /**
   * Exports a collection of resources in batch.
   * @param resources The resources to export.
   * @returns A string representation of the batch.
   */
  exportBatch(resources: IResource[]): Promise<string>;
}
