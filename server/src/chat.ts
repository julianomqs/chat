import { formatISO } from "date-fns";
import { Server } from "socket.io";
import { z } from "zod";
import { ChatMessage } from "./chat-message.entity.js";
import { ChatRoomService } from "./chat-room-service.js";
import { CHAT_ROOMS, ChatUser } from "./chat-rooms.js";
import { ChatRoom } from "./chat-room.entity.js";

const service = new ChatRoomService();

const joinSchema = z.object({
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

export const initChat = (io: Server) => {
  io.on("connection", (socket) => {
    let userName = "";
    let currentRoomId = -1;

    const emitPeople = (users: Map<string, ChatUser>) => {
      io.to(`${currentRoomId}`).emit("people", [
        { id: "-1", name: "Everyone", blocked: [] },
        ...Array.from(users.values()).map((user) => ({
          ...user,
          blocked: Array.from(user.blocked)
        }))
      ]);
    };

    const saveChatRoom = async (
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

      chatRoom.messages.add(chatMessage);
      await service.save(chatRoom);
    };

    socket.on("join", async ({ roomId, name }, callback) => {
      const result = joinSchema.safeParse({ roomId, name });

      if (!result.success) {
        return callback({ error: "Invalid input!" });
      }

      const chatRoom = await service.findById(roomId);

      if (!chatRoom) {
        return callback({ error: "Invalid room!" });
      }

      userName = name;
      currentRoomId = roomId;

      socket.join(`${roomId}`);

      const users = CHAT_ROOMS.getUsers(roomId);

      if (users.has(name)) {
        callback({ error: "User already exists!" });
        return socket.disconnect();
      }

      users.set(name, { id: socket.id, name, blocked: new Set<string>() });
      CHAT_ROOMS.addRoom(roomId, users);

      emitPeople(users);

      const dateTime = new Date();

      io.to(`${roomId}`).emit("message", {
        sender: "Chat",
        message: `${name} entered the room...`,
        dateTime: formatISO(dateTime)
      });

      await saveChatRoom(chatRoom, {
        sender: "CHAT",
        message: `${name} entered the room...`,
        dateTime: dateTime
      });

      io.to(socket.id).emit("updateUser", { id: socket.id, name, blocked: [] });

      callback();
    });

    socket.on(
      "message",
      async ({ name, message, privateMessage, target }, callback) => {
        const result = messageSchema.safeParse({
          name,
          message,
          privateMessage,
          target
        });

        if (!result.success) {
          return callback({ error: "Invalid input!" });
        }

        const chatRoom = await service.findById(currentRoomId);

        if (!chatRoom) {
          return callback({ error: "Invalid room!" });
        }

        const users = CHAT_ROOMS.getUsers(currentRoomId);

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
          io.to(sender.id).emit("message", {
            sender: sender.name,
            message: message,
            dateTime: dateTimeString,
            receiver: recipient.name,
            private: true
          });

          await saveChatRoom(chatRoom, {
            sender: sender.name,
            message,
            dateTime,
            receiver: recipient.name,
            privateMessage: true
          });

          if (
            sender.blocked.has(recipient.name) ||
            recipient.blocked.has(sender.name)
          ) {
            return;
          }

          io.to(recipient.id).emit("message", {
            sender: sender.name,
            message: message,
            dateTime: dateTimeString,
            receiver: recipient.name,
            private: true
          });
        } else {
          io.to(sender.id).emit("message", {
            sender: sender.name,
            message,
            dateTime: dateTimeString,
            receiver: target
          });

          await saveChatRoom(chatRoom, {
            sender: sender.name,
            message,
            dateTime,
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
              sender: sender.name,
              message,
              dateTime: dateTimeString,
              receiver: target
            });
          }
        }
      }
    );

    socket.on("block", ({ name, target }, callback) => {
      const result = blockSchema.safeParse({ name, target });

      if (!result.success) {
        return callback({ error: "Invalid input!" });
      }

      const users = CHAT_ROOMS.getUsers(currentRoomId);

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
        ...user,
        blocked: Array.from(user.blocked)
      });

      emitPeople(users);
    });

    socket.on("disconnect", async () => {
      const chatRoom = await service.findById(currentRoomId);

      if (!chatRoom) {
        return;
      }

      if (currentRoomId === -1) {
        return;
      }

      const users = CHAT_ROOMS.getUsers(currentRoomId);

      if (!users) {
        return;
      }

      const user = Array.from(users.values()).find(
        (user) => user.id === socket.id
      );

      if (!user) {
        return;
      }

      users.delete(user.name);

      if (users.size === 0) {
        CHAT_ROOMS.deleteRoom(currentRoomId);
      }

      emitPeople(users);

      const dateTime = new Date();

      io.to(`${currentRoomId}`).emit("message", {
        sender: "Chat",
        message: `${userName} exited the room...`,
        dateTime: formatISO(dateTime)
      });

      await saveChatRoom(chatRoom, {
        sender: "CHAT",
        message: `${userName} exited the room...`,
        dateTime
      });
    });
  });
};
