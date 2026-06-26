# Storage

## Abstraction

Storage is accessed through `IStorageEngine` and `ITransaction`
(`packages/types/src/storage/storage.ts`):

```typescript
interface IStorageEngine {
  beginTransaction(): Promise<ITransaction>;
  saveResource(resource: IResource, transaction?: ITransaction): Promise<void>;
  getResourceById(id: string): Promise<IResource | null>;
  deleteResource(id: string, transaction?: ITransaction): Promise<void>;
}

interface ITransaction {
  commit(): Promise<void>;
  rollback(): Promise<void>;
}
```

## Current implementation

`InMemoryStorage` (`packages/storage/src/memory-storage.ts`) — a `Map<string,
IResource>` with no-op transactions. Data is lost when the extension unloads.

## Session/queue persistence

Crawl session state and the Scheduler queue are persisted to
`chrome.storage.session` (not `IStorageEngine`). This is a runtime concern
separate from resource storage:

| Key               | Contents                                     | Owner             |
| ----------------- | -------------------------------------------- | ----------------- |
| `crawl_session`   | `ICrawlSession` (status + metrics snapshot)  | `SessionManager`  |
| `crawl_scheduler` | `ICrawlTask[]` (full queue with retry state) | `CrawlController` |

## Future: durable storage

The `IStorageEngine` interface is designed for IndexedDB or SQLite backends.
Implementing a durable backend requires:

1. A new class implementing `IStorageEngine` (with real transactions).
2. Swapping the constructor argument in `CrawlController`.
3. No changes to connectors, the Scheduler, or the domain model.
