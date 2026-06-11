// Photo viewer screen
function Photos({ name, dataUrl }) {
  // What appears on the screen
  return (
    <div className="photos-app">
      <img src={dataUrl} alt={name} />
    </div>
  )
}

// Let other files use this screen
export default Photos
