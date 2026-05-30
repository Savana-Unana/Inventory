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

app.get("/api/health", (req, res) => {
  res.json({ ok: true, storage: dbPath })
})

app.get("/api/browser-check", (req, res) => {
  res
    .set("X-Inventory-Browser-Proxy", "1")
    .json({ ok: true })
})

app.get("/api/page-icon", async (req, res) => {
  const targetUrl = parseBrowserUrl(req.query.url)
  if (!targetUrl) return res.status(400).json({ icon: null })

  try {
    const response = await fetch(targetUrl)
    const contentType = response.headers.get("content-type") ?? ""

    if (!contentType.includes("text/html")) {
      return res.json({ icon: getFallbackFavicon(response.url) })
    }

    const icon = findPageIcon(await response.text(), response.url)
    res.json({ icon: icon ?? getFallbackFavicon(response.url) })
  } catch {
    res.json({ icon: getFallbackFavicon(targetUrl) })
  }
})

app.get("/api/page-title", async (req, res) => {
  const targetUrl = parseBrowserUrl(req.query.url)
  if (!targetUrl) return res.status(400).json({ title: null })

  try {
    const response = await fetch(targetUrl)
    const contentType = response.headers.get("content-type") ?? ""

    if (!contentType.includes("text/html")) {
      return res.json({ title: null })
    }

    res.json({ title: findPageTitle(await response.text()) })
  } catch {
    res.json({ title: null })
  }
})

app.get("/api/browser", async (req, res) => {
  const targetUrl = parseBrowserUrl(req.query.url)
  if (!targetUrl) return res.status(400).send("Invalid URL.")

  try {
    const response = await fetch(targetUrl)
    const contentType = response.headers.get("content-type") ?? "text/html"

    if (!contentType.includes("text/html")) {
      res.redirect(response.url)
      return
    }

    const html = injectBrowserTracking(await response.text(), response.url)
    res
      .status(response.status)
      .set("X-Inventory-Browser-Proxy", "1")
      .set("Content-Type", "text/html; charset=utf-8")
      .send(html)
  } catch (error) {
    res.status(502).send(error.message ? `Could not load page: ${error.message}` : "Could not load page.")
  }
})

app.get(/^\/ArtIt\/.*/, async (req, res) => {
  try {
    const targetUrl = new URL(req.originalUrl, "https://savana-unana.github.io")
    const response = await fetch(targetUrl)
    const contentType = response.headers.get("content-type")

    if (contentType) res.set("Content-Type", contentType)
    res.status(response.status).send(Buffer.from(await response.arrayBuffer()))
  } catch (error) {
    res.status(502).send(error.message ? `Could not load Art It asset: ${error.message}` : "Could not load Art It asset.")
  }
})

app.get("/api/session", async (req, res) => {
  const db = await readDb()
  const session = getValidSession(db, req.cookies[sessionCookie])
  if (!session) return res.status(401).json({ message: "Sign in required." })

  const account = db.accounts.find((item) => item.id === session.accountId)
  if (!account) return res.status(401).json({ message: "Sign in required." })

  refreshSession(session)
  await writeDb(db)
  setSessionCookie(res, session)
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

app.post("/api/touch", async (req, res) => {
  const db = await readDb()
  const session = getValidSession(db, req.cookies[sessionCookie])
  if (!session) return res.status(401).json({ message: "Sign in required." })

  refreshSession(session)
  await writeDb(db)
  setSessionCookie(res, session)
  res.json({ ok: true })
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

  refreshSession(session)
  await writeDb(db)
  setSessionCookie(res, session)
  res.json({ ok: true })
})

app.use(express.static(distDir))
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(distDir, "index.html"))
})

app.use((error, req, res, next) => {
  if (res.headersSent) {
    next(error)
    return
  }

  res.status(500).json({
    message: error.message ? `Server error: ${error.message}` : "Server error.",
  })
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
    if (error instanceof SyntaxError) {
      await backupCorruptDb()
      return { accounts: [], sessions: [], userData: {} }
    }

    if (error.code !== "ENOENT") throw error
    return { accounts: [], sessions: [], userData: {} }
  }
}

