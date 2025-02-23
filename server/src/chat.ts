import { differenceInMilliseconds, formatISO } from "date-fns";
import { Server } from "socket.io";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { ChatMessage } from "./chat-message.entity.js";
import { ChatRoomService } from "./chat-room-service.js";
import { ChatRoom } from "./chat-room.entity.js";
import { CHAT_ROOMS, ChatUser } from "./chat-rooms.js";
import { id } from "date-fns/locale";

const service = new ChatRoomService();

const joinSchema = z.object({
  roomId: z.number().positive(),
  name: z.string().min(1).max(20),
  uuid: z.string().uuid().optional()
});

const heartbeatSchema = z.object({
  roomId: z.number().positive(),
  name: z.string().min(1).max(20)
});

const messageSchema = z.object({
  name: z.string().min(1).max(20),
  message: z.string().min(1).max(500),
  privateMessage: z.boolean(),
  target: z.string().min(1).max(20).optional()
});

const blockSchema = z.object({
  name: z.string().min(1).max(20),
  target: z.string().min(1).max(20)
});

const logoutSchema = z.object({
  roomId: z.number().positive(),
  name: z.string().min(1).max(20)
});

export const initChat = (io: Server) => {
  const emitPeople = (roomId: number, users: Map<string, ChatUser>) => {
    io.to(`${roomId}`).emit("people", [
      { id: "-1", name: "Everyone", blocked: [] },
      ...Array.from(users.values()).map((user) => ({
        ...user,
        blocked: Array.from(user.blocked)
      }))
    ]);
  };

  const saveChatMessage = async (
    chatRoom: ChatRoom,
    {
      sender,
      message,
      dateTime,
      receiver,
      privateMessage = false
    }: {
      sender: string;
      message: string;
      dateTime: Date;
      receiver?: string;
      privateMessage?: boolean;
    }
  ) => {
    const chatMessage = new ChatMessage();

    chatMessage.sender = sender;
    chatMessage.message = message;
    chatMessage.dateTime = dateTime;

    if (receiver) {
      chatMessage.receiver = receiver;
    }

    chatMessage.private = privateMessage;

    chatMessage.room = chatRoom;

    return service.saveMessage(chatMessage);
  };

  const INACTIVITY_TIMEOUT = 90000;
  const CHECK_INTERVAL = 30000;

  const purgeInterval = setInterval(async () => {
    for (const [roomId, users] of CHAT_ROOMS.allRooms) {
      for (const [userId, user] of users) {
        if (
          differenceInMilliseconds(new Date(), user.lastSeen) >
          INACTIVITY_TIMEOUT
        ) {
          users.delete(userId);

          if (users.size === 0) {
            CHAT_ROOMS.deleteRoom(roomId);
          }

          emitPeople(roomId, users);

          const dateTime = new Date();

          const chatRoom = (await service.findById(roomId)) as ChatRoom;

          const savedChatMessage = await saveChatMessage(chatRoom, {
            sender: "CHAT",
            message: `${user.name} exited the room...`,
            dateTime
          });

          io.to(`${roomId}`).emit("message", {
            id: savedChatMessage.id,
            sender: "Chat",
            message: `${user.name} exited the room...`,
            dateTime: formatISO(dateTime)
          });
        }
      }
    }
  }, CHECK_INTERVAL);

  const shutdown = () => {
    clearInterval(purgeInterval);
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  io.on("connection", (socket) => {
    socket.on("join", async ({ roomId, name, uuid }, callback) => {
      const result = joinSchema.safeParse({ roomId, name, uuid });

      if (!result.success) {
        return callback({ error: "Invalid input!" });
      }

      const chatRoom = await service.findById(roomId);

      if (!chatRoom) {
        return callback({ error: "Invalid room!" });
      }

      socket.join(`${roomId}`);

      const users = CHAT_ROOMS.getUsers(roomId);

      const userExists = uuid
        ? Array.from(users.values()).some(
            (user) => user.name === name && user.uuid !== uuid
          )
        : users.has(name);

      if (userExists) {
        callback({ error: "User already exists!" });
        return socket.disconnect();
      }

      let user: ChatUser | undefined;

      if (uuid) {
        user = CHAT_ROOMS.getUserByUuid(roomId, uuid);
      }

      if (user) {
        const messages = await service.getMessages(
          roomId,
          user.name,
          user.joined
        );

        io.to(socket.id).emit(
          "message",
          messages.map((m) => ({
            id: m.id,
            sender: m.sender === "CHAT" ? "Chat" : m.sender,
            message: m.message,
            dateTime: formatISO(m.dateTime),
            receiver: m.receiver,
            private: m.private
          }))
        );
      } else {
        const dateTime = new Date();

        const savedChatMessage = await saveChatMessage(chatRoom, {
          sender: "CHAT",
          message: `${name} entered the room...`,
          dateTime: dateTime
        });

        io.to(`${roomId}`).emit("message", {
          id: savedChatMessage.id,
          sender: "Chat",
          message: `${name} entered the room...`,
          dateTime: formatISO(dateTime)
        });
      }

      const newUuid = uuid ?? uuidv7();
      const newDate = new Date();

      if (user) {
        user.id = socket.id;
        user.name = name;
        user.uuid = newUuid;
        user.lastSeen = newDate;

        users.set(name, {
          id: socket.id,
          name,
          blocked: user.blocked,
          uuid: newUuid,
          joined: user.joined,
          lastSeen: newDate
        });
      } else {
        users.set(name, {
          id: socket.id,
          name,
          blocked: new Set<string>(),
          uuid: newUuid,
          joined: newDate,
          lastSeen: newDate
        });
      }

      CHAT_ROOMS.addRoom(roomId, users);

      emitPeople(roomId, users);

      if (user) {
        io.to(socket.id).emit("updateUser", {
          id: user.id,
          name: user.name,
          blocked: Array.from(user.blocked),
          uuid: user.uuid
        });
      } else {
        io.to(socket.id).emit("updateUser", {
          id: socket.id,
          name,
          blocked: [],
          uuid: newUuid
        });
      }

      callback();
    });

    socket.on("heartbeat", ({ roomId, name }, callback) => {
      const result = heartbeatSchema.safeParse({ roomId, name });

      if (!result.success) {
        return callback({ error: "Invalid input!" });
      }

      const users = CHAT_ROOMS.getUsers(roomId);

      if (!users) {
        return;
      }

      const user = users.get(name);

      if (!user) {
        return;
      }

      user.lastSeen = new Date();
    });

    socket.on(
      "message",
      async ({ name, roomId, message, privateMessage, target }, callback) => {
        const result = messageSchema.safeParse({
          name,
          message,
          privateMessage,
          target
        });

        if (!result.success) {
          return callback({ error: "Invalid input!" });
        }

        const chatRoom = await service.findById(roomId);

        if (!chatRoom) {
          return callback({ error: "Invalid room!" });
        }

        const users = CHAT_ROOMS.getUsers(roomId);

        if (!users) {
          return;
        }

        const sender = users.get(name);

        if (!sender) {
          return;
        }

        const recipient = users.get(target);

        const dateTime = new Date();
        const dateTimeString = formatISO(dateTime);

        if (privateMessage && recipient) {
          const savedChatMessage = await saveChatMessage(chatRoom, {
            sender: sender.name,
            message,
            dateTime,
            receiver: recipient.name,
            privateMessage: true
          });

          io.to(sender.id).emit("message", {
            id: savedChatMessage.id,
            sender: sender.name,
            message: message,
            dateTime: dateTimeString,
            receiver: recipient.name,
            private: true
          });

          if (
            sender.blocked.has(recipient.name) ||
            recipient.blocked.has(sender.name)
          ) {
            return;
          }

          io.to(recipient.id).emit("message", {
            id: savedChatMessage.id,
            sender: sender.name,
            message: message,
            dateTime: dateTimeString,
            receiver: recipient.name,
            private: true
          });
        } else {
          const savedChatMessage = await saveChatMessage(chatRoom, {
            sender: sender.name,
            message,
            dateTime,
            receiver: target
          });

          io.to(sender.id).emit("message", {
            id: savedChatMessage.id,
            sender: sender.name,
            message,
            dateTime: dateTimeString,
            receiver: target
          });

          for (const [, user] of users) {
            if (sender.name === user.name) {
              continue;
            }

            if (recipient) {
              if (
                sender.blocked.has(recipient.name) ||
                recipient.blocked.has(sender.name) ||
                sender.blocked.has(user.name) ||
                user.blocked.has(sender.name)
              ) {
                continue;
              }
            } else {
              if (
                sender.blocked.has(user.name) ||
                user.blocked.has(sender.name)
              ) {
                continue;
              }
            }

            io.to(user.id).emit("message", {
              id: savedChatMessage.id,
              sender: sender.name,
              message,
              dateTime: dateTimeString,
              receiver: target
            });
          }
        }
      }
    );

    socket.on("block", ({ roomId, name, target }, callback) => {
      const result = blockSchema.safeParse({ name, target });

      if (!result.success) {
        return callback({ error: "Invalid input!" });
      }

      const users = CHAT_ROOMS.getUsers(roomId);

      if (!users) {
        return;
      }

      const user = users.get(name);

      if (!user) {
        return;
      }

      const targetUser = users.get(target);

      if (!targetUser) {
        return;
      }

      if (user.blocked.has(targetUser.name)) {
        user.blocked.delete(targetUser.name);
      } else {
        user.blocked.add(targetUser.name);
      }

      io.to(user.id).emit("updateUser", {
        id: user.id,
        name: user.name,
        blocked: Array.from(user.blocked),
        uuid: user.uuid
      });

      emitPeople(roomId, users);
    });

    socket.on("logout", async ({ roomId, name }, callback) => {
      const result = logoutSchema.safeParse({ roomId, name });

      if (!result.success) {
        return callback({ error: "Invalid input!" });
      }

      const chatRoom = await service.findById(roomId);

      if (!chatRoom) {
        return;
      }

      const users = CHAT_ROOMS.getUsers(roomId);

      if (!users) {
        return;
      }

      const user = users.get(name);

      if (!user) {
        return;
      }

      users.delete(name);

      if (users.size === 0) {
        CHAT_ROOMS.deleteRoom(roomId);
      }

      emitPeople(roomId, users);

      const dateTime = new Date();

      const savedChatMessage = await saveChatMessage(chatRoom, {
        sender: "CHAT",
        message: `${name} exited the room...`,
        dateTime
      });

      io.to(`${roomId}`).emit("message", {
        id: savedChatMessage.id,
        sender: "Chat",
        message: `${name} exited the room...`,
        dateTime: formatISO(dateTime)
      });

      callback();
    });
  });
};
