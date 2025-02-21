export interface ChatUser {
  id: string;
  name: string;
  blocked: Set<string>;
}

class ChatRoomsRepo {
  private rooms = new Map<number, Map<string, ChatUser>>();

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
}

export const CHAT_ROOMS = new ChatRoomsRepo();
