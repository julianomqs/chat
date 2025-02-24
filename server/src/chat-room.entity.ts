import {
  Cascade,
  Collection,
  Entity,
  OneToMany,
  PrimaryKey,
  Property
} from "@mikro-orm/core";
import { ChatMessage } from "./chat-message.entity.js";

@Entity()
export class ChatRoom {
  @PrimaryKey()
  id!: number;

  @Property({ type: "Date", columnType: "DATETIME(3)" })
  createdAt: Date = new Date();

  @Property({ length: 50 })
  name!: string;

  @OneToMany({ mappedBy: "room", cascade: [Cascade.ALL], orphanRemoval: true })
  messages = new Collection<ChatMessage>(this);
}
