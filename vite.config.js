import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // 3001 matches the Supabase OAuth dev allowlist; PORT override lets a
    // harness-assigned port work when 3001 is taken by another app.
    port: Number(process.env.PORT) || 3001,
    proxy: {
      '/api': {
        target: 'http://localhost:5001',
        changeOrigin: true,
      }
    }
  }
})