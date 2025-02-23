import { ChatMessage } from "./chat-message.entity.js";
import { ChatRoom } from "./chat-room.entity.js";
import orm from "./mikro-orm.js";

export class ChatRoomService {
  private em = orm.em.fork();

  save = async (entity: ChatRoom) => {
    if (entity.id) {
      entity = this.em.merge(entity);
    } else {
      this.em.persist(entity);
    }

    await this.em.flush();

    return entity;
  };

  saveMessage = async (entity: ChatMessage) => {
    if (entity.id) {
      entity = this.em.merge(entity);
    } else {
      this.em.persist(entity);
    }

    await this.em.flush();

    return entity;
  };

  findById = async (id: number) => {
    return this.em.findOne(ChatRoom, id, { populate: ["messages"] });
  };

  findAll = async (name?: string) => {
    return this.em.findAll(ChatRoom, name ? { where: { name } } : undefined);
  };

  remove = async (entity: ChatRoom) => {
    const managedEntity = this.em.merge(entity);
    await this.em.removeAndFlush(managedEntity);
  };

  getMessages = async (roomId: number, name: string, date: Date) => {
    return this.em.find(ChatMessage, {
      room: { id: roomId },
      dateTime: { $gte: date },
      $or: [
        {
          $or: [{ sender: "CHAT" }, { sender: name }]
        },
        {
          $or: [{ receiver: null }, { receiver: name }]
        }
      ]
    });
  };
}
