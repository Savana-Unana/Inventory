import { useEffect, useLayoutEffect, useRef, useState } from "react"
import "./style.css"
import File from "./File.jsx"
import Media from "./Media.jsx"
import Notepad from "./Notepad.jsx"
import Photos from "./Photos.jsx"
import Settings from "./Settings.jsx"

//icons
import noteIcon from "./assets/logos/Notepad.png"
import setIcon from "./assets/logos/Settings.png"
import fileIcon from "./assets/logos/FileExplorer.png"

const FILE_STORE_KEY = "inventory-file-explorer-v2"
const DESKTOP_STATE_KEY = "inventory-desktop-state-v1"
const ROOT_FOLDER_ID = "user"
const DESKTOP_FOLDER_ID = "desktop"
const RECYCLE_BIN_FOLDER_ID = "recycle-bin"
const REMOVED_DEFAULT_FOLDER_IDS = ["documents", "pictures", "videos"]
const DEFAULT_FILE_FOLDERS = [
  { id: ROOT_FOLDER_ID, name: "User Folder", parentId: null },
  { id: DESKTOP_FOLDER_ID, name: "Desktop", parentId: ROOT_FOLDER_ID },
  { id: "downloads", name: "Downloads", parentId: ROOT_FOLDER_ID },
  { id: RECYCLE_BIN_FOLDER_ID, name: "Recycling Bin", parentId: ROOT_FOLDER_ID },
]

const backgrounds = Object.values( // grabs all bg images
  import.meta.glob("./assets/backgrounds/*.{png,jpg,jpeg}", {
    eager: true,
    import: "default",
  }),
)
const logoAssets = import.meta.glob("./assets/logos/*.{png,jpg,jpeg}", {
  eager: true,
  import: "default",
})
const sfxAssets = import.meta.glob("./sfx/*.{mp3,wav,ogg}", {
  eager: true,
  import: "default",
})
const recycleBinIcon = logoAssets["./assets/logos/RecycleBin.png"] ?? fileIcon
const recycleBinEmptyIcon =
  logoAssets["./assets/logos/RecycleBinEmpty.png"] ?? recycleBinIcon
const alert = sfxAssets["./sfx/alert.mp3"]
const recycledSound = sfxAssets["./sfx/Recycled.mp3"]

//all my apps
const desktopApps = [
  {
    type: "notepad",
    title: "Notepad",
    logo: noteIcon,
  },
  {
    type: "settings",
    title: "Settings",
    logo: setIcon,
  },
  {
    type: "file-explorer",
    title: "File Explorer",
    logo: fileIcon,
  }
]

export default function App() {
  const [auth, setAuth] = useState({ status: "loading", account: null })

  useEffect(() => {
    let cancelled = false

    loadSession()
      .then((session) => {
        if (cancelled) return
        if (session?.account) {
          persistServerState(session)
          setAuth({ status: "signed-in", account: session.account })
        } else {
          setAuth({ status: "signed-out", account: null })
        }
      })
      .catch(() => {
        if (!cancelled) setAuth({ status: "signed-out", account: null })
      })

    return () => {
      cancelled = true
    }
  }, [])

  function startSession(session) {
    persistServerState(session)
    setAuth({ status: "signed-in", account: session.account })
  }

  async function endSession() {
    await logoutAccount()
    setAuth({ status: "signed-out", account: null })
  }

  if (auth.status === "loading") {
    return <main className="login-screen" />
  }

  if (!auth?.account) {
    return <LoginScreen onAuthenticated={startSession} />
  }

  return (
    <Desktop
      key={auth.account.id}
      account={auth.account}
      onSignOut={endSession}
    />
  )
}

