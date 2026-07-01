// Resolves where the sync server lives.
//
// - In dev (`vite dev`), the client runs on :5173 and the server on :4000,
//   so we default to the same hostname on port 4000 — this is what lets a
//   guest who opens http://<presenter-ip>:5173 automatically reach
//   http://<presenter-ip>:4000 without typing anything.
// - In a production build served BY the sync server itself (see
//   server/server.js static fallback), client and server share an origin,
//   so we default to "" (same origin) and let socket.io figure it out.
//
// Either way it's overridable and persisted, in case of a custom deployment.

const STORAGE_KEY = "wt:serverUrl";

export function getDefaultServerUrl() {
  if (import.meta.env.DEV) {
    return `${window.location.protocol}//${window.location.hostname}:4000`;
  }
  return window.location.origin;
}

export function getStoredServerUrl() {
  return localStorage.getItem(STORAGE_KEY) || getDefaultServerUrl();
}

export function setStoredServerUrl(url) {
  localStorage.setItem(STORAGE_KEY, url);
}

/** Uploads a video file with progress reporting, returns { url, name }. */
export function uploadVideo(file, serverUrl, onProgress) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("video", file);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${serverUrl}/api/upload`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch (err) {
          reject(err);
        }
      } else {
        reject(new Error(`Échec de l'envoi (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error("Échec de l'envoi — vérifiez l'adresse du serveur."));
    xhr.send(form);
  });
}
