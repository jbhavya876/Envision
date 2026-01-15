/**
 * @file Binary Dice Casino - Main Server
 * @description Express server with Socket.IO for real-time binary dice gambling game.
 * Features include:
 * - JWT-based authentication
 * - Protobuf binary protocol for efficient data transfer
 * - Provably fair gaming using pre-generated seed chains
 * - Real-time game updates via WebSocket
 * - SQLite database for user accounts and bet history
 * 
 * @requires express
 * @requires socket.io
 * @requires protobufjs
 * @requires jsonwebtoken
 * @requires bcrypt
 */

// Load environment variables from .env file
require('dotenv').config();

// Core dependencies
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

// Configuration from environment variables
const SECRET_KEY = process.env.SECRET_KEY || "super_secret_key_123";
const PORT = process.env.PORT || 3000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";

// Initialize Express application
const app = express();
app.use(cors({ origin: CORS_ORIGIN }));

// ============================================================================
// MIDDLEWARE CONFIGURATION
// ============================================================================

app.use(express.json()); // Parse JSON request bodies
app.use(express.raw({ type: 'application/octet-stream', limit: '1mb' })); // Parse binary data
app.use(express.static(path.join(__dirname, 'client/dist'))); // Serve React build

// Create HTTP server and Socket.IO instance
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: CORS_ORIGIN,
        methods: ["GET", "POST"]
    }
});


// ============================================================================
// PROTOBUF SCHEMA LOADING
// ============================================================================

/**
 * Protobuf message types for binary communication
 * @type {Object}
 */
let BetRequest, GameResponse;

protobuf.load("game.proto", function (err, root) {
    if (err) throw err;
    BetRequest = root.lookupType("BetRequest");
    GameResponse = root.lookupType("GameResponse");
    console.log("📜 Binary Protocol Loaded!");
});

// ============================================================================
// PROVABLY FAIR SEED CHAIN
// ============================================================================

/**
 * Pre-generated chain of server seeds for provably fair gaming
 * Each seed is used once and then revealed to prove fairness
 * @type {Array<string>}
 */
let seedChain = [];

try {
    seedChain = JSON.parse(fs.readFileSync('chain.json'));
    console.log(`🔗 Loaded ${seedChain.length} seeds from chain.`);
} catch (e) {
    console.error("❌ Run 'node generate_chain.js' first!");
    process.exit(1);
}

// ============================================================================
// GAME STATE MANAGEMENT
// ============================================================================

/**
 * The most recently used (and now revealed) server seed
 * @type {string}
 */
let previousServerSeed = seedChain[0];

/**
 * Current position in the seed chain (also serves as nonce)
 * @type {number}
 */
let gameIndex = 1;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Generates a provably fair roll result using HMAC-SHA256
 * @param {string} serverSeed - Secret server seed
 * @param {string} clientSeed - Client-provided seed for randomness
 * @param {number} nonce - Sequential number to ensure uniqueness
 * @returns {number} Roll result between 0.00 and 100.00
 */
function generateFairRoll(serverSeed, clientSeed, nonce) {
    const hmac = crypto.createHmac('sha256', serverSeed);
    hmac.update(`${clientSeed}:${nonce}`);
    const buffer = hmac.digest();
    const resultInt = buffer.readUInt32BE(0);
    return (resultInt % 10001) / 100;
}

/**
 * Retrieves the current server seed from the chain
 * @returns {string|null} Current seed or null if chain exhausted
 */
function getCurrentSeed() {
    if (gameIndex >= seedChain.length) return null;
    return seedChain[gameIndex];
}

/**
 * Sends an error response in Protobuf binary format
 * @param {Object} res - Express response object
 * @param {string} msg - Error message to send
 */
function sendBinaryError(res, msg) {
    const payload = { error: msg };
    const errMsg = GameResponse.create(payload);
    const buffer = GameResponse.encode(errMsg).finish();
    res.set('Content-Type', 'application/octet-stream');
    res.send(buffer);
}

// ============================================================================
// AUTHENTICATION MIDDLEWARE
// ============================================================================

/**
 * Middleware to verify JWT tokens and protect routes
 * Extracts user information from valid tokens and attaches to req.user
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
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

// ============================================================================
// API ROUTES
// ============================================================================

/**
 * POST /api/register
 * Register a new user account
 * @body {string} username - Unique username
 * @body {string} password - User password (will be hashed)
 * @returns {Object} Success message or error
 */
app.post('/api/register', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Missing fields" });

    const hash = bcrypt.hashSync(password, 10);
    db.run("INSERT INTO users (username, password_hash) VALUES (?, ?)", [username, hash], function (err) {
        if (err) return res.status(400).json({ error: "Username taken" });
        res.json({ success: true, message: "Registered! Please login." });
    });
});

