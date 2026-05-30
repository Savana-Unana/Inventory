import { useEffect, useState } from "react"
import folderIcon from "./assets/logos/Folder.png"
import fileIcon from "./assets/logos/FileExplorer.png"

const STORAGE_KEY = "inventory-file-explorer-v2"
const STORE_CHANGE_EVENT = "file-store-change"
const ROOT_FOLDER_ID = "user"
const DESKTOP_FOLDER_ID = "desktop"
const RECYCLE_BIN_FOLDER_ID = "recycle-bin"
const REMOVED_DEFAULT_FOLDER_IDS = ["documents", "pictures", "videos"]
const ALLOWED_FILE_TYPES = [
  "audio/mpeg",
  "video/mp4",
]
const ALLOWED_FILE_EXTENSIONS = /\.(mp3|mp4|png|jpe?g|gif|webp|bmp|svg|avif|ico|txt)$/i
const INTERNAL_DRAG_TYPE = "application/x-inventory-file-items"
const sfxAssets = import.meta.glob("./sfx/*.{mp3,wav,ogg}", {
  eager: true,
  import: "default",
})
const recycledSound = sfxAssets["./sfx/Recycled.mp3"]
const BASE_DEFAULT_FOLDERS = [
  { id: ROOT_FOLDER_ID, name: "User Folder", parentId: null },
  { id: DESKTOP_FOLDER_ID, name: "Desktop", parentId: ROOT_FOLDER_ID },
  { id: "downloads", name: "Downloads", parentId: ROOT_FOLDER_ID },
  { id: RECYCLE_BIN_FOLDER_ID, name: "Recycling Bin", parentId: ROOT_FOLDER_ID },
]
const DEFAULT_FOLDER_IDS = BASE_DEFAULT_FOLDERS.map((folder) => folder.id)

function makeFileTab(initialFolder) {
  return {
    id: crypto.randomUUID(),
    currentFolder: initialFolder,
    backHistory: [],
    forwardHistory: [],
    search: "",
  }
}

