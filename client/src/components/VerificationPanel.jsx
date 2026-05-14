import React, { useState } from "react";
import CryptoJS from "crypto-js";

function VerificationPanel({ activeHash, lastSeed, lastNonce, lastClientSeed, actualRoll }) {
  const [verificationResult, setVerificationResult] = useState("");

  const verify = () => {
    // Verify seed commitment: SHA256(revealed seed) should equal the hash we had before the bet
    const computedHash = CryptoJS.SHA256(lastSeed).toString(CryptoJS.enc.Hex);
    if (computedHash !== activeHash) {
      setVerificationResult("Seed commitment broken! Hashes do not match.");
      return;
    }

    // Verify roll: HMAC-SHA256(clientSeed:nonce, serverSeed)
    const message = `${lastClientSeed}:${lastNonce}`;
    const hmac = CryptoJS.HmacSHA256(message, lastSeed);
    const buffer = hmac.toString(CryptoJS.enc.Hex);
    // Convert first 4 bytes to uint32
    const resultInt = parseInt(buffer.substring(0, 8), 16);
    const roll = ((resultInt % 10001) / 100).toFixed(2);
    if (Math.abs(roll - actualRoll) < 0.01) {
      setVerificationResult("✅ Verified – fair roll!");
    } else {
      setVerificationResult("❌ Roll manipulation detected!");
    }
  };

  return (
    <div className="verification-panel">
      <h3>Provably Fair</h3>
      <div>
        <strong>Active Hash:</strong> {activeHash
          ? activeHash.substring(0, 20) + "..."
          : "Loading..."}
      </div>
      <div>
        <strong>Last Seed:</strong> {lastSeed.substring(0, 20)}...
      </div>
      <div>
        <strong>Nonce:</strong> {lastNonce}
      </div>
      <div>
        <strong>Client Seed:</strong> {lastClientSeed}
      </div>
      <div>
        <strong>Actual Roll:</strong> {actualRoll.toFixed(2)}
      </div>
      <button onClick={verify}>Verify Last Bet</button>
      <p className={verificationResult.includes("✅") ? "success" : "error"}>
        {verificationResult}
      </p>
    </div>
  );
}

export default VerificationPanel;