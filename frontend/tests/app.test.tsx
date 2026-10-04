import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ChatEvent,
  ChatUser,
  RoomSummary,
  ServerToClientEvents,
  SessionReady
} from "../src/socket-types";

const harness = vi.hoisted(() => {
  const handlers = new Map<string, unknown>();
  const socket = {
    on: vi.fn((event: string, handler: unknown): void => {
      handlers.set(event, handler);
    }),
    connect: vi.fn((): undefined => undefined),
    disconnect: vi.fn((): undefined => undefined),
    removeAllListeners: vi.fn((): undefined => undefined),
    emit: vi.fn()
  };

  return { handlers, socket };
});

vi.mock("socket.io-client", () => ({
  io: () => harness.socket
}));

import { App } from "../src/main";

const dispatch = <Event extends keyof ServerToClientEvents>(
  event: Event,
  payload: Parameters<ServerToClientEvents[Event]>[0]
): void => {
  const handler = harness.handlers.get(event);

  if (typeof handler === "function") {
    Reflect.apply(handler, undefined, [payload]);
  }
};

const dispatchAndFlush = async <Event extends keyof ServerToClientEvents>(
  event: Event,
  payload: Parameters<ServerToClientEvents[Event]>[0]
): Promise<void> => {
  await act(async () => {
    dispatch(event, payload);
  });
};

const dispatchSocketEvent = async (
  event: string,
  ...payload: unknown[]
): Promise<void> => {
  await act(async () => {
    const handler = harness.handlers.get(event);

    if (typeof handler === "function") {
      Reflect.apply(handler, undefined, payload);
    }
  });
};

const readySession = (
  mode: "participant" | "spy",
  users: ChatUser[]
): SessionReady => ({
  token: `token-${mode}`,
  room: "papo-livre",
  mode,
  self: mode === "participant" ? (users[0] ?? null) : null,
  selectedRecipient: null,
  users
});
const roomSummaries: RoomSummary[] = [
  {
    id: "papo-livre",
    name: "Papo Livre",
    count: 3
  },
  {
    id: "musica",
    name: "Música",
    count: 0
  }
];

const sendServerMessage = async (event: ChatEvent): Promise<void> => {
  await dispatchAndFlush("chat:event", event);
};

beforeEach(() => {
  harness.handlers.clear();
  sessionStorage.clear();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn()
  });
});

afterEach(() => {
  cleanup();
});

