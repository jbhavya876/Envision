const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database('./casino.db', (err) => {
    if (err) console.error("Could not connect to database", err);
    else {
        console.log("✅ Connected to SQLite database");
        db.run("PRAGMA journal_mode = WAL;"); 
    }
});

db.serialize(() => {
    // 1. Users Table - ADDED "DEFAULT 1000"
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password_hash TEXT,
        balance REAL DEFAULT 1000.00
    )`);

    // 2. Bets Table
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