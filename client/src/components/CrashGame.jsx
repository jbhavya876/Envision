import React, { useState, useEffect } from 'react';

function CrashGame({ socket, balance, onResult }) {
  const [betAmount, setBetAmount] = useState('10');
  const [clientSeed, setClientSeed] = useState('crash_seed');
  const [gameId, setGameId] = useState(null);
  const [multiplier, setMultiplier] = useState(1);
  const [crashed, setCrashed] = useState(false);
  const [result, setResult] = useState(null);
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    if (!socket) return;
    socket.on('crash:multiplier', (data) => {
      setMultiplier(data.multiplier);
      setCrashed(data.crashed);
    });
    socket.on('crash:result', (data) => {
      setResult(data);
      setIsRunning(false);
      if (onResult) onResult(data);
    });
    return () => {
      socket.off('crash:multiplier');
      socket.off('crash:result');
    };
  }, [socket, onResult]);

  const startGame = async () => {
    setResult(null);
    setCrashed(false);
    setMultiplier(1);
    setIsRunning(true);
    const res = await fetch('/api/crash/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ betAmount: parseFloat(betAmount), clientSeed }),
    });
    if (res.ok) {
      const data = await res.json();
      setGameId(data.gameId);
    } else {
      setIsRunning(false);
    }
  };

  const cashOut = async () => {
    if (!gameId) return;
    const res = await fetch('/api/crash/cashout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ gameId }),
    });
    if (res.ok) {
      const data = await res.json();
      setResult({ win: true, multiplier: data.cashoutMultiplier, profit: data.profit });
      setIsRunning(false);
    } else {
      // Crash already
    }
  };

  return (
    <div style={{ background: '#1a2c38', padding: '20px', borderRadius: '8px', color: '#fff' }}>
      <h3>🚀 Crash</h3>
      {result && <p>{result.win ? `Cashed out at ${result.multiplier}x! Profit: $${(result.profit / 100).toFixed(2)}` : `Crashed at ${result.crashPoint}x`}</p>}
      {isRunning ? (
        <div>
          <h1 style={{ fontSize: '3rem', color: crashed ? '#ff4d4d' : '#00ff88' }}>{multiplier.toFixed(2)}x</h1>
          {!crashed && <button onClick={cashOut}>Cash Out</button>}
        </div>
      ) : (
        <div>
          <label>Bet Amount</label>
          <input type="number" value={betAmount} onChange={e => setBetAmount(e.target.value)} />
          <label>Client Seed</label>
          <input type="text" value={clientSeed} onChange={e => setClientSeed(e.target.value)} />
          <button onClick={startGame}>Start</button>
        </div>
      )}
    </div>
  );
}

export default CrashGame;