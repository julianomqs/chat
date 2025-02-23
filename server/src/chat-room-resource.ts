import express, { NextFunction, Request, Response, Router } from "express";
import { z } from "zod";
import { ChatRoomService } from "./chat-room-service.js";
import { ChatRoom } from "./chat-room.entity.js";
import { CHAT_ROOMS } from "./chat-rooms.js";

const router: Router = express.Router();

const service = new ChatRoomService();

const paramSchema = z.object({
  id: z.string().regex(/^\d+$/)
});

const bodySchema = z.object({
  name: z.string().max(50)
});

const querySchema = z.object({
  name: z.string().max(50).optional()
});

type RequestParam = z.infer<typeof paramSchema>;

type RequestBody = z.infer<typeof bodySchema>;

type RequestQuery = z.infer<typeof querySchema>;

const validateRequestParam = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const result = paramSchema.safeParse(req.params);

  if (result.success) {
    next();
  } else {
    res.status(400).send(result.error.issues);
  }
};

const validateRequestBody = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const result = bodySchema.safeParse(req.body);

  if (result.success) {
    next();
  } else {
    res.status(400).send(result.error.issues);
  }
};

const validateRequestQuery = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const result = querySchema.safeParse(req.query);

  if (result.success) {
    next();
  } else {
    res.status(400).send(result.error.issues);
  }
};

router.post(
  "/",
  validateRequestBody,
  async (req: Request<object, object, RequestBody>, res: Response) => {
    const chatRoom = new ChatRoom();
    chatRoom.name = req.body.name;

    const savedChatRoom = await service.save(chatRoom);

    res.status(201).send(savedChatRoom);
  }
);

router.put(
  "/:id",
  validateRequestParam,
  validateRequestBody,
  async (req: Request<RequestParam, object, RequestBody>, res: Response) => {
    const chatRoom = await service.findById(parseInt(req.params.id));

    if (chatRoom) {
      chatRoom.name = req.body.name;

      const savedChatRoom = await service.save(chatRoom);

      res.status(200).send(savedChatRoom);
    } else {
      res.status(404).send({ message: "ChatRoom não encontrada." });
    }
  }
);

router.delete(
  "/:id",
  validateRequestParam,
  async (req: Request<RequestParam>, res: Response) => {
    const chatRoom = await service.findById(parseInt(req.params.id));

    if (chatRoom) {
      await service.remove(chatRoom);

      res.sendStatus(204);
    } else {
      res.status(404).send({ message: "ChatRoom não encontrada." });
    }
  }
);

router.get(
  "/:id",
  validateRequestParam,
  async (req: Request<RequestParam>, res: Response) => {
    const chatRoom = await service.findById(parseInt(req.params.id));

    if (chatRoom) {
      res.status(200).send({
        createdAt: chatRoom.createdAt,
        id: chatRoom.id,
        name: chatRoom.name
      });
    } else {
      res.status(404).send({ message: "ChatRoom não encontrada." });
    }
  }
);

router.get(
  "/",
  validateRequestQuery,
  async (req: Request<object, object, object, RequestQuery>, res: Response) => {
    const chatRooms = await service.findAll(req?.query?.name);

    const chatRoomsWithUsers = chatRooms.map((cr) => ({
      ...cr,
      count: CHAT_ROOMS.getRoomSize(cr.id)
    }));

    res.status(200).send(chatRoomsWithUsers);
  }
);

export const ChatRoomResource = router;
