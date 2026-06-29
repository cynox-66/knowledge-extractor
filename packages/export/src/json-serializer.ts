import { ExportTarget } from '@knowledge-extractor/types';
import type { ISerializer, IExportItem, IExportPart } from '@knowledge-extractor/types';

export const NDJSON_OUTPUT_PATH = 'export.ndjson';

/**
 * Serializes each IExportItem as one JSON line appended to a single NDJSON file.
 *
 * Writer semantics: text parts sharing the same `path` are appended in stream
 * order, so each call to serializeItem contributes exactly one line. Memory
 * usage is bounded to one item at a time.
 */
export class JsonSerializer implements ISerializer {
  readonly target = ExportTarget.JSON;

  serializeItem(item: IExportItem): IExportPart[] {
    return [
      {
        path: NDJSON_OUTPUT_PATH,
        kind: 'text',
        text: JSON.stringify(item) + '\n',
      },
    ];
  }
}
