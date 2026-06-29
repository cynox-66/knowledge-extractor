import { IResource, ResourceState } from '../core/resource.js';

/**
 * Parameters for a paginated, state-filtered resource enumeration.
 *
 * Storage implementations use this to bound per-tick heap usage: callers
 * choose a `pageSize` that is safe for the background worker and supply the
 * `cursor` returned by the previous page to advance through the result set.
 */
export interface IResourceQuery {
  /**
   * Return only resources currently in this lifecycle state. Omit to enumerate
   * resources in **every** state (paginated by primary key) — required for
   * exporting all persisted knowledge, which legitimately spans EXTRACTED,
   * HYDRATED, and ENRICHED.
   */
  state?: ResourceState;
  /**
   * Maximum number of resources to return per page.
   * Callers must keep this small enough that the background worker does not
   * exceed its memory budget or hold an IndexedDB cursor open long enough
   * to trigger MV3 eviction.
   */
  pageSize: number;
  /**
   * Opaque continuation token returned by the previous {@link IEnrichmentSelection}.
   * Omit or set to `undefined` to start from the beginning of the result set.
   */
  cursor?: string;
}

/**
 * A single page of resources returned by a paginated storage query.
 *
 * Consumers must check {@link hasMore} and, if true, issue another query with
 * `cursor` set to {@link nextCursor} to retrieve the following page.
 */
export interface IEnrichmentSelection {
  /** The resources in this page, in storage-defined order. */
  items: IResource[];
  /**
   * Opaque cursor to pass as {@link IResourceQuery.cursor} to retrieve the
   * next page. Present only when {@link hasMore} is `true`.
   */
  nextCursor?: string;
  /** Whether more pages exist after this one. */
  hasMore: boolean;
}

/**
 * Additive query capability for storage engines that support indexed resource
 * enumeration. Kept separate from {@link IStorageEngine} (which remains frozen)
 * so the contract can be adopted incrementally by other backends.
 */
export interface IResourceQueryable {
  /**
   * Returns a bounded page of resources matching the given query.
   *
   * Callers advance through the full result set by passing the
   * {@link IEnrichmentSelection.nextCursor} of the previous page as
   * {@link IResourceQuery.cursor} until {@link IEnrichmentSelection.hasMore}
   * is `false`.
   */
  queryResources(query: IResourceQuery): Promise<IEnrichmentSelection>;
}
