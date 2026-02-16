import React, { useState, useEffect } from 'react';

const INTERVAL_OPTIONS = [
  { value: 0, label: 'Trade Level (raw)' },
  { value: 1, label: '1 minute' },
  { value: 2, label: '2 minutes' },
  { value: 3, label: '3 minutes' },
  { value: 5, label: '5 minutes' },
  { value: 15, label: '15 minutes' },
  { value: 60, label: '60 minutes' },
];

function Settings() {
  const [settings, setSettings] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch('/api/settings')
      .then(res => res.json())
      .then(data => setSettings(data))
      .catch(err => setError('Failed to load settings'));
  }, []);

  const handleIntervalChange = async (e) => {
    const newInterval = Number(e.target.value);
    setSettings(prev => ({ ...prev, snapshotInterval: newInterval }));
    setSaving(true);
    setSaved(false);
    setError(null);

    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshotInterval: newInterval }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save');
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (!settings) {
    return (
      <div className="card">
        <h2>Settings</h2>
        <p style={{ color: '#94a3b8' }}>Loading...</p>
      </div>
    );
  }

  const selectedOption = INTERVAL_OPTIONS.find(o => o.value === settings.snapshotInterval);

  return (
    <div className="card">
      <h2>Settings</h2>
      <p style={{ color: '#94a3b8', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
        Configure data download and processing parameters.
      </p>

      <div className="settings-section">
        <h3 style={{ fontSize: '1rem', color: '#e2e8f0', marginBottom: '1rem' }}>
          Data Download Interval
        </h3>

        <div className="form-group">
          <label>Snapshot Interval</label>
          <select
            value={settings.snapshotInterval}
            onChange={handleIntervalChange}
            disabled={saving}
          >
            {INTERVAL_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        <div style={{
          background: '#0f172a',
          border: '1px solid #334155',
          borderRadius: '6px',
          padding: '1rem',
          marginTop: '0.5rem',
          fontSize: '0.85rem',
          color: '#94a3b8',
        }}>
          <p style={{ marginBottom: '0.5rem' }}>
            <strong style={{ color: '#cbd5e1' }}>Current:</strong>{' '}
            {selectedOption?.label || `${settings.snapshotInterval} min`}
          </p>
          <p>
            {settings.snapshotInterval === 0
              ? 'Every individual trade is saved as a separate data point. Provides maximum granularity but uses more storage.'
              : `Trades are aggregated into ${settings.snapshotInterval}-minute buckets. Prices within each bucket are averaged.`}
          </p>
          <p style={{ marginTop: '0.5rem', color: '#f59e0b', fontSize: '0.8rem' }}>
            Changes apply to new downloads only. Existing data is not affected.
          </p>
        </div>

        {saving && (
          <p style={{ marginTop: '0.75rem', color: '#60a5fa', fontSize: '0.85rem' }}>
            Saving...
          </p>
        )}
        {saved && (
          <p style={{ marginTop: '0.75rem', color: '#34d399', fontSize: '0.85rem' }}>
            Settings saved.
          </p>
        )}
        {error && (
          <p style={{ marginTop: '0.75rem', color: '#f87171', fontSize: '0.85rem' }}>
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

export default Settings;
