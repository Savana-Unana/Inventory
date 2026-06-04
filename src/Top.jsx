import { useEffect, useLayoutEffect, useRef, useState } from "react"
import "./style.css"
import ArtIt from "./ArtIt.jsx"
import Chrome from "./Chrome.jsx"
import ElementFight from "./ElementFight.jsx"
import File from "./File.jsx"
import Join from "./Join.jsx"
import Media from "./Media.jsx"
import Notepad from "./Notepad.jsx"
import Photos from "./Photos.jsx"
import Settings from "./Settings.jsx"

//icons
import noteIcon from "./assets/logos/Notepad.png"
import setIcon from "./assets/logos/Settings.png"
import fileIcon from "./assets/logos/FileExplorer.png"
import chromeIcon from "./assets/logos/GoogleChrome.png"
import folderIcon from "./assets/logos/Folder.png"
import mediaIcon from "./assets/logos/MediaPlayer.png"
import photosIcon from "./assets/logos/Photos.png"
import artItIcon from "./assets/logos/ArtIt.png"
import elementIcon from "./assets/logos/Element.png"

const FILE_STORE_KEY = "inventory-file-explorer-v2"
const DESKTOP_STATE_KEY = "inventory-desktop-state-v1"
const ROOT_FOLDER_ID = "user"
const DESKTOP_FOLDER_ID = "desktop"
const RECYCLE_BIN_FOLDER_ID = "recycle-bin"
const REMOVED_DEFAULT_FOLDER_IDS = ["documents", "pictures", "videos"]
const BASE_DEFAULT_FILE_FOLDERS = [
  { id: ROOT_FOLDER_ID, name: "User Folder", parentId: null },
  { id: DESKTOP_FOLDER_ID, name: "Desktop", parentId: ROOT_FOLDER_ID },
  { id: "downloads", name: "Downloads", parentId: ROOT_FOLDER_ID },
  { id: RECYCLE_BIN_FOLDER_ID, name: "Recycling Bin", parentId: ROOT_FOLDER_ID },
]

const backgroundAssets = import.meta.glob("./assets/backgrounds/*.{png,jpg,jpeg}", {
  eager: true,
  import: "default",
})
const backgrounds = Object.entries(backgroundAssets).map(([path, url]) => ({
  id: path,
  name: cleanAssetName(path),
  url,
}))
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
  },
  {
    type: "google-chrome",
    title: "Google Chrome",
    logo: chromeIcon,
  },
  {
    type: "drawing",
    title: "Art It!",
    logo: artItIcon,
  },
  {
    type: "element-fight",
    title: "Element Fight",
    logo: elementIcon,
  },
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
    return (
      <Join
        onAuthenticated={startSession}
        onLogin={authenticateAccount}
        onSignup={createAccount}
      />
    )
  }

  return (
    <Desktop
      key={auth.account.id}
      account={auth.account}
      onSignOut={endSession}
    />
  )
}

