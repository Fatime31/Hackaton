import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useRoom } from "../context/RoomContext.jsx";
import { uploadVideo } from "../lib/api.js";

const ICON_CREATE = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
    <path d="M5 3l14 9-14 9V3z" />
  </svg>
);
const ICON_JOIN = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
    <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 00-3-3.87" />
    <path d="M16 3.13a4 4 0 010 7.75" />
  </svg>
);

export default function Home() {
  const navigate = useNavigate();
  const { serverUrl, setServerUrl, createRoom, joinRoom, error, connected } = useRoom();

  const [showSettings, setShowSettings] = useState(false);
  const [serverInput, setServerInput] = useState(serverUrl);

  const [presenterName, setPresenterName] = useState("");
  const [videoMode, setVideoMode] = useState("upload"); // 'upload' | 'url'
  const [videoUrlInput, setVideoUrlInput] = useState("");
  const [file, setFile] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);

  const [guestName, setGuestName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState(null);

  async function handleCreate(e) {
    e.preventDefault();
    setCreateError(null);

    let videoUrl = videoUrlInput.trim();
    let videoName = null;

    if (videoMode === "upload") {
      if (!file) {
        setCreateError("Choisissez un fichier vidéo, ou collez une URL.");
        return;
      }
      try {
        setCreating(true);
        setUploadProgress(0);
        const res = await uploadVideo(file, serverUrl, setUploadProgress);
        videoUrl = `${serverUrl}${res.url}`;
        videoName = res.name;
      } catch (err) {
        setCreateError(err.message);
        setCreating(false);
        setUploadProgress(null);
        return;
      }
    } else if (!videoUrl) {
      setCreateError("Collez l'URL de la vidéo à projeter.");
      return;
    }

    setCreating(true);
    const res = await createRoom({
      name: presenterName.trim() || "Présentateur",
      videoUrl,
      videoName,
    });
    setCreating(false);
    setUploadProgress(null);
    if (res?.ok) navigate(`/room/${res.state.code}`);
    else setCreateError(res?.error || "Impossible de créer la salle.");
  }

  async function handleJoin(e) {
    e.preventDefault();
    setJoinError(null);
    if (!roomCode.trim()) {
      setJoinError("Entrez le code de la salle.");
      return;
    }
    setJoining(true);
    const res = await joinRoom({ code: roomCode, name: guestName.trim() || "Invité" });
    setJoining(false);
    if (res?.ok) navigate(`/room/${res.state.code}`);
    else setJoinError(res?.error || "Impossible de rejoindre la salle.");
  }

  function applyServerUrl(e) {
    e.preventDefault();
    setServerUrl(serverInput.trim().replace(/\/$/, ""));
  }

  return (
    <section>
      <div className="hero">
        <div>
          <div className="eyebrow">NetLite</div>
          <h1>
            Tout le monde regarde.
            <br />
            <em>Au même instant.</em>
          </h1>
          <p className="lede">
            Watch Together transforme n'importe quelle vidéo de démo, formation ou lancement en
            séance synchronisée : un présentateur pilote toute l'équipe suit en direct sans
            décalage, sans bricolage.
          </p>

          <button className="settings-toggle" onClick={() => setShowSettings((s) => !s)}>
            <span className={`dot ${connected ? "ok" : "off"}`} />
            {connected ? "Connecté au serveur de synchro" : "Non connecté"} · {serverUrl}
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
          {showSettings && (
            <form className="server-settings" onSubmit={applyServerUrl}>
              <label>Adresse du serveur de synchro</label>
              <div className="join-row">
                <input
                  type="text"
                  value={serverInput}
                  onChange={(e) => setServerInput(e.target.value)}
                  placeholder="http://192.168.1.23:4000"
                />
                <button className="btn btn-ghost btn-sm" type="submit">
                  Appliquer
                </button>
              </div>
              <p className="hint">
                Par défaut, le même ordinateur que celui qui sert cette page, sur le port 4000.
                Les invités sur le réseau local n'ont normalement rien à changer ici.
              </p>
            </form>
          )}
          {error && <p className="form-error">{error}</p>}
        </div>

        <div className="ticket">
          <div className="film-rail" />
          <div className="ticket-body">
            <h3>Démarrer une séance</h3>
            <div className="role-cards">
              <form className="role-card" onSubmit={handleCreate}>
                <div className="ic">{ICON_CREATE}</div>
                <div className="role-card-body">
                  <h4>Créer une salle</h4>
                  <p>
                    Vous devenez présentateur&nbsp;: play, pause et déplacement de la tête de
                    lecture sont diffusés à tous les invités.
                  </p>

                  <input
                    type="text"
                    placeholder="Votre nom"
                    value={presenterName}
                    onChange={(e) => setPresenterName(e.target.value)}
                    className="text-input"
                  />

                  <div className="video-mode-toggle">
                    <button
                      type="button"
                      className={videoMode === "upload" ? "active" : ""}
                      onClick={() => setVideoMode("upload")}
                    >
                      Importer un fichier
                    </button>
                    <button
                      type="button"
                      className={videoMode === "url" ? "active" : ""}
                      onClick={() => setVideoMode("url")}
                    >
                      Coller une URL
                    </button>
                  </div>

                  {videoMode === "upload" ? (
                    <label className="file-drop">
                      <input
                        type="file"
                        accept="video/*"
                        onChange={(e) => setFile(e.target.files?.[0] || null)}
                      />
                      {file ? file.name : "Choisir un fichier vidéo (.mp4, .webm…)"}
                    </label>
                  ) : (
                    <input
                      type="text"
                      placeholder="https://exemple.com/demo-q3.mp4"
                      value={videoUrlInput}
                      onChange={(e) => setVideoUrlInput(e.target.value)}
                      className="text-input"
                    />
                  )}

                  {uploadProgress !== null && (
                    <div className="upload-bar">
                      <i style={{ width: `${uploadProgress}%` }} />
                      <span>{uploadProgress}%</span>
                    </div>
                  )}

                  {createError && <p className="form-error">{createError}</p>}

                  <button className="btn btn-primary" type="submit" disabled={creating}>
                    {creating ? "Création…" : "Créer la salle →"}
                  </button>
                </div>
              </form>

              <form className="role-card" onSubmit={handleJoin}>
                <div className="ic">{ICON_JOIN}</div>
                <div className="role-card-body">
                  <h4>Rejoindre une salle</h4>
                  <p>
                    Entrez le code transmis par le présentateur — vous rejoignez exactement à la
                    position en cours.
                  </p>
                  <input
                    type="text"
                    placeholder="Votre nom"
                    value={guestName}
                    onChange={(e) => setGuestName(e.target.value)}
                    className="text-input"
                  />
                  <div className="join-row">
                    <input
                      type="text"
                      placeholder="ex. DEMO-Q3"
                      value={roomCode}
                      onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                    />
                    <button className="btn btn-ghost btn-sm" type="submit" disabled={joining}>
                      {joining ? "…" : "Rejoindre"}
                    </button>
                  </div>
                  {joinError && <p className="form-error">{joinError}</p>}
                </div>
              </form>
            </div>
          </div>
          <div className="film-rail bottom" style={{ marginTop: 18 }} />
        </div>
      </div>

      <div className="section-title">
        <h2>Comment ça marche</h2>
      </div>
      <div className="steps">
        <div className="step">
          <div className="n">01</div>
          <h4>Créer &amp; partager</h4>
          <p>
            Le présentateur crée la salle, choisit la vidéo, et partage un code court avec les
            invités sur le réseau local.
          </p>
        </div>
        <div className="step">
          <div className="n">02</div>
          <h4>Rejoindre &amp; rattraper</h4>
          <p>
            Chaque invité reçoit l'état complet de la salle dès la connexion&nbsp;: il démarre
            exactement là où tout le monde en est.
          </p>
        </div>
        <div className="step">
          <div className="n">03</div>
          <h4>Piloter &amp; projeter</h4>
          <p>
            Play, pause, seek&nbsp;: chaque action du présentateur est diffusée et appliquée en
            moins d'un battement de cœur.
          </p>
        </div>
      </div>
    </section>
  );
}