function LoginScreen({ onAuthenticated }) {
  const [mode, setMode] = useState("login")
  const [displayName, setDisplayName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [message, setMessage] = useState("")
  const [busy, setBusy] = useState(false)

  async function submitAuth(e) {
    e.preventDefault()
    setMessage("")
    setBusy(true)

    try {
      const account =
        mode === "signup"
          ? await createAccount({ displayName, email, password })
          : await authenticateAccount({ email, password })

      onAuthenticated(account)
    } catch (error) {
      setMessage(error.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="login-screen">
      <div className="login-panel">
        <div className="login-avatar">{getInitials(displayName || email || "User")}</div>
        <form className="login-form" onSubmit={submitAuth}>
          {mode === "signup" && (
            <input
              value={displayName}
              autoComplete="name"
              placeholder="Name"
              onChange={(e) => setDisplayName(e.target.value)}
            />
          )}
          <input
            value={email}
            autoComplete="email"
            placeholder="Email"
            type="email"
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            value={password}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            placeholder="Password"
            type="password"
            onChange={(e) => setPassword(e.target.value)}
          />
          <button type="submit" disabled={busy}>
            {busy ? "Please wait" : mode === "signup" ? "Sign up" : "Sign in"}
          </button>
        </form>
        {message && <p className="login-message">{message}</p>}
        <button
          className="login-mode"
          type="button"
          onClick={() => {
            setMode((current) => (current === "login" ? "signup" : "login"))
            setMessage("")
          }}
        >
          {mode === "login" ? "Create account" : "Use existing account"}
        </button>
      </div>
    </main>
  )
}

//The Storer and Creator of Data
function Desktop({ account, onSignOut }) {
  const fileStoreKey = getAccountStorageKey(account.id, FILE_STORE_KEY)
  const fileStoreChangeEvent = `file-store-change:${account.id}`
  const savedDesktopState = loadDesktopState(account.id)
  const [windows, setWindows] = useState([]) //stores open windows
  const [lastFrames, setLastFrames] = useState(
    () => savedDesktopState.lastFrames ?? {},
  ) //stores last sizing
  const [fileStore, setFileStore] = useState(() => loadFileStore(fileStoreKey))
  const [saveDialog, setSaveDialog] = useState(null)
  const [desktopContextMenu, setDesktopContextMenu] = useState(null)
  const [pinnedApps, setPinnedApps] = useState(() => //stores pinned icons
    savedDesktopState.pinnedApps ?? desktopApps.map((app) => app.type),
  )
  const [taskbarOrder, setTaskbarOrder] = useState(() => //stores icon order
    savedDesktopState.taskbarOrder ?? desktopApps.map((app) => app.type),
  )
  const [taskbarPositions, setTaskbarPositions] = useState({}) //stores icon positions
  const [background] = useState(
    () => savedDesktopState.background ?? pickRandom(backgrounds),
  ) //selects one backgrounds
  const [desktopItems, setDesktopItems] = useState(() => //puts all apps seperately on desktop
    placeDesktopApps(
      getDesktopApps(loadFileStore(fileStoreKey)),
      savedDesktopState.desktopItems ?? [],
    ),
  )
  const [selectedIcons, setSelectedIcons] = useState([]) //store selected icons

  useEffect(() => {
    function reloadStore() {
      setFileStore(loadFileStore(fileStoreKey))
    }

    window.addEventListener(fileStoreChangeEvent, reloadStore)
    return () => window.removeEventListener(fileStoreChangeEvent, reloadStore)
  }, [fileStoreChangeEvent, fileStoreKey])

  useEffect(() => {
    saveDesktopState(account.id, {
      background,
      desktopItems,
      lastFrames,
      pinnedApps,
      taskbarOrder,
    })
  }, [account.id, background, desktopItems, lastFrames, pinnedApps, taskbarOrder])

  useEffect(() => {
    syncAccountState(account.id, {
      desktopState: {
        background, 
        desktopItems,
        lastFrames,
        pinnedApps,
        taskbarOrder,
      },
      fileStore,
    })
  }, [account.id, background, desktopItems, fileStore, lastFrames, pinnedApps, taskbarOrder])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDesktopItems((items) => {
      const nextApps = getDesktopApps(fileStore)
      return placeDesktopApps(nextApps, items)
    })
  }, [fileStore])

  function openWindow(app) {
    const windowType = app.windowType ?? app.type
    const frame = lastFrames[windowType] ?? getFirstWindowFrame()

    //Creates a new window with all the prior info given
    setWindows((wins) => [
      ...wins,
      {
        id: crypto.randomUUID(),
        type: windowType,
        title: app.title,
        ...frame,
        zIndex: Math.max(0, ...wins.map((win) => win.zIndex)) + 1,
        minimized: false,
        maximized: false,
        restoreFrame: null,
        data: { ...getStartingWindowData(app.type), ...(app.data ?? {}) },
      },
    ])
  }

  function openFile(file) {
    if (file.type.startsWith("image/")) {
      openWindow({
        type: "photos",
        title: file.name,
        data: { name: file.name, dataUrl: file.dataUrl },
      })
      return
    }

    if (file.type.startsWith("text/")) {
      openWindow({
        type: "notepad",
        title: file.name,
        data: { fileId: file.id, folderId: file.folderId, text: file.text ?? "" },
      })
      return
    }

    if (isMediaFile(file)) {
      openWindow({
        type: "media-player",
        title: file.name,
        data: { name: file.name, dataUrl: file.dataUrl, mediaType: file.type },
      })
    }
  }

  function closeWindow(id) {
    setWindows((wins) => {
      const closing = wins.find((win) => win.id === id)

      if (closing) { //animates the closing
        setLastFrames((frames) => ({
          ...frames,
          [closing.type]: getWindowFrame(closing),
        }))
      }

      return wins.filter((win) => win.id !== id)
    })
  }

  function updateWindowFrame(id, frame) {
    setWindows((wins) => {
      const changed = wins.find((win) => win.id === id)

      if (changed) {
        setLastFrames((frames) => ({
          ...frames,
          [changed.type]: frame,
        }))
      }

      return wins.map((win) => (win.id === id ? { ...win, ...frame } : win))
    })
  }

  function minimizeWindow(id) {
    setWindows((wins) =>
      wins.map((win) =>
        win.id === id ? { ...win, minimized: true } : win,
      ),
    )
  }

  function toggleMaximizeWindow(id) {
    setWindows((wins) =>
      wins.map((win) => {
        if (win.id !== id) return win

        if (win.maximized) {
          return {
            ...win,
            ...win.restoreFrame,
            maximized: false,
            restoreFrame: null,
          }
        }

        return {
          ...win,
          ...getMaximizedFrame(),
          maximized: true,
          minimized: false,
          restoreFrame: getWindowFrame(win),
        }
      }),
    )
    focusWindow(id)
  }

  function moveDesktopItems(types, colChange, rowChange) {
    setDesktopItems((items) =>
      canMoveItems(items, types, colChange, rowChange)
        ? items.map((item) => {
            if (!types.includes(item.type)) return item

            return {
              ...item,
              col: clamp(item.col + colChange, 1, 17),
              row: clamp(item.row + rowChange, 1, 7),
            }
          })
        : items,
    )
  }

  function placeDesktopItems(types, colChange, rowChange) {
    moveDesktopItems(types, colChange, rowChange)
  }

  function openDesktopMenu(app, e) {
    e.preventDefault()
    setSelectedIcons([app.type])
    setDesktopContextMenu({
      app,
      x: e.clientX,
      y: e.clientY,
    })
  }

  function emptyRecycleBin() {
    const store = loadFileStore(fileStoreKey)
    const recycleFolderIds = getRecycleFolderTreeIds(store.folders)
    const nextStore = {
      ...store,
      files: store.files.filter(
        (file) =>
          file.folderId !== RECYCLE_BIN_FOLDER_ID &&
          !recycleFolderIds.includes(file.folderId),
      ),
      folders: store.folders.filter(
        (folder) => !recycleFolderIds.includes(folder.id),
      ),
    }

    localStorage.setItem(fileStoreKey, JSON.stringify(nextStore))
    setFileStore(nextStore)
    window.dispatchEvent(new Event(fileStoreChangeEvent))
    playSound(recycledSound)
    setDesktopContextMenu(null)
  }

  function updateWindowData(id, data) {
    setWindows((wins) =>
      wins.map((win) =>
        win.id === id ? { ...win, data: { ...win.data, ...data } } : win,
      ),
    )
  }

  function saveNotepadWindow(id) {
    const win = windows.find((item) => item.id === id)
    if (!win) return

    setSaveDialog({
      windowId: id,
      name: win.title.endsWith(".txt") ? win.title.slice(0, -4) : win.title,
      folderId: win.data.folderId ?? DESKTOP_FOLDER_ID,
    })
  }

  function finishNotepadSave() {
    const win = windows.find((item) => item.id === saveDialog?.windowId)
    if (!win) return

    const savedFile = saveTextFile(
      win.data.fileId,
      saveDialog.name,
      win.data.text ?? "",
      saveDialog.folderId,
      fileStoreKey,
    )
    window.dispatchEvent(new Event(fileStoreChangeEvent))
    setFileStore(loadFileStore(fileStoreKey))

    setWindows((wins) =>
      wins.map((item) =>
        item.id === saveDialog.windowId
          ? {
          ...item,
          title: savedFile.name,
          data: {
            ...item.data,
            fileId: savedFile.id,
            folderId: savedFile.folderId,
            text: savedFile.text,
          },
        }
          : item,
      ),
    )
    setSaveDialog(null)
  }

  function pokeSaveDialog() {
    playSound(alert)
  }

  function focusWindow(id) {
    setWindows((wins) => {
      const highest = Math.max(0, ...wins.map((win) => win.zIndex))

      return wins.map((win) =>
        win.id === id
          ? { ...win, zIndex: highest + 1, minimized: false }
          : win,
      )
    })
  }

  function unpinTaskbarApp(type) {
    const hasOpenWindow = windows.some((win) => win.type === type)
    if (!hasOpenWindow) return

    setPinnedApps((apps) => apps.filter((appType) => appType !== type))
  }

  function moveTaskbarApp(type, targetType) {
    setTaskbarOrder((order) => {
      const withDragged = order.includes(type) ? order : [...order, type]
      const withoutDragged = withDragged.filter((appType) => appType !== type)
      const targetIndex = withoutDragged.indexOf(targetType)

      if (targetIndex === -1) return withDragged

      return [
        ...withoutDragged.slice(0, targetIndex),
        type,
        ...withoutDragged.slice(targetIndex),
      ]
    })
  }

  return (
    <div
      className="desktop"
      style={{ backgroundImage: `url(${background})` }}
      onClick={() => setDesktopContextMenu(null)}
    >
      <DesktopGrid
        apps={desktopItems}
        selectedIcons={selectedIcons}
        onSelect={setSelectedIcons}
        onPlaceSelected={placeDesktopItems}
        onOpen={openWindow}
        onOpenMenu={openDesktopMenu}
      />

      {/* windows.map turns each saved window object into an actual window on screen. */}
      {windows.map((win) => (
        !win.minimized && (
          <Window
            key={win.id}
            win={win}
            onClose={closeWindow}
            onFocus={focusWindow}
            onFrameChange={updateWindowFrame}
            onMinimize={minimizeWindow}
            onToggleMaximize={toggleMaximizeWindow}
            minimizeTarget={taskbarPositions[win.type]}
          >
            {win.type === "notepad" && (
              <Notepad
                text={win.data.text}
                onChange={(text) => updateWindowData(win.id, { text })}
                onSave={() => saveNotepadWindow(win.id)}
              />
            )}
            {win.type === "settings" && <Settings />}
            {win.type === "file-explorer" && (
              <File
                desktopItems={desktopItems}
                initialFolder={win.data.initialFolder}
                storageKey={fileStoreKey}
                storeChangeEvent={fileStoreChangeEvent}
                onOpenApp={openWindow}
                onOpenFile={openFile}
              />
            )}
            {win.type === "photos" && (
              <Photos name={win.data.name} dataUrl={win.data.dataUrl} />
            )}
            {win.type === "media-player" && (
              <Media
                name={win.data.name}
                dataUrl={win.data.dataUrl}
                mediaType={win.data.mediaType}
              />
            )}
          </Window>
        )
      ))}

      <Taskbar
        apps={desktopApps}
        windows={windows}
        pinnedApps={pinnedApps}
        taskbarOrder={taskbarOrder}
        onOpen={openWindow}
        onFocusWindow={focusWindow}
        onUnpin={unpinTaskbarApp}
        onReorder={moveTaskbarApp}
        onPositionsChange={setTaskbarPositions}
        account={account}
        onSignOut={onSignOut}
      />

      {saveDialog && (
        <SaveDialog
          folders={fileStore.folders}
          name={saveDialog.name}
          folderId={saveDialog.folderId}
          onNameChange={(name) =>
            setSaveDialog((dialog) => ({ ...dialog, name }))
          }
          onFolderChange={(folderId) =>
            setSaveDialog((dialog) => ({ ...dialog, folderId }))
          }
          onSave={finishNotepadSave}
          onIgnore={pokeSaveDialog}
        />
      )}

      {desktopContextMenu && (
        <div
          className="file-context-menu desktop-context-menu"
          style={{ left: desktopContextMenu.x, top: desktopContextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {desktopContextMenu.app.type === "recycle-bin" ? (
            <button
              type="button"
              disabled={!isRecycleBinFull(fileStore)}
              onClick={emptyRecycleBin}
            >
              Empty
            </button>
          ) : (
            <>
              <button type="button" disabled>
                Rename
              </button>
              <button type="button" disabled>
                Delete
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function DesktopGrid({
  apps,
  selectedIcons,
  onSelect,
  onPlaceSelected,
  onOpen,
  onOpenMenu,
}) {
  const [selectBox, setSelectBox] = useState(null)
  const [dragMove, setDragMove] = useState(null)

  function startDesktopSelection(e) {
    if (e.target !== e.currentTarget) return

    const grid = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - grid.left
    const y = e.clientY - grid.top

    onSelect([])
    setSelectBox({ startX: x, startY: y, x, y })
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function moveDesktopSelection(e) {
    if (!selectBox) return

    const grid = e.currentTarget.getBoundingClientRect()
    setSelectBox((box) => ({
      ...box,
      x: e.clientX - grid.left,
      y: e.clientY - grid.top,
    }))
  }

  function finishDesktopSelection(e) {
    if (!selectBox) return

    const grid = e.currentTarget
    const box = makeBox(selectBox)
    const selected = apps
      .filter((app) => {
        const icon = grid.querySelector(`[data-app-type="${app.type}"]`)
        if (!icon) return false

        const iconRect = icon.getBoundingClientRect()
        const gridRect = grid.getBoundingClientRect()
        const iconBox = {
          left: iconRect.left - gridRect.left,
          right: iconRect.right - gridRect.left,
          top: iconRect.top - gridRect.top,
          bottom: iconRect.bottom - gridRect.top,
        }

        return boxesTouch(box, iconBox)
      })
      .map((app) => app.type)

    onSelect(selected)
    setSelectBox(null)
  }

  function startIconDrag(app, e) {
    const selected = selectedIcons.includes(app.type)
      ? selectedIcons
      : [app.type]

    onSelect(selected)
    setDragMove({
      types: selected,
      startX: e.clientX,
      startY: e.clientY,
      dx: 0,
      dy: 0,
    })
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function moveIconDrag(e) {
    if (!dragMove) return

    setDragMove({
      ...dragMove,
      dx: e.clientX - dragMove.startX,
      dy: e.clientY - dragMove.startY,
    })
  }

  function finishIconDrag(e) {
    if (!dragMove) return

    const grid = e.currentTarget.closest(".desktop-grid").getBoundingClientRect()
    const colWidth = grid.width / 17
    const rowHeight = grid.height / 7
    const colChange = Math.round(dragMove.dx / colWidth)
    const rowChange = Math.round(dragMove.dy / rowHeight)

    if (colChange !== 0 || rowChange !== 0) {
      onPlaceSelected(dragMove.types, colChange, rowChange)
    }

    setDragMove(null)
  }

  return (
    <div
      className="desktop-grid"
      onPointerDown={startDesktopSelection}
      onPointerMove={moveDesktopSelection}
      onPointerUp={finishDesktopSelection}
    >
      {/* Each app object becomes one desktop icon, in array order. */}
      {apps.map((app) => (
        <div
          key={app.type}
          data-app-type={app.type}
          className={`desktop-icon ${
            selectedIcons.includes(app.type) ? "desktop-icon-selected" : ""
          }`}
          style={{ gridColumn: app.col, gridRow: app.row }}
          onPointerDown={(e) => startIconDrag(app, e)}
          onPointerMove={moveIconDrag}
          onPointerUp={finishIconDrag}
          onContextMenu={(e) => onOpenMenu(app, e)}
          onDoubleClick={() => onOpen(app)}
        >
          <button
            className="app-icon-button"
            type="button"
          >
            <img
              src={app.logo}
              alt=""
              draggable="false"
              onDragStart={(e) => e.preventDefault()}
            />
          </button>

          <span className="desktop-name">{app.title}</span>
        </div>
      ))}

      {dragMove &&
        apps
          .filter((app) => dragMove.types.includes(app.type))
          .map((app) => (
            <div
              key={app.type}
              className="desktop-icon desktop-icon-clone"
              style={{
                gridColumn: app.col,
                gridRow: app.row,
                transform: `translate(${dragMove.dx}px, ${dragMove.dy}px)`,
              }}
            >
              <span className="app-icon-button">
                <img src={app.logo} alt="" draggable="false" />
              </span>
            </div>
          ))}

      {selectBox && <div className="selection-box" style={selectionStyle(selectBox)} />}
    </div>
  )
}

function Taskbar({
  account,
  apps,
  windows,
  pinnedApps,
  taskbarOrder,
  onOpen,
  onFocusWindow,
  onUnpin,
  onReorder,
  onPositionsChange,
  onSignOut,
}) {
  const iconRefs = useRef({})
  const [draggedType, setDraggedType] = useState(null)

  const openTypes = [...new Set(windows.map((win) => win.type))]
  const visibleTypes = [
    ...taskbarOrder.filter(
      (type) => pinnedApps.includes(type) || openTypes.includes(type),
    ),
    ...openTypes.filter((type) => !taskbarOrder.includes(type)),
  ]
  const visibleApps = visibleTypes
    .map(
      (type) =>
        apps.find((app) => app.type === type) ??
        makeTaskbarAppFromWindow(windows.find((win) => win.type === type)),
    )
    .filter(Boolean)
  const visibleTypesKey = visibleTypes.join("|")

  useLayoutEffect(() => {
    const nextPositions = {}

    for (const [type, button] of Object.entries(iconRefs.current)) {
      if (!button) continue

      const rect = button.getBoundingClientRect()
      nextPositions[type] = {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      }
    }

    onPositionsChange(nextPositions)
  }, [visibleTypesKey, windows.length, onPositionsChange])

  function clickTaskbarApp(app, openWindows) {
    if (openWindows.length === 0) {
      onOpen(app)
      return
    }

    const topWindow = openWindows.reduce((highest, win) =>
      win.zIndex > highest.zIndex ? win : highest,
    )

    // focusWindow also restores a minimized window.
    onFocusWindow(topWindow.id)
  }

  function startTaskbarDrag(type, e) {
    setDraggedType(type)
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function moveTaskbarDrag(targetType) {
    if (!draggedType || draggedType === targetType) return
    onReorder(draggedType, targetType)
  }

  function finishTaskbarDrag() {
    setDraggedType(null)
  }

  return (
    <footer className="taskbar">
      <div className="taskbar-search">Search</div>

      <div className="taskbar-apps">
        {visibleApps.map((app) => {
          const openWindows = windows.filter((win) => win.type === app.type)
          const isOpen = openWindows.length > 0

          return (
            <div
              key={app.type}
              className="taskbar-app-wrap"
              onPointerEnter={() => moveTaskbarDrag(app.type)}
            >
              <button
                ref={(node) => {
                  iconRefs.current[app.type] = node
                }}
                className={`taskbar-app ${isOpen ? "taskbar-app-open" : ""}`}
                type="button"
                onPointerDown={(e) => startTaskbarDrag(app.type, e)}
                onPointerUp={finishTaskbarDrag}
                onContextMenu={(e) => {
                  e.preventDefault()
                  onUnpin(app.type)
                }}
                onClick={() => clickTaskbarApp(app, openWindows)}
              >
                <img src={app.logo} alt="" />
              </button>

              {openWindows.length > 1 && (
                <div className="taskbar-previews">
                  {openWindows.map((win, index) => (
                    <button
                      key={win.id}
                      className="taskbar-preview"
                      type="button"
                      onClick={() => onFocusWindow(win.id)}
                    >
                      <div className="preview-title">
                        <img src={app.logo} alt="" />
                        <span>
                          {win.title} {index + 1}
                        </span>
                      </div>
                      <WindowPreview win={win} />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="taskbar-spacer"></div>

      <button className="taskbar-user" type="button" onClick={onSignOut}>
        <span className="taskbar-avatar">{getInitials(account.displayName)}</span>
        <span>{account.displayName}</span>
      </button>

      <TaskbarClock />
    </footer>
  )
}

function WindowPreview({ win }) {
  return (
    <div className="preview-screen">
      <div className="preview-window-bar">{win.title}</div>
      <div className="preview-window-body">
        {win.type === "notepad" && (
          <p className="preview-notes">{win.data.text || "Notepad"}</p>
        )}
        {win.type === "settings" && (
          <div className="preview-settings"></div>
        )}
      </div>
    </div>
  )
}

function SaveDialog({
  folders,
  name,
  folderId,
  onNameChange,
  onFolderChange,
  onSave,
  onIgnore,
}) {
  const saveFolders = folders.filter(
    (folder) => folder.id !== RECYCLE_BIN_FOLDER_ID,
  )

  function submitSave(e) {
    e.preventDefault()
    if (!name.trim()) return
    onSave()
  }

  return (
    <div className="save-overlay" onPointerDown={onIgnore}>
      <form
        className="save-dialog"
        onSubmit={submitSave}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <h2>Save note</h2>
        <label>
          Name
          <input
            value={name}
            autoFocus
            onChange={(e) => onNameChange(e.target.value)}
          />
        </label>
        <label>
          Place
          <select
            value={folderId}
            onChange={(e) => onFolderChange(e.target.value)}
          >
            {saveFolders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folderPath(folders, folder.id)}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">Save</button>
      </form>
    </div>
  )
}

function TaskbarClock() {
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="taskbar-clock">
      <span>
        {now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
      </span>
      <span>{now.toLocaleDateString()}</span>
    </div>
  )
}

//window rendering
function Window({
  win,
  children,
  onClose,
  onFocus,
  onFrameChange,
  onMinimize,
  onToggleMaximize,
  minimizeTarget,
}) {
  // action remembers whether the mouse is currently dragging or resizing.
  const [action, setAction] = useState(null)
  const [visualState, setVisualState] = useState("open")

  function startDrag(e) {
    if (win.maximized) return

    onFocus(win.id)
    setAction({
      type: "drag",
      mouseX: e.clientX,
      mouseY: e.clientY,
      startFrame: getWindowFrame(win),
    })
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function moveDrag(e) {
    if (!action) return

    const dx = e.clientX - action.mouseX
    const dy = e.clientY - action.mouseY

    if (action.type === "drag") {
      onFrameChange(win.id, {
        ...action.startFrame,
        x: action.startFrame.x + dx,
        y: Math.max(0, action.startFrame.y + dy),
      })
      return
    }

    resizeWindow(action.edge, action.startFrame, dx, dy)
  }

  function startResize(edge, e) {
    if (win.maximized) return

    onFocus(win.id)
    setAction({
      type: "resize",
      edge,
      mouseX: e.clientX,
      mouseY: e.clientY,
      startFrame: getWindowFrame(win),
    })
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function resizeWindow(edge, startFrame, dx, dy) {
    const minWidth = 180
    const minHeight = 120
    let next = { ...startFrame }

    if (edge.includes("right")) {
      next.width = Math.max(minWidth, startFrame.width + dx)
    }

    if (edge.includes("down")) {
      next.height = Math.max(minHeight, startFrame.height + dy)
    }

    if (edge.includes("left")) {
      next.width = Math.max(minWidth, startFrame.width - dx)
      next.x = startFrame.x + startFrame.width - next.width
    }

    if (edge.includes("up")) {
      next.height = Math.max(minHeight, startFrame.height - dy)
      next.y = Math.max(0, startFrame.y + startFrame.height - next.height)
    }

    onFrameChange(win.id, next)
  }

  function stopAction() {
    setAction(null)
  }

  function animateMinimize() {
    setVisualState("minimizing")
    setTimeout(() => onMinimize(win.id), 180)
  }

  function animateClose() {
    setVisualState("closing")
    setTimeout(() => onClose(win.id), 150)
  }

  const target = minimizeTarget ?? {
    x: window.innerWidth / 2,
    y: window.innerHeight - 28,
  }

  return (
    <section
      className={`window app-window-${win.type} window-${visualState}`}
      style={{
        left: win.x,
        top: win.y,
        width: win.width,
        height: win.height,
        zIndex: win.zIndex,
        "--minimize-x": `${target.x - (win.x + win.width / 2)}px`,
        "--minimize-y": `${target.y - (win.y + win.height / 2)}px`,
      }}
      onPointerDown={() => onFocus(win.id)}
    >
      <header
        className="titlebar"
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={stopAction}
      >
        <span>{win.title}</span>
        <div className="window-controls">
          <button
            className="window-control-button"
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={animateMinimize}
          >
            -
          </button>
          <button
            className="window-control-button"
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onToggleMaximize(win.id)}
          >
            □
          </button>
          <button
            className="window-control-button close-button"
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={animateClose}
          >
            x
          </button>
        </div>
      </header>

      <main className={`window-body window-body-${win.type}`}>
        {children}
      </main>

      {!win.maximized &&
        [
          "up",
          "right",
          "down",
          "left",
          "upright",
          "downright",
          "downleft",
          "upleft",
        ].map((edge) => (
          <div
            key={edge}
            className={`resize-handle resize-${edge}`}
            onPointerDown={(e) => startResize(edge, e)}
            onPointerMove={moveDrag}
            onPointerUp={stopAction}
          />
        ))}
    </section>
  )
}

function getStartingWindowData(type) {
  if (type === "notepad") return { text: "" }
  return {}
}

function saveTextFile(fileId, title, text, folderId, storageKey = FILE_STORE_KEY) {
  const store = loadFileStore(storageKey)
  const name = title.endsWith(".txt") ? title : `${title}.txt`
  const existing = store.files.find((file) => file.id === fileId)
  const savedFile = {
    id: existing?.id ?? crypto.randomUUID(),
    name,
    type: "text/plain",
    size: new Blob([text]).size,
    folderId,
    addedAt: existing?.addedAt ?? Date.now(),
    text,
    dataUrl: `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`,
  }

  const files = existing
    ? store.files.map((file) => (file.id === savedFile.id ? savedFile : file))
    : [savedFile, ...store.files]

  localStorage.setItem(storageKey, JSON.stringify({ ...store, files }))
  return savedFile
}

function loadFileStore(storageKey = FILE_STORE_KEY) {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey))
    if (!saved) return { folders: DEFAULT_FILE_FOLDERS, files: [] }

    const savedFolders = saved.folders ?? []
    const folders = savedFolders
      .filter((folder) => !REMOVED_DEFAULT_FOLDER_IDS.includes(folder.id))
      .map((folder) => ({
        ...folder,
        parentId:
          folder.parentId ?? (folder.id === ROOT_FOLDER_ID ? null : ROOT_FOLDER_ID),
      }))
    const missingDefaults = DEFAULT_FILE_FOLDERS.filter(
      (folder) => !folders.some((savedFolder) => savedFolder.id === folder.id),
    )

    return {
      folders: [...missingDefaults, ...folders],
      files: (saved.files ?? []).filter(
        (file) => !REMOVED_DEFAULT_FOLDER_IDS.includes(file.folderId),
      ),
    }
  } catch {
    return { folders: DEFAULT_FILE_FOLDERS, files: [] }
  }
}

function getDesktopApps(store) {
  const binHasFiles = isRecycleBinFull(store)

  return [
    {
      type: "recycle-bin",
      windowType: "file-explorer",
      title: "Recycle Bin",
      logo: binHasFiles ? recycleBinIcon : recycleBinEmptyIcon,
      data: { initialFolder: RECYCLE_BIN_FOLDER_ID },
    },
    ...desktopApps,
  ]
}

function isRecycleBinFull(store) {
  return (
    store.files.some((file) => file.folderId === RECYCLE_BIN_FOLDER_ID) ||
    store.folders.some((folder) => folder.parentId === RECYCLE_BIN_FOLDER_ID)
  )
}

function placeDesktopApps(apps, oldItems) {
  const usedTiles = new Set()

  return apps.map((app, index) => {
    const oldItem = oldItems.find((item) => item.type === app.type)
    let col = app.type === "recycle-bin" ? 1 : oldItem?.col ?? index + 1
    let row = app.type === "recycle-bin" ? 1 : oldItem?.row ?? 1
    let tileKey = `${col}-${row}`

    if (usedTiles.has(tileKey)) {
      const nextTile = findOpenDesktopTile(usedTiles)
      col = nextTile.col
      row = nextTile.row
      tileKey = `${col}-${row}`
    }

    usedTiles.add(tileKey)

    return {
      ...app,
      col,
      row,
    }
  })
}

function findOpenDesktopTile(usedTiles) {
  for (let row = 1; row <= 7; row += 1) {
    for (let col = 1; col <= 17; col += 1) {
      if (!usedTiles.has(`${col}-${row}`)) return { col, row }
    }
  }

  return { col: 1, row: 1 }
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

function folderPath(folders, currentFolder) {
  const names = []
  let folder = folders.find((item) => item.id === currentFolder)

  while (folder) {
    names.unshift(folder.name)
    folder = folders.find((item) => item.id === folder.parentId)
  }

  return names.join(" › ")
}

function makeTaskbarAppFromWindow(win) {
  if (!win) return null

  return {
    type: win.type,
    title: win.title,
    logo: fileIcon,
  }
}

function getFirstWindowFrame() {
  return {
    x: Math.round(window.innerWidth * 0.04),
    y: Math.round(window.innerHeight * 0.04),
    width: Math.round(window.innerWidth * 0.92),
    height: Math.round(window.innerHeight * 0.84),
  }
}

function getMaximizedFrame() {
  return {
    x: 0,
    y: 0,
    width: window.innerWidth,
    height: window.innerHeight - 48,
  }
}

function getWindowFrame(win) {
  return {
    x: win.x,
    y: win.y,
    width: win.width,
    height: win.height,
  }
}

function pickRandom(items) {
  return items[Math.floor(Math.random() * items.length)]
}

function playSound(sound) {
  if (!sound) return

  const audio = new Audio(sound)
  audio.play().catch(() => {})
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function makeBox(box) {
  return {
    left: Math.min(box.startX, box.x),
    right: Math.max(box.startX, box.x),
    top: Math.min(box.startY, box.y),
    bottom: Math.max(box.startY, box.y),
  }
}

function boxesTouch(a, b) {
  return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top
}

function isMediaFile(file) {
  return (
    file.type.startsWith("video/") ||
    file.type.startsWith("audio/") ||
    /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(file.name)
  )
}

function selectionStyle(box) {
  const next = makeBox(box)

  return {
    left: next.left,
    top: next.top,
    width: next.right - next.left,
    height: next.bottom - next.top,
  }
}

async function loadSession() {
  const response = await fetch("/api/session")
  if (response.status === 401) return null
  return parseApiResponse(response)
}

async function createAccount(credentials) {
  return postJson("/api/signup", credentials)
}

async function authenticateAccount(credentials) {
  return postJson("/api/login", credentials)
}

async function logoutAccount() {
  await fetch("/api/logout", { method: "POST" })
}

async function syncAccountState(accountId, state) {
  try {
    await fetch("/api/state", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state),
    })
  } catch {
    savePendingSync(accountId, state)
  }
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

  return parseApiResponse(response)
}

async function parseApiResponse(response) {
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.message ?? "Something went wrong.")
  return data
}

function persistServerState(session) {
  if (!session?.account) return

  if (session.desktopState) {
    saveDesktopState(session.account.id, session.desktopState)
  }

  if (session.fileStore) {
    localStorage.setItem(
      getAccountStorageKey(session.account.id, FILE_STORE_KEY),
      JSON.stringify(session.fileStore),
    )
  }
}

function savePendingSync(accountId, state) {
  localStorage.setItem(
    getAccountStorageKey(accountId, "pending-sync"),
    JSON.stringify({ ...state, updatedAt: Date.now() }),
  )
}

function getAccountStorageKey(accountId, key) {
  return `inventory-account:${accountId}:${key}`
}

function loadDesktopState(accountId) {
  try {
    return (
      JSON.parse(localStorage.getItem(getAccountStorageKey(accountId, DESKTOP_STATE_KEY))) ??
      {}
    )
  } catch {
    return {}
  }
}

function saveDesktopState(accountId, state) {
  localStorage.setItem(
    getAccountStorageKey(accountId, DESKTOP_STATE_KEY),
    JSON.stringify(state),
  )
}

function getInitials(name) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "U"
}

function canMoveItems(items, types, colChange, rowChange) {
  const movingItems = items.filter((item) => types.includes(item.type))
  const stillItems = items.filter((item) => !types.includes(item.type))
  const targetTiles = []

  for (const item of movingItems) {
    const target = {
      col: clamp(item.col + colChange, 1, 17),
      row: clamp(item.row + rowChange, 1, 7),
    }

    if (stillItems.some((other) => other.col === target.col && other.row === target.row)) {
      return false
    }

    const tileKey = `${target.col}-${target.row}`
    if (targetTiles.includes(tileKey)) return false

    targetTiles.push(tileKey)
  }

  return true
}