async function backupCorruptDb() {
  const corruptPath = path.join(dataDir, `inventory-db-corrupt-${Date.now()}.json`)

  try {
    await fs.rename(dbPath, corruptPath)
  } catch (error) {
    if (error.code !== "ENOENT") throw error
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

function refreshSession(session) {
  session.expiresAt = Date.now() + sessionDurationMs
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
  const isArtItPage = pageUrl.startsWith("https://savana-unana.github.io/ArtIt")
  const baseTag = `<base href="${escapeHtml(pageUrl)}">`
  const script = `<script>
(() => {
  let realUrl = ${safeUrl};
  const isInventoryArtIt = ${JSON.stringify(isArtItPage)};
  const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  const cleanFileName = (name) => {
    const clean = String(name || "Art It!").trim().replace(/[<>:"/\\\\|?*]/g, "-") || "Art It!";
    return clean.toLowerCase().endsWith(".png") ? clean : clean + ".png";
  };
  let saveRequestId = 0;
  const requestInventorySaveLocation = (name) => new Promise((resolve) => {
    const requestId = ++saveRequestId;
    const receiveResponse = (event) => {
      if (event.data?.type !== "inventory-file-save-response") return;
      if (event.data.requestId !== requestId) return;
      window.removeEventListener("message", receiveResponse);
      resolve({
        folderId: event.data.folderId,
        label: event.data.label || "Inventory",
        fileName: cleanFileName(name),
      });
    };

    window.addEventListener("message", receiveResponse);
    parent.postMessage({
      type: "inventory-file-save-request",
      requestId,
      name: cleanFileName(name),
    }, "*");
  });
  const objectUrls = new Map();
  if (isInventoryArtIt) {
    const originalCreateObjectUrl = URL.createObjectURL.bind(URL);
    const originalRevokeObjectUrl = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (value) => {
      const url = originalCreateObjectUrl(value);
      if (value instanceof Blob) objectUrls.set(url, value);
      return url;
    };
    URL.revokeObjectURL = (url) => {
      setTimeout(() => objectUrls.delete(url), 15000);
      originalRevokeObjectUrl(url);
    };
  }
  const postExport = async (name, blob, destination = {}) => {
    parent.postMessage({
      type: "inventory-file-export",
      name: cleanFileName(name),
      folderId: destination.folderId,
      mimeType: blob.type || "application/octet-stream",
      dataUrl: await blobToDataUrl(blob),
    }, "*");
  };
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
  if (isInventoryArtIt) {
    try {
      Object.defineProperty(window, "showSaveFilePicker", {
        value: async (options = {}) => {
          const destination = await requestInventorySaveLocation(options.suggestedName);
          return {
            name: destination.label,
            async createWritable() {
              const chunks = [];
              return {
                async write(chunk) {
                  chunks.push(chunk);
                },
                async close() {
                  await postExport(
                    destination.fileName,
                    new Blob(chunks, { type: "image/png" }),
                    destination,
                  );
                },
              };
            },
          };
        },
        configurable: true,
      });
    } catch {}
    const originalAnchorClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function patchedAnchorClick() {
      const href = this.getAttribute("href");
      const download = this.getAttribute("download");
      if (download && href && (href.startsWith("blob:") || href.startsWith("data:"))) {
        const blob = objectUrls.get(href);
        if (blob) {
          postExport(download, blob).catch(() => {});
          return;
        }

        fetch(href)
          .then((response) => response.blob())
          .then((blob) => postExport(download, blob))
          .catch(() => {});
        return;
      }

      return originalAnchorClick.call(this);
    };
  }
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
    if (event.defaultPrevented) return;

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
    const downloadLink = event.target.closest?.("a[download][href]");
    if (downloadLink) {
      const href = downloadLink.getAttribute("href");
      if (href?.startsWith("blob:") || href?.startsWith("data:")) {
        event.preventDefault();
        fetch(href)
          .then((response) => response.blob())
          .then((blob) => postExport(downloadLink.getAttribute("download"), blob))
          .catch(() => {});
      }
      return;
    }

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
