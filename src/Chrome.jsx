// Tools from React
import { useEffect, useRef, useState } from "react"

// Pictures used by the browser
import reloadIcon from "./assets/logos/Reload.png"
import chromeIcon from "./assets/logos/GoogleChrome.png"

// Website the browser opens first
const HOME_URL = "https://savana-unana.github.io/UPRO/"

// Browser app screen
function Chrome({ url = HOME_URL, onClose }) {
  // Things the browser needs to remember
  const frameRefs = useRef({})
  const [tabs, setTabs] = useState(() => [makeChromeTab(url)])
  const [activeTabId, setActiveTabId] = useState(() => tabs[0].id)

  // Information based on the active tab
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0]
  const historyIndex = activeTab.historyIndex
  const canGoBack = historyIndex > 0
  const canGoForward = activeTab.historyIndex < activeTab.history.length - 1

  // Keep tab titles and icons up to date
  useEffect(() => {
    for (const tab of tabs) {
      const currentUrl = tab.history[tab.historyIndex]
      if (tab.iconPageUrl === currentUrl) continue

      resolvePageIcon(currentUrl).then((icon) => {
        setTabs((current) =>
          current.map((item) =>
            item.id === tab.id &&
            item.history[item.historyIndex] === currentUrl
              ? { ...item, icon, iconPageUrl: currentUrl }
              : item,
          ),
        )
      })
    }
  }, [tabs])

  function updateActiveTab(updater) {
    setTabs((current) =>
      current.map((tab) =>
        tab.id === activeTab.id ? { ...tab, ...updater(tab) } : tab,
      ),
    )
  }

  // Listen for messages from the page inside the browser
  useEffect(() => {
    function receiveFrameMessage(event) {
      const sourceTab = tabs.find(
        (tab) => event.source === frameRefs.current[tab.id]?.contentWindow,
      )
      if (!sourceTab) return
      if (!["inventory-browser-url", "upro-browser-url"].includes(event.data?.type)) {
        return
      }

      const nextUrl = event.data.url
      if (!nextUrl) return

      if (nextUrl === sourceTab.history[sourceTab.historyIndex]) {
        if (event.data.title) {
          setTabs((current) =>
            current.map((tab) =>
              tab.id === sourceTab.id
                ? { ...tab, title: event.data.title, titlePageUrl: nextUrl }
                : tab,
            ),
          )
        }
        return
      }

      setTabs((current) =>
        current.map((tab) =>
          tab.id === sourceTab.id
            ? {
                ...tab,
                address: nextUrl,
                icon: getFaviconUrl(nextUrl),
                iconPageUrl: "",
                title: event.data.title || getChromeTabTitle(nextUrl),
                titlePageUrl: event.data.title ? nextUrl : "",
                history: [...tab.history.slice(0, tab.historyIndex + 1), nextUrl],
                historyIndex: tab.historyIndex + 1,
              }
            : tab,
        ),
      )
    }

    window.addEventListener("message", receiveFrameMessage)
    return () => window.removeEventListener("message", receiveFrameMessage)
  }, [tabs])

  useEffect(() => {
    for (const tab of tabs) {
      const currentUrl = tab.history[tab.historyIndex]
      if (tab.titlePageUrl === currentUrl) continue

      resolvePageTitle(currentUrl).then((title) => {
        setTabs((current) =>
          current.map((item) =>
            item.id === tab.id &&
            item.history[item.historyIndex] === currentUrl
              ? {
                  ...item,
                  title: title || getChromeTabTitle(currentUrl),
                  titlePageUrl: currentUrl,
                }
              : item,
          ),
        )
      })
    }
  }, [tabs])

  // What happens when the user navigates
  function goToAddress(event) {
    event.preventDefault()

    const nextUrl = normalizeUrl(activeTab.address)
    navigateTo(nextUrl)
  }

  function goBack() {
    if (!canGoBack) return

    updateActiveTab((tab) => {
      const nextIndex = tab.historyIndex - 1
      return {
        historyIndex: nextIndex,
        address: tab.history[nextIndex],
        icon: getFaviconUrl(tab.history[nextIndex]),
        iconPageUrl: "",
        title: getChromeTabTitle(tab.history[nextIndex]),
        titlePageUrl: "",
      }
    })
  }

  function goForward() {
    if (!canGoForward) return

    updateActiveTab((tab) => {
      const nextIndex = tab.historyIndex + 1
      return {
        historyIndex: nextIndex,
        address: tab.history[nextIndex],
        icon: getFaviconUrl(tab.history[nextIndex]),
        iconPageUrl: "",
        title: getChromeTabTitle(tab.history[nextIndex]),
        titlePageUrl: "",
      }
    })
  }

  function reloadPage() {
    updateActiveTab((tab) => ({ reloadKey: tab.reloadKey + 1 }))
  }

  function navigateTo(nextUrl) {
    updateActiveTab((tab) => ({
      address: nextUrl,
      icon: getFaviconUrl(nextUrl),
      iconPageUrl: "",
      title: getChromeTabTitle(nextUrl),
      titlePageUrl: "",
      history: [...tab.history.slice(0, tab.historyIndex + 1), nextUrl],
      historyIndex: tab.historyIndex + 1,
    }))
  }

  // What happens when tabs are opened or closed
  function openNewTab() {
    const tab = makeChromeTab(HOME_URL)
    setTabs((current) => [...current, tab])
    setActiveTabId(tab.id)
  }

  function closeTab(tabId, event) {
    event.stopPropagation()
    if (tabs.length === 1) {
      onClose()
      return
    }

    const tabIndex = tabs.findIndex((tab) => tab.id === tabId)
    const nextTabs = tabs.filter((tab) => tab.id !== tabId)
    setTabs(nextTabs)

    if (tabId === activeTab.id) {
      setActiveTabId(nextTabs[Math.max(0, tabIndex - 1)].id)
    }
  }

  // What appears on the screen
  return (
    <div className="chrome-app">
      <div className="chrome-tabs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`chrome-tab ${tab.id === activeTab.id ? "chrome-tab-active" : ""}`}
            type="button"
            onClick={() => setActiveTabId(tab.id)}
          >
            <img src={tab.icon} alt="" onError={useFallbackIcon} />
            <span>{tab.title}</span>
            <span
              className="app-tab-close"
              role="button"
              tabIndex={0}
              onClick={(event) => closeTab(tab.id, event)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") closeTab(tab.id, event)
              }}
            >
              x
            </span>
          </button>
        ))}
        <button className="chrome-tab-add" type="button" onClick={openNewTab}>
          +
        </button>
      </div>
      <div className="chrome-toolbar">
        <button
          className="chrome-nav-button"
          type="button"
          aria-label="Back"
          disabled={!canGoBack}
          onClick={goBack}
        >
          ‹
        </button>
        <button
          className="chrome-nav-button"
          type="button"
          aria-label="Forward"
          disabled={!canGoForward}
          onClick={goForward}
        >
          ›
        </button>
        <button
          className="chrome-nav-button"
          type="button"
          aria-label="Reload"
          onClick={reloadPage}
        >
          <img src={reloadIcon} alt="" />
        </button>
        <form className="chrome-address" onSubmit={goToAddress}>
          <input
            aria-label="Address"
            value={activeTab.address}
            onChange={(event) =>
              updateActiveTab(() => ({ address: event.target.value }))
            }
          />
        </form>
      </div>
      <div className="chrome-frame-stack">
        {tabs.map((tab) => {
          const tabUrl = tab.history[tab.historyIndex]

          return (
            <iframe
              key={`${tab.id}:${tab.reloadKey}`}
              ref={(node) => {
                if (node) frameRefs.current[tab.id] = node
                else delete frameRefs.current[tab.id]
              }}
              className={`chrome-frame ${
                tab.id === activeTab.id ? "chrome-frame-active" : ""
              }`}
              src={getBrowserFrameUrl(tabUrl)}
              title="Google Chrome"
              onLoad={() => {
                frameRefs.current[tab.id]?.contentWindow?.postMessage(
                  { type: "inventory-browser-ready" },
                  window.location.origin,
                )
              }}
            />
          )
        })}
      </div>
    </div>
  )
}

