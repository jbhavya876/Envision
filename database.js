const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');

let db;

async function initializeDatabase() {
  db = await open({
    filename: path.join(__dirname, 'betting.db'),
    driver: sqlite3.Database,
  });

  await db.exec('PRAGMA journal_mode=WAL;');
  await db.exec('PRAGMA foreign_keys=ON;');

  // Users table (unchanged)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      balance INTEGER NOT NULL DEFAULT 100000,
      server_seed TEXT NOT NULL,
      server_seed_hash TEXT NOT NULL,
      client_seed TEXT NOT NULL DEFAULT '',
      nonce INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Bets table (unchanged)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS bets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      bet_amount INTEGER NOT NULL,
      target REAL NOT NULL,
      condition TEXT NOT NULL,
      roll REAL NOT NULL,
      win INTEGER NOT NULL DEFAULT 0,
      profit INTEGER NOT NULL,
      server_seed_hash TEXT NOT NULL,
      server_seed TEXT NOT NULL,
      client_seed TEXT NOT NULL,
      nonce INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
  `);

  // Refresh tokens table (unchanged)
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

  // ========== NEW TABLES FOR PHASE 2 ==========

  // Deposits (simulated)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS deposits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      amount INTEGER NOT NULL,            -- in cents
      status TEXT NOT NULL DEFAULT 'pending',  -- 'pending', 'confirmed', 'rejected'
      address TEXT,                        -- simulated deposit address
      tx_hash TEXT,                        -- simulated transaction hash
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      confirmed_at DATETIME,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
  `);

  // Withdrawals
  await db.exec(`
    CREATE TABLE IF NOT EXISTS withdrawals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      amount INTEGER NOT NULL,            -- in cents
      wallet_address TEXT NOT NULL,       -- simulated external wallet address
      status TEXT NOT NULL DEFAULT 'pending',  -- 'pending', 'approved', 'rejected'
      approved_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME,
      FOREIGN KEY(user_id) REFERENCES users(id),
      FOREIGN KEY(approved_by) REFERENCES users(id)
    );
  `);

  // Full transaction ledger (bets, deposits, withdrawals)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,                 -- 'bet', 'deposit', 'withdrawal'
      amount INTEGER NOT NULL,            -- positive for credit, negative for debit
      reference_id INTEGER,              -- id of the related bet/deposit/withdrawal
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
  `);

  // Indexes for performance
  await db.exec('CREATE INDEX IF NOT EXISTS idx_bets_user_created ON bets(user_id, created_at);');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_refresh_token_hash ON refresh_tokens(token_hash);');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id, created_at);');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_deposits_user ON deposits(user_id, status);');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_withdrawals_user ON withdrawals(user_id, status);');

  console.log('✅ Database initialized (Phase 2 tables ready)');
  return db;
}

module.exports = { initializeDatabase, getDb: () => db };