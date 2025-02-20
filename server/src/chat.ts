import { formatISO } from "date-fns";
import { Server } from "socket.io";
import { z } from "zod";
import { ChatMessage } from "./chat-message.entity.js";
import { ChatRoomService } from "./chat-room-service.js";
import { CHAT_ROOMS } from "./chat-rooms.js";

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

      io.to(`${roomId}`).emit("people", [
        { id: "-1", name: "Everyone", blocked: [] },
        ...Array.from(users.values()).map((user) => ({
          ...user,
          blocked: Array.from(user.blocked)
        }))
      ]);

      const dateTime = new Date();

      io.to(`${roomId}`).emit("message", {
        sender: "Chat",
        message: `${name} entered the room...`,
        dateTime: formatISO(dateTime)
      });

      const message = new ChatMessage();
      message.sender = "CHAT";
      message.message = `${name} entered the room...`;
      message.dateTime = dateTime;

      chatRoom.messages.add(message);
      await service.save(chatRoom);

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

        const chatRoom = await service.findById(currentRoomId);

        if (!chatRoom) {
          return callback({ error: "Invalid room!" });
        }

        if (!result.success) {
          return callback({ error: "Invalid input!" });
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

          const chatMessage = new ChatMessage();
          chatMessage.sender = sender.name;
          chatMessage.message = message;
          chatMessage.dateTime = dateTime;
          chatMessage.receiver = recipient.name;

          chatRoom.messages.add(chatMessage);
          await service.save(chatRoom);

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

          const chatMessage = new ChatMessage();
          chatMessage.sender = sender.name;
          chatMessage.message = message;
          chatMessage.dateTime = dateTime;
          chatMessage.receiver = target;

          chatRoom.messages.add(chatMessage);
          await service.save(chatRoom);

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

      io.to(`${currentRoomId}`).emit("people", [
        { id: "-1", name: "Everyone", blocked: [] },
        ...Array.from(users.values()).map((u) => ({
          ...u,
          blocked: Array.from(u.blocked)
        }))
      ]);
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

      io.to(`${currentRoomId}`).emit("people", [
        { id: "-1", name: "Everyone", blocked: [] },
        ...Array.from(users.values()).map((user) => ({
          ...user,
          blocked: Array.from(user.blocked)
        }))
      ]);

      const dateTime = new Date();

      io.to(`${currentRoomId}`).emit("message", {
        sender: "Chat",
        message: `${userName} exited the room...`,
        dateTime: formatISO(dateTime)
      });

      const chatMessage = new ChatMessage();
      chatMessage.sender = "CHAT";
      chatMessage.message = `${userName} exited the room...`;
      chatMessage.dateTime = dateTime;

      chatRoom.messages.add(chatMessage);
      await service.save(chatRoom);
    });
  });
};
