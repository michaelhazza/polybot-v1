import React, { useState, useEffect } from 'react';

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
  const [activeTab, setActiveTab] = useState('chart');

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setProgress(0);
    setStage('Initializing...');
    setError(null);
    setData(null);

    try {
      const response = await fetch('/api/data-downloads', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(formData)
      });

      if (!response.ok) {
        throw new Error('Failed to start data download');
      }

      const result = await response.json();
      setDownloadId(result.downloadId);

    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  // Poll for progress updates
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
          // Fetch the actual data
          const dataResponse = await fetch(`/api/data-downloads/${downloadId}/data`);
          if (dataResponse.ok) {
            const downloadedData = await dataResponse.json();
            setData(downloadedData);
          }
        } else if (status.status === 'failed') {
          clearInterval(pollInterval);
          setLoading(false);
          setError(status.error_message || 'Download failed');
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

  const renderChart = () => {
    if (!data || !data.snapshots || data.snapshots.length === 0) {
      return <div className="no-data">No data available to chart</div>;
    }

    const upSnapshots = data.snapshots.filter(s => s.side === 'UP');
    const downSnapshots = data.snapshots.filter(s => s.side === 'DOWN');

    return (
      <div className="chart-container">
        <div className="chart-header">
          <h3>Price History - {formData.asset}</h3>
          <div className="chart-legend">
            <span className="legend-item">
              <span className="legend-color" style={{ backgroundColor: '#3b82f6' }}></span>
              UP Side (Yes)
            </span>
            <span className="legend-item">
              <span className="legend-color" style={{ backgroundColor: '#ef4444' }}></span>
              DOWN Side (No)
            </span>
          </div>
        </div>
        <div className="chart-info">
          <div className="stat">
            <label>Total Data Points:</label>
            <span>{data.snapshots.length}</span>
          </div>
          <div className="stat">
            <label>Time Range:</label>
            <span>
              {new Date(data.snapshots[0].timestamp * 1000).toLocaleDateString()} - {' '}
              {new Date(data.snapshots[data.snapshots.length - 1].timestamp * 1000).toLocaleDateString()}
            </span>
          </div>
        </div>
        <svg className="price-chart" viewBox="0 0 800 400" preserveAspectRatio="xMidYMid meet">
          <rect width="800" height="400" fill="#1e293b" />
          <g className="grid">
            {[0, 0.25, 0.5, 0.75, 1.0].map((y, i) => (
              <g key={i}>
                <line
                  x1="50"
                  y1={50 + (1 - y) * 300}
                  x2="750"
                  y2={50 + (1 - y) * 300}
                  stroke="#334155"
                  strokeWidth="1"
                />
                <text
                  x="35"
                  y={50 + (1 - y) * 300 + 5}
                  fill="#94a3b8"
                  fontSize="12"
                  textAnchor="end"
                >
                  {(y * 100).toFixed(0)}%
                </text>
              </g>
            ))}
          </g>
          <g className="up-line">
            <polyline
              points={upSnapshots.map((s, i) => {
                const x = 50 + (i / (upSnapshots.length - 1)) * 700;
                const y = 350 - (s.mid * 300);
                return `${x},${y}`;
              }).join(' ')}
              fill="none"
              stroke="#3b82f6"
              strokeWidth="2"
            />
          </g>
          <g className="down-line">
            <polyline
              points={downSnapshots.map((s, i) => {
                const x = 50 + (i / (downSnapshots.length - 1)) * 700;
                const y = 350 - (s.mid * 300);
                return `${x},${y}`;
              }).join(' ')}
              fill="none"
              stroke="#ef4444"
              strokeWidth="2"
            />
          </g>
          <text x="400" y="390" fill="#94a3b8" fontSize="14" textAnchor="middle">
            Time
          </text>
          <text x="20" y="200" fill="#94a3b8" fontSize="14" textAnchor="middle" transform="rotate(-90, 20, 200)">
            Price
          </text>
        </svg>
      </div>
    );
  };

  const renderWaveform = () => {
    if (!data || !data.snapshots || data.snapshots.length === 0) {
      return <div className="no-data">No data available</div>;
    }

    const combinedPrices = [];
    const upMap = new Map();
    const downMap = new Map();

    data.snapshots.forEach(s => {
      if (s.side === 'UP') {
        upMap.set(s.timestamp, s.mid);
      } else {
        downMap.set(s.timestamp, s.mid);
      }
    });

    const timestamps = [...upMap.keys()].sort((a, b) => a - b);
    timestamps.forEach(ts => {
      const up = upMap.get(ts) || 0.5;
      const down = downMap.get(ts) || 0.5;
      combinedPrices.push(up + down);
    });

    return (
      <div className="waveform-container">
        <h3>Combined Price Waveform</h3>
        <p className="waveform-desc">
          Visual representation of combined UP + DOWN prices over time.
          Values below 1.00 indicate arbitrage opportunities.
        </p>
        <svg className="waveform" viewBox="0 0 800 300" preserveAspectRatio="xMidYMid meet">
          <rect width="800" height="300" fill="#0f172a" />
          <line x1="50" y1="150" x2="750" y2="150" stroke="#22c55e" strokeWidth="2" strokeDasharray="5,5" />
          <text x="755" y="155" fill="#22c55e" fontSize="12">1.00</text>

          {combinedPrices.map((price, i) => {
            const x = 50 + (i / (combinedPrices.length - 1)) * 700;
            const baseline = 150;
            const amplitude = (price - 1.0) * 500;
            const y = baseline - amplitude;
            const color = price < 1.0 ? '#22c55e' : '#ef4444';

            return (
              <rect
                key={i}
                x={x - 1}
                y={Math.min(y, baseline)}
                width="2"
                height={Math.abs(amplitude)}
                fill={color}
                opacity="0.8"
              />
            );
          })}

          <text x="400" y="290" fill="#94a3b8" fontSize="14" textAnchor="middle">
            Time
          </text>
        </svg>
        <div className="waveform-stats">
          <div className="stat">
            <label>Min Combined Price:</label>
            <span className={Math.min(...combinedPrices) < 1.0 ? 'positive' : ''}>
              {Math.min(...combinedPrices).toFixed(4)}
            </span>
          </div>
          <div className="stat">
            <label>Max Combined Price:</label>
            <span>{Math.max(...combinedPrices).toFixed(4)}</span>
          </div>
          <div className="stat">
            <label>Avg Combined Price:</label>
            <span>{(combinedPrices.reduce((a, b) => a + b, 0) / combinedPrices.length).toFixed(4)}</span>
          </div>
        </div>
      </div>
    );
  };

  const renderRawData = () => {
    if (!data || !data.snapshots || data.snapshots.length === 0) {
      return <div className="no-data">No data available</div>;
    }

    return (
      <div className="raw-data-container">
        <div className="raw-data-header">
          <h3>Raw Data ({data.snapshots.length} records)</h3>
          <button onClick={handleExportCSV} className="btn btn-sm">
            Download CSV
          </button>
        </div>
        <div className="table-container" style={{ maxHeight: '500px', overflowY: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Side</th>
                <th>Mid Price</th>
                <th>Last Price</th>
                <th>Tradable</th>
              </tr>
            </thead>
            <tbody>
              {data.snapshots.slice(0, 100).map((snap, i) => (
                <tr key={i}>
                  <td>{new Date(snap.timestamp * 1000).toLocaleString()}</td>
                  <td>
                    <span className={`badge ${snap.side === 'UP' ? 'badge-up' : 'badge-down'}`}>
                      {snap.side}
                    </span>
                  </td>
                  <td>{snap.mid.toFixed(4)}</td>
                  <td>{snap.last.toFixed(4)}</td>
                  <td>
                    {snap.is_tradable ? (
                      <span className="badge badge-success">Yes</span>
                    ) : (
                      <span className="badge badge-error">No</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.snapshots.length > 100 && (
            <div className="table-footer">
              Showing first 100 of {data.snapshots.length} records. Download CSV for full data.
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="data-download">
      <div className="card">
        <h2>Download Market Data</h2>
        <p style={{ color: '#94a3b8', marginBottom: '1.5rem' }}>
          Download and analyze historical market data independently from backtesting
        </p>

        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
            <div className="form-group">
              <label htmlFor="asset">Asset</label>
              <select
                id="asset"
                name="asset"
                value={formData.asset}
                onChange={handleChange}
                disabled={loading}
                required
              >
                <option value="BTC">Bitcoin (BTC)</option>
                <option value="ETH">Ethereum (ETH)</option>
                <option value="SOL">Solana (SOL)</option>
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="period">Time Period</label>
              <select
                id="period"
                name="period"
                value={formData.period}
                onChange={handleChange}
                disabled={loading}
                required
              >
                <option value="7d">7 days</option>
                <option value="30d">30 days</option>
                <option value="60d">60 days</option>
                <option value="3m">3 months</option>
                <option value="6m">6 months</option>
              </select>
            </div>
          </div>

          {error && (
            <div style={{ color: '#ef4444', marginTop: '1rem', fontSize: '0.9rem' }}>
              Error: {error}
            </div>
          )}

          <button
            type="submit"
            className="btn"
            disabled={loading}
            style={{ marginTop: '1rem' }}
          >
            {loading ? 'Downloading...' : 'Download Data'}
          </button>
        </form>

        {loading && (
          <div className="progress-section" style={{ marginTop: '1.5rem' }}>
            <div className="progress-info">
              <span className="progress-stage">{stage}</span>
              <span className="progress-percentage">{progress.toFixed(0)}%</span>
            </div>
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {data && (
        <div className="card" style={{ marginTop: '1.5rem' }}>
          <div className="tabs">
            <button
              className={`tab ${activeTab === 'chart' ? 'active' : ''}`}
              onClick={() => setActiveTab('chart')}
            >
              Chart View
            </button>
            <button
              className={`tab ${activeTab === 'waveform' ? 'active' : ''}`}
              onClick={() => setActiveTab('waveform')}
            >
              Waveform
            </button>
            <button
              className={`tab ${activeTab === 'raw' ? 'active' : ''}`}
              onClick={() => setActiveTab('raw')}
            >
              Raw Data
            </button>
          </div>

          <div className="tab-content">
            {activeTab === 'chart' && renderChart()}
            {activeTab === 'waveform' && renderWaveform()}
            {activeTab === 'raw' && renderRawData()}
          </div>
        </div>
      )}
    </div>
  );
}

export default DataDownload;