describe("interface de salas e entrada", () => {
  it("mostra contadores recebidos em tempo real e abre a entrada", async () => {
    render(<App />);

    expect(screen.getByText("Papo Livre")).toBeInTheDocument();
    expect(screen.getAllByText("0")).toHaveLength(8);
    expect(harness.socket.connect).toHaveBeenCalledOnce();
    await dispatchSocketEvent("connect");

    expect(screen.getByText("Ao vivo")).toBeInTheDocument();

    await dispatchSocketEvent("disconnect");

    expect(screen.getByText("Conectando")).toBeInTheDocument();

    await dispatchAndFlush("rooms:update", [
      { ...roomSummaries[0]!, count: 1 },
      ...roomSummaries.slice(1)
    ]);

    expect(await screen.findByText("1 pessoa por aqui")).toBeInTheDocument();

    await dispatchAndFlush("rooms:update", roomSummaries);

    expect(await screen.findByText("3 pessoas por aqui")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Papo Livre/ }));
    await dispatchSocketEvent("connect");

    expect(
      screen.getByRole("heading", { name: /Entrar em Papo Livre/ })
    ).toBeInTheDocument();
    expect(screen.getByText("Online")).toBeInTheDocument();
    expect(screen.getByLabelText("Seu apelido")).toHaveAttribute(
      "maxLength",
      "20"
    );

    fireEvent.change(screen.getByLabelText("Seu apelido"), {
      target: { value: "Participante" }
    });
    fireEvent.submit(
      screen.getByRole("button", { name: /Entrar na sala/ }).closest("form")!
    );

    const enterAck = harness.socket.emit.mock.calls.at(-1)?.at(-1);

    if (typeof enterAck === "function") {
      await act(async () => {
        Reflect.apply(enterAck, undefined, [{ ok: true }]);
      });
    }

    await dispatchAndFlush(
      "session:ready",
      readySession("participant", [{ nick: "Participante", color: "#123456" }])
    );

    expect(
      screen.getByRole("heading", { name: /Participantes/ })
    ).toBeVisible();
  });

  it("mostra erros de entrada e permite espiar sem nickname", async () => {
    render(<App />);
    await dispatchAndFlush("rooms:update", roomSummaries);
    fireEvent.click(screen.getByRole("button", { name: /Papo Livre/ }));
    fireEvent.change(screen.getByLabelText("Seu apelido"), {
      target: { value: "Alice" }
    });
    fireEvent.submit(
      screen.getByRole("button", { name: /Entrar na sala/ }).closest("form")!
    );

    const enterCall = harness.socket.emit.mock.calls.at(-1);
    const enterAck = enterCall?.at(-1);

    if (typeof enterAck === "function") {
      Reflect.apply(enterAck, undefined, [
        { ok: false, error: "Este apelido já está em uso nesta sala." }
      ]);
    }

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /apelido já está em uso/
    );

    fireEvent.change(screen.getByLabelText("Seu apelido"), {
      target: { value: "Outra Pessoa" }
    });
    fireEvent.submit(
      screen.getByRole("button", { name: /Entrar na sala/ }).closest("form")!
    );

    const failedEnterAck = harness.socket.emit.mock.calls.at(-1)?.at(-1);

    if (typeof failedEnterAck === "function") {
      Reflect.apply(failedEnterAck, undefined, [{ ok: false }]);
    }

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Não foi possível entrar na sala."
    );

    fireEvent.click(screen.getByRole("button", { name: /Espiar em silêncio/ }));

    const spyCall = harness.socket.emit.mock.calls.at(-1);
    const spyAck = spyCall?.at(-1);

    if (typeof spyAck === "function") {
      Reflect.apply(spyAck, undefined, [{ ok: false }]);
    }

    expect(harness.socket.emit).toHaveBeenLastCalledWith(
      "room:spy",
      { room: "papo-livre" },
      expect.any(Function)
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Não foi possível espiar a sala."
    );
  });

  it("entra com sucesso no modo espiar", async () => {
    render(<App />);
    await dispatchAndFlush("rooms:update", roomSummaries);
    fireEvent.click(screen.getByRole("button", { name: /Papo Livre/ }));
    fireEvent.click(screen.getByRole("button", { name: /Espiar em silêncio/ }));

    const spyAck = harness.socket.emit.mock.calls.at(-1)?.at(-1);

    if (typeof spyAck === "function") {
      await act(async () => {
        Reflect.apply(spyAck, undefined, [{ ok: true }]);
      });
    }

    await dispatchAndFlush("session:ready", readySession("spy", []));

    expect(screen.getByText("Modo espiar")).toBeInTheDocument();
  });

  it("limpa o token inválido quando o servidor rejeita a retomada no connect", async () => {
    sessionStorage.setItem("batepapo:session", "token-expirado");
    render(<App />);
    await dispatchSocketEvent("connect");

    expect(harness.socket.emit).toHaveBeenLastCalledWith(
      "session:resume",
      { token: "token-expirado" },
      expect.any(Function)
    );

    const resumeAck = harness.socket.emit.mock.calls.at(-1)?.at(-1);

    if (typeof resumeAck === "function") {
      Reflect.apply(resumeAck, undefined, [{ ok: false }]);
    }

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Sua sessão expirou. Escolha uma sala para entrar."
    );
    expect(sessionStorage.getItem("batepapo:session")).toBeNull();
    expect(
      screen.getByRole("button", { name: /Papo Livre/ })
    ).toBeInTheDocument();

    await dispatchSocketEvent("disconnect");

    expect(screen.getByText("Conectando")).toBeInTheDocument();

    sessionStorage.setItem("batepapo:session", "token-válido");
    await dispatchSocketEvent("connect");

    const validResumeAck = harness.socket.emit.mock.calls.at(-1)?.at(-1);

    if (typeof validResumeAck === "function") {
      Reflect.apply(validResumeAck, undefined, [{ ok: true }]);
    }

    await dispatchAndFlush(
      "session:ready",
      readySession("participant", [{ nick: "Retomado", color: "#123456" }])
    );

    expect(
      screen.getByRole("heading", { name: /Participantes/ })
    ).toBeVisible();
  });
});

