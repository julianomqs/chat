import { randomBytes, randomUUID } from "node:crypto";
import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import type { Collection, Db, WithId } from "mongodb";
import {
  ROOMS,
  type ActionResult,
  type ChatEvent,
  type ChatUser,
  type ClientToServerEvents,
  type EnterRoomPayload,
  type RoomId,
  type RoomSummary,
  type SelectRecipientPayload,
  type SendMessagePayload,
  type ServerToClientEvents,
  type SessionMode,
  type SessionReady,
  type SpyRoomPayload
} from "./types.js";

export interface SessionDocument {
  token: string;
  nick: string | null;
  nickNormalizado: string | null;
  cor: string | null;
  sala: RoomId;
  modo: SessionMode;
  enteredAt: Date;
  leftAt: Date | null;
  selectedRecipient: string | null;
}

export interface MessageDocument {
  sala: RoomId;
  tipo: ChatEvent["type"];
  remetente: string;
  destinatario: string;
  reservada: boolean;
  texto: string;
  createdAt: Date;
}

export interface ChatServerOptions {
  db: Db;
  disconnectGraceMs?: number;
  adminApiToken?: string;
}

interface ActiveSession extends SessionDocument {
  socketId: string | null;
  disconnectTimer: ReturnType<typeof setTimeout> | null;
}

type ChatSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

const nicknameNormalize = (value: string): string =>
  value.trim().replace(/\s+/gu, " ").toLocaleLowerCase("pt-BR");
const cleanNickname = (value: string): string =>
  value.trim().replace(/\s+/gu, " ");
const isRoom = (room: string): room is RoomId =>
  ROOMS.some((candidate) => candidate.id === room);
const isColor = (color: string): boolean => /^#[0-9A-Fa-f]{6}$/u.test(color);
const resultError = (error: string): ActionResult => ({ ok: false, error });

export class ChatServer {
  readonly io: Server<ClientToServerEvents, ServerToClientEvents>;
  readonly sessions: Collection<SessionDocument>;
  readonly messages: Collection<MessageDocument>;
  readonly activeSessions = new Map<string, ActiveSession>();
  readonly nickReservations = new Map<string, string>();
  private readonly disconnectGraceMs: number;
  private isClosing = false;

  constructor(httpServer: HttpServer, options: ChatServerOptions) {
    this.sessions = options.db.collection<SessionDocument>("sessions");
    this.messages = options.db.collection<MessageDocument>("messages");
    this.disconnectGraceMs = options.disconnectGraceMs ?? 10_000;
    this.io = new Server<ClientToServerEvents, ServerToClientEvents>(
      httpServer
    );
    this.io.on("connection", (socket) => this.registerSocket(socket));
  }

  initialize = async (): Promise<void> => {
    await Promise.all([
      this.sessions.createIndex({ token: 1 }, { unique: true }),
      this.sessions.createIndex({ sala: 1, nickNormalizado: 1, leftAt: 1 }),
      this.messages.createIndex({ sala: 1, createdAt: 1 }),
      this.messages.createIndex({
        sala: 1,
        remetente: 1,
        destinatario: 1,
        reservada: 1
      })
    ]);

    const abandoned = await this.sessions.find({ leftAt: null }).toArray();
    const restartedAt = new Date();
    const leaveRecords = abandoned
      .filter((session) => session.modo === "participant" && session.nick)
      .map((session) => ({
        sala: session.sala,
        tipo: "leave" as const,
        remetente: session.nick ?? "",
        destinatario: "Todos",
        reservada: false,
        texto: `${session.nick ?? "Usuário"} saiu do chat`,
        createdAt: restartedAt
      }));

    if (leaveRecords.length > 0) {
      await this.messages.insertMany(leaveRecords);
    }

    await this.sessions.updateMany(
      { leftAt: null },
      { $set: { leftAt: restartedAt } }
    );
    this.activeSessions.clear();
    this.nickReservations.clear();
  };

  roomSummaries = (): RoomSummary[] => {
    return ROOMS.map((room) => ({
      ...room,
      count: [...this.activeSessions.values()].filter(
        (session) => session.sala === room.id && session.modo === "participant"
      ).length
    }));
  };

