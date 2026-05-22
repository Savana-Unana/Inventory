function Photos({ name, dataUrl }) {
  return (
    <div className="photos-app">
      <img src={dataUrl} alt={name} />
    </div>
  )
}

export default Photos
