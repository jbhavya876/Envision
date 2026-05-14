/**
 * @file Binary Dice Casino - Main Server (Phase 1 Hardened)
 * @description Express server with Socket.IO for real-time binary dice gambling.
 *   - HttpOnly JWT cookie auth with refresh token rotation
 *   - Protobuf binary protocol
 *   - Per‑user provably fair (HMAC‑SHA256, seed commitment + nonce)
 *   - Atomic SQLite bet transactions (integer cents)
 *   - Private Socket.IO rooms (no global broadcast)
 *   - Rate limiting on auth and bet routes
 *
 * @requires express
 * @requires socket.io
 * @requires protobufjs
 * @requires jsonwebtoken
 * @requires bcrypt
 * @requires cookie-parser
 * @requires express-rate-limit
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const http = require('http');
const { Server } = require('socket.io');
const protobuf = require('protobufjs');
const fs = require('fs');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const path = require('path');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');

// Import database initializer and getter
const { initializeDatabase, getDb } = require('./database');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const ACCESS_TOKEN_SECRET = process.env.SECRET_KEY || 'dev_secret_change_me';
const REFRESH_TOKEN_SECRET = process.env.REFRESH_SECRET_KEY || 'dev_refresh_secret';
const PORT = process.env.PORT || 3000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY_DAYS = 7;
const HOUSE_EDGE = parseFloat(process.env.HOUSE_EDGE || '0.01');

// ---------------------------------------------------------------------------
// Express app & middleware
// ---------------------------------------------------------------------------
const app = express();
app.use(cors({ origin: CORS_ORIGIN, credentials: true }));
app.use(express.json());
app.use(express.raw({ type: 'application/octet-stream', limit: '1mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'client/dist')));

// ---------------------------------------------------------------------------
// HTTP server and Socket.IO
// ---------------------------------------------------------------------------
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: CORS_ORIGIN,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// ---------------------------------------------------------------------------
// Protobuf schema loading
// ---------------------------------------------------------------------------
let BetRequest, GameResponse;
protobuf.load('game.proto', (err, root) => {
  if (err) throw err;
  BetRequest = root.lookupType('BetRequest');
  GameResponse = root.lookupType('GameResponse');
  console.log('📜 Binary Protocol Loaded!');
});

// ---------------------------------------------------------------------------
// Rate limiters
// ---------------------------------------------------------------------------
const betLimiter = rateLimit({
  windowMs: 1000,       // 1 second
  max: 5,               // 5 bets per second per IP
  message: { error: 'Too many bets, slow down' },
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: { error: 'Too many auth attempts' },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Provably fair roll: HMAC-SHA256(serverSeed, clientSeed:nonce) -> 0.00–100.00
 */
function generateFairRoll(serverSeed, clientSeed, nonce) {
  const hmac = crypto.createHmac('sha256', serverSeed);
  hmac.update(`${clientSeed}:${nonce}`);
  const buffer = hmac.digest();
  const resultInt = buffer.readUInt32BE(0);
  return (resultInt % 10001) / 100;
}

/**
 * Send a Protobuf-encoded error response
 */
function sendBinaryError(res, msg, protoType = GameResponse) {
  const payload = { error: msg };
  const errMsg = protoType.create(payload);
  const buffer = protoType.encode(errMsg).finish();
  res.set('Content-Type', 'application/octet-stream');
  res.send(buffer);
}

// ---------------------------------------------------------------------------
// Authentication middleware (cookie-based)
// ---------------------------------------------------------------------------
function authenticateToken(req, res, next) {
  const token = req.cookies.access_token;
  if (!token) return res.status(401).json({ error: 'Access token required' });

  jwt.verify(token, ACCESS_TOKEN_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired access token' });
    req.user = user;
    next();
  });
}

// ========== ADMIN MIDDLEWARE ==========
function requireAdmin(req, res, next) {
  if (req.user && req.user.username === 'root') {
    return next();
  }
  return res.status(403).json({ error: 'Admin access required' });
}

// ---------------------------------------------------------------------------
// Socket.IO authentication & private rooms
// ---------------------------------------------------------------------------
io.use((socket, next) => {
  const rawCookies = socket.handshake.headers.cookie;
  if (!rawCookies) return next(new Error('Authentication required'));

  const cookies = Object.fromEntries(rawCookies.split('; ').map(c => c.split('=')));
  const token = cookies.access_token;
  if (!token) return next(new Error('Access token required'));

  jwt.verify(token, ACCESS_TOKEN_SECRET, (err, user) => {
    if (err) return next(new Error('Invalid token'));
    socket.user = user;
    next();
  });
});

