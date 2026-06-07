import { copyFileSync, cpSync, mkdirSync } from "node:fs"
import { spawnSync } from "node:child_process"

copyFileSync("index.source.html", "index.html")

const vite = spawnSync(process.execPath, ["node_modules/vite/bin/vite.js", "build"], {
  stdio: "inherit",
  shell: false,
})

if (vite.status !== 0) {
  process.exit(vite.status ?? 1)
}

mkdirSync("assets", { recursive: true })
cpSync("dist/assets", "assets", { recursive: true })
copyFileSync("dist/index.html", "index.html")