  close = (): void => {
    this.isClosing = true;

    for (const session of this.activeSessions.values()) {
      if (session.disconnectTimer) {
        clearTimeout(session.disconnectTimer);
      }
    }

    this.io.close();
  };

  private registerSocket = (socket: ChatSocket): void => {
    socket.emit("rooms:update", this.roomSummaries());
    socket.on("room:enter", (payload, ack) => {
      void this.enter(socket, payload, ack);
    });
    socket.on("room:spy", (payload, ack) => {
      void this.spy(socket, payload, ack);
    });
    socket.on("session:resume", (payload, ack) => {
      void this.resume(socket, payload.token, ack);
    });
    socket.on("session:leave", (ack) => {
      const session = this.sessionForSocket(socket);

      if (!session) {
        return ack(resultError("Você não está em uma sala."));
      }

      void this.finalizeSession(session, true)
        .then(() => ack({ ok: true }))
        .catch((error: unknown) => {
          console.error("Falha ao finalizar sessão", error);
          ack(resultError("Não foi possível sair da sala."));
        });
    });
    socket.on("chat:send", (payload, ack) => {
      void this.sendMessage(socket, payload, ack);
    });
    socket.on("chat:select-recipient", (payload) => {
      this.selectRecipient(socket, payload);
    });
    socket.on("disconnect", () => this.handleDisconnect(socket));
  };

  private enter = async (
    socket: ChatSocket,
    payload: EnterRoomPayload,
    ack: (result: ActionResult) => void
  ): Promise<void> => {
    if (this.sessionForSocket(socket)) {
      return ack(resultError("Este socket já possui uma sessão ativa."));
    }

    const room = typeof payload.room === "string" ? payload.room : "";

    if (!isRoom(room)) {
      return ack(resultError("Sala inválida."));
    }

    const nick = cleanNickname(
      typeof payload.nick === "string" ? payload.nick : ""
    );

    if (nick.length < 1 || nick.length > 20) {
      return ack(resultError("O apelido deve ter entre 1 e 20 caracteres."));
    }

    if (nicknameNormalize(nick) === "todos") {
      return ack(resultError("Este apelido não está disponível."));
    }

    if (typeof payload.color !== "string" || !isColor(payload.color)) {
      return ack(resultError("Escolha uma cor válida no formato #RRGGBB."));
    }

    const nickNormalizado = nicknameNormalize(nick);
    const reservationKey = `${room}:${nickNormalizado}`;

    if (this.nickReservations.has(reservationKey)) {
      return ack(resultError("Este apelido já está em uso nesta sala."));
    }

    // Nick validation and reservation happen synchronously before any await.
    const token = randomBytes(32).toString("hex");
    const now = new Date();
    const session: ActiveSession = {
      token,
      nick,
      nickNormalizado,
      cor: payload.color,
      sala: room,
      modo: "participant",
      enteredAt: now,
      leftAt: null,
      selectedRecipient: null,
      socketId: socket.id,
      disconnectTimer: null
    };

    this.nickReservations.set(reservationKey, token);
    this.activeSessions.set(token, session);

    let sessionPersisted = false;
    let socketJoinedRoom = false;

    try {
      await this.sessions.insertOne(this.toDocument(session));
      sessionPersisted = true;
      socket.join(room);
      socketJoinedRoom = true;

      const event = this.makeEvent(session, "join", `${nick} entrou no chat`);

      await this.persistAndBroadcast(event);
      socket.emit("session:ready", this.toSessionReady(session));
      this.broadcastRoomState(room);
      this.broadcastRoomSummaries();
      ack({ ok: true });
    } catch (error) {
      session.leftAt = new Date();
      this.activeSessions.delete(token);
      this.nickReservations.delete(reservationKey);

      if (socketJoinedRoom) {
        socket.leave(room);
      }

      if (sessionPersisted) {
        try {
          await this.sessions.updateOne(
            { token },
            { $set: { leftAt: session.leftAt } }
          );
        } catch (rollbackError) {
          console.error("Falha ao reverter sessão", rollbackError);
        }
      }

      ack(resultError("Não foi possível entrar na sala. Tente novamente."));
      console.error("Falha ao criar sessão", error);
    }
  };

