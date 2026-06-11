// Tools from React
import { useState } from "react"

// Website this app opens
const YELLOW_STORE_URL = "https://savana-unana.github.io/Mall/"

// Yellow Store app screen
function YellowStore() {
  // Whether the store has finished loading
  const [ready, setReady] = useState(false)

  // What appears on the screen
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

// Let other files use this screen
export default YellowStore