io.on('connection', (socket) => {
  const userId = socket.user.id;
  console.log(`User ${userId} connected`);
  socket.join(`user:${userId}`);   // private room for this user

  socket.on('disconnect', () => {
    console.log(`User ${userId} disconnected`);
  });
});

// ---------------------------------------------------------------------------
// API Routes
// ---------------------------------------------------------------------------

/**
 * POST /api/register
 */
app.post('/api/register', authLimiter, async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' });

  const db = getDb();
  try {
    const existing = await db.get('SELECT id FROM users WHERE username = ?', username);
    if (existing) return res.status(409).json({ error: 'Username taken' });

    const password_hash = await bcrypt.hash(password, 12);

    // Per‑user provably fair seed
    const server_seed = crypto.randomBytes(32).toString('hex');
    const server_seed_hash = crypto.createHash('sha256').update(server_seed).digest('hex');

    const result = await db.run(
      'INSERT INTO users (username, password_hash, server_seed, server_seed_hash) VALUES (?, ?, ?, ?)',
      [username, password_hash, server_seed, server_seed_hash]
    );

    res.status(201).json({ id: result.lastID, username });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/login
 */
app.post('/api/login', authLimiter, async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' });

  const db = getDb();
  try {
    const user = await db.get('SELECT * FROM users WHERE username = ?', username);
    if (!user) return res.status(400).json({ error: 'User not found' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(400).json({ error: 'Invalid password' });

    // Issue access token (short lived)
    const accessToken = jwt.sign(
      { id: user.id, username: user.username },
      ACCESS_TOKEN_SECRET,
      { expiresIn: ACCESS_TOKEN_EXPIRY }
    );

    // Issue refresh token (opaque, stored as SHA256 hash)
    const refreshToken = crypto.randomBytes(64).toString('hex');
    const refreshTokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();

    await db.run(
      'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
      [user.id, refreshTokenHash, expiresAt]
    );

    // Set HttpOnly cookies
    res.cookie('access_token', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 15 * 60 * 1000, // 15 minutes
      path: '/',
    });

    res.cookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
      path: '/api/auth/refresh',   // only sent with refresh requests
    });

    res.json({ username: user.username, balance: user.balance }); // balance in cents
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/auth/refresh
 * Exchange a valid refresh token for a new access/refresh pair (rotation)
 */
app.post('/api/auth/refresh', async (req, res) => {
  const refreshToken = req.cookies.refresh_token;
  if (!refreshToken) return res.status(401).json({ error: 'No refresh token' });

  const db = getDb();
  const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

  try {
    const stored = await db.get('SELECT * FROM refresh_tokens WHERE token_hash = ?', tokenHash);
    if (!stored) return res.status(401).json({ error: 'Invalid refresh token' });

    if (new Date(stored.expires_at) < new Date()) {
      await db.run('DELETE FROM refresh_tokens WHERE id = ?', stored.id);
      return res.status(401).json({ error: 'Refresh token expired' });
    }

    // Rotation: delete old token, issue new pair
    await db.run('DELETE FROM refresh_tokens WHERE id = ?', stored.id);

    const user = await db.get('SELECT id, username FROM users WHERE id = ?', stored.user_id);
    const accessToken = jwt.sign(
      { id: user.id, username: user.username },
      ACCESS_TOKEN_SECRET,
      { expiresIn: ACCESS_TOKEN_EXPIRY }
    );

    const newRefreshToken = crypto.randomBytes(64).toString('hex');
    const newTokenHash = crypto.createHash('sha256').update(newRefreshToken).digest('hex');
    const newExpiry = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();

    await db.run(
      'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
      [user.id, newTokenHash, newExpiry]
    );

    res.cookie('access_token', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 15 * 60 * 1000,
      path: '/',
    });

    res.cookie('refresh_token', newRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
      path: '/api/auth/refresh',
    });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/auth/logout
 */
app.post('/api/auth/logout', async (req, res) => {
  const refreshToken = req.cookies.refresh_token;
  if (refreshToken) {
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const db = getDb();
    await db.run('DELETE FROM refresh_tokens WHERE token_hash = ?', tokenHash);
  }
  res.clearCookie('access_token');
  res.clearCookie('refresh_token', { path: '/api/auth/refresh' });
  res.json({ success: true });
});

/**
 * GET /api/state
 * Returns per‑user balance (cents), current server seed hash, nonce, client seed
 */
app.get('/api/state', authenticateToken, async (req, res) => {
  const db = getDb();
  try {
    const user = await db.get(
      'SELECT username, balance, server_seed_hash, nonce, client_seed FROM users WHERE id = ?',
      req.user.id
    );
    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json({
      username: user.username,    // ← new
      balance: user.balance,
      serverSeedHash: user.server_seed_hash,
      nonce: user.nonce,
      clientSeed: user.client_seed,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

/**
 * POST /api/bet
 * Place a bet using Protobuf binary request. Full atomic transaction.
 */
app.post('/api/bet', authenticateToken, betLimiter, async (req, res) => {
  if (!BetRequest || !GameResponse) {
    return res.status(500).json({ error: 'Protobuf schemas not loaded yet' });
  }

  if (!req.is('application/octet-stream')) {
    return res.status(415).json({ error: 'Unsupported Media Type' });
  }

  const rawBody = req.body; // Buffer

  // Decode Protobuf
  let decoded;
  try {
    decoded = BetRequest.decode(rawBody);
  } catch (e) {
    return sendBinaryError(res, 'Invalid Protobuf', GameResponse);
  }

  const { betAmount: betAmountFloat, target, condition, clientSeed: clientSeedInput } =
    BetRequest.toObject(decoded);

  // Validation
  if (betAmountFloat <= 0) return sendBinaryError(res, 'Invalid bet amount', GameResponse);
  if (!['over', 'under'].includes(condition)) return sendBinaryError(res, 'Invalid condition', GameResponse);
  if (target < 1 || target > 99) return sendBinaryError(res, 'Target must be between 1 and 99', GameResponse);

  const betAmountCents = Math.round(betAmountFloat * 100);
  if (betAmountCents <= 0) return sendBinaryError(res, 'Bet too small', GameResponse);

  const clientSeed = clientSeedInput || '';
  const db = getDb();

  // ===== ATOMIC TRANSACTION =====
  try {
    await db.run('BEGIN IMMEDIATE');

    const user = await db.get(
      'SELECT balance, server_seed, server_seed_hash, nonce FROM users WHERE id = ?',
      req.user.id
    );
    if (!user) {
      await db.run('ROLLBACK');
      return sendBinaryError(res, 'User not found', GameResponse);
    }
    if (user.balance < betAmountCents) {
      await db.run('ROLLBACK');
      return sendBinaryError(res, 'Insufficient balance', GameResponse);
    }

    // Provably fair roll
    const serverSeed = user.server_seed;
    const nonce = user.nonce;
    const roll = generateFairRoll(serverSeed, clientSeed, nonce);

    // Determine outcome
    const isWin = (condition === 'over' && roll > target) ||
      (condition === 'under' && roll < target);

    // ---------- House edge multiplier ----------
    let winProbability;
    if (condition === 'over') {
      winProbability = (100 - target) / 100;
    } else { // under
      winProbability = target / 100;
    }

    // Edge: 1% means we keep 1% of the expected value, payout multiplier = (1-edge) / prob
    const payoutMultiplier = (1 - HOUSE_EDGE) / winProbability;

    // Profit in cents (integer arithmetic)
    const profitCents = isWin
      ? Math.floor(betAmountCents * payoutMultiplier) - betAmountCents
      : -betAmountCents;
    const newBalanceCents = user.balance + profitCents;   

    // Record bet
    await db.run(
      `INSERT INTO bets (user_id, bet_amount, target, condition, roll, win, profit,
        server_seed_hash, server_seed, client_seed, nonce)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user.id,
        betAmountCents,
        target,
        condition,
        roll,
        isWin ? 1 : 0,
        profitCents,
        user.server_seed_hash,
        serverSeed,
        clientSeed,
        nonce,
      ]
    );

    // Update user balance and increment nonce
    await db.run(
      'UPDATE users SET balance = ?, nonce = nonce + 1, client_seed = ? WHERE id = ?',
      [newBalanceCents, clientSeed, req.user.id]
    );

    await db.run('COMMIT');

    // Prepare response (next hash is unchanged because seed hasn't changed)
    const nextServerSeedHash = user.server_seed_hash;

    const responsePayload = {
      roll,
      isWin,
      profit: profitCents,             // cents
      newBalance: newBalanceCents,     // cents
      betAmount: betAmountFloat,
      serverSeedRevealed: serverSeed,
      clientSeed,
      nonce,
      nextServerSeedHash,
      error: '',
    };

    const message = GameResponse.create(responsePayload);
    const buffer = GameResponse.encode(message).finish();

    // Send HTTP response
    res.set('Content-Type', 'application/octet-stream');
    res.send(Buffer.from(buffer));

    // Emit privately to this user's socket room
    io.to(`user:${req.user.id}`).emit('bet_result', buffer);

  } catch (err) {
    await db.run('ROLLBACK').catch(() => { }); // best effort
    console.error('Bet transaction failed:', err);
    sendBinaryError(res, 'Internal server error', GameResponse);
  }
});

app.post('/api/deposit', authenticateToken, async (req, res) => {
  const { amount } = req.body; // in dollars
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });

  const amountCents = Math.round(amount * 100);
  const db = getDb();

  // Simulate a deposit "address" and "tx hash"
  const address = '0x' + crypto.randomBytes(20).toString('hex');
  const txHash = '0x' + crypto.randomBytes(32).toString('hex');

  try {
    await db.run(
      'INSERT INTO deposits (user_id, amount, address, tx_hash) VALUES (?, ?, ?, ?)',
      [req.user.id, amountCents, address, txHash]
    );
    res.json({ address, txHash, amount: amountCents, status: 'pending' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Deposit request failed' });
  }
});

app.post('/api/admin/deposit/confirm', authenticateToken, requireAdmin, async (req, res) => {
  const { depositId } = req.body;
  if (!depositId) return res.status(400).json({ error: 'Missing depositId' });

  const db = getDb();
  try {
    const deposit = await db.get('SELECT * FROM deposits WHERE id = ? AND status = ?', [depositId, 'pending']);
    if (!deposit) return res.status(404).json({ error: 'Deposit not found or not pending' });

    // Update balance & mark confirmed
    await db.run('BEGIN IMMEDIATE');
    await db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [deposit.amount, deposit.user_id]);
    await db.run('UPDATE deposits SET status = ?, confirmed_at = ? WHERE id = ?', ['confirmed', new Date().toISOString(), depositId]);
    // Add to ledger
    await db.run('INSERT INTO transactions (user_id, type, amount, reference_id) VALUES (?, ?, ?, ?)',
      [deposit.user_id, 'deposit', deposit.amount, depositId]);
    await db.run('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await db.run('ROLLBACK').catch(() => { });
    console.error(err);
    res.status(500).json({ error: 'Confirmation failed' });
  }
});

app.post('/api/admin/deposit/reject', authenticateToken, requireAdmin, async (req, res) => {
  const { depositId } = req.body;
  if (!depositId) return res.status(400).json({ error: 'Missing depositId' });

  const db = getDb();
  try {
    await db.run('UPDATE deposits SET status = ? WHERE id = ? AND status = ?', ['rejected', depositId, 'pending']);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Rejection failed' });
  }
});

app.post('/api/withdraw', authenticateToken, async (req, res) => {
  const { amount, walletAddress } = req.body; // amount in dollars
  if (!amount || amount <= 0 || !walletAddress) return res.status(400).json({ error: 'Invalid request' });

  const amountCents = Math.round(amount * 100);
  const db = getDb();

  try {
    await db.run('BEGIN IMMEDIATE');
    const user = await db.get('SELECT balance FROM users WHERE id = ?', req.user.id);
    if (user.balance < amountCents) {
      await db.run('ROLLBACK');
      return res.status(400).json({ error: 'Insufficient balance' });
    }
    // Deduct balance immediately (will be restored if rejected)
    await db.run('UPDATE users SET balance = balance - ? WHERE id = ?', [amountCents, req.user.id]);
    await db.run(
      'INSERT INTO withdrawals (user_id, amount, wallet_address) VALUES (?, ?, ?)',
      [req.user.id, amountCents, walletAddress]
    );
    await db.run('INSERT INTO transactions (user_id, type, amount, reference_id) VALUES (?, ?, ?, last_insert_rowid())',
      [req.user.id, 'withdrawal', -amountCents]);
    await db.run('COMMIT');
    res.json({ success: true, status: 'pending' });
  } catch (err) {
    await db.run('ROLLBACK').catch(() => { });
    console.error(err);
    res.status(500).json({ error: 'Withdrawal request failed' });
  }
});

app.post('/api/admin/withdraw/approve', authenticateToken, requireAdmin, async (req, res) => {
  const { withdrawalId } = req.body;
  if (!withdrawalId) return res.status(400).json({ error: 'Missing withdrawalId' });

  const db = getDb();
  try {
    const withdrawal = await db.get('SELECT * FROM withdrawals WHERE id = ? AND status = ?', [withdrawalId, 'pending']);
    if (!withdrawal) return res.status(404).json({ error: 'Withdrawal not found or not pending' });

    await db.run(
      'UPDATE withdrawals SET status = ?, approved_by = ?, updated_at = ? WHERE id = ?',
      ['approved', req.user.id, new Date().toISOString(), withdrawalId]
    );
    // Balance was already deducted; nothing else to do
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Approval failed' });
  }
});

app.post('/api/admin/withdraw/reject', authenticateToken, requireAdmin, async (req, res) => {
  const { withdrawalId } = req.body;
  if (!withdrawalId) return res.status(400).json({ error: 'Missing withdrawalId' });

  const db = getDb();
  try {
    const withdrawal = await db.get('SELECT * FROM withdrawals WHERE id = ? AND status = ?', [withdrawalId, 'pending']);
    if (!withdrawal) return res.status(404).json({ error: 'Withdrawal not found or not pending' });

    await db.run('BEGIN IMMEDIATE');
    // Refund the user
    await db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [withdrawal.amount, withdrawal.user_id]);
    await db.run('UPDATE withdrawals SET status = ?, updated_at = ? WHERE id = ?', ['rejected', new Date().toISOString(), withdrawalId]);
    // Add reverse entry to ledger
    await db.run('INSERT INTO transactions (user_id, type, amount, reference_id) VALUES (?, ?, ?, ?)',
      [withdrawal.user_id, 'withdrawal_reversal', withdrawal.amount, withdrawalId]);
    await db.run('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await db.run('ROLLBACK').catch(() => { });
    console.error(err);
    res.status(500).json({ error: 'Rejection failed' });
  }
});

app.get('/api/transactions', authenticateToken, async (req, res) => {
  const db = getDb();
  try {
    const transactions = await db.all(
      'SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
      req.user.id
    );
    res.json(transactions);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get('/api/health', async (req, res) => {
  try {
    const db = getDb();
    await db.get('SELECT 1');
    res.json({ status: 'ok', database: 'connected' });
  } catch (e) {
    res.status(500).json({ status: 'error', database: 'disconnected' });
  }
});

// ---------------------------------------------------------------------------
// Static file serving (protobuf schema & React SPA)
// ---------------------------------------------------------------------------
app.get('/game.proto', (req, res) => {
  const clientPath = path.join(__dirname, 'client/public/game.proto');
  if (fs.existsSync(clientPath)) {
    res.sendFile(clientPath);
  } else {
    res.sendFile(path.join(__dirname, 'game.proto'));
  }
});

app.get('/api/admin/deposits', authenticateToken, requireAdmin, async (req, res) => {
  const db = getDb();
  const deposits = await db.all('SELECT * FROM deposits WHERE status = ?', 'pending');
  res.json(deposits);
});

app.get('/api/admin/withdrawals', authenticateToken, requireAdmin, async (req, res) => {
  const db = getDb();
  const withdrawals = await db.all('SELECT * FROM withdrawals WHERE status = ?', 'pending');
  res.json(withdrawals);
});

app.get(/.*/, (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404);
  res.sendFile(path.join(__dirname, 'client/dist/index.html'));
});

// ---------------------------------------------------------------------------
// Server startup (async DB initialisation)
// ---------------------------------------------------------------------------
(async () => {
  try {
    await initializeDatabase();        // creates tables and indexes if needed
    server.listen(PORT, () => {
      console.log(`🤖 Secure Binary Chain Server running on http://localhost:${PORT}`);
    });

    // Graceful shutdown
    process.on('SIGTERM', async () => {
      console.log('SIGTERM received, shutting down gracefully...');
      const db = getDb();
      if (db) {
        await db.close();
        console.log('Database connection closed.');
      }
      process.exit(0);
    });
  } catch (err) {
    console.error('Failed to initialise database:', err);
    process.exit(1);
  }
})();