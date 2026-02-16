import React, { useState, useEffect, useMemo } from 'react';
import ConfirmDialog from './ConfirmDialog';

const ASSET_LABELS = { BTC: 'Bitcoin', ETH: 'Ethereum', SOL: 'Solana' };
const PERIOD_LABELS = { '7d': '7 days', '30d': '30 days', '60d': '60 days', '3m': '3 months', '6m': '6 months', '12m': '12 months', '24m': '24 months', '36m': '36 months', 'custom': 'Custom' };

function DataDownload() {
  const [formData, setFormData] = useState({ asset: 'BTC', period: '30d' });
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [downloads, setDownloads] = useState([]);
  const [activeDownloadId, setActiveDownloadId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState('');
  const [error, setError] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [expandedData, setExpandedData] = useState(null);
  const [expandedTab, setExpandedTab] = useState('arbitrage');
  const [expandedMarket, setExpandedMarket] = useState('all');
  const [loadingData, setLoadingData] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState({ open: false });
  const [clearMessage, setClearMessage] = useState(null);
  const [analyseAsset, setAnalyseAsset] = useState('BTC');
  const [analyseStart, setAnalyseStart] = useState('');
  const [analyseEnd, setAnalyseEnd] = useState('');
  const [analyseData, setAnalyseData] = useState(null);
  const [analyseLoading, setAnalyseLoading] = useState(false);
  const [analyseTab, setAnalyseTab] = useState('arbitrage');
  const [analyseMarket, setAnalyseMarket] = useState('all');

  const fetchDownloads = async () => {
    try {
      const res = await fetch('/api/data-downloads');
      if (res.ok) {
        const list = await res.json();
        setDownloads(list);
      }
    } catch (err) {
      console.error('Failed to fetch downloads:', err);
    }
  };

  useEffect(() => { fetchDownloads(); }, []);

  useEffect(() => {
    if (!activeDownloadId) return;
    const pollInterval = setInterval(async () => {
      try {
        const res = await fetch(`/api/data-downloads/${activeDownloadId}/status`);
        if (!res.ok) throw new Error('Failed to fetch status');
        const status = await res.json();
        setProgress(status.progress_pct || 0);
        setStage(status.stage || '');
        if (status.status === 'completed') {
          clearInterval(pollInterval);
          setLoading(false);
          setStopping(false);
          setActiveDownloadId(null);
          fetchDownloads();
        } else if (status.status === 'failed') {
          clearInterval(pollInterval);
          setLoading(false);
          setStopping(false);
          setActiveDownloadId(null);
          setError(status.error_message || 'Download failed');
          fetchDownloads();
        } else if (status.status === 'stopped') {
          clearInterval(pollInterval);
          setLoading(false);
          setStopping(false);
          setActiveDownloadId(null);
          fetchDownloads();
        }
      } catch (err) {
        console.error('Error polling status:', err);
      }
    }, 500);
    return () => clearInterval(pollInterval);
  }, [activeDownloadId]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setStopping(false);
    setStage('Initializing...');
    setError(null);
    setClearMessage(null);
    try {
      const payload = { ...formData };
      if (formData.period === 'custom') {
        if (!customStart || !customEnd) {
          setError('Please select both a start and end date');
          setLoading(false);
          return;
        }
        const startDate = new Date(customStart);
        const endDate = new Date(customEnd);
        endDate.setHours(23, 59, 59, 999);
        if (endDate <= startDate) {
          setError('End date must be after start date');
          setLoading(false);
          return;
        }
        payload.customStart = Math.floor(startDate.getTime() / 1000);
        payload.customEnd = Math.floor(endDate.getTime() / 1000);
      }
      const res = await fetch('/api/data-downloads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('Failed to start data download');
      const result = await res.json();
      setActiveDownloadId(result.downloadId);
      if (result.resumed) setStage('Resuming previous download...');
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  const handleResume = async (dl) => {
    setFormData({ asset: dl.asset, period: dl.period });
    if (dl.period === 'custom') {
      const startStr = new Date(dl.start_time * 1000).toISOString().split('T')[0];
      const endStr = new Date(dl.end_time * 1000).toISOString().split('T')[0];
      setCustomStart(startStr);
      setCustomEnd(endStr);
    }
    setLoading(true);
    setStopping(false);
    setStage('Resuming download...');
    setError(null);
    setClearMessage(null);
    try {
      const res = await fetch(`/api/data-downloads/${dl.id}/resume`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to resume download');
      const result = await res.json();
      setActiveDownloadId(result.downloadId);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  const handleStop = async () => {
    if (!activeDownloadId) return;
    setStopping(true);
    try {
      await fetch(`/api/data-downloads/${activeDownloadId}/stop`, { method: 'POST' });
    } catch (err) {
      setError(err.message);
      setStopping(false);
    }
  };

  const handleClearAsset = (asset) => {
    const label = `${ASSET_LABELS[asset]} (${asset})`;
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
        try {
          const res = await fetch('/api/data-downloads/by-asset', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ asset })
          });
          if (!res.ok) throw new Error('Failed to clear data');
          const result = await res.json();
          setClearMessage(result.message);
          if (expandedData && expandedId) {
            const dl = downloads.find(d => d.id === expandedId);
            if (dl && dl.asset === asset) {
              setExpandedId(null);
              setExpandedData(null);
            }
          }
          fetchDownloads();
        } catch (err) {
          setError(err.message);
        } finally {
          setClearing(false);
        }
      }
    });
  };

  const handleExpand = async (downloadId) => {
    if (expandedId === downloadId) {
      setExpandedId(null);
      setExpandedData(null);
      return;
    }
    setExpandedId(downloadId);
    setExpandedData(null);
    setLoadingData(true);
    setExpandedTab('arbitrage');
    setExpandedMarket('all');
    try {
      const res = await fetch(`/api/data-downloads/${downloadId}/data`);
      if (!res.ok) throw new Error('Failed to load data');
      const data = await res.json();
      setExpandedData(data);
    } catch (err) {
      setError(err.message);
      setExpandedId(null);
    } finally {
      setLoadingData(false);
    }
  };

  const handleAnalyse = async (e) => {
    e.preventDefault();
    if (!analyseStart || !analyseEnd) {
      setError('Please select both start and end dates for analysis');
      return;
    }
    const startDate = new Date(analyseStart);
    const endDate = new Date(analyseEnd);
    endDate.setHours(23, 59, 59, 999);
    if (endDate <= startDate) {
      setError('End date must be after start date');
      return;
    }
    setAnalyseLoading(true);
    setAnalyseData(null);
    setAnalyseTab('arbitrage');
    setAnalyseMarket('all');
    setError(null);
    try {
      const startTs = Math.floor(startDate.getTime() / 1000);
      const endTs = Math.floor(endDate.getTime() / 1000);
      const res = await fetch(`/api/data-downloads/analyze/range?asset=${analyseAsset}&start=${startTs}&end=${endTs}`);
      if (!res.ok) throw new Error('Failed to load analysis data');
      const data = await res.json();
      setAnalyseData(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setAnalyseLoading(false);
    }
  };

  const handleExportCSV = async (downloadId, asset, period) => {
    try {
      const res = await fetch(`/api/data-downloads/${downloadId}/export.csv`);
      if (!res.ok) throw new Error('Failed to export CSV');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `data_${asset}_${period}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    }
  };

  const groupedDownloads = useMemo(() => {
    const groups = {};
    downloads.forEach(dl => {
      if (!groups[dl.asset]) groups[dl.asset] = [];
      groups[dl.asset].push(dl);
    });
    return groups;
  }, [downloads]);

  const handleChange = (e) => {
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
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
          Download historical market data. Interval is configurable in Settings. Data is saved and persists across sessions.
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
                <option value="12m">12 months</option>
                <option value="24m">24 months</option>
                <option value="36m">36 months</option>
                <option value="custom">Custom Range</option>
              </select>
            </div>
          </div>

          {formData.period === 'custom' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginTop: '1rem' }}>
              <div className="form-group">
                <label htmlFor="customStart">Start Date</label>
                <input
                  type="date"
                  id="customStart"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  disabled={loading}
                  max={customEnd || new Date().toISOString().split('T')[0]}
                  style={{ colorScheme: 'dark' }}
                />
              </div>
              <div className="form-group">
                <label htmlFor="customEnd">End Date</label>
                <input
                  type="date"
                  id="customEnd"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  disabled={loading}
                  min={customStart}
                  max={new Date().toISOString().split('T')[0]}
                  style={{ colorScheme: 'dark' }}
                />
              </div>
            </div>
          )}

          {error && <div style={{ color: '#ef4444', marginTop: '1rem', fontSize: '0.9rem' }}>Error: {error}</div>}

          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
            <button type="submit" className="btn" disabled={loading || clearing}>
              {loading ? 'Downloading...' : 'Download Data'}
            </button>
            {loading && (
              <button type="button" className="btn" onClick={handleStop} disabled={stopping} style={{ backgroundColor: '#ef4444' }}>
                {stopping ? 'Stopping...' : 'Stop Download'}
              </button>
            )}
          </div>

          {clearMessage && <div style={{ color: '#22c55e', marginTop: '0.75rem', fontSize: '0.9rem' }}>{clearMessage}</div>}
        </form>

        {loading && (
          <div className="progress-section" style={{ marginTop: '1.5rem' }}>
            <div className="progress-info">
              <span className="progress-stage">{stage}</span>
              {progress >= 0 && (
                <span className="progress-percentage">{progress.toFixed(0)}%</span>
              )}
            </div>
            {progress >= 0 ? (
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${progress}%` }} />
              </div>
            ) : (
              <div className="progress-bar">
                <div className="progress-fill progress-fill-indeterminate" />
              </div>
            )}
          </div>
        )}
      </div>

      {Object.keys(groupedDownloads).length > 0 && (
        <div style={{ marginTop: '1.5rem' }}>
          <h3 style={{ marginBottom: '1rem', color: '#e2e8f0' }}>Saved Data</h3>
          {Object.entries(groupedDownloads).map(([asset, assetDownloads]) => (
            <AssetGroup
              key={asset}
              asset={asset}
              downloads={assetDownloads}
              expandedId={expandedId}
              expandedData={expandedData}
              expandedTab={expandedTab}
              expandedMarket={expandedMarket}
              loadingData={loadingData}
              loading={loading}
              onExpand={handleExpand}
              onSetTab={setExpandedTab}
              onSetMarket={setExpandedMarket}
              onClear={handleClearAsset}
              onExportCSV={handleExportCSV}
              onResume={handleResume}
            />
          ))}
        </div>
      )}

      <div className="card" style={{ marginTop: '1.5rem' }}>
        <h2>Analyse Data</h2>
        <p style={{ color: '#94a3b8', marginBottom: '1.5rem' }}>
          View analysis across all downloaded data for a custom date range. Combines data from all completed downloads.
        </p>

        <form onSubmit={handleAnalyse}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
            <div className="form-group">
              <label htmlFor="analyseAsset">Asset</label>
              <select id="analyseAsset" value={analyseAsset} onChange={(e) => setAnalyseAsset(e.target.value)} disabled={analyseLoading}>
                <option value="BTC">Bitcoin (BTC)</option>
                <option value="ETH">Ethereum (ETH)</option>
                <option value="SOL">Solana (SOL)</option>
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="analyseStart">Start Date</label>
              <input
                type="date"
                id="analyseStart"
                value={analyseStart}
                onChange={(e) => setAnalyseStart(e.target.value)}
                disabled={analyseLoading}
                max={analyseEnd || new Date().toISOString().split('T')[0]}
                style={{ colorScheme: 'dark' }}
              />
            </div>
            <div className="form-group">
              <label htmlFor="analyseEnd">End Date</label>
              <input
                type="date"
                id="analyseEnd"
                value={analyseEnd}
                onChange={(e) => setAnalyseEnd(e.target.value)}
                disabled={analyseLoading}
                min={analyseStart}
                max={new Date().toISOString().split('T')[0]}
                style={{ colorScheme: 'dark' }}
              />
            </div>
          </div>
          <div style={{ marginTop: '1rem' }}>
            <button type="submit" className="btn" disabled={analyseLoading || !analyseStart || !analyseEnd}>
              {analyseLoading ? 'Loading...' : 'Analyse'}
            </button>
          </div>
        </form>

        {analyseLoading && (
          <div style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>Loading analysis data...</div>
        )}

        {analyseData && (
          <div style={{ marginTop: '1.5rem' }}>
            <div style={{ color: '#94a3b8', fontSize: '0.85rem', marginBottom: '1rem', display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
              <span>{analyseData.meta.total_markets} market{analyseData.meta.total_markets !== 1 ? 's' : ''}</span>
              <span>{analyseData.meta.total_snapshots.toLocaleString()} data points</span>
              <span>
                {new Date(analyseData.meta.start_time * 1000).toLocaleDateString('en-AU')} - {new Date(analyseData.meta.end_time * 1000).toLocaleDateString('en-AU')}
              </span>
              <span>from {analyseData.meta.source_downloads} download{analyseData.meta.source_downloads !== 1 ? 's' : ''}</span>
            </div>
            {analyseData.snapshots.length > 0 ? (
              <ExpandedDataView
                data={{ snapshots: analyseData.snapshots }}
                dl={{ asset: analyseAsset, period: 'custom' }}
                activeTab={analyseTab}
                selectedMarket={analyseMarket}
                onSetTab={setAnalyseTab}
                onSetMarket={setAnalyseMarket}
                onExportCSV={() => {}}
              />
            ) : (
              <div style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>
                No data found for this date range. Make sure you have downloaded data that covers this period.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function AssetGroup({ asset, downloads, expandedId, expandedData, expandedTab, expandedMarket, loadingData, loading, onExpand, onSetTab, onSetMarket, onClear, onExportCSV, onResume }) {
  const completedDownloads = downloads.filter(d => d.status === 'completed');
  const totalSnapshots = completedDownloads.reduce((sum, d) => sum + (d.snapshot_count || 0), 0);
  const totalMarkets = completedDownloads.reduce((sum, d) => sum + (d.market_count || 0), 0);

  let dateRange = '';
  if (completedDownloads.length > 0) {
    const earliest = Math.min(...completedDownloads.map(d => d.start_time));
    const latest = Math.max(...completedDownloads.map(d => d.end_time));
    dateRange = `${new Date(earliest * 1000).toLocaleDateString('en-AU')} - ${new Date(latest * 1000).toLocaleDateString('en-AU')}`;
  }

  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h3 style={{ color: '#60a5fa', marginBottom: '0.25rem' }}>
            {ASSET_LABELS[asset]} ({asset})
          </h3>
          {completedDownloads.length > 0 && (
            <div style={{ color: '#94a3b8', fontSize: '0.85rem', display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
              <span>{totalMarkets} market{totalMarkets !== 1 ? 's' : ''}</span>
              <span>{totalSnapshots.toLocaleString()} data points</span>
              {dateRange && <span>{dateRange}</span>}
            </div>
          )}
        </div>
        <button
          className="btn"
          onClick={() => onClear(asset)}
          style={{ backgroundColor: '#64748b', fontSize: '0.8rem', padding: '0.4rem 0.75rem' }}
        >
          Clear All
        </button>
      </div>

      {downloads.map(dl => (
        <DownloadRow
          key={dl.id}
          dl={dl}
          isExpanded={expandedId === dl.id}
          expandedData={expandedId === dl.id ? expandedData : null}
          expandedTab={expandedTab}
          expandedMarket={expandedMarket}
          loadingData={loadingData && expandedId === dl.id}
          loading={loading}
          onExpand={onExpand}
          onSetTab={onSetTab}
          onSetMarket={onSetMarket}
          onExportCSV={onExportCSV}
          onResume={onResume}
        />
      ))}
    </div>
  );
}

function DownloadRow({ dl, isExpanded, expandedData, expandedTab, expandedMarket, loadingData, loading, onExpand, onSetTab, onSetMarket, onExportCSV, onResume }) {
  const startDate = new Date(dl.start_time * 1000).toLocaleDateString('en-AU');
  const endDate = new Date(dl.end_time * 1000).toLocaleDateString('en-AU');
  const isClickable = dl.status === 'completed';

  const statusColors = {
    completed: '#22c55e',
    running: '#f59e0b',
    stopped: '#f59e0b',
    failed: '#ef4444'
  };

  return (
    <div style={{ marginTop: '0.75rem', borderTop: '1px solid #334155', paddingTop: '0.75rem' }}>
      <div
        onClick={() => isClickable && onExpand(dl.id)}
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          cursor: isClickable ? 'pointer' : 'default',
          padding: '0.5rem',
          borderRadius: '6px',
          transition: 'background 0.15s',
          ...(isClickable ? { ':hover': { background: '#334155' } } : {})
        }}
        onMouseEnter={(e) => { if (isClickable) e.currentTarget.style.background = '#334155'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {isClickable && (
            <span style={{ color: '#64748b', fontSize: '0.9rem', transition: 'transform 0.2s', transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>
              &#9654;
            </span>
          )}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontWeight: 500 }}>{dl.period === 'custom' ? `${startDate} - ${endDate}` : (PERIOD_LABELS[dl.period] || dl.period)}</span>
              <span style={{
                fontSize: '0.75rem',
                padding: '0.15rem 0.5rem',
                borderRadius: '10px',
                background: statusColors[dl.status] + '20',
                color: statusColors[dl.status],
                fontWeight: 600
              }}>
                {dl.status}
              </span>
            </div>
            <div style={{ color: '#64748b', fontSize: '0.8rem', marginTop: '0.15rem' }}>
              {startDate} - {endDate}
              {dl.snapshot_count > 0 && <span> &middot; {dl.snapshot_count.toLocaleString()} snapshots</span>}
              {dl.market_count > 0 && <span> &middot; {dl.market_count} market{dl.market_count !== 1 ? 's' : ''}</span>}
            </div>
          </div>
        </div>
        {dl.status === 'completed' && (
          <span style={{ color: '#64748b', fontSize: '0.8rem' }}>
            {isExpanded ? 'Click to collapse' : 'Click to inspect'}
          </span>
        )}
        {(dl.status === 'running' || dl.status === 'stopped' || dl.status === 'failed') && (
          <button
            className="btn"
            onClick={(e) => { e.stopPropagation(); onResume(dl); }}
            disabled={loading}
            style={{ fontSize: '0.8rem', padding: '0.4rem 0.75rem', backgroundColor: '#3b82f6' }}
          >
            {loading ? 'Resuming...' : 'Resume'}
          </button>
        )}
      </div>

      {isExpanded && (
        <div style={{ marginTop: '0.75rem' }}>
          {loadingData && (
            <div style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>Loading data...</div>
          )}
          {expandedData && (
            <ExpandedDataView
              data={expandedData}
              dl={dl}
              activeTab={expandedTab}
              selectedMarket={expandedMarket}
              onSetTab={onSetTab}
              onSetMarket={onSetMarket}
              onExportCSV={() => onExportCSV(dl.id, dl.asset, dl.period)}
            />
          )}
        </div>
      )}
    </div>
  );
}

function ExpandedDataView({ data, dl, activeTab, selectedMarket, onSetTab, onSetMarket, onExportCSV }) {
  const marketData = useMemo(() => {
    if (!data || !data.snapshots || data.snapshots.length === 0) return null;
    const marketIds = [...new Set(data.snapshots.map(s => s.market_id))];
    const marketMap = {};

    for (const mid of marketIds) {
      const marketSnaps = data.snapshots.filter(s => s.market_id === mid);
      const yesMap = new Map();
      const noMap = new Map();

      marketSnaps.forEach(s => {
        if (s.side === 'YES' || s.side === 'UP') yesMap.set(s.timestamp, s.mid);
        else noMap.set(s.timestamp, s.mid);
      });

      const paired = [];
      const allTs = [...new Set([...yesMap.keys(), ...noMap.keys()])].sort((a, b) => a - b);
      for (const ts of allTs) {
        const yes = yesMap.get(ts);
        const no = noMap.get(ts);
        if (yes !== undefined && no !== undefined) {
          paired.push({ timestamp: ts, yes, no, combined: yes + no });
        }
      }

      marketMap[mid] = { id: mid, label: mid.startsWith('synthetic_') ? 'Synthetic Market' : mid.substring(0, 12) + '...', paired, yesCount: yesMap.size, noCount: noMap.size };
    }

    return { marketIds, marketMap };
  }, [data]);

  if (!marketData) return (
    <div className="no-data" style={{ textAlign: 'center', padding: '1.5rem', color: '#94a3b8' }}>
      <div style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>No price snapshots available</div>
      {data && data.markets && data.markets.length > 0 && (
        <div style={{ fontSize: '0.85rem', color: '#64748b' }}>
          {data.markets.length} market{data.markets.length !== 1 ? 's' : ''} found, but no trade data was returned from the blockchain for this period.
        </div>
      )}
    </div>
  );

  const getFilteredPaired = () => {
    if (selectedMarket === 'all') return Object.values(marketData.marketMap).flatMap(m => m.paired).sort((a, b) => a.timestamp - b.timestamp);
    return (marketData.marketMap[selectedMarket]?.paired || []).sort((a, b) => a.timestamp - b.timestamp);
  };

  return (
    <div>
      <div className="tabs">
        <button className={`tab ${activeTab === 'arbitrage' ? 'active' : ''}`} onClick={() => onSetTab('arbitrage')}>Arbitrage View</button>
        <button className={`tab ${activeTab === 'chart' ? 'active' : ''}`} onClick={() => onSetTab('chart')}>Price Chart</button>
        <button className={`tab ${activeTab === 'raw' ? 'active' : ''}`} onClick={() => onSetTab('raw')}>Raw Data</button>
      </div>
      <div className="tab-content">
        {activeTab === 'arbitrage' && <ArbitrageView marketData={marketData} />}
        {activeTab === 'chart' && <ChartView marketData={marketData} paired={getFilteredPaired()} selectedMarket={selectedMarket} onSetMarket={onSetMarket} asset={dl.asset} />}
        {activeTab === 'raw' && <RawDataView paired={getFilteredPaired()} marketData={marketData} selectedMarket={selectedMarket} onSetMarket={onSetMarket} onExportCSV={onExportCSV} />}
      </div>
    </div>
  );
}

function getDateTicks(paired, numTicks = 6) {
  if (paired.length < 2) return [];
  const ticks = [];
  for (let i = 0; i < numTicks; i++) {
    const idx = Math.round((i / (numTicks - 1)) * (paired.length - 1));
    const ts = paired[idx].timestamp;
    const d = new Date(ts * 1000);
    const label = d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: '2-digit' });
    ticks.push({ idx, label, frac: idx / (paired.length - 1) });
  }
  return ticks;
}

function ArbitrageView({ marketData }) {
  const markets = Object.values(marketData.marketMap);
  const colors = ['#3b82f6', '#8b5cf6', '#f59e0b', '#ef4444'];

  return (
    <div>
      <h3>Arbitrage Analysis (YES + NO Combined Price)</h3>
      <p className="waveform-desc">
        Each market's YES + NO prices summed per timestamp. When the combined price drops below 1.00,
        buying both sides costs less than the guaranteed $1 payout.
      </p>
      {markets.map((market, idx) => {
        const paired = market.paired;
        if (paired.length === 0) return null;
        const combinedPrices = paired.map(p => p.combined);
        const minC = Math.min(...combinedPrices);
        const maxC = Math.max(...combinedPrices);
        const avgC = combinedPrices.reduce((a, b) => a + b, 0) / combinedPrices.length;
        const subOneCount = combinedPrices.filter(p => p < 0.9999).length;
        const subOnePct = ((subOneCount / combinedPrices.length) * 100).toFixed(1);
        const chartMin = Math.min(minC, 0.95);
        const chartMax = Math.max(maxC, 1.05);
        const chartRange = chartMax - chartMin;
        const color = colors[idx % colors.length];

        return (
          <div key={market.id} className="card" style={{ marginBottom: '1rem', padding: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div>
                <h4 style={{ color, fontSize: '0.95rem', marginBottom: '0.25rem' }}>Market {idx + 1}: {market.label}</h4>
                <span style={{ color: '#64748b', fontSize: '0.8rem' }}>{paired.length.toLocaleString()} paired timestamps</span>
              </div>
              {subOneCount > 0 ? (
                <span style={{ background: '#22c55e20', color: '#22c55e', padding: '0.25rem 0.75rem', borderRadius: '12px', fontSize: '0.8rem', fontWeight: 600 }}>
                  {subOneCount.toLocaleString()} windows below 1.0 ({subOnePct}%)
                </span>
              ) : (
                <span style={{ background: '#64748b20', color: '#94a3b8', padding: '0.25rem 0.75rem', borderRadius: '12px', fontSize: '0.8rem' }}>
                  No sub-1.0 windows detected
                </span>
              )}
            </div>

            <svg viewBox="0 0 800 230" preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: 'auto' }}>
              <rect width="800" height="230" fill="#0f172a" rx="4" />
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
              {getDateTicks(paired).map((tick, i) => {
                const x = 50 + tick.frac * 710;
                return (
                  <g key={`dt-${i}`}>
                    <line x1={x} y1={180} x2={x} y2={185} stroke="#475569" strokeWidth="1" />
                    <text x={x} y={200} fill="#94a3b8" fontSize="9" textAnchor="middle">{tick.label}</text>
                  </g>
                );
              })}
              <polyline
                points={paired.map((p, i) => {
                  const x = 50 + (i / Math.max(paired.length - 1, 1)) * 710;
                  const y = 180 - ((p.combined - chartMin) / chartRange) * 160;
                  return `${x},${y}`;
                }).join(' ')}
                fill="none" stroke={color} strokeWidth="1.5" opacity="0.9"
              />
              {(() => {
                const oneY = 180 - ((1.0 - chartMin) / chartRange) * 160;
                return paired.filter(p => p.combined < 0.9999).map((p, i) => {
                  const idx2 = paired.indexOf(p);
                  const x = 50 + (idx2 / Math.max(paired.length - 1, 1)) * 710;
                  const y = 180 - ((p.combined - chartMin) / chartRange) * 160;
                  return <line key={i} x1={x} y1={oneY} x2={x} y2={y} stroke="#22c55e" strokeWidth="1" opacity="0.3" />;
                });
              })()}
            </svg>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.5rem', marginTop: '0.75rem' }}>
              <div className="stat"><label>Min Combined:</label><span style={{ color: minC < 0.9999 ? '#22c55e' : '#e2e8f0' }}>{minC.toFixed(4)}</span></div>
              <div className="stat"><label>Max Combined:</label><span>{maxC.toFixed(4)}</span></div>
              <div className="stat"><label>Avg Combined:</label><span style={{ color: avgC < 0.9999 ? '#22c55e' : '#e2e8f0' }}>{avgC.toFixed(4)}</span></div>
              <div className="stat"><label>Max Profit/Unit:</label><span style={{ color: minC < 0.9999 ? '#22c55e' : '#64748b' }}>{minC < 0.9999 ? `$${(1 - minC).toFixed(4)}` : 'None'}</span></div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ChartView({ marketData, paired, selectedMarket, onSetMarket, asset }) {
  if (paired.length === 0) return <div className="no-data">No paired data for this selection</div>;

  return (
    <div className="chart-container">
      <div className="chart-header">
        <h3>YES / NO Prices - {asset}</h3>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <select
            value={selectedMarket}
            onChange={(e) => onSetMarket(e.target.value)}
            style={{ background: '#334155', color: '#e2e8f0', border: '1px solid #475569', borderRadius: '6px', padding: '0.3rem 0.5rem', fontSize: '0.85rem' }}
          >
            <option value="all">All Markets</option>
            {marketData.marketIds.map((mid, i) => (
              <option key={mid} value={mid}>Market {i + 1}: {mid.substring(0, 12)}...</option>
            ))}
          </select>
          <div className="chart-legend">
            <span className="legend-item"><span className="legend-color" style={{ backgroundColor: '#3b82f6' }}></span>YES</span>
            <span className="legend-item"><span className="legend-color" style={{ backgroundColor: '#ef4444' }}></span>NO</span>
          </div>
        </div>
      </div>
      <div className="chart-info">
        <div className="stat"><label>Paired Points:</label><span>{paired.length.toLocaleString()}</span></div>
        <div className="stat"><label>Time Range:</label><span>{new Date(paired[0].timestamp * 1000).toLocaleDateString('en-AU')} - {new Date(paired[paired.length - 1].timestamp * 1000).toLocaleDateString('en-AU')}</span></div>
      </div>
      <svg className="price-chart" viewBox="0 0 800 420" preserveAspectRatio="xMidYMid meet">
        <rect width="800" height="420" fill="#1e293b" />
        {[0, 0.25, 0.5, 0.75, 1.0].map((y, i) => (
          <g key={i}>
            <line x1="50" y1={50 + (1 - y) * 300} x2="750" y2={50 + (1 - y) * 300} stroke="#334155" strokeWidth="1" />
            <text x="35" y={50 + (1 - y) * 300 + 5} fill="#94a3b8" fontSize="12" textAnchor="end">{(y * 100).toFixed(0)}%</text>
          </g>
        ))}
        {getDateTicks(paired, 8).map((tick, i) => {
          const x = 50 + tick.frac * 700;
          return (
            <g key={`dt-${i}`}>
              <line x1={x} y1={350} x2={x} y2={356} stroke="#475569" strokeWidth="1" />
              <text x={x} y={372} fill="#94a3b8" fontSize="10" textAnchor="middle">{tick.label}</text>
            </g>
          );
        })}
        <polyline
          points={paired.map((p, i) => `${50 + (i / Math.max(paired.length - 1, 1)) * 700},${350 - (p.yes * 300)}`).join(' ')}
          fill="none" stroke="#3b82f6" strokeWidth="2"
        />
        <polyline
          points={paired.map((p, i) => `${50 + (i / Math.max(paired.length - 1, 1)) * 700},${350 - (p.no * 300)}`).join(' ')}
          fill="none" stroke="#ef4444" strokeWidth="2"
        />
        <text x="20" y="200" fill="#94a3b8" fontSize="14" textAnchor="middle" transform="rotate(-90, 20, 200)">Price</text>
      </svg>
    </div>
  );
}

function RawDataView({ paired, marketData, selectedMarket, onSetMarket, onExportCSV }) {
  if (paired.length === 0) return <div className="no-data">No paired data for this selection</div>;

  return (
    <div className="raw-data-container">
      <div className="raw-data-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
        <h3>Paired Data ({paired.length.toLocaleString()} records)</h3>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <select
            value={selectedMarket}
            onChange={(e) => onSetMarket(e.target.value)}
            style={{ background: '#334155', color: '#e2e8f0', border: '1px solid #475569', borderRadius: '6px', padding: '0.3rem 0.5rem', fontSize: '0.85rem' }}
          >
            <option value="all">All Markets</option>
            {marketData.marketIds.map((mid, i) => (<option key={mid} value={mid}>Market {i + 1}</option>))}
          </select>
          <button onClick={onExportCSV} className="btn btn-sm">Download CSV</button>
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
              const isArb = row.combined < 0.9999;
              return (
                <tr key={i} style={isArb ? { background: '#22c55e10' } : {}}>
                  <td>{new Date(row.timestamp * 1000).toLocaleString('en-AU')}</td>
                  <td style={{ color: '#3b82f6' }}>{row.yes.toFixed(4)}</td>
                  <td style={{ color: '#ef4444' }}>{row.no.toFixed(4)}</td>
                  <td style={{ color: isArb ? '#22c55e' : '#e2e8f0', fontWeight: isArb ? 600 : 400 }}>{row.combined.toFixed(4)}</td>
                  <td>{isArb ? <span className="badge badge-success">+${(1 - row.combined).toFixed(4)}</span> : <span style={{ color: '#64748b' }}>-</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {paired.length > 200 && <div className="table-footer">Showing first 200 of {paired.length.toLocaleString()} records. Download CSV for full data.</div>}
      </div>
    </div>
  );
}

export default DataDownload;
