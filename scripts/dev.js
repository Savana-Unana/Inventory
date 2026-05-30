import { spawn } from "node:child_process"
import path from "node:path"

const viteBin = path.join("node_modules", "vite", "bin", "vite.js")

const processes = [
  start("api", ["server/index.js"]),
  start("web", [viteBin]),
]

let shuttingDown = false

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => stopAll(signal))
}

for (const child of processes) {
  child.on("exit", (code, signal) => {
    if (shuttingDown) return

    shuttingDown = true
    for (const other of processes) {
      if (other !== child && !other.killed) other.kill()
    }

    if (signal) {
      process.kill(process.pid, signal)
      return
    }

    process.exit(code ?? 0)
  })
}

function start(name, args) {
  const child = spawn(process.execPath, args, {
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  })

  child.stdout.on("data", (chunk) => writeOutput(name, chunk))
  child.stderr.on("data", (chunk) => writeOutput(name, chunk))

  return child
}

function writeOutput(name, chunk) {
  for (const line of chunk.toString().split(/\r?\n/)) {
    if (line) console.log(`[${name}] ${line}`)
  }
}

function stopAll(signal) {
  shuttingDown = true
  for (const child of processes) {
    if (!child.killed) child.kill(signal)
  }
}
