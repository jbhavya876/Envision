import React, { useState, useEffect, useCallback } from 'react';
import { authenticatedFetch } from '../App';

function Leaderboard() {
  const [period, setPeriod] = useState('daily');
  const [data, setData] = useState([]);

  const fetchLeaderboard = useCallback(async () => {
    try {
      const res = await authenticatedFetch(`/api/leaderboard?period=${period}`);
      if (res.ok) setData(await res.json());
    } catch (e) { console.error(e); }
  }, [period]);

  useEffect(() => { fetchLeaderboard(); }, [fetchLeaderboard]);

  return (
    <div style={{ background: '#1a2c38', borderRadius: '8px', padding: '15px', flex: 1 }}>
      <h3>Leaderboard</h3>
      <div style={{ display: 'flex', gap: '5px', marginBottom: '10px' }}>
        {['daily', 'weekly', 'alltime'].map(p => (
          <button key={p}
            onClick={() => setPeriod(p)}
            style={{ background: period === p ? '#00ff88' : '#2f4553', color: period === p ? '#000' : '#fff', border: 'none', padding: '5px 10px', borderRadius: '4px', cursor: 'pointer' }}>
            {p.charAt(0).toUpperCase() + p.slice(1)}
          </button>
        ))}
      </div>
      <table style={{ width: '100%', fontSize: '0.9rem' }}>
        <thead>
          <tr>
            <th>#</th><th>Player</th><th>Wagered</th><th>Profit</th>
          </tr>
        </thead>
        <tbody>
          {data.map(row => (
            <tr key={row.rank}>
              <td>{row.rank}</td>
              <td>{row.maskedUsername}</td>
              <td>${(row.wagered / 100).toFixed(2)}</td>
              <td style={{ color: row.profit >= 0 ? '#00ff88' : '#ff4d4d' }}>
                ${(row.profit / 100).toFixed(2)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default Leaderboard;