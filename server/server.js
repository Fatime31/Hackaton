import express from "express";
import http from "http";
import path from "path";
import fs from "fs";
import os from "os";
import { fileURLToPath } from "url";
import cors from "cors";
import multer from "multer";
import { Server } from "socket.io";
import {
  createRoom,
  getRoom,
  deleteRoom,
  addParticipant,
  removeParticipant,
  applyPresenterCommand,
  evaluateGuestPing,
  publicState,
  publicParticipants,
  pushChatMessage,
  isEmpty,
  expectedPosition,
} from "./rooms.js";
import {
  recordRoomCreated,
  recordRoomClosed,
  recordParticipantJoined,
  recordParticipantLeft,
  recordMessage,
  recordEvent,
  getRoomHistory,
  getEventLogs,
  listRecentRooms,
} from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4000;
const UPLOAD_DIR = path.join(__dirname, "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(UPLOAD_DIR));

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, "_");
    cb(null, `${Date.now()}-${safe}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 1024 * 1024 * 1024 } }); 

function buildAnalyticsPayload(roomCode) {
  const history = getRoomHistory(roomCode);
  if (!history) return null;
  const logs = getEventLogs(roomCode);
  return {
    metadata: history.room,
    participants: history.participants,
    messages: history.messages,
    logs: logs.map((l) => ({
      user_id: l.socket_id,
      event_type: l.event_type,
      position_sec: l.position_sec,
      event_time: l.event_time,
    })),
  };
}

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.get("/api/rooms", (_req, res) => {
  res.json({ rooms: listRecentRooms(100) });
});

app.get("/api/rooms/:code", (req, res) => {
  const history = getRoomHistory(req.params.code.toUpperCase());
  if (!history) return res.status(404).json({ error: "Salle inconnue." });
  res.json(history);
});

app.post("/api/upload", upload.single("video"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Aucun fichier reçu." });
  res.json({
    url: `/uploads/${req.file.filename}`,
    name: req.file.originalname,
  });
});

app.get("/api/analytics/:code", (req, res) => {
  const payload = buildAnalyticsPayload(req.params.code.toUpperCase());
  if (!payload) return res.status(404).json({ error: "Salle inconnue." });
  res.json(payload);
});


app.post("/api/analytics/:code/resend", async (req, res) => {
  const code = req.params.code.toUpperCase();
  if (!ANALYTICS_WEBHOOK_URL) {
    return res.status(400).json({ error: "ANALYTICS_WEBHOOK_URL n'est pas configurée." });
  }
  const payload = buildAnalyticsPayload(code);
  if (!payload) return res.status(404).json({ error: "Salle inconnue." });
  await sendAnalyticsWebhook(code);
  res.json({ ok: true });
});

const clientDist = path.join(__dirname, "..", "client", "dist");
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/uploads")) return next();
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

function broadcastParticipants(roomCode) {
  const room = getRoom(roomCode);
  if (!room) return;
  io.to(roomCode).emit("participants:update", { participants: publicParticipants(room) });
}

function broadcastChat(roomCode, message) {
  io.to(roomCode).emit("chat:message", message);
}


const ANALYTICS_WEBHOOK_URL = process.env.ANALYTICS_WEBHOOK_URL ?? "http://172.16.1.103:5174";
const ANALYTICS_WEBHOOK_SECRET = null;

async function postOnce(payload) {
  const res = await fetch(ANALYTICS_WEBHOOK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(ANALYTICS_WEBHOOK_SECRET ? { "X-Webhook-Secret": ANALYTICS_WEBHOOK_SECRET } : {}),
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

async function sendAnalyticsWebhook(roomCode) {
  if (!ANALYTICS_WEBHOOK_URL) return;

  const payload = buildAnalyticsPayload(roomCode);
  if (!payload) return;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await postOnce(payload);
      console.log(`✓ Données de la salle ${roomCode} envoyées à l'équipe d'analyse (tentative ${attempt}).`);
      return;
    } catch (e) {
      console.error(`✗ Échec de l'envoi (tentative ${attempt}/2) pour la salle ${roomCode} :`, e.message);
      if (attempt === 1) await new Promise((r) => setTimeout(r, 2000));
    }
  }
  console.error(
    `→ Abandon pour ${roomCode}. Les données restent disponibles via GET /api/analytics/${roomCode}.`
  );
}

