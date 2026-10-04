import { timingSafeEqual } from "node:crypto";
import express, { type Express } from "express";
import type { Db } from "mongodb";
import { createServer, type Server as HttpServer } from "node:http";
import {
  ChatServer,
  userConversation,
  type ChatServerOptions
} from "./chat-server.js";
import { ROOMS, type RoomId } from "./types.js";

export interface RunningChatServer {
  app: Express;
  httpServer: HttpServer;
  chat: ChatServer;
  close: () => Promise<void>;
}

const isAdminAuthorized = (
  authorization: string | undefined,
  expectedToken: string | undefined
): boolean => {
  if (!authorization || !expectedToken) {
    return false;
  }

  const match = /^Bearer\s+(.+)$/iu.exec(authorization);

  if (!match?.[1]) {
    return false;
  }

  const provided = Buffer.from(match[1]);
  const expected = Buffer.from(expectedToken);

  return (
    provided.length === expected.length && timingSafeEqual(provided, expected)
  );
};

export const createChatServer = async (
  db: Db,
  options: Partial<Omit<ChatServerOptions, "db">> = {}
): Promise<RunningChatServer> => {
  const app = express();

  app.use(express.json());
  app.get("/health", (_request, response) => response.json({ status: "ok" }));

  const httpServer = createServer(app);
  const chat = new ChatServer(httpServer, { db, ...options });

  await chat.initialize();

  const adminApiToken = options.adminApiToken ?? process.env.ADMIN_API_TOKEN;

  app.get("/api/rooms", (_request, response) =>
    response.json(chat.roomSummaries())
  );
  app.get("/api/admin/users/:nick/conversation", async (request, response) => {
    if (!isAdminAuthorized(request.get("authorization"), adminApiToken)) {
      response
        .status(401)
        .json({ error: "Autenticação administrativa inválida." });

      return;
    }

    const room = request.query.room;

    if (
      typeof room !== "string" ||
      !ROOMS.some((candidate) => candidate.id === room)
    ) {
      response.status(400).json({ error: "Informe uma sala válida em room." });

      return;
    }

    try {
      const messages = await userConversation(
        db.collection("sessions"),
        db.collection("messages"),
        request.params.nick,
        room as RoomId
      );

      response.json(messages);
    } catch (error) {
      console.error("Falha ao consultar conversa", error);
      response
        .status(500)
        .json({ error: "Não foi possível consultar a conversa." });
    }
  });

  return {
    app,
    httpServer,
    chat,
    close: async () => {
      chat.close();

      if (httpServer.listening) {
        await new Promise<void>((resolve, reject) => {
          httpServer.close((error) => (error ? reject(error) : resolve()));
        });
      }
    }
  };
};
