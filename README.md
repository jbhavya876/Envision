# 🎲 Binary Dice Trading Terminal

A provably fair binary dice game with a modern React frontend and high-performance backend. Built with professional-grade architecture featuring reverse hash chain verification, binary protocol communication, and real-time data visualization.

![Binary Dice Trading Terminal](https://img.shields.io/badge/Status-Live-success)
![License](https://img.shields.io/badge/License-MIT-blue)

## 🌟 Core Features

### 🔐 Trustless Core
The **Reverse Hash Chain** ensures that even the admin cannot cheat players. The entire game outcome sequence is cryptographically locked in before the first bet is placed, providing true provably fair gaming.

### ⚡ High-Performance Communication
Server and client communicate using **Binary Protocol Buffers (Protobuf)**, obfuscating traffic and drastically reducing bandwidth—just like professional platforms such as Stake and Spribe.

### 📊 Real-Time Visualization
The React frontend features a live **Chart.js** trading graph, providing instant visual feedback on balance changes and game performance with a sleek trading terminal aesthetic.

### 💾 Robust Data Management
**SQLite with WAL (Write-Ahead Logging)** mode handles rapid transactions without locking or data loss, ensuring data integrity even under heavy load.

---

## 🎯 Functionalities

- **Binary Betting**: Bet on dice rolls being Over or Under 50
- **Provably Fair Verification**: Client-side verification of every bet using HMAC-SHA256
- **Real-time Updates**: Socket.IO broadcasts game results to all connected clients instantly
- **Balance Tracking**: Live chart visualization of balance changes over time
- **Bet History**: Comprehensive history table showing recent game outcomes
- **Automated Bots**: Includes bot implementations for automated gameplay testing

---

## 🏗️ Architecture

### Backend
- **Node.js + Express**: RESTful API and static file serving
- **Socket.IO**: WebSocket communication for real-time updates
- **Protobuf**: Binary serialization for efficient data transfer
- **SQLite (WAL)**: Persistent storage with transaction safety
- **Reverse Hash Chain**: Pre-generated seed chain for provable fairness

### Frontend
- **React 18**: Modern component-based UI
- **Vite**: Lightning-fast development and optimized builds
- **Chart.js**: Real-time balance visualization
- **Socket.IO Client**: WebSocket connection for live updates
- **CryptoJS**: Client-side cryptographic verification

---

## 🚀 Getting Started

### Prerequisites
- Node.js 16+ installed
- npm or yarn package manager

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/jbhavya876/Envision.git
   cd Envision
   ```

2. **Install backend dependencies**
   ```bash
   npm install
   ```

3. **Install frontend dependencies**
   ```bash
   cd client
   npm install
   cd ..
   ```

4. **Generate the seed chain** (if not already present)
   ```bash
   node generate_chain.js
   ```

### Running the Application

1. **Start the backend server**
   ```bash
   node server.js
   ```
   Server will run on `http://localhost:3000`

2. **Start the React dev server** (in a new terminal)
   ```bash
   cd client
   npm run dev
   ```
   Frontend will run on `http://localhost:5173`

3. **Open your browser**
   Navigate to `http://localhost:5173` to play!

---

## 🎮 How to Play

1. **Set your bet amount** - Enter the amount you want to wager
2. **Choose your client seed** - Customize for additional randomness
3. **Place your bet** - Click "Over 50" or "Under 50"
4. **Watch the result** - See the dice roll and balance update in real-time
5. **Verify fairness** - Click "Verify Chain & Math" to cryptographically verify the result

---

## 🔒 Provably Fair System

### How It Works

1. **Pre-commitment**: A chain of 1000 server seeds is generated and hashed before any bets
2. **Bet Placement**: Player provides a client seed and places a bet
3. **Result Generation**: Server uses HMAC-SHA256(clientSeed:nonce, serverSeed) to generate the result
4. **Seed Reveal**: After each bet, the server seed is revealed
5. **Verification**: Players can verify that the revealed seed hashes to the previously committed hash

### Verification Formula
```javascript
HMAC-SHA256(clientSeed:nonce, serverSeed) → hash
parseInt(hash.substring(0, 8), 16) % 10001 / 100 → result (0.00 - 100.00)
```

---

## 📁 Project Structure

```
Envision/
├── client/                 # React frontend
│   ├── src/
│   │   ├── components/    # React components
│   │   ├── App.jsx        # Main app component
│   │   └── main.jsx       # Entry point
│   ├── public/            # Static assets
│   └── package.json
├── server.js              # Express + Socket.IO server
├── database.js            # SQLite configuration
├── game.proto             # Protobuf schema
├── generate_chain.js      # Seed chain generator
├── chain.json             # Pre-generated seeds
├── bot.js                 # Automated bot
└── god_bot.js             # Advanced bot
```

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React, Vite, Chart.js, Socket.IO Client |
| Backend | Node.js, Express, Socket.IO, Protobuf |
| Database | SQLite with WAL mode |
| Cryptography | HMAC-SHA256, SHA-256 |
| Communication | Binary Protocol Buffers, WebSockets |

---

## 📊 Performance Features

- **Binary Protocol**: 60-70% smaller payload size vs JSON
- **WAL Mode**: Concurrent reads during writes
- **Real-time Updates**: Sub-100ms latency via WebSockets
- **Optimized Charts**: Animation disabled for smooth 60fps updates
- **Connection Pooling**: Efficient database connection management

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

---

## 📄 License

This project is licensed under the MIT License.

---

## 🎯 Future Enhancements

- [ ] Multi-player tournaments
- [ ] Additional game modes (custom targets, multipliers)
- [ ] User authentication and persistent accounts
- [ ] Leaderboard system
- [ ] Mobile-responsive design improvements
- [ ] Docker containerization

---

## 📞 Support

For issues or questions, please open an issue on GitHub.

---

**Built with ❤️ using modern web technologies**
