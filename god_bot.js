// god-bot.js - The Cheating Bot that Never Loses money

const protobuf = require('protobufjs');
const crypto = require('crypto'); // We need this to simulate the server's math

// ⚙️ CONFIG
const CONFIG = {
    peekUrl: "http://localhost:3000/api/admin/peek",
    betUrl: "http://localhost:3000/api/bet",
    clientSeed: "god-mode-seed", // We can use a fixed seed since we know the server's seed
    target: 50.00
};

// 🔮 CRYSTAL BALL FUNCTION
// This replicates the server's exact math logic locally
function predictOutcome(serverSeed, clientSeed, nonce) {
    const hmac = crypto.createHmac('sha256', serverSeed);
    hmac.update(`${clientSeed}:${nonce}`);
    const buffer = hmac.digest();
    const resultInt = buffer.readUInt32BE(0);
    const roll = (resultInt % 10001) / 100;
    return roll;
}

// 🚀 START
console.log("🕵️ GOD MODE ACTIVATED: Connecting to Binary Schema...");

protobuf.load("game.proto", async function (err, root) {
    if (err) throw err;
    const BetRequest = root.lookupType("BetRequest");
    const GameResponse = root.lookupType("GameResponse");

    // Start the cheating loop
    while (true) {
        try {
            // 1. PEEK (Steal the Secret)
            const peekRes = await fetch(CONFIG.peekUrl);
            const peekData = await peekRes.json();

            // 2. PREDICT THE FUTURE
            const predictedRoll = predictOutcome(peekData.serverSeed, CONFIG.clientSeed, peekData.nonce);
            const isWin = predictedRoll > CONFIG.target; // We are betting "Over 50"

            // 3. DECIDE BET SIZE
            // If we know we win, bet BIG. If we know we lose, bet TINY (to burn the bad seed).
            let betAmount = isWin ? 100.00 : 0.01;
            let logColor = isWin ? "\x1b[32m" : "\x1b[31m"; // Green or Red

            console.log(`🔮 Prediction: Roll will be ${predictedRoll.toFixed(2)} | Action: Bet $${betAmount}`);

            // 4. EXECUTE THE BINARY BET
            const payload = {
                betAmount: betAmount,
                target: CONFIG.target,
                condition: "over",
                clientSeed: CONFIG.clientSeed
            };

            const message = BetRequest.create(payload);
            const buffer = BetRequest.encode(message).finish();

            const betRes = await fetch(CONFIG.betUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/octet-stream' },
                body: buffer
            });

            // 5. VERIFY (Decode Response)
            const resBuffer = await betRes.arrayBuffer();
            const decoded = GameResponse.decode(new Uint8Array(resBuffer));
            const result = GameResponse.toObject(decoded);

            console.log(`${logColor}   Result: ${result.isWin ? "WIN " : "LOSS"} | Profit: $${result.profit.toFixed(2)} | Bal: $${result.newBalance.toFixed(2)}\x1b[0m`);
            console.log("---------------------------------------------------");

            // Wait a bit to look "human"
            await new Promise(r => setTimeout(r, 500));

        } catch (e) {
            console.error("❌ Error:", e.message);
            break;
        }
    }
});