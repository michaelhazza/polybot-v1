import React from 'react';

function WindowDebugger({ window, onClose }) {
  const formatTimestamp = (ts) => {
    return new Date(ts * 1000).toLocaleString('en-AU');
  };

  const edge = ((1 - window.min_combined_price) * 100).toFixed(3);
  const entryEdge = ((1 - window.entry_combined_price) * 100).toFixed(3);

  return (
    <div className="card" style={{ marginTop: '1rem', border: '2px solid #3b82f6' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h2>Window Debug View</h2>
        <button className="btn btn-secondary btn-sm" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="metric-grid" style={{ marginBottom: '1.5rem' }}>
        <div className="metric-card">
          <div className="metric-label">Window ID</div>
          <div className="metric-value" style={{ fontSize: '1rem', fontFamily: 'monospace' }}>
            {window.id.substring(0, 12)}...
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-label">Start Time</div>
          <div className="metric-value" style={{ fontSize: '0.9rem' }}>
            {formatTimestamp(window.start_time)}
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-label">Duration</div>
          <div className="metric-value">
            {window.duration}s
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-label">Tick Count</div>
          <div className="metric-value">
            {window.tick_count}
          </div>
        </div>
      </div>

      <div className="metric-grid" style={{ marginBottom: '1.5rem' }}>
        <div className="metric-card">
          <div className="metric-label">Entry Combined Price</div>
          <div className="metric-value">
            {window.entry_combined_price?.toFixed(6)}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#10b981', marginTop: '0.25rem' }}>
            Edge: {entryEdge}%
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-label">Min Combined Price (Best)</div>
          <div className="metric-value metric-success">
            {window.min_combined_price?.toFixed(6)}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#10b981', marginTop: '0.25rem' }}>
            Best Edge: {edge}%
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-label">Exit Combined Price</div>
          <div className="metric-value">
            {window.exit_combined_price?.toFixed(6)}
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-label">Market ID</div>
          <div className="metric-value" style={{ fontSize: '0.8rem', fontFamily: 'monospace', wordBreak: 'break-all' }}>
            {window.market_id?.substring(0, 16) || 'N/A'}...
          </div>
        </div>
      </div>

      <div style={{ background: '#0f172a', padding: '1rem', borderRadius: '6px', border: '1px solid #334155' }}>
        <h3 style={{ marginBottom: '1rem', color: '#cbd5e1', fontSize: '1rem' }}>
          Window Analysis
        </h3>
        <div style={{ fontSize: '0.875rem', lineHeight: '1.6' }}>
          <p style={{ marginBottom: '0.5rem', color: '#94a3b8' }}>
            This window represents a continuous arbitrage opportunity detected in the market.
          </p>
          <ul style={{ marginLeft: '1.5rem', color: '#cbd5e1' }}>
            <li>The window lasted for {window.duration} seconds with {window.tick_count} valid ticks</li>
            <li>Entry edge at window start: {entryEdge}%</li>
            <li>Best edge achieved during window: {edge}%</li>
            <li>All ticks in this window had valid UP/DOWN pairing within 5 seconds</li>
            <li>Combined price remained below 1.00 throughout the window duration</li>
          </ul>

          <div style={{ marginTop: '1rem', padding: '0.75rem', background: '#1e293b', borderRadius: '4px', borderLeft: '3px solid #3b82f6' }}>
            <strong style={{ color: '#60a5fa' }}>Execution Feasibility:</strong>
            <p style={{ marginTop: '0.5rem', color: '#cbd5e1' }}>
              {window.duration >= 1.2
                ? `✓ Window duration (${window.duration}s) exceeds minimum fill time requirement (1.2s = 0.2s latency + 1.0s fill time). Trade would be marked as COMPLETED.`
                : `✗ Window duration (${window.duration}s) is below minimum fill time requirement (1.2s). Trade would be marked as FAILED.`
              }
            </p>
          </div>

          <div style={{ marginTop: '1rem', padding: '0.75rem', background: '#1e293b', borderRadius: '4px', borderLeft: '3px solid #10b981' }}>
            <strong style={{ color: '#10b981' }}>Profit Calculation:</strong>
            <p style={{ marginTop: '0.5rem', color: '#cbd5e1' }}>
              Raw edge = 1.00 - {window.entry_combined_price?.toFixed(6)} = {entryEdge}%
              <br />
              For a trade size of $X: Profit = X * {(entryEdge / 100).toFixed(6)} - fees
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default WindowDebugger;
