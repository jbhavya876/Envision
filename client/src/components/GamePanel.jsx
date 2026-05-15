import React, { useState } from 'react';

const GamePanel = ({ balance, rollResult, isWin, onPlayGame, isSystemReady, socket }) => {
    const [betAmount, setBetAmount] = useState('10.00');
    const [clientSeed, setClientSeed] = useState('luckyClientSeed123');
    const [autoBetActive, setAutoBetActive] = useState(false);
    const [stopProfit, setStopProfit] = useState('');
    const [stopLoss, setStopLoss] = useState('');
    const [maxBets, setMaxBets] = useState('');

    const houseEdge = 0.01;
    const target = 50;
    const probabilityOver = (100 - target) / 100;
    const probabilityUnder = target / 100;
    const multiplierOver = (1 - houseEdge) / probabilityOver;
    const multiplierUnder = (1 - houseEdge) / probabilityUnder;

    const handlePlay = (condition) => {
        onPlayGame(parseFloat(betAmount), clientSeed, condition);
    };

    const handleStartAutoBet = () => {
        if (!socket) return;
        const config = {
            betAmount: parseFloat(betAmount),
            condition: 'over', // you can make this a toggle later
            clientSeed,
            stopOnProfit: stopProfit ? parseFloat(stopProfit) * 100 : null, // convert to cents
            stopOnLoss: stopLoss ? parseFloat(stopLoss) * 100 : null,
            maxBets: maxBets ? parseInt(maxBets) : null
        };
        socket.emit('auto_bet:start', config);
        setAutoBetActive(true);
    };

    const handleStopAutoBet = () => {
        if (!socket) return;
        socket.emit('auto_bet:stop');
        setAutoBetActive(false);
    };

    // Listen for auto-bet stopped event
    React.useEffect(() => {
        if (!socket) return;
        const handleStopped = () => setAutoBetActive(false);
        socket.on('auto_bet:stopped', handleStopped);
        return () => socket.off('auto_bet:stopped', handleStopped);
    }, [socket]);

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
            <input type="number" value={betAmount} onChange={e => setBetAmount(e.target.value)} disabled={!isSystemReady} />
            <label>Client Seed</label>
            <input type="text" value={clientSeed} onChange={e => setClientSeed(e.target.value)} disabled={!isSystemReady} />

            <div style={{ display: 'flex', gap: '10px', margin: '10px 0' }}>
                <span>Over {target}: {multiplierOver.toFixed(4)}x</span>
                <span>Under {target}: {multiplierUnder.toFixed(4)}x</span>
            </div>

            <div className="button-group">
                <button className="btn-under" onClick={() => handlePlay('under')} disabled={!isSystemReady}>Under 50</button>
                <button className="btn-over" onClick={() => handlePlay('over')} disabled={!isSystemReady}>Over 50</button>
            </div>

            {/* Auto-bet controls */}
            <div style={{ marginTop: '15px', borderTop: '1px solid #2f4553', paddingTop: '15px' }}>
                <h4>Auto-Bet</h4>
                <label>Stop on Profit ($)</label>
                <input type="number" value={stopProfit} onChange={e => setStopProfit(e.target.value)} placeholder="e.g., 50" />
                <label>Stop on Loss ($)</label>
                <input type="number" value={stopLoss} onChange={e => setStopLoss(e.target.value)} placeholder="e.g., 25" />
                <label>Max Bets</label>
                <input type="number" value={maxBets} onChange={e => setMaxBets(e.target.value)} placeholder="e.g., 100" />
                <div style={{ marginTop: '10px' }}>
                    {autoBetActive ? (
                        <button onClick={handleStopAutoBet} style={{ background: '#ff4d4d' }}>Stop Auto-Bet</button>
                    ) : (
                        <button onClick={handleStartAutoBet} disabled={!isSystemReady}>Start Auto-Bet</button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default GamePanel;