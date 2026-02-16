import React, { useState, useEffect } from 'react';

function BacktestRunsTable({ refreshTrigger, onRowClick, onCompare }) {
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState([]);
  const [sortField, setSortField] = useState('created_at');
  const [sortDirection, setSortDirection] = useState('desc');

  useEffect(() => {
    fetchRuns();
    const interval = setInterval(fetchRuns, 3000); // Poll every 3 seconds
    return () => clearInterval(interval);
  }, [refreshTrigger]);

  const fetchRuns = async () => {
    try {
      const response = await fetch('/api/backtests');
      const data = await response.json();
      setRuns(data);
      setLoading(false);
    } catch (error) {
      console.error('Error fetching runs:', error);
      setLoading(false);
    }
  };

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const handleSelectToggle = (id, e) => {
    e.stopPropagation();
    setSelectedIds(prev => {
      if (prev.includes(id)) {
        return prev.filter(item => item !== id);
      } else {
        return [...prev, id];
      }
    });
  };

  const handleDelete = async (id, e) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this backtest?')) {
      return;
    }

    try {
      await fetch(`/api/backtests/${id}`, { method: 'DELETE' });
      fetchRuns();
    } catch (error) {
      console.error('Error deleting backtest:', error);
    }
  };

  const sortedRuns = [...runs].sort((a, b) => {
    const aVal = a[sortField];
    const bVal = b[sortField];

    if (aVal === null || aVal === undefined) return 1;
    if (bVal === null || bVal === undefined) return -1;

    const direction = sortDirection === 'asc' ? 1 : -1;
    return aVal > bVal ? direction : -direction;
  });

  const formatDate = (timestamp) => {
    if (!timestamp) return '-';
    return new Date(timestamp * 1000).toLocaleString('en-AU');
  };

  const formatPercent = (value) => {
    if (value === null || value === undefined) return '-';
    return `${value.toFixed(2)}%`;
  };

  const getStatusBadge = (status) => {
    return <span className={`status-badge status-${status}`}>{status}</span>;
  };

  if (loading) {
    return (
      <div className="card">
        <div className="loading">Loading backtests...</div>
      </div>
    );
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h2>Backtest Runs</h2>
        {selectedIds.length >= 2 && (
          <button
            className="btn btn-sm"
            onClick={() => onCompare(selectedIds)}
          >
            Compare Selected ({selectedIds.length})
          </button>
        )}
      </div>

      {runs.length === 0 ? (
        <div className="empty-state">
          <h3>No backtests yet</h3>
          <p>Create your first backtest above</p>
        </div>
      ) : (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th style={{ width: '40px' }}>
                  <input type="checkbox" disabled />
                </th>
                <th onClick={() => handleSort('name')} style={{ cursor: 'pointer' }}>
                  Name {sortField === 'name' && (sortDirection === 'asc' ? '↑' : '↓')}
                </th>
                <th onClick={() => handleSort('asset')} style={{ cursor: 'pointer' }}>
                  Asset {sortField === 'asset' && (sortDirection === 'asc' ? '↑' : '↓')}
                </th>
                <th onClick={() => handleSort('timeframe')} style={{ cursor: 'pointer' }}>
                  Timeframe {sortField === 'timeframe' && (sortDirection === 'asc' ? '↑' : '↓')}
                </th>
                <th onClick={() => handleSort('period')} style={{ cursor: 'pointer' }}>
                  Period {sortField === 'period' && (sortDirection === 'asc' ? '↑' : '↓')}
                </th>
                <th onClick={() => handleSort('status')} style={{ cursor: 'pointer' }}>
                  Status {sortField === 'status' && (sortDirection === 'asc' ? '↑' : '↓')}
                </th>
                <th onClick={() => handleSort('windows_detected')} style={{ cursor: 'pointer' }}>
                  Windows {sortField === 'windows_detected' && (sortDirection === 'asc' ? '↑' : '↓')}
                </th>
                <th onClick={() => handleSort('fill_success_rate')} style={{ cursor: 'pointer' }}>
                  Fill Rate {sortField === 'fill_success_rate' && (sortDirection === 'asc' ? '↑' : '↓')}
                </th>
                <th onClick={() => handleSort('avg_execution_adjusted_edge')} style={{ cursor: 'pointer' }}>
                  Avg Edge {sortField === 'avg_execution_adjusted_edge' && (sortDirection === 'asc' ? '↑' : '↓')}
                </th>
                <th onClick={() => handleSort('created_at')} style={{ cursor: 'pointer' }}>
                  Created {sortField === 'created_at' && (sortDirection === 'asc' ? '↑' : '↓')}
                </th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedRuns.map(run => (
                <tr key={run.id} onClick={() => onRowClick(run.id)}>
                  <td onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(run.id)}
                      onChange={(e) => handleSelectToggle(run.id, e)}
                    />
                  </td>
                  <td>{run.name}</td>
                  <td>{run.asset}</td>
                  <td>{run.timeframe}</td>
                  <td>{run.period}</td>
                  <td>
                    {getStatusBadge(run.status)}
                    {run.status === 'running' && (
                      <div className="progress-bar">
                        <div className="progress-fill" style={{ width: `${run.progress_pct}%` }} />
                      </div>
                    )}
                  </td>
                  <td>{run.windows_detected || '-'}</td>
                  <td>{formatPercent(run.fill_success_rate)}</td>
                  <td>{formatPercent(run.avg_execution_adjusted_edge)}</td>
                  <td style={{ fontSize: '0.875rem' }}>{formatDate(run.created_at)}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <button
                      className="btn btn-sm btn-danger"
                      onClick={(e) => handleDelete(run.id, e)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default BacktestRunsTable;
