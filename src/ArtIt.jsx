import { useEffect, useRef, useState } from "react"

const ART_IT_URL = "https://savana-unana.github.io/ArtIt/"

function ArtIt({ onExport, onPickSaveLocation }) {
  const frameRef = useRef(null)
  const [ready, setReady] = useState(false)
  const [frameHtml, setFrameHtml] = useState("")

  useEffect(() => {
    let cancelled = false

    async function loadArtIt() {
      setReady(false)

      try {
        const response = await fetch(ART_IT_URL)
        const html = await response.text()

        if (!cancelled) setFrameHtml(prepareArtItHtml(html))
      } catch {
        if (!cancelled) setFrameHtml("")
      }
    }

    loadArtIt()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    function receiveFrameMessage(event) {
      if (event.source !== frameRef.current?.contentWindow) return

      if (event.data?.type === "inventory-file-save-request") {
        onPickSaveLocation?.({
          name: event.data.name,
          respond: (destination) => {
            frameRef.current?.contentWindow?.postMessage(
              {
                type: "inventory-file-save-response",
                requestId: event.data.requestId,
                ...destination,
              },
              window.location.origin,
            )
          },
        })
        return
      }

      if (event.data?.type !== "inventory-file-export") return

      onExport?.({
        name: event.data.name,
        type: event.data.mimeType,
        dataUrl: event.data.dataUrl,
        folderId: event.data.folderId,
      })
    }

    window.addEventListener("message", receiveFrameMessage)
    return () => window.removeEventListener("message", receiveFrameMessage)
  }, [onExport, onPickSaveLocation])

  function notifyReady() {
    setReady(true)
    frameRef.current?.contentWindow?.postMessage(
      { type: "inventory-browser-ready" },
      window.location.origin,
    )
  }

  return (
    <div className="artit-app">
      {!ready && <div className="artit-loading">Loading Art It!</div>}
      <iframe
        ref={frameRef}
        className="artit-frame"
        src={frameHtml ? undefined : ART_IT_URL}
        srcDoc={frameHtml || undefined}
        title="Art It!"
        allow="autoplay; fullscreen; gamepad"
        onLoad={notifyReady}
      />
    </div>
  )
}

function prepareArtItHtml(html) {
  const htmlWithAbsoluteAssets = html.replace(
    /\b(src|href)=("|')(\/ArtIt\/[^"']+)/g,
    (match, attribute, quote, assetPath) => {
      const assetUrl = new URL(assetPath, ART_IT_URL).href
      return `${attribute}=${quote}${assetUrl}`
    },
  )
  const baseTag = `<base href="${escapeHtml(ART_IT_URL)}">`
  const script = `<script>
(() => {
  const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  const cleanFileName = (name) => {
    const clean = String(name || "Art It!").trim().replace(/[<>:"/\\\\|?*]/g, "-") || "Art It!";
    return clean.toLowerCase().endsWith(".png") ? clean : clean + ".png";
  };
  let saveRequestId = 0;
  const requestInventorySaveLocation = (name) => new Promise((resolve) => {
    const requestId = ++saveRequestId;
    const receiveResponse = (event) => {
      if (event.data?.type !== "inventory-file-save-response") return;
      if (event.data.requestId !== requestId) return;
      window.removeEventListener("message", receiveResponse);
      resolve({
        folderId: event.data.folderId,
        label: event.data.label || "Inventory",
        fileName: cleanFileName(name),
      });
    };

    window.addEventListener("message", receiveResponse);
    parent.postMessage({
      type: "inventory-file-save-request",
      requestId,
      name: cleanFileName(name),
    }, "*");
  });
  const objectUrls = new Map();
  const originalCreateObjectUrl = URL.createObjectURL.bind(URL);
  const originalRevokeObjectUrl = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = (value) => {
    const url = originalCreateObjectUrl(value);
    if (value instanceof Blob) objectUrls.set(url, value);
    return url;
  };
  URL.revokeObjectURL = (url) => {
    setTimeout(() => objectUrls.delete(url), 15000);
    originalRevokeObjectUrl(url);
  };
  const postExport = async (name, blob, destination = {}) => {
    parent.postMessage({
      type: "inventory-file-export",
      name: cleanFileName(name),
      folderId: destination.folderId,
      mimeType: blob.type || "application/octet-stream",
      dataUrl: await blobToDataUrl(blob),
    }, "*");
  };

  try {
    Object.defineProperty(window, "showSaveFilePicker", {
      value: async (options = {}) => {
        const destination = await requestInventorySaveLocation(options.suggestedName);
        return {
          name: destination.label,
          async createWritable() {
            const chunks = [];
            return {
              async write(chunk) {
                chunks.push(chunk);
              },
              async close() {
                await postExport(
                  destination.fileName,
                  new Blob(chunks, { type: "image/png" }),
                  destination,
                );
              },
            };
          },
        };
      },
      configurable: true,
    });
  } catch {}

  const originalAnchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function patchedAnchorClick() {
    const href = this.getAttribute("href");
    const download = this.getAttribute("download");
    if (download && href && (href.startsWith("blob:") || href.startsWith("data:"))) {
      const blob = objectUrls.get(href);
      if (blob) {
        postExport(download, blob).catch(() => {});
        return;
      }

      fetch(href)
        .then((response) => response.blob())
        .then((blob) => postExport(download, blob))
        .catch(() => {});
      return;
    }

    return originalAnchorClick.call(this);
  };
})();
</script>`

  const htmlWithBase = htmlWithAbsoluteAssets.includes("<head>")
    ? htmlWithAbsoluteAssets.replace("<head>", `<head>${baseTag}${script}`)
    : `${baseTag}${script}${htmlWithAbsoluteAssets}`

  return htmlWithBase
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => {
    const escapes = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }

    return escapes[char]
  })
}

export default ArtIt
