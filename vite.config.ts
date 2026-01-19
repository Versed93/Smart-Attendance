
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/',
  server: {
    host: '0.0.0.0', // Listen on all network interfaces
    port: 5173,      // Ensure consistent port
  },
  preview: {
    host: '0.0.0.0',
    port: 5173,
  }
})