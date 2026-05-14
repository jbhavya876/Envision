/**
 * @file Binary Dice Casino - Main Application Component (Phase 1 Hardened)
 * @description Root React component.
 *   - Uses HttpOnly cookies for authentication (no localStorage token)
 *   - Silent token refresh on 403 responses
 *   - Socket.IO with credentials and private rooms
 *   - Balance displayed as dollars (server returns cents)
 */

import React, { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";
import protobuf from "protobufjs";
import BalanceChart from "./components/BalanceChart";
import GamePanel from "./components/GamePanel";
import VerificationPanel from "./components/VerificationPanel";
import HistoryTable from "./components/HistoryTable";
import AuthForm from "./components/AuthForm";
import AdminPanel from "./components/AdminPanel";
import WalletPanel from "./components/WalletPanel";
import LiveBets from "./components/LiveBets";
import Leaderboard from "./components/Leaderboard";

/**
 * Wrapper around fetch that includes credentials and silently refreshes
 * the access token on a 403 response.
 */
async function authenticatedFetch(url, options = {}) {
  let res = await fetch(url, { ...options, credentials: "include" });

  if (res.status === 403) {
    // Try to refresh the token
    const refreshRes = await fetch("/api/auth/refresh", {
      method: "POST",
      credentials: "include",
    });
    if (refreshRes.ok) {
      // Retry the original request
      res = await fetch(url, { ...options, credentials: "include" });
    } else {
      // Refresh failed – force logout
      window.dispatchEvent(new Event("force-logout"));
      throw new Error("Session expired");
    }
  }
  return res;
}

function App() {
  // ============================================================================
  // SESSION RECOVERY ON PAGE LOAD
  // ============================================================================

  useEffect(() => {
    const tryRecoverSession = async () => {
      try {
        // Try to get state with existing cookies
        const res = await authenticatedFetch("/api/state");
        if (!res.ok) throw new Error("No session");
        const data = await res.json();
        setUsername(data.username || "Unknown");
        setIsLoggedIn(true);
        setBalance((data.balance / 100).toFixed(2));
        setActiveHash(data.serverSeedHash);
        // No need to set chartData here – fetchInitialState will run after isLoggedIn becomes true
      } catch (e) {
        // Not logged in – stay on login form
      }
    };

    tryRecoverSession();
  }, []); // run once on mount

  const [socket, setSocket] = useState(null);

  // ============================================================================
  // AUTHENTICATION STATE (no localStorage for token)
  // ============================================================================

  /** Whether the user is logged in (true if username is set) */
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  /** Current logged-in username */
  const [username, setUsername] = useState("");

  // ============================================================================
  // GAME STATE
  // ============================================================================

  /** User's current balance in dollars (converted from cents) */
  const [balance, setBalance] = useState("...");

  /** Last roll result (0.00-100.00) */
  const [rollResult, setRollResult] = useState("0.00");

  /** Whether the last bet was a win */
  const [isWin, setIsWin] = useState(null);

  /** Current server seed hash (for provably fair verification) */
  const [activeHash, setActiveHash] = useState("Loading...");

  /** System ready state – true when Protobuf schema is loaded */
  const [isSystemReady, setIsSystemReady] = useState(false);

  // ============================================================================
  // PROVABLY FAIR VERIFICATION STATE
  // ============================================================================

  /** Last revealed server seed */
  const [lastSeed, setLastSeed] = useState("No bets yet");

  /** Last nonce (bet number) */
  const [lastNonce, setLastNonce] = useState("-");

  /** Last client seed used */
  const [lastClientSeed, setLastClientSeed] = useState("");

  /** Actual roll result for verification */
  const [actualRoll, setActualRoll] = useState(0);

  /** Bet history (last 15 bets) */
  const [history, setHistory] = useState([]);

  /** Chart data for balance visualization */
  const [chartData, setChartData] = useState({ labels: [], data: [] });

  // ============================================================================
  // REFS FOR SOCKET.IO AND PROTOBUF
  // ============================================================================

  /** Socket.IO connection reference */
  const socketRef = useRef(null);

  /** Protobuf BetRequest message type */
  const BetRequestRef = useRef(null);

  /** Protobuf GameResponse message type */
  const GameResponseRef = useRef(null);

  // ============================================================================
  // AUTHENTICATION HANDLERS
  // ============================================================================

  /**
   * Handle successful login.
   * The server has already set HttpOnly cookies; we just store the username.
   * @param {string} user - Username returned by server
   * @param {number} balanceCents - Initial balance in cents
   */
  const handleLogin = (user, balanceCents) => {
    setUsername(user);
    setIsLoggedIn(true);
    setBalance((balanceCents / 100).toFixed(2)); // Convert cents to dollars
  };

  /**
   * Handle user logout.
   * Calls the logout endpoint to clear cookies, then resets state.
   */
  const handleLogout = async () => {
    try {
      await authenticatedFetch("/api/auth/logout", { method: "POST" });
    } catch (e) {
      // ignore errors
    }
    setUsername("");
    setIsLoggedIn(false);
    setBalance("...");
    if (socketRef.current) socketRef.current.disconnect();
  };

  // Listen for a forced logout (e.g., from a failed token refresh)
  useEffect(() => {
    const forceLogout = () => handleLogout();
    window.addEventListener("force-logout", forceLogout);
    return () => window.removeEventListener("force-logout", forceLogout);
  }, []);

  // ============================================================================
  // INITIALIZATION & REAL-TIME UPDATES
  // ============================================================================

  /**
   * Initialize Socket.IO connection and load Protobuf schema.
   * Runs when isLoggedIn becomes true.
   */
  useEffect(() => {
    if (!isLoggedIn) return;

    // 1. Initialize Socket.IO with credentials (cookies)
    const newSocket = io(window.location.origin, { withCredentials: true });
    socketRef.current = newSocket;
    setSocket(newSocket);

    // 2. Load Protobuf Schema
    protobuf.load("/game.proto", (err, root) => {
      if (err) {
        alert("Failed to load binary schema");
        return;
      }
      BetRequestRef.current = root.lookupType("BetRequest");
      GameResponseRef.current = root.lookupType("GameResponse");

      setIsSystemReady(true);
      fetchInitialState();
    });

    // 3. Listen for private bet_result events
    socketRef.current.on("bet_result", (buffer) => {
      try {
        if (!GameResponseRef.current) return;
        const uint8 = new Uint8Array(buffer);
        const decoded = GameResponseRef.current.decode(uint8);
        const data = GameResponseRef.current.toObject(decoded);
        updateDashboard(data);
      } catch (e) {
        console.error("Error decoding game update:", e);
      }
    });

    // Cleanup
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, [isLoggedIn]);

  // ============================================================================
  // API FUNCTIONS
  // ============================================================================

  /**
   * Fetch initial game state using authenticated fetch.
   */
  const fetchInitialState = async () => {
    try {
      const res = await authenticatedFetch("/api/state");
      if (!res.ok) {
        console.error("Failed to fetch state:", res.status);
        return;
      }
      const data = await res.json();
      // Balance is in cents; convert to dollars for display
      setBalance((data.balance / 100).toFixed(2));
      setActiveHash(data.serverSeedHash);

      if (data.nonce) {
        setChartData({
          labels: [data.nonce],
          data: [data.balance / 100],
        });
      }
    } catch (error) {
      console.error("Error fetching initial state:", error);
    }
  };

  /**
   * Place a bet.
   */
  const handlePlayGame = async (betAmount, clientSeed, condition) => {
    if (!BetRequestRef.current || !isSystemReady) {
      console.error("System not ready");
      return;
    }

    const payload = { betAmount, target: 50, condition, clientSeed };

    const err = BetRequestRef.current.verify(payload);
    if (err) return alert(err);

    const message = BetRequestRef.current.create(payload);
    const buffer = BetRequestRef.current.encode(message).finish();

    try {
      const res = await authenticatedFetch("/api/bet", {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: buffer,
      });

      if (!res.ok) {
        console.error("Bet failed:", res.status);
        // The socket will not fire if the server rejected the bet,
        // so we might want to show an error here.
        return;
      }
      // DO NOT manually decode the response here – the socket event will update the UI.
      // If you want immediate feedback, you can still decode, but then skip the socket update
      // to avoid double entries. We'll rely solely on the socket.
    } catch (error) {
      console.error("Error placing bet:", error);
    }
  };

  // ============================================================================
  // UI UPDATE HANDLER
  // ============================================================================

  /**
   * Update dashboard with new game results.
   * @param {Object} data - Game response data (profit & newBalance are in cents)
   */
  const updateDashboard = (data) => {
    setRollResult(data.roll.toFixed(2));
    setIsWin(data.isWin);
    // Convert cents to dollars
    setBalance((data.newBalance / 100).toFixed(2));
    setActualRoll(data.roll);

    setLastSeed(data.serverSeedRevealed);
    setLastClientSeed(data.clientSeed);
    setLastNonce(data.nonce);
    // Show the hash for next round (we got nextServerSeedHash)
    setActiveHash(data.nextServerSeedHash);

    setHistory((prev) => {
      const newHistory = [
        {
          nonce: data.nonce,
          roll: data.roll,
          betAmount: data.betAmount,
          profit: data.profit, // still in cents, can be displayed after conversion if needed
          isWin: data.isWin,
        },
        ...prev,
      ];
      return newHistory.slice(0, 15);
    });

    setChartData((prev) => {
      const newLabels = [...prev.labels, data.nonce];
      const newData = [...prev.data, data.newBalance / 100]; // Convert cents to dollars for chart
      if (newLabels.length > 50) {
        newLabels.shift();
        newData.shift();
      }
      return { labels: newLabels, data: newData };
    });
  };

  // ============================================================================
  // RENDER
  // ============================================================================

  if (!isLoggedIn) {
    return <AuthForm onLogin={handleLogin} />;
  }

  return (
    <div className="app-container">
      {/* Header Bar */}
      <div
        style={{
          width: "100%",
          maxWidth: "900px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "20px",
          padding: "10px",
          background: "#1a2c38",
          borderRadius: "8px",
          border: "1px solid #2f4553",
        }}
      >
        <span style={{ color: "#fff" }}>
          User: <b>{username}</b>
        </span>
        <button
          onClick={handleLogout}
          style={{
            width: "auto",
            padding: "8px 16px",
            fontSize: "0.8rem",
            background: "#ff4d4d",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
          }}
        >
          Logout
        </button>
      </div>

      {username === "root" && <AdminPanel />}
      <WalletPanel />

      <BalanceChart chartData={chartData} />

      <div className="main-wrapper">
        <div className="game-column">
          <GamePanel
            balance={balance}
            rollResult={rollResult}
            isWin={isWin}
            onPlayGame={handlePlayGame}
            isSystemReady={isSystemReady}
          />
        </div>

        <div className="game-column">
          <VerificationPanel
            activeHash={activeHash}
            lastSeed={lastSeed}
            lastNonce={lastNonce}
            lastClientSeed={lastClientSeed}
            actualRoll={actualRoll}
          />
        </div>
      </div>

      <HistoryTable history={history} />

      <div
        style={{
          display: "flex",
          gap: "20px",
          marginTop: "20px",
          maxWidth: "900px",
          width: "100%",
        }}
      >
        <LiveBets socket={socket} />
        <Leaderboard />
      </div>
    </div>
  );
}

export { authenticatedFetch };
export default App;