async function leaveCurrentRoom(socket) {
  const { roomCode } = socket.data;
  if (!roomCode) return;
  const room = getRoom(roomCode);
  if (!room) return;

  const wasPresenter = room.presenterId === socket.id;
  removeParticipant(room, socket.id);
  socket.leave(roomCode);
  recordParticipantLeft(roomCode, socket.id);

  if (wasPresenter) {
    io.to(roomCode).emit("room:closed", { reason: "Le présentateur a quitté la salle." });
    recordRoomClosed(roomCode);
    sendAnalyticsWebhook(roomCode);
    deleteRoom(roomCode);
  } else {
    broadcastParticipants(roomCode);
  }

  if (getRoom(roomCode) && isEmpty(getRoom(roomCode))) {
    deleteRoom(roomCode);
  }

  socket.data.roomCode = null;
  socket.data.role = null;
}

io.on("connection", (socket) => {
  socket.data = {};

  socket.on("create-room", ({ name, videoUrl, videoName } = {}, callback) => {
    const room = createRoom({
      presenterSocketId: socket.id,
      presenterName: name,
      videoUrl,
      videoName,
    });
    socket.join(room.code);
    socket.data.roomCode = room.code;
    socket.data.role = "presenter";

    recordRoomCreated(room.code, { videoUrl, videoName, presenterName: name });
    recordParticipantJoined(room.code, socket.id, name || "Présentateur", "presenter");

    callback?.({ ok: true, role: "presenter", state: publicState(room) });
  });

  socket.on("join-room", ({ code, name } = {}, callback) => {
    const room = getRoom(code);
    if (!room) {
      callback?.({ ok: false, error: "Cette salle n'existe pas (ou plus)." });
      return;
    }
    addParticipant(room, socket.id, name);
    socket.join(room.code);
    socket.data.roomCode = room.code;
    socket.data.role = "guest";

    recordParticipantJoined(room.code, socket.id, name || "Invité", "guest");

    callback?.({ ok: true, role: "guest", state: publicState(room) });
    broadcastParticipants(room.code);
    io.to(room.code).emit("chat:system", { text: `${name || "Un invité"} a rejoint la salle.` });
  });


  socket.on("presenter:command", (cmd = {}) => {
    const room = getRoom(socket.data.roomCode);
    if (!room || room.presenterId !== socket.id) return;
    const seq = applyPresenterCommand(room, cmd);
    recordEvent(room.code, socket.id, cmd.type, room.position); 
    socket.to(room.code).emit("sync:command", {
      type: cmd.type,
      position: room.position,
      isPlaying: room.isPlaying,
      rate: room.rate,
      videoUrl: room.videoUrl,
      videoName: room.videoName,
      seq,
      serverTime: Date.now(),
    });
  });

  socket.on("guest:ping", ({ position } = {}) => {
    const room = getRoom(socket.data.roomCode);
    if (!room || typeof position !== "number") return;
    recordEvent(room.code, socket.id, "ping", position);
    const result = evaluateGuestPing(room, socket.id, position);
    if (!result) return;

    if (result.mode) {
      socket.emit("sync:correction", {
        mode: result.mode,
        position: result.expected,
        rate: room.rate,
        isPlaying: room.isPlaying,
        direction: result.drift > 0 ? "ahead" : "behind",
      });
    } else {
      socket.emit("sync:ack", { driftMs: Math.round(result.absDrift * 1000) });
    }
    broadcastParticipants(room.code);
  });


  socket.on("chat:message", ({ text } = {}) => {
    const room = getRoom(socket.data.roomCode);
    if (!room || !text?.trim()) return;
    const participant = room.participants.get(socket.id);
    const message = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: participant?.name || "—",
      role: participant?.role || "guest",
      text: text.trim().slice(0, 500),
      ts: Date.now(),
    };
    pushChatMessage(room, message);
    recordMessage(room.code, { name: message.name, role: message.role, kind: "chat", text: message.text });
    broadcastChat(room.code, message);
  });

  socket.on("chat:reaction", ({ emoji } = {}) => {
    const room = getRoom(socket.data.roomCode);
    if (!room || !emoji) return;
    const participant = room.participants.get(socket.id);
    const name = participant?.name || "—";
    recordMessage(room.code, { name, role: participant?.role || "guest", kind: "reaction", text: emoji });
    io.to(room.code).emit("chat:reaction", { emoji, name });
  });

  socket.on("leave-room", () => leaveCurrentRoom(socket).catch(console.error));
  socket.on("disconnect", () => leaveCurrentRoom(socket).catch(console.error));
});

server.listen(PORT, () => {
  const nets = os.networkInterfaces();
  const lanIps = Object.values(nets)
    .flat()
    .filter((n) => n && n.family === "IPv4" && !n.internal)
    .map((n) => n.address);

  console.log(`\nWatch Together — serveur de synchro\n`);
  console.log(`  Local   → http://localhost:${PORT}`);
  lanIps.forEach((ip) => console.log(`  Réseau  → http://${ip}:${PORT}`));
  console.log(`\nPartagez l'adresse "Réseau" avec vos invités sur le même Wi-Fi/LAN.\n`);
});
