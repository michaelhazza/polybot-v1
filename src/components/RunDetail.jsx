import React, { useState, useEffect } from 'react';
import WindowDebugger from './WindowDebugger';

function RunDetail({ runId, onBack }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('summary');
  const [selectedWindow, setSelectedWindow] = useState(null);

  useEffect(() => {
    fetchRunDetails();
  }, [runId]);

  const fetchRunDetails = async () => {
    try {
      const response = await fetch(`/api/backtests/${runId}`);
      const result = await response.json();
      setData(result);
      setLoading(false);
    } catch (error) {
      console.error('Error fetching run details:', error);
      setLoading(false);
    }
  };

  const handleExportTrades = () => {
    window.location.href = `/api/backtests/${runId}/export/trades.csv`;
  };

  const formatPercent = (value) => {
    if (value === null || value === undefined) return '-';
    return `${value.toFixed(2)}%`;
  };

  const getMetricStatus = (metric, value) => {
    const thresholds = {
      windows_per_analysis_hour: { threshold: 0.1, good: value >= 0.1 },
      duration_p50: { threshold: 10, good: value >= 10 },
      fill_success_rate: { threshold: 20, good: value >= 20 },
      avg_execution_adjusted_edge: { threshold: 0.5, good: value >= 0.5 },
      data_coverage_pct: { threshold: 90, good: value >= 90 }
    };

    const config = thresholds[metric];
    if (!config) return 'metric-value';

    return config.good ? 'metric-value metric-success' : 'metric-value metric-danger';
  };

  if (loading) {
    return (
      <div className="card">
        <div className="loading">Loading run details...</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="card">
        <div className="empty-state">
          <h3>Run not found</h3>
          <button className="btn" onClick={onBack}>Back to Runs</button>
        </div>
      </div>
    );
  }

  const { run, windows, trades } = data;
  const completedTrades = trades.filter(t => t.result === 'completed');
  const totalProfit = completedTrades.reduce((sum, t) => sum + t.profit, 0);

  return (
    <div>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h2>{run.name}</h2>
          <button className="btn btn-secondary" onClick={onBack}>
            Back to Runs
          </button>
        </div>

        <div className="tabs">
          <button
            className={`tab ${activeTab === 'summary' ? 'active' : ''}`}
            onClick={() => setActiveTab('summary')}
          >
            Summary
          </button>
          <button
            className={`tab ${activeTab === 'windows' ? 'active' : ''}`}
            onClick={() => setActiveTab('windows')}
          >
            Windows ({windows.length})
          </button>
          <button
            className={`tab ${activeTab === 'trades' ? 'active' : ''}`}
            onClick={() => setActiveTab('trades')}
          >
            Trades ({trades.length})
          </button>
        </div>

        {activeTab === 'summary' && (
          <>
            <h3 style={{ marginBottom: '1rem', color: '#cbd5e1' }}>Go/No-Go Metrics</h3>
            <div className="metric-grid">
              <div className="metric-card">
                <div className="metric-label">Windows per Hour</div>
                <div className={getMetricStatus('windows_per_analysis_hour', run.windows_per_analysis_hour)}>
                  {run.windows_per_analysis_hour?.toFixed(2) || '-'}
                </div>
                <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.25rem' }}>
                  Target: ≥0.1
                </div>
              </div>

              <div className="metric-card">
                <div className="metric-label">Median Duration (sec)</div>
                <div className={getMetricStatus('duration_p50', run.duration_p50)}>
                  {run.duration_p50?.toFixed(1) || '-'}
                </div>
                <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.25rem' }}>
                  Target: ≥10s
                </div>
              </div>

              <div className="metric-card">
                <div className="metric-label">Fill Success Rate</div>
                <div className={getMetricStatus('fill_success_rate', run.fill_success_rate)}>
                  {formatPercent(run.fill_success_rate)}
                </div>
                <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.25rem' }}>
                  Target: ≥20%
                </div>
              </div>

              <div className="metric-card">
                <div className="metric-label">Avg Edge</div>
                <div className={getMetricStatus('avg_execution_adjusted_edge', run.avg_execution_adjusted_edge)}>
                  {formatPercent(run.avg_execution_adjusted_edge)}
                </div>
                <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.25rem' }}>
                  Target: ≥0.5%
                </div>
              </div>

              <div className="metric-card">
                <div className="metric-label">Data Coverage</div>
                <div className={getMetricStatus('data_coverage_pct', run.data_coverage_pct)}>
                  {formatPercent(run.data_coverage_pct)}
                </div>
                <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.25rem' }}>
                  Target: ≥90%
                </div>
              </div>

              <div className="metric-card">
                <div className="metric-label">Total Profit</div>
                <div className={totalProfit > 0 ? 'metric-value metric-success' : 'metric-value metric-danger'}>
                  ${totalProfit.toFixed(2)}
                </div>
                <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.25rem' }}>
                  From {completedTrades.length} trades
                </div>
              </div>
            </div>

            <h3 style={{ margin: '2rem 0 1rem', color: '#cbd5e1' }}>Additional Metrics</h3>
            <div className="metric-grid">
              <div className="metric-card">
                <div className="metric-label">Windows Detected</div>
                <div className="metric-value">{run.windows_detected || 0}</div>
              </div>

              <div className="metric-card">
                <div className="metric-label">Trades Completed</div>
                <div className="metric-value">{run.trades_completed || 0}</div>
              </div>

              <div className="metric-card">
                <div className="metric-label">Trade Size</div>
                <div className="metric-value">${run.trade_size}</div>
              </div>

              <div className="metric-card">
                <div className="metric-label">Status</div>
                <div className="metric-value">
                  <span className={`status-badge status-${run.status}`}>
                    {run.status}
                  </span>
                </div>
              </div>
            </div>

            <div style={{ marginTop: '2rem' }}>
              <button className="btn" onClick={handleExportTrades}>
                Export Trades CSV
              </button>
            </div>
          </>
        )}

        {activeTab === 'windows' && (
          <>
            <h3 style={{ marginBottom: '1rem', color: '#cbd5e1' }}>
              Top 10 Best Edge Windows
            </h3>
            {windows.length === 0 ? (
              <div className="empty-state">
                <p>No windows detected</p>
              </div>
            ) : (
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Start Time</th>
                      <th>Duration (s)</th>
                      <th>Entry Price</th>
                      <th>Min Price (Best Edge)</th>
                      <th>Exit Price</th>
                      <th>Tick Count</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {windows.slice(0, 10).map(window => {
                      const startDate = new Date(window.start_time * 1000);
                      const edge = ((1 - window.min_combined_price) * 100).toFixed(2);

                      return (
                        <tr key={window.id}>
                          <td style={{ fontSize: '0.875rem' }}>
                            {startDate.toLocaleString('en-AU')}
                          </td>
                          <td>{window.duration}s</td>
                          <td>{window.entry_combined_price?.toFixed(4)}</td>
                          <td style={{ color: '#10b981', fontWeight: '600' }}>
                            {window.min_combined_price?.toFixed(4)} ({edge}%)
                          </td>
                          <td>{window.exit_combined_price?.toFixed(4)}</td>
                          <td>{window.tick_count}</td>
                          <td>
                            <button
                              className="btn btn-sm"
                              onClick={() => setSelectedWindow(window)}
                            >
                              Debug
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {activeTab === 'trades' && (
          <>
            <h3 style={{ marginBottom: '1rem', color: '#cbd5e1' }}>Trade Results</h3>
            {trades.length === 0 ? (
              <div className="empty-state">
                <p>No trades simulated</p>
              </div>
            ) : (
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Trade ID</th>
                      <th>Result</th>
                      <th>Profit</th>
                      <th>Fees</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trades.map(trade => (
                      <tr key={trade.id}>
                        <td style={{ fontSize: '0.75rem', fontFamily: 'monospace' }}>
                          {trade.id.substring(0, 8)}...
                        </td>
                        <td>
                          <span className={`status-badge status-${trade.result}`}>
                            {trade.result}
                          </span>
                        </td>
                        <td style={{
                          color: trade.profit > 0 ? '#10b981' : '#64748b',
                          fontWeight: '600'
                        }}>
                          ${trade.profit.toFixed(4)}
                        </td>
                        <td>${trade.fees.toFixed(4)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      {selectedWindow && (
        <WindowDebugger
          window={selectedWindow}
          onClose={() => setSelectedWindow(null)}
        />
      )}
    </div>
  );
}

export default RunDetail;