/**
 * POST /api/login
 * Authenticate user and return JWT token
 * @body {string} username - Username
 * @body {string} password - Password
 * @returns {Object} JWT token, username, and balance
 */
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

/**
 * GET /api/state
 * Get current user balance and game state
 * @requires Authentication
 * @returns {Object} User balance, current server seed hash, and nonce
 */
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

/**
 * POST /api/bet
 * Place a bet on the binary dice game
 * @requires Authentication
 * @body {Buffer} Protobuf-encoded BetRequest containing:
 *   - betAmount: Amount to wager
 *   - target: Target number (default 50)
 *   - condition: 'over' or 'under'
 *   - clientSeed: Client-provided randomness seed
 * @returns {Buffer} Protobuf-encoded GameResponse with result
 */
app.post('/api/bet', authenticateToken, (req, res) => {
    if (!BetRequest) return res.status(500).send("Proto not loaded");

    try {
        // Decode the binary Protobuf request
        const decoded = BetRequest.decode(req.body);
        const { betAmount, target, condition, clientSeed } = BetRequest.toObject(decoded);

        // Fetch user's current balance
        db.get("SELECT balance FROM users WHERE id = ?", [req.user.id], (err, row) => {
            if (err) return sendBinaryError(res, "DB Error");

            let userBalance = row.balance;

            // Validate bet amount
            if (betAmount > userBalance || betAmount <= 0) return sendBinaryError(res, "Insufficient funds");

            // Get current nonce and seed
            const currentNonce = gameIndex;
            const seedUsed = getCurrentSeed();
            if (!seedUsed) return sendBinaryError(res, "Casino is out of seeds!");

            // Generate provably fair roll result
            const rollResult = generateFairRoll(seedUsed, clientSeed, currentNonce);
            let isWin = false;
            let multiplier = 0;

            // Determine win/loss and calculate multiplier
            if (condition === 'over' && rollResult > target) {
                isWin = true;
                multiplier = 99 / (100 - target);
            } else if (condition === 'under' && rollResult < target) {
                isWin = true;
                multiplier = 99 / target;
            }

            // Calculate profit and new balance
            let profit = 0;
            let newBalance = userBalance - betAmount;
            if (isWin) {
                const payout = betAmount * multiplier;
                profit = payout - betAmount;
                newBalance += payout;
            } else {
                profit = -betAmount;
            }

            // Update user balance in database
            db.run("UPDATE users SET balance = ? WHERE id = ?", [newBalance, req.user.id]);

            // Record bet in history
            const insertSQL = `INSERT INTO bets (user_id, nonce, bet_amount, target, condition, roll, profit, client_seed, server_seed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
            db.run(insertSQL, [req.user.id, currentNonce, betAmount, target, condition, rollResult, profit, clientSeed, seedUsed]);

            // Advance to next seed in chain
            previousServerSeed = seedUsed;
            gameIndex++;

            // Prepare response payload
            const responsePayload = {
                roll: rollResult, isWin, profit, newBalance, betAmount,
                serverSeedRevealed: seedUsed, clientSeed, nonce: currentNonce,
                nextServerSeedHash: "See Chain Logic", error: ""
            };

            // Encode and send binary response
            const message = GameResponse.create(responsePayload);
            const buffer = GameResponse.encode(message).finish();

            // Broadcast update to all connected clients via WebSocket
            io.emit('game-update', buffer);
            res.set('Content-Type', 'application/octet-stream');
            res.send(buffer);
        });

    } catch (e) {
        console.error("Binary Decode Error:", e);
        sendBinaryError(res, "Invalid Binary Format");
    }
});


// ============================================================================
// STATIC FILE SERVING
// ============================================================================

/**
 * GET /game.proto
 * Serve the Protobuf schema file
 * Checks client/public first (development), then root (production)
 */
app.get('/game.proto', (req, res) => {
    const clientPath = path.join(__dirname, 'client/public/game.proto');
    if (fs.existsSync(clientPath)) {
        res.sendFile(clientPath);
    } else {
        res.sendFile(path.join(__dirname, 'game.proto'));
    }
});

/**
 * Catch-all route for React Router
 * Serves index.html for all non-API routes to enable client-side routing
 */
app.get(/.*/, (req, res) => {
    if (req.path.startsWith('/api')) return res.status(404);
    res.sendFile(path.join(__dirname, 'client/dist/index.html'));
});

// ============================================================================
// SERVER STARTUP
// ============================================================================

server.listen(PORT, () => {
    console.log(`🤖 Secure Binary Chain Server running on http://localhost:${PORT}`);
});