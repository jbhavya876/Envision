/**
 * @file Vite Configuration
 * @description Vite bundler configuration for the React frontend.
 * 
 * Configuration includes:
 * - React plugin for JSX transformation and Fast Refresh
 * - Development server on port 5173
 * - Proxy configuration to forward API and Socket.IO requests to backend
 * 
 * @see https://vitejs.dev/config/
 */

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
    // React plugin for JSX and Fast Refresh
    plugins: [react()],

    server: {
        // Development server port
        port: 5173,

        // Proxy configuration for backend communication
        proxy: {
            // Forward all /api requests to backend server
            '/api': {
                target: 'http://localhost:3000',
                changeOrigin: true,
            },
            // Forward Socket.IO WebSocket connections to backend
            '/socket.io': {
                target: 'http://localhost:3000',
                changeOrigin: true,
                ws: true, // Enable WebSocket proxying
            }
        }
    }
})
