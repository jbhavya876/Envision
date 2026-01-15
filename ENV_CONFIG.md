# Environment Configuration Guide

## Overview

The application now uses environment variables for configuration through the `dotenv` package. This improves security and makes it easier to deploy to different environments.

## Files Created

### Server-Side Configuration

**File**: [.env](file:///home/jbhavya/kirat_yt_projects/stake_build/.env) (root directory)

```env
PORT=3000
NODE_ENV=development
SECRET_KEY=super_secret_key_123_change_this_in_production
DB_PATH=./casino.db
CHAIN_SIZE=1000
CHAIN_FILE=./chain.json
CORS_ORIGIN=http://localhost:5173
```

**Variables:**
- `PORT` - Server port (default: 3000)
- `NODE_ENV` - Environment mode (development/production)
- `SECRET_KEY` - JWT signing secret (⚠️ **MUST change in production!**)
- `DB_PATH` - SQLite database file path
- `CHAIN_SIZE` - Number of seeds in the provably fair chain
- `CHAIN_FILE` - Path to chain.json file
- `CORS_ORIGIN` - Allowed CORS origin (frontend URL)

### Client-Side Configuration

**File**: [client/.env](file:///home/jbhavya/kirat_yt_projects/stake_build/client/.env)

```env
VITE_API_URL=http://localhost:3000
VITE_SOCKET_URL=http://localhost:3000
VITE_APP_NAME=Binary Dice Casino
VITE_APP_VERSION=1.0.0
```

**Variables:**
- `VITE_API_URL` - Backend API endpoint
- `VITE_SOCKET_URL` - Socket.IO server URL
- `VITE_APP_NAME` - Application name
- `VITE_APP_VERSION` - Application version

> **Note**: Vite only exposes variables prefixed with `VITE_` to the client bundle for security.

## Code Changes

### [server.js](file:///home/jbhavya/kirat_yt_projects/stake_build/server.js)

Added at the top:
```javascript
require('dotenv').config();

const SECRET_KEY = process.env.SECRET_KEY || "super_secret_key_123";
const PORT = process.env.PORT || 3000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
```

Updated CORS configuration:
```javascript
app.use(cors({ origin: CORS_ORIGIN }));

const io = new Server(server, {
    cors: {
        origin: CORS_ORIGIN,
        methods: ["GET", "POST"]
    }
});
```

## Security Best Practices

### For Production Deployment:

1. **Generate a strong SECRET_KEY:**
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
   
2. **Update .env file:**
   ```env
   SECRET_KEY=<generated_key_from_above>
   NODE_ENV=production
   CORS_ORIGIN=https://yourdomain.com
   ```

3. **Never commit .env files:**
   - `.env` is already in `.gitignore`
   - Only commit `.env.example` files

## Usage

### Development

The current `.env` files are already configured for local development. Just run:

```bash
# Start backend
node server.js

# Start frontend (in another terminal)
cd client && npm run dev
```

### Production

1. Copy `.env.example` to `.env`
2. Update all values for production
3. Build the client: `cd client && npm run build`
4. Start the server: `NODE_ENV=production node server.js`

## Environment Files Reference

| File | Purpose | Committed to Git? |
|------|---------|-------------------|
| `.env` | Actual configuration values | ❌ No (in .gitignore) |
| `.env.example` | Template/documentation | ✅ Yes |
| `.env.local` | Local overrides | ❌ No (in .gitignore) |

## Troubleshooting

**Issue**: Changes to `.env` not taking effect
- **Solution**: Restart the server (dotenv loads on startup)

**Issue**: Vite not seeing environment variables
- **Solution**: Make sure variables are prefixed with `VITE_` and restart dev server

**Issue**: CORS errors in production
- **Solution**: Update `CORS_ORIGIN` in `.env` to match your frontend domain
