import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from "react";
import { io } from "socket.io-client";
import { getStoredServerUrl, setStoredServerUrl } from "../lib/api";

const RoomContext = createContext(null);

const initialState = {
  serverUrl: getStoredServerUrl(),
  connected: false,
  error: null,
  role: null,
  name: "",
  code: null,
  videoUrl: null,
  videoName: null,
  participants: [],
  chat: [],
  reactions: [],
  reactionCounts: {},
  createdAt: null,
  initialPlayback: null,
  roomClosed: null,
  lastSyncCommand: null,
  lastCorrection: null,
  lastAckDriftMs: null,
  selfId: null,
};

function reducer(state, action) {
  switch (action.type) {
    case "SET_SERVER_URL":
      return { ...state, serverUrl: action.url };
    case "CONNECTED":
      return { ...state, connected: true, error: null };
    case "DISCONNECTED":
      return { ...state, connected: false };
    case "ERROR":
      return { ...state, error: action.error };
    case "ENTERED_ROOM":
      return {
        ...state,
        role: action.role,
        name: action.name,
        code: action.state.code,
        videoUrl: action.state.videoUrl,
        videoName: action.state.videoName,
        participants: action.state.participants,
        chat: action.state.chat || [],
        initialPlayback: {
          position: action.state.position,
          isPlaying: action.state.isPlaying,
          rate: action.state.rate,
        },
        createdAt: action.state.createdAt,
        roomClosed: null,
        error: null,
      };
    case "LEFT_ROOM":
      return { ...initialState, serverUrl: state.serverUrl };
    case "PARTICIPANTS":
      return { ...state, participants: action.participants };
    case "CHAT_MESSAGE":
      return { ...state, chat: [...state.chat, action.message].slice(-200) };
    case "CHAT_SYSTEM":
      return {
        ...state,
        chat: [...state.chat, { system: true, text: action.text, ts: Date.now(), id: `sys-${Date.now()}` }].slice(
          -200
        ),
      };
    case "REACTION": {
      const id = `${Date.now()}-${Math.random()}`;
      const reactionCounts = {
        ...state.reactionCounts,
        [action.reaction.emoji]: (state.reactionCounts[action.reaction.emoji] || 0) + 1,
      };
      return { ...state, reactions: [...state.reactions, { ...action.reaction, id }], reactionCounts };
    }
    case "REACTION_EXPIRE":
      return { ...state, reactions: state.reactions.filter((r) => r.id !== action.id) };
    case "SYNC_COMMAND":
      return { ...state, lastSyncCommand: action.command };
    case "SYNC_CORRECTION":
      return { ...state, lastCorrection: action.correction };
    case "SYNC_ACK":
      return { ...state, lastAckDriftMs: action.driftMs };
    case "ROOM_CLOSED":
      return { ...state, roomClosed: action.reason };
    case "SELF_ID":
      return { ...state, selfId: action.id };
    default:
      return state;
  }
}

export function RoomProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const socketRef = useRef(null);

  const ensureSocket = useCallback(() => {
    if (socketRef.current) return socketRef.current;
    const socket = io(state.serverUrl, { autoConnect: true, transports: ["websocket", "polling"] });
    socketRef.current = socket;

    socket.on("connect", () => {
      dispatch({ type: "CONNECTED" });
      dispatch({ type: "SELF_ID", id: socket.id });
    });
    socket.on("disconnect", () => dispatch({ type: "DISCONNECTED" }));
    socket.on("connect_error", (err) => dispatch({ type: "ERROR", error: err.message }));

    socket.on("participants:update", ({ participants }) => dispatch({ type: "PARTICIPANTS", participants }));
    socket.on("chat:message", (message) => dispatch({ type: "CHAT_MESSAGE", message }));
    socket.on("chat:system", ({ text }) => dispatch({ type: "CHAT_SYSTEM", text }));
    socket.on("chat:reaction", (reaction) => dispatch({ type: "REACTION", reaction }));
    socket.on("sync:command", (command) => dispatch({ type: "SYNC_COMMAND", command }));
    socket.on("sync:correction", (correction) => dispatch({ type: "SYNC_CORRECTION", correction }));
    socket.on("sync:ack", ({ driftMs }) => dispatch({ type: "SYNC_ACK", driftMs }));
    socket.on("room:closed", ({ reason }) => dispatch({ type: "ROOM_CLOSED", reason }));

    return socket;
  }, [state.serverUrl]);

  useEffect(() => {
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
      dispatch({ type: "DISCONNECTED" });
    }
    ensureSocket();
    return () => {
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, [state.serverUrl]);

  useEffect(() => {
    if (state.reactions.length === 0) return;
    const timers = state.reactions.map((r) =>
      setTimeout(() => dispatch({ type: "REACTION_EXPIRE", id: r.id }), 2600)
    );
    return () => timers.forEach(clearTimeout);
  }, [state.reactions]);

  const setServerUrl = useCallback((url) => {
    setStoredServerUrl(url);
    dispatch({ type: "SET_SERVER_URL", url });
  }, []);

  const createRoom = useCallback(
    ({ name, videoUrl, videoName }) =>
      new Promise((resolve) => {
        const socket = ensureSocket();
        const doEmit = () =>
          socket.emit("create-room", { name, videoUrl, videoName }, (res) => {
            if (res?.ok) dispatch({ type: "ENTERED_ROOM", role: "presenter", name, state: res.state });
            else dispatch({ type: "ERROR", error: res?.error || "Impossible de créer la salle." });
            resolve(res);
          });
        socket.connected ? doEmit() : socket.once("connect", doEmit);
      }),
    [ensureSocket]
  );

  const joinRoom = useCallback(
    ({ code, name }) =>
      new Promise((resolve) => {
        const socket = ensureSocket();
        const doEmit = () =>
          socket.emit("join-room", { code: code.toUpperCase().trim(), name }, (res) => {
            if (res?.ok) dispatch({ type: "ENTERED_ROOM", role: "guest", name, state: res.state });
            else dispatch({ type: "ERROR", error: res?.error || "Impossible de rejoindre la salle." });
            resolve(res);
          });
        socket.connected ? doEmit() : socket.once("connect", doEmit);
      }),
    [ensureSocket]
  );

  const leaveRoom = useCallback(() => {
    socketRef.current?.emit("leave-room");
    dispatch({ type: "LEFT_ROOM" });
  }, []);

  const sendCommand = useCallback((command) => {
    socketRef.current?.emit("presenter:command", command);
  }, []);

  const pingPosition = useCallback((position) => {
    socketRef.current?.emit("guest:ping", { position });
  }, []);

  const sendChat = useCallback((text) => {
    socketRef.current?.emit("chat:message", { text });
  }, []);

  const sendReaction = useCallback((emoji) => {
    socketRef.current?.emit("chat:reaction", { emoji });
  }, []);

  const value = useMemo(
    () => ({
      ...state,
      setServerUrl,
      createRoom,
      joinRoom,
      leaveRoom,
      sendCommand,
      pingPosition,
      sendChat,
      sendReaction,
    }),
    [state, setServerUrl, createRoom, joinRoom, leaveRoom, sendCommand, pingPosition, sendChat, sendReaction]
  );

  return <RoomContext.Provider value={value}>{children}</RoomContext.Provider>;
}

export function useRoom() {
  const ctx = useContext(RoomContext);
  if (!ctx) throw new Error("useRoom must be used within a RoomProvider");
  return ctx;
}
