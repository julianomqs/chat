import { Entity, ManyToOne, PrimaryKey, Property } from "@mikro-orm/core";
import { ChatRoom } from "./chat-room.entity.js";

@Entity()
export class ChatMessage {
  @PrimaryKey()
  id!: number;

  @Property()
  dateTime!: Date;

  @Property({ length: 500 })
  message!: string;

  @Property({ length: 20 })
  sender!: string;

  @Property({ length: 20, nullable: true })
  receiver!: string;

  @ManyToOne()
  room!: ChatRoom;
}
