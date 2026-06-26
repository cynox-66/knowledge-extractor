import { IStorageEngine, ITransaction, IResource } from '@knowledge-extractor/types';
import { Logger } from '@knowledge-extractor/shared';

class MemoryTransaction implements ITransaction {
  async commit(): Promise<void> {
    return Promise.resolve();
  }
  async rollback(): Promise<void> {
    return Promise.resolve();
  }
}

export class InMemoryStorage implements IStorageEngine {
  private readonly store = new Map<string, IResource>();
  private readonly logger = new Logger('InMemoryStorage');

  beginTransaction(): Promise<ITransaction> {
    return Promise.resolve(new MemoryTransaction());
  }

  saveResource(resource: IResource, _transaction?: ITransaction): Promise<void> {
    this.store.set(resource.id, resource);
    this.logger.info(`Saved resource: ${resource.id}`);
    return Promise.resolve();
  }

  getResourceById(id: string): Promise<IResource | null> {
    return Promise.resolve(this.store.get(id) ?? null);
  }

  deleteResource(id: string, _transaction?: ITransaction): Promise<void> {
    this.store.delete(id);
    this.logger.info(`Deleted resource: ${id}`);
    return Promise.resolve();
  }
}
