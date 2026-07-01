import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useRoom } from "../context/RoomContext.jsx";
import TopBar from "../components/TopBar.jsx";
import GuestBanner from "../components/GuestBanner.jsx";
import Stage from "../components/Stage.jsx";
import ParticipantsPanel from "../components/ParticipantsPanel.jsx";
import ChatPanel from "../components/ChatPanel.jsx";

export default function Room() {
  const { code } = useParams();
  const navigate = useNavigate();
  const { role, code: activeCode, roomClosed, joinRoom } = useRoom();

  const [joinName, setJoinName] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState(null);

  const needsJoin = !role || activeCode !== code;

  useEffect(() => {
    if (!roomClosed) return;
    const t = setTimeout(() => navigate("/"), 3000);
    return () => clearTimeout(t);
  }, [roomClosed, navigate]);

  if (roomClosed) {
    return (
      <div className="standalone-card">
        <h2>Salle fermée</h2>
        <p>{roomClosed}</p>
        <p className="hint">Retour à l'accueil…</p>
      </div>
    );
  }

  if (needsJoin) {
    async function handleSubmit(e) {
      e.preventDefault();
      setJoinError(null);
      setJoining(true);
      const res = await joinRoom({ code, name: joinName.trim() || "Invité" });
      setJoining(false);
      if (!res?.ok) setJoinError(res?.error || "Impossible de rejoindre cette salle.");
    }

    return (
      <div className="standalone-card">
        <div className="eyebrow">Rejoindre</div>
        <h2>Salle {code}</h2>
        <p className="hint">Entrez votre nom pour rejoindre cette séance synchronisée.</p>
        <form onSubmit={handleSubmit} className="standalone-form">
          <input
            type="text"
            placeholder="Votre nom"
            value={joinName}
            onChange={(e) => setJoinName(e.target.value)}
            className="text-input"
            autoFocus
          />
          <button className="btn btn-primary" type="submit" disabled={joining}>
            {joining ? "…" : "Rejoindre →"}
          </button>
        </form>
        {joinError && <p className="form-error">{joinError}</p>}
      </div>
    );
  }

  return (
    <section>
      <TopBar />
      {role === "guest" && <GuestBanner />}
      <div className="room-grid">
        <Stage />
        <div className="side-col">
          <ParticipantsPanel />
          <ChatPanel />
        </div>
      </div>
    </section>
  );
}
