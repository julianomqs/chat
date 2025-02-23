export interface ChatUser {
  id: string;
  name: string;
  blocked: Set<string>;
  uuid: string;
  joined: Date;
  lastSeen: Date;
}

class ChatRoomsRepo {
  private rooms = new Map<number, Map<string, ChatUser>>();

  get allRooms() {
    return this.rooms;
  }

  addRoom(id: number, users: Map<string, ChatUser>) {
    this.rooms.set(id, users);
  }

  deleteRoom(id: number) {
    this.rooms.delete(id);
  }

  getRoomSize(id: number) {
    return this.getUsers(id).size;
  }

  getUsers(id: number) {
    return this.rooms.get(id) || new Map<string, ChatUser>();
  }

  getUserByUuid(roomId: number, uuid: string) {
    return Array.from(this.getUsers(roomId).values()).find(
      (user) => user.uuid === uuid
    );
  }
}

export const CHAT_ROOMS = new ChatRoomsRepo();
