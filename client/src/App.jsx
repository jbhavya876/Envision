import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import protobuf from 'protobufjs';
import BalanceChart from './components/BalanceChart';
import GamePanel from './components/GamePanel';
import VerificationPanel from './components/VerificationPanel';
import HistoryTable from './components/HistoryTable';

function App() {
    const [balance, setBalance] = useState('...');
    const [rollResult, setRollResult] = useState('0.00');
    const [isWin, setIsWin] = useState(null);
    const [activeHash, setActiveHash] = useState('Loading...');
    const [lastSeed, setLastSeed] = useState('No bets yet');
    const [lastNonce, setLastNonce] = useState('-');
    const [lastClientSeed, setLastClientSeed] = useState('');
    const [actualRoll, setActualRoll] = useState(0);
    const [history, setHistory] = useState([]);
    const [chartData, setChartData] = useState({ labels: [], data: [] });

    const socketRef = useRef(null);
    const BetRequestRef = useRef(null);
    const GameResponseRef = useRef(null);

    useEffect(() => {
        // Initialize Socket.IO
        socketRef.current = io();

        // Load Protobuf Schema
        protobuf.load('/game.proto', (err, root) => {
            if (err) {
                alert('Failed to load binary schema');
                return;
            }
            BetRequestRef.current = root.lookupType('BetRequest');
            GameResponseRef.current = root.lookupType('GameResponse');

            // Fetch initial state after protobuf is loaded
            fetchInitialState();
        });

        // Listen for game updates
        socketRef.current.on('game-update', (buffer) => {
            try {
                if (!GameResponseRef.current) return;
                const uint8 = new Uint8Array(buffer);
                const decoded = GameResponseRef.current.decode(uint8);
                const data = GameResponseRef.current.toObject(decoded);
                updateDashboard(data);
            } catch (e) {
                console.error('Error decoding game update:', e);
            }
        });

        return () => {
            if (socketRef.current) {
                socketRef.current.disconnect();
            }
        };
    }, []);

    const fetchInitialState = async () => {
        try {
            const res = await fetch('/api/state');
            const data = await res.json();
            setBalance(data.balance.toFixed(2));
            setActiveHash(data.serverSeedHash);

            // Add initial point to chart
            setChartData({
                labels: [data.nonce],
                data: [data.balance],
            });
        } catch (error) {
            console.error('Error fetching initial state:', error);
        }
    };

    const updateDashboard = (data) => {
        // Update numbers
        setRollResult(data.roll.toFixed(2));
        setIsWin(data.isWin);
        setBalance(data.newBalance.toFixed(2));
        setActualRoll(data.roll);

        // Update fairness data
        setLastSeed(data.serverSeedRevealed);
        setLastClientSeed(data.clientSeed);
        setLastNonce(data.nonce);
        setActiveHash('Hash of: ' + data.serverSeedRevealed.substring(0, 20) + '...');

        // Update history
        setHistory((prev) => {
            const newHistory = [
                {
                    nonce: data.nonce,
                    roll: data.roll,
                    betAmount: data.betAmount,
                    profit: data.profit,
                    isWin: data.isWin,
                },
                ...prev,
            ];
            return newHistory.slice(0, 15); // Keep only last 15
        });

        // Update chart
        setChartData((prev) => {
            const newLabels = [...prev.labels, data.nonce];
            const newData = [...prev.data, data.newBalance];

            // Keep chart from getting too crowded (Max 50 points)
            if (newLabels.length > 50) {
                newLabels.shift();
                newData.shift();
            }

            return { labels: newLabels, data: newData };
        });
    };

    const handlePlayGame = async (betAmount, clientSeed, condition) => {
        if (!BetRequestRef.current) {
            alert('Protobuf not loaded yet');
            return;
        }

        const payload = { betAmount, target: 50, condition, clientSeed };

        // Verify & Encode
        const err = BetRequestRef.current.verify(payload);
        if (err) {
            alert(err);
            return;
        }

        const message = BetRequestRef.current.create(payload);
        const buffer = BetRequestRef.current.encode(message).finish();

        try {
            await fetch('/api/bet', {
                method: 'POST',
                headers: { 'Content-Type': 'application/octet-stream' },
                body: buffer,
            });
        } catch (error) {
            console.error('Error placing bet:', error);
            alert('Failed to place bet');
        }
    };

    return (
        <>
            <BalanceChart chartData={chartData} />

            <div className="main-wrapper">
                <div className="game-column">
                    <GamePanel
                        balance={balance}
                        rollResult={rollResult}
                        isWin={isWin}
                        onPlayGame={handlePlayGame}
                    />
                </div>

                <div className="game-column">
                    <VerificationPanel
                        activeHash={activeHash}
                        lastSeed={lastSeed}
                        lastNonce={lastNonce}
                        lastClientSeed={lastClientSeed}
                        actualRoll={actualRoll}
                    />
                </div>
            </div>

            <HistoryTable history={history} />
        </>
    );
}

export default App;
