import { useCallback, useEffect, useRef, useState } from "react";
import { useRoom } from "../context/RoomContext.jsx";
import { formatTime } from "../lib/format.js";

const PING_INTERVAL_MS = 2000;

const ICON_PLAY = (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M8 5v14l11-7z" />
  </svg>
);
const ICON_LOCK = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V7a4 4 0 018 0v4" />
  </svg>
);
const ICON_SPEED = (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M6 9l6 6 6-6" />
  </svg>
);

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

export default function Stage() {
  const {
    role,
    videoUrl,
    videoName,
    initialPlayback,
    lastSyncCommand,
    lastCorrection,
    pingPosition,
    sendCommand,
  } = useRoom();

  const videoRef = useRef(null);
  const readyRef = useRef(false);
  const appliedInitialRef = useRef(false);

  const [needsGesture, setNeedsGesture] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rateMenuOpen, setRateMenuOpen] = useState(false);
  const [rate, setRate] = useState(1);

  const safePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const p = video.play();
    if (p && typeof p.catch === "function") {
      p.catch(() => setNeedsGesture(true));
    }
  }, []);

  // Apply the room's authoritative state once, as soon as the video can seek.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !initialPlayback || appliedInitialRef.current) return;

    function apply() {
      video.currentTime = initialPlayback.position || 0;
      video.playbackRate = initialPlayback.rate || 1;
      setRate(initialPlayback.rate || 1);
      if (initialPlayback.isPlaying) safePlay();
      appliedInitialRef.current = true;
      readyRef.current = true;
    }

    if (video.readyState >= 1) apply();
    else {
      video.addEventListener("loadedmetadata", apply, { once: true });
      return () => video.removeEventListener("loadedmetadata", apply);
    }
  }, [initialPlayback, safePlay]);

  // Presenter → relay local interactions as authoritative commands.
  useEffect(() => {
    if (role !== "presenter") return;
    const video = videoRef.current;
    if (!video) return;

    const onPlay = () => readyRef.current && sendCommand({ type: "play", position: video.currentTime });
    const onPause = () => readyRef.current && sendCommand({ type: "pause", position: video.currentTime });
    const onSeeked = () => readyRef.current && sendCommand({ type: "seek", position: video.currentTime });

    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("seeked", onSeeked);
    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("seeked", onSeeked);
    };
  }, [role, sendCommand]);

  // Guest → apply commands broadcast by the presenter.
  useEffect(() => {
    if (role !== "guest" || !lastSyncCommand) return;
    const video = videoRef.current;
    if (!video) return;
    const { type, position, rate: cmdRate } = lastSyncCommand;

    if (typeof position === "number" && Math.abs(video.currentTime - position) > 0.05) {
      video.currentTime = position;
    }
    if (typeof cmdRate === "number") {
      video.playbackRate = cmdRate;
      setRate(cmdRate);
    }
    if (type === "play") safePlay();
    if (type === "pause") video.pause();
  }, [lastSyncCommand, role, safePlay]);

  // Guest → apply server-issued drift corrections (never self-initiated).
  useEffect(() => {
    if (role !== "guest" || !lastCorrection) return;
    const video = videoRef.current;
    if (!video) return;
    const { mode, position, isPlaying, rate: targetRate, direction } = lastCorrection;

    if (mode === "hard") {
      video.currentTime = position;
      if (targetRate) video.playbackRate = targetRate;
      isPlaying ? safePlay() : video.pause();
    } else if (mode === "soft") {
      const base = targetRate || 1;
      video.playbackRate = direction === "ahead" ? base * 0.97 : base * 1.03;
      const t = setTimeout(() => {
        if (videoRef.current) videoRef.current.playbackRate = base;
      }, 1500);
      return () => clearTimeout(t);
    }
  }, [lastCorrection, role, safePlay]);

  // Guest → periodic telemetry. The only thing a guest ever sends is a measurement.
  useEffect(() => {
    if (role !== "guest") return;
    const id = setInterval(() => {
      const video = videoRef.current;
      if (video && readyRef.current) pingPosition(video.currentTime);
    }, PING_INTERVAL_MS);
    return () => clearInterval(id);
  }, [role, pingPosition]);

  // Track time/duration for the read-only progress display shown to guests.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onTime = () => {
      setCurrentTime(video.currentTime);
      setDuration(video.duration || 0);
    };
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("loadedmetadata", onTime);
    return () => {
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("loadedmetadata", onTime);
    };
  }, []);

  function changeRate(next) {
    setRate(next);
    setRateMenuOpen(false);
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = next;
    if (role === "presenter") sendCommand({ type: "rate", rate: next, position: video.currentTime });
  }

  const showNativeControls = role === "presenter";
  const pct = duration ? Math.min(100, (currentTime / duration) * 100) : 0;

  return (
    <div className="stage-card">
      <div className="film-rail" />
      <div className="stage">
        <span className="stage-tag">{videoName || "Vidéo de la salle"}</span>
        {!showNativeControls && (
          <div className="lock-badge">
            {ICON_LOCK}
            Lecture pilotée à distance
          </div>
        )}

        {videoUrl ? (
          <video
            ref={videoRef}
            src={videoUrl}
            controls={showNativeControls}
            playsInline
            className="video-el"
          />
        ) : (
          <div className="video-empty">En attente de la vidéo du présentateur…</div>
        )}

        {needsGesture && (
          <button
            type="button"
            className="play-overlay join-gesture"
            onClick={() => {
              safePlay();
              setNeedsGesture(false);
            }}
          >
            {ICON_PLAY}
            <span>Rejoindre la diffusion</span>
          </button>
        )}
      </div>
      <div className="film-rail bottom" />

      {!showNativeControls && (
        <div className="controls-bar locked-bar">
          <div className="ctl-btn disabled">{ICON_PLAY}</div>
          <div className="scrub">
            <div className="scrub-track">
              <div className="scrub-fill" style={{ width: `${pct}%` }} />
              <div className="scrub-handle" style={{ left: `${pct}%`, width: 9, height: 9 }} />
            </div>
            <div className="scrub-times">
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>
          <div className="speed-sel disabled">{rate}×</div>
        </div>
      )}

      {role === "presenter" && (
        <div className="controls-bar rate-bar">
          <span className="rate-bar-label">Vitesse de lecture · diffusée à tous les invités</span>
          <div className="rate-picker">
            <button type="button" className="speed-sel" onClick={() => setRateMenuOpen((o) => !o)}>
              {rate}× {ICON_SPEED}
            </button>
            {rateMenuOpen && (
              <div className="rate-menu">
                {RATES.map((r) => (
                  <button key={r} type="button" className={r === rate ? "active" : ""} onClick={() => changeRate(r)}>
                    {r}×
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
