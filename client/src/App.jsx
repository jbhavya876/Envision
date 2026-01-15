import React, { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";
import protobuf from "protobufjs";
import BalanceChart from "./components/BalanceChart";
import GamePanel from "./components/GamePanel";
import VerificationPanel from "./components/VerificationPanel";
import HistoryTable from "./components/HistoryTable";
import AuthForm from "./components/AuthForm";

function App() {
  // --- STATE ---
  const [token, setToken] = useState(localStorage.getItem("token"));
  const [username, setUsername] = useState(
    localStorage.getItem("username") || ""
  );

  // Game State
  const [balance, setBalance] = useState("...");
  const [rollResult, setRollResult] = useState("0.00");
  const [isWin, setIsWin] = useState(null);
  const [activeHash, setActiveHash] = useState("Loading...");
  const [isSystemReady, setIsSystemReady] = useState(false);

  // Fairness State
  const [lastSeed, setLastSeed] = useState("No bets yet");
  const [lastNonce, setLastNonce] = useState("-");
  const [lastClientSeed, setLastClientSeed] = useState("");
  const [actualRoll, setActualRoll] = useState(0);
  const [history, setHistory] = useState([]);
  const [chartData, setChartData] = useState({ labels: [], data: [] });

  const socketRef = useRef(null);
  const BetRequestRef = useRef(null);
  const GameResponseRef = useRef(null);

  // --- AUTH HANDLERS ---
  const handleLogin = (newToken, user) => {
    localStorage.setItem("token", newToken);
    localStorage.setItem("username", user);
    setToken(newToken);
    setUsername(user);
  };

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("username");
    setToken(null);
    setUsername("");
    if (socketRef.current) socketRef.current.disconnect();
  };

  // --- INITIALIZATION ---
  useEffect(() => {
    // 🔒 If not logged in, do nothing
    if (!token) return;

    // 1. Initialize Socket.IO
    // Note: If using proxy in vite.config.js, you can just use io()
    // If explicit URL needed: io('http://localhost:3000')
    socketRef.current = io(); 

    // 2. Load Protobuf Schema
    protobuf.load("/game.proto", (err, root) => {
      if (err) {
        alert("Failed to load binary schema");
        return;
      }
      BetRequestRef.current = root.lookupType("BetRequest");
      GameResponseRef.current = root.lookupType("GameResponse");

      // Mark system as ready
      setIsSystemReady(true);

      // 3. Fetch Initial State
      fetchInitialState();
    });

    // 4. Listen for game updates
    socketRef.current.on("game-update", (buffer) => {
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
  }, [token]);

  // --- API CALLS ---
  const fetchInitialState = async () => {
    try {
      const res = await fetch("/api/state", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (res.status === 401 || res.status === 403) {
        alert("Your session has expired. Please login again.");
        handleLogout();
        return;
      }

      if (!res.ok) {
        console.error("Response not OK:", res.status);
        return;
      }

      const data = await res.json();
      setBalance(data.balance.toFixed(2));
      setActiveHash(data.serverSeedHash);

      // Sync Chart Logic
      if (data.nonce) {
        setChartData({
          labels: [data.nonce],
          data: [data.balance],
        });
      }
    } catch (error) {
      console.error("Error fetching initial state:", error);
    }
  };

  const handlePlayGame = async (betAmount, clientSeed, condition) => {
    // 1. Check if System is Ready
    if (!BetRequestRef.current || !isSystemReady) {
      console.error("System/Protobuf not ready!");
      return;
    }

    const payload = { betAmount, target: 50, condition, clientSeed };

    // 2. Verify & Encode
    const err = BetRequestRef.current.verify(payload);
    if (err) return alert(err);

    const message = BetRequestRef.current.create(payload);
    const buffer = BetRequestRef.current.encode(message).finish();

    try {
      // 3. Send Request
      const res = await fetch("/api/bet", {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          Authorization: `Bearer ${token}`,
        },
        body: buffer,
      });

      // 4. Handle Auth Errors
      if (res.status === 401 || res.status === 403) {
        alert("Session expired. Please login again.");
        handleLogout();
      }
    } catch (error) {
      console.error("Error placing bet:", error);
    }
  };

  // --- UI UPDATER ---
  const updateDashboard = (data) => {
    setRollResult(data.roll.toFixed(2));
    setIsWin(data.isWin);
    setBalance(data.newBalance.toFixed(2));
    setActualRoll(data.roll);

    setLastSeed(data.serverSeedRevealed);
    setLastClientSeed(data.clientSeed);
    setLastNonce(data.nonce);
    setActiveHash(
      "Hash of: " + data.serverSeedRevealed.substring(0, 20) + "..."
    );

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
      const newData = [...prev.data, data.newBalance];
      if (newLabels.length > 50) {
        newLabels.shift();
        newData.shift();
      }
      return { labels: newLabels, data: newData };
    });
  };

  // --- RENDER ---

  // 1. If no token, show Login Screen
  if (!token) {
    return <AuthForm onLogin={handleLogin} />;
  }

  // 2. If Logged In, show Game
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
    </div>
  );
}

export default App;