describe("chat de participantes e espiões", () => {
  const alice: ChatUser = { nick: "Alice", color: "#112233" };
  const bob: ChatUser = { nick: "Bruno", color: "#445566" };
  const carla: ChatUser = { nick: "Carla", color: "#778899" };

  it("seleciona Todos por padrão, altera destinatário, envia e redefine ao sair", async () => {
    render(<App />);
    await dispatchSocketEvent("connect");
    await dispatchAndFlush(
      "session:ready",
      readySession("participant", [alice, carla, bob])
    );
    await dispatchAndFlush("room:users", {
      room: "papo-livre",
      users: [alice, carla, bob]
    });

    const checkbox = screen.getByRole("checkbox", { name: /Reservadamente/ });

    expect(screen.getByText("Conectado")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /Alice/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Todos/ })).toBeInTheDocument();
    expect(checkbox).toBeDisabled();
    expect(checkbox).not.toBeChecked();
    expect(screen.getByText("Bruno", { selector: ".person-name" })).toHaveStyle(
      {
        color: "rgb(68, 85, 102)"
      }
    );
    expect(
      [...document.querySelectorAll(".people-list .person-name")].map(
        (element) => element.textContent
      )
    ).toEqual(["Alice", "Todos", "Bruno", "Carla"]);

    fireEvent.click(screen.getByRole("button", { name: /Bruno/ }));

    expect(checkbox).toBeEnabled();
    expect(checkbox).toBeChecked();
    await dispatchAndFlush("room:users", {
      room: "papo-livre",
      users: [alice, bob, carla]
    });
    expect(screen.getByRole("button", { name: /Bruno/ })).toHaveAttribute(
      "class",
      expect.stringContaining("person-selected")
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Mensagem" }), {
      target: { value: "mensagem reservada" }
    });
    fireEvent.click(screen.getByRole("button", { name: /Enviar/ }));

    expect(harness.socket.emit).toHaveBeenLastCalledWith(
      "chat:send",
      { text: "mensagem reservada", recipient: "Bruno", private: true },
      expect.any(Function)
    );

    const privateAck = harness.socket.emit.mock.calls.at(-1)?.at(-1);

    if (typeof privateAck === "function") {
      await act(async () => {
        Reflect.apply(privateAck, undefined, [{ ok: false }]);
      });
    }

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Não foi possível enviar a mensagem."
    );

    fireEvent.click(screen.getByRole("button", { name: /Todos/ }));

    expect(checkbox).toBeDisabled();
    expect(checkbox).not.toBeChecked();

    fireEvent.change(screen.getByRole("textbox", { name: "Mensagem" }), {
      target: { value: "mensagem para a sala" }
    });
    fireEvent.click(screen.getByRole("button", { name: /Enviar/ }));

    expect(harness.socket.emit).toHaveBeenLastCalledWith(
      "chat:send",
      { text: "mensagem para a sala", recipient: "Todos", private: false },
      expect.any(Function)
    );

    const publicAck = harness.socket.emit.mock.calls.at(-1)?.at(-1);

    if (typeof publicAck === "function") {
      await act(async () => {
        Reflect.apply(publicAck, undefined, [{ ok: true }]);
      });
    }

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Bruno/ }));
    await dispatchAndFlush("room:users", {
      room: "papo-livre",
      users: [alice, carla]
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Todos/ })).toHaveAttribute(
        "class",
        expect.stringContaining("person-selected")
      );
    });

    expect(checkbox).toBeDisabled();
  });

  it("renderiza eventos, limpa mensagens em sessão inválida e volta às salas", async () => {
    render(<App />);
    await dispatchAndFlush(
      "session:ready",
      readySession("participant", [alice, bob])
    );

    await sendServerMessage({
      id: "join-1",
      room: "papo-livre",
      type: "join",
      sender: "Bruno",
      senderColor: bob.color,
      recipient: "Todos",
      private: false,
      text: "Bruno entrou no chat",
      createdAt: new Date().toISOString()
    });
    await sendServerMessage({
      id: "private-message-1",
      room: "papo-livre",
      type: "message",
      sender: "Bruno",
      senderColor: bob.color,
      recipient: "Alice",
      private: true,
      text: "segredo formatado",
      createdAt: new Date().toISOString()
    });
    await sendServerMessage({
      id: "message-1",
      room: "papo-livre",
      type: "message",
      sender: "Bruno",
      senderColor: bob.color,
      recipient: "Todos",
      private: false,
      text: "olá, sala",
      createdAt: new Date().toISOString()
    });
    await sendServerMessage({
      id: "leave-1",
      room: "papo-livre",
      type: "leave",
      sender: "Bruno",
      senderColor: bob.color,
      recipient: "Todos",
      private: false,
      text: "Bruno saiu do chat",
      createdAt: new Date().toISOString()
    });

    expect(
      await screen.findByText("entrou no chat", { exact: true })
    ).toBeInTheDocument();
    expect(screen.getByText(/olá, sala/)).toBeInTheDocument();
    expect(screen.getByText(/reservadamente disse a/)).toBeInTheDocument();
    expect(screen.getByText("⌑ reservado")).toBeInTheDocument();
    expect(
      screen.getByText("saiu do chat", { exact: true })
    ).toBeInTheDocument();

    sessionStorage.setItem("batepapo:session", "token-participant");
    await dispatchAndFlush("session:invalid", "Sessão inválida ou expirada.");

    expect(
      await screen.findByText("Sessão inválida ou expirada.")
    ).toBeInTheDocument();
    expect(sessionStorage.getItem("batepapo:session")).toBeNull();
    expect(
      screen.getByRole("button", { name: /Papo Livre/ })
    ).toBeInTheDocument();
  });

  it("mostra somente mensagens públicas no modo espiar e não exibe o compositor", async () => {
    render(<App />);
    await dispatchAndFlush("session:ready", readySession("spy", [carla, bob]));

    expect(await screen.findByText("Modo espiar")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Bruno/ })).toBeDisabled();
    expect(
      screen.queryByRole("textbox", { name: "Mensagem" })
    ).not.toBeInTheDocument();
    expect(
      [...document.querySelectorAll(".people-list .person-name")].map(
        (element) => element.textContent
      )
    ).toEqual(["Todos", "Bruno", "Carla"]);

    await sendServerMessage({
      id: "spy-message",
      room: "papo-livre",
      type: "message",
      sender: "Bruno",
      senderColor: bob.color,
      recipient: "Carla",
      private: false,
      text: "mensagem pública",
      createdAt: new Date().toISOString()
    });

    expect(await screen.findByText(/mensagem pública/)).toBeInTheDocument();
  });
});
