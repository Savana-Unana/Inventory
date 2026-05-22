import { getStore } from "@netlify/blobs"
import crypto from "node:crypto"

const sessionDurationMs = 10 * 60 * 1000
const sessionCookie = "inventory_session"
const dbKey = "db"

export async function handler(event) {
  try {
    const db = await readDb()
    const route = getRoute(event)

    if (event.httpMethod === "GET" && route === "/session") {
      return handleSession(event, db)
    }

    if (event.httpMethod === "POST" && route === "/signup") {
      return handleSignup(event, db)
    }

    if (event.httpMethod === "POST" && route === "/login") {
      return handleLogin(event, db)
    }

    if (event.httpMethod === "POST" && route === "/logout") {
      return handleLogout(event, db)
    }

    if (event.httpMethod === "PUT" && route === "/state") {
      return handleState(event, db)
    }

    return json({ message: `API route not found: ${route}` }, 404)
  } catch (error) {
    return json(
      {
        message: error.message
          ? `Server error: ${error.message}`
          : "Server error.",
      },
      500,
    )
  }
}

async function handleSession(event, db) {
  const session = getValidSession(db, getCookie(event, sessionCookie))
  if (!session) {
    await writeDb(db)
    return json({ message: "Sign in required." }, 401)
  }

  const account = db.accounts.find((item) => item.id === session.accountId)
  if (!account) return json({ message: "Sign in required." }, 401)

  await writeDb(db)
  return json(makeAccountPayload(db, account))
}

async function handleSignup(event, db) {
  const { displayName = "", email = "", password = "" } = parseBody(event)
  const cleanName = displayName.trim()
  const cleanEmail = email.trim().toLowerCase()

  if (!cleanName) return json({ message: "Enter your name." }, 400)
  if (!cleanEmail) return json({ message: "Enter your email." }, 400)
  if (password.length < 6) {
    return json({ message: "Use at least 6 password characters." }, 400)
  }

  if (db.accounts.some((account) => account.email === cleanEmail)) {
    return json({ message: "That account already exists." }, 409)
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

  return json(makeAccountPayload(db, account), 201, {
    "Set-Cookie": makeSessionCookie(session),
  })
}

async function handleLogin(event, db) {
  const { email = "", password = "" } = parseBody(event)
  const account = db.accounts.find(
    (item) => item.email === email.trim().toLowerCase(),
  )

  if (!account) return json({ message: "No account found for that email." }, 401)

  const passwordHash = await hashPassword(password, account.salt)
  if (passwordHash !== account.passwordHash) {
    return json({ message: "The password is incorrect." }, 401)
  }

  const session = createSession(db, account.id)
  db.userData[account.id] ??= makeEmptyUserData()
  await writeDb(db)

  return json(makeAccountPayload(db, account), 200, {
    "Set-Cookie": makeSessionCookie(session),
  })
}

async function handleLogout(event, db) {
  const sessionId = getCookie(event, sessionCookie)
  db.sessions = db.sessions.filter((session) => session.id !== sessionId)
  await writeDb(db)

  return {
    statusCode: 204,
    headers: {
      "Set-Cookie": `${sessionCookie}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure`,
    },
  }
}

async function handleState(event, db) {
  const session = getValidSession(db, getCookie(event, sessionCookie))
  if (!session) return json({ message: "Sign in required." }, 401)

  const body = parseBody(event)
  const current = db.userData[session.accountId] ?? makeEmptyUserData()
  db.userData[session.accountId] = {
    desktopState: body.desktopState ?? current.desktopState,
    fileStore: body.fileStore ?? current.fileStore,
    updatedAt: Date.now(),
  }

  await writeDb(db)
  return json({ ok: true })
}

async function readDb() {
  const store = getStore({ name: "inventory-data", consistency: "strong" })
  const db = await store.get(dbKey, { type: "json" })

  return {
    accounts: db?.accounts ?? [],
    sessions: db?.sessions ?? [],
    userData: db?.userData ?? {},
  }
}

async function writeDb(db) {
  db.sessions = db.sessions.filter((session) => session.expiresAt > Date.now())
  const store = getStore({ name: "inventory-data", consistency: "strong" })
  await store.setJSON(dbKey, db)
}

function getRoute(event) {
  const path = event.path ?? new URL(event.rawUrl).pathname

  return path
    .replace(/^\/api/, "")
    .replace(/^\/\.netlify\/functions\/api/, "") || "/"
}

function parseBody(event) {
  if (!event.body) return {}
  return JSON.parse(
    event.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString("utf8")
      : event.body,
  )
}

function getCookie(event, name) {
  const cookies = event.headers.cookie ?? event.headers.Cookie ?? ""
  const match = cookies
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))

  return match ? decodeURIComponent(match.slice(name.length + 1)) : null
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

function makeSessionCookie(session) {
  return `${sessionCookie}=${encodeURIComponent(session.id)}; Path=/; Max-Age=${
    sessionDurationMs / 1000
  }; HttpOnly; SameSite=Lax; Secure`
}

async function hashPassword(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (error, key) => {
      if (error) reject(error)
      else resolve(key.toString("hex"))
    })
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

function json(body, statusCode = 200, headers = {}) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  }
}
