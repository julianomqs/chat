import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { ChatRoomResource } from "./chat-room-resource.js";
import { initChat } from "./chat.js";

const app = express();

app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

app.use(express.json({ limit: "50mb" }));
app.use("/chatRooms", ChatRoomResource);

const server = createServer(app);
const io = new Server(server, { serveClient: false });

initChat(io);

server.listen(3000);
