import { IResource } from '../core/resource.js';
import { IRawSourceResource } from './pipeline.js';

/**
 * The single canonical contract every provider-specific connector must implement.
 *
 * A connector is responsible for: recognizing its own URIs (`canHandle`) and
 * mapping a raw, provider-shaped extraction (`TRaw`) into the strict, normalized
 * domain model (`normalize`). Discovery and extraction of the raw shape are
 * connector-internal concerns and are not part of this engine-facing contract.
 *
 * `TRaw` is parameterized so a connector can accept its own richer raw type
 * (which must extend `IRawSourceResource`) without leaking that type into the
 * platform-agnostic engine layer.
 */
export interface IConnector<TRaw extends IRawSourceResource = IRawSourceResource> {
  /**
   * The unique identifier for this connector (e.g., 'instagram', 'pdf').
   */
  readonly providerName: string;

  /**
   * Validates whether this connector is capable of handling the given URI.
   */
  canHandle(uri: string): boolean;

  /**
   * Maps a raw extracted resource into the strict, normalized domain model.
   */
  normalize(raw: TRaw): Promise<IResource>;
}
