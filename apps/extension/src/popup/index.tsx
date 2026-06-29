import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import type {
  ICrawlSession,
  ISessionReport,
  IExportProgress,
  IExportRequest,
  MediaInclusion,
} from '@knowledge-extractor/types';
import { ExportTarget, ResourceState } from '@knowledge-extractor/types';

/**
 * Export control panel (Beta-3 M4). Lets the user pick a target + media policy,
 * kick off a background export, and watch its progress. The heavy lifting
 * (paging, serialization, ZIP/NDJSON assembly, download) all happens in the
 * background ExportCoordinator; this panel only sends messages and polls
 * persisted IExportProgress.
 */
const ExportPanel = () => {
  const [target, setTarget] = useState<ExportTarget>(ExportTarget.JSON);
  const [media, setMedia] = useState<MediaInclusion>('link-local');
  const [progress, setProgress] = useState<IExportProgress | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const pollProgress = useCallback(() => {
    chrome.runtime.sendMessage(
      { action: 'GET_EXPORT_PROGRESS' },
      (resp: IExportProgress | null) => {
        setProgress(resp ?? null);
        if (resp?.done && pollRef.current !== null) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      },
    );
  }, []);

  useEffect(() => {
    pollProgress();
    return () => {
      if (pollRef.current !== null) clearInterval(pollRef.current);
    };
  }, [pollProgress]);

  const startExport = () => {
    setNotice(null);
    const request: IExportRequest = { target, state: ResourceState.ENRICHED, media };
    chrome.runtime.sendMessage(
      { action: 'START_EXPORT', data: request },
      (resp: { accepted: boolean; reason?: string }) => {
        if (!resp?.accepted) {
          setNotice(resp?.reason ?? 'Export could not be started');
          return;
        }
        setNotice(null);
        if (pollRef.current === null) {
          pollRef.current = setInterval(pollProgress, 1200);
        }
        pollProgress();
      },
    );
  };

  const cancelExport = () => {
    chrome.runtime.sendMessage({ action: 'CANCEL_EXPORT' }, () => pollProgress());
  };

  const inProgress = progress !== null && !progress.done;

  const select: React.CSSProperties = {
    padding: '4px 6px',
    borderRadius: 6,
    border: '1px solid #d1d5db',
    fontSize: 11,
  };

  return (
    <div style={{ padding: '10px 14px', borderBottom: '1px solid #e5e7eb' }}>
      <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 8, color: '#4b5563' }}>
        Export Knowledge (ENRICHED)
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          value={target}
          onChange={(e) => setTarget(e.target.value as ExportTarget)}
          disabled={inProgress}
          style={select}
        >
          <option value={ExportTarget.JSON}>JSON (NDJSON)</option>
          <option value={ExportTarget.MARKDOWN}>Markdown (.zip)</option>
          <option value={ExportTarget.OBSIDIAN}>Obsidian Vault (.zip)</option>
        </select>
        <select
          value={media}
          onChange={(e) => setMedia(e.target.value as MediaInclusion)}
          disabled={inProgress}
          style={select}
        >
          <option value="link-local">Include media</option>
          <option value="none">No media</option>
        </select>
        <button
          onClick={startExport}
          disabled={inProgress}
          style={{
            padding: '5px 10px',
            background: inProgress ? '#e5e7eb' : '#7c3aed',
            color: inProgress ? '#9ca3af' : '#fff',
            border: 'none',
            borderRadius: 6,
            cursor: inProgress ? 'default' : 'pointer',
            fontWeight: 600,
            fontSize: 11,
          }}
        >
          Export
        </button>
        {inProgress ? (
          <button
            onClick={cancelExport}
            style={{
              padding: '5px 10px',
              background: '#dc2626',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: 11,
            }}
          >
            Cancel
          </button>
        ) : null}
      </div>
      {progress !== null ? (
        <div style={{ marginTop: 8, fontSize: 11, color: '#4b5563' }}>
          {progress.done ? '✓ Completed' : '● Exporting'} — {progress.resourcesWritten} resources,{' '}
          {progress.mediaWritten} media
        </div>
      ) : null}
      {notice !== null ? (
        <div style={{ marginTop: 8, fontSize: 11, color: '#c00' }}>{notice}</div>
      ) : null}
    </div>
  );
};

const MetricsBadge = ({ label, value, warn }: { label: string; value: number; warn?: boolean }) => (
  <div
    style={{
      textAlign: 'center',
      padding: '6px 10px',
      background: warn && value > 0 ? '#fff0f0' : '#f0f4ff',
      borderRadius: 6,
      minWidth: 58,
    }}
  >
    <div style={{ fontSize: 19, fontWeight: 700, color: warn && value > 0 ? '#c00' : '#1a56db' }}>
      {value}
    </div>
    <div style={{ fontSize: 10, color: '#555', marginTop: 2 }}>{label}</div>
  </div>
);

