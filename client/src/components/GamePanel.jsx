/**
 * @file GamePanel Component
 * @description Main betting interface for the binary dice game.
 * Allows users to set bet amount, client seed, and choose over/under 50.
 * 
 * @component
 * @param {Object} props
 * @param {string} props.balance - User's current balance
 * @param {string} props.rollResult - Last roll result (0.00-100.00)
 * @param {boolean|null} props.isWin - Whether last bet was a win
 * @param {Function} props.onPlayGame - Callback to place a bet
 * @param {boolean} props.isSystemReady - Whether Protobuf is loaded
 */

import React, { useState } from 'react';

const GamePanel = ({ balance, rollResult, isWin, onPlayGame, isSystemReady }) => {
    // Local state for bet configuration
    const [betAmount, setBetAmount] = useState('10.00');
    const [clientSeed, setClientSeed] = useState('luckyClientSeed123');

    // ========== NEW: Multiplier calculation ==========
    const houseEdge = 0.01;
    const target = 50; // static for now, later we can make it dynamic
    const probabilityOver = (100 - target) / 100;
    const probabilityUnder = target / 100;
    const multiplierOver = (1 - houseEdge) / probabilityOver;
    const multiplierUnder = (1 - houseEdge) / probabilityUnder;
    // =================================================

    /**
     * Handle bet placement
     * @param {string} condition - 'over' or 'under'
     */
    const handlePlay = (condition) => {
        onPlayGame(parseFloat(betAmount), clientSeed, condition);
    };

    return (
        <div className="container-box">
            {/* Header */}
            <div className="game-header">
                <span className="game-title">🎲 BINARY DICE</span>
                <span className="live-badge">LIVE</span>
            </div>

            {/* Balance Display */}
            <h3>Balance: ${balance}</h3>

            {/* Roll Result Display */}
            <div className={`result-display ${isWin === null ? '' : isWin ? 'win' : 'loss'}`}>
                {rollResult}
            </div>

            {/* Bet Amount Input */}
            <label>Bet Amount</label>
            <input
                type="number"
                value={betAmount}
                onChange={(e) => setBetAmount(e.target.value)}
                disabled={!isSystemReady}
            />

            {/* Client Seed Input (for provably fair randomness) */}
            <label>Client Seed</label>
            <input
                type="text"
                value={clientSeed}
                onChange={(e) => setClientSeed(e.target.value)}
                disabled={!isSystemReady}
            />
            
            {/* ========== NEW: Multiplier display ========== */}
            <div style={{ display: 'flex', gap: '10px', margin: '10px 0' }}>
                <span>Over {target}: {multiplierOver.toFixed(4)}x</span>
                <span>Under {target}: {multiplierUnder.toFixed(4)}x</span>
            </div>
            {/* ============================================= */}

            {/* Bet Buttons */}
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