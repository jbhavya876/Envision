/**
 * @file Binary Dice Casino - Main Application Component (Phase 2 Complete)
 * @description Root React component.
 *   - HttpOnly JWT auth with silent refresh
 *   - Game tabs: Dice, Crash, Mines
 *   - Live bets feed, leaderboard, admin & wallet panels
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
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
import CrashGame from "./components/CrashGame";
import MinesGame from "./components/MinesGame";

/**
 * Wrapper around fetch that includes credentials and silently refreshes
 * the access token on a 403 response.
 */
async function authenticatedFetch(url, options = {}) {
  let res = await fetch(url, { ...options, credentials: "include" });

  if (res.status === 403) {
    const refreshRes = await fetch("/api/auth/refresh", {
      method: "POST",
      credentials: "include",
    });
    if (refreshRes.ok) {
      res = await fetch(url, { ...options, credentials: "include" });
    } else {
      window.dispatchEvent(new Event("force-logout"));
      throw new Error("Session expired");
    }
  }
  return res;
}

function App() {
  // ============================================================================
  // AUTHENTICATION & GAME MODE STATE
  // ============================================================================
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [username, setUsername] = useState("");
  const [socket, setSocket] = useState(null);
  const [activeGame, setActiveGame] = useState("dice");

  // ============================================================================
  // GAME STATE (shared)
  // ============================================================================
  const [balance, setBalance] = useState("...");
  const [rollResult, setRollResult] = useState("0.00");
  const [isWin, setIsWin] = useState(null);
  const [activeHash, setActiveHash] = useState("Loading...");
  const [isSystemReady, setIsSystemReady] = useState(false);

  // ============================================================================
  // DICE‑SPECIFIC VERIFICATION STATE
  // ============================================================================
  const [lastSeed, setLastSeed] = useState("No bets yet");
  const [lastNonce, setLastNonce] = useState("-");
  const [lastClientSeed, setLastClientSeed] = useState("");
  const [actualRoll, setActualRoll] = useState(0);
  const [history, setHistory] = useState([]);
  const [chartData, setChartData] = useState({ labels: [], data: [] });

  // ============================================================================
  // REFS
  // ============================================================================
  const socketRef = useRef(null);
  const BetRequestRef = useRef(null);
  const GameResponseRef = useRef(null);

  // ============================================================================
  // SESSION RECOVERY (page load)
  // ============================================================================
  useEffect(() => {
    const tryRecoverSession = async () => {
      try {
        const res = await authenticatedFetch("/api/state");
        if (!res.ok) throw new Error("No session");
        const data = await res.json();
        setUsername(data.username || "Unknown");
        setIsLoggedIn(true);
        setBalance((data.balance / 100).toFixed(2));
        setActiveHash(data.serverSeedHash);
      } catch (e) {
        // stay on login form
      }
    };
    tryRecoverSession();
  }, []);

  // ============================================================================
  // AUTH HANDLERS
  // ============================================================================
  const handleLogin = (user, balanceCents) => {
    setUsername(user);
    setIsLoggedIn(true);
    setBalance((balanceCents / 100).toFixed(2));
  };

  const handleLogout = async () => {
    try {
      await authenticatedFetch("/api/auth/logout", { method: "POST" });
    } catch (e) {}
    setUsername("");
    setIsLoggedIn(false);
    setBalance("...");
    if (socketRef.current) socketRef.current.disconnect();
  };

  useEffect(() => {
    const forceLogout = () => handleLogout();
    window.addEventListener("force-logout", forceLogout);
    return () => window.removeEventListener("force-logout", forceLogout);
  }, []);

  // ============================================================================
  // SOCKET & PROTOBUF INITIALIZATION
  // ============================================================================
  useEffect(() => {
    if (!isLoggedIn) return;

    const newSocket = io(window.location.origin, { withCredentials: true });
    socketRef.current = newSocket;
    setSocket(newSocket);

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

    // Dice bet results
    newSocket.on("bet_result", (buffer) => {
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

    // Crash & Mines results – update balance
    newSocket.on("crash:result", (data) => {
      if (data.win) {
        // profit is in cents
        const newBalanceCents = Math.round((parseFloat(balance) * 100) + data.profit);
        setBalance((newBalanceCents / 100).toFixed(2));
      } else {
        // bet was already deducted, no change needed (just refetch maybe)
        fetchInitialState(); // safe refresh
      }
    });

    newSocket.on("mines:result", (data) => {
      if (data.win) {
        const newBalanceCents = Math.round((parseFloat(balance) * 100) + data.profit);
        setBalance((newBalanceCents / 100).toFixed(2));
      } else {
        fetchInitialState();
      }
    });

    return () => {
      if (socketRef.current) socketRef.current.disconnect();
    };
  }, [isLoggedIn]);

  // ============================================================================
  // FETCH INITIAL STATE
  // ============================================================================
  const fetchInitialState = async () => {
    try {
      const res = await authenticatedFetch("/api/state");
      if (!res.ok) return;
      const data = await res.json();
      setBalance((data.balance / 100).toFixed(2));
      setActiveHash(data.serverSeedHash);
      if (data.nonce) {
        setChartData({ labels: [data.nonce], data: [data.balance / 100] });
      }
    } catch (error) {
      console.error("Error fetching initial state:", error);
    }
  };

  // ============================================================================
  // DICE BET HANDLER
  // ============================================================================
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
      }
    } catch (error) {
      console.error("Error placing bet:", error);
    }
  };

  // ============================================================================
  // DICE UI UPDATE
  // ============================================================================
  const updateDashboard = (data) => {
    setRollResult(data.roll.toFixed(2));
    setIsWin(data.isWin);
    setBalance((data.newBalance / 100).toFixed(2));
    setActualRoll(data.roll);

    setLastSeed(data.serverSeedRevealed);
    setLastClientSeed(data.clientSeed);
    setLastNonce(data.nonce);
    setActiveHash(data.nextServerSeedHash);

    setHistory((prev) => {
      const newHistory = [
        {
          nonce: data.nonce,
          roll: data.roll,
          betAmount: data.betAmount,
          profit: data.profit,
          isWin: data.isWin,
        },
        ...prev,
      ];
      return newHistory.slice(0, 15);
    });

    setChartData((prev) => {
      const newLabels = [...prev.labels, data.nonce];
      const newData = [...prev.data, data.newBalance / 100];
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

      {/* Game Tabs */}
      <div style={{ display: "flex", gap: "10px", marginBottom: "10px", maxWidth: "900px", width: "100%" }}>
        {["dice", "crash", "mines"].map((game) => (
          <button
            key={game}
            onClick={() => setActiveGame(game)}
            style={{
              background: activeGame === game ? "#00ff88" : "#2f4553",
              color: activeGame === game ? "#000" : "#fff",
              border: "none",
              padding: "10px 20px",
              borderRadius: "5px",
              cursor: "pointer",
              fontWeight: "bold",
            }}
          >
            {game.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Dice Game */}
      {activeGame === "dice" && (
        <>
          <BalanceChart chartData={chartData} />
          <div className="main-wrapper">
            <div className="game-column">
              <GamePanel
                balance={balance}
                rollResult={rollResult}
                isWin={isWin}
                onPlayGame={handlePlayGame}
                isSystemReady={isSystemReady}
                socket={socket}
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
        </>
      )}

      {/* Crash Game */}
      {activeGame === "crash" && (
        <CrashGame
          socket={socket}
          balance={balance}
          onResult={(data) => {
            // optional callback for extra handling
          }}
        />
      )}

      {/* Mines Game */}
      {activeGame === "mines" && (
        <MinesGame
          socket={socket}
          onResult={(data) => {
            // optional callback
          }}
        />
      )}

      {/* Live Bets & Leaderboard (always visible) */}
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