function File({
  desktopItems = [],
  initialFolder = DESKTOP_FOLDER_ID,
  homeFolderId = DESKTOP_FOLDER_ID,
  rootFolderName = "User Folder",
  storageKey = STORAGE_KEY,
  storeChangeEvent = STORE_CHANGE_EVENT,
  volume = 1,
  onOpenApp,
  onOpenFile,
  onClose,
}) {
  const [store, setStore] = useState(() => loadStore(storageKey, rootFolderName))
  const [tabs, setTabs] = useState(() => [makeFileTab(initialFolder)])
  const [activeTabId, setActiveTabId] = useState(() => tabs[0].id)
  const [sort, setSort] = useState({ by: "name", direction: "asc" })
  const [sortOpen, setSortOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [renaming, setRenaming] = useState(null)
  const [renameText, setRenameText] = useState("")
  const [contextMenu, setContextMenu] = useState(null)
  const [message, setMessage] = useState("")
  const [selectedItems, setSelectedItems] = useState([])
  const [dragTargetFolder, setDragTargetFolder] = useState(null)

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(store))
    } catch {
      queueMicrotask(() => setMessage("That file is too large to save here"))
    }
  }, [storageKey, store])

  useEffect(() => {
    function reloadStore() {
      setStore(loadStore(storageKey, rootFolderName))
    }

    window.addEventListener(storeChangeEvent, reloadStore)
    return () => window.removeEventListener(storeChangeEvent, reloadStore)
  }, [rootFolderName, storageKey, storeChangeEvent])

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0]
  const currentFolder = activeTab.currentFolder
  const backHistory = activeTab.backHistory
  const forwardHistory = activeTab.forwardHistory
  const search = activeTab.search
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
          desktopItems.filter((item) =>
            !["file", "folder"].includes(item.desktopKind) &&
            matchesSearch(item.title, search),
          ),
          sort,
          "app",
        )
      : []
  const pathParts = folderPathParts(store.folders, currentFolder)
  const safeHomeFolderId = store.folders.some((folder) => folder.id === homeFolderId)
    ? homeFolderId
    : DESKTOP_FOLDER_ID

  function updateActiveTab(updater) {
    setTabs((current) =>
      current.map((tab) =>
        tab.id === activeTab.id ? { ...tab, ...updater(tab) } : tab,
      ),
    )
  }

  function setSearch(value) {
    updateActiveTab(() => ({ search: value }))
  }

  function updateStore(updater) {
    setStore((current) => {
      const next = updater(current)

      try {
        localStorage.setItem(storageKey, JSON.stringify(next))
      } catch {
        setMessage("That file is too large to save here")
        return current
      }

      queueMicrotask(() => {
        window.dispatchEvent(new Event(storeChangeEvent))
      })

      return next
    })
  }

  async function addFiles(fileList, droppedUrls = []) {
    if (isRecycleBin) {
      setMessage("Cant upload to Recycling Bin")
      return
    }

    const files = [...fileList]
    const allowedFiles = files.filter(isAllowedUpload)
    const rejectedCount = files.length - allowedFiles.length
    const imageUrlFiles = droppedUrls
      .filter(isImageUrl)
      .map((url) => makeUrlFile(url, currentFolder))

    if (rejectedCount > 0) {
      setMessage(`Rejected ${rejectedCount} unsupported file${rejectedCount === 1 ? "" : "s"}`)
    } else {
      setMessage("")
    }

    if (!allowedFiles.length && !imageUrlFiles.length) return

    const existingNames = store.files
      .filter((file) => file.folderId === currentFolder)
      .map((file) => file.name)
    const nextFiles = await Promise.all(
      allowedFiles.map(async (file) => {
        const name = getUniqueFileName(file.name, existingNames)
        existingNames.push(name)

        return {
          id: crypto.randomUUID(),
          name,
          type: file.type || "application/octet-stream",
          size: file.size,
          folderId: currentFolder,
          addedAt: Date.now(),
          text: file.type.startsWith("text/") ? await file.text() : "",
          dataUrl: await readStoredFileData(file),
        }
      }),
    )
    const uniqueUrlFiles = imageUrlFiles.map((file) => {
      const name = getUniqueFileName(file.name, existingNames)
      existingNames.push(name)
      return { ...file, name }
    })

    updateStore((current) => ({
      ...current,
      files: [...nextFiles, ...uniqueUrlFiles, ...current.files],
    }))
  }

  function dropFiles(e) {
    e.preventDefault()
    setDragging(false)
    setDragTargetFolder(null)
    setContextMenu(null)
    if (e.dataTransfer.types.includes(INTERNAL_DRAG_TYPE)) return
    addFiles(e.dataTransfer.files, getDroppedUrls(e.dataTransfer))
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
    updateActiveTab((tab) => ({
      currentFolder: folderId,
      backHistory: remember ? [...tab.backHistory, currentFolder] : tab.backHistory,
      forwardHistory: remember ? [] : tab.forwardHistory,
      search: "",
    }))
    setRenaming(null)
    setContextMenu(null)
    setSelectedItems([])
  }

  function goBack() {
    if (!backHistory.length) return

    updateActiveTab((tab) => ({
      currentFolder: tab.backHistory.at(-1),
      backHistory: tab.backHistory.slice(0, -1),
      forwardHistory: [tab.currentFolder, ...tab.forwardHistory],
      search: "",
    }))
    setRenaming(null)
    setContextMenu(null)
  }

  function goForward() {
    if (!forwardHistory.length) return

    updateActiveTab((tab) => ({
      currentFolder: tab.forwardHistory[0],
      backHistory: [...tab.backHistory, tab.currentFolder],
      forwardHistory: tab.forwardHistory.slice(1),
      search: "",
    }))
    setRenaming(null)
    setContextMenu(null)
  }

  function openNewTab() {
    const tab = makeFileTab(DESKTOP_FOLDER_ID)
    setTabs((current) => [...current, tab])
    setActiveTabId(tab.id)
    setRenaming(null)
    setContextMenu(null)
  }

  function closeTab(tabId, event) {
    event.stopPropagation()
    if (tabs.length === 1) {
      onClose()
      return
    }

    const tabIndex = tabs.findIndex((tab) => tab.id === tabId)
    const nextTabs = tabs.filter((tab) => tab.id !== tabId)
    setTabs(nextTabs)

    if (tabId === activeTab.id) {
      setActiveTabId(nextTabs[Math.max(0, tabIndex - 1)].id)
    }
  }

  function openRename(kind, item) {
    setContextMenu(null)
    setRenaming({ kind, id: item.id })
    setRenameText(item.name ?? item.title)
  }

  function selectItem(key, e) {
    if (e.ctrlKey || e.metaKey) {
      setSelectedItems((items) => toggleSelected(items, key))
      return
    }

    setSelectedItems([key])
  }

  function startItemDrag(kind, item, e) {
    const key = `${kind}:${item.id}`
    const selected = selectedItems.includes(key)
      ? selectedItems
      : [key]
    const movable = selected.filter(
      (itemKey) => itemKey.startsWith("file:") || itemKey.startsWith("folder:"),
    )

    if (!movable.length) return

    setSelectedItems(movable)
    e.dataTransfer.effectAllowed = "move"
    e.dataTransfer.setData(INTERNAL_DRAG_TYPE, JSON.stringify(movable))
  }

  function dropItemsIntoFolder(folderId, e) {
    if (!e.dataTransfer.types.includes(INTERNAL_DRAG_TYPE)) return

    e.preventDefault()
    e.stopPropagation()
    setDragging(false)
    setDragTargetFolder(null)

    try {
      const keys = JSON.parse(e.dataTransfer.getData(INTERNAL_DRAG_TYPE))
      moveItemsToFolder(keys, folderId)
    } catch {
      setMessage("Could not move those items")
    }
  }

  function moveItemsToFolder(keys, folderId) {
    if (!Array.isArray(keys) || !folderId) return

    const fileIds = keys
      .filter((key) => key.startsWith("file:"))
      .map((key) => key.slice("file:".length))
    const folderIds = keys
      .filter((key) => key.startsWith("folder:"))
      .map((key) => key.slice("folder:".length))
      .filter((id) => id !== folderId)

    if (!fileIds.length && !folderIds.length) return

    updateStore((current) => {
      const movableFolderIds = folderIds.filter(
        (id) => !isFolderInside(current.folders, folderId, id),
      )
      const targetFileNames = current.files
        .filter((file) => file.folderId === folderId && !fileIds.includes(file.id))
        .map((file) => file.name)
      const targetFolderNames = current.folders
        .filter((folder) => folder.parentId === folderId && !movableFolderIds.includes(folder.id))
        .map((folder) => folder.name)

      return {
        ...current,
        files: current.files.map((file) => {
          if (!fileIds.includes(file.id) || file.folderId === folderId) return file

          const name = getUniqueFileName(file.name, targetFileNames)
          targetFileNames.push(name)

          return {
            ...file,
            name,
            folderId,
            originalFolderId:
              folderId === RECYCLE_BIN_FOLDER_ID ? file.folderId : undefined,
            deletedAt: folderId === RECYCLE_BIN_FOLDER_ID ? Date.now() : undefined,
          }
        }),
        folders: current.folders.map((folder) => {
          if (!movableFolderIds.includes(folder.id) || folder.parentId === folderId) {
            return folder
          }

          const name = getUniqueFileName(folder.name, targetFolderNames)
          targetFolderNames.push(name)

          return {
            ...folder,
            name,
            parentId: folderId,
            originalParentId:
              folderId === RECYCLE_BIN_FOLDER_ID ? folder.parentId : undefined,
            deletedAt: folderId === RECYCLE_BIN_FOLDER_ID ? Date.now() : undefined,
          }
        }),
      }
    })
    setSelectedItems([])
    setContextMenu(null)
    setRenaming(null)
  }

  function allowFolderDrop(folderId, e) {
    if (!e.dataTransfer.types.includes(INTERNAL_DRAG_TYPE)) return

    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = "move"
    setDragTargetFolder(folderId)
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

  function deleteSelectedItems() {
    const fileIds = selectedItems
      .filter((key) => key.startsWith("file:"))
      .map((key) => key.slice("file:".length))
    const folderIds = selectedItems
      .filter((key) => key.startsWith("folder:"))
      .map((key) => key.slice("folder:".length))

    if (!fileIds.length && !folderIds.length) return

    updateStore((current) => ({
      ...current,
      files: current.files.map((file) =>
        fileIds.includes(file.id)
          ? {
              ...file,
              folderId: RECYCLE_BIN_FOLDER_ID,
              originalFolderId: file.folderId,
              deletedAt: Date.now(),
            }
          : file,
      ),
      folders: current.folders.map((folder) =>
        folderIds.includes(folder.id)
          ? {
              ...folder,
              parentId: RECYCLE_BIN_FOLDER_ID,
              originalParentId: folder.parentId,
              deletedAt: Date.now(),
            }
          : folder,
      ),
    }))
    setSelectedItems([])
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
    playSound(recycledSound, volume)
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
      onKeyDown={(e) => {
        if (e.key === "Delete") deleteSelectedItems()
      }}
      tabIndex={0}
    >
      <div className="file-tabs">
        {tabs.map((tab) => {
          const tabFolder = store.folders.find((item) => item.id === tab.currentFolder)

          return (
            <button
              key={tab.id}
              className={`file-tab ${tab.id === activeTab.id ? "file-tab-active" : ""}`}
              type="button"
              onClick={() => setActiveTabId(tab.id)}
            >
              <img src={fileIcon} alt="" />
              <span>{tabFolder?.name ?? "Desktop"}</span>
              <span
                className="app-tab-close"
                role="button"
                tabIndex={0}
                onClick={(event) => closeTab(tab.id, event)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") closeTab(tab.id, event)
                }}
              >
                x
              </span>
            </button>
          )
        })}
        <button className="file-tab-add" type="button" onClick={openNewTab}>
          +
        </button>
      </div>

      <div className="file-nav">
        <button type="button" onClick={goBack} disabled={!backHistory.length}>
          ←
        </button>
        <button type="button" onClick={goForward} disabled={!forwardHistory.length}>
          →
        </button>
        <button type="button" onClick={() => navigateTo(safeHomeFolderId)}>
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
            } ${
              dragTargetFolder === ROOT_FOLDER_ID ? "file-drop-target" : ""
            }`}
            type="button"
            onDragOver={(e) => allowFolderDrop(ROOT_FOLDER_ID, e)}
            onDragLeave={() => setDragTargetFolder(null)}
            onDrop={(e) => dropItemsIntoFolder(ROOT_FOLDER_ID, e)}
            onContextMenu={(e) =>
              openItemMenu(
                "folder",
                store.folders.find((item) => item.id === ROOT_FOLDER_ID),
                e,
              )
            }
            onClick={() => navigateTo(ROOT_FOLDER_ID)}
          >
            {store.folders.find((item) => item.id === ROOT_FOLDER_ID)?.name}
          </button>
          {store.folders
            .filter((item) => item.parentId === ROOT_FOLDER_ID)
            .filter((item) => item.id !== RECYCLE_BIN_FOLDER_ID)
            .map((item) => (
              <button
                key={item.id}
                className={`file-side-item file-side-child ${
                  item.id === currentFolder ? "file-side-active" : ""
                } ${
                  dragTargetFolder === item.id ? "file-drop-target" : ""
                }`}
                type="button"
                onDragOver={(e) => allowFolderDrop(item.id, e)}
                onDragLeave={() => setDragTargetFolder(null)}
                onDrop={(e) => dropItemsIntoFolder(item.id, e)}
                onContextMenu={(e) => openItemMenu("folder", item, e)}
                onClick={() => navigateTo(item.id)}
              >
                {item.name}
              </button>
            ))}
          <button
            className={`file-side-item file-side-bin ${
              isRecycleBin ? "file-side-active" : ""
            } ${
              dragTargetFolder === RECYCLE_BIN_FOLDER_ID ? "file-drop-target" : ""
            }`}
            type="button"
            onDragOver={(e) => allowFolderDrop(RECYCLE_BIN_FOLDER_ID, e)}
            onDragLeave={() => setDragTargetFolder(null)}
            onDrop={(e) => dropItemsIntoFolder(RECYCLE_BIN_FOLDER_ID, e)}
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
                  className={`file-item ${
                    selectedItems.includes(`folder:${item.id}`) ? "file-item-selected" : ""
                  } ${
                    dragTargetFolder === item.id ? "file-drop-target" : ""
                  }`}
                  type="button"
                  draggable
                  onDragStart={(e) => startItemDrag("folder", item, e)}
                  onDragOver={(e) => allowFolderDrop(item.id, e)}
                  onDragLeave={() => setDragTargetFolder(null)}
                  onDrop={(e) => dropItemsIntoFolder(item.id, e)}
                  onClick={(e) => selectItem(`folder:${item.id}`, e)}
                  onContextMenu={(e) => openItemMenu("folder", item, e)}
                  onDoubleClick={() => navigateTo(item.id)}
                >
                  <img className="file-thumb-folder" src={folderIcon} alt="" />
                  {renameInput("folder", item)}
                </button>
              ))}

            {visibleDesktopItems.map((app) => (
              <button
                key={app.type}
                className={`file-item ${
                  selectedItems.includes(`app:${app.type}`) ? "file-item-selected" : ""
                }`}
                type="button"
                onClick={(e) => selectItem(`app:${app.type}`, e)}
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
                className={`file-item ${
                  selectedItems.includes(`file:${file.id}`) ? "file-item-selected" : ""
                }`}
                type="button"
                draggable
                onDragStart={(e) => startItemDrag("file", file, e)}
                onClick={(e) => selectItem(`file:${file.id}`, e)}
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

function getUniqueFileName(name, existingNames) {
  if (!existingNames.includes(name)) return name

  const dotIndex = name.lastIndexOf(".")
  const hasExtension = dotIndex > 0
  const base = hasExtension ? name.slice(0, dotIndex) : name
  const extension = hasExtension ? name.slice(dotIndex) : ""
  let copyNumber = 1
  let nextName = `${base} (${copyNumber})${extension}`

  while (existingNames.includes(nextName)) {
    copyNumber += 1
    nextName = `${base} (${copyNumber})${extension}`
  }

  return nextName
}

function toggleSelected(items, item) {
  return items.includes(item)
    ? items.filter((current) => current !== item)
    : [...items, item]
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
    file.type.startsWith("image/") ||
    file.type.startsWith("text/") ||
    ALLOWED_FILE_TYPES.includes(file.type) ||
    ALLOWED_FILE_EXTENSIONS.test(file.name)
  )
}

function getDroppedUrls(dataTransfer) {
  const uriList = dataTransfer.getData("text/uri-list")
  const plainText = dataTransfer.getData("text/plain")

  return [...uriList.split(/\r?\n/), plainText]
    .map((value) => value.trim())
    .filter((value) => value && !value.startsWith("#"))
}

function isImageUrl(value) {
  try {
    const url = new URL(value)
    return (
      ["http:", "https:", "data:"].includes(url.protocol) &&
      (url.protocol === "data:" || /\.(png|jpe?g|gif|webp|bmp|svg|avif|ico)(\?|#|$)/i.test(url.pathname))
    )
  } catch {
    return false
  }
}

function makeUrlFile(url, folderId) {
  const name = getFileNameFromUrl(url)

  return {
    id: crypto.randomUUID(),
    name,
    type: getImageTypeFromName(name),
    size: 0,
    folderId,
    addedAt: Date.now(),
    text: "",
    dataUrl: url,
  }
}

function getFileNameFromUrl(value) {
  if (value.startsWith("data:")) return `Dropped image ${Date.now()}.png`

  try {
    const url = new URL(value)
    const name = decodeURIComponent(url.pathname.split("/").filter(Boolean).at(-1) ?? "")
    return ALLOWED_FILE_EXTENSIONS.test(name) ? name : `Dropped image ${Date.now()}.png`
  } catch {
    return `Dropped image ${Date.now()}.png`
  }
}

function getImageTypeFromName(name) {
  const extension = name.split(".").at(-1)?.toLowerCase()
  if (extension === "jpg") return "image/jpeg"
  if (extension === "svg") return "image/svg+xml"
  if (extension) return `image/${extension}`
  return "image/png"
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

function isFolderInside(folders, targetFolderId, sourceFolderId) {
  let folder = folders.find((item) => item.id === targetFolderId)

  while (folder) {
    if (folder.id === sourceFolderId) return true
    folder = folders.find((item) => item.id === folder.parentId)
  }

  return false
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

function loadStore(storageKey = STORAGE_KEY, rootFolderName = "User Folder") {
  const defaultFolders = getDefaultFolders(rootFolderName)

  try {
    const saved = JSON.parse(localStorage.getItem(storageKey))
    if (!saved) return { folders: defaultFolders, files: [] }

    const savedFolders = saved.folders ?? []
    const folders = savedFolders
      .filter((folder) => !REMOVED_DEFAULT_FOLDER_IDS.includes(folder.id))
      .map((folder) => ({
        ...folder,
        name: folder.id === ROOT_FOLDER_ID ? rootFolderName : folder.name,
        parentId:
          folder.parentId ?? (folder.id === ROOT_FOLDER_ID ? null : ROOT_FOLDER_ID),
      }))
    const missingDefaults = defaultFolders.filter(
      (folder) => !folders.some((savedFolder) => savedFolder.id === folder.id),
    )

    return {
      folders: [...missingDefaults, ...folders],
      files: (saved.files ?? []).filter(
        (file) => !REMOVED_DEFAULT_FOLDER_IDS.includes(file.folderId),
      ),
    }
  } catch {
    return { folders: defaultFolders, files: [] }
  }
}

function getDefaultFolders(rootFolderName) {
  return BASE_DEFAULT_FOLDERS.map((folder) =>
    folder.id === ROOT_FOLDER_ID ? { ...folder, name: rootFolderName } : folder,
  )
}

function readFile(file) {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.readAsDataURL(file)
  })
}

async function readStoredFileData(file) {
  if (canCompressImage(file)) {
    try {
      return await compressImageFile(file)
    } catch {
      return readFile(file)
    }
  }

  return readFile(file)
}

function canCompressImage(file) {
  return (
    file.type.startsWith("image/") &&
    !["image/gif", "image/svg+xml"].includes(file.type)
  )
}

function compressImageFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()

    image.onload = () => {
      const maxSize = 1920
      const scale = Math.min(1, maxSize / Math.max(image.width, image.height))
      const width = Math.max(1, Math.round(image.width * scale))
      const height = Math.max(1, Math.round(image.height * scale))
      const canvas = document.createElement("canvas")
      const context = canvas.getContext("2d")

      canvas.width = width
      canvas.height = height
      context.drawImage(image, 0, 0, width, height)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL("image/jpeg", 0.86))
    }

    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error("Could not read image"))
    }

    image.src = url
  })
}

function playSound(sound, volume = 1) {
  if (!sound) return

  const audio = new Audio(sound)
  audio.volume = Math.max(0, Math.min(1, volume))
  audio.play().catch(() => {})
}

export default File
