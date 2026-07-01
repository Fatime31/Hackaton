import { customAlphabet } from "nanoid";

// Room codes use an unambiguous alphabet (no 0/O, 1/I, etc.)
const makeCode = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 5);

// Drift thresholds, in seconds. Mirrors the documented protocol (see PROTOCOL.md).
export const SOFT_DRIFT_THRESHOLD = 0.15; // 150ms — eligible for a gentle playbackRate nudge
export const HARD_DRIFT_THRESHOLD = 0.3; // 300ms — eligible for a hard seek correction
export const PING_INTERVAL_MS = 2000; // expected client ping cadence (informational, enforced client-side)

/** @type {Map<string, Room>} */
const rooms = new Map();

function now() {
  return Date.now();
}

export function createRoom({ presenterSocketId, presenterName, videoUrl, videoName }) {
  let code = makeCode();
  while (rooms.has(code)) code = makeCode();

  const room = {
    code,
    videoUrl: videoUrl || null,
    videoName: videoName || null,
    isPlaying: false,
    position: 0, // authoritative position (seconds) as of `lastUpdate`
    lastUpdate: now(),
    rate: 1,
    presenterId: presenterSocketId,
    participants: new Map(), // socketId -> participant
    chat: [],
    seq: 0,
    createdAt: now(),
  };

  room.participants.set(presenterSocketId, {
    id: presenterSocketId,
    name: presenterName || "Présentateur",
    role: "presenter",
    drift: 0,
    status: "synced",
    joinedAt: now(),
  });

  rooms.set(code, room);
  return room;
}

export function getRoom(code) {
  return rooms.get((code || "").toUpperCase());
}

export function deleteRoom(code) {
  rooms.delete(code);
}

export function addParticipant(room, socketId, name) {
  room.participants.set(socketId, {
    id: socketId,
    name: name || "Invité",
    role: "guest",
    drift: 0,
    status: "synced",
    joinedAt: now(),
  });
}

export function removeParticipant(room, socketId) {
  room.participants.delete(socketId);
}

/** Authoritative position right now, accounting for elapsed time since lastUpdate. */
export function expectedPosition(room) {
  if (!room.isPlaying) return room.position;
  const elapsed = (now() - room.lastUpdate) / 1000;
  return room.position + elapsed * room.rate;
}

/** Apply a presenter command (play / pause / seek / rate / set-video) as the new source of truth. */
export function applyPresenterCommand(room, cmd) {
  const pos = typeof cmd.position === "number" ? cmd.position : expectedPosition(room);

  if (cmd.type === "play") {
    room.isPlaying = true;
    room.position = pos;
    room.lastUpdate = now();
  } else if (cmd.type === "pause") {
    room.isPlaying = false;
    room.position = pos;
    room.lastUpdate = now();
  } else if (cmd.type === "seek") {
    room.position = pos;
    room.lastUpdate = now();
  } else if (cmd.type === "rate") {
    room.position = pos; // freeze position at current point, then change rate
    room.lastUpdate = now();
    room.rate = cmd.rate || 1;
  } else if (cmd.type === "set-video") {
    room.videoUrl = cmd.videoUrl;
    room.videoName = cmd.videoName || null;
    room.isPlaying = false;
    room.position = 0;
    room.lastUpdate = now();
    room.rate = 1;
  }

  room.seq += 1;
  return room.seq;
}

/** Record a guest's reported position and compute its drift against the authoritative clock. */
export function evaluateGuestPing(room, socketId, reportedPosition) {
  const participant = room.participants.get(socketId);
  if (!participant) return null;

  const expected = expectedPosition(room);
  const drift = reportedPosition - expected; // signed: positive = guest ahead
  const absDrift = Math.abs(drift);

  let status = "synced";
  let mode = null;
  if (absDrift > HARD_DRIFT_THRESHOLD) {
    status = "resyncing";
    mode = "hard";
  } else if (absDrift > SOFT_DRIFT_THRESHOLD) {
    status = "adjusting";
    mode = "soft";
  }

  participant.drift = Math.round(absDrift * 1000); // ms
  participant.status = status;

  return { expected, drift, absDrift, mode, status };
}

export function publicParticipants(room) {
  return Array.from(room.participants.values()).map((p) => ({
    id: p.id,
    name: p.name,
    role: p.role,
    drift: p.drift,
    status: p.status,
  }));
}

export function publicState(room) {
  return {
    code: room.code,
    videoUrl: room.videoUrl,
    videoName: room.videoName,
    isPlaying: room.isPlaying,
    position: expectedPosition(room),
    rate: room.rate,
    presenterId: room.presenterId,
    participants: publicParticipants(room),
    chat: room.chat.slice(-50),
    seq: room.seq,
    createdAt: room.createdAt,
  };
}

export function pushChatMessage(room, message) {
  room.chat.push(message);
  if (room.chat.length > 200) room.chat.shift();
}

export function isEmpty(room) {
  return room.participants.size === 0;
}
