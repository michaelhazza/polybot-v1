import React, { useState } from 'react';

function BacktestConfigForm({ onBacktestCreated }) {
  const [formData, setFormData] = useState({
    asset: 'BTC',
    timeframe: '15min',
    period: '30d',
    tradeSize: 25
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: name === 'tradeSize' ? parseFloat(value) : value
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/backtests', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(formData)
      });

      if (!response.ok) {
        throw new Error('Failed to create backtest');
      }

      const result = await response.json();
      console.log('Backtest created:', result);

      // Reset form
      setFormData({
        asset: 'BTC',
        timeframe: '15min',
        period: '30d',
        tradeSize: 25
      });

      // Notify parent
      onBacktestCreated();

    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card">
      <h2>Create Backtest</h2>

      <form onSubmit={handleSubmit}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
          <div className="form-group">
            <label htmlFor="asset">Asset</label>
            <select
              id="asset"
              name="asset"
              value={formData.asset}
              onChange={handleChange}
              required
            >
              <option value="BTC">Bitcoin (BTC)</option>
              <option value="ETH">Ethereum (ETH)</option>
              <option value="SOL">Solana (SOL)</option>
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="timeframe">Timeframe</label>
            <select
              id="timeframe"
              name="timeframe"
              value={formData.timeframe}
              onChange={handleChange}
              required
            >
              <option value="5min">5 minutes</option>
              <option value="15min">15 minutes</option>
              <option value="1hr">1 hour</option>
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="period">Period</label>
            <select
              id="period"
              name="period"
              value={formData.period}
              onChange={handleChange}
              required
            >
              <option value="30d">30 days</option>
              <option value="60d">60 days</option>
              <option value="3m">3 months</option>
              <option value="6m">6 months</option>
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="tradeSize">Trade Size ($)</label>
            <input
              type="number"
              id="tradeSize"
              name="tradeSize"
              value={formData.tradeSize}
              onChange={handleChange}
              min="5"
              max="50"
              step="5"
              required
            />
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
          {loading ? 'Creating...' : 'Run Backtest'}
        </button>
      </form>
    </div>
  );
}

export default BacktestConfigForm;
