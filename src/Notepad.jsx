function Notepad({ text, onChange, onSave }) {
  const line = text.split("\n").length
  const col = text.split("\n").at(-1).length + 1

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
          💾
        </button>
      </div>
    </div>
  )
}

export default Notepad
