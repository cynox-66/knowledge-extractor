import React, { useState, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import type { ICrawlSession } from '@knowledge-extractor/types';

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

const Popup = () => {
  const [session, setSession] = useState<ICrawlSession | null>(null);
  const [events, setEvents] = useState<{ stage: string; payload: unknown; ts: string }[]>([]);

  const refreshSession = useCallback(() => {
    chrome.runtime.sendMessage({ action: 'GET_SESSION' }, (resp) => {
      if (resp) setSession(resp as ICrawlSession);
    });
  }, []);

  useEffect(() => {
    // Hydrate on mount
    refreshSession();

    // Subscribe to events
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const listener = (message: any) => {
      if (message.action === 'SESSION_UPDATED') {
        setSession(message.data);
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

  const isRunning = session?.isRunning && !session?.isPaused;
  const isPaused = session?.isRunning && session?.isPaused;

  return (
    <div
      style={{
        width: 440,
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
          style={{
            padding: '7px 12px',
            background: session?.isRunning ? '#e5e7eb' : '#16a34a',
            color: session?.isRunning ? '#9ca3af' : '#fff',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          Start
        </button>
        <button
          onClick={() => sendAction(isPaused ? 'RESUME_PIPELINE' : 'PAUSE_PIPELINE')}
          disabled={!session?.isRunning}
          style={{
            padding: '7px 12px',
            background: !session?.isRunning ? '#e5e7eb' : '#d97706',
            color: !session?.isRunning ? '#9ca3af' : '#fff',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          {isPaused ? 'Resume' : 'Pause'}
        </button>
        <button
          onClick={() => sendAction('CANCEL_PIPELINE')}
          disabled={!session?.isRunning}
          style={{
            padding: '7px 12px',
            background: !session?.isRunning ? '#e5e7eb' : '#dc2626',
            color: !session?.isRunning ? '#9ca3af' : '#fff',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
            fontWeight: 600,
          }}
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

      <div
        style={{
          display: 'flex',
          gap: 6,
          padding: '10px 14px',
          borderBottom: '1px solid #e5e7eb',
          flexWrap: 'wrap',
        }}
      >
        <MetricsBadge label="Discovered" value={session?.discovered || 0} />
        <MetricsBadge label="Queued" value={session?.queued || 0} />
        <MetricsBadge label="Extracted" value={session?.extracted || 0} />
        <MetricsBadge label="Failed" value={session?.failed || 0} warn />
      </div>

      <div style={{ padding: '10px 14px', maxHeight: 200, overflowY: 'auto' }}>
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
