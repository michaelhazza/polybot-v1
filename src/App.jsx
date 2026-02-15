import React, { useState } from 'react';
import BacktestConfigForm from './components/BacktestConfigForm';
import BacktestRunsTable from './components/BacktestRunsTable';
import RunDetail from './components/RunDetail';
import RunComparison from './components/RunComparison';

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
      </div>
    </div>
  );
}

export default App;
