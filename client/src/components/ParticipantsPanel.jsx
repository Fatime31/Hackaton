import { useRoom } from "../context/RoomContext.jsx";
import { avatarColor, initials } from "../lib/format.js";

const ICON_LOCK = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V7a4 4 0 018 0v4" />
  </svg>
);

function statusLabel(p) {
  if (p.role === "presenter") return "Présentateur";
  if (p.status === "resyncing") return "recalage en cours…";
  if (p.status === "adjusting") return "ajustement…";
  return `synchronisé · ${p.drift ?? 0}ms`;
}

export default function ParticipantsPanel() {
  const { participants, role, selfId } = useRoom();

  return (
    <div className="panel">
      <div className="panel-head">
        <h4>Participants · {participants.length}</h4>
      </div>

      {participants.map((p) => (
        <div className="participant" key={p.id}>
          <div
            className="avatar"
            style={{ background: p.role === "presenter" ? "var(--accent-lamp)" : avatarColor(p.id) }}
          >
            {initials(p.name)}
          </div>
          <div className="p-info">
            <div className="name">
              {p.name}
              {p.id === selfId && <span className="me-tag">VOUS</span>}
            </div>
            <div className={`status ${p.role === "presenter" ? "synced" : p.status}`}>
              <span className="status-dot" />
              {statusLabel(p)}
            </div>
          </div>
        </div>
      ))}

      {role === "guest" && (
        <div className="lock-static">
          {ICON_LOCK}
          Contrôles désactivés pour les invités
        </div>
      )}
    </div>
  );
}
