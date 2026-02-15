import React, { useState, useEffect, useMemo } from 'react';
import ConfirmDialog from './ConfirmDialog';

function DataDownload() {
  const [formData, setFormData] = useState({
    asset: 'BTC',
    period: '30d'
  });
  const [downloadId, setDownloadId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState('');
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [activeTab, setActiveTab] = useState('arbitrage');
  const [stopping, setStopping] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearMessage, setClearMessage] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState({ open: false });
  const [selectedMarket, setSelectedMarket] = useState('all');

  const assetLabels = { BTC: 'Bitcoin', ETH: 'Ethereum', SOL: 'Solana' };

  const marketData = useMemo(() => {
    if (!data || !data.snapshots || data.snapshots.length === 0) return null;

    const marketIds = [...new Set(data.snapshots.map(s => s.market_id))];
    const marketMap = {};

    for (const mid of marketIds) {
      const marketSnaps = data.snapshots.filter(s => s.market_id === mid);
      const yesMap = new Map();
      const noMap = new Map();

      marketSnaps.forEach(s => {
        if (s.side === 'YES' || s.side === 'UP') {
          yesMap.set(s.timestamp, s.mid);
        } else {
          noMap.set(s.timestamp, s.mid);
        }
      });

      const timestamps = [...new Set([...yesMap.keys(), ...noMap.keys()])].sort((a, b) => a - b);
      const paired = [];

      for (const ts of timestamps) {
        const yes = yesMap.get(ts);
        const no = noMap.get(ts);
        if (yes !== undefined && no !== undefined) {
          paired.push({ timestamp: ts, yes, no, combined: yes + no });
        }
      }

      const marketInfo = data.markets?.find(m => m.market_id === mid);
      const label = marketInfo?.market_id
        ? (mid.startsWith('synthetic_') ? 'Synthetic Market' : mid.substring(0, 12) + '...')
        : mid.substring(0, 12) + '...';

      marketMap[mid] = {
        id: mid,
        label,
        question: marketInfo?.question || null,
        paired,
        yesCount: yesMap.size,
        noCount: noMap.size,
        totalSnaps: marketSnaps.length
      };
    }

    return { marketIds, marketMap };
  }, [data]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleStop = async () => {
    if (!downloadId) return;
    setStopping(true);
    try {
      const response = await fetch(`/api/data-downloads/${downloadId}/stop`, { method: 'POST' });
      if (!response.ok) throw new Error('Failed to stop download');
    } catch (err) {
      setError(err.message);
      setStopping(false);
    }
  };

  const handleClearData = () => {
    const label = `${assetLabels[formData.asset]} (${formData.asset})`;
    setConfirmDialog({
      open: true,
      title: 'Clear Downloaded Data',
      message: `This will permanently remove all downloaded data for ${label}. You will need to re-download the data to use it again.`,
      confirmLabel: 'Clear Data',
      variant: 'danger',
      onConfirm: async () => {
        setConfirmDialog({ open: false });
        setClearing(true);
        setClearMessage(null);
        setError(null);
        try {
          const response = await fetch('/api/data-downloads/by-asset', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ asset: formData.asset })
          });
          if (!response.ok) throw new Error('Failed to clear data');
          const result = await response.json();
          setClearMessage(result.message);
          setData(null);
          setDownloadId(null);
          setProgress(0);
          setStage('');
        } catch (err) {
          setError(err.message);
        } finally {
          setClearing(false);
        }
      }
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setStopping(false);
    setStage('Initializing...');
    setError(null);
    setData(null);
    setClearMessage(null);
    setSelectedMarket('all');

    try {
      const response = await fetch('/api/data-downloads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      if (!response.ok) throw new Error('Failed to start data download');
      const result = await response.json();
      setDownloadId(result.downloadId);
      if (result.resumed) setStage('Resuming previous download...');
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!downloadId) return;
    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch(`/api/data-downloads/${downloadId}/status`);
        if (!response.ok) throw new Error('Failed to fetch status');
        const status = await response.json();
        setProgress(status.progress_pct || 0);
        setStage(status.stage || '');
        if (status.status === 'completed') {
          clearInterval(pollInterval);
          setLoading(false);
          setStopping(false);
          const dataResponse = await fetch(`/api/data-downloads/${downloadId}/data`);
          if (dataResponse.ok) {
            const downloadedData = await dataResponse.json();
            setData(downloadedData);
          }
        } else if (status.status === 'failed') {
          clearInterval(pollInterval);
          setLoading(false);
          setStopping(false);
          setError(status.error_message || 'Download failed');
        } else if (status.status === 'stopped') {
          clearInterval(pollInterval);
          setLoading(false);
          setStopping(false);
          setStage(`Stopped at ${(status.progress_pct || 0).toFixed(0)}% - click Download to resume`);
        }
      } catch (err) {
        console.error('Error polling status:', err);
      }
    }, 500);
    return () => clearInterval(pollInterval);
  }, [downloadId]);

  const handleExportCSV = async () => {
    if (!downloadId) return;
    try {
      const response = await fetch(`/api/data-downloads/${downloadId}/export.csv`);
      if (!response.ok) throw new Error('Failed to export CSV');
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `data_${formData.asset}_${formData.period}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    }
  };

  const getFilteredPaired = () => {
    if (!marketData) return [];
    if (selectedMarket === 'all') {
      return Object.values(marketData.marketMap).flatMap(m => m.paired);
    }
    return marketData.marketMap[selectedMarket]?.paired || [];
  };

  const renderArbitrage = () => {
    if (!marketData) return <div className="no-data">No data available</div>;

    const markets = Object.values(marketData.marketMap);

    return (
      <div className="arbitrage-container">
        <h3>Arbitrage Analysis (YES + NO Combined Price)</h3>
        <p className="waveform-desc">
          Each market's YES + NO prices summed over time. When the combined price drops below 1.00,
          buying both sides costs less than the guaranteed $1 payout — an arbitrage opportunity.
        </p>

        {markets.map((market, idx) => {
          const paired = market.paired;
          if (paired.length === 0) return null;

          const combinedPrices = paired.map(p => p.combined);
          const minCombined = Math.min(...combinedPrices);
          const maxCombined = Math.max(...combinedPrices);
          const avgCombined = combinedPrices.reduce((a, b) => a + b, 0) / combinedPrices.length;
          const subOneCount = combinedPrices.filter(p => p < 1.0).length;
          const subOnePct = ((subOneCount / combinedPrices.length) * 100).toFixed(1);

          const chartMin = Math.min(minCombined, 0.95);
          const chartMax = Math.max(maxCombined, 1.05);
          const chartRange = chartMax - chartMin;

          const colors = ['#3b82f6', '#8b5cf6', '#f59e0b', '#ef4444'];
          const color = colors[idx % colors.length];

          return (
            <div key={market.id} className="card" style={{ marginBottom: '1rem', padding: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                <div>
                  <h4 style={{ color: color, fontSize: '0.95rem', marginBottom: '0.25rem' }}>
                    Market {idx + 1}: {market.label}
                  </h4>
                  <span style={{ color: '#64748b', fontSize: '0.8rem' }}>{paired.length.toLocaleString()} data points</span>
                </div>
                {subOneCount > 0 && (
                  <span style={{
                    background: '#22c55e20',
                    color: '#22c55e',
                    padding: '0.25rem 0.75rem',
                    borderRadius: '12px',
                    fontSize: '0.8rem',
                    fontWeight: 600
                  }}>
                    {subOneCount.toLocaleString()} windows below 1.0 ({subOnePct}%)
                  </span>
                )}
              </div>

              <svg viewBox="0 0 800 200" preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: 'auto' }}>
                <rect width="800" height="200" fill="#0f172a" rx="4" />

                {(() => {
                  const oneY = 180 - ((1.0 - chartMin) / chartRange) * 160;
                  return (
                    <g>
                      <line x1="50" y1={oneY} x2="760" y2={oneY} stroke="#22c55e" strokeWidth="1.5" strokeDasharray="6,4" />
                      <text x="765" y={oneY + 4} fill="#22c55e" fontSize="10" fontWeight="600">1.00</text>
                    </g>
                  );
                })()}

                {[chartMin, chartMin + chartRange * 0.25, chartMin + chartRange * 0.5, chartMin + chartRange * 0.75, chartMax].map((val, i) => {
                  const y = 180 - ((val - chartMin) / chartRange) * 160;
                  return (
                    <g key={i}>
                      <line x1="50" y1={y} x2="760" y2={y} stroke="#1e293b" strokeWidth="1" />
                      <text x="45" y={y + 4} fill="#64748b" fontSize="9" textAnchor="end">{val.toFixed(3)}</text>
                    </g>
                  );
                })}

                <polyline
                  points={paired.map((p, i) => {
                    const x = 50 + (i / (paired.length - 1)) * 710;
                    const y = 180 - ((p.combined - chartMin) / chartRange) * 160;
                    return `${x},${y}`;
                  }).join(' ')}
                  fill="none"
                  stroke={color}
                  strokeWidth="1.5"
                  opacity="0.9"
                />

                {(() => {
                  const oneY = 180 - ((1.0 - chartMin) / chartRange) * 160;
                  const subOnePoints = paired.map((p, i) => ({
                    x: 50 + (i / (paired.length - 1)) * 710,
                    y: 180 - ((p.combined - chartMin) / chartRange) * 160,
                    isBelow: p.combined < 1.0
                  }));

                  return subOnePoints.filter(p => p.isBelow).map((p, i) => (
                    <line key={i} x1={p.x} y1={oneY} x2={p.x} y2={p.y} stroke="#22c55e" strokeWidth="1" opacity="0.3" />
                  ));
                })()}
              </svg>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.5rem', marginTop: '0.75rem' }}>
                <div className="stat">
                  <label>Min Combined:</label>
                  <span style={{ color: minCombined < 1.0 ? '#22c55e' : '#e2e8f0' }}>{minCombined.toFixed(4)}</span>
                </div>
                <div className="stat">
                  <label>Max Combined:</label>
                  <span>{maxCombined.toFixed(4)}</span>
                </div>
                <div className="stat">
                  <label>Avg Combined:</label>
                  <span style={{ color: avgCombined < 1.0 ? '#22c55e' : '#e2e8f0' }}>{avgCombined.toFixed(4)}</span>
                </div>
                <div className="stat">
                  <label>Max Profit/Unit:</label>
                  <span style={{ color: minCombined < 1.0 ? '#22c55e' : '#64748b' }}>
                    {minCombined < 1.0 ? `$${(1 - minCombined).toFixed(4)}` : 'None'}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderChart = () => {
    if (!marketData) return <div className="no-data">No data available to chart</div>;

    const paired = getFilteredPaired().sort((a, b) => a.timestamp - b.timestamp);
    if (paired.length === 0) return <div className="no-data">No paired data for this selection</div>;

    return (
      <div className="chart-container">
        <div className="chart-header">
          <h3>YES / NO Prices - {formData.asset}</h3>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <select
              value={selectedMarket}
              onChange={(e) => setSelectedMarket(e.target.value)}
              style={{ background: '#334155', color: '#e2e8f0', border: '1px solid #475569', borderRadius: '6px', padding: '0.3rem 0.5rem', fontSize: '0.85rem' }}
            >
              <option value="all">All Markets</option>
              {marketData.marketIds.map((mid, i) => (
                <option key={mid} value={mid}>Market {i + 1}: {mid.substring(0, 12)}...</option>
              ))}
            </select>
            <div className="chart-legend">
              <span className="legend-item">
                <span className="legend-color" style={{ backgroundColor: '#3b82f6' }}></span>
                YES
              </span>
              <span className="legend-item">
                <span className="legend-color" style={{ backgroundColor: '#ef4444' }}></span>
                NO
              </span>
            </div>
          </div>
        </div>
        <div className="chart-info">
          <div className="stat">
            <label>Paired Data Points:</label>
            <span>{paired.length.toLocaleString()}</span>
          </div>
          <div className="stat">
            <label>Time Range:</label>
            <span>
              {new Date(paired[0].timestamp * 1000).toLocaleDateString()} - {' '}
              {new Date(paired[paired.length - 1].timestamp * 1000).toLocaleDateString()}
            </span>
          </div>
        </div>
        <svg className="price-chart" viewBox="0 0 800 400" preserveAspectRatio="xMidYMid meet">
          <rect width="800" height="400" fill="#1e293b" />
          <g>
            {[0, 0.25, 0.5, 0.75, 1.0].map((y, i) => (
              <g key={i}>
                <line x1="50" y1={50 + (1 - y) * 300} x2="750" y2={50 + (1 - y) * 300} stroke="#334155" strokeWidth="1" />
                <text x="35" y={50 + (1 - y) * 300 + 5} fill="#94a3b8" fontSize="12" textAnchor="end">
                  {(y * 100).toFixed(0)}%
                </text>
              </g>
            ))}
          </g>
          <polyline
            points={paired.map((p, i) => {
              const x = 50 + (i / (paired.length - 1)) * 700;
              const y = 350 - (p.yes * 300);
              return `${x},${y}`;
            }).join(' ')}
            fill="none" stroke="#3b82f6" strokeWidth="2"
          />
          <polyline
            points={paired.map((p, i) => {
              const x = 50 + (i / (paired.length - 1)) * 700;
              const y = 350 - (p.no * 300);
              return `${x},${y}`;
            }).join(' ')}
            fill="none" stroke="#ef4444" strokeWidth="2"
          />
          <text x="400" y="390" fill="#94a3b8" fontSize="14" textAnchor="middle">Time</text>
          <text x="20" y="200" fill="#94a3b8" fontSize="14" textAnchor="middle" transform="rotate(-90, 20, 200)">Price</text>
        </svg>
      </div>
    );
  };

  const renderRawData = () => {
    if (!marketData) return <div className="no-data">No data available</div>;

    const paired = getFilteredPaired().sort((a, b) => a.timestamp - b.timestamp);
    if (paired.length === 0) return <div className="no-data">No paired data for this selection</div>;

    return (
      <div className="raw-data-container">
        <div className="raw-data-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
          <h3>Paired Data ({paired.length.toLocaleString()} records)</h3>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <select
              value={selectedMarket}
              onChange={(e) => setSelectedMarket(e.target.value)}
              style={{ background: '#334155', color: '#e2e8f0', border: '1px solid #475569', borderRadius: '6px', padding: '0.3rem 0.5rem', fontSize: '0.85rem' }}
            >
              <option value="all">All Markets</option>
              {marketData.marketIds.map((mid, i) => (
                <option key={mid} value={mid}>Market {i + 1}</option>
              ))}
            </select>
            <button onClick={handleExportCSV} className="btn btn-sm">Download CSV</button>
          </div>
        </div>
        <div className="table-container" style={{ maxHeight: '500px', overflowY: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>YES Price</th>
                <th>NO Price</th>
                <th>Combined (YES+NO)</th>
                <th>Arbitrage</th>
              </tr>
            </thead>
            <tbody>
              {paired.slice(0, 200).map((row, i) => {
                const isArb = row.combined < 1.0;
                return (
                  <tr key={i} style={isArb ? { background: '#22c55e10' } : {}}>
                    <td>{new Date(row.timestamp * 1000).toLocaleString()}</td>
                    <td style={{ color: '#3b82f6' }}>{row.yes.toFixed(4)}</td>
                    <td style={{ color: '#ef4444' }}>{row.no.toFixed(4)}</td>
                    <td style={{ color: isArb ? '#22c55e' : '#e2e8f0', fontWeight: isArb ? 600 : 400 }}>
                      {row.combined.toFixed(4)}
                    </td>
                    <td>
                      {isArb ? (
                        <span className="badge badge-success">
                          +${(1 - row.combined).toFixed(4)}
                        </span>
                      ) : (
                        <span style={{ color: '#64748b' }}>-</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {paired.length > 200 && (
            <div className="table-footer">
              Showing first 200 of {paired.length.toLocaleString()} records. Download CSV for full data.
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="data-download">
      <ConfirmDialog
        open={confirmDialog.open}
        title={confirmDialog.title}
        message={confirmDialog.message}
        confirmLabel={confirmDialog.confirmLabel}
        cancelLabel={confirmDialog.cancelLabel}
        variant={confirmDialog.variant}
        onConfirm={confirmDialog.onConfirm || (() => setConfirmDialog({ open: false }))}
        onCancel={() => setConfirmDialog({ open: false })}
      />

      <div className="card">
        <h2>Download Market Data</h2>
        <p style={{ color: '#94a3b8', marginBottom: '1.5rem' }}>
          Download historical market data at 5-minute intervals. Use the Backtests tab to run analysis at your preferred timeframe.
        </p>

        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
            <div className="form-group">
              <label htmlFor="asset">Asset</label>
              <select id="asset" name="asset" value={formData.asset} onChange={handleChange} disabled={loading} required>
                <option value="BTC">Bitcoin (BTC)</option>
                <option value="ETH">Ethereum (ETH)</option>
                <option value="SOL">Solana (SOL)</option>
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="period">Time Period</label>
              <select id="period" name="period" value={formData.period} onChange={handleChange} disabled={loading} required>
                <option value="7d">7 days</option>
                <option value="30d">30 days</option>
                <option value="60d">60 days</option>
                <option value="3m">3 months</option>
                <option value="6m">6 months</option>
              </select>
            </div>
          </div>

          {error && (
            <div style={{ color: '#ef4444', marginTop: '1rem', fontSize: '0.9rem' }}>Error: {error}</div>
          )}

          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
            <button type="submit" className="btn" disabled={loading || clearing}>
              {loading ? 'Downloading...' : 'Download Data'}
            </button>
            {loading && (
              <button type="button" className="btn" onClick={handleStop} disabled={stopping} style={{ backgroundColor: '#ef4444' }}>
                {stopping ? 'Stopping...' : 'Stop Download'}
              </button>
            )}
            {!loading && (
              <button type="button" className="btn" onClick={handleClearData} disabled={clearing} style={{ backgroundColor: '#64748b' }}>
                {clearing ? 'Clearing...' : 'Clear Data'}
              </button>
            )}
          </div>

          {clearMessage && (
            <div style={{ color: '#22c55e', marginTop: '0.75rem', fontSize: '0.9rem' }}>{clearMessage}</div>
          )}
        </form>

        {(loading || (!loading && stage && stage.includes('Stopped'))) && (
          <div className="progress-section" style={{ marginTop: '1.5rem' }}>
            <div className="progress-info">
              <span className="progress-stage">{stage}</span>
              <span className="progress-percentage">{progress.toFixed(0)}%</span>
            </div>
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}
      </div>

      {data && (
        <div className="card" style={{ marginTop: '1.5rem' }}>
          <div className="tabs">
            <button className={`tab ${activeTab === 'arbitrage' ? 'active' : ''}`} onClick={() => setActiveTab('arbitrage')}>
              Arbitrage View
            </button>
            <button className={`tab ${activeTab === 'chart' ? 'active' : ''}`} onClick={() => setActiveTab('chart')}>
              Price Chart
            </button>
            <button className={`tab ${activeTab === 'raw' ? 'active' : ''}`} onClick={() => setActiveTab('raw')}>
              Raw Data
            </button>
          </div>

          <div className="tab-content">
            {activeTab === 'arbitrage' && renderArbitrage()}
            {activeTab === 'chart' && renderChart()}
            {activeTab === 'raw' && renderRawData()}
          </div>
        </div>
      )}
    </div>
  );
}

export default DataDownload;
