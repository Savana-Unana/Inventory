import { useState } from "react"

const HOME_URL = "https://savana-unana.github.io/UPRO/animatrix"

function Chrome({ url = HOME_URL }) {
  const [address, setAddress] = useState(url)
  const [pageUrl, setPageUrl] = useState(url)

  function goToAddress(event) {
    event.preventDefault()

    const nextUrl = normalizeUrl(address)
    setAddress(nextUrl)
    setPageUrl(nextUrl)
  }

  return (
    <div className="chrome-app">
      <div className="chrome-toolbar">
        <div className="chrome-nav-dot"></div>
        <div className="chrome-nav-dot"></div>
        <div className="chrome-nav-dot"></div>
        <form className="chrome-address" onSubmit={goToAddress}>
          <input
            aria-label="Address"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
          />
        </form>
      </div>
      <iframe
        className="chrome-frame"
        src={pageUrl}
        title="Google Chrome"
        sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
      />
    </div>
  )
}

function normalizeUrl(value) {
  const trimmed = value.trim()
  if (!trimmed) return HOME_URL
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed
  if (trimmed.includes(".") && !trimmed.includes(" ")) return `https://${trimmed}`

  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`
}

export default Chrome
