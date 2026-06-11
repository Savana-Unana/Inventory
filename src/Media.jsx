// Tools from React
import { useEffect, useRef } from "react"

// Music and video player screen
function Media({ name, dataUrl, mediaType, volume = 1 }) {
  // The music or video element on the page
  const mediaRef = useRef(null)

  // Decide whether this file is audio or video
  const isAudio =
    mediaType?.startsWith("audio/") || /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(name)

  // Keep the player volume matched to the app volume
  useEffect(() => {
    if (mediaRef.current) mediaRef.current.volume = volume
  }, [volume])

  // What appears on the screen
  return (
    <div className="media-app">
      {isAudio ? (
        <audio ref={mediaRef} src={dataUrl} title={name} controls />
      ) : (
        <video ref={mediaRef} src={dataUrl} title={name} controls />
      )}
    </div>
  )
}

// Let other files use this screen
export default Media
