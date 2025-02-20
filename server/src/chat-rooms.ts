class ChatRoomsRepo {
  private rooms = new Map<
    number,
    Map<string, { id: string; name: string; blocked: Set<string> }>
  >();

  addRoom(
    id: number,
    users: Map<string, { id: string; name: string; blocked: Set<string> }>
  ) {
    this.rooms.set(id, users);
  }

  deleteRoom(id: number) {
    this.rooms.delete(id);
  }

  getRoomSize(id: number) {
    return this.getUsers(id).size;
  }

  getUsers(id: number) {
    return (
      this.rooms.get(id) ||
      new Map<string, { id: string; name: string; blocked: Set<string> }>()
    );
  }
}

export const CHAT_ROOMS = new ChatRoomsRepo();
