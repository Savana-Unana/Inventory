import cookieParser from "cookie-parser"
import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import express from "express"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, "..")
const dataDir = path.join(rootDir, "data")
const dbPath = path.join(dataDir, "inventory-db.json")
const distDir = path.join(rootDir, "dist")
const port = Number(process.env.PORT ?? 3000)
const sessionDurationMs = 10 * 60 * 1000
const sessionCookie = "inventory_session"

const app = express()

app.use(express.json({ limit: "50mb" }))
app.use(cookieParser())

app.get("/api/session", async (req, res) => {
  const db = await readDb()
  const session = getValidSession(db, req.cookies[sessionCookie])
  if (!session) return res.status(401).json({ message: "Sign in required." })

  const account = db.accounts.find((item) => item.id === session.accountId)
  if (!account) return res.status(401).json({ message: "Sign in required." })

  await writeDb(db)
  res.json(makeAccountPayload(db, account))
})

app.post("/api/signup", async (req, res) => {
  const { displayName = "", email = "", password = "" } = req.body ?? {}
  const cleanName = displayName.trim()
  const cleanEmail = email.trim().toLowerCase()

  if (!cleanName) return res.status(400).json({ message: "Enter your name." })
  if (!cleanEmail) return res.status(400).json({ message: "Enter your email." })
  if (password.length < 6) {
    return res.status(400).json({ message: "Use at least 6 password characters." })
  }

  const db = await readDb()
  if (db.accounts.some((account) => account.email === cleanEmail)) {
    return res.status(409).json({ message: "That account already exists." })
  }

  const salt = crypto.randomBytes(16).toString("hex")
  const account = {
    id: crypto.randomUUID(),
    displayName: cleanName,
    email: cleanEmail,
    salt,
    passwordHash: await hashPassword(password, salt),
    createdAt: Date.now(),
  }

  db.accounts.push(account)
  db.userData[account.id] = makeEmptyUserData()
  const session = createSession(db, account.id)
  await writeDb(db)
  setSessionCookie(res, session)
  res.status(201).json(makeAccountPayload(db, account))
})

app.post("/api/login", async (req, res) => {
  const { email = "", password = "" } = req.body ?? {}
  const db = await readDb()
  const account = db.accounts.find(
    (item) => item.email === email.trim().toLowerCase(),
  )

  if (!account) return res.status(401).json({ message: "No account found for that email." })

  const passwordHash = await hashPassword(password, account.salt)
  if (passwordHash !== account.passwordHash) {
    return res.status(401).json({ message: "The password is incorrect." })
  }

  const session = createSession(db, account.id)
  db.userData[account.id] ??= makeEmptyUserData()
  await writeDb(db)
  setSessionCookie(res, session)
  res.json(makeAccountPayload(db, account))
})

app.post("/api/logout", async (req, res) => {
  const db = await readDb()
  db.sessions = db.sessions.filter(
    (session) => session.id !== req.cookies[sessionCookie],
  )
  await writeDb(db)
  res.clearCookie(sessionCookie)
  res.sendStatus(204)
})

app.put("/api/state", async (req, res) => {
  const db = await readDb()
  const session = getValidSession(db, req.cookies[sessionCookie])
  if (!session) return res.status(401).json({ message: "Sign in required." })

  const current = db.userData[session.accountId] ?? makeEmptyUserData()
  db.userData[session.accountId] = {
    desktopState: req.body.desktopState ?? current.desktopState,
    fileStore: req.body.fileStore ?? current.fileStore,
    updatedAt: Date.now(),
  }

  await writeDb(db)
  res.json({ ok: true })
})

app.use(express.static(distDir))
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(distDir, "index.html"))
})

app.listen(port, () => {
  console.log(`Inventory server running at http://localhost:${port}`)
})

async function readDb() {
  try {
    const db = JSON.parse(await fs.readFile(dbPath, "utf8"))
    return {
      accounts: db.accounts ?? [],
      sessions: db.sessions ?? [],
      userData: db.userData ?? {},
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error
    return { accounts: [], sessions: [], userData: {} }
  }
}

async function writeDb(db) {
  db.sessions = db.sessions.filter((session) => session.expiresAt > Date.now())
  await fs.mkdir(dataDir, { recursive: true })
  await fs.writeFile(dbPath, `${JSON.stringify(db, null, 2)}\n`)
}

async function hashPassword(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (error, key) => {
      if (error) reject(error)
      else resolve(key.toString("hex"))
    })
  })
}

function createSession(db, accountId) {
  const session = {
    id: crypto.randomUUID(),
    accountId,
    expiresAt: Date.now() + sessionDurationMs,
  }

  db.sessions.push(session)
  return session
}

function getValidSession(db, sessionId) {
  if (!sessionId) return null

  const session = db.sessions.find((item) => item.id === sessionId)
  if (!session || session.expiresAt <= Date.now()) {
    db.sessions = db.sessions.filter((item) => item.id !== sessionId)
    return null
  }

  return session
}

function setSessionCookie(res, session) {
  res.cookie(sessionCookie, session.id, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: sessionDurationMs,
  })
}

function makeAccountPayload(db, account) {
  return {
    account: {
      id: account.id,
      displayName: account.displayName,
      email: account.email,
    },
    ...db.userData[account.id],
  }
}

function makeEmptyUserData() {
  return {
    desktopState: {},
    fileStore: null,
    updatedAt: Date.now(),
  }
}
