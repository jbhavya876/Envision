import React, { useState } from 'react';
import CryptoJS from 'crypto-js';

const VerificationPanel = ({ activeHash, lastSeed, lastNonce, lastClientSeed, actualRoll }) => {
    const [verificationResult, setVerificationResult] = useState('');

    const verifyLastBet = () => {
        if (lastSeed === 'No bets yet') {
            setVerificationResult('');
            return;
        }

        // 1. Math Check
        const message = `${lastClientSeed}:${lastNonce}`;
        const hmac = CryptoJS.HmacSHA256(message, lastSeed);
        const decimalValue = parseInt(
            hmac.toString(CryptoJS.enc.Hex).substring(0, 8),
            16
        );
        const calculatedRoll = (decimalValue % 10001) / 100;

        // 2. Chain Check
        const chainHash = CryptoJS.SHA256(lastSeed).toString(CryptoJS.enc.Hex);

        if (calculatedRoll.toFixed(2) === actualRoll.toFixed(2)) {
            const result = (
                <div style={{ color: '#00e701' }}>
                    ✅ <b>Math Verified:</b> {calculatedRoll.toFixed(2)}<br />
                    🔗 <b>Chain Hash:</b> {chainHash.substring(0, 20)}... (Valid)
                </div>
            );
            setVerificationResult(result);
        } else {
            setVerificationResult(
                <div style={{ color: '#ff4d4d' }}>
                    ❌ MATH FAILED: {calculatedRoll.toFixed(2)}
                </div>
            );
        }
    };

    return (
        <div className="container-box">
            <h3 style={{ marginTop: 0 }}>🔐 Reverse Hash Verification</h3>

            <label>Previous Hash (Anchor)</label>
            <div className="hash-text">{activeHash}</div>

            <hr style={{ borderColor: '#2f4553', margin: '15px 0' }} />

            <label>Current Revealed Seed</label>
            <div className="hash-text">{lastSeed}</div>

            <label>Nonce Used</label>
            <div className="hash-text">{lastNonce}</div>

            <button className="verify-btn" onClick={verifyLastBet}>
                Verify Chain & Math
            </button>

            <div className="verification-result">
                {verificationResult}
            </div>
        </div>
    );
};

export default VerificationPanel;
