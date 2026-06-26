import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';

const Popup = () => {
  const [status, setStatus] = useState<string>('Idle');
  const [debugData, setDebugData] = useState<any[]>([]);

  useEffect(() => {
    const listener = (message: any) => {
      if (message.action === 'SYSTEM_STATUS') {
        setStatus(`Stage completed: ${message.data.stage}`);
        setDebugData((prev) => [...prev, message.data]);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  const handleStart = () => {
    setStatus('Pipeline starting...');
    setDebugData([]);
    chrome.runtime.sendMessage({ action: 'START_PIPELINE' }, (response) => {
      if (response?.success) {
        setStatus('Pipeline completed successfully.');
      } else {
        setStatus('Pipeline failed. Make sure you are on Instagram.');
      }
    });
  };

  return (
    <div style={{ width: '400px', padding: '16px', fontFamily: 'sans-serif' }}>
      <h2>Knowledge Extractor</h2>
      <button
        onClick={handleStart}
        style={{
          padding: '8px 16px',
          background: 'blue',
          color: 'white',
          border: 'none',
          cursor: 'pointer',
        }}
      >
        Start Extraction
      </button>
      <div style={{ marginTop: '16px' }}>
        <strong>Status:</strong> {status}
      </div>

      <div
        style={{
          marginTop: '16px',
          background: '#f5f5f5',
          padding: '8px',
          maxHeight: '300px',
          overflowY: 'auto',
          fontSize: '12px',
        }}
      >
        <h3>Debug Log</h3>
        {debugData.map((data, idx) => (
          <div
            key={idx}
            style={{ marginBottom: '8px', borderBottom: '1px solid #ddd', paddingBottom: '8px' }}
          >
            <strong>{data.stage}</strong>
            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {JSON.stringify(data.payload, null, 2)}
            </pre>
          </div>
        ))}
      </div>
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<Popup />);
