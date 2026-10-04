export const ROOMS = [
  { id: "papo-livre", name: "Papo Livre" },
  { id: "musica", name: "Música" },
  { id: "esportes", name: "Esportes" },
  { id: "cinema", name: "Cinema" },
  { id: "amizade", name: "Amizade" },
  { id: "tecnologia", name: "Tecnologia" },
  { id: "viagens", name: "Viagens" },
  { id: "games", name: "Games" }
] as const;

export type RoomId = (typeof ROOMS)[number]["id"];
export type SessionMode = "participant" | "spy";

export interface ChatUser {
  nick: string;
  color: string;
}

export interface RoomSummary {
  id: RoomId;
  name: string;
  count: number;
}

export interface ChatEvent {
  id: string;
  room: RoomId;
  type: "message" | "join" | "leave";
  sender: string;
  senderColor: string;
  recipient: string;
  private: boolean;
  text: string;
  createdAt: string;
}

export interface SessionReady {
  token: string;
  room: RoomId;
  mode: SessionMode;
  self: ChatUser | null;
  selectedRecipient: string | null;
  users: ChatUser[];
}

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export interface ClientToServerEvents {
  "room:enter": (
    payload: { room: RoomId; nick: string; color: string },
    ack: (result: ActionResult) => void
  ) => void;
  "room:spy": (
    payload: { room: RoomId },
    ack: (result: ActionResult) => void
  ) => void;
  "session:resume": (
    payload: { token: string },
    ack: (result: ActionResult) => void
  ) => void;
  "session:leave": (ack: (result: ActionResult) => void) => void;
  "chat:send": (
    payload: { text: string; recipient: string; private: boolean },
    ack: (result: ActionResult) => void
  ) => void;
  "chat:select-recipient": (payload: { recipient: string | null }) => void;
}

export interface ServerToClientEvents {
  "rooms:update": (rooms: RoomSummary[]) => void;
  "room:users": (payload: { room: RoomId; users: ChatUser[] }) => void;
  "session:ready": (session: SessionReady) => void;
  "session:invalid": (message: string) => void;
  "chat:event": (event: ChatEvent) => void;
  "chat:error": (message: string) => void;
}
