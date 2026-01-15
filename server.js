require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const http = require('http');
const { Server } = require("socket.io");
const db = require('./database');
const protobuf = require('protobufjs');
const fs = require('fs');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const path = require('path');

const SECRET_KEY = process.env.SECRET_KEY || "super_secret_key_123";
const PORT = process.env.PORT || 3000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";

const app = express();
app.use(cors({ origin: CORS_ORIGIN }));

// 1. MIDDLEWARE
app.use(express.json());
app.use(express.raw({ type: 'application/octet-stream', limit: '1mb' }));
// Serve React Build
app.use(express.static(path.join(__dirname, 'client/dist')));

const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: CORS_ORIGIN,
        methods: ["GET", "POST"]
    }
});

// --- LOAD PROTOBUF (Server Side) ---
let BetRequest, GameResponse;
protobuf.load("game.proto", function (err, root) {
    if (err) throw err;
    BetRequest = root.lookupType("BetRequest");
    GameResponse = root.lookupType("GameResponse");
    console.log("📜 Binary Protocol Loaded!");
});

// --- LOAD CHAIN ---
let seedChain = [];
try {
    seedChain = JSON.parse(fs.readFileSync('chain.json'));
    console.log(`🔗 Loaded ${seedChain.length} seeds from chain.`);
} catch (e) {
    console.error("❌ Run 'node generate_chain.js' first!");
    process.exit(1);
}

// --- GAME STATE ---
let previousServerSeed = seedChain[0];
let gameIndex = 1;

// --- HELPERS ---
function generateFairRoll(serverSeed, clientSeed, nonce) {
    const hmac = crypto.createHmac('sha256', serverSeed);
    hmac.update(`${clientSeed}:${nonce}`);
    const buffer = hmac.digest();
    const resultInt = buffer.readUInt32BE(0);
    return (resultInt % 10001) / 100;
}

function getCurrentSeed() {
    if (gameIndex >= seedChain.length) return null;
    return seedChain[gameIndex];
}

function sendBinaryError(res, msg) {
    const payload = { error: msg };
    const errMsg = GameResponse.create(payload);
    const buffer = GameResponse.encode(errMsg).finish();
    res.set('Content-Type', 'application/octet-stream');
    res.send(buffer);
}

// --- AUTH MIDDLEWARE ---
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ error: "Access Denied" });

    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err) return res.status(403).json({ error: "Invalid Token" });
        req.user = user;
        next();
    });
};

// --- ROUTES ---

// 1. REGISTER
app.post('/api/register', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Missing fields" });

    const hash = bcrypt.hashSync(password, 10);
    db.run("INSERT INTO users (username, password_hash) VALUES (?, ?)", [username, hash], function (err) {
        if (err) return res.status(400).json({ error: "Username taken" });
        res.json({ success: true, message: "Registered! Please login." });
    });
});

// 2. LOGIN
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    db.get("SELECT * FROM users WHERE username = ?", [username], (err, user) => {
        if (!user) return res.status(400).json({ error: "User not found" });
        if (bcrypt.compareSync(password, user.password_hash)) {
            const token = jwt.sign({ id: user.id, username: user.username }, SECRET_KEY, { expiresIn: '1h' });
            res.json({ token, username: user.username, balance: user.balance });
        } else {
            res.status(400).json({ error: "Invalid password" });
        }
    });
});

// 3. GET STATE
app.get('/api/state', authenticateToken, (req, res) => {
    db.get("SELECT balance FROM users WHERE id = ?", [req.user.id], (err, row) => {
        if (err || !row) return res.status(500).json({ error: "DB Error" });
        res.json({
            balance: row.balance,
            serverSeedHash: previousServerSeed,
            nonce: gameIndex
        });
    });
});

// 4. PLACE BET
app.post('/api/bet', authenticateToken, (req, res) => {
    if (!BetRequest) return res.status(500).send("Proto not loaded");

    try {
        const decoded = BetRequest.decode(req.body);
        const { betAmount, target, condition, clientSeed } = BetRequest.toObject(decoded);

        db.get("SELECT balance FROM users WHERE id = ?", [req.user.id], (err, row) => {
            if (err) return sendBinaryError(res, "DB Error");

            let userBalance = row.balance;
            if (betAmount > userBalance || betAmount <= 0) return sendBinaryError(res, "Insufficient funds");

            const currentNonce = gameIndex;
            const seedUsed = getCurrentSeed();
            if (!seedUsed) return sendBinaryError(res, "Casino is out of seeds!");

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

            // DB Updates
            db.run("UPDATE users SET balance = ? WHERE id = ?", [newBalance, req.user.id]);
            const insertSQL = `INSERT INTO bets (user_id, nonce, bet_amount, target, condition, roll, profit, client_seed, server_seed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
            db.run(insertSQL, [req.user.id, currentNonce, betAmount, target, condition, rollResult, profit, clientSeed, seedUsed]);

            previousServerSeed = seedUsed;
            gameIndex++;

            const responsePayload = {
                roll: rollResult, isWin, profit, newBalance, betAmount,
                serverSeedRevealed: seedUsed, clientSeed, nonce: currentNonce,
                nextServerSeedHash: "See Chain Logic", error: ""
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

// --- 🛑 FIX: Explicitly Serve Game Proto ---
// This prevents the catch-all from swallowing the proto file request
app.get('/game.proto', (req, res) => {
    // Try to find it in client/public first (Dev mode)
    const clientPath = path.join(__dirname, 'client/public/game.proto');
    if (fs.existsSync(clientPath)) {
        res.sendFile(clientPath);
    } else {
        // Fallback to root (Production/Server)
        res.sendFile(path.join(__dirname, 'game.proto'));
    }
});

// React Fallback (Last)
app.get(/.*/, (req, res) => {
    if (req.path.startsWith('/api')) return res.status(404);
    res.sendFile(path.join(__dirname, 'client/dist/index.html'));
});

server.listen(PORT, () => {
    console.log(`🤖 Secure Binary Chain Server running on http://localhost:${PORT}`);
});