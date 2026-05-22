import { useState } from "react"

function Join({ onAuthenticated, onLogin, onSignup }) {
  const [mode, setMode] = useState("login")
  const [displayName, setDisplayName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [message, setMessage] = useState("")
  const [busy, setBusy] = useState(false)

  async function submitAuth(e) {
    e.preventDefault()
    setMessage("")
    setBusy(true)

    try {
      const account =
        mode === "signup"
          ? await onSignup({ displayName, email, password })
          : await onLogin({ email, password })

      onAuthenticated(account)
    } catch (error) {
      setMessage(error.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="login-screen">
      <div className="login-panel">
        <div className="login-avatar">{getInitials(displayName || email || "User")}</div>
        <form className="login-form" onSubmit={submitAuth}>
          {mode === "signup" && (
            <input
              value={displayName}
              autoComplete="name"
              placeholder="Name"
              onChange={(e) => setDisplayName(e.target.value)}
            />
          )}
          <input
            value={email}
            autoComplete="email"
            placeholder="Email"
            type="email"
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            value={password}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            placeholder="Password"
            type="password"
            onChange={(e) => setPassword(e.target.value)}
          />
          <button type="submit" disabled={busy}>
            {busy ? "Please wait" : mode === "signup" ? "Sign up" : "Sign in"}
          </button>
        </form>
        {message && <p className="login-message">{message}</p>}
        <button
          className="login-mode"
          type="button"
          onClick={() => {
            setMode((current) => (current === "login" ? "signup" : "login"))
            setMessage("")
          }}
        >
          {mode === "login" ? "Create account" : "Use existing account"}
        </button>
      </div>
    </main>
  )
}

function getInitials(name) {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "U"
  )
}

export default Join
