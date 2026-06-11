// Settings screen
function Settings({
  backgrounds = [],
  files = [],
  folders = [],
  background,
  homeFolderId,
  taskbarHoverMode,
  volume,
  onBackgroundChange,
  onHomeFolderChange,
  onTaskbarHoverModeChange,
  onVolumeChange,
}) {
  // Choices made from the current settings
  const imageFiles = files.filter((file) => file.type.startsWith("image/"))
  const selectedBackground = getSelectedBackground(
    background,
    backgrounds,
    imageFiles,
  )

  // What happens when a setting changes
  function changeVolume(value) {
    const nextVolume = Math.max(0, Math.min(100, Number(value) || 0)) / 100
    onVolumeChange(nextVolume)
  }

  function changeBackground(value) {
    const defaultBackground = backgrounds.find((item) => item.id === value)
    if (defaultBackground) {
      onBackgroundChange(defaultBackground.url)
      return
    }

    const imageFile = imageFiles.find((file) => file.id === value)
    if (imageFile?.dataUrl) onBackgroundChange(imageFile.dataUrl)
  }

  function removeBackground() {
    const fallback = backgrounds[0]
    if (fallback) onBackgroundChange(fallback.url)
  }

  // What appears on the screen
  return (
    <div className="settings-app">
      <header className="settings-header">Settings</header>

      <main className="settings-content">
        <section className="settings-section">
          <h2>Sound</h2>
          <div className="settings-row settings-row-volume">
            <label htmlFor="settings-volume">Volume</label>
            <input
              id="settings-volume"
              className="settings-slider"
              type="range"
              min="0"
              max="100"
              value={Math.round(volume * 100)}
              onChange={(event) => changeVolume(event.target.value)}
            />
            <input
              className="settings-number"
              type="number"
              min="0"
              max="100"
              value={Math.round(volume * 100)}
              onChange={(event) => changeVolume(event.target.value)}
            />
          </div>
        </section>

        <section className="settings-section">
          <h2>Taskbar</h2>
          <label className="settings-check">
            <input
              type="checkbox"
              checked={taskbarHoverMode}
              onChange={(event) =>
                onTaskbarHoverModeChange(event.target.checked)
              }
            />
            <span>Taskbar Hover Mode</span>
          </label>
        </section>

        <section className="settings-section">
          <h2>File Explorer</h2>
          <label className="settings-field">
            Home folder
            <select
              value={homeFolderId}
              onChange={(event) => onHomeFolderChange(event.target.value)}
            >
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folderPath(folders, folder.id)}
                </option>
              ))}
            </select>
          </label>
        </section>

        <section className="settings-section">
          <h2>Background</h2>
          <label className="settings-field">
            Image
            <select value={selectedBackground} onChange={(event) => changeBackground(event.target.value)}>
              <optgroup label="Default">
                {backgrounds.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </optgroup>
              {imageFiles.length > 0 && (
                <optgroup label="Your images">
                  {imageFiles.map((file) => (
                    <option key={file.id} value={file.id}>
                      {file.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>
          <div className="settings-background-preview">
            <img src={background} alt="" />
          </div>
          <button
            className="settings-secondary-button"
            type="button"
            onClick={removeBackground}
          >
            Remove background
          </button>
        </section>
      </main>
    </div>
  )
}

// Small helpers for choosing the selected background
function getSelectedBackground(background, backgrounds, imageFiles) {
  return (
    backgrounds.find((item) => item.url === background)?.id ??
    imageFiles.find((file) => file.dataUrl === background)?.id ??
    ""
  )
}

// Small helpers for showing folder names
function folderPath(folders, currentFolder) {
  const names = []
  let folder = folders.find((item) => item.id === currentFolder)

  while (folder) {
    names.unshift(folder.name)
    folder = folders.find((item) => item.id === folder.parentId)
  }

  return names.join(" > ")
}

// Let other files use this screen
export default Settings
