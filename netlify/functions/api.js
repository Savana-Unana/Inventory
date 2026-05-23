import { connectLambda, getStore } from "@netlify/blobs"
import crypto from "node:crypto"

const sessionDurationMs = 10 * 60 * 1000
const sessionCookie = "inventory_session"
const blobStoreName = "inventory-data"
const accountsKey = "accounts.json"
const sessionsKey = "sessions.json"

export async function handler(event) {
  try {
    connectLambda(event)

    const route = getRoute(event)
    if (event.httpMethod === "GET" && route === "/health") {
      return json({ ok: true, route, hasBlobsContext: hasBlobsContext() })
    }

    if (event.httpMethod === "GET" && route === "/session") {
      return handleSession(event)
    }

    if (event.httpMethod === "POST" && route === "/signup") {
      return handleSignup(event)
    }

    if (event.httpMethod === "POST" && route === "/login") {
      return handleLogin(event)
    }

    if (event.httpMethod === "POST" && route === "/logout") {
      return handleLogout(event)
    }

    if (event.httpMethod === "PUT" && route === "/state") {
      return handleState(event)
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

async function handleSession(event) {
  const store = getBlobStore()
  const accounts = await readBlobJson(store, accountsKey, [])
  const sessions = await readBlobJson(store, sessionsKey, [])
  const { session, sessions: nextSessions } = getValidSession(
    sessions,
    getCookie(event, sessionCookie),
  )

  if (!session) {
    await writeBlobJson(store, sessionsKey, nextSessions)
    return json({ message: "Sign in required." }, 401)
  }

  const account = accounts.find((item) => item.id === session.accountId)
  if (!account) return json({ message: "Sign in required." }, 401)

  await writeBlobJson(store, sessionsKey, nextSessions)
  return json(await makeAccountPayload(store, account))
}

async function handleSignup(event) {
  const store = getBlobStore()
  const accounts = await readBlobJson(store, accountsKey, [])
  const sessions = await readBlobJson(store, sessionsKey, [])
  const { displayName = "", email = "", password = "" } = parseBody(event)
  const cleanName = displayName.trim()
  const cleanEmail = email.trim().toLowerCase()

  if (!cleanName) return json({ message: "Enter your name." }, 400)
  if (!cleanEmail) return json({ message: "Enter your email." }, 400)
  if (password.length < 6) {
    return json({ message: "Use at least 6 password characters." }, 400)
  }

  if (accounts.some((account) => account.email === cleanEmail)) {
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
  const { session, sessions: nextSessions } = createSession(sessions, account.id)

  await writeBlobJson(store, accountsKey, [...accounts, account])
  await writeBlobJson(store, sessionsKey, nextSessions)
  await writeUserData(store, account.id, makeEmptyUserData())

  return json(await makeAccountPayload(store, account), 201, {
    "Set-Cookie": makeSessionCookie(session),
  })
}

async function handleLogin(event) {
  const store = getBlobStore()
  const accounts = await readBlobJson(store, accountsKey, [])
  const sessions = await readBlobJson(store, sessionsKey, [])
  const { email = "", password = "" } = parseBody(event)
  const account = accounts.find(
    (item) => item.email === email.trim().toLowerCase(),
  )

  if (!account) return json({ message: "No account found for that email." }, 401)

  const passwordHash = await hashPassword(password, account.salt)
  if (passwordHash !== account.passwordHash) {
    return json({ message: "The password is incorrect." }, 401)
  }

  const { session, sessions: nextSessions } = createSession(sessions, account.id)
  const userData = await readUserData(store, account.id)

  await writeBlobJson(store, sessionsKey, nextSessions)
  await writeUserData(store, account.id, userData)

  return json(await makeAccountPayload(store, account), 200, {
    "Set-Cookie": makeSessionCookie(session),
  })
}

async function handleLogout(event) {
  const store = getBlobStore()
  const sessionId = getCookie(event, sessionCookie)
  const sessions = await readBlobJson(store, sessionsKey, [])

  await writeBlobJson(
    store,
    sessionsKey,
    sessions.filter((session) => session.id !== sessionId),
  )

  return {
    statusCode: 204,
    headers: {
      "Set-Cookie": `${sessionCookie}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure`,
    },
  }
}

async function handleState(event) {
  const store = getBlobStore()
  const sessions = await readBlobJson(store, sessionsKey, [])
  const { session, sessions: nextSessions } = getValidSession(
    sessions,
    getCookie(event, sessionCookie),
  )

  if (!session) return json({ message: "Sign in required." }, 401)

  const body = parseBody(event)
  const current = await readUserData(store, session.accountId)
  const nextUserData = {
    desktopState: body.desktopState ?? current.desktopState,
    fileStore: body.fileStore ?? current.fileStore,
    updatedAt: Date.now(),
  }

  await writeBlobJson(store, sessionsKey, nextSessions)
  await writeUserData(store, session.accountId, nextUserData)
  return json({ ok: true })
}

function getBlobStore() {
  const siteID = process.env.NETLIFY_SITE_ID ?? process.env.SITE_ID
  const token = process.env.NETLIFY_BLOBS_TOKEN ?? process.env.NETLIFY_AUTH_TOKEN

  if (siteID && token) {
    return getStore({
      name: blobStoreName,
      siteID,
      token,
    })
  }

  return getStore(blobStoreName)
}

async function readBlobJson(store, key, fallback) {
  const value = await store.get(key)
  if (!value) return fallback

  try {
    return JSON.parse(value)
  } catch {
    await store.set(`corrupt-${key}-${Date.now()}`, value)
    return fallback
  }
}

async function writeBlobJson(store, key, value) {
  await store.set(key, JSON.stringify(value))
}

async function readUserData(store, accountId) {
  return readBlobJson(store, getUserDataKey(accountId), makeEmptyUserData())
}

async function writeUserData(store, accountId, userData) {
  await writeBlobJson(store, getUserDataKey(accountId), userData)
}

function getUserDataKey(accountId) {
  return `users/${accountId}.json`
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

function createSession(sessions, accountId) {
  const session = {
    id: crypto.randomUUID(),
    accountId,
    expiresAt: Date.now() + sessionDurationMs,
  }

  return {
    session,
    sessions: [
      ...sessions.filter((item) => item.expiresAt > Date.now()),
      session,
    ],
  }
}

function getValidSession(sessions, sessionId) {
  const nextSessions = sessions.filter((item) => item.expiresAt > Date.now())
  if (!sessionId) return { session: null, sessions: nextSessions }

  const session = nextSessions.find((item) => item.id === sessionId)
  if (!session) return { session: null, sessions: nextSessions }

  return { session, sessions: nextSessions }
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

async function makeAccountPayload(store, account) {
  return {
    account: {
      id: account.id,
      displayName: account.displayName,
      email: account.email,
    },
    ...(await readUserData(store, account.id)),
  }
}

function makeEmptyUserData() {
  return {
    desktopState: {},
    fileStore: null,
    updatedAt: Date.now(),
  }
}

function hasBlobsContext() {
  return Boolean(
    globalThis.netlifyBlobsContext ||
      process.env.NETLIFY_BLOBS_CONTEXT ||
      (process.env.NETLIFY_SITE_ID && process.env.NETLIFY_BLOBS_TOKEN) ||
      (process.env.SITE_ID && process.env.NETLIFY_AUTH_TOKEN),
  )
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
