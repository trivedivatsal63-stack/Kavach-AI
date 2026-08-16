import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    port: 5173,
    // Wildcard, not the exact random hostname — ngrok's free tier mints a
    // new subdomain every time it restarts, so this survives that instead
    // of needing an edit per session. Temporary, for tunnel-based testing
    // only — safe to remove once you're done sharing a tunnel link.
    allowedHosts: [".ngrok-free.dev", ".ngrok-free.app"],
  },
  preview: {
    host: true,
    port: 5173,
    allowedHosts: [".ngrok-free.dev", ".ngrok-free.app"],
  },
})
