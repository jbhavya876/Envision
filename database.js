/**
 * @file Database Configuration
 * @description SQLite database initialization and schema setup for the casino application.
 * Creates and manages user accounts and bet history tables.
 * 
 * @requires sqlite3
 */

const sqlite3 = require('sqlite3').verbose();

/**
 * SQLite database instance
 * Uses WAL (Write-Ahead Logging) mode for better concurrent access
 * @type {sqlite3.Database}
 */
const db = new sqlite3.Database('./casino.db', (err) => {
    if (err) console.error("Could not connect to database", err);
    else {
        console.log("✅ Connected to SQLite database");
        // Enable WAL mode for better performance with concurrent reads/writes
        db.run("PRAGMA journal_mode = WAL;");
    }
});

// ============================================================================
// DATABASE SCHEMA
// ============================================================================

db.serialize(() => {
    /**
     * Users Table
     * Stores user authentication and balance information
     * - id: Auto-incrementing primary key
     * - username: Unique identifier for login
     * - password_hash: Bcrypt hashed password
     * - balance: User's current balance (starts at 1000.00)
     */
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password_hash TEXT,
        balance REAL DEFAULT 1000.00
    )`);

    /**
     * Bets Table
     * Records all betting activity for provably fair verification
     * - id: Auto-incrementing primary key
     * - user_id: Foreign key to users table
     * - nonce: Sequential number for this bet
     * - bet_amount: Amount wagered
     * - target: Target number (default 50)
     * - condition: 'over' or 'under'
     * - roll: Actual roll result (0.00-100.00)
     * - profit: Win/loss amount
     * - client_seed: Client-provided randomness seed
     * - server_seed: Revealed server seed (for verification)
     * - timestamp: When the bet was placed
     */
    db.run(`CREATE TABLE IF NOT EXISTS bets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        nonce INTEGER,
        bet_amount REAL,
        target REAL,
        condition TEXT,
        roll REAL,
        profit REAL,
        client_seed TEXT,
        server_seed TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

module.exports = db;