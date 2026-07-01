// Persistence layer — SQLite via Node's built-in `node:sqlite` module
// (Node 22+, no native compilation needed, no extra dependency to install).
//
// IMPORTANT — what goes in the database vs. what stays in memory:
//
//   - In memory (see rooms.js): the live playback state (isPlaying, position,
//     rate, per-guest drift). This changes dozens of times per minute per
//     room and must be read/written with near-zero latency for the sync
//     protocol to feel instant — a database round-trip on every play/pause/
//     seek or every 2s ping would add lag for no benefit, since nobody needs
//     to query "what frame was guest X on 4 seconds ago".
//
//   - In SQLite (this file): the durable, low-frequency, business-relevant
//     data — rooms, who presented/attended, and the chat log. This is what
//     an external system would actually want to query later (history,
//     analytics, audit). Writes here happen a handful of times per room
//     (creation, join, leave, chat message), not dozens of times per second.
//
// This split is the standard pattern for realtime apps: an in-memory/cache
// layer for hot state, a database for the record of what happened.

import { DatabaseSync } from "node:sqlite";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, "watch-together.db");

export const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS rooms (
    code            TEXT PRIMARY KEY,
    video_url       TEXT,
    video_name      TEXT,
    presenter_name  TEXT,
    created_at      INTEGER NOT NULL,
    closed_at       INTEGER
  );

  CREATE TABLE IF NOT EXISTS participants (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    room_code   TEXT NOT NULL REFERENCES rooms(code),
    socket_id   TEXT NOT NULL,
    name        TEXT NOT NULL,
    role        TEXT NOT NULL CHECK (role IN ('presenter','guest')),
    joined_at   INTEGER NOT NULL,
    left_at     INTEGER
  );

  CREATE TABLE IF NOT EXISTS messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    room_code   TEXT NOT NULL REFERENCES rooms(code),
    name        TEXT NOT NULL,
    role        TEXT NOT NULL,
    kind        TEXT NOT NULL CHECK (kind IN ('chat','reaction')),
    text        TEXT NOT NULL,
    created_at  INTEGER NOT NULL
  );

  -- Granular per-event log (every play/pause/seek/rate command, every guest
  -- ping), kept separate from the messages table since it is much higher
  -- volume and serves a different purpose: detailed analytics for an
  -- external team, not display in the app itself.
  CREATE TABLE IF NOT EXISTS event_logs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    room_code     TEXT NOT NULL REFERENCES rooms(code),
    socket_id     TEXT NOT NULL,
    event_type    TEXT NOT NULL,
    position_sec  REAL,
    event_time    INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_participants_room ON participants(room_code);
  CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room_code);
  CREATE INDEX IF NOT EXISTS idx_event_logs_room ON event_logs(room_code);
`);

const stmts = {
  insertRoom: db.prepare(
    `INSERT INTO rooms (code, video_url, video_name, presenter_name, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ),
  closeRoom: db.prepare(`UPDATE rooms SET closed_at = ? WHERE code = ?`),
  insertParticipant: db.prepare(
    `INSERT INTO participants (room_code, socket_id, name, role, joined_at)
     VALUES (?, ?, ?, ?, ?)`
  ),
  markParticipantLeft: db.prepare(
    `UPDATE participants SET left_at = ?
     WHERE room_code = ? AND socket_id = ? AND left_at IS NULL`
  ),
  insertMessage: db.prepare(
    `INSERT INTO messages (room_code, name, role, kind, text, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ),
  getRoom: db.prepare(`SELECT * FROM rooms WHERE code = ?`),
  listRooms: db.prepare(`SELECT * FROM rooms ORDER BY created_at DESC LIMIT ?`),
  listParticipants: db.prepare(`SELECT * FROM participants WHERE room_code = ? ORDER BY joined_at ASC`),
  listMessages: db.prepare(`SELECT * FROM messages WHERE room_code = ? ORDER BY created_at ASC`),
  insertEvent: db.prepare(
    `INSERT INTO event_logs (room_code, socket_id, event_type, position_sec, event_time)
     VALUES (?, ?, ?, ?, ?)`
  ),
  listEvents: db.prepare(`SELECT * FROM event_logs WHERE room_code = ? ORDER BY event_time ASC`),
};

// ---- public API used by server.js -----------------------------------------

export function recordRoomCreated(code, { videoUrl, videoName, presenterName }) {
  stmts.insertRoom.run(code, videoUrl || null, videoName || null, presenterName || null, Date.now());
}

export function recordRoomClosed(code) {
  stmts.closeRoom.run(Date.now(), code);
}

export function recordParticipantJoined(code, socketId, name, role) {
  stmts.insertParticipant.run(code, socketId, name, role, Date.now());
}

export function recordParticipantLeft(code, socketId) {
  stmts.markParticipantLeft.run(Date.now(), code, socketId);
}

export function recordMessage(code, { name, role, kind, text }) {
  stmts.insertMessage.run(code, name, role, kind, text, Date.now());
}

export function getRoomHistory(code) {
  const room = stmts.getRoom.get(code);
  if (!room) return null;
  return {
    room,
    participants: stmts.listParticipants.all(code),
    messages: stmts.listMessages.all(code),
  };
}

export function listRecentRooms(limit = 50) {
  return stmts.listRooms.all(limit);
}

export function recordEvent(code, socketId, type, position) {
  stmts.insertEvent.run(code, socketId, type, position, Date.now());
}

export function getEventLogs(code) {
  return stmts.listEvents.all(code);
}
