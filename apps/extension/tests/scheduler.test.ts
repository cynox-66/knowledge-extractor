import { describe, it, expect } from 'vitest';
import { TaskState } from '@knowledge-extractor/types';
import { Scheduler } from '../src/background/scheduler.js';

describe('Scheduler — retry policy vs fail-fast (RCA-9)', () => {
  it('markFailed retries with backoff until maxAttempts, then FAILED', () => {
    const s = new Scheduler({ maxAttempts: 3, baseBackoffMs: 1000 });
    s.enqueue('uri-1');

    const a1 = s.markFailed('uri-1', 'transient');
    expect(a1?.state).toBe(TaskState.QUEUED);
    expect(a1?.attempts).toBe(1);
    expect(a1?.nextRetryAt).toBeGreaterThan(Date.now());

    s.markFailed('uri-1', 'transient'); // attempt 2 → still queued
    const a3 = s.markFailed('uri-1', 'transient'); // attempt 3 → permanent
    expect(a3?.state).toBe(TaskState.FAILED);
    expect(a3?.attempts).toBe(3);
  });

  it('failPermanently fails on the first try and schedules no retry', () => {
    const s = new Scheduler({ maxAttempts: 3, baseBackoffMs: 1000 });
    s.enqueue('uri-2');

    const failed = s.failPermanently('uri-2', 'Not found in DOM');
    expect(failed?.state).toBe(TaskState.FAILED);
    expect(failed?.attempts).toBe(3); // pinned to max so it is terminal
    expect(failed?.nextRetryAt).toBeUndefined();

    // A permanently-failed task is never handed out again.
    expect(s.getNextTask()).toBeNull();
    expect(s.isDrained()).toBe(true);
  });

  it('returns null for an unknown task id', () => {
    const s = new Scheduler();
    expect(s.failPermanently('missing', 'x')).toBeNull();
  });
});
