export type EventAction =
  | 'DISCOVERY_STARTED'
  | 'DISCOVERY_BATCH'
  | 'RESOURCE_QUEUED'
  | 'NAVIGATION_STARTED'
  | 'RESOURCE_OPENED'
  | 'EXTRACTION_STARTED'
  | 'EXTRACTION_COMPLETED'
  | 'RESOURCE_PERSISTED'
  | 'RESOURCE_FAILED'
  | 'SCROLL_COMPLETED'
  | 'CRAWL_FINISHED'
  | 'SYSTEM_STATUS'; // Used internally by background script

export interface IBaseEvent<TAction extends EventAction, TPayload> {
  action: TAction;
  data: TPayload;
}

export type DiscoveryStartedEvent = IBaseEvent<'DISCOVERY_STARTED', { pageUrl: string }>;
export type DiscoveryBatchEvent = IBaseEvent<'DISCOVERY_BATCH', { count: number }>;
export type ResourceQueuedEvent = IBaseEvent<
  'RESOURCE_QUEUED',
  { targetUri: string; priority: number }
>;
export type NavigationStartedEvent = IBaseEvent<'NAVIGATION_STARTED', { targetUri: string }>;
export type ResourceOpenedEvent = IBaseEvent<'RESOURCE_OPENED', { targetUri: string }>;
export type ExtractionStartedEvent = IBaseEvent<'EXTRACTION_STARTED', { targetUri: string }>;
export type ExtractionCompletedEvent = IBaseEvent<
  'EXTRACTION_COMPLETED',
  { targetUri: string; resourceId: string }
>;
export type ResourcePersistedEvent = IBaseEvent<'RESOURCE_PERSISTED', { resourceId: string }>;
export type ResourceFailedEvent = IBaseEvent<
  'RESOURCE_FAILED',
  { targetUri: string; reason: string }
>;
export type ScrollCompletedEvent = IBaseEvent<
  'SCROLL_COMPLETED',
  { success: boolean; newContentFound: boolean }
>;
export type CrawlFinishedEvent = IBaseEvent<
  'CRAWL_FINISHED',
  { sessionId: string; reason: string }
>;

export type PipelineEvent =
  | DiscoveryStartedEvent
  | DiscoveryBatchEvent
  | ResourceQueuedEvent
  | NavigationStartedEvent
  | ResourceOpenedEvent
  | ExtractionStartedEvent
  | ExtractionCompletedEvent
  | ResourcePersistedEvent
  | ResourceFailedEvent
  | ScrollCompletedEvent
  | CrawlFinishedEvent;
