/* eslint-disable @typescript-eslint/no-explicit-any */
export interface ChatRoom {
  id?: number;
  name: string;
  createdAt?: Date;
  count: number;
}

export class ChatRoomService {
  private readonly baseUrl = "/api/chatRooms";
  private readonly TIMEOUT = 5000;

  async create(chatRoom: Omit<ChatRoom, "id" | "count">): Promise<ChatRoom> {
    return this.fetchWithTimeout(this.baseUrl, {
      method: "POST",
      body: JSON.stringify(chatRoom)
    });
  }

  async update(id: number, chatRoom: Partial<ChatRoom>): Promise<ChatRoom> {
    return this.fetchWithTimeout(`${this.baseUrl}/${id}`, {
      method: "PUT",
      body: JSON.stringify(chatRoom)
    });
  }

  async delete(id: number): Promise<void> {
    await this.fetchWithTimeout(
      `${this.baseUrl}/${id}`,
      {
        method: "DELETE"
      },
      false,
      true
    );
  }

  async findById(id: number): Promise<ChatRoom> {
    return this.fetchWithTimeout(`${this.baseUrl}/${id}`, {
      method: "GET"
    });
  }

  async findAll(name?: string): Promise<ChatRoom[]> {
    const params = new URLSearchParams();

    if (name) {
      params.append("name", name);
    }

    const response = await this.fetchWithTimeout(
      `${this.baseUrl}?${params}`,
      {
        method: "GET"
      },
      true
    );

    return response as ChatRoom[];
  }

  private async fetchWithTimeout(
    url: string,
    config: Omit<RequestInit, "headers" | "signal">,
    isArray: boolean = false,
    noContent: boolean = false
  ): Promise<any> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.TIMEOUT);

    try {
      const response = await fetch(url, {
        ...config,
        headers: this.getHeaders(),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      if (!noContent) {
        return isArray
          ? this.handleArrayResponse(response)
          : this.handleResponse(response);
      }
    } catch (error) {
      throw new Error(this.getErrorMessage(error));
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private getHeaders(): HeadersInit {
    return {
      "Content-Type": "application/json"
    };
  }

  private async handleResponse(response: Response): Promise<ChatRoom> {
    const data = await response.json();
    return this.parseDates(data);
  }

  private async handleArrayResponse(response: Response): Promise<ChatRoom[]> {
    const data = await response.json();
    return data.map((item: any) => this.parseDates(item));
  }

  private parseDates(data: any): ChatRoom {
    return {
      ...data,
      createdAt: data.createdAt ? new Date(data.createdAt) : undefined
    };
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof DOMException && error.name === "AbortError") {
      return "Request timed out";
    }

    return error instanceof Error ? error.message : "Unknown error occurred";
  }
}
