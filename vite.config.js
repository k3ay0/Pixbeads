import { defineConfig } from "vite"
import vue from "@vitejs/plugin-vue"
import { fileURLToPath, URL } from "node:url"
import { copyFileSync } from "node:fs"
import { join } from "node:path"

const host = process.env.TAURI_DEV_HOST

// GitHub Pages 部署时使用仓库名作为 base 路径，本地使用根路径
const BASE = process.env.IS_GITHUB_PAGES === 'true' ? '/Pixbeads/' : '/'

//serve index.html for any 404 route
function spaFallback() {
  return {
    name: "spa-fallback",
    closeBundle() {
      const dist = fileURLToPath(new URL("./dist", import.meta.url))
      copyFileSync(join(dist, "index.html"), join(dist, "404.html"))
    },
  }
}

export default defineConfig(async () => ({
  plugins: [vue(), spaFallback()],
  base: BASE,
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: "ws", host, port: 1421 }
      : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
}))
