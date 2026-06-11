// Notepad screen
function Notepad({
  documentName = "Untitled Document",
  text,
  onChange,
  onOpen,
  onSave,
}) {
  // Current line and column numbers
  const line = text.split("\n").length
  const col = text.split("\n").at(-1).length + 1

  // What appears on the screen
  return (
    <div
      className="notepad-app"
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
          e.preventDefault()
          onSave()
        }
      }}
    >
      <header className="notepad-header">
        <span>{documentName}</span>
        <button type="button" onClick={onOpen}>
          Open
        </button>
      </header>

      <textarea
        className="notes-area"
        value={text}
        spellCheck="false"
        onPointerDown={(e) => e.stopPropagation()}
        onChange={(e) => {
          onChange(e.target.value)
        }}
      />

      <div className="notepad-status">
        <span>Ln {line}, Col {col}</span>
        <span>{text.length} characters</span>
        <button className="notepad-save-button" type="button" onClick={onSave}>
          Save
        </button>
      </div>
    </div>
  )
}

// Let other files use this screen
export default Notepad
