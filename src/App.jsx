import React, { useState } from 'react';
import BacktestConfigForm from './components/BacktestConfigForm';
import BacktestRunsTable from './components/BacktestRunsTable';
import RunDetail from './components/RunDetail';
import RunComparison from './components/RunComparison';
import DataDownload from './components/DataDownload';
import Settings from './components/Settings';

function App() {
  const [activeView, setActiveView] = useState('runs');
  const [selectedRunId, setSelectedRunId] = useState(null);
  const [selectedRunIds, setSelectedRunIds] = useState([]);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const handleBacktestCreated = () => {
    setRefreshTrigger(prev => prev + 1);
    setActiveView('runs');
  };

  const handleRowClick = (runId) => {
    setSelectedRunId(runId);
    setActiveView('detail');
  };

  const handleCompare = (runIds) => {
    setSelectedRunIds(runIds);
    setActiveView('comparison');
  };

  const handleBackToRuns = () => {
    setActiveView('runs');
    setSelectedRunId(null);
    setSelectedRunIds([]);
  };

  return (
    <div className="app">
      <div className="container">
        <div className="header">
          <h1>Polymarket Arbitrage MVP</h1>
          <p>Phase 1A - Backtest Management System</p>
        </div>

        <div className="nav-tabs">
          <button
            className={`nav-tab ${activeView === 'runs' || activeView === 'detail' || activeView === 'comparison' ? 'active' : ''}`}
            onClick={() => setActiveView('runs')}
          >
            Backtests
          </button>
          <button
            className={`nav-tab ${activeView === 'data-download' ? 'active' : ''}`}
            onClick={() => setActiveView('data-download')}
          >
            Data Download
          </button>
          <button
            className={`nav-tab ${activeView === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveView('settings')}
          >
            Settings
          </button>
        </div>

        {activeView === 'runs' && (
          <>
            <BacktestConfigForm onBacktestCreated={handleBacktestCreated} />
            <BacktestRunsTable
              refreshTrigger={refreshTrigger}
              onRowClick={handleRowClick}
              onCompare={handleCompare}
            />
          </>
        )}

        {activeView === 'detail' && selectedRunId && (
          <RunDetail runId={selectedRunId} onBack={handleBackToRuns} />
        )}

        {activeView === 'comparison' && selectedRunIds.length > 0 && (
          <RunComparison runIds={selectedRunIds} onBack={handleBackToRuns} />
        )}

        {activeView === 'data-download' && (
          <DataDownload />
        )}

        {activeView === 'settings' && (
          <Settings />
        )}
      </div>
    </div>
  );
}

export default App;
