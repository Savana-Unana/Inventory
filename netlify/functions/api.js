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

    if (event.httpMethod === "GET" && route === "/browser-check") {
      return json({ ok: true }, 200, { "X-Inventory-Browser-Proxy": "1" })
    }

    if (event.httpMethod === "GET" && route === "/page-icon") {
      return handlePageIcon(event)
    }

    if (event.httpMethod === "GET" && route === "/page-title") {
      return handlePageTitle(event)
    }

    if (event.httpMethod === "GET" && route === "/browser") {
      return handleBrowser(event)
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

    if (event.httpMethod === "POST" && route === "/touch") {
      return handleTouch(event)
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

async function handleBrowser(event) {
  const targetUrl = parseBrowserUrl(event.queryStringParameters?.url)
  if (!targetUrl) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "text/plain" },
      body: "Invalid URL.",
    }
  }

  let response
  try {
    response = await fetch(targetUrl)
  } catch (error) {
    return {
      statusCode: 502,
      headers: { "Content-Type": "text/plain" },
      body: error.message ? `Could not load page: ${error.message}` : "Could not load page.",
    }
  }

  const contentType = response.headers.get("content-type") ?? "text/html"
  if (!contentType.includes("text/html")) {
    return {
      statusCode: 302,
      headers: { Location: response.url },
      body: "",
    }
  }

  return {
    statusCode: response.status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Inventory-Browser-Proxy": "1",
    },
    body: injectBrowserTracking(await response.text(), response.url),
  }
}

async function handlePageIcon(event) {
  const targetUrl = parseBrowserUrl(event.queryStringParameters?.url)
  if (!targetUrl) return json({ icon: null }, 400)

  try {
    const response = await fetch(targetUrl)
    const contentType = response.headers.get("content-type") ?? ""

    if (!contentType.includes("text/html")) {
      return json({ icon: getFallbackFavicon(response.url) })
    }

    const icon = findPageIcon(await response.text(), response.url)
    return json({ icon: icon ?? getFallbackFavicon(response.url) })
  } catch {
    return json({ icon: getFallbackFavicon(targetUrl) })
  }
}

