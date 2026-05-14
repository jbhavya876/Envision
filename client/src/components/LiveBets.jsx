import React, { useState, useEffect, useRef } from 'react';

function LiveBets({ socket }) {
  const [bets, setBets] = useState([]);

  useEffect(() => {
    if (!socket) return;
    const handlePublicBet = (data) => {
      setBets(prev => [data, ...prev].slice(0, 50)); // keep last 50
    };
    socket.on('public_bet', handlePublicBet);
    return () => socket.off('public_bet', handlePublicBet);
  }, [socket]);

  return (
    <div className="live-bets" style={{ background: '#1a2c38', borderRadius: '8px', padding: '15px', maxHeight: '400px', overflow: 'hidden' }}>
      <h3 style={{ margin: '0 0 10px' }}>Live Bets</h3>
      <div className="bets-list" style={{ maxHeight: '340px', overflowY: 'auto' }}>
        {bets.length === 0 ? <p>No bets yet</p> : null}
        {bets.map((bet, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid #2f4553', fontSize: '0.9rem' }}>
            <span>{bet.username}</span>
            <span>{bet.condition} {bet.target}</span>
            <span style={{ color: bet.isWin ? '#00ff88' : '#ff4d4d' }}>
              {bet.isWin ? '+' : ''}{(bet.profit / 100).toFixed(2)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default LiveBets;