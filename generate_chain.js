const crypto = require('crypto');
const fs = require('fs');

const CHAIN_SIZE = 100; // In production, this would be 10,000,000

console.log(`🔗 Generating Chain of ${CHAIN_SIZE} seeds...`);

// 1. The "Secret" starting point (only known to admin initially)
let currentSeed = crypto.randomBytes(32).toString('hex');
const chain = [currentSeed];

// 2. Hash it forward 100 times
for (let i = 0; i < CHAIN_SIZE; i++) {
    // SHA256 Hash
    currentSeed = crypto.createHash('sha256').update(currentSeed).digest('hex');
    chain.push(currentSeed);
}

// 3. Save REVERSED (So we pop from the top)
// The "last" generated hash becomes index 0 (The Public Anchor)
const reverseChain = chain.reverse();

fs.writeFileSync('chain.json', JSON.stringify(reverseChain, null, 2));

console.log("✅ Chain Generated!");
console.log("---------------------------------------");
console.log(`📜 PUBLIC ANCHOR (Publish this!): ${reverseChain[0]}`);
console.log(`🛑 TERMINAL SEED (Game #1):       ${reverseChain[1]}`);