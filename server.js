/**
 * @file Binary Dice Casino - Main Server (Phase 2 Complete)
 * @description Express server with Socket.IO for real-time gambling.
 *   - Dice, Crash, Mines games (all provably fair)
 *   - HttpOnly JWT auth with refresh rotation
 *   - Simulated deposit/withdrawal system
 *   - Admin panel, leaderboard, live bets, auto‑bet engine
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
  windowMs: 1000,
  max: 5,
  message: { error: 'Too many bets, slow down' },
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many auth attempts' },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function generateFairRoll(serverSeed, clientSeed, nonce) {
  const hmac = crypto.createHmac('sha256', serverSeed);
  hmac.update(`${clientSeed}:${nonce}`);
  const buffer = hmac.digest();
  const resultInt = buffer.readUInt32BE(0);
  return (resultInt % 10001) / 100;
}

function sendBinaryError(res, msg, protoType = GameResponse) {
  const payload = { error: msg };
  const errMsg = protoType.create(payload);
  const buffer = protoType.encode(errMsg).finish();
  res.set('Content-Type', 'application/octet-stream');
  res.send(buffer);
}

// ---------------------------------------------------------------------------
// Authentication middleware
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

function requireAdmin(req, res, next) {
  if (req.user && req.user.username === 'root') return next();
  return res.status(403).json({ error: 'Admin access required' });
}

// ---------------------------------------------------------------------------
// Socket.IO authentication & rooms
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

// ---------------------------------------------------------------------------
// Auto-bet engine
// ---------------------------------------------------------------------------
const activeAutoBets = new Map();

async function executeAutoBet(userId, config) {
  const { betAmount, condition, clientSeed, stopOnProfit, stopOnLoss, maxBets } = config;
  const db = getDb();
  let betCount = 0;
  let sessionProfit = 0;

  const loop = async () => {
    if (!activeAutoBets.has(userId)) return;

    if (maxBets && betCount >= maxBets) { stopAutoBet(userId); return; }
    if (stopOnProfit && sessionProfit >= stopOnProfit) { stopAutoBet(userId); return; }
    if (stopOnLoss && sessionProfit <= -stopOnLoss) { stopAutoBet(userId); return; }

    try {
      await db.run('BEGIN IMMEDIATE');
      const user = await db.get('SELECT balance, server_seed, server_seed_hash, nonce FROM users WHERE id = ?', userId);
      if (!user || user.balance < Math.round(betAmount * 100)) {
        await db.run('ROLLBACK');
        stopAutoBet(userId);
        return;
      }

      const nonce = user.nonce;
      const serverSeed = user.server_seed;
      const roll = generateFairRoll(serverSeed, clientSeed, nonce);
      const isWin = (condition === 'over' && roll > 50) || (condition === 'under' && roll < 50);
      const payoutMultiplier = (1 - HOUSE_EDGE) / 0.5;
      const betAmountCents = Math.round(betAmount * 100);
      const profitCents = isWin
        ? Math.floor(betAmountCents * payoutMultiplier) - betAmountCents
        : -betAmountCents;
      const newBalanceCents = user.balance + profitCents;

      const { lastID } = await db.run(
        `INSERT INTO bets (user_id, bet_amount, target, condition, roll, win, profit, server_seed_hash, server_seed, client_seed, nonce)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, betAmountCents, 50, condition, roll, isWin ? 1 : 0, profitCents, user.server_seed_hash, serverSeed, clientSeed, nonce]
      );
      await db.run('UPDATE users SET balance = ?, nonce = nonce + 1, client_seed = ? WHERE id = ?', [newBalanceCents, clientSeed, userId]);
      await db.run('INSERT INTO transactions (user_id, type, amount, reference_id) VALUES (?, ?, ?, ?)', [userId, 'bet', profitCents, lastID]);
      await db.run('COMMIT');

      sessionProfit += profitCents;
      betCount++;

      const responsePayload = {
        roll, isWin, profit: profitCents, newBalance: newBalanceCents,
        betAmount, serverSeedRevealed: serverSeed, clientSeed, nonce,
        nextServerSeedHash: user.server_seed_hash, error: ''
      };
      const message = GameResponse.create(responsePayload);
      const buffer = GameResponse.encode(message).finish();
      io.to(`user:${userId}`).emit('bet_result', buffer);

      const maskedUsername = (await db.get('SELECT username FROM users WHERE id = ?', userId)).username.substring(0, 3) + '***';
      io.to('public').emit('public_bet', {
        username: maskedUsername, betAmount, target: 50, condition,
        roll, isWin, profit: profitCents, timestamp: new Date().toISOString()
      });
    } catch (err) {
      await db.run('ROLLBACK').catch(() => { });
      console.error(`Auto-bet error for user ${userId}:`, err);
    }
  };

  const intervalId = setInterval(loop, 1500);
  activeAutoBets.set(userId, { intervalId, config, startTime: Date.now() });
}

function stopAutoBet(userId) {
  const session = activeAutoBets.get(userId);
  if (session) {
    clearInterval(session.intervalId);
    activeAutoBets.delete(userId);
    io.to(`user:${userId}`).emit('auto_bet:stopped', { message: 'Auto-bet stopped' });
  }
}

// ---------------------------------------------------------------------------
// Crash game engine
// ---------------------------------------------------------------------------
const activeCrashGames = new Map();

function generateCrashPoint(serverSeed, clientSeed, nonce) {
  const hmac = crypto.createHmac('sha256', serverSeed);
  hmac.update(`${clientSeed}:${nonce}`);
  const buffer = hmac.digest();
  const randInt = buffer.readUInt32BE(0);
  const r = randInt / 0xffffffff;
  const crash = Math.max(1, Math.floor((1 / (1 - r)) * (1 - HOUSE_EDGE) * 100) / 100);
  return crash;
}

function emitCrashMultiplier(gameId) {
  const game = activeCrashGames.get(gameId);
  if (!game) return;

  const timer = setInterval(() => {
    const g = activeCrashGames.get(gameId);
    if (!g || g.cashedOut) {
      clearInterval(timer);
      return;
    }
    const elapsed = (Date.now() - g.startTime) / 1000;
    const multiplier = Math.exp(elapsed * 0.1);
    const rounded = Math.floor(multiplier * 100) / 100;

    if (rounded >= g.crashPoint) {
      io.to(`user:${g.userId}`).emit('crash:multiplier', { multiplier: g.crashPoint, crashed: true });
      io.to(`user:${g.userId}`).emit('crash:result', { win: false, crashPoint: g.crashPoint });
      activeCrashGames.delete(gameId);
      clearInterval(timer);
    } else {
      io.to(`user:${g.userId}`).emit('crash:multiplier', { multiplier: rounded, crashed: false });
    }
  }, 100);

  game.timer = timer;
}

// ---------------------------------------------------------------------------
// Mines game engine
// ---------------------------------------------------------------------------
const activeMinesGames = new Map();
const MINES_PAYOUT_3 = [0, 1.2, 2.5, 5, 10, 20, 50, 100];

function generateMinesPositions(serverSeed, clientSeed, nonce, minesCount = 3) {
  const hmac = crypto.createHmac('sha256', serverSeed);
  hmac.update(`${clientSeed}:${nonce}`);
  const hash = hmac.digest('hex');
  let seed = parseInt(hash.substring(0, 8), 16);
  const positions = Array.from({ length: 25 }, (_, i) => i);
  for (let i = positions.length - 1; i > 0; i--) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const j = seed % (i + 1);
    [positions[i], positions[j]] = [positions[j], positions[i]];
  }
  return { mines: positions.slice(0, minesCount), minesCount };
}

// ---------------------------------------------------------------------------
// Socket.IO connection handlers
// ---------------------------------------------------------------------------
io.on('connection', (socket) => {
  const userId = socket.user.id;
  console.log(`User ${userId} connected`);
  socket.join(`user:${userId}`);
  socket.join('public');

  socket.on('auto_bet:start', (config) => {
    if (!config.betAmount || !config.condition) {
      return socket.emit('auto_bet:error', { message: 'Invalid config' });
    }
    stopAutoBet(userId);
    executeAutoBet(userId, config);
    socket.emit('auto_bet:started', { message: 'Auto-bet started' });
  });

  socket.on('auto_bet:stop', () => stopAutoBet(userId));

  socket.on('disconnect', () => {
    stopAutoBet(userId);
    console.log(`User ${userId} disconnected`);
  });
});

// ============================================================================
// API ROUTES
// ============================================================================

// Authentication
app.post('/api/register', authLimiter, async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' });
  const db = getDb();
  try {
    const existing = await db.get('SELECT id FROM users WHERE username = ?', username);
    if (existing) return res.status(409).json({ error: 'Username taken' });
    const password_hash = await bcrypt.hash(password, 12);
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

app.post('/api/login', authLimiter, async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' });
  const db = getDb();
  try {
    const user = await db.get('SELECT * FROM users WHERE username = ?', username);
    if (!user) return res.status(400).json({ error: 'User not found' });
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(400).json({ error: 'Invalid password' });

    const accessToken = jwt.sign({ id: user.id, username: user.username }, ACCESS_TOKEN_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
    const refreshToken = crypto.randomBytes(64).toString('hex');
    const refreshTokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();

    await db.run('INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)', [user.id, refreshTokenHash, expiresAt]);

    res.cookie('access_token', accessToken, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', maxAge: 15 * 60 * 1000, path: '/' });
    res.cookie('refresh_token', refreshToken, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', maxAge: REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000, path: '/api/auth/refresh' });

    res.json({ username: user.username, balance: user.balance });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

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
    await db.run('DELETE FROM refresh_tokens WHERE id = ?', stored.id);
    const user = await db.get('SELECT id, username FROM users WHERE id = ?', stored.user_id);
    const accessToken = jwt.sign({ id: user.id, username: user.username }, ACCESS_TOKEN_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
    const newRefreshToken = crypto.randomBytes(64).toString('hex');
    const newTokenHash = crypto.createHash('sha256').update(newRefreshToken).digest('hex');
    const newExpiry = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();
    await db.run('INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)', [user.id, newTokenHash, newExpiry]);

    res.cookie('access_token', accessToken, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', maxAge: 15 * 60 * 1000, path: '/' });
    res.cookie('refresh_token', newRefreshToken, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', maxAge: REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000, path: '/api/auth/refresh' });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

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

// Game state
app.get('/api/state', authenticateToken, async (req, res) => {
  const db = getDb();
  try {
    const user = await db.get('SELECT username, balance, server_seed_hash, nonce, client_seed FROM users WHERE id = ?', req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ username: user.username, balance: user.balance, serverSeedHash: user.server_seed_hash, nonce: user.nonce, clientSeed: user.client_seed });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Dice bet (Protobuf)
app.post('/api/bet', authenticateToken, betLimiter, async (req, res) => {
  if (!BetRequest || !GameResponse) return res.status(500).json({ error: 'Protobuf not loaded' });
  if (!req.is('application/octet-stream')) return res.status(415).json({ error: 'Unsupported Media Type' });

  const rawBody = req.body;
  let decoded;
  try { decoded = BetRequest.decode(rawBody); } catch (e) { return sendBinaryError(res, 'Invalid Protobuf', GameResponse); }
  const { betAmount: betAmountFloat, target, condition, clientSeed: clientSeedInput } = BetRequest.toObject(decoded);

  if (betAmountFloat <= 0) return sendBinaryError(res, 'Invalid bet amount', GameResponse);
  if (!['over', 'under'].includes(condition)) return sendBinaryError(res, 'Invalid condition', GameResponse);
  if (target < 1 || target > 99) return sendBinaryError(res, 'Target must be between 1 and 99', GameResponse);

  const betAmountCents = Math.round(betAmountFloat * 100);
  if (betAmountCents <= 0) return sendBinaryError(res, 'Bet too small', GameResponse);
  const clientSeed = clientSeedInput || '';
  const db = getDb();

  try {
    await db.run('BEGIN IMMEDIATE');
    const user = await db.get('SELECT balance, server_seed, server_seed_hash, nonce FROM users WHERE id = ?', req.user.id);
    if (!user) { await db.run('ROLLBACK'); return sendBinaryError(res, 'User not found', GameResponse); }
    if (user.balance < betAmountCents) { await db.run('ROLLBACK'); return sendBinaryError(res, 'Insufficient balance', GameResponse); }

    const serverSeed = user.server_seed;
    const nonce = user.nonce;
    const roll = generateFairRoll(serverSeed, clientSeed, nonce);
    const isWin = (condition === 'over' && roll > target) || (condition === 'under' && roll < target);

    let winProbability = condition === 'over' ? (100 - target) / 100 : target / 100;
    const payoutMultiplier = (1 - HOUSE_EDGE) / winProbability;
    const profitCents = isWin ? Math.floor(betAmountCents * payoutMultiplier) - betAmountCents : -betAmountCents;
    const newBalanceCents = user.balance + profitCents;

    await db.run(
      `INSERT INTO bets (user_id, bet_amount, target, condition, roll, win, profit, server_seed_hash, server_seed, client_seed, nonce) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.user.id, betAmountCents, target, condition, roll, isWin ? 1 : 0, profitCents, user.server_seed_hash, serverSeed, clientSeed, nonce]
    );
    await db.run('UPDATE users SET balance = ?, nonce = nonce + 1, client_seed = ? WHERE id = ?', [newBalanceCents, clientSeed, req.user.id]);
    await db.run('COMMIT');

    const responsePayload = {
      roll, isWin, profit: profitCents, newBalance: newBalanceCents, betAmount: betAmountFloat,
      serverSeedRevealed: serverSeed, clientSeed, nonce, nextServerSeedHash: user.server_seed_hash, error: ''
    };
    const message = GameResponse.create(responsePayload);
    const buffer = GameResponse.encode(message).finish();

    res.set('Content-Type', 'application/octet-stream');
    res.send(Buffer.from(buffer));
    io.to(`user:${req.user.id}`).emit('bet_result', buffer);

    const maskedUsername = req.user.username.substring(0, 3) + '***';
    io.to('public').emit('public_bet', {
      username: maskedUsername, betAmount: betAmountFloat, target, condition,
      roll, isWin, profit: profitCents, timestamp: new Date().toISOString()
    });
  } catch (err) {
    await db.run('ROLLBACK').catch(() => { });
    console.error('Bet failed:', err);
    sendBinaryError(res, 'Internal server error', GameResponse);
  }
});

// Deposit & withdrawal
app.post('/api/deposit', authenticateToken, async (req, res) => {
  const { amount } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });
  const amountCents = Math.round(amount * 100);
  const db = getDb();
  const address = '0x' + crypto.randomBytes(20).toString('hex');
  const txHash = '0x' + crypto.randomBytes(32).toString('hex');
  try {
    await db.run('INSERT INTO deposits (user_id, amount, address, tx_hash) VALUES (?, ?, ?, ?)', [req.user.id, amountCents, address, txHash]);
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
    if (!deposit) return res.status(404).json({ error: 'Deposit not found' });
    await db.run('BEGIN IMMEDIATE');
    await db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [deposit.amount, deposit.user_id]);
    await db.run('UPDATE deposits SET status = ?, confirmed_at = ? WHERE id = ?', ['confirmed', new Date().toISOString(), depositId]);
    await db.run('INSERT INTO transactions (user_id, type, amount, reference_id) VALUES (?, ?, ?, ?)', [deposit.user_id, 'deposit', deposit.amount, depositId]);
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
  const { amount, walletAddress } = req.body;
  if (!amount || amount <= 0 || !walletAddress) return res.status(400).json({ error: 'Invalid request' });
  const amountCents = Math.round(amount * 100);
  const db = getDb();
  try {
    await db.run('BEGIN IMMEDIATE');
    const user = await db.get('SELECT balance FROM users WHERE id = ?', req.user.id);
    if (user.balance < amountCents) { await db.run('ROLLBACK'); return res.status(400).json({ error: 'Insufficient balance' }); }
    await db.run('UPDATE users SET balance = balance - ? WHERE id = ?', [amountCents, req.user.id]);
    await db.run('INSERT INTO withdrawals (user_id, amount, wallet_address) VALUES (?, ?, ?)', [req.user.id, amountCents, walletAddress]);
    await db.run('INSERT INTO transactions (user_id, type, amount, reference_id) VALUES (?, ?, ?, last_insert_rowid())', [req.user.id, 'withdrawal', -amountCents]);
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
  const db = getDb();
  try {
    const withdrawal = await db.get('SELECT * FROM withdrawals WHERE id = ? AND status = ?', [withdrawalId, 'pending']);
    if (!withdrawal) return res.status(404).json({ error: 'Withdrawal not found' });
    await db.run('UPDATE withdrawals SET status = ?, approved_by = ?, updated_at = ? WHERE id = ?', ['approved', req.user.id, new Date().toISOString(), withdrawalId]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Approval failed' });
  }
});

app.post('/api/admin/withdraw/reject', authenticateToken, requireAdmin, async (req, res) => {
  const { withdrawalId } = req.body;
  const db = getDb();
  try {
    const withdrawal = await db.get('SELECT * FROM withdrawals WHERE id = ? AND status = ?', [withdrawalId, 'pending']);
    if (!withdrawal) return res.status(404).json({ error: 'Withdrawal not found' });
    await db.run('BEGIN IMMEDIATE');
    await db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [withdrawal.amount, withdrawal.user_id]);
    await db.run('UPDATE withdrawals SET status = ?, updated_at = ? WHERE id = ?', ['rejected', new Date().toISOString(), withdrawalId]);
    await db.run('INSERT INTO transactions (user_id, type, amount, reference_id) VALUES (?, ?, ?, ?)', [withdrawal.user_id, 'withdrawal_reversal', withdrawal.amount, withdrawalId]);
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
    const transactions = await db.all('SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 50', req.user.id);
    res.json(transactions);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

// Leaderboard
app.get('/api/leaderboard', async (req, res) => {
  const { period = 'daily' } = req.query;
  const db = getDb();
  let dateCondition;
  if (period === 'daily') dateCondition = `b.created_at >= datetime('now', 'start of day')`;
  else if (period === 'weekly') dateCondition = `b.created_at >= datetime('now', '-7 days')`;
  else dateCondition = '1=1';

  try {
    const leaderboard = await db.all(`
      SELECT u.username, COUNT(b.id) as bets, SUM(b.bet_amount) as wagered, SUM(b.profit) as profit
      FROM bets b JOIN users u ON b.user_id = u.id WHERE ${dateCondition}
      GROUP BY u.username ORDER BY wagered DESC LIMIT 10
    `);
    const result = leaderboard.map((row, index) => ({
      rank: index + 1,
      username: row.username,
      maskedUsername: row.username.substring(0, 3) + '***',
      bets: row.bets,
      wagered: row.wagered,
      profit: row.profit,
    }));
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Leaderboard fetch failed' });
  }
});

// Crash game endpoints
app.post('/api/crash/start', authenticateToken, async (req, res) => {
  const { betAmount, clientSeed } = req.body;
  if (!betAmount || betAmount <= 0) return res.status(400).json({ error: 'Invalid bet amount' });
  const betCents = Math.round(betAmount * 100);
  const db = getDb();
  try {
    await db.run('BEGIN IMMEDIATE');
    const user = await db.get('SELECT balance, server_seed, server_seed_hash, nonce FROM users WHERE id = ?', req.user.id);
    if (!user || user.balance < betCents) { await db.run('ROLLBACK'); return res.status(400).json({ error: 'Insufficient balance' }); }

    const serverSeed = user.server_seed;
    const nonce = user.nonce;
    const crashPoint = generateCrashPoint(serverSeed, clientSeed, nonce);
    await db.run('UPDATE users SET balance = balance - ?, nonce = nonce + 1 WHERE id = ?', [betCents, req.user.id]);
    await db.run('COMMIT');

    const gameId = `${req.user.id}-${nonce}`;
    activeCrashGames.set(gameId, {
      userId: req.user.id, betCents, crashPoint, serverSeed, nonce, clientSeed,
      startTime: Date.now(), cashedOut: false,
    });
    emitCrashMultiplier(gameId);
    res.json({ gameId, serverSeedHash: user.server_seed_hash, nonce });
  } catch (err) {
    await db.run('ROLLBACK').catch(() => { });
    console.error(err);
    res.status(500).json({ error: 'Crash start failed' });
  }
});

app.post('/api/crash/cashout', authenticateToken, async (req, res) => {
  const { gameId } = req.body;
  const game = activeCrashGames.get(gameId);
  if (!game || game.userId !== req.user.id) return res.status(400).json({ error: 'Invalid game' });
  if (game.cashedOut) return res.status(400).json({ error: 'Already cashed out' });

  const elapsed = (Date.now() - game.startTime) / 1000;
  const currentMultiplier = Math.exp(elapsed * 0.1);
  const cashoutMultiplier = Math.floor(currentMultiplier * 100) / 100;

  if (cashoutMultiplier >= game.crashPoint) {
    game.cashedOut = true;
    activeCrashGames.delete(gameId);
    return res.status(400).json({ error: 'Crashed before cashout' });
  }

  game.cashedOut = true;
  activeCrashGames.delete(gameId);

  const profitCents = Math.floor(game.betCents * cashoutMultiplier) - game.betCents;
  const db = getDb();
  await db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [game.betCents + profitCents, req.user.id]);
  await db.run(
    `INSERT INTO bets (user_id, bet_amount, target, condition, roll, win, profit, server_seed_hash, server_seed, client_seed, nonce)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [req.user.id, game.betCents, 0, 'crash', cashoutMultiplier, 1, profitCents, '', game.serverSeed, game.clientSeed, game.nonce]
  );
  await db.run('INSERT INTO transactions (user_id, type, amount, reference_id) VALUES (?, ?, ?, last_insert_rowid())', [req.user.id, 'crash_win', profitCents]);
  res.json({ win: true, cashoutMultiplier, profit: profitCents });
  io.to(`user:${req.user.id}`).emit('crash:result', { win: true, multiplier: cashoutMultiplier, profit: profitCents });
});

// Mines game endpoints
app.post('/api/mines/start', authenticateToken, async (req, res) => {
  const { betAmount, clientSeed, minesCount = 3 } = req.body;
  if (!betAmount || betAmount <= 0) return res.status(400).json({ error: 'Invalid bet' });
  const betCents = Math.round(betAmount * 100);
  const db = getDb();
  try {
    await db.run('BEGIN IMMEDIATE');
    const user = await db.get('SELECT balance, server_seed, nonce FROM users WHERE id = ?', req.user.id);
    if (!user || user.balance < betCents) { await db.run('ROLLBACK'); return res.status(400).json({ error: 'Insufficient balance' }); }
    const serverSeed = user.server_seed;
    const nonce = user.nonce;
    const { mines } = generateMinesPositions(serverSeed, clientSeed, nonce, minesCount);
    await db.run('UPDATE users SET balance = balance - ?, nonce = nonce + 1 WHERE id = ?', [betCents, req.user.id]);
    await db.run('COMMIT');

    const gameId = `${req.user.id}-${nonce}`;
    activeMinesGames.set(gameId, {
      userId: req.user.id, betCents, mines: new Set(mines), minesCount,
      revealed: new Set(), serverSeed, nonce, clientSeed,
    });
    res.json({ gameId, serverSeedHash: '', nonce });
  } catch (err) {
    await db.run('ROLLBACK').catch(() => { });
    console.error(err);
    res.status(500).json({ error: 'Mines start failed' });
  }
});

app.post('/api/mines/reveal', authenticateToken, async (req, res) => {
  const { gameId, tileIndex } = req.body;
  const game = activeMinesGames.get(gameId);
  if (!game || game.userId !== req.user.id) return res.status(400).json({ error: 'Invalid game' });
  if (game.revealed.has(tileIndex)) return res.status(400).json({ error: 'Tile already revealed' });

  const isMine = game.mines.has(tileIndex);
  game.revealed.add(tileIndex);

  if (isMine) {
    const profitCents = -game.betCents;
    const db = getDb();
    await db.run(
      `INSERT INTO bets (user_id, bet_amount, target, condition, roll, win, profit, server_seed_hash, server_seed, client_seed, nonce)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.user.id, game.betCents, 0, 'mines', 0, 0, profitCents, '', game.serverSeed, game.clientSeed, game.nonce]
    );
    await db.run('INSERT INTO transactions (user_id, type, amount, reference_id) VALUES (?, ?, ?, last_insert_rowid())', [req.user.id, 'mines_loss', profitCents]);
    activeMinesGames.delete(gameId);
    res.json({ gameOver: true, win: false, mines: Array.from(game.mines), revealed: Array.from(game.revealed) });
    io.to(`user:${req.user.id}`).emit('mines:result', { win: false });
  } else {
    const gemsFound = game.revealed.size;
    const multiplier = MINES_PAYOUT_3[gemsFound] || MINES_PAYOUT_3[MINES_PAYOUT_3.length - 1];
    res.json({ gameOver: false, multiplier, gemsFound, tileIndex });
  }
});

app.post('/api/mines/cashout', authenticateToken, async (req, res) => {
  const { gameId } = req.body;
  const game = activeMinesGames.get(gameId);
  if (!game || game.userId !== req.user.id) return res.status(400).json({ error: 'Invalid game' });

  const gemsFound = game.revealed.size;
  const multiplier = MINES_PAYOUT_3[gemsFound] || MINES_PAYOUT_3[MINES_PAYOUT_3.length - 1];
  const profitCents = Math.floor(game.betCents * multiplier) - game.betCents;
  const db = getDb();
  await db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [game.betCents + profitCents, req.user.id]);
  await db.run(
    `INSERT INTO bets (user_id, bet_amount, target, condition, roll, win, profit, server_seed_hash, server_seed, client_seed, nonce)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [req.user.id, game.betCents, 0, 'mines', multiplier, 1, profitCents, '', game.serverSeed, game.clientSeed, game.nonce]
  );
  await db.run('INSERT INTO transactions (user_id, type, amount, reference_id) VALUES (?, ?, ?, last_insert_rowid())', [req.user.id, 'mines_win', profitCents]);
  activeMinesGames.delete(gameId);
  res.json({ win: true, multiplier, profit: profitCents });
  io.to(`user:${req.user.id}`).emit('mines:result', { win: true, profit: profitCents });
});

// ---------------------------------------------------------------------------
// Admin endpoints
// ---------------------------------------------------------------------------
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

app.get('/api/admin/user/search', authenticateToken, requireAdmin, async (req, res) => {
  const { username } = req.query;
  if (!username) return res.status(400).json({ error: 'Missing username' });
  const db = getDb();
  try {
    const user = await db.get(`SELECT id, username, balance, nonce, created_at FROM users WHERE username LIKE ?`, `%${username}%`);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Search failed' }); }
});

app.post('/api/admin/user/rotate-seed', authenticateToken, requireAdmin, async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'Missing userId' });
  const db = getDb();
  try {
    const user = await db.get('SELECT id FROM users WHERE id = ?', userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const newSeed = crypto.randomBytes(32).toString('hex');
    const newSeedHash = crypto.createHash('sha256').update(newSeed).digest('hex');
    await db.run('UPDATE users SET server_seed = ?, server_seed_hash = ?, nonce = 0 WHERE id = ?', [newSeed, newSeedHash, userId]);
    res.json({ success: true, newHash: newSeedHash });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Seed rotation failed' }); }
});

app.post('/api/admin/user/adjust-balance', authenticateToken, requireAdmin, async (req, res) => {
  const { userId, amount } = req.body;
  if (!userId || !amount) return res.status(400).json({ error: 'Missing userId or amount' });
  const amountCents = Math.round(parseFloat(amount) * 100);
  const db = getDb();
  try {
    await db.run('BEGIN IMMEDIATE');
    const user = await db.get('SELECT balance FROM users WHERE id = ?', userId);
    if (!user) { await db.run('ROLLBACK'); return res.status(404).json({ error: 'User not found' }); }
    await db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [amountCents, userId]);
    await db.run('INSERT INTO transactions (user_id, type, amount, reference_id) VALUES (?, ?, ?, ?)', [userId, amountCents >= 0 ? 'admin_credit' : 'admin_debit', amountCents, null]);
    await db.run('COMMIT');
    res.json({ success: true });
  } catch (err) { await db.run('ROLLBACK').catch(() => { }); console.error(err); res.status(500).json({ error: 'Balance adjustment failed' }); }
});

app.get('/api/admin/bets', authenticateToken, requireAdmin, async (req, res) => {
  const db = getDb();
  const { limit = 50, offset = 0 } = req.query;
  try {
    const bets = await db.all(`SELECT b.*, u.username FROM bets b JOIN users u ON b.user_id = u.id ORDER BY b.created_at DESC LIMIT ? OFFSET ?`, [parseInt(limit), parseInt(offset)]);
    res.json(bets);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to fetch bets' }); }
});

app.get('/api/admin/stats', authenticateToken, requireAdmin, async (req, res) => {
  const db = getDb();
  try {
    const stats = await db.get(`
      SELECT (SELECT COUNT(*) FROM users) AS totalUsers,
             (SELECT COUNT(*) FROM bets) AS totalBets,
             (SELECT COALESCE(SUM(profit), 0) FROM bets WHERE win = 1) AS totalWagered,
             (SELECT COALESCE(SUM(profit), 0) FROM bets) AS platformProfit
    `);
    res.json(stats);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Stats failed' }); }
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
// Static files & SPA catch-all
// ---------------------------------------------------------------------------
app.get('/game.proto', (req, res) => {
  const clientPath = path.join(__dirname, 'client/public/game.proto');
  if (fs.existsSync(clientPath)) res.sendFile(clientPath);
  else res.sendFile(path.join(__dirname, 'game.proto'));
});

app.get(/.*/, (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404);
  res.sendFile(path.join(__dirname, 'client/dist/index.html'));
});

// ---------------------------------------------------------------------------
// Server startup
// ---------------------------------------------------------------------------
(async () => {
  try {
    await initializeDatabase();
    server.listen(PORT, () => console.log(`🤖 Secure Binary Chain Server running on http://localhost:${PORT}`));

    process.on('SIGTERM', async () => {
      console.log('SIGTERM received, shutting down gracefully...');
      const db = getDb();
      if (db) await db.close();
      process.exit(0);
    });
  } catch (err) {
    console.error('Failed to initialise database:', err);
    process.exit(1);
  }
})();