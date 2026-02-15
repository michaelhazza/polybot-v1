import React, { useState, useEffect } from 'react';

function RunComparison({ runIds, onBack }) {
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchRuns();
  }, [runIds]);

  const fetchRuns = async () => {
    try {
      const promises = runIds.map(id =>
        fetch(`/api/backtests/${id}`).then(r => r.json())
      );
      const results = await Promise.all(promises);
      setRuns(results);
      setLoading(false);
    } catch (error) {
      console.error('Error fetching runs for comparison:', error);
      setLoading(false);
    }
  };

  const formatPercent = (value) => {
    if (value === null || value === undefined) return '-';
    return `${value.toFixed(2)}%`;
  };

  const getMetricStatus = (metric, value) => {
    const thresholds = {
      windows_per_analysis_hour: 0.1,
      duration_p50: 10,
      fill_success_rate: 20,
      avg_execution_adjusted_edge: 0.5,
      data_coverage_pct: 90
    };

    const threshold = thresholds[metric];
    if (threshold === undefined) return '';

    return value >= threshold ? 'metric-success' : 'metric-danger';
  };

  if (loading) {
    return (
      <div className="card">
        <div className="loading">Loading comparison...</div>
      </div>
    );
  }

  const metrics = [
    { key: 'windows_per_analysis_hour', label: 'Windows per Hour', format: (v) => v?.toFixed(2) || '-', threshold: '≥0.1' },
    { key: 'duration_p50', label: 'Median Duration (s)', format: (v) => v?.toFixed(1) || '-', threshold: '≥10s' },
    { key: 'fill_success_rate', label: 'Fill Success Rate', format: formatPercent, threshold: '≥20%' },
    { key: 'avg_execution_adjusted_edge', label: 'Avg Edge', format: formatPercent, threshold: '≥0.5%' },
    { key: 'data_coverage_pct', label: 'Data Coverage', format: formatPercent, threshold: '≥90%' },
    { key: 'windows_detected', label: 'Windows Detected', format: (v) => v || '-', threshold: '-' },
    { key: 'trades_completed', label: 'Trades Completed', format: (v) => v || '-', threshold: '-' }
  ];

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h2>Run Comparison</h2>
        <button className="btn btn-secondary" onClick={onBack}>
          Back to Runs
        </button>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th style={{ position: 'sticky', left: 0, background: '#0f172a', zIndex: 1 }}>
                Metric
              </th>
              {runs.map((data, idx) => (
                <th key={idx}>
                  <div>{data.run.name}</div>
                  <div style={{ fontSize: '0.75rem', fontWeight: 'normal', color: '#64748b', marginTop: '0.25rem' }}>
                    {data.run.asset} • {data.run.timeframe} • {data.run.period}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {metrics.map(metric => (
              <tr key={metric.key}>
                <td style={{ position: 'sticky', left: 0, background: '#1e293b', fontWeight: '600' }}>
                  <div>{metric.label}</div>
                  {metric.threshold !== '-' && (
                    <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.25rem' }}>
                      Target: {metric.threshold}
                    </div>
                  )}
                </td>
                {runs.map((data, idx) => {
                  const value = data.run[metric.key];
                  const status = getMetricStatus(metric.key, value);

                  return (
                    <td key={idx}>
                      <span className={status} style={{ fontWeight: '600' }}>
                        {metric.format(value)}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: '2rem' }}>
        <h3 style={{ marginBottom: '1rem', color: '#cbd5e1' }}>Summary</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1rem' }}>
          {runs.map((data, idx) => {
            const totalProfit = data.trades
              .filter(t => t.result === 'completed')
              .reduce((sum, t) => sum + t.profit, 0);

            const passedMetrics = [
              data.run.windows_per_analysis_hour >= 0.1,
              data.run.duration_p50 >= 10,
              data.run.fill_success_rate >= 20,
              data.run.avg_execution_adjusted_edge >= 0.5,
              data.run.data_coverage_pct >= 90
            ].filter(Boolean).length;

            const allPassed = passedMetrics === 5;

            return (
              <div key={idx} className="metric-card">
                <h4 style={{ marginBottom: '0.75rem', color: '#f1f5f9' }}>
                  {data.run.name}
                </h4>
                <div style={{ marginBottom: '0.5rem' }}>
                  <span className="metric-label">Total Profit:</span>
                  <span className={totalProfit > 0 ? 'metric-success' : 'metric-danger'} style={{ marginLeft: '0.5rem', fontWeight: '600' }}>
                    ${totalProfit.toFixed(2)}
                  </span>
                </div>
                <div style={{ marginBottom: '0.5rem' }}>
                  <span className="metric-label">Metrics Passed:</span>
                  <span className={allPassed ? 'metric-success' : 'metric-warning'} style={{ marginLeft: '0.5rem', fontWeight: '600' }}>
                    {passedMetrics}/5
                  </span>
                </div>
                <div>
                  <span className={`status-badge status-${allPassed ? 'completed' : 'failed'}`}>
                    {allPassed ? 'GO' : 'NO-GO'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default RunComparison;
