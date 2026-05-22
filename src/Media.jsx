function Media({ name, dataUrl, mediaType }) {
  const isAudio =
    mediaType?.startsWith("audio/") || /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(name)

  return (
    <div className="media-app">
      {isAudio ? (
        <audio src={dataUrl} title={name} controls />
      ) : (
        <video src={dataUrl} title={name} controls />
      )}
    </div>
  )
}

export default Media
