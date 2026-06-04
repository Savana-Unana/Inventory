import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:3000",
      "/ArtIt": {
        target: "https://savana-unana.github.io",
        changeOrigin: true,
        secure: true,
      },
      "/ElementFight": {
        target: "https://savana-unana.github.io",
        changeOrigin: true,
        secure: true,
      },
    },
  },
})
