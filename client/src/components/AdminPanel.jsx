import React, { useState, useEffect, useCallback } from 'react';
import { authenticatedFetch } from '../App';

function AdminPanel() {
  const [activeTab, setActiveTab] = useState('overview');

  // Stats
  const [stats, setStats] = useState(null);

  // User search
  const [searchQuery, setSearchQuery] = useState('');
  const [foundUser, setFoundUser] = useState(null);
  const [adjustAmount, setAdjustAmount] = useState('');

  // Money (deposits/withdrawals)
  const [deposits, setDeposits] = useState([]);
  const [withdrawals, setWithdrawals] = useState([]);

  // Bets
  const [bets, setBets] = useState([]);

  // Fetch functions
  const fetchStats = useCallback(async () => {
    try {
      const res = await authenticatedFetch('/api/admin/stats');
      if (res.ok) setStats(await res.json());
    } catch (e) { console.error(e); }
  }, []);

  const fetchMoney = useCallback(async () => {
    try {
      const [dRes, wRes] = await Promise.all([
        authenticatedFetch('/api/admin/deposits'),
        authenticatedFetch('/api/admin/withdrawals')
      ]);
      if (dRes.ok) setDeposits(await dRes.json());
      if (wRes.ok) setWithdrawals(await wRes.json());
    } catch (e) { console.error(e); }
  }, []);

  const fetchBets = useCallback(async () => {
    try {
      const res = await authenticatedFetch('/api/admin/bets?limit=100');
      if (res.ok) setBets(await res.json());
    } catch (e) { console.error(e); }
  }, []);

  const handleSearch = async (e) => {
    e.preventDefault();
    try {
      const res = await authenticatedFetch(`/api/admin/user/search?username=${encodeURIComponent(searchQuery)}`);
      if (res.ok) setFoundUser(await res.json());
      else setFoundUser({ error: 'User not found' });
    } catch (e) { console.error(e); }
  };

  const handleAdjustBalance = async (userId) => {
    if (!adjustAmount) return;
    try {
      await authenticatedFetch('/api/admin/user/adjust-balance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, amount: adjustAmount })
      });
      setAdjustAmount('');
      // Re‑fetch user
      const res = await authenticatedFetch(`/api/admin/user/search?username=${searchQuery}`);
      if (res.ok) setFoundUser(await res.json());
    } catch (e) { console.error(e); }
  };

  const handleRotateSeed = async (userId) => {
    try {
      await authenticatedFetch('/api/admin/user/rotate-seed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
      });
      // Re‑fetch user
      const res = await authenticatedFetch(`/api/admin/user/search?username=${searchQuery}`);
      if (res.ok) setFoundUser(await res.json());
    } catch (e) { console.error(e); }
  };

  const handleConfirmDeposit = async (id) => {
    await authenticatedFetch('/api/admin/deposit/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ depositId: id })
    });
    fetchMoney();
  };

  const handleRejectDeposit = async (id) => {
    await authenticatedFetch('/api/admin/deposit/reject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ depositId: id })
    });
    fetchMoney();
  };

  const handleApproveWithdraw = async (id) => {
    await authenticatedFetch('/api/admin/withdraw/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ withdrawalId: id })
    });
    fetchMoney();
  };

  const handleRejectWithdraw = async (id) => {
    await authenticatedFetch('/api/admin/withdraw/reject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ withdrawalId: id })
    });
    fetchMoney();
  };

  useEffect(() => {
    fetchStats();
    fetchMoney();
    fetchBets();
  }, [fetchStats, fetchMoney, fetchBets]);

  // Tab content rendering
  const renderOverview = () => (
    <div>
      <h3>Platform Stats</h3>
      {stats ? (
        <ul>
          <li>Total Users: {stats.totalUsers}</li>
          <li>Total Bets: {stats.totalBets}</li>
          <li>Total Wagered (profit basis): ${(stats.totalWagered / 100).toFixed(2)}</li>
          <li>Platform Profit: ${(stats.platformProfit / 100).toFixed(2)}</li>
        </ul>
      ) : <p>Loading...</p>}
    </div>
  );

  const renderUsers = () => (
    <div>
      <h3>User Management</h3>
      <form onSubmit={handleSearch} style={{ marginBottom: '1rem' }}>
        <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search username" />
        <button type="submit">Search</button>
      </form>
      {foundUser && !foundUser.error ? (
        <div style={{ background: '#2a3c48', padding: '1rem', borderRadius: '8px' }}>
          <p>ID: {foundUser.id}</p>
          <p>Username: {foundUser.username}</p>
          <p>Balance: ${(foundUser.balance / 100).toFixed(2)}</p>
          <p>Nonce: {foundUser.nonce}</p>
          <p>Created: {new Date(foundUser.created_at).toLocaleString()}</p>
          <div style={{ margin: '0.5rem 0' }}>
            <input type="number" step="0.01" value={adjustAmount} onChange={e => setAdjustAmount(e.target.value)} placeholder="Amount ($)" />
            <button onClick={() => handleAdjustBalance(foundUser.id)}>Adjust Balance</button>
          </div>
          <button onClick={() => handleRotateSeed(foundUser.id)}>Rotate Server Seed</button>
        </div>
      ) : foundUser?.error ? <p>User not found</p> : null}
    </div>
  );

  const renderMoney = () => (
    <div style={{ display: 'flex', gap: '2rem' }}>
      <div>
        <h3>Pending Deposits</h3>
        {deposits.map(d => (
          <div key={d.id} style={{ border: '1px solid #3a4a55', padding: '0.5rem', margin: '0.5rem 0' }}>
            User ID: {d.user_id}<br/>
            Amount: ${(d.amount / 100).toFixed(2)}<br/>
            Address: {d.address?.substring(0,10)}...<br/>
            <button onClick={() => handleConfirmDeposit(d.id)}>Confirm</button>
            <button onClick={() => handleRejectDeposit(d.id)}>Reject</button>
          </div>
        ))}
      </div>
      <div>
        <h3>Pending Withdrawals</h3>
        {withdrawals.map(w => (
          <div key={w.id} style={{ border: '1px solid #3a4a55', padding: '0.5rem', margin: '0.5rem 0' }}>
            User ID: {w.user_id}<br/>
            Amount: ${(w.amount / 100).toFixed(2)}<br/>
            Wallet: {w.wallet_address}<br/>
            <button onClick={() => handleApproveWithdraw(w.id)}>Approve</button>
            <button onClick={() => handleRejectWithdraw(w.id)}>Reject</button>
          </div>
        ))}
      </div>
    </div>
  );

  const renderBets = () => (
    <div>
      <h3>Recent Bets</h3>
      <table style={{ width: '100%' }}>
        <thead>
          <tr>
            <th>User</th><th>Amount</th><th>Target</th><th>Result</th><th>Profit</th><th>Time</th>
          </tr>
        </thead>
        <tbody>
          {bets.map(b => (
            <tr key={b.id}>
              <td>{b.username}</td>
              <td>${(b.bet_amount / 100).toFixed(2)}</td>
              <td>{b.target}</td>
              <td>{b.roll.toFixed(2)}</td>
              <td style={{ color: b.profit >= 0 ? '#00ff88' : '#ff4d4d' }}>${(b.profit / 100).toFixed(2)}</td>
              <td>{new Date(b.created_at).toLocaleTimeString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div style={{ background: '#1a2c38', padding: '20px', borderRadius: '8px', marginBottom: '20px', color: '#fff' }}>
      <h2>Admin Panel</h2>
      <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
        {['overview', 'users', 'money', 'bets'].map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            style={{ background: activeTab === tab ? '#00ff88' : '#2f4553', color: activeTab === tab ? '#000' : '#fff', border: 'none', padding: '8px 16px', borderRadius: '4px', cursor: 'pointer' }}>
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>
      {activeTab === 'overview' && renderOverview()}
      {activeTab === 'users' && renderUsers()}
      {activeTab === 'money' && renderMoney()}
      {activeTab === 'bets' && renderBets()}
    </div>
  );
}

export default AdminPanel;