async function handlePageTitle(event) {
  const targetUrl = parseBrowserUrl(event.queryStringParameters?.url)
  if (!targetUrl) return json({ title: null }, 400)

  try {
    const response = await fetch(targetUrl)
    const contentType = response.headers.get("content-type") ?? ""

    if (!contentType.includes("text/html")) {
      return json({ title: null })
    }

    return json({ title: findPageTitle(await response.text()) })
  } catch {
    return json({ title: null })
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

  const { session: refreshedSession, sessions: refreshedSessions } =
    refreshSession(nextSessions, session.id)

  await writeBlobJson(store, sessionsKey, refreshedSessions)
  return json(await makeAccountPayload(store, account), 200, {
    "Set-Cookie": makeSessionCookie(refreshedSession),
  })
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

async function handleTouch(event) {
  const store = getBlobStore()
  const sessions = await readBlobJson(store, sessionsKey, [])
  const { session, sessions: validSessions } = getValidSession(
    sessions,
    getCookie(event, sessionCookie),
  )

  if (!session) {
    await writeBlobJson(store, sessionsKey, validSessions)
    return json({ message: "Sign in required." }, 401)
  }

  const { session: refreshedSession, sessions: nextSessions } = refreshSession(
    validSessions,
    session.id,
  )

  await writeBlobJson(store, sessionsKey, nextSessions)
  return json({ ok: true }, 200, {
    "Set-Cookie": makeSessionCookie(refreshedSession),
  })
}

async function handleState(event) {
  const store = getBlobStore()
  const sessions = await readBlobJson(store, sessionsKey, [])
  const { session, sessions: validSessions } = getValidSession(
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
  const { session: refreshedSession, sessions: nextSessions } = refreshSession(
    validSessions,
    session.id,
  )

  await writeBlobJson(store, sessionsKey, nextSessions)
  await writeUserData(store, session.accountId, nextUserData)
  return json({ ok: true }, 200, {
    "Set-Cookie": makeSessionCookie(refreshedSession),
  })
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

function refreshSession(sessions, sessionId) {
  const refreshedSession = {
    ...sessions.find((item) => item.id === sessionId),
    expiresAt: Date.now() + sessionDurationMs,
  }

  return {
    session: refreshedSession,
    sessions: sessions.map((item) =>
      item.id === sessionId ? refreshedSession : item,
    ),
  }
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

function parseBrowserUrl(value) {
  try {
    const url = new URL(String(value ?? ""))
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : null
  } catch {
    return null
  }
}

function findPageIcon(html, pageUrl) {
  const linkPattern = /<link\b[^>]*>/gi
  const candidates = []
  let match = linkPattern.exec(html)

  while (match) {
    const tag = match[0]
    const rel = getHtmlAttribute(tag, "rel")?.toLowerCase() ?? ""
    const href = getHtmlAttribute(tag, "href")

    if (href && /\b(icon|shortcut icon|apple-touch-icon)\b/.test(rel)) {
      candidates.push({ rel, href })
    }

    match = linkPattern.exec(html)
  }

  const preferred =
    candidates.find((item) => item.rel.includes("icon") && !item.rel.includes("apple")) ??
    candidates[0]

  if (!preferred) return null

  try {
    return new URL(preferred.href, pageUrl).href
  } catch {
    return null
  }
}

function getHtmlAttribute(tag, name) {
  const match = tag.match(new RegExp(`${name}=["']([^"']+)["']`, "i"))
  return match?.[1] ?? null
}

function findPageTitle(html) {
  const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)
  return match ? decodeHtml(match[1]).trim() || null : null
}

function decodeHtml(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

function getFallbackFavicon(pageUrl) {
  try {
    return `${new URL(pageUrl).origin}/favicon.ico`
  } catch {
    return null
  }
}

function injectBrowserTracking(html, pageUrl) {
  const safeUrl = JSON.stringify(pageUrl)
  const baseTag = `<base href="${escapeHtml(pageUrl)}">`
  const script = `<script>
(() => {
  let realUrl = ${safeUrl};
  const proxyUrl = (url) => "/api/browser?url=" + encodeURIComponent(url);
  const report = (url = realUrl) => {
    realUrl = url;
    parent.postMessage({ type: "inventory-browser-url", url, title: document.title }, "*");
  };
  const resolveRealUrl = (value) => {
    if (!value) return realUrl;
    return new URL(value, realUrl).href;
  };

  report();
  window.addEventListener("message", (event) => {
    if (event.data?.type === "inventory-browser-ready") report();
  });
  window.addEventListener("popstate", () => report(resolveRealUrl(location.pathname + location.search + location.hash)));
  window.addEventListener("hashchange", () => report(resolveRealUrl(location.hash)));

  for (const method of ["pushState", "replaceState"]) {
    const original = history[method];
    history[method] = function patchedHistoryMethod(state, title, nextUrl) {
      const result = original.apply(this, arguments);
      if (nextUrl) report(resolveRealUrl(nextUrl));
      return result;
    };
  }

  for (const method of ["assign", "replace"]) {
    try {
      const original = location[method].bind(location);
      location[method] = (nextUrl) => {
        const resolvedUrl = resolveRealUrl(nextUrl);
        report(resolvedUrl);
        original(proxyUrl(resolvedUrl));
      };
    } catch {}
  }

  try {
    const originalOpen = window.open.bind(window);
    window.open = (nextUrl, target, features) => {
      if (!nextUrl) return originalOpen(nextUrl, target, features);
      const resolvedUrl = resolveRealUrl(nextUrl);
      report(resolvedUrl);
      return originalOpen(proxyUrl(resolvedUrl), target, features);
    };
  } catch {}

  document.addEventListener("submit", (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;

    const method = (form.method || "get").toLowerCase();
    if (method !== "get") return;

    const action = form.action || realUrl;
    const nextUrl = new URL(action, realUrl);
    const data = new FormData(form);
    for (const [key, value] of data.entries()) nextUrl.searchParams.set(key, value);

    event.preventDefault();
    report(nextUrl.href);
    window.location.href = proxyUrl(nextUrl.href);
  });

  document.addEventListener("click", (event) => {
    const link = event.target.closest?.("a[href]");
    if (!link || link.target === "_blank" || link.hasAttribute("download")) return;

    const nextUrl = new URL(link.getAttribute("href"), realUrl).href;
    if (!/^https?:/.test(nextUrl)) return;

    event.preventDefault();
    report(nextUrl);
    window.location.href = proxyUrl(nextUrl);
  });
})();
</script>`

  return html.includes("</head>")
    ? html.replace("</head>", `${baseTag}${script}</head>`)
    : `${baseTag}${script}${html}`
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => {
    const escapes = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }

    return escapes[char]
  })
}
