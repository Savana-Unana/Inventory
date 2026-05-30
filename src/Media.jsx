import { useEffect, useRef } from "react"

function Media({ name, dataUrl, mediaType, volume = 1 }) {
  const mediaRef = useRef(null)
  const isAudio =
    mediaType?.startsWith("audio/") || /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(name)

  useEffect(() => {
    if (mediaRef.current) mediaRef.current.volume = volume
  }, [volume])

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

export default Media
