import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MongoClient } from "mongodb";
import {
  io as createClient,
  type Socket as ClientSocket
} from "socket.io-client";
import { randomUUID } from "node:crypto";
import type {
  ActionResult,
  ChatEvent,
  ClientToServerEvents,
  ServerToClientEvents,
  SessionReady
} from "./types.js";
import { createChatServer, type RunningChatServer } from "./server.js";

type TestSocket = ClientSocket<ServerToClientEvents, ClientToServerEvents>;

const mongoUri =
  process.env.MONGODB_URI ??
  "mongodb://chat:chat-dev-password@127.0.0.1:27017/?authSource=admin";
const adminHeaders = { authorization: "Bearer test-admin-token" };
let mongo: MongoClient;
let app: RunningChatServer;
let clients: TestSocket[];
let baseUrl: string;
let testDbName: string;

const connectClient = (): Promise<TestSocket> => {
  const client = createClient(baseUrl, { autoConnect: false, forceNew: true });

  clients.push(client);

  return new Promise((resolve, reject) => {
    client.once("connect", () => resolve(client));
    client.once("connect_error", reject);
    client.connect();
  });
};

const waitForEvent = <T>(
  client: TestSocket,
  event: "session:ready"
): Promise<T> => {
  return new Promise((resolve) =>
    client.once(event, (payload) => resolve(payload as T))
  );
};

const emitWithAck = (
  client: TestSocket,
  event:
    | "room:enter"
    | "room:spy"
    | "session:resume"
    | "chat:send"
    | "session:leave",
  payload?: unknown
): Promise<ActionResult> => {
  return new Promise((resolve) => {
    if (event === "session:leave") {
      client.emit(event, resolve);
    } else {
      client.emit(event, payload as never, resolve);
    }
  });
};

const enterParticipant = async (
  nick: string,
  color = "#336699",
  client?: TestSocket
): Promise<{ client: TestSocket; session: SessionReady }> => {
  const socket = client ?? (await connectClient());
  const ready = waitForEvent<SessionReady>(socket, "session:ready");
  const result = await emitWithAck(socket, "room:enter", {
    room: "papo-livre",
    nick,
    color
  });

  expect(result.ok).toBe(true);

  return { client: socket, session: await ready };
};

const enterSpy = async (): Promise<{
  client: TestSocket;
  session: SessionReady;
}> => {
  const client = await connectClient();
  const ready = waitForEvent<SessionReady>(client, "session:ready");
  const result = await emitWithAck(client, "room:spy", { room: "papo-livre" });

  expect(result.ok).toBe(true);

  return { client, session: await ready };
};

const eventLog = (client: TestSocket): ChatEvent[] => {
  const events: ChatEvent[] = [];

  client.on("chat:event", (event) => events.push(event));

  return events;
};

const eventually = async (
  assertion: () => void | Promise<void>,
  timeout = 1_000
): Promise<void> => {
  const deadline = Date.now() + timeout;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      await assertion();

      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  throw lastError;
};

