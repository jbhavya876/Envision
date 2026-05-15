import React, { useState, useEffect } from 'react';

function MinesGame({ socket, onResult }) {
  const [betAmount, setBetAmount] = useState('10');
  const [clientSeed, setClientSeed] = useState('mines_seed');
  const [minesCount, setMinesCount] = useState(3);
  const [gameId, setGameId] = useState(null);
  const [grid, setGrid] = useState(Array(25).fill(null)); // null = unrevealed, 'gem' or 'mine'
  const [multiplier, setMultiplier] = useState(1);
  const [gameOver, setGameOver] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!socket) return;
    socket.on('mines:result', (data) => {
      setResult(data);
    });
    return () => socket.off('mines:result');
  }, [socket]);

  const startGame = async () => {
    setResult(null);
    setGameOver(false);
    setGrid(Array(25).fill(null));
    setMultiplier(1);
    const res = await fetch('/api/mines/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ betAmount: parseFloat(betAmount), clientSeed, minesCount }),
    });
    if (res.ok) {
      const data = await res.json();
      setGameId(data.gameId);
    }
  };

  const revealTile = async (index) => {
    if (gameOver || grid[index] !== null || !gameId) return;
    const res = await fetch('/api/mines/reveal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ gameId, tileIndex: index }),
    });
    if (!res.ok) return;
    const data = await res.json();
    const newGrid = [...grid];
    if (data.gameOver) {
      // Reveal all mines
      data.mines.forEach(i => { newGrid[i] = 'mine'; });
      data.revealed.forEach(i => { if (newGrid[i] !== 'mine') newGrid[i] = 'gem'; });
      setGrid(newGrid);
      setGameOver(true);
    } else {
      newGrid[index] = 'gem';
      setGrid(newGrid);
      setMultiplier(data.multiplier);
    }
  };

  const cashout = async () => {
    if (!gameId) return;
    const res = await fetch('/api/mines/cashout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ gameId }),
    });
    if (res.ok) {
      const data = await res.json();
      setResult({ win: true, profit: data.profit, multiplier: data.multiplier });
      setGameOver(true);
      if (onResult) onResult({ win: true, profit: data.profit });
    }
  };

  return (
    <div style={{ background: '#1a2c38', padding: '20px', borderRadius: '8px', color: '#fff' }}>
      <h3>💣 Mines</h3>
      {result && <p>{result.win ? `Cashed out at ${result.multiplier}x! Profit: $${(result.profit / 100).toFixed(2)}` : 'You lost'}</p>}
      {!gameId ? (
        <div>
          <label>Bet Amount</label>
          <input type="number" value={betAmount} onChange={e => setBetAmount(e.target.value)} />
          <label>Client Seed</label>
          <input type="text" value={clientSeed} onChange={e => setClientSeed(e.target.value)} />
          <label>Mines (3)</label>
          <input type="number" value={minesCount} onChange={e => setMinesCount(parseInt(e.target.value))} min="1" max="24" />
          <button onClick={startGame}>Start</button>
        </div>
      ) : (
        <div>
          <p>Multiplier: {multiplier}x</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 50px)', gap: '5px' }}>
            {grid.map((tile, i) => (
              <div key={i}
                onClick={() => revealTile(i)}
                style={{
                  width: '50px', height: '50px', background: tile === 'gem' ? '#00ff88' : tile === 'mine' ? '#ff4d4d' : '#2f4553',
                  borderRadius: '5px', cursor: tile ? 'default' : 'pointer'
                }}
              >
                {tile === 'gem' ? '💎' : tile === 'mine' ? '💣' : ''}
              </div>
            ))}
          </div>
          {!gameOver && <button onClick={cashout} style={{ marginTop: '10px' }}>Cash Out</button>}
        </div>
      )}
    </div>
  );
}

export default MinesGame;