  private spy = async (
    socket: ChatSocket,
    payload: SpyRoomPayload,
    ack: (result: ActionResult) => void
  ): Promise<void> => {
    if (this.sessionForSocket(socket)) {
      return ack(resultError("Este socket já possui uma sessão ativa."));
    }

    const room = typeof payload.room === "string" ? payload.room : "";

    if (!isRoom(room)) {
      return ack(resultError("Sala inválida."));
    }

    const now = new Date();
    const session: ActiveSession = {
      token: randomBytes(32).toString("hex"),
      nick: null,
      nickNormalizado: null,
      cor: null,
      sala: room,
      modo: "spy",
      enteredAt: now,
      leftAt: null,
      selectedRecipient: null,
      socketId: socket.id,
      disconnectTimer: null
    };

    this.activeSessions.set(session.token, session);

    try {
      await this.sessions.insertOne(this.toDocument(session));
      socket.join(room);
      socket.emit("session:ready", this.toSessionReady(session));
      ack({ ok: true });
    } catch (error) {
      this.activeSessions.delete(session.token);
      ack(resultError("Não foi possível entrar em modo espiar."));
      console.error("Falha ao criar sessão de espião", error);
    }
  };

  private resume = async (
    socket: ChatSocket,
    token: string,
    ack: (result: ActionResult) => void
  ): Promise<void> => {
    if (typeof token !== "string") {
      return ack(resultError("Sessão inválida ou expirada."));
    }

    const socketSession = this.sessionForSocket(socket);

    if (socketSession && socketSession.token !== token) {
      return ack(resultError("Este socket já possui outra sessão ativa."));
    }

    const session = this.activeSessions.get(token);

    if (!session || session.leftAt !== null) {
      socket.emit("session:invalid", "Sessão inválida ou expirada.");

      return ack(resultError("Sessão inválida ou expirada."));
    }

    if (session.disconnectTimer) {
      clearTimeout(session.disconnectTimer);
    }

    session.disconnectTimer = null;

    const previousSocketId = session.socketId;

    session.socketId = socket.id;

    if (previousSocketId && previousSocketId !== socket.id) {
      this.io.sockets.sockets.get(previousSocketId)?.disconnect(true);
    }

    socket.join(session.sala);
    socket.emit("session:ready", this.toSessionReady(session));

    if (session.modo === "participant") {
      this.broadcastRoomState(session.sala);
    }

    this.broadcastRoomSummaries();
    ack({ ok: true });
  };

  private sendMessage = async (
    socket: ChatSocket,
    payload: SendMessagePayload,
    ack: (result: ActionResult) => void
  ): Promise<void> => {
    const session = this.sessionForSocket(socket);

    if (!session) {
      return ack(resultError("Sua sessão não está ativa."));
    }

    if (session.modo === "spy") {
      return ack(resultError("O modo espiar é somente para leitura."));
    }

    if (typeof payload.text !== "string") {
      return ack(resultError("Mensagem inválida."));
    }

    const text = payload.text.trim();

    if (text.length < 1 || text.length > 200) {
      return ack(resultError("A mensagem deve ter entre 1 e 200 caracteres."));
    }

    if (
      typeof payload.recipient !== "string" ||
      payload.recipient.trim() === ""
    ) {
      return ack(resultError("Selecione um destinatário válido."));
    }

    const recipient = payload.recipient.trim();

    if (payload.private && nicknameNormalize(recipient) === "todos") {
      return ack(
        resultError("Não é possível enviar mensagem reservada para Todos.")
      );
    }

    let recipientSession: ActiveSession | undefined;

    if (nicknameNormalize(recipient) !== "todos") {
      const targetNormalized = nicknameNormalize(recipient);

      recipientSession = [...this.activeSessions.values()].find(
        (candidate) =>
          candidate.sala === session.sala &&
          candidate.modo === "participant" &&
          candidate.nickNormalizado === targetNormalized &&
          candidate.leftAt === null
      );

      if (!recipientSession) {
        return ack(resultError("Este usuário não está mais na sala."));
      }
    }

    const event: ChatEvent = {
      id: randomUUID(),
      room: session.sala,
      type: "message",
      sender: session.nick ?? "",
      senderColor: session.cor ?? "#000000",
      recipient,
      private: payload.private,
      text,
      createdAt: new Date().toISOString()
    };

    try {
      await this.messages.insertOne({
        sala: event.room,
        tipo: event.type,
        remetente: event.sender,
        destinatario: event.recipient,
        reservada: event.private,
        texto: event.text,
        createdAt: new Date(event.createdAt)
      });

      if (event.private && recipientSession) {
        this.emitToSession(session, event);

        if (recipientSession.token !== session.token) {
          this.emitToSession(recipientSession, event);
        }
      } else {
        this.io.to(session.sala).emit("chat:event", event);
      }

      ack({ ok: true });
    } catch (error) {
      ack(resultError("Não foi possível enviar a mensagem."));
      console.error("Falha ao persistir mensagem", error);
    }
  };

