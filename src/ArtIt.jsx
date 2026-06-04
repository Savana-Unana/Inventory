import { useEffect, useRef, useState } from "react"

const ART_IT_URL = "https://savana-unana.github.io/ArtIt/"

function ArtIt({ onExport, onPickSaveLocation }) {
  const frameRef = useRef(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    function receiveFrameMessage(event) {
      if (event.source !== frameRef.current?.contentWindow) return

      if (event.data?.type === "inventory-file-save-request") {
        onPickSaveLocation?.({
          name: event.data.name,
          respond: (destination) => {
            frameRef.current?.contentWindow?.postMessage(
              {
                type: "inventory-file-save-response",
                requestId: event.data.requestId,
                ...destination,
              },
              window.location.origin,
            )
          },
        })
        return
      }

      if (event.data?.type !== "inventory-file-export") return

      onExport?.({
        name: event.data.name,
        type: event.data.mimeType,
        dataUrl: event.data.dataUrl,
        folderId: event.data.folderId,
      })
    }

    window.addEventListener("message", receiveFrameMessage)
    return () => window.removeEventListener("message", receiveFrameMessage)
  }, [onExport, onPickSaveLocation])

  function notifyReady() {
    setReady(true)
    frameRef.current?.contentWindow?.postMessage(
      { type: "inventory-browser-ready" },
      window.location.origin,
    )
  }

  return (
    <div className="artit-app">
      {!ready && <div className="artit-loading">Loading Art It!</div>}
      <iframe
        ref={frameRef}
        className="artit-frame"
        src={`/api/browser?url=${encodeURIComponent(ART_IT_URL)}`}
        title="Art It!"
        allow="autoplay; fullscreen; gamepad"
        sandbox="allow-downloads allow-forms allow-modals allow-pointer-lock allow-popups allow-same-origin allow-scripts"
        onLoad={notifyReady}
      />
    </div>
  )
}

export default ArtIt
