import { useState } from "react"

const YELLOW_STORE_URL = "https://savana-unana.github.io/Mall/"

function YellowStore() {
  const [ready, setReady] = useState(false)

  return (
    <div className="yellow-store-app">
      {!ready && (
        <div className="yellow-store-loading">
          <span>The Yellow Store</span>
        </div>
      )}
      <iframe
        className="yellow-store-frame"
        src={YELLOW_STORE_URL}
        title="The Yellow Store"
        allow="autoplay; fullscreen"
        onLoad={() => setReady(true)}
      />
    </div>
  )
}

export default YellowStore
