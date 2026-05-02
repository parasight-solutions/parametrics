import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

function parsePort(value, fallback) {
  const port = Number.parseInt(String(value || ""), 10)
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : fallback
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "")
  const webPort = parsePort(env.VITE_WEB_PORT, 5173)
  const apiBaseUrl = env.VITE_API_BASE_URL || `http://127.0.0.1:${parsePort(env.VITE_API_PORT, 5050)}`

  return {
    plugins: [react()],
    server: {
      host: "127.0.0.1",
      port: webPort,
      strictPort: true,
      proxy: {
        '/api': {
          target: apiBaseUrl,
          changeOrigin: true
        }
      }
    }
  }
})
