import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss()
  ],
  server: {
    port: 5173,
    host: true,
    allowedHosts: ['.ngrok-free.dev', '.ngrok-free.app', '.trycloudflare.com', '.loca.lt'],
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        headers: {
          origin: 'http://localhost:5173'
        }
      }
    }
  }
})