// Make a new browser tab
function makeChromeTab(url) {
  return {
    id: crypto.randomUUID(),
    address: url,
    icon: getFaviconUrl(url),
    iconPageUrl: "",
    title: getChromeTabTitle(url),
    titlePageUrl: "",
    history: [url],
    historyIndex: 0,
    reloadKey: 0,
  }
}

// Small helpers for browser icons
function getFaviconUrl(url) {
  try {
    const parsedUrl = new URL(url)
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(
      parsedUrl.hostname,
    )}&sz=32`
  } catch {
    return chromeIcon
  }
}

function useFallbackIcon(event) {
  event.currentTarget.onerror = null
  event.currentTarget.src = chromeIcon
}

// Small helpers for page names and icons
async function resolvePageIcon(url) {
  return getFaviconUrl(url)
}

async function resolvePageTitle(url) {
  return getChromeTabTitle(url)
}

function getChromeTabTitle(url) {
  try {
    const parsedUrl = new URL(url)
    return decodeURIComponent(
      parsedUrl.pathname.split("/").filter(Boolean).at(-1) || parsedUrl.hostname,
    )
  } catch {
    return "New Tab"
  }
}

// Small helpers for web addresses
function getBrowserFrameUrl(url) {
  try {
    const parsedUrl = new URL(url)
    if (!["http:", "https:"].includes(parsedUrl.protocol)) return url

    return url
  } catch {
    return url
  }
}

function normalizeUrl(value) {
  const trimmed = value.trim()
  if (!trimmed) return HOME_URL
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed
  if (trimmed.includes(".") && !trimmed.includes(" ")) return `https://${trimmed}`

  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`
}

// Let other files use this screen
export default Chrome
