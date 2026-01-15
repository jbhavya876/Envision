/**
 * @file Provably Fair Seed Chain Generator
 * @description Generates a chain of cryptographically linked seeds for provably fair gaming.
 * 
 * How it works:
 * 1. Start with a random secret seed
 * 2. Hash it repeatedly using SHA-256
 * 3. Reverse the chain so the last hash becomes the public anchor
 * 4. Each game reveals the previous seed, proving fairness
 * 
 * The chain is stored in reverse order:
 * - chain[0] = Public anchor (hash of all future seeds)
 * - chain[1] = First game seed
 * - chain[n] = Last game seed
 * 
 * @requires crypto
 * @requires fs
 */

const crypto = require('crypto');
const fs = require('fs');

// Configuration
const CHAIN_SIZE = 100; // In production, use 10,000,000 for long-term operation

console.log(`🔗 Generating Chain of ${CHAIN_SIZE} seeds...`);

// ============================================================================
// CHAIN GENERATION
// ============================================================================

/**
 * Step 1: Generate the secret starting seed
 * This is the "terminal seed" - the final secret that proves the chain's integrity
 */
let currentSeed = crypto.randomBytes(32).toString('hex');
const chain = [currentSeed];

/**
 * Step 2: Hash forward to create the chain
 * Each seed is the SHA-256 hash of the previous seed
 * This creates a cryptographic link that can be verified backwards
 */
for (let i = 0; i < CHAIN_SIZE; i++) {
    currentSeed = crypto.createHash('sha256').update(currentSeed).digest('hex');
    chain.push(currentSeed);
}

/**
 * Step 3: Reverse the chain
 * The last generated hash becomes index 0 (the public anchor)
 * This allows us to reveal seeds in order while maintaining provable fairness
 * 
 * Verification process:
 * - hash(chain[1]) should equal chain[0] (public anchor)
 * - hash(chain[2]) should equal chain[1]
 * - And so on...
 */
const reverseChain = chain.reverse();

// ============================================================================
// SAVE TO FILE
// ============================================================================

fs.writeFileSync('chain.json', JSON.stringify(reverseChain, null, 2));

console.log("✅ Chain Generated!");
console.log("---------------------------------------");
console.log(`📜 PUBLIC ANCHOR (Publish this!): ${reverseChain[0]}`);
console.log(`🛑 TERMINAL SEED (Game #1):       ${reverseChain[1]}`);
console.log("---------------------------------------");
console.log("💡 The public anchor proves all future seeds are pre-determined.");
console.log("💡 After each game, the revealed seed can be hashed to verify the previous hash.");