//The Storer and Creator of Data
function Desktop({ account, onSignOut }) {
  const fileStoreKey = getAccountStorageKey(account.id, FILE_STORE_KEY)
  const fileStoreChangeEvent = `file-store-change:${account.id}`
  const rootFolderName = account.displayName || "User Folder"
  const savedDesktopState = loadDesktopState(account.id)
  const [windows, setWindows] = useState([]) //stores open windows
  const [lastFrames, setLastFrames] = useState(
    () => savedDesktopState.lastFrames ?? {},
  ) //stores last sizing
  const [fileStore, setFileStore] = useState(() =>
    loadFileStore(fileStoreKey, rootFolderName),
  )
  const [saveDialog, setSaveDialog] = useState(null)
  const [openDialog, setOpenDialog] = useState(null)
  const [desktopContextMenu, setDesktopContextMenu] = useState(null)
  const [closeRequests, setCloseRequests] = useState({})
  const [pinnedApps, setPinnedApps] = useState(() => //stores pinned icons
    savedDesktopState.pinnedApps ?? desktopApps.map((app) => app.type),
  )
  const [taskbarOrder, setTaskbarOrder] = useState(() => //stores icon order
    savedDesktopState.taskbarOrder ?? desktopApps.map((app) => app.type),
  )
  const [taskbarPositions, setTaskbarPositions] = useState({}) //stores icon positions
  const [volume, setVolume] = useState(() =>
    clamp(savedDesktopState.volume ?? 1, 0, 1),
  )
  const [homeFolderId, setHomeFolderId] = useState(
    () => savedDesktopState.homeFolderId ?? DESKTOP_FOLDER_ID,
  )
  const [background, setBackground] = useState(
    () => savedDesktopState.background ?? pickRandom(backgrounds).url,
  ) //selects one backgrounds
  const [desktopItems, setDesktopItems] = useState(() => //puts all apps seperately on desktop
    placeDesktopApps(
      getDesktopItems(loadFileStore(fileStoreKey, rootFolderName)),
      savedDesktopState.desktopItems ?? [],
    ),
  )
  const [selectedIcons, setSelectedIcons] = useState([]) //store selected icons
  const lastSessionTouch = useRef(0)

  useEffect(() => {
    function reloadStore() {
      setFileStore(loadFileStore(fileStoreKey, rootFolderName))
    }

    window.addEventListener(fileStoreChangeEvent, reloadStore)
    return () => window.removeEventListener(fileStoreChangeEvent, reloadStore)
  }, [fileStoreChangeEvent, fileStoreKey, rootFolderName])

  useEffect(() => {
    saveDesktopState(account.id, {
      background,
      desktopItems,
      lastFrames,
      pinnedApps,
      taskbarOrder,
      volume,
      homeFolderId,
    })
  }, [account.id, background, desktopItems, homeFolderId, lastFrames, pinnedApps, taskbarOrder, volume])

  useEffect(() => {
    syncAccountState(account.id, {
      desktopState: {
        background, 
        desktopItems,
        lastFrames,
        pinnedApps,
        taskbarOrder,
        volume,
        homeFolderId,
      },
      fileStore,
    })
  }, [account.id, background, desktopItems, fileStore, homeFolderId, lastFrames, pinnedApps, taskbarOrder, volume])

  useEffect(() => {
    function resizeMaximizedWindows() {
      const maximizedFrame = getMaximizedFrame()

      setWindows((wins) =>
        wins.map((win) =>
          win.maximized
            ? {
                ...win,
                ...maximizedFrame,
              }
            : win,
        ),
      )
    }

    window.addEventListener("resize", resizeMaximizedWindows)
    window.visualViewport?.addEventListener("resize", resizeMaximizedWindows)

    return () => {
      window.removeEventListener("resize", resizeMaximizedWindows)
      window.visualViewport?.removeEventListener("resize", resizeMaximizedWindows)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDesktopItems((items) => {
      const nextApps = getDesktopItems(fileStore)
      return placeDesktopApps(nextApps, items)
    })
  }, [fileStore])

  useEffect(() => {
    function touchSession() {
      const now = Date.now()
      if (now - lastSessionTouch.current < 60 * 1000) return

      lastSessionTouch.current = now
      refreshAccountSession()
    }

    window.addEventListener("pointerdown", touchSession)
    window.addEventListener("keydown", touchSession)

    return () => {
      window.removeEventListener("pointerdown", touchSession)
      window.removeEventListener("keydown", touchSession)
    }
  }, [])

  function openWindow(app) {
    const windowType = app.windowType ?? app.type
    const frame = lastFrames[windowType] ?? getFirstWindowFrame()
    const maximizedFrame = getMaximizedFrame()

    //Creates a new window with all the prior info given
    setWindows((wins) => [
      ...wins,
      {
        id: crypto.randomUUID(),
        type: windowType,
        title: app.title,
        ...maximizedFrame,
        zIndex: Math.max(0, ...wins.map((win) => win.zIndex)) + 1,
        minimized: false,
        maximized: true,
        restoreFrame: frame,
        data: { ...getStartingWindowData(app.type), ...(app.data ?? {}) },
      },
    ])
  }

  function openDesktopItem(item) {
    if (item.desktopKind === "file") {
      const file = fileStore.files.find((entry) => entry.id === item.fileId)
      if (file) openFile(file)
      return
    }

    openWindow(item)
  }

  async function dropDesktopFiles(e) {
    e.preventDefault()
    const files = [...e.dataTransfer.files]
    const droppedImages = getDroppedUrls(e.dataTransfer)
      .filter(isImageUrl)
      .map((url) => makeUrlFile(url, DESKTOP_FOLDER_ID))

    if (!files.length && !droppedImages.length) return

    const existingNames = fileStore.files
      .filter((file) => file.folderId === DESKTOP_FOLDER_ID)
      .map((file) => file.name)

    const nextFiles = await Promise.all(
      files.map(async (file) => {
        const name = getUniqueFileName(file.name, existingNames)
        existingNames.push(name)

        return {
          id: crypto.randomUUID(),
          name,
          type: file.type || "application/octet-stream",
          size: file.size,
          folderId: DESKTOP_FOLDER_ID,
          addedAt: Date.now(),
          text: file.type.startsWith("text/") ? await file.text() : "",
          dataUrl: await readStoredFileData(file),
        }
      }),
    )
    const uniqueDroppedImages = droppedImages.map((file) => {
      const name = getUniqueFileName(file.name, existingNames)
      existingNames.push(name)
      return { ...file, name }
    })

    const nextStore = {
      ...fileStore,
      files: [...nextFiles, ...uniqueDroppedImages, ...fileStore.files],
    }

    try {
      localStorage.setItem(fileStoreKey, JSON.stringify(nextStore))
    } catch {
      playSound(alert, volume)
      return
    }

    setFileStore(nextStore)
    window.dispatchEvent(new Event(fileStoreChangeEvent))
  }

  function openFile(file) {
    if (file.type.startsWith("image/")) {
      if (focusOpenFileWindow(file, "photos")) return

      openWindow({
        type: "photos",
        title: file.name,
        data: { fileId: file.id, name: file.name, dataUrl: file.dataUrl },
      })
      return
    }

    if (file.type.startsWith("text/")) {
      if (focusOpenFileWindow(file, "notepad")) return

      openWindow({
        type: "notepad",
        title: file.name,
        data: { fileId: file.id, folderId: file.folderId, text: file.text ?? "" },
      })
      return
    }

    if (isMediaFile(file)) {
      if (focusOpenFileWindow(file, "media-player")) return

      openWindow({
        type: "media-player",
        title: file.name,
        data: {
          fileId: file.id,
          name: file.name,
          dataUrl: file.dataUrl,
          mediaType: file.type,
        },
      })
    }
  }

  function focusOpenFileWindow(file, type) {
    const existing = windows.find((win) =>
      win.type === type &&
      (win.data.fileId === file.id ||
        (!win.data.fileId && win.title === file.name && win.data.dataUrl === file.dataUrl)),
    )

    if (!existing) return false

    focusWindow(existing.id)
    return true
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

  function requestAnimatedClose(id) {
    setCloseRequests((requests) => ({
      ...requests,
      [id]: (requests[id] ?? 0) + 1,
    }))
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

  function deleteDesktopItem(item) {
    if (item.desktopKind === "file") {
      const nextStore = {
        ...fileStore,
        files: fileStore.files.map((file) =>
          file.id === item.fileId
            ? {
                ...file,
                folderId: RECYCLE_BIN_FOLDER_ID,
                originalFolderId: file.folderId,
                deletedAt: Date.now(),
              }
            : file,
        ),
      }

      localStorage.setItem(fileStoreKey, JSON.stringify(nextStore))
      setFileStore(nextStore)
      window.dispatchEvent(new Event(fileStoreChangeEvent))
    }

    if (item.desktopKind === "folder") {
      const nextStore = {
        ...fileStore,
        folders: fileStore.folders.map((folder) =>
          folder.id === item.folderId
            ? {
                ...folder,
                parentId: RECYCLE_BIN_FOLDER_ID,
                originalParentId: folder.parentId,
                deletedAt: Date.now(),
              }
            : folder,
        ),
      }

      localStorage.setItem(fileStoreKey, JSON.stringify(nextStore))
      setFileStore(nextStore)
      window.dispatchEvent(new Event(fileStoreChangeEvent))
    }

    setDesktopContextMenu(null)
  }

  function deleteDesktopItems(types) {
    const selected = desktopItems.filter((item) => types.includes(item.type))
    const deletable = selected.filter((item) =>
      item.desktopKind === "file" || item.desktopKind === "folder",
    )

    if (!deletable.length) return

    const fileIds = deletable
      .filter((item) => item.desktopKind === "file")
      .map((item) => item.fileId)
    const folderIds = deletable
      .filter((item) => item.desktopKind === "folder")
      .map((item) => item.folderId)
    const nextStore = {
      ...fileStore,
      files: fileStore.files.map((file) =>
        fileIds.includes(file.id)
          ? {
              ...file,
              folderId: RECYCLE_BIN_FOLDER_ID,
              originalFolderId: file.folderId,
              deletedAt: Date.now(),
            }
          : file,
      ),
      folders: fileStore.folders.map((folder) =>
        folderIds.includes(folder.id)
          ? {
              ...folder,
              parentId: RECYCLE_BIN_FOLDER_ID,
              originalParentId: folder.parentId,
              deletedAt: Date.now(),
            }
          : folder,
      ),
    }

    localStorage.setItem(fileStoreKey, JSON.stringify(nextStore))
    setFileStore(nextStore)
    setSelectedIcons((current) =>
      current.filter((type) => !deletable.some((item) => item.type === type)),
    )
    window.dispatchEvent(new Event(fileStoreChangeEvent))
  }

  function emptyRecycleBin() {
    const store = loadFileStore(fileStoreKey, rootFolderName)
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
    playSound(recycledSound, volume)
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
      targetFileId: win.data.fileId ?? "",
    })
  }

  function openNotepadFileDialog(id) {
    setOpenDialog({ windowId: id })
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
      rootFolderName,
      saveDialog.targetFileId,
    )
    window.dispatchEvent(new Event(fileStoreChangeEvent))
    setFileStore(loadFileStore(fileStoreKey, rootFolderName))

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

  function finishArtItSave() {
    if (!saveDialog?.dataUrl) return

    saveImageFile(
      saveDialog.name,
      saveDialog.type,
      saveDialog.dataUrl,
      saveDialog.folderId,
      fileStoreKey,
      rootFolderName,
      saveDialog.targetFileId,
    )
    window.dispatchEvent(new Event(fileStoreChangeEvent))
    setFileStore(loadFileStore(fileStoreKey, rootFolderName))
    setSaveDialog(null)
  }

  function finishArtItLocationPick() {
    saveDialog?.respond?.({
      folderId: saveDialog.folderId,
      label: folderPath(fileStore.folders, saveDialog.folderId),
    })
    setSaveDialog(null)
  }

  function finishNotepadOpen(fileId) {
    const file = fileStore.files.find((item) => item.id === fileId)
    if (!file || !openDialog) return

    setWindows((wins) =>
      wins.map((item) =>
        item.id === openDialog.windowId
          ? {
              ...item,
              title: file.name,
              data: {
                ...item.data,
                fileId: file.id,
                folderId: file.folderId,
                text: file.text ?? "",
              },
            }
          : item,
      ),
    )
    setOpenDialog(null)
  }

  function saveArtItExport({ name, type, dataUrl, folderId }) {
    if (!dataUrl) return

    if (folderId) {
      saveImageFile(
        name,
        type,
        dataUrl,
        folderId,
        fileStoreKey,
        rootFolderName,
      )
      window.dispatchEvent(new Event(fileStoreChangeEvent))
      setFileStore(loadFileStore(fileStoreKey, rootFolderName))
      return
    }

    setSaveDialog({
      kind: "image",
      title: "Save image",
      name: getFileStem(normalizePngFileName(name)),
      folderId: DESKTOP_FOLDER_ID,
      targetFileId: "",
      fileType: "image",
      showName: false,
      extension: ".png",
      type: type || "image/png",
      dataUrl,
    })
  }

  function pickArtItSaveLocation({ name, respond }) {
    setSaveDialog({
      kind: "image-location",
      title: "Choose export folder",
      name: getFileStem(normalizePngFileName(name)),
      folderId: DESKTOP_FOLDER_ID,
      targetFileId: "",
      fileType: "image",
      showName: false,
      respond,
    })
  }

  function pokeSaveDialog() {
    playSound(alert, volume)
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
      onDragOver={(e) => e.preventDefault()}
      onDrop={dropDesktopFiles}
      onKeyDown={(e) => {
        if (e.key === "Delete") deleteDesktopItems(selectedIcons)
      }}
      tabIndex={0}
    >
      <DesktopGrid
        apps={desktopItems}
        selectedIcons={selectedIcons}
        onSelect={setSelectedIcons}
        onPlaceSelected={placeDesktopItems}
        onOpen={openDesktopItem}
        onOpenMenu={openDesktopMenu}
        onDropFiles={dropDesktopFiles}
      />

      {/* windows.map turns each saved window object into an actual window on screen. */}
      {windows.map((win) => (
        !win.minimized && (
          <Window
            key={win.id}
            win={win}
            onClose={closeWindow}
            closeRequest={closeRequests[win.id] ?? 0}
            onFocus={focusWindow}
            onFrameChange={updateWindowFrame}
            onMinimize={minimizeWindow}
            onToggleMaximize={toggleMaximizeWindow}
            minimizeTarget={taskbarPositions[win.type]}
          >
            {win.type === "notepad" && (
              <Notepad
                documentName={getNotepadDocumentName(win)}
                text={win.data.text}
                onChange={(text) => updateWindowData(win.id, { text })}
                onSave={() => saveNotepadWindow(win.id)}
                onOpen={() => openNotepadFileDialog(win.id)}
              />
            )}
            {win.type === "settings" && (
              <Settings
                backgrounds={backgrounds}
                files={fileStore.files}
                folders={fileStore.folders}
                background={background}
                homeFolderId={homeFolderId}
                volume={volume}
                onBackgroundChange={setBackground}
                onHomeFolderChange={setHomeFolderId}
                onVolumeChange={setVolume}
              />
            )}
            {win.type === "file-explorer" && (
              <File
                desktopItems={desktopItems}
                initialFolder={win.data.initialFolder}
                rootFolderName={rootFolderName}
                storageKey={fileStoreKey}
                storeChangeEvent={fileStoreChangeEvent}
                homeFolderId={homeFolderId}
                volume={volume}
                onOpenApp={openWindow}
                onOpenFile={openFile}
                onClose={() => requestAnimatedClose(win.id)}
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
                volume={volume}
              />
            )}
            {win.type === "google-chrome" && (
              <Chrome onClose={() => requestAnimatedClose(win.id)} />
            )}
            {win.type === "drawing" && (
              <ArtIt
                onExport={saveArtItExport}
                onPickSaveLocation={pickArtItSaveLocation}
              />
            )}
            {win.type === "element-fight" && (
              <ElementFight />
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
          files={fileStore.files}
          title={saveDialog.title}
          fileType={saveDialog.fileType}
          showName={saveDialog.showName}
          canReplace={!saveDialog.kind?.startsWith("image")}
          name={saveDialog.name}
          folderId={saveDialog.folderId}
          targetFileId={saveDialog.targetFileId}
          onNameChange={(name) =>
            setSaveDialog((dialog) => ({ ...dialog, name, targetFileId: "" }))
          }
          onFolderChange={(folderId) =>
            setSaveDialog((dialog) => ({
              ...dialog,
              folderId,
              targetFileId: "",
            }))
          }
          onTargetChange={(fileId) =>
            setSaveDialog((dialog) => {
              const file = fileStore.files.find((item) => item.id === fileId)

              if (!file) return { ...dialog, targetFileId: "" }

              return {
                ...dialog,
                targetFileId: file.id,
                folderId: file.folderId,
                name: getFileStem(file.name),
              }
            })
          }
          onSave={
            saveDialog.kind === "image-location"
              ? finishArtItLocationPick
              : saveDialog.kind === "image"
                ? finishArtItSave
                : finishNotepadSave
          }
          onIgnore={pokeSaveDialog}
        />
      )}

      {openDialog && (
        <OpenTextDialog
          files={fileStore.files}
          folders={fileStore.folders}
          onOpen={finishNotepadOpen}
          onClose={() => setOpenDialog(null)}
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
          ) : desktopContextMenu.app.desktopKind === "file" ||
            desktopContextMenu.app.desktopKind === "folder" ? (
            <button type="button" onClick={() => deleteDesktopItem(desktopContextMenu.app)}>
              Delete
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
  onDropFiles,
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
    const selected = e.ctrlKey || e.metaKey
      ? toggleSelected(selectedIcons, app.type)
      : selectedIcons.includes(app.type)
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
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDropFiles}
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
            aria-label={app.title}
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
  const suppressClickRef = useRef(false)
  const [dragState, setDragState] = useState(null)
  const draggedType = dragState?.type ?? null

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
    if (e.button !== 0) return

    e.preventDefault()
    e.stopPropagation()
    suppressClickRef.current = false
    setDragState({
      type,
      startX: e.clientX,
      startY: e.clientY,
      hasMoved: false,
    })
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function updateTaskbarDrag(e) {
    if (!dragState) return

    const dx = e.clientX - dragState.startX
    const dy = e.clientY - dragState.startY
    const hasMoved = dragState.hasMoved || Math.hypot(dx, dy) > 4

    if (hasMoved) {
      suppressClickRef.current = true
      setDragState((state) =>
        state?.hasMoved ? state : { ...state, hasMoved: true },
      )

      const target = document
        .elementFromPoint(e.clientX, e.clientY)
        ?.closest("[data-taskbar-type]")
        ?.getAttribute("data-taskbar-type")

      if (target && target !== dragState.type) {
        onReorder(dragState.type, target)
      }
    }
  }

  function moveTaskbarDrag(targetType) {
    if (!dragState?.hasMoved || draggedType === targetType) return
    onReorder(draggedType, targetType)
  }

  function finishTaskbarDrag() {
    setDragState(null)
  }

  return (
    <footer className="taskbar" onPointerMove={updateTaskbarDrag}>
      <div className={`taskbar-apps ${dragState?.hasMoved ? "taskbar-apps-dragging" : ""}`}>
        {visibleApps.map((app) => {
          const openWindows = windows.filter((win) => win.type === app.type)
          const isOpen = openWindows.length > 0

          return (
            <div
              key={app.type}
              data-taskbar-type={app.type}
              className="taskbar-app-wrap"
              onPointerEnter={() => moveTaskbarDrag(app.type)}
            >
              <button
                ref={(node) => {
                  iconRefs.current[app.type] = node
                }}
                className={`taskbar-app taskbar-app-${app.type} ${
                  isOpen ? "taskbar-app-open" : ""
                } ${draggedType === app.type ? "taskbar-app-dragging" : ""}`}
                type="button"
                aria-label={app.title}
                onPointerDown={(e) => startTaskbarDrag(app.type, e)}
                onPointerUp={finishTaskbarDrag}
                onPointerCancel={finishTaskbarDrag}
                onContextMenu={(e) => {
                  e.preventDefault()
                  onUnpin(app.type)
                }}
                onClick={(e) => {
                  if (suppressClickRef.current) {
                    e.preventDefault()
                    suppressClickRef.current = false
                    return
                  }

                  clickTaskbarApp(app, openWindows)
                }}
              >
                <img
                  src={app.logo}
                  alt=""
                  draggable="false"
                  onDragStart={(e) => e.preventDefault()}
                />
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
        {win.type === "google-chrome" && (
          <div className="preview-chrome">
            https://savana-unana.github.io/UPRO/
          </div>
        )}
        {win.type === "element-fight" && (
          <div className="preview-chrome">
            https://savana-unana.github.io/ElementFight/
          </div>
        )}
      </div>
    </div>
  )
}

function SaveDialog({
  folders,
  files,
  title = "Save note",
  fileType = "text",
  showName = true,
  canReplace = true,
  name,
  folderId,
  targetFileId,
  onNameChange,
  onFolderChange,
  onTargetChange,
  onSave,
  onIgnore,
}) {
  const saveFolders = folders.filter(
    (folder) => folder.id !== RECYCLE_BIN_FOLDER_ID,
  )
  const replaceFiles = files.filter((file) =>
    fileType === "image" ? isImageFile(file) : isTextFile(file),
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
        <h2>{title}</h2>
        {showName && (
          <label>
            Name
            <input
              value={name}
              autoFocus
              onChange={(e) => onNameChange(e.target.value)}
            />
          </label>
        )}
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
        {canReplace && (
          <label>
            Replace file
            <select
              value={targetFileId}
              onChange={(e) => onTargetChange(e.target.value)}
            >
              <option value="">Create new file</option>
              {replaceFiles.map((file) => (
                <option key={file.id} value={file.id}>
                  {folderPath(folders, file.folderId)} / {file.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <button type="submit">Save</button>
      </form>
    </div>
  )
}

function OpenTextDialog({ files, folders, onOpen, onClose }) {
  const textFiles = files.filter((file) => isTextFile(file))
  const [selectedFileId, setSelectedFileId] = useState(textFiles[0]?.id ?? "")

  function submitOpen(e) {
    e.preventDefault()
    if (!selectedFileId) return
    onOpen(selectedFileId)
  }

  return (
    <div className="save-overlay" onPointerDown={onClose}>
      <form
        className="save-dialog"
        onSubmit={submitOpen}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <h2>Open note</h2>
        <label>
          File
          <select
            value={selectedFileId}
            autoFocus
            onChange={(e) => setSelectedFileId(e.target.value)}
          >
            {textFiles.length === 0 && (
              <option value="">No saved notes</option>
            )}
            {textFiles.map((file) => (
              <option key={file.id} value={file.id}>
                {folderPath(folders, file.folderId)} / {file.name}
              </option>
            ))}
          </select>
        </label>
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={!selectedFileId}>
            Open
          </button>
        </div>
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
  closeRequest,
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

  useEffect(() => {
    if (!closeRequest) return
    const timer = setTimeout(() => onClose(win.id), 150)
    return () => clearTimeout(timer)
  }, [closeRequest, onClose, win.id])

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
      className={`window app-window-${win.type} window-${
        closeRequest ? "closing" : visualState
      }`}
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

function getNotepadDocumentName(win) {
  return win.data.fileId ? win.title : "Untitled Document"
}

function saveTextFile(
  fileId,
  title,
  text,
  folderId,
  storageKey = FILE_STORE_KEY,
  rootFolderName = "User Folder",
  targetFileId = "",
) {
  const store = loadFileStore(storageKey, rootFolderName)
  const existing = store.files.find((file) => file.id === (targetFileId || fileId))
  const requestedName = title.endsWith(".txt") ? title : `${title}.txt`
  const existingNames = store.files
    .filter((file) => file.folderId === folderId && file.id !== existing?.id)
    .map((file) => file.name)
  const name = getUniqueFileName(requestedName, existingNames)
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

function saveImageFile(
  title,
  type,
  dataUrl,
  folderId,
  storageKey = FILE_STORE_KEY,
  rootFolderName = "User Folder",
  targetFileId = "",
) {
  const store = loadFileStore(storageKey, rootFolderName)
  const existing = store.files.find((file) => file.id === targetFileId)
  const requestedName = normalizePngFileName(title)
  const existingNames = store.files
    .filter((file) => file.folderId === folderId && file.id !== existing?.id)
    .map((file) => file.name)
  const savedFile = {
    id: existing?.id ?? crypto.randomUUID(),
    name: getUniqueFileName(requestedName, existingNames),
    type: type || "image/png",
    size: getDataUrlSize(dataUrl),
    folderId,
    addedAt: existing?.addedAt ?? Date.now(),
    text: "",
    dataUrl,
  }
  const files = existing
    ? store.files.map((file) => (file.id === savedFile.id ? savedFile : file))
    : [savedFile, ...store.files]

  localStorage.setItem(storageKey, JSON.stringify({ ...store, files }))
  return savedFile
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

function normalizePngFileName(name) {
  const cleanName = String(name ?? "")
    .trim()
    .replace(/\.p(?=.*\.png$)/i, ".")
    .replace(/pngng$/i, "png")
    .replace(/[<>:"/\\|?*]/g, "-") || "Art It!"

  return cleanName.toLowerCase().endsWith(".png") ? cleanName : `${cleanName}.png`
}

function getFileStem(name) {
  return String(name ?? "").replace(/\.[^/.]+$/, "")
}

function getDataUrlSize(dataUrl) {
  const base64 = dataUrl.split(",")[1] ?? ""
  return Math.round((base64.length * 3) / 4)
}

function toggleSelected(items, item) {
  return items.includes(item)
    ? items.filter((current) => current !== item)
    : [...items, item]
}

function loadFileStore(storageKey = FILE_STORE_KEY, rootFolderName = "User Folder") {
  const defaultFolders = getDefaultFileFolders(rootFolderName)

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

function getDefaultFileFolders(rootFolderName) {
  return BASE_DEFAULT_FILE_FOLDERS.map((folder) =>
    folder.id === ROOT_FOLDER_ID ? { ...folder, name: rootFolderName } : folder,
  )
}

function getDesktopItems(store) {
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
    ...store.folders
      .filter((folder) => folder.parentId === DESKTOP_FOLDER_ID)
      .map((folder) => ({
        type: `folder:${folder.id}`,
        desktopKind: "folder",
        folderId: folder.id,
        windowType: "file-explorer",
        title: folder.name,
        logo: folderIcon,
        data: { initialFolder: folder.id },
      })),
    ...store.files
      .filter((file) => file.folderId === DESKTOP_FOLDER_ID)
      .map((file) => ({
        type: `file:${file.id}`,
        desktopKind: "file",
        fileId: file.id,
        title: cleanDesktopFileName(file.name),
        logo: getDesktopFileIcon(file),
      })),
  ]
}

function getDesktopFileIcon(file) {
  if (file.type.startsWith("image/")) return photosIcon
  if (isMediaFile(file)) return mediaIcon
  if (file.type.startsWith("text/")) return noteIcon
  return fileIcon
}

function cleanDesktopFileName(name) {
  return name.replace(/\.[^/.]+$/, "")
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
    let col = oldItem?.col ?? (app.type === "recycle-bin" ? 1 : index + 1)
    let row = oldItem?.row ?? 1
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

function playSound(sound, volume = 1) {
  if (!sound) return

  const audio = new Audio(sound)
  audio.volume = clamp(volume, 0, 1)
  audio.play().catch(() => {})
}

function cleanAssetName(path) {
  return path
    .split("/")
    .at(-1)
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
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

function isTextFile(file) {
  return file.type.startsWith("text/") || /\.txt$/i.test(file.name)
}

function isImageFile(file) {
  return file.type.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|svg|avif|ico)$/i.test(file.name)
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
    return /\.(png|jpe?g|gif|webp|bmp|svg|avif|ico)$/i.test(name)
      ? name
      : `Dropped image ${Date.now()}.png`
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

async function refreshAccountSession() {
  try {
    await fetch("/api/touch", { method: "POST" })
  } catch {
    // Offline/local API downtime should not interrupt the current desktop.
  }
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
  const text = await response.text()
  const data = text ? tryParseJson(text) : {}

  if (!response.ok) {
    const fallback = text
      ? `Request failed (${response.status}): ${text.slice(0, 180)}`
      : `Request failed (${response.status}). Check that Netlify Functions are deployed.`

    throw new Error(
      data.message ??
        fallback,
    )
  }

  return data
}

function tryParseJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return {}
  }
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
