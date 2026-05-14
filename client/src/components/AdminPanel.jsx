import React, { useState, useEffect } from 'react';
import { authenticatedFetch } from '../App';

function AdminPanel() {
  const [deposits, setDeposits] = useState([]);
  const [withdrawals, setWithdrawals] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    setLoading(true);
    try {
      const dRes = await authenticatedFetch('/api/admin/deposits');
      const wRes = await authenticatedFetch('/api/admin/withdrawals');
      if (dRes.ok) setDeposits(await dRes.json());
      if (wRes.ok) setWithdrawals(await wRes.json());
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const handleConfirmDeposit = async (id) => {
    await authenticatedFetch('/api/admin/deposit/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ depositId: id }),
    });
    fetchData();
  };

  const handleRejectDeposit = async (id) => {
    await authenticatedFetch('/api/admin/deposit/reject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ depositId: id }),
    });
    fetchData();
  };

  const handleApproveWithdrawal = async (id) => {
    await authenticatedFetch('/api/admin/withdraw/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ withdrawalId: id }),
    });
    fetchData();
  };

  const handleRejectWithdrawal = async (id) => {
    await authenticatedFetch('/api/admin/withdraw/reject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ withdrawalId: id }),
    });
    fetchData();
  };

  return (
    <div style={{ background: '#1a2c38', padding: '20px', borderRadius: '8px', marginBottom: '20px' }}>
      <h2>Admin Panel</h2>
      <div style={{ display: 'flex', gap: '20px' }}>
        <div style={{ flex: 1 }}>
          <h3>Pending Deposits</h3>
          {loading ? <p>Loading...</p> : (
            <ul>
              {deposits.map(d => (
                <li key={d.id}>
                  User {d.user_id}: ${d.amount / 100} - {d.status}
                  <button onClick={() => handleConfirmDeposit(d.id)}>Confirm</button>
                  <button onClick={() => handleRejectDeposit(d.id)}>Reject</button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div style={{ flex: 1 }}>
          <h3>Pending Withdrawals</h3>
          {loading ? <p>Loading...</p> : (
            <ul>
              {withdrawals.map(w => (
                <li key={w.id}>
                  User {w.user_id}: ${w.amount / 100} to {w.wallet_address} - {w.status}
                  <button onClick={() => handleApproveWithdrawal(w.id)}>Approve</button>
                  <button onClick={() => handleRejectWithdrawal(w.id)}>Reject</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

export default AdminPanel;