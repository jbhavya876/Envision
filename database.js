const sqlite3 = require('sqlite3').verbose();

// Connect to a file-based database (creates casino.db if missing)
const db = new sqlite3.Database('./casino.db', (err) => {
    if (err) console.error("Could not connect to database", err);
    else {
        console.log("✅ Connected to SQLite database");
        // 🚀 SPEED BOOST: Enable WAL Mode
        db.run("PRAGMA journal_mode = WAL;");
    }
});

// Initialize Tables
db.serialize(() => {
    // 1. Users Table (Stores Balance)
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT,
        balance REAL
    )`);

    // 2. Bets Table (Stores History)
    db.run(`CREATE TABLE IF NOT EXISTS bets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
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

    // 3. Create Default User (Player 1) if not exists
    db.get("SELECT * FROM users WHERE id = 1", (err, row) => {
        if (!row) {
            db.run("INSERT INTO users (username, balance) VALUES ('player1', 1000.00)");
            console.log("👤 Default user created with $1000.00");
        }
    });
});

module.exports = db;