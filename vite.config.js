import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Must match PORT in backend/.env. index.js falls back to 3001 only when PORT is
      // unset — it is set to 3547, so this pointed at a port nothing was listening on and
      // every relative /api call in dev failed.
      '/api': 'http://localhost:3547'
    }
  }
})
