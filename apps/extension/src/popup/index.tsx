import React, { useState, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import type { ISessionReport, IFailureRecord } from '@knowledge-extractor/types';

// ---- Types ------------------------------------------------------------------
interface PipelineEvent {
  stage: string;
  payload: unknown;
  ts: string;
}

// ---- Helpers ----------------------------------------------------------------
function downloadJson(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ---- Sub-components ---------------------------------------------------------
const MetricsBadge = ({ label, value, warn }: { label: string; value: number; warn?: boolean }) => (
  <div
    style={{
      textAlign: 'center',
      padding: '6px 10px',
      background: warn && value > 0 ? '#fff0f0' : '#f0f4ff',
      borderRadius: 6,
      minWidth: 60,
    }}
  >
    <div style={{ fontSize: 20, fontWeight: 700, color: warn && value > 0 ? '#c00' : '#1a56db' }}>
      {value}
    </div>
    <div style={{ fontSize: 10, color: '#555', marginTop: 2 }}>{label}</div>
  </div>
);

const FailureCard = ({ failure }: { failure: IFailureRecord }) => (
  <details
    style={{
      marginBottom: 8,
      border: '1px solid #fca5a5',
      borderRadius: 6,
      padding: '6px 8px',
      background: '#fff5f5',
    }}
  >
    <summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#b91c1c' }}>
      [{failure.category}] {failure.targetUri.replace('https://www.instagram.com', '')}
    </summary>
    <div style={{ marginTop: 6, fontSize: 11 }}>
      <div>
        <strong>Root cause:</strong> {failure.rootCause}
      </div>
      {failure.failingStrategy && (
        <div>
          <strong>Strategy:</strong> {failure.failingStrategy}
        </div>
      )}
      {failure.domSnapshot && (
        <details style={{ marginTop: 4 }}>
          <summary style={{ cursor: 'pointer', color: '#555' }}>DOM Snapshot</summary>
          <pre
            style={{
              fontSize: 9,
              overflowX: 'auto',
              background: '#f5f5f5',
              padding: 4,
              marginTop: 4,
              borderRadius: 4,
            }}
          >
            {failure.domSnapshot}
          </pre>
        </details>
      )}
    </div>
  </details>
);

// ---- Main Popup -------------------------------------------------------------
const Popup = () => {
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [events, setEvents] = useState<PipelineEvent[]>([]);
  const [report, setReport] = useState<ISessionReport | null>(null);
  const [activeTab, setActiveTab] = useState<'metrics' | 'failures' | 'log'>('metrics');

  useEffect(() => {
    const listener = (message: { action: string; data: { stage: string; payload: unknown } }) => {
      if (message.action !== 'SYSTEM_STATUS') return;
      const { stage, payload } = message.data;

      setEvents((prev) => [...prev, { stage, payload, ts: new Date().toLocaleTimeString() }]);

      if (stage === 'DIAGNOSTICS_SNAPSHOT') {
        setReport(payload as ISessionReport);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  const handleStart = useCallback(() => {
    setStatus('running');
    setEvents([]);
    setReport(null);
    chrome.runtime.sendMessage(
      { action: 'START_PIPELINE' },
      (response: { success: boolean } | undefined) => {
        setStatus(response?.success ? 'done' : 'error');
      },
    );
  }, []);

  const handleExport = useCallback(() => {
    if (!report) return;
    const ts = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    downloadJson(report, `alpha-session-${ts}.json`);
  }, [report]);

  const statusColor = { idle: '#6b7280', running: '#d97706', done: '#16a34a', error: '#dc2626' }[
    status
  ];
  const m = report?.metrics;

  return (
    <div
      style={{
        width: 440,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        fontSize: 13,
        background: '#fff',
      }}
    >
      {/* Header */}
      <div
        style={{
          background: 'linear-gradient(135deg, #1e3a5f, #1a56db)',
          color: '#fff',
          padding: '14px 16px',
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 15, letterSpacing: 0.3 }}>Knowledge Extractor</div>
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
          id="btn-start-extraction"
          onClick={handleStart}
          disabled={status === 'running'}
          style={{
            padding: '7px 16px',
            background: status === 'running' ? '#93c5fd' : '#1a56db',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            cursor: status === 'running' ? 'default' : 'pointer',
            fontWeight: 600,
            fontSize: 13,
          }}
        >
          {status === 'running' ? 'Running…' : 'Start Extraction'}
        </button>
        <button
          id="btn-export-diagnostics"
          onClick={handleExport}
          disabled={!report}
          style={{
            padding: '7px 12px',
            background: report ? '#f0fdf4' : '#f9fafb',
            color: report ? '#15803d' : '#9ca3af',
            border: `1px solid ${report ? '#86efac' : '#e5e7eb'}`,
            borderRadius: 6,
            cursor: report ? 'pointer' : 'default',
            fontWeight: 600,
            fontSize: 12,
          }}
        >
          Export JSON
        </button>
        <div style={{ marginLeft: 'auto', fontSize: 11, color: statusColor, fontWeight: 600 }}>
          ● {status.toUpperCase()}
        </div>
      </div>

      {/* Metrics strip */}
      {m && (
        <div
          style={{
            display: 'flex',
            gap: 6,
            padding: '10px 14px',
            borderBottom: '1px solid #e5e7eb',
            flexWrap: 'wrap',
          }}
        >
          <MetricsBadge label="Discovered" value={m.discovered} />
          <MetricsBadge label="Extracted" value={m.extracted} />
          <MetricsBadge label="Duplicates" value={m.duplicates} />
          <MetricsBadge label="Skipped" value={m.skipped} />
          <MetricsBadge label="Failed" value={m.failed} warn />
          <MetricsBadge label="Extract ms" value={m.extractionTimeMs} />
          <MetricsBadge label="Norm ms" value={m.normalizationTimeMs} />
          {report?.memoryUsageMb != null && (
            <MetricsBadge label="Heap MB" value={report.memoryUsageMb} />
          )}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid #e5e7eb' }}>
        {(['metrics', 'failures', 'log'] as const).map((tab) => (
          <button
            key={tab}
            id={`tab-${tab}`}
            onClick={() => setActiveTab(tab)}
            style={{
              flex: 1,
              padding: '7px 4px',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === tab ? '2px solid #1a56db' : '2px solid transparent',
              fontWeight: activeTab === tab ? 700 : 400,
              fontSize: 12,
              cursor: 'pointer',
              color: activeTab === tab ? '#1a56db' : '#6b7280',
              textTransform: 'capitalize',
            }}
          >
            {tab}
            {tab === 'failures' && report && report.failures.length > 0
              ? ` (${report.failures.length})`
              : ''}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ padding: '10px 14px', maxHeight: 320, overflowY: 'auto' }}>
        {activeTab === 'metrics' && report && (
          <div>
            <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 8 }}>
              Session: <code style={{ fontSize: 10 }}>{report.sessionId}</code>
              <br />
              Page: <span style={{ wordBreak: 'break-all' }}>{report.pageUrl}</span>
            </div>
            <div style={{ fontSize: 11 }}>
              <strong>Strategy usage:</strong>
            </div>
            {Object.entries(report.strategyUsage).map(([name, count]) => (
              <div
                key={name}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 11,
                  padding: '2px 0',
                  color: '#374151',
                }}
              >
                <span>{name}</span>
                <span style={{ fontWeight: 600 }}>{count}x</span>
              </div>
            ))}
            {Object.keys(report.strategyUsage).length === 0 && (
              <div style={{ fontSize: 11, color: '#9ca3af' }}>
                No strategy data yet. Run an extraction.
              </div>
            )}
          </div>
        )}

        {activeTab === 'metrics' && !report && (
          <div style={{ color: '#9ca3af', fontSize: 12, padding: '20px 0', textAlign: 'center' }}>
            No session data. Navigate to instagram.com/saved and click Start Extraction.
          </div>
        )}

        {activeTab === 'failures' && (
          <div>
            {report && report.failures.length > 0 ? (
              report.failures.map((f, i) => <FailureCard key={i} failure={f} />)
            ) : (
              <div
                style={{ color: '#9ca3af', fontSize: 12, padding: '20px 0', textAlign: 'center' }}
              >
                No failures recorded ✓
              </div>
            )}
          </div>
        )}

        {activeTab === 'log' && (
          <div>
            {events.length === 0 ? (
              <div
                style={{ color: '#9ca3af', fontSize: 12, padding: '20px 0', textAlign: 'center' }}
              >
                No events yet.
              </div>
            ) : (
              events.map((e, i) => (
                <div
                  key={i}
                  style={{
                    marginBottom: 6,
                    fontSize: 11,
                    borderBottom: '1px solid #f3f4f6',
                    paddingBottom: 4,
                  }}
                >
                  <span style={{ color: '#6b7280', marginRight: 6 }}>{e.ts}</span>
                  <strong style={{ color: '#1e40af' }}>{e.stage}</strong>
                  <pre
                    style={{
                      margin: '2px 0 0',
                      fontSize: 10,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-all',
                      color: '#374151',
                    }}
                  >
                    {JSON.stringify(e.payload, null, 2)}
                  </pre>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<Popup />);
