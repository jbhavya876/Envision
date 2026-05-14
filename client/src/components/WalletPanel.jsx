import React, { useState } from 'react';
import { authenticatedFetch } from '../App';

function WalletPanel() {
  const [depositAmount, setDepositAmount] = useState('');
  const [depositInfo, setDepositInfo] = useState(null);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawAddress, setWithdrawAddress] = useState('');

  const handleDeposit = async (e) => {
    e.preventDefault();
    const res = await authenticatedFetch('/api/deposit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: parseFloat(depositAmount) }),
    });
    if (res.ok) {
      const data = await res.json();
      setDepositInfo(data);
    }
  };

  const handleWithdraw = async (e) => {
    e.preventDefault();
    const res = await authenticatedFetch('/api/withdraw', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: parseFloat(withdrawAmount), walletAddress: withdrawAddress }),
    });
    if (res.ok) {
      alert('Withdrawal request submitted');
      setWithdrawAmount('');
      setWithdrawAddress('');
    }
  };

  return (
    <div style={{ background: '#1a2c38', padding: '20px', borderRadius: '8px', marginBottom: '20px' }}>
      <h3>Wallet</h3>
      <div>
        <h4>Deposit</h4>
        <form onSubmit={handleDeposit}>
          <input type="number" step="0.01" value={depositAmount} onChange={e => setDepositAmount(e.target.value)} placeholder="Amount ($)" />
          <button type="submit">Request Deposit</button>
        </form>
        {depositInfo && (
          <div>
            <p>Address: {depositInfo.address}</p>
            <p>TX Hash: {depositInfo.txHash}</p>
            <p>Status: {depositInfo.status}</p>
          </div>
        )}
      </div>
      <div>
        <h4>Withdraw</h4>
        <form onSubmit={handleWithdraw}>
          <input type="number" step="0.01" value={withdrawAmount} onChange={e => setWithdrawAmount(e.target.value)} placeholder="Amount ($)" />
          <input type="text" value={withdrawAddress} onChange={e => setWithdrawAddress(e.target.value)} placeholder="Wallet address" />
          <button type="submit">Request Withdrawal</button>
        </form>
      </div>
    </div>
  );
}

export default WalletPanel;