  private selectRecipient = (
    socket: ChatSocket,
    payload: SelectRecipientPayload
  ): void => {
    const session = this.sessionForSocket(socket);

    if (!session || session.modo !== "participant") {
      return;
    }

    if (
      payload.recipient === null ||
      nicknameNormalize(payload.recipient) === "todos"
    ) {
      session.selectedRecipient = null;
      void this.sessions
        .updateOne(
          { token: session.token },
          { $set: { selectedRecipient: null } }
        )
        .catch((error: unknown) => {
          console.error("Falha ao persistir destinatário", error);
        });

      return;
    }

    const targetNormalized = nicknameNormalize(payload.recipient);
    const target = [...this.activeSessions.values()].find(
      (candidate) =>
        candidate.sala === session.sala &&
        candidate.modo === "participant" &&
        candidate.nickNormalizado === targetNormalized &&
        candidate.token !== session.token
    );

    if (!target?.nick) {
      return;
    }

    session.selectedRecipient = target.nick;
    void this.sessions
      .updateOne(
        { token: session.token },
        { $set: { selectedRecipient: target.nick } }
      )
      .catch((error: unknown) => {
        console.error("Falha ao persistir destinatário", error);
      });
  };

  private handleDisconnect = (socket: ChatSocket): void => {
    if (this.isClosing) {
      return;
    }

    const session = this.sessionForSocket(socket);

    if (!session) {
      return;
    }

    session.socketId = null;
    session.disconnectTimer = setTimeout(() => {
      if (session.socketId === null) {
        void this.finalizeSession(session, true).catch((error: unknown) => {
          console.error("Falha ao finalizar sessão desconectada", error);
        });
      }
    }, this.disconnectGraceMs);
  };

  private finalizeSession = async (
    session: ActiveSession,
    emitLeave: boolean
  ): Promise<void> => {
    if (session.leftAt !== null) {
      return;
    }

    const leftAt = new Date();

    session.leftAt = leftAt;

    const leaveEvent =
      emitLeave && session.modo === "participant" && session.nick
        ? this.makeEvent(session, "leave", `${session.nick} saiu do chat`)
        : null;

    if (leaveEvent) {
      leaveEvent.createdAt = leftAt.toISOString();
    }

    if (session.disconnectTimer) {
      clearTimeout(session.disconnectTimer);
    }

    session.disconnectTimer = null;

    if (session.socketId) {
      this.io.sockets.sockets.get(session.socketId)?.leave(session.sala);
    }

    if (
      session.modo === "participant" &&
      session.nick &&
      session.nickNormalizado
    ) {
      this.nickReservations.delete(
        `${session.sala}:${session.nickNormalizado}`
      );

      for (const remaining of this.activeSessions.values()) {
        if (
          remaining.sala === session.sala &&
          remaining.modo === "participant" &&
          nicknameNormalize(remaining.selectedRecipient ?? "") ===
            session.nickNormalizado
        ) {
          remaining.selectedRecipient = null;
          void this.sessions
            .updateOne(
              { token: remaining.token },
              { $set: { selectedRecipient: null } }
            )
            .catch((error: unknown) => {
              console.error("Falha ao limpar destinatário", error);
            });
        }
      }
    }

    this.activeSessions.delete(session.token);
    await this.sessions.updateOne(
      { token: session.token },
      { $set: { leftAt: session.leftAt } }
    );

    if (leaveEvent) {
      await this.persistAndBroadcast(leaveEvent);
      this.broadcastRoomState(session.sala);
    }

    this.broadcastRoomSummaries();
  };

