import { useEffect, useRef, useState } from "react";
import { useRoom } from "../context/RoomContext.jsx";
import { formatClock } from "../lib/format.js";

const ICON_SEND = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M22 2L11 13" />
    <path d="M22 2l-7 20-4-9-9-4 20-7z" />
  </svg>
);

const EMOJIS = ["👍", "🔥", "😂", "👏", "❤️"];

export default function ChatPanel() {
  const { chat, reactionCounts, name, role, sendChat, sendReaction } = useRoom();
  const [text, setText] = useState("");
  const listRef = useRef(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [chat]);

  function handleSubmit(e) {
    e.preventDefault();
    if (!text.trim()) return;
    sendChat(text);
    setText("");
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <h4>Chat &amp; réactions</h4>
      </div>

      <div className="reactions-row">
        {EMOJIS.map((emoji) => (
          <button key={emoji} type="button" className="react-pill" onClick={() => sendReaction(emoji)}>
            {emoji} <b>{reactionCounts[emoji] || 0}</b>
          </button>
        ))}
      </div>

      <div className="chat-list" ref={listRef}>
        {chat.length === 0 && <div className="chat-empty">Aucun message pour l'instant.</div>}
        {chat.map((m) =>
          m.system ? (
            <div className="msg msg-system" key={m.id}>
              — {m.text} —
            </div>
          ) : (
            <div className="msg" key={m.id}>
              <span className={`who ${m.name === name && m.role === role ? "me" : ""}`}>{m.name}</span>
              <span className="time">{formatClock(m.ts)}</span>
              <br />
              {m.text}
            </div>
          )
        )}
      </div>

      <form className="chat-input" onSubmit={handleSubmit}>
        <input
          type="text"
          placeholder="Écrire un message…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button className="send-btn" type="submit" aria-label="Envoyer">
          {ICON_SEND}
        </button>
      </form>
    </div>
  );
}
