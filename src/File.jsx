import { useEffect, useState } from "react"

const STORAGE_KEY = "inventory-file-explorer-v2"
const STORE_CHANGE_EVENT = "file-store-change"
const ROOT_FOLDER_ID = "user"
const DESKTOP_FOLDER_ID = "desktop"
const RECYCLE_BIN_FOLDER_ID = "recycle-bin"
const REMOVED_DEFAULT_FOLDER_IDS = ["documents", "pictures", "videos"]
const ALLOWED_FILE_TYPES = [
  "audio/mpeg",
  "video/mp4",
  "image/png",
  "image/jpeg",
  "image/gif",
]
const ALLOWED_FILE_EXTENSIONS = /\.(mp3|mp4|png|jpe?g|gif|txt)$/i
const sfxAssets = import.meta.glob("./sfx/*.{mp3,wav,ogg}", {
  eager: true,
  import: "default",
})
const recycledSound = sfxAssets["./sfx/Recycled.mp3"]
const DEFAULT_FOLDERS = [
  { id: ROOT_FOLDER_ID, name: "User Folder", parentId: null },
  { id: DESKTOP_FOLDER_ID, name: "Desktop", parentId: ROOT_FOLDER_ID },
  { id: "downloads", name: "Downloads", parentId: ROOT_FOLDER_ID },
  { id: RECYCLE_BIN_FOLDER_ID, name: "Recycling Bin", parentId: ROOT_FOLDER_ID },
]
const DEFAULT_FOLDER_IDS = DEFAULT_FOLDERS.map((folder) => folder.id)

