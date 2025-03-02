import { Entity, ManyToOne, PrimaryKey, Property } from "@mikro-orm/core";
import { ChatRoom } from "./chat-room.entity.js";

@Entity()
export class ChatMessage {
  @PrimaryKey()
  id!: number;

  @Property({ type: "Date", columnType: "DATETIME(3)" })
  dateTime!: Date;

  @Property({ length: 500 })
  message!: string;

  @Property({ length: 20 })
  sender!: string;

  @Property({ length: 20, nullable: true })
  receiver!: string;

  @Property()
  private: boolean = false;

  @Property()
  deleted: boolean = false;

  @ManyToOne()
  room!: ChatRoom;
}
