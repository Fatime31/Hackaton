import { useEffect, useState } from "react";
import { useRoom } from "../context/RoomContext.jsx";

const ICON_LOCK = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V7a4 4 0 018 0v4" />
  </svg>
);

export default function GuestBanner() {
  const { lastAckDriftMs, lastCorrection } = useRoom();
  const [recentCorrection, setRecentCorrection] = useState(false);

  useEffect(() => {
    if (!lastCorrection) return;
    setRecentCorrection(true);
    const t = setTimeout(() => setRecentCorrection(false), 1800);
    return () => clearTimeout(t);
  }, [lastCorrection]);

  return (
    <div className="info-banner">
      <div className="l">
        {ICON_LOCK}
        Le présentateur contrôle la lecture — vos commandes sont désactivées.
      </div>
      <div className={`sync-badge ${recentCorrection ? "warn" : ""}`}>
        <span className="dot" />
        {recentCorrection
          ? "Recalage…"
          : lastAckDriftMs != null
          ? `Synchronisé · ${lastAckDriftMs}ms`
          : "Synchronisation…"}
      </div>
    </div>
  );
}
