import { defineConfig } from "vite"
import vue from "@vitejs/plugin-vue"
import { fileURLToPath, URL } from "node:url"
import { copyFileSync, existsSync } from "node:fs"
import { join } from "node:path"

const host = process.env.TAURI_DEV_HOST

// GitHub Pages 部署时使用仓库名作为 base 路径，本地使用根路径
const BASE = process.env.IS_GITHUB_PAGES === 'true' ? '/Pixbeads/' : '/'

//serve index.html for any 404 route
function spaFallback() {
  return {
    name: "spa-fallback",
    // 用 writeBundle：它在产物写入磁盘后、且仅构建成功时执行；
    // 若用 closeBundle，构建失败时也会触发，此时 dist/index.html 尚不存在，
    // 抛出的 ENOENT 会掩盖真正的构建错误
    writeBundle() {
      const dist = fileURLToPath(new URL("./dist", import.meta.url))
      const source = join(dist, "index.html")
      if (!existsSync(source)) {
        console.warn("[spa-fallback] 未找到 index.html，跳过 404.html 生成")
        return
      }
      copyFileSync(source, join(dist, "404.html"))
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
    strictPort: false,
    host: host || false,
    hmr: host
      ? { protocol: "ws", host, port: 1421 }
      : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
}))
