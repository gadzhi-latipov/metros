import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
  },
  build: {
    outDir: 'dist',
    sourcemap: true
  },
  // Добавьте эти настройки:
  resolve: {
    alias: {
      '@': '/src'
    }
  },
  // Убедитесь, что base путь правильный для вашего окружения
  base: './'
})