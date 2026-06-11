// Tools from React
import { useState } from "react"

// Website this app opens
const TFILLAH_URL = "https://savana-unana.github.io/Tfillah/"

// Tfillah app screen
function Tfillah() {
  // Whether Tfillah has finished loading
  const [ready, setReady] = useState(false)

  // What appears on the screen
  return (
    <div className="remote-app">
      {!ready && (
        <div className="remote-loading">Loading Tfillah</div>
      )}
      <iframe
        className="remote-frame"
        src={TFILLAH_URL}
        title="Tfillah"
        allow="autoplay; fullscreen"
        onLoad={() => setReady(true)}
      />
    </div>
  )
}

// Let other files use this screen
export default Tfillah