const Popup = () => {
  const [session, setSession] = useState<ICrawlSession | null>(null);
  const [events, setEvents] = useState<{ stage: string; payload: unknown; ts: string }[]>([]);

  const refreshSession = useCallback(() => {
    chrome.runtime.sendMessage({ action: 'GET_SESSION' }, (resp) => {
      if (resp) setSession(resp as ICrawlSession);
    });
  }, []);

  useEffect(() => {
    // Stateless dashboard: hydrate from the background session on every open.
    refreshSession();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const listener = (message: any) => {
      if (message.action === 'SESSION_UPDATED') {
        setSession(message.data as ICrawlSession);
      } else if (message.action === 'SYSTEM_STATUS') {
        const { stage, payload } = message.data;
        setEvents((prev) =>
          [{ stage, payload, ts: new Date().toLocaleTimeString() }, ...prev].slice(0, 50),
        );
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [refreshSession]);

  const sendAction = (action: string) => {
    chrome.runtime.sendMessage({ action }, () => refreshSession());
  };

  const exportDiagnostics = () => {
    chrome.runtime.sendMessage({ action: 'EXPORT_DIAGNOSTICS' }, (report: ISessionReport) => {
      if (!report) return;
      const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `diagnostics-${report.sessionId || 'session'}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });
  };

  const isRunning = session?.isRunning && !session?.isPaused;
  const isPaused = session?.isRunning && session?.isPaused;
  const m = session?.metrics;

  const btn = (bg: string, disabled?: boolean): React.CSSProperties => ({
    padding: '7px 12px',
    background: disabled ? '#e5e7eb' : bg,
    color: disabled ? '#9ca3af' : '#fff',
    border: 'none',
    borderRadius: 6,
    cursor: disabled ? 'default' : 'pointer',
    fontWeight: 600,
  });

  return (
    <div
      style={{
        width: 460,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        fontSize: 13,
        background: '#fff',
      }}
    >
      <div
        style={{
          background: 'linear-gradient(135deg, #1e3a5f, #1a56db)',
          color: '#fff',
          padding: '14px 16px',
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 15 }}>Knowledge Extractor Crawler</div>
        <div style={{ fontSize: 11, opacity: 0.75, marginTop: 2 }}>Alpha Diagnostics Build</div>
      </div>

      {/* Controls */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          padding: '10px 14px',
          borderBottom: '1px solid #e5e7eb',
          alignItems: 'center',
        }}
      >
        <button
          onClick={() => sendAction('START_PIPELINE')}
          disabled={session?.isRunning}
          style={btn('#16a34a', session?.isRunning)}
        >
          Start
        </button>
        <button
          onClick={() => sendAction(isPaused ? 'RESUME_PIPELINE' : 'PAUSE_PIPELINE')}
          disabled={!session?.isRunning}
          style={btn('#d97706', !session?.isRunning)}
        >
          {isPaused ? 'Resume' : 'Pause'}
        </button>
        <button
          onClick={() => sendAction('CANCEL_PIPELINE')}
          disabled={!session?.isRunning}
          style={btn('#dc2626', !session?.isRunning)}
        >
          Cancel
        </button>
        <div
          style={{
            marginLeft: 'auto',
            fontSize: 11,
            fontWeight: 600,
            color: isRunning ? '#16a34a' : isPaused ? '#d97706' : '#6b7280',
          }}
        >
          ● {isRunning ? 'RUNNING' : isPaused ? 'PAUSED' : 'IDLE'}
        </div>
      </div>

      {/* Status line */}
      <div
        style={{
          padding: '8px 14px',
          borderBottom: '1px solid #e5e7eb',
          fontSize: 11,
          color: '#4b5563',
        }}
      >
        <span style={{ fontWeight: 600 }}>Stage:</span> {session?.navigationStatus || 'idle'}
        {session?.currentResource ? (
          <span style={{ marginLeft: 10, wordBreak: 'break-all' }}>
            <span style={{ fontWeight: 600 }}>Current:</span> {session.currentResource}
          </span>
        ) : null}
      </div>

      {/* Metrics */}
      <div
        style={{
          display: 'flex',
          gap: 6,
          padding: '10px 14px',
          borderBottom: '1px solid #e5e7eb',
          flexWrap: 'wrap',
        }}
      >
        <MetricsBadge label="Discovered" value={m?.discovered ?? 0} />
        <MetricsBadge label="Queued" value={session?.queueDepth ?? 0} />
        <MetricsBadge label="Extracted" value={m?.extracted ?? 0} />
        <MetricsBadge label="Persisted" value={m?.persisted ?? 0} />
        <MetricsBadge label="Duplicates" value={m?.duplicates ?? 0} />
        <MetricsBadge label="Retries" value={m?.retries ?? 0} warn />
        <MetricsBadge label="Failed" value={m?.failed ?? 0} warn />
      </div>

      {/* Timing summary + export */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '8px 14px',
          borderBottom: '1px solid #e5e7eb',
          fontSize: 11,
          color: '#4b5563',
        }}
      >
        <span>avg extract: {m?.avgExtractionTime ?? 0}ms</span>
        <span>avg nav: {m?.avgNavigationLatency ?? 0}ms</span>
        <span>peak queue: {m?.peakQueueSize ?? 0}</span>
        <button
          onClick={exportDiagnostics}
          style={{
            marginLeft: 'auto',
            padding: '5px 10px',
            background: '#1a56db',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
            fontWeight: 600,
            fontSize: 11,
          }}
        >
          Export Diagnostics
        </button>
      </div>

      {/* Export */}
      <ExportPanel />

      {/* Event stream */}
      <div style={{ padding: '10px 14px', maxHeight: 190, overflowY: 'auto' }}>
        <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 8, color: '#4b5563' }}>
          Event Stream
        </div>
        {events.map((e, i) => (
          <div
            key={i}
            style={{
              marginBottom: 4,
              fontSize: 11,
              paddingBottom: 4,
              borderBottom: '1px solid #f3f4f6',
            }}
          >
            <span style={{ color: '#9ca3af', marginRight: 6 }}>{e.ts}</span>
            <strong style={{ color: '#1d4ed8' }}>{e.stage}</strong>
            <div
              style={{
                fontSize: 10,
                color: '#4b5563',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
              }}
            >
              {JSON.stringify(e.payload)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<Popup />);
