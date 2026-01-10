// bot.js - The Binary Protocol Bot (Final Version)
const protobuf = require('protobufjs');

// ==========================================
// ⚙️ CONFIGURATION & SAFETY LIMITS
// ==========================================
const CONFIG = {
    serverUrl: "http://localhost:3000/api/bet",

    // Game Settings
    baseBet: 1.00,          // Start with $1.00
    target: 50.00,          // Win chance ~50%
    condition: "over",      // "over" or "under"

    // 🛡️ RISK CONTROLS
    durationSeconds: 30,    // 4. TIME CAP: Stop after 30    seconds
    maxDoublingSteps: 4,    // 1. MAX DOUBLING: Stop doubling after 4 losses (1->2->4->8->STOP)
    stopLoss: 50.00,        // 2. STOP LOSS: Stop if we lose more than $50 total
    takeProfit: 100.00,     // 3. TAKE PROFIT: Stop if we profit more than $100 total
    maxBetSafety: 200.00    // hard cap: Never bet more than this
};

// ==========================================
// 📊 STATE TRACKING
// ==========================================
let currentBet = CONFIG.baseBet;
let consecutiveLosses = 0;
let totalProfit = 0.00;
let totalWins = 0;
let totalLosses = 0;
let startTime = Date.now();

// ==========================================
// 🚀 INITIALIZATION
// ==========================================
console.log("⏳ Loading Binary Schema (game.proto)...");

protobuf.load("game.proto", async function (err, root) {
    if (err) {
        console.error("❌ Failed to load game.proto:", err);
        process.exit(1);
    }

    // Load the Protocol Definitions
    const BetRequest = root.lookupType("BetRequest");
    const GameResponse = root.lookupType("GameResponse");

    console.log("✅ Schema Loaded! Bot is starting...");
    await startBot(BetRequest, GameResponse);
});

// ==========================================
// 🤖 THE BOT ENGINE
// ==========================================
async function startBot(BetRequest, GameResponse) {
    const endTime = startTime + (CONFIG.durationSeconds * 1000);

    console.log("-------------------------------------------------------------------------------------------------");
    console.log(" RESULT | BET      | ROLL  | P/L      | BALANCE   | BINARY TRAFFIC");
    console.log("-------------------------------------------------------------------------------------------------");

    while (Date.now() < endTime) {

        // --- CHECK SAFETY LIMITS ---
        if (totalProfit <= -CONFIG.stopLoss) {
            console.log(`\n🛑 STOP LOSS HIT: -$${Math.abs(totalProfit).toFixed(2)}`);
            break;
        }
        if (totalProfit >= CONFIG.takeProfit) {
            console.log(`\n🎉 TAKE PROFIT HIT: +$${totalProfit.toFixed(2)}`);
            break;
        }

        // 1. PREPARE PAYLOAD (Object)
        const payload = {
            betAmount: currentBet,
            target: CONFIG.target,
            condition: CONFIG.condition,
            clientSeed: "bot-" + Date.now() // Unique seed
        };

        try {
            // 2. ENCODE TO BINARY (Request)
            // Verify payload matches schema
            const errMsg = BetRequest.verify(payload);
            if (errMsg) throw Error(errMsg);

            // Create message & Encode
            const message = BetRequest.create(payload);
            const reqBuffer = BetRequest.encode(message).finish();

            // 3. SEND BINARY HTTP REQUEST
            const response = await fetch(CONFIG.serverUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/octet-stream' // Tells server "This is binary"
                },
                body: reqBuffer
            });

            // 4. DECODE BINARY RESPONSE
            const resBuffer = await response.arrayBuffer(); // Get raw bytes
            const resUint8 = new Uint8Array(resBuffer);

            // Decode back to Object
            const decoded = GameResponse.decode(resUint8);
            const data = GameResponse.toObject(decoded);

            if (data.error) {
                console.log(`⚠️ SERVER ERROR: ${data.error}`);
                break;
            }

            // --- UPDATE STATS ---
            totalProfit += data.profit;

            const color = data.isWin ? "\x1b[32m" : "\x1b[31m"; // Green / Red
            const reset = "\x1b[0m";
            const icon = data.isWin ? "WIN " : "LOSS";

            const betStr = `$${currentBet.toFixed(2)}`;
            const rollStr = data.roll.toFixed(2);
            const plStr = (totalProfit >= 0 ? "+" : "") + `$${totalProfit.toFixed(2)}`;
            const balStr = `$${data.newBalance.toFixed(2)}`;

            // Log with Binary Stats
            console.log(
                `${color}${icon}${reset} | ` +
                `${betStr.padEnd(8)} | ` +
                `${rollStr.padEnd(5)} | ` +
                `${plStr.padEnd(8)} | ` +
                `${balStr.padEnd(9)} | ` +
                `📤 ${reqBuffer.length}B / 📥 ${resUint8.length}B`
            );

            // --- STRATEGY LOGIC (Martingale) ---
            if (data.isWin) {
                totalWins++;
                consecutiveLosses = 0;
                currentBet = CONFIG.baseBet;
            } else {
                totalLosses++;
                consecutiveLosses++;
                if (consecutiveLosses >= CONFIG.maxDoublingSteps) {
                    console.log(`   ⚠️ Max doubling limit hit. Resetting.`);
                    currentBet = CONFIG.baseBet;
                    consecutiveLosses = 0;
                } else {
                    currentBet = currentBet * 2;
                    if (currentBet > CONFIG.maxBetSafety) currentBet = CONFIG.baseBet;
                }
            }

        } catch (error) {
            console.error("❌ CRITICAL ERROR:", error.message);
            break;
        }

        // Throttle (100ms delay)
        await new Promise(r => setTimeout(r, 100));
    }

    // --- FINAL REPORT ---
    console.log("\n========================================================================================");
    console.log(`🏁 SESSION FINISHED`);
    console.log(`   Wins: ${totalWins} | Losses: ${totalLosses}`);
    if (totalProfit >= 0) console.log(`   🚀 Net Profit: \x1b[32m$${totalProfit.toFixed(2)}\x1b[0m`);
    else console.log(`   📉 Net Loss:   \x1b[31m$${Math.abs(totalProfit).toFixed(2)}\x1b[0m`);
    console.log("========================================================================================");
}