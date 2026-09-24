import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// В dev — прокси на локальный API; в проде web/dist раздаёт сам сервер.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:3008',
      '/uploads': 'http://127.0.0.1:3008',
    },
  },
})
