import { IResource, ResourceState } from '../core/resource';

/**
 * The base interface for all domain events emitted throughout the extraction lifecycle.
 */
export interface IDomainEvent<T = unknown> {
  /**
   * The unique identifier for the event instance.
   */
  eventId: string;
  /**
   * The type classification of the event.
   */
  eventType: string;
  /**
   * The ISO 8601 timestamp of when the event occurred.
   */
  timestamp: string;
  /**
   * The strongly typed payload containing the event context.
   */
  payload: T;
}

/**
 * Emitted when a resource transitions to a new lifecycle state.
 */
export interface ResourceStateChangedEvent extends IDomainEvent<{
  resourceId: string;
  previousState: ResourceState;
  newState: ResourceState;
  resourceSnapshot?: IResource;
}> {}