describe("chat Socket.io com MongoDB real", () => {
  beforeEach(async () => {
    mongo = new MongoClient(mongoUri);
    await mongo.connect();
    testDbName = `batepapo_test_${randomUUID().replaceAll("-", "")}`;

    const db = mongo.db(testDbName);

    app = await createChatServer(db, {
      adminApiToken: "test-admin-token",
      disconnectGraceMs: 10_000
    });
    await new Promise<void>((resolve) =>
      app.httpServer.listen(0, "127.0.0.1", resolve)
    );

    const address = app.httpServer.address();

    if (!address || typeof address === "string") {
      throw new Error("Porta de teste indisponível.");
    }

    baseUrl = `http://127.0.0.1:${address.port}`;
    clients = [];
  });

  afterEach(async () => {
    for (const client of clients) {
      client.disconnect();
    }

    await app.close();
    await mongo.db(testDbName).dropDatabase();
    await mongo.close();
  });

  it("expõe saúde, salas e valida a rota administrativa", async () => {
    const health = await fetch(`${baseUrl}/health`);
    const healthResult = (await health.json()) as { status: string };

    expect(healthResult.status).toBe("ok");

    const roomsResponse = await fetch(`${baseUrl}/api/rooms`);
    const rooms = (await roomsResponse.json()) as Array<{
      id: string;
      count: number;
    }>;

    expect(rooms).toHaveLength(8);
    expect(rooms[0]).toMatchObject({ id: "papo-livre", count: 0 });

    const unauthorized = await fetch(
      `${baseUrl}/api/admin/users/Alice/conversation?room=papo-livre`,
      { headers: { authorization: "Bearer token-incorreto" } }
    );

    expect(unauthorized.status).toBe(401);

    const invalidRoom = await fetch(
      `${baseUrl}/api/admin/users/Alice/conversation?room=desconhecida`,
      { headers: adminHeaders }
    );

    expect(invalidRoom.status).toBe(400);

    const active = await enterParticipant("Conversa Ativa");
    const activeConversation = await fetch(
      `${baseUrl}/api/admin/users/Conversa%20Ativa/conversation?room=papo-livre`,
      { headers: adminHeaders }
    );

    expect(activeConversation.ok).toBe(true);
    expect(await activeConversation.json()).toMatchObject([
      { remetente: "Conversa Ativa", tipo: "join" }
    ]);
    expect(await emitWithAck(active.client, "session:leave")).toMatchObject({
      ok: true
    });

    const idleServer = await createChatServer(mongo.db(testDbName), {
      adminApiToken: "test-admin-token"
    });

    await idleServer.close();
  });

  it("rejeita nicks duplicados sem diferenciar maiúsculas e minúsculas, inclusive em entradas simultâneas", async () => {
    const first = await enterParticipant("Marcelo");
    const second = await connectClient();
    const duplicate = await emitWithAck(second, "room:enter", {
      room: "papo-livre",
      nick: "marcelo",
      color: "#123ABC"
    });

    expect(duplicate.ok).toBe(false);

    const contenders = await Promise.all([connectClient(), connectClient()]);
    const simultaneous = await Promise.all(
      contenders.map((client) =>
        emitWithAck(client, "room:enter", {
          room: "papo-livre",
          nick: "Ana Simultânea",
          color: "#123ABC"
        })
      )
    );

    expect(simultaneous.filter((result) => result.ok)).toHaveLength(1);
    expect(simultaneous.filter((result) => !result.ok)).toHaveLength(1);
    expect(first.session.self?.nick).toBe("Marcelo");
  });

  it("impede um socket de criar uma segunda sessão sem encerrar a primeira", async () => {
    const participant = await enterParticipant("Identidade Original");
    const otherParticipant = await enterParticipant("Sessão de Terceiro");
    const events = eventLog(participant.client);

    expect(
      await emitWithAck(participant.client, "room:enter", {
        room: "musica",
        nick: "Segunda Identidade",
        color: "#123456"
      })
    ).toMatchObject({ ok: false });

    expect(
      await emitWithAck(participant.client, "room:spy", { room: "musica" })
    ).toMatchObject({ ok: false });
    expect(
      await emitWithAck(participant.client, "session:resume", {
        token: otherParticipant.session.token
      })
    ).toMatchObject({ ok: false });
    expect(app.chat.activeSessions.size).toBe(2);
    expect(await app.chat.sessions.countDocuments({ leftAt: null })).toBe(2);
    expect(
      app.chat.roomSummaries().find((room) => room.id === "musica")?.count
    ).toBe(0);

    expect(
      await emitWithAck(participant.client, "chat:send", {
        text: "identidade estável",
        recipient: "Todos",
        private: false
      })
    ).toMatchObject({ ok: true });
    await eventually(() => expect(events).toHaveLength(1));
    expect(events[0]?.sender).toBe("Identidade Original");
  });

  it("remove espaços externos e colapsa espaços repetidos sem alterar a capitalização exibida", async () => {
    const first = await enterParticipant("  Nome   Com   Espaços  ");

    expect(first.session.self?.nick).toBe("Nome Com Espaços");
    expect(
      await emitWithAck(await connectClient(), "room:enter", {
        room: "papo-livre",
        nick: "nome com espaços",
        color: "#123456"
      })
    ).toMatchObject({ ok: false });
  });

  it("entrega mensagem reservada apenas ao remetente e ao destinatário", async () => {
    const a = await enterParticipant("Alice");
    const b = await enterParticipant("Bruno");
    const c = await enterParticipant("Carla");
    const spy = await enterSpy();
    const eventsA = eventLog(a.client);
    const eventsB = eventLog(b.client);
    const eventsC = eventLog(c.client);
    const eventsSpy = eventLog(spy.client);
    const result = await emitWithAck(a.client, "chat:send", {
      text: "segredo entre nós",
      recipient: "Bruno",
      private: true
    });

    expect(result.ok).toBe(true);
    await eventually(() => {
      expect(eventsA).toHaveLength(1);
      expect(eventsB).toHaveLength(1);
    });
    expect(eventsA[0]?.private).toBe(true);
    expect(eventsB[0]?.text).toBe("segredo entre nós");
    expect(eventsC).toHaveLength(0);
    expect(eventsSpy).toHaveLength(0);
  });

  it("rejeita mensagem reservada para Todos", async () => {
    const a = await enterParticipant("Alice");

    expect(
      await emitWithAck(a.client, "chat:send", {
        text: "não pode",
        recipient: "Todos",
        private: true
      })
    ).toMatchObject({ ok: false });
  });

  it("cobre entradas e envios com payloads inválidos, sessão ausente e destinatário fora da sala", async () => {
    const client = await connectClient();

    for (const payload of [
      { room: "inexistente", nick: "Pessoa", color: "#123456" },
      { room: null, nick: "Pessoa", color: "#123456" },
      { room: "papo-livre", nick: "Todos", color: "#123456" },
      { room: "papo-livre", nick: null, color: "#123456" },
      { room: "papo-livre", nick: "Pessoa", color: null }
    ]) {
      expect(await emitWithAck(client, "room:enter", payload)).toMatchObject({
        ok: false
      });
    }

    for (const roomPayload of [{ room: "inexistente" }, { room: null }]) {
      expect(await emitWithAck(client, "room:spy", roomPayload)).toMatchObject({
        ok: false
      });
    }

    expect(
      await emitWithAck(client, "chat:send", {
        text: "sem sessão",
        recipient: "Todos",
        private: false
      })
    ).toMatchObject({ ok: false });
    client.emit("chat:select-recipient", { recipient: null });

    const user = await enterParticipant("Remetente", "#112233", client);

    for (const payload of [
      { text: 7, recipient: "Todos", private: false },
      { text: "válida", recipient: null, private: false },
      { text: "válida", recipient: "  ", private: false },
      { text: "válida", recipient: "Ausente", private: false },
      { text: "válida", recipient: "Todos", private: true }
    ]) {
      expect(
        await emitWithAck(user.client, "chat:send", payload)
      ).toMatchObject({ ok: false });
    }

    user.client.emit("chat:select-recipient", { recipient: "Ausente" });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(
      app.chat.activeSessions.get(user.session.token)?.selectedRecipient
    ).toBeNull();

    const unused = await connectClient();

    expect(await emitWithAck(unused, "session:leave")).toMatchObject({
      ok: false
    });
  });

  it("entrega pública para Todos e reservada ao próprio remetente uma única vez", async () => {
    const sender = await enterParticipant("Remetente");
    const recipient = await enterParticipant("Destinatário");
    const spy = await enterSpy();
    const publicEvents = [
      eventLog(sender.client),
      eventLog(recipient.client),
      eventLog(spy.client)
    ];

    expect(
      await emitWithAck(sender.client, "chat:send", {
        text: "público a todos",
        recipient: "Todos",
        private: false
      })
    ).toMatchObject({ ok: true });
    await eventually(() =>
      publicEvents.forEach((events) => expect(events).toHaveLength(1))
    );

    expect(publicEvents[2]?.[0]?.recipient).toBe("Todos");

    const privateEvents = eventLog(sender.client);

    expect(
      await emitWithAck(sender.client, "chat:send", {
        text: "nota para mim",
        recipient: "Remetente",
        private: true
      })
    ).toMatchObject({ ok: true });
    await eventually(() => expect(privateEvents).toHaveLength(1));

    expect(privateEvents[0]?.text).toBe("nota para mim");
  });

  it("persiste a seleção e a limpa quando o destinatário sai", async () => {
    const sender = await enterParticipant("Selecionador");
    const recipient = await enterParticipant("Selecionado");
    const senderSession = app.chat.activeSessions.get(sender.session.token);

    sender.client.emit("chat:select-recipient", { recipient: "Selecionado" });
    await eventually(() =>
      expect(senderSession?.selectedRecipient).toBe("Selecionado")
    );

    expect(
      await app.chat.sessions.findOne({ token: sender.session.token })
    ).toMatchObject({ selectedRecipient: "Selecionado" });
    expect(await emitWithAck(recipient.client, "session:leave")).toMatchObject({
      ok: true
    });
    await eventually(() => expect(senderSession?.selectedRecipient).toBeNull());

    expect(
      await app.chat.sessions.findOne({ token: sender.session.token })
    ).toMatchObject({ selectedRecipient: null });

    expect(
      await emitWithAck(sender.client, "chat:send", {
        text: "mensagem obsoleta",
        recipient: "Selecionado",
        private: false
      })
    ).toMatchObject({ ok: false });

    const otherRecipient = await enterParticipant("Outro Destinatário");

    sender.client.emit("chat:select-recipient", {
      recipient: "Outro Destinatário"
    });
    await eventually(() =>
      expect(senderSession?.selectedRecipient).toBe("Outro Destinatário")
    );
    sender.client.emit("chat:select-recipient", { recipient: "Todos" });
    await eventually(() => expect(senderSession?.selectedRecipient).toBeNull());
    await eventually(async () => {
      expect(
        await app.chat.sessions.findOne({ token: sender.session.token })
      ).toMatchObject({ selectedRecipient: null });
    });

    sender.client.emit("chat:select-recipient", {
      recipient: "Outro Destinatário"
    });
    await eventually(() =>
      expect(senderSession?.selectedRecipient).toBe("Outro Destinatário")
    );
    sender.client.emit("chat:select-recipient", { recipient: null });
    await eventually(() => expect(senderSession?.selectedRecipient).toBeNull());
    expect(
      await app.chat.sessions.findOne({ token: sender.session.token })
    ).toMatchObject({ selectedRecipient: null });
    expect(otherRecipient.session.self?.nick).toBe("Outro Destinatário");
  });

  it("cancela o timer de desconexão no encerramento do servidor", async () => {
    const participant = await enterParticipant("Desligando");
    const session = app.chat.activeSessions.get(participant.session.token);

    participant.client.disconnect();
    await eventually(() => expect(session?.disconnectTimer).not.toBeNull());
    app.chat.close();

    expect(session?.disconnectTimer).not.toBeNull();
  });

  it("finaliza uma sessão uma única vez mesmo se a finalização concorrer", async () => {
    const participant = await enterParticipant("Finalização Única");
    const observer = await enterParticipant("Observador Final");
    const observerEvents = eventLog(observer.client);
    const session = app.chat.activeSessions.get(participant.session.token);

    if (!session) {
      throw new Error("Sessão ativa do teste não encontrada.");
    }

    const internal = app.chat as unknown as {
      finalizeSession: (
        target: typeof session,
        emitLeave: boolean
      ) => Promise<void>;
    };

    await internal.finalizeSession(session, true);
    await internal.finalizeSession(session, true);
    await eventually(() =>
      expect(
        observerEvents.filter(
          (event) =>
            event.type === "leave" && event.sender === "Finalização Única"
        )
      ).toHaveLength(1)
    );
  });

  it("ignora um timeout de desconexão atrasado após a sessão reconectar", async () => {
    const participant = await enterParticipant("Corrida de Reconexão");
    const session = app.chat.activeSessions.get(participant.session.token);

    if (!session) {
      throw new Error("Sessão ativa do teste não encontrada.");
    }

    const socketId = participant.client.id;

    if (!socketId) {
      throw new Error("Socket do teste não conectado.");
    }

    let delayedTimeout: (() => void) | undefined;
    const internal = app.chat as unknown as {
      handleDisconnect: (socket: { id: string }) => void;
    };

    vi.spyOn(globalThis, "setTimeout").mockImplementation((callback) => {
      delayedTimeout = callback as () => void;

      return 1 as unknown as ReturnType<typeof setTimeout>;
    });

    try {
      internal.handleDisconnect({ id: socketId });
      session.socketId = "socket-reconectado";
      delayedTimeout?.();
    } finally {
      vi.restoreAllMocks();
    }

    expect(session.leftAt).toBeNull();
    expect(session.socketId).toBe("socket-reconectado");
  });

  it("rejeita falha ao fechar o servidor HTTP", async () => {
    const originalClose = app.httpServer.close.bind(app.httpServer);
    const originalChatClose = app.chat.close;

    app.chat.close = () => {};

    Object.defineProperty(app.httpServer, "close", {
      configurable: true,
      value: (callback: (error?: Error) => void) => {
        callback(new Error("Falha simulada ao fechar HTTP"));

        return app.httpServer;
      }
    });

    try {
      await expect(app.close()).rejects.toThrow(
        "Falha simulada ao fechar HTTP"
      );
    } finally {
      app.chat.close = originalChatClose;
      Object.defineProperty(app.httpServer, "close", {
        configurable: true,
        value: originalClose
      });
    }
  });

  it("rejeita tokens ausentes ou expirados e permite reload de espião", async () => {
    const client = await connectClient();
    const invalidEvents: string[] = [];

    client.on("session:invalid", (message) => invalidEvents.push(message));

    expect(
      await emitWithAck(client, "session:resume", { token: null })
    ).toMatchObject({ ok: false });
    expect(
      await emitWithAck(client, "session:resume", { token: "desconhecido" })
    ).toMatchObject({ ok: false });
    await eventually(() => expect(invalidEvents).toHaveLength(1));

    const spy = await enterSpy();
    const resumedClient = await connectClient();
    const ready = waitForEvent<SessionReady>(resumedClient, "session:ready");

    expect(
      await emitWithAck(resumedClient, "session:resume", {
        token: spy.session.token
      })
    ).toMatchObject({ ok: true });
    expect((await ready).mode).toBe("spy");

    const spyEvents = eventLog(resumedClient);

    expect(await emitWithAck(resumedClient, "session:leave")).toMatchObject({
      ok: true
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(spyEvents).toHaveLength(0);
  });

  it("recupera sessões participantes abandonadas na inicialização e consulta nick sem conversa", async () => {
    const enteredAt = new Date(Date.now() - 5_000);

    await app.chat.sessions.insertOne({
      token: "sessao-abandonada",
      nick: "Abandonado",
      nickNormalizado: "abandonado",
      cor: "#123456",
      sala: "papo-livre",
      modo: "participant",
      enteredAt,
      leftAt: null,
      selectedRecipient: null
    });
    await app.chat.sessions.insertOne({
      token: "espiao-abandonado",
      nick: null,
      nickNormalizado: null,
      cor: null,
      sala: "papo-livre",
      modo: "spy",
      enteredAt,
      leftAt: null,
      selectedRecipient: null
    });

    await app.chat.initialize();

    expect(
      await app.chat.messages.findOne({
        remetente: "Abandonado",
        tipo: "leave"
      })
    ).toMatchObject({ texto: "Abandonado saiu do chat" });
    expect(await app.chat.sessions.countDocuments({ leftAt: null })).toBe(0);

    const absentUser = await fetch(
      `${baseUrl}/api/admin/users/Nunca%20Entrou/conversation?room=papo-livre`,
      { headers: adminHeaders }
    );

    expect(await absentUser.json()).toEqual([]);
  });

  it("reverte sessões e retorna erros quando o Mongo falha ao persistir", async () => {
    const failOperations = new Set<string>();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = new Proxy(mongo.db(testDbName), {
      get(target, property) {
        if (property === "collection") {
          return (name: string) => {
            const collection = target.collection(name);

            return new Proxy(collection, {
              get(targetCollection, method, receiver) {
                if (
                  typeof method === "string" &&
                  failOperations.has(`${name}.${method}`)
                ) {
                  return () => {
                    throw new Error(`Falha simulada em ${name}.${method}`);
                  };
                }

                const value = Reflect.get(targetCollection, method, receiver);

                return typeof value === "function"
                  ? value.bind(targetCollection)
                  : value;
              }
            });
          };
        }

        const value = Reflect.get(target, property, target);

        return typeof value === "function" ? value.bind(target) : value;
      }
    });

    await app.close();
    app = await createChatServer(db, {
      adminApiToken: "test-admin-token",
      disconnectGraceMs: 30
    });
    await new Promise<void>((resolve) =>
      app.httpServer.listen(0, "127.0.0.1", resolve)
    );

    const address = app.httpServer.address();

    if (!address || typeof address === "string") {
      throw new Error("Porta de teste indisponível.");
    }

    baseUrl = `http://127.0.0.1:${address.port}`;
    clients = [];
    failOperations.add("sessions.insertOne");

    const participant = await connectClient();
    const failedEntry = await emitWithAck(participant, "room:enter", {
      room: "papo-livre",
      nick: "Persistência",
      color: "#123456"
    });

    expect(failedEntry).toMatchObject({ ok: false });
    expect(app.chat.activeSessions.size).toBe(0);

    failOperations.delete("sessions.insertOne");
    expect(
      await emitWithAck(participant, "room:enter", {
        room: "papo-livre",
        nick: "Persistência",
        color: "#123456"
      })
    ).toMatchObject({ ok: true });

    const participantEvents = eventLog(participant);
    const rejectedJoinSocket = await connectClient();
    const rejectedJoinEvents = eventLog(rejectedJoinSocket);

    failOperations.delete("sessions.insertOne");
    failOperations.add("messages.insertOne");

    expect(
      await emitWithAck(rejectedJoinSocket, "room:enter", {
        room: "papo-livre",
        nick: "Entrada Revertida",
        color: "#654321"
      })
    ).toMatchObject({ ok: false });
    expect(app.chat.activeSessions.size).toBe(1);
    expect(
      await app.chat.sessions.findOne({ nick: "Entrada Revertida" })
    ).toMatchObject({ leftAt: expect.any(Date) });
    expect(app.chat.roomSummaries()[0]?.count).toBe(1);

    failOperations.delete("messages.insertOne");

    expect(
      await emitWithAck(participant, "chat:send", {
        text: "sala continua limpa",
        recipient: "Todos",
        private: false
      })
    ).toMatchObject({ ok: true });
    await eventually(() => expect(participantEvents).toHaveLength(1));
    expect(rejectedJoinEvents).toHaveLength(0);

    const replacement = await enterParticipant("Entrada Revertida");

    expect(replacement.session.self?.nick).toBe("Entrada Revertida");

    failOperations.add("sessions.insertOne");

    const spy = await connectClient();

    expect(
      await emitWithAck(spy, "room:spy", { room: "papo-livre" })
    ).toMatchObject({ ok: false });

    failOperations.delete("sessions.insertOne");
    failOperations.add("messages.insertOne");

    expect(
      await emitWithAck(participant, "chat:send", {
        text: "não persistida",
        recipient: "Todos",
        private: false
      })
    ).toMatchObject({ ok: false });

    failOperations.add("sessions.find");

    const failedConversation = await fetch(
      `${baseUrl}/api/admin/users/Persistência/conversation?room=papo-livre`,
      { headers: adminHeaders }
    );

    expect(failedConversation.status).toBe(500);

    failOperations.delete("sessions.find");
    failOperations.add("sessions.updateOne");

    expect(await emitWithAck(participant, "session:leave")).toMatchObject({
      ok: false
    });

    replacement.client.disconnect();
    await eventually(() =>
      expect(errorSpy).toHaveBeenCalledWith(
        "Falha ao finalizar sessão desconectada",
        expect.any(Error)
      )
    );
    expect((await fetch(`${baseUrl}/health`)).ok).toBe(true);

    errorSpy.mockRestore();
  });

  it("mantém espião fora da lista e do contador e rejeita envio dele", async () => {
    const participant = await enterParticipant("Participante");
    const spy = await enterSpy();

    expect(spy.session.users.map((user) => user.nick)).toEqual([
      "Participante"
    ]);
    expect(
      app.chat.roomSummaries().find((room) => room.id === "papo-livre")?.count
    ).toBe(1);
    expect(
      await emitWithAck(spy.client, "chat:send", {
        text: "invasão",
        recipient: "Todos",
        private: false
      })
    ).toMatchObject({ ok: false });
    spy.client.emit("chat:select-recipient", { recipient: "Participante" });
    expect(
      app.chat.roomSummaries().find((room) => room.id === "papo-livre")?.count
    ).toBe(1);
    expect(participant.session.users).toHaveLength(1);
  });

  it("entrega mensagens públicas a participantes e espiões", async () => {
    const a = await enterParticipant("Alice");
    const b = await enterParticipant("Bruno");
    const spy = await enterSpy();
    const events = [
      eventLog(a.client),
      eventLog(b.client),
      eventLog(spy.client)
    ];
    const result = await emitWithAck(a.client, "chat:send", {
      text: "olá, sala!",
      recipient: "Bruno",
      private: false
    });

    expect(result.ok).toBe(true);
    await eventually(() =>
      events.forEach((received) => expect(received).toHaveLength(1))
    );
    expect(events[2]?.[0]?.text).toBe("olá, sala!");
  });

  it("retoma sessão com token sem evento de saída ou entrada", async () => {
    const a = await enterParticipant("Reconectando");
    const observer = await enterParticipant("Observador");
    const observerEvents = eventLog(observer.client);
    const token = a.session.token;

    a.client.emit("chat:select-recipient", { recipient: "Observador" });
    await eventually(() => {
      expect(app.chat.activeSessions.get(token)?.selectedRecipient).toBe(
        "Observador"
      );
    });
    a.client.disconnect();

    const replacement = await connectClient();
    const ready = waitForEvent<SessionReady>(replacement, "session:ready");

    expect(
      await emitWithAck(replacement, "session:resume", { token })
    ).toMatchObject({ ok: true });

    const resumed = await ready;

    expect(resumed.self?.nick).toBe("Reconectando");
    expect(resumed.selectedRecipient).toBe("Observador");
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(
      observerEvents.filter(
        (event) => event.type === "join" || event.type === "leave"
      )
    ).toHaveLength(0);
  });

  it("não entrega mensagem reservada a um socket desconectado durante a tolerância", async () => {
    const sender = await enterParticipant("Remetente Online");
    const recipient = await enterParticipant("Destinatário Offline");
    const senderEvents = eventLog(sender.client);
    const recipientEvents = eventLog(recipient.client);
    const token = recipient.session.token;

    recipient.client.disconnect();
    await eventually(() =>
      expect(app.chat.activeSessions.get(token)?.socketId).toBeNull()
    );

    expect(
      await emitWithAck(sender.client, "chat:send", {
        text: "enviada durante desconexão",
        recipient: "Destinatário Offline",
        private: true
      })
    ).toMatchObject({ ok: true });
    await eventually(() => expect(senderEvents).toHaveLength(1));

    expect(recipientEvents).toHaveLength(0);

    const resumedClient = await connectClient();
    const resumedEvents = eventLog(resumedClient);
    const ready = waitForEvent<SessionReady>(resumedClient, "session:ready");

    expect(
      await emitWithAck(resumedClient, "session:resume", { token })
    ).toMatchObject({ ok: true });
    expect((await ready).self?.nick).toBe("Destinatário Offline");
    expect(resumedEvents).toHaveLength(0);
  });

  it("encerra após a tolerância de 10 segundos e libera o nick", async () => {
    const first = await enterParticipant("Liberado");
    const observer = await enterParticipant("Testemunha");
    const observerEvents = eventLog(observer.client);

    first.client.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 10_150));
    await eventually(() => {
      expect(
        observerEvents.some(
          (event) => event.type === "leave" && event.sender === "Liberado"
        )
      ).toBe(true);
    });

    const conversationResponse = await fetch(
      `${baseUrl}/api/admin/users/Liberado/conversation?room=papo-livre`,
      { headers: adminHeaders }
    );
    const conversation = (await conversationResponse.json()) as Array<{
      tipo: string;
      remetente: string;
    }>;

    expect(conversationResponse.ok).toBe(true);
    expect(
      conversation.map(({ tipo, remetente }) => [tipo, remetente])
    ).toEqual([
      ["join", "Liberado"],
      ["join", "Testemunha"],
      ["leave", "Liberado"]
    ]);

    const reuse = await connectClient();

    expect(
      await emitWithAck(reuse, "room:enter", {
        room: "papo-livre",
        nick: "Liberado",
        color: "#998877"
      })
    ).toMatchObject({ ok: true });
  }, 15_000);

  it("valida apelido, cor e texto no servidor", async () => {
    const client = await connectClient();

    for (const nick of ["", "x".repeat(21)]) {
      expect(
        await emitWithAck(client, "room:enter", {
          room: "papo-livre",
          nick,
          color: "#123456"
        })
      ).toMatchObject({ ok: false });
    }

    expect(
      await emitWithAck(client, "room:enter", {
        room: "papo-livre",
        nick: "Cor Inválida",
        color: "red"
      })
    ).toMatchObject({ ok: false });

    const user = await enterParticipant("Validador", "#ABCDEF", client);

    for (const text of ["", " ".repeat(201), "x".repeat(201)]) {
      expect(
        await emitWithAck(user.client, "chat:send", {
          text,
          recipient: "Todos",
          private: false
        })
      ).toMatchObject({ ok: false });
    }
  });
});
