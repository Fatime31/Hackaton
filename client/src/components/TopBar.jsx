import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useRoom } from "../context/RoomContext.jsx";
import { formatElapsed } from "../lib/format.js";

export default function TopBar() {
  const { code, role, name, createdAt, leaveRoom } = useRoom();
  const navigate = useNavigate();
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!createdAt) return;
    const id = setInterval(() => setElapsed(Date.now() - createdAt), 1000);
    return () => clearInterval(id);
  }, [createdAt]);

  function handleLeave() {
    leaveRoom();
    navigate("/");
  }

  return (
    <div className="room-topbar">
      <div className="room-badge">
        <span className="live-dot" />
        <span className="room-name">
          <b>{code}</b> <span>· salle active</span>
        </span>
        <span className={`role-pill ${role === "presenter" ? "presenter" : ""}`}>
          {role === "presenter" ? "Présentateur" : `Invité · ${name}`}
        </span>
      </div>
      <div className="room-meta">
        <span className="room-timer">⏱ {formatElapsed(elapsed)} écoulées</span>
        <button className="btn btn-ghost btn-sm" onClick={handleLeave}>
          Quitter la salle
        </button>
      </div>
    </div>
  );
}
