const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const http = require('http');
const { Server } = require("socket.io");
const db = require('./database');
const protobuf = require('protobufjs');
const fs = require('fs');

const app = express();
app.use(cors());

// IMPORTANT: We must read the body as a RAW BUFFER now, not JSON
app.use(express.raw({ type: 'application/octet-stream', limit: '1mb' }));
// Allow static files
app.use(express.static(__dirname + "/public"));

const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// --- LOAD PROTOBUF SCHEMA ---
let BetRequest, GameResponse;
protobuf.load("game.proto", function (err, root) {
    if (err) throw err;
    BetRequest = root.lookupType("BetRequest");
    GameResponse = root.lookupType("GameResponse");
    console.log("📜 Binary Protocol Loaded!");
});

// --- LOAD THE CHAIN ---
let seedChain = [];
try {
    seedChain = JSON.parse(fs.readFileSync('chain.json'));
    console.log(`🔗 Loaded ${seedChain.length} seeds from chain.`);
} catch (e) {
    console.error("❌ Run 'node generate_chain.js' first!");
    process.exit(1);
}

// --- GAME STATE ---
let previousServerSeed = seedChain[0]; // The Public Anchor
let gameIndex = 1; // We start at index 1

// --- HELPER: PROVABLY FAIR MATH (Re-added) ---
function generateFairRoll(serverSeed, clientSeed, nonce) {
    const hmac = crypto.createHmac('sha256', serverSeed);
    hmac.update(`${clientSeed}:${nonce}`);
    const buffer = hmac.digest();
    const resultInt = buffer.readUInt32BE(0);
    return (resultInt % 10001) / 100;
}

// --- HELPER: GET CURRENT SEED ---
function getCurrentSeed() {
    if (gameIndex >= seedChain.length) return null; // Chain exhausted
    return seedChain[gameIndex];
}

io.on('connection', (socket) => {
    console.log('⚡ New Client Connected:', socket.id);
});

// --- API ROUTES ---

function sendBinaryError(res, msg) {
    const payload = { error: msg };
    const errMsg = GameResponse.create(payload);
    const buffer = GameResponse.encode(errMsg).finish();
    res.set('Content-Type', 'application/octet-stream');
    res.send(buffer);
}

app.get('/game.proto', (req, res) => {
    res.sendFile(__dirname + '/game.proto');
});

app.get('/api/state', (req, res) => {
    db.get("SELECT balance FROM users WHERE id = 1", (err, row) => {
        if (err || !row) return res.status(500).json({ error: "DB Error" });
        res.json({
            balance: row.balance,
            serverSeedHash: previousServerSeed,
            nonce: gameIndex
        });
    });
});

app.post('/api/bet', (req, res) => {
    if (!BetRequest) return res.status(500).send("Proto not loaded");

    try {
        const decoded = BetRequest.decode(req.body);
        const { betAmount, target, condition, clientSeed } = BetRequest.toObject(decoded);

        db.get("SELECT balance FROM users WHERE id = 1", (err, row) => {
            if (err) return sendBinaryError(res, "DB Error");

            let userBalance = row.balance;

            if (betAmount > userBalance || betAmount <= 0) {
                return sendBinaryError(res, "Insufficient funds");
            }

            // CAPTURE THE NONCE (Fixes the bug)
            const currentNonce = gameIndex;

            // GET SEED & CALCULATE
            const seedUsed = getCurrentSeed();
            if (!seedUsed) {
                return sendBinaryError(res, "Casino is out of seeds! New chain needed.");
            }

            // Re-added the missing helper call
            const rollResult = generateFairRoll(seedUsed, clientSeed, currentNonce);

            let isWin = false;
            let multiplier = 0;

            if (condition === 'over' && rollResult > target) {
                isWin = true;
                multiplier = 99 / (100 - target);
            } else if (condition === 'under' && rollResult < target) {
                isWin = true;
                multiplier = 99 / target;
            }

            let profit = 0;
            let newBalance = userBalance - betAmount;
            if (isWin) {
                const payout = betAmount * multiplier;
                profit = payout - betAmount;
                newBalance += payout;
            } else {
                profit = -betAmount;
            }

            // 2. DB UPDATE (Fixed 'currentNonce' error)
            db.run("UPDATE users SET balance = ? WHERE id = 1", [newBalance]);

            const insertSQL = `INSERT INTO bets (nonce, bet_amount, target, condition, roll, profit, client_seed, server_seed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
            // ⚠️ FIX: Used 'gameIndex' instead of undefined 'currentNonce'
            db.run(insertSQL, [currentNonce, betAmount, target, condition, rollResult, profit, clientSeed, seedUsed]);

            // 3. MOVE CHAIN FORWARD
            previousServerSeed = seedUsed;
            gameIndex++;

            // 4. RESPONSE
            const responsePayload = {
                roll: rollResult,
                isWin: isWin,
                profit: profit,
                newBalance: newBalance,
                betAmount: betAmount,
                serverSeedRevealed: seedUsed,
                clientSeed: clientSeed,
                nonce: currentNonce, // Updated
                nextServerSeedHash: "See Chain Logic",
                error: ""
            };

            const message = GameResponse.create(responsePayload);
            const buffer = GameResponse.encode(message).finish();

            io.emit('game-update', buffer);

            res.set('Content-Type', 'application/octet-stream');
            res.send(buffer);
        });

    } catch (e) {
        console.error("Binary Decode Error:", e);
        sendBinaryError(res, "Invalid Binary Format");
    }
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`🤖 Binary Chain Server running on http://localhost:${PORT}`);
});