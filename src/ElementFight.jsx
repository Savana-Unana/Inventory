import { useState } from "react"

const ELEMENT_FIGHT_URL = "https://savana-unana.github.io/ElementFight/"

function ElementFight() {
  const [ready, setReady] = useState(false)

  return (
    <div className="remote-app">
      {!ready && (
        <div className="remote-loading">Loading Element Fight</div>
      )}
      <iframe
        className="remote-frame"
        src={`/api/browser?url=${encodeURIComponent(ELEMENT_FIGHT_URL)}`}
        title="Element Fight"
        sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
        onLoad={() => setReady(true)}
      />
    </div>
  )
}

export default ElementFight
