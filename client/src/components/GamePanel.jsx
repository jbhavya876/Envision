import React, { useState } from 'react';

const GamePanel = ({ balance, rollResult, isWin, onPlayGame, isSystemReady }) => {
    const [betAmount, setBetAmount] = useState('10.00');
    const [clientSeed, setClientSeed] = useState('luckyClientSeed123');

    const handlePlay = (condition) => {
        onPlayGame(parseFloat(betAmount), clientSeed, condition);
    };

    return (
        <div className="container-box">
            <div className="game-header">
                <span className="game-title">🎲 BINARY DICE</span>
                <span className="live-badge">LIVE</span>
            </div>

            <h3>Balance: ${balance}</h3>
            <div className={`result-display ${isWin === null ? '' : isWin ? 'win' : 'loss'}`}>
                {rollResult}
            </div>

            <label>Bet Amount</label>
            <input
                type="number"
                value={betAmount}
                onChange={(e) => setBetAmount(e.target.value)}
                disabled={!isSystemReady}
            />

            <label>Client Seed</label>
            <input
                type="text"
                value={clientSeed}
                onChange={(e) => setClientSeed(e.target.value)}
                disabled={!isSystemReady}
            />

            <div className="button-group">
                <button
                    className="btn-under"
                    onClick={() => handlePlay('under')}
                    disabled={!isSystemReady}
                    style={{ opacity: isSystemReady ? 1 : 0.5, cursor: isSystemReady ? 'pointer' : 'not-allowed' }}
                >
                    {isSystemReady ? 'Under 50' : 'Loading...'}
                </button>
                <button
                    className="btn-over"
                    onClick={() => handlePlay('over')}
                    disabled={!isSystemReady}
                    style={{ opacity: isSystemReady ? 1 : 0.5, cursor: isSystemReady ? 'pointer' : 'not-allowed' }}
                >
                    {isSystemReady ? 'Over 50' : 'Loading...'}
                </button>
            </div>
        </div>
    );
};

export default GamePanel;
