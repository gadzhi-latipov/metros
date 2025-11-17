import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
  },
  base: '/',
  server: {
    proxy: {
      '/api': {
        target: 'https://metro-backend-xlkt.onrender.com',
        changeOrigin: true
      }
    }
  }
})