function File({
  desktopItems = [],
  initialFolder = DESKTOP_FOLDER_ID,
  storageKey = STORAGE_KEY,
  storeChangeEvent = STORE_CHANGE_EVENT,
  onOpenApp,
  onOpenFile,
}) {
  const [store, setStore] = useState(() => loadStore(storageKey))
  const [currentFolder, setCurrentFolder] = useState(initialFolder)
  const [backHistory, setBackHistory] = useState([])
  const [forwardHistory, setForwardHistory] = useState([])
  const [search, setSearch] = useState("")
  const [sort, setSort] = useState({ by: "name", direction: "asc" })
  const [sortOpen, setSortOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [renaming, setRenaming] = useState(null)
  const [renameText, setRenameText] = useState("")
  const [contextMenu, setContextMenu] = useState(null)
  const [message, setMessage] = useState("")

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(store))
  }, [storageKey, store])

  useEffect(() => {
    function reloadStore() {
      setStore(loadStore(storageKey))
    }

    window.addEventListener(storeChangeEvent, reloadStore)
    return () => window.removeEventListener(storeChangeEvent, reloadStore)
  }, [storageKey, storeChangeEvent])

  const folder = store.folders.find((item) => item.id === currentFolder)
  const isRecycleBin = currentFolder === RECYCLE_BIN_FOLDER_ID
  const rawFiles = store.files.filter((file) => file.folderId === currentFolder)
  const rawChildFolders = store.folders.filter(
    (item) =>
      item.parentId === currentFolder && item.id !== RECYCLE_BIN_FOLDER_ID,
  )
  const visibleChildFolders = sortItems(
    rawChildFolders.filter((item) => matchesSearch(item.name, search)),
    sort,
    "folder",
  )
  const visibleFiles = sortItems(
    rawFiles.filter((file) => matchesSearch(file.name, search)),
    sort,
    "file",
  )
  const visibleDesktopItems =
    currentFolder === DESKTOP_FOLDER_ID
      ? sortItems(
          desktopItems.filter((item) => matchesSearch(item.title, search)),
          sort,
          "app",
        )
      : []
  const pathParts = folderPathParts(store.folders, currentFolder)

  function updateStore(updater) {
    setStore((current) => {
      const next = updater(current)

      localStorage.setItem(storageKey, JSON.stringify(next))
      queueMicrotask(() => {
        window.dispatchEvent(new Event(storeChangeEvent))
      })

      return next
    })
  }

  async function addFiles(fileList) {
    if (isRecycleBin) {
      setMessage("Cant upload to Recycling Bin")
      return
    }

    const files = [...fileList]
    const allowedFiles = files.filter(isAllowedUpload)
    const rejectedCount = files.length - allowedFiles.length

    if (rejectedCount > 0) {
      setMessage(`Rejected ${rejectedCount} unsupported file${rejectedCount === 1 ? "" : "s"}`)
    } else {
      setMessage("")
    }

    if (!allowedFiles.length) return

    const nextFiles = await Promise.all(
      allowedFiles.map(async (file) => ({
        id: crypto.randomUUID(),
        name: file.name,
        type: file.type || "application/octet-stream",
        size: file.size,
        folderId: currentFolder,
        addedAt: Date.now(),
        text: file.type.startsWith("text/") ? await file.text() : "",
        dataUrl: await readFile(file),
      })),
    )

    updateStore((current) => ({
      ...current,
      files: [...nextFiles, ...current.files],
    }))
  }

  function dropFiles(e) {
    e.preventDefault()
    setDragging(false)
    setContextMenu(null)
    addFiles(e.dataTransfer.files)
  }

  function makeFolder() {
    if (isRecycleBin) return

    const name = `New folder ${rawChildFolders.length + 1}`

    updateStore((current) => ({
      ...current,
      folders: [
        ...current.folders,
        { id: crypto.randomUUID(), name, parentId: currentFolder },
      ],
    }))
  }

  function navigateTo(folderId, remember = true) {
    if (folderId === currentFolder) return
    if (remember) {
      setBackHistory((current) => [...current, currentFolder])
      setForwardHistory([])
    }
    setCurrentFolder(folderId)
    setSearch("")
    setRenaming(null)
    setContextMenu(null)
  }

  function goBack() {
    setBackHistory((current) => {
      if (!current.length) return current
      const previous = current[current.length - 1]
      setForwardHistory((next) => [currentFolder, ...next])
      setCurrentFolder(previous)
      setSearch("")
      setRenaming(null)
      setContextMenu(null)
      return current.slice(0, -1)
    })
  }

  function goForward() {
    setForwardHistory((current) => {
      if (!current.length) return current
      const nextFolder = current[0]
      setBackHistory((next) => [...next, currentFolder])
      setCurrentFolder(nextFolder)
      setSearch("")
      setRenaming(null)
      setContextMenu(null)
      return current.slice(1)
    })
  }

  function openRename(kind, item) {
    setContextMenu(null)
    setRenaming({ kind, id: item.id })
    setRenameText(item.name ?? item.title)
  }

  function finishRename() {
    const name = renameText.trim()
    if (!renaming || !name) {
      setRenaming(null)
      return
    }

    updateStore((current) => {
      if (renaming.kind === "folder") {
        return {
          ...current,
          folders: current.folders.map((item) =>
            item.id === renaming.id ? { ...item, name } : item,
          ),
        }
      }

      return {
        ...current,
        files: current.files.map((item) =>
          item.id === renaming.id ? { ...item, name } : item,
        ),
      }
    })
    setRenaming(null)
  }

  function openItemMenu(kind, item, e) {
    e.preventDefault()

    setContextMenu({
      kind,
      item,
      x: e.clientX,
      y: e.clientY,
      canRename: canRenameItem(kind, item, isRecycleBin),
      canDelete: canDeleteItem(kind, item, isRecycleBin),
    })
  }

  function deleteItem(kind, item) {
    if (kind === "folder") {
      updateStore((current) => ({
        ...current,
        folders: current.folders.map((folder) =>
          folder.id === item.id
            ? {
                ...folder,
                parentId: RECYCLE_BIN_FOLDER_ID,
                originalParentId: folder.parentId,
                deletedAt: Date.now(),
              }
            : folder,
        ),
      }))
    }

    if (kind === "file") {
      updateStore((current) => ({
        ...current,
        files: current.files.map((file) =>
          file.id === item.id
            ? {
                ...file,
                folderId: RECYCLE_BIN_FOLDER_ID,
                originalFolderId: file.folderId,
                deletedAt: Date.now(),
              }
            : file,
        ),
      }))
    }

    setContextMenu(null)
    setRenaming(null)
  }

  function emptyRecycleBin() {
    updateStore((current) => ({
      ...current,
      files: current.files.filter(
        (file) =>
          file.folderId !== RECYCLE_BIN_FOLDER_ID &&
          !getRecycleFolderTreeIds(current.folders).includes(file.folderId),
      ),
      folders: current.folders.filter(
        (folder) => !getRecycleFolderTreeIds(current.folders).includes(folder.id),
      ),
    }))
    setMessage("Recycling Bin emptied")
    playSound(recycledSound)
  }

  function renameInput(kind, item) {
    const isRenaming = renaming?.kind === kind && renaming.id === item.id

    if (!isRenaming) {
      return (
        <span
          onDoubleClick={(e) => {
            e.stopPropagation()
            if (!canRenameItem(kind, item, isRecycleBin)) return
            openRename(kind, item)
          }}
        >
          {kind === "file" ? cleanFileName(item.name) : item.name}
        </span>
      )
    }

    return (
      <input
        className="file-rename-input"
        value={renameText}
        autoFocus
        onChange={(e) => setRenameText(e.target.value)}
        onBlur={finishRename}
        onKeyDown={(e) => {
          if (e.key === "Enter") finishRename()
          if (e.key === "Escape") setRenaming(null)
        }}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      />
    )
  }

  return (
    <div
      className={`file-app ${dragging ? "file-app-dragging" : ""}`}
      onClick={() => setContextMenu(null)}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={dropFiles}
    >
      <div className="file-tabs">
        <div className="file-tab">{folder?.name}</div>
        {!isRecycleBin && (
          <button className="file-tab-add" type="button" onClick={makeFolder}>
            +
          </button>
        )}
      </div>

      <div className="file-nav">
        <button type="button" onClick={goBack} disabled={!backHistory.length}>
          ←
        </button>
        <button type="button" onClick={goForward} disabled={!forwardHistory.length}>
          →
        </button>
        <button type="button" onClick={() => navigateTo(DESKTOP_FOLDER_ID)}>
          ↑
        </button>
        <button type="button" onClick={() => setSearch("")}>
          ↻
        </button>
        <div className="file-path">
          <span>▣</span>
          {pathParts.map((part) => (
            <span className="file-path-part" key={part.id}>
              <span>›</span>
              <button
                type="button"
                disabled={!part.parentId}
                onClick={() => navigateTo(part.parentId)}
              >
                {part.name}
              </button>
            </span>
          ))}
          <span>›</span>
        </div>
        <input
          className="file-search"
          value={search}
          placeholder={`Search ${folder?.name ?? ""}`}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="file-tools">
        {!isRecycleBin && (
          <button type="button" onClick={makeFolder}>
            ⊕ Folder
          </button>
        )}
        <div className="file-sort-wrap">
          <button type="button" onClick={() => setSortOpen((open) => !open)}>
            ↕ Sort⌄
          </button>
          {sortOpen && (
            <div className="file-sort-menu">
              <button type="button" onClick={() => setSortChoice("name")}>
                {sort.by === "name" ? "• " : ""}Name
              </button>
              <button type="button" onClick={() => setSortChoice("date")}>
                {sort.by === "date" ? "• " : ""}Date modified
              </button>
              <button type="button" onClick={() => setSortChoice("type")}>
                {sort.by === "type" ? "• " : ""}Type
              </button>
              <div className="file-sort-divider" />
              <button type="button" onClick={() => setSortDirection("asc")}>
                {sort.direction === "asc" ? "• " : ""}Ascending
              </button>
              <button type="button" onClick={() => setSortDirection("desc")}>
                {sort.direction === "desc" ? "• " : ""}Descending
              </button>
            </div>
          )}
        </div>
        {isRecycleBin && (
          <button type="button" onClick={emptyRecycleBin}>
            Empty Recycling Bin
          </button>
        )}
      </div>

      <div className="file-content">
        <aside className="file-sidebar">
          <button
            className={`file-side-item file-side-root ${
              currentFolder === ROOT_FOLDER_ID ? "file-side-active" : ""
            }`}
            type="button"
            onContextMenu={(e) =>
              openItemMenu(
                "folder",
                store.folders.find((item) => item.id === ROOT_FOLDER_ID),
                e,
              )
            }
            onClick={() => navigateTo(ROOT_FOLDER_ID)}
          >
            User Folder
          </button>
          {store.folders
            .filter((item) => item.parentId === ROOT_FOLDER_ID)
            .filter((item) => item.id !== RECYCLE_BIN_FOLDER_ID)
            .map((item) => (
              <button
                key={item.id}
                className={`file-side-item file-side-child ${
                  item.id === currentFolder ? "file-side-active" : ""
                }`}
                type="button"
                onContextMenu={(e) => openItemMenu("folder", item, e)}
                onClick={() => navigateTo(item.id)}
              >
                {item.name}
              </button>
            ))}
          <button
            className={`file-side-item file-side-bin ${
              isRecycleBin ? "file-side-active" : ""
            }`}
            type="button"
            onContextMenu={(e) =>
              openItemMenu(
                "folder",
                store.folders.find((item) => item.id === RECYCLE_BIN_FOLDER_ID),
                e,
              )
            }
            onClick={() => navigateTo(RECYCLE_BIN_FOLDER_ID)}
          >
            <span className="file-side-icon">♲</span>
            Recycling Bin
          </button>
        </aside>

        <section className="file-list">
          <h3>⌄ Today</h3>
          <div className="file-grid">
            {visibleChildFolders
              .map((item) => (
                <button
                  key={item.id}
                  className="file-item"
                  type="button"
                  onContextMenu={(e) => openItemMenu("folder", item, e)}
                  onDoubleClick={() => navigateTo(item.id)}
                >
                  <div className="file-thumb-folder"></div>
                  {renameInput("folder", item)}
                </button>
              ))}

            {visibleDesktopItems.map((app) => (
              <button
                key={app.type}
                className="file-item"
                type="button"
                onContextMenu={(e) => openItemMenu("app", app, e)}
                onDoubleClick={() => onOpenApp(app)}
              >
                <img className="file-thumb-app" src={app.logo} alt="" />
                <span>{app.title}</span>
              </button>
            ))}

            {visibleFiles.map((file) => (
              <button
                key={file.id}
                className="file-item"
                type="button"
                onContextMenu={(e) => openItemMenu("file", file, e)}
                onDoubleClick={() => onOpenFile(file)}
              >
                <FileThumb file={file} />
                {renameInput("file", file)}
              </button>
            ))}
          </div>
        </section>
      </div>

      <div className="file-status">
        <span>
          {visibleFiles.length + visibleChildFolders.length + visibleDesktopItems.length} items
        </span>
        {message && <span className="file-message">{message}</span>}
      </div>

      {contextMenu && (
        <div
          className="file-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            disabled={!contextMenu.canRename}
            onClick={() => openRename(contextMenu.kind, contextMenu.item)}
          >
            Rename
          </button>
          <button
            type="button"
            disabled={!contextMenu.canDelete}
            onClick={() => deleteItem(contextMenu.kind, contextMenu.item)}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  )

  function setSortChoice(by) {
    setSort((current) => ({ ...current, by }))
  }

  function setSortDirection(direction) {
    setSort((current) => ({ ...current, direction }))
  }
}

function FileThumb({ file }) {
  if (file.type.startsWith("image/")) {
    return <img className="file-thumb-img" src={file.dataUrl} alt="" />
  }

  if (isMediaFile(file)) {
    return <div className="file-thumb-video">▶</div>
  }

  if (file.type.startsWith("text/")) {
    return <div className="file-thumb-text">≡</div>
  }

  return <div className="file-thumb-doc">▱</div>
}

function cleanFileName(name) {
  return name.replace(/\.[^/.]+$/, "")
}

function isMediaFile(file) {
  return (
    file.type === "video/mp4" ||
    file.type === "audio/mpeg" ||
    /\.(mp3|mp4)$/i.test(file.name)
  )
}

function isAllowedUpload(file) {
  return (
    file.type.startsWith("text/") ||
    ALLOWED_FILE_TYPES.includes(file.type) ||
    ALLOWED_FILE_EXTENSIONS.test(file.name)
  )
}

function canRenameItem(kind, item, isRecycleBin) {
  if (isRecycleBin) return false
  if (kind === "app") return false
  if (kind === "folder") return !DEFAULT_FOLDER_IDS.includes(item.id)
  return kind === "file"
}

function canDeleteItem(kind, item, isRecycleBin) {
  if (isRecycleBin) return false
  if (kind === "app") return false
  if (kind === "folder") return !DEFAULT_FOLDER_IDS.includes(item.id)
  return kind === "file"
}

function getRecycleFolderTreeIds(folders) {
  const ids = []
  const pending = folders
    .filter((folder) => folder.parentId === RECYCLE_BIN_FOLDER_ID)
    .map((folder) => folder.id)

  while (pending.length > 0) {
    const id = pending.shift()
    ids.push(id)

    pending.push(
      ...folders
        .filter((folder) => folder.parentId === id)
        .map((folder) => folder.id),
    )
  }

  return ids
}

function matchesSearch(name, search) {
  return name.toLowerCase().includes(search.trim().toLowerCase())
}

function sortItems(items, sort, kind) {
  const sorted = [...items].sort((a, b) => {
    if (sort.by === "date") {
      return (a.addedAt ?? 0) - (b.addedAt ?? 0)
    }

    if (sort.by === "type") {
      const aType = kind === "folder" ? "folder" : a.type ?? "app"
      const bType = kind === "folder" ? "folder" : b.type ?? "app"
      return aType.localeCompare(bType)
    }

    return (a.name ?? a.title).localeCompare(b.name ?? b.title, undefined, {
      numeric: true,
    })
  })

  return sort.direction === "desc" ? sorted.reverse() : sorted
}

function folderPathParts(folders, currentFolder) {
  const parts = []
  let folder = folders.find((item) => item.id === currentFolder)

  while (folder) {
    parts.unshift(folder)
    folder = folders.find((item) => item.id === folder.parentId)
  }

  return parts
}

function loadStore(storageKey = STORAGE_KEY) {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey))
    if (!saved) return { folders: DEFAULT_FOLDERS, files: [] }

    const savedFolders = saved.folders ?? []
    const folders = savedFolders
      .filter((folder) => !REMOVED_DEFAULT_FOLDER_IDS.includes(folder.id))
      .map((folder) => ({
        ...folder,
        parentId:
          folder.parentId ?? (folder.id === ROOT_FOLDER_ID ? null : ROOT_FOLDER_ID),
      }))
    const missingDefaults = DEFAULT_FOLDERS.filter(
      (folder) => !folders.some((savedFolder) => savedFolder.id === folder.id),
    )

    return {
      folders: [...missingDefaults, ...folders],
      files: (saved.files ?? []).filter(
        (file) => !REMOVED_DEFAULT_FOLDER_IDS.includes(file.folderId),
      ),
    }
  } catch {
    return { folders: DEFAULT_FOLDERS, files: [] }
  }
}

function readFile(file) {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.readAsDataURL(file)
  })
}

function playSound(sound) {
  if (!sound) return

  const audio = new Audio(sound)
  audio.play().catch(() => {})
}

export default File
