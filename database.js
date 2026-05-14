const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');
const bcrypt = require('bcrypt');

let db;

async function initializeDatabase() {
  db = await open({
    filename: path.join(__dirname, 'betting.db'),  // new filename
    driver: sqlite3.Database,
  });

  await db.exec('PRAGMA journal_mode=WAL;');
  await db.exec('PRAGMA foreign_keys=ON;');  // enforce FK constraints

  // Users table – balance in cents, seed fields, per‑user nonce
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      balance INTEGER NOT NULL DEFAULT 100000,   -- 1000.00 in cents
      server_seed TEXT NOT NULL,
      server_seed_hash TEXT NOT NULL,             -- SHA256(server_seed), sent to client
      client_seed TEXT NOT NULL DEFAULT '',       -- last used client seed
      nonce INTEGER NOT NULL DEFAULT 0,           -- per‑user bet counter
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Bets table – all monetary values in cents
  await db.exec(`
    CREATE TABLE IF NOT EXISTS bets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      bet_amount INTEGER NOT NULL,               -- cents
      target REAL NOT NULL,                       -- e.g., 50.0 for over/under
      condition TEXT NOT NULL,                    -- 'over' or 'under'
      roll REAL NOT NULL,                         -- 0.00–100.00
      win INTEGER NOT NULL DEFAULT 0,             -- boolean
      profit INTEGER NOT NULL,                    -- cents, may be negative
      server_seed_hash TEXT NOT NULL,             -- hash BEFORE this bet
      server_seed TEXT NOT NULL,                  -- revealed seed (now available)
      client_seed TEXT NOT NULL,
      nonce INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
  `);

  // Refresh tokens for HttpOnly cookie auth
  await db.exec(`
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT UNIQUE NOT NULL,
      expires_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
  `);

  // Indexes for performance
  await db.exec('CREATE INDEX IF NOT EXISTS idx_bets_user_created ON bets(user_id, created_at);');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_refresh_token_hash ON refresh_tokens(token_hash);');

  console.log('✅ Database initialized');
  return db;
}

module.exports = { initializeDatabase, getDb: () => db };