  private persistAndBroadcast = async (event: ChatEvent): Promise<void> => {
    await this.messages.insertOne({
      sala: event.room,
      tipo: event.type,
      remetente: event.sender,
      destinatario: event.recipient,
      reservada: event.private,
      texto: event.text,
      createdAt: new Date(event.createdAt)
    });
    this.io.to(event.room).emit("chat:event", event);
  };

  private makeEvent = (
    session: ActiveSession,
    type: "join" | "leave",
    text: string
  ): ChatEvent => {
    return {
      id: randomUUID(),
      room: session.sala,
      type,
      sender: session.nick ?? "",
      senderColor: session.cor ?? "#000000",
      recipient: "Todos",
      private: false,
      text,
      createdAt: new Date().toISOString()
    };
  };

  private emitToSession = (session: ActiveSession, event: ChatEvent): void => {
    if (session.socketId) {
      this.io.to(session.socketId).emit("chat:event", event);
    }
  };

  private sessionForSocket = (
    socket: ChatSocket
  ): ActiveSession | undefined => {
    return [...this.activeSessions.values()].find(
      (session) => session.socketId === socket.id
    );
  };

  private usersInRoom = (room: RoomId): ChatUser[] => {
    return [...this.activeSessions.values()]
      .filter(
        (session) =>
          session.sala === room &&
          session.modo === "participant" &&
          session.nick
      )
      .map((session) => ({
        nick: session.nick as string,
        color: session.cor ?? "#000000"
      }));
  };

  private broadcastRoomState = (room: RoomId): void => {
    this.io
      .to(room)
      .emit("room:users", { room, users: this.usersInRoom(room) });
  };

  private broadcastRoomSummaries = (): void => {
    this.io.emit("rooms:update", this.roomSummaries());
  };

  private toSessionReady = (session: ActiveSession): SessionReady => {
    return {
      token: session.token,
      room: session.sala,
      mode: session.modo,
      self: session.nick
        ? { nick: session.nick, color: session.cor ?? "#000000" }
        : null,
      selectedRecipient: session.selectedRecipient,
      users: this.usersInRoom(session.sala)
    };
  };

  private toDocument = (session: ActiveSession): SessionDocument => {
    return {
      token: session.token,
      nick: session.nick,
      nickNormalizado: session.nickNormalizado,
      cor: session.cor,
      sala: session.sala,
      modo: session.modo,
      enteredAt: session.enteredAt,
      leftAt: session.leftAt,
      selectedRecipient: session.selectedRecipient
    };
  };
}

export const userConversation = async (
  sessions: Collection<SessionDocument>,
  messages: Collection<MessageDocument>,
  nick: string,
  room: RoomId
): Promise<WithId<MessageDocument>[]> => {
  const normalized = nicknameNormalize(nick);
  const userSessions = await sessions
    .find({ sala: room, nickNormalizado: normalized })
    .toArray();

  if (userSessions.length === 0) {
    return [];
  }

  const windows = userSessions.map((session) => ({
    createdAt: {
      $gte: session.enteredAt,
      $lte: session.leftAt ?? new Date()
    }
  }));

  return messages
    .find({
      sala: room,
      $and: [
        { $or: windows },
        {
          $or: [
            { tipo: { $in: ["join", "leave"] } },
            { reservada: false },
            { remetente: { $regex: `^${escapeRegex(nick)}$`, $options: "i" } },
            {
              destinatario: { $regex: `^${escapeRegex(nick)}$`, $options: "i" }
            }
          ]
        }
      ]
    })
    .sort({ createdAt: 1 })
    .toArray();
};

const escapeRegex = (value: string): string => {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
};
