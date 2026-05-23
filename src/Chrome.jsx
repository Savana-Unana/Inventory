const HOME_URL = "https://savana-unana.github.io/UPRO/animatrix"

function Chrome({ url = HOME_URL }) {
  return (
    <div className="chrome-app">
      <div className="chrome-toolbar">
        <div className="chrome-nav-dot"></div>
        <div className="chrome-nav-dot"></div>
        <div className="chrome-nav-dot"></div>
        <div className="chrome-address">{url}</div>
      </div>
      <iframe
        className="chrome-frame"
        src={url}
        title="Google Chrome"
        sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
      />
    </div>
  )
}

export default Chrome
