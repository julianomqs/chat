import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type SubmitEvent
} from "react";
import { createRoot } from "react-dom/client";
import { io, type Socket } from "socket.io-client";
import "./style.css";
import {
  ROOMS,
  type ChatEvent,
  type ChatUser,
  type RoomId,
  type RoomSummary,
  type ServerToClientEvents,
  type ClientToServerEvents,
  type SessionReady
} from "./socket-types";

type ChatSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const SESSION_KEY = "batepapo:session";

export const App = () => {
  const socketRef = useRef<ChatSocket | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [rooms, setRooms] = useState<RoomSummary[]>(
    ROOMS.map((room) => ({ ...room, count: 0 }))
  );
  const [activeRoom, setActiveRoom] = useState<RoomId | null>(null);
  const [session, setSession] = useState<SessionReady | null>(null);
  const [users, setUsers] = useState<ChatUser[]>([]);
  const [messages, setMessages] = useState<ChatEvent[]>([]);
  const [nickname, setNickname] = useState("");
  const [nicknameColor, setNicknameColor] = useState("#3658d4");
  const [selectedRecipient, setSelectedRecipientState] = useState<
    string | null
  >(null);
  const selectedRecipientRef = useRef<string | null>(null);
  const setSelectedRecipient = useCallback((recipient: string | null) => {
    selectedRecipientRef.current = recipient;
    setSelectedRecipientState(recipient);
  }, []);
  const [privateMessage, setPrivateMessage] = useState(true);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const socket: ChatSocket = io({ autoConnect: false });

    socketRef.current = socket;
    socket.on("connect", () => {
      setConnected(true);

      const token = sessionStorage.getItem(SESSION_KEY);

      if (!token) {
        return;
      }

      socket.emit("session:resume", { token }, (result) => {
        if (!result.ok) {
          sessionStorage.removeItem(SESSION_KEY);
          setSession(null);
          setActiveRoom(null);
          setUsers([]);
          setMessages([]);
          setError(
            result.error ?? "Sua sessão expirou. Escolha uma sala para entrar."
          );
        }
      });
    });
    socket.on("disconnect", (reason) => {
      setConnected(false);

      if (reason === "io server disconnect") {
        sessionStorage.removeItem(SESSION_KEY);
        setSession(null);
        setActiveRoom(null);
        setUsers([]);
        setMessages([]);
        setSelectedRecipient(null);
        setError("Sua sessão foi aberta em outra aba ou janela.");
        socket.connect();
      }
    });
    socket.on("rooms:update", setRooms);
    socket.on("session:ready", (ready) => {
      sessionStorage.setItem(SESSION_KEY, ready.token);
      setSession(ready);
      setActiveRoom(ready.room);
      setUsers(ready.users);
      setSelectedRecipient(ready.selectedRecipient);
      setPrivateMessage(ready.selectedRecipient !== null);
      setMessages([]);
      setDraft("");
      setError("");
    });
    socket.on("session:invalid", (message) => {
      sessionStorage.removeItem(SESSION_KEY);
      setSession(null);
      setActiveRoom(null);
      setUsers([]);
      setMessages([]);
      setError(message);
    });
    socket.on("room:users", ({ users: nextUsers }) => {
      setUsers(nextUsers);

      const current = selectedRecipientRef.current;

      if (!current) {
        return;
      }

      const lowered = current.toLocaleLowerCase("pt-BR");
      const stillHere = nextUsers.some(
        (user) => user.nick.toLocaleLowerCase("pt-BR") === lowered
      );

      if (lowered === "todos") {
        setSelectedRecipient(null);
      } else if (!stillHere) {
        setSelectedRecipient(null);
        setPrivateMessage(false);
        socket.emit("chat:select-recipient", { recipient: null });
      }
    });
    socket.on("chat:event", (event) => {
      setMessages((current) => [...current, event]);
    });
    socket.on("chat:error", setError);
    socket.connect();

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [setSelectedRecipient]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  const sortedSidebarUsers = useMemo(() => {
    if (!session) {
      return [];
    }

    const sortByNickname = (left: ChatUser, right: ChatUser) =>
      left.nick.localeCompare(right.nick, "pt-BR", { sensitivity: "base" });

    if (!session.self) {
      return [...users].sort(sortByNickname);
    }

    const self = session.self;
    const others = users
      .filter(
        (user) =>
          user.nick.toLocaleLowerCase("pt-BR") !==
          self.nick.toLocaleLowerCase("pt-BR")
      )
      .sort(sortByNickname);

    return [self, ...others];
  }, [session, users]);
  const renderPerson = (user: ChatUser, isSelf: boolean) => (
    <button
      key={user.nick}
      className={`person-row ${isSelf ? "person-self" : ""} ${selectedRecipient === user.nick ? "person-selected" : ""}`}
      disabled={isSelf || session?.mode === "spy"}
      onClick={() => chooseRecipient(user.nick)}
    >
      <span
        className="avatar"
        style={{ "--avatar-color": user.color } as CSSProperties}
      >
        {user.nick.slice(0, 1).toLocaleUpperCase("pt-BR")}
      </span>
      <span className="person-name" style={{ color: user.color }}>
        {user.nick}
      </span>
      {isSelf && <span className="you-tag">você</span>}
      {!isSelf &&
        session?.mode === "participant" &&
        selectedRecipient === user.nick && <span className="selected-dot" />}
    </button>
  );

  const enterRoom = (room: RoomId) => {
    setActiveRoom(room);
    setError("");
  };

  const handleEnter = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!activeRoom || !socketRef.current) {
      return;
    }

    setError("");
    socketRef.current.emit(
      "room:enter",
      { room: activeRoom, nick: nickname, color: nicknameColor },
      (result) => {
        if (!result.ok) {
          setError(result.error ?? "Não foi possível entrar na sala.");
        }
      }
    );
  };

  const handleSpy = () => {
    if (!activeRoom || !socketRef.current) {
      return;
    }

    setError("");
    socketRef.current.emit("room:spy", { room: activeRoom }, (result) => {
      if (!result.ok) {
        setError(result.error ?? "Não foi possível espiar a sala.");
      }
    });
  };

  const chooseRecipient = (recipient: string | null) => {
    if (!session || session.mode !== "participant") {
      return;
    }

    setSelectedRecipient(recipient);
    setPrivateMessage(recipient !== null);
    socketRef.current?.emit("chat:select-recipient", { recipient });
  };

  const sendMessage = (event?: SubmitEvent<HTMLFormElement>) => {
    event?.preventDefault();

    const socket = socketRef.current;

    if (!socket || !session || session.mode !== "participant") {
      return;
    }

    socket.emit(
      "chat:send",
      {
        text: draft,
        recipient: selectedRecipient ?? "Todos",
        private: privateMessage && selectedRecipient !== null
      },
      (result) => {
        if (result.ok) {
          setDraft("");
          setError("");
        } else {
          setError(result.error ?? "Não foi possível enviar a mensagem.");
        }
      }
    );
  };

  const leaveRoom = () => {
    const socket = socketRef.current;

    if (!socket) {
      return;
    }

    socket.emit("session:leave", (result) => {
      sessionStorage.removeItem(SESSION_KEY);
      setSession(null);
      setActiveRoom(null);
      setMessages([]);
      setUsers([]);
      setSelectedRecipient(null);
      setPrivateMessage(true);
      setError(
        result.ok ? "" : (result.error ?? "Não foi possível sair da sala.")
      );
    });
  };

  const currentRoom = activeRoom
    ? ROOMS.find((room) => room.id === activeRoom)
    : null;

  if (session && activeRoom) {
    return (
      <main className="chat-shell">
        <header className="chat-topbar">
          <a
            className="brand brand-small"
            href="#inicio"
            onClick={(event) => event.preventDefault()}
          >
            <span className="brand-mark">b!</span>
            <span>Bate-papo</span>
          </a>
          <div className="room-crumb">
            <span>Salas</span>
            <b>/</b>
            {currentRoom?.name}
          </div>
          <div className="topbar-right">
            <span className={`connection ${connected ? "is-online" : ""}`}>
              <i />
              {connected ? "Conectado" : "Reconectando"}
            </span>
            <button className="quiet-button" onClick={leaveRoom}>
              Sair da sala
            </button>
          </div>
        </header>

        <div className="chat-layout">
          <aside className="people-panel">
            <div className="people-heading">
              <div>
                <p className="eyebrow">NESTA SALA</p>
                <h2>
                  Participantes <span>{users.length}</span>
                </h2>
              </div>
              <span className="people-icon">♧</span>
            </div>
            <div className="people-list">
              {session.mode === "participant" && (
                <div className="people-label">VOCÊ</div>
              )}
              {session.mode === "participant" &&
                sortedSidebarUsers[0] &&
                renderPerson(sortedSidebarUsers[0], true)}
              <button
                className={`person-row everyone-row ${selectedRecipient === null ? "person-selected" : ""}`}
                disabled={session.mode === "spy"}
                onClick={() => chooseRecipient(null)}
              >
                <span className="everyone-avatar">◎</span>
                <span className="person-name">Todos</span>
                {session.mode === "participant" &&
                  selectedRecipient === null && (
                    <span className="selected-dot" />
                  )}
              </button>
              {(session.mode === "participant"
                ? sortedSidebarUsers.slice(1)
                : sortedSidebarUsers
              ).map((user) => renderPerson(user, false))}
            </div>
            <div className="room-presence">
              <span className="presence-dot" />
              <span>
                {users.length} {users.length === 1 ? "pessoa" : "pessoas"}{" "}
                conversando
              </span>
            </div>
          </aside>

          <section className="conversation-panel">
            <div className="conversation-heading">
              <div className="room-symbol">{roomSymbol(activeRoom)}</div>
              <div className="conversation-title">
                <h1>{currentRoom?.name}</h1>
                <p>
                  {session.mode === "spy"
                    ? "Você está acompanhando esta conversa"
                    : `Conversa aberta · ${users.length} participantes`}
                </p>
              </div>
              {session.mode === "spy" && (
                <span className="spy-badge">◉ modo espiar</span>
              )}
            </div>

            <div
              className="message-list"
              aria-live="polite"
              aria-label="Mensagens da sala"
            >
              {messages.length === 0 ? (
                <div className="empty-conversation">
                  <div className="empty-orbit">
                    <span>✳</span>
                  </div>
                  <h2>O papo começa agora</h2>
                  <p>As mensagens aparecerão aqui. Dê boas-vindas à sala!</p>
                </div>
              ) : (
                <>
                  <div className="history-note">
                    <span /> Você está vendo as mensagens desde que entrou{" "}
                    <span />
                  </div>
                  {messages.map((message) => (
                    <MessageRow
                      key={message.id}
                      message={message}
                      users={users}
                    />
                  ))}
                </>
              )}
              <div ref={bottomRef} />
            </div>

            {session.mode === "participant" ? (
              <div className="composer-wrap">
                {error && (
                  <div className="inline-error" role="alert">
                    {error}
                  </div>
                )}
                <form className="composer" onSubmit={sendMessage}>
                  <input
                    className="message-input"
                    type="text"
                    maxLength={200}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder={
                      selectedRecipient
                        ? `Mensagem para ${selectedRecipient}...`
                        : "Escreva sua mensagem..."
                    }
                    aria-label="Mensagem"
                  />
                  <div className="composer-tools">
                    <label
                      className={`private-toggle ${selectedRecipient === null ? "toggle-disabled" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedRecipient !== null && privateMessage}
                        disabled={selectedRecipient === null}
                        onChange={(event) =>
                          setPrivateMessage(event.target.checked)
                        }
                      />
                      <span className="custom-check">✓</span>
                      <span>Reservadamente</span>
                      <span className="lock-icon">⌑</span>
                    </label>
                    <span className="character-count">{draft.length}/200</span>
                    <button
                      className="send-button"
                      type="submit"
                      disabled={!draft.trim()}
                    >
                      Enviar <span>↗</span>
                    </button>
                  </div>
                </form>
                <div className="composer-hint">
                  <span>↵</span> Enter para enviar{" "}
                  <span className="hint-separator">·</span> Conversas
                  respeitosas fazem bem
                </div>
              </div>
            ) : (
              <div className="spy-notice">
                <span>◉</span>
                <div>
                  <strong>Modo espiar</strong>
                  <p>
                    Você acompanha a conversa em silêncio. Mensagens reservadas
                    não são exibidas.
                  </p>
                </div>
              </div>
            )}
          </section>
        </div>
      </main>
    );
  }

  if (activeRoom) {
    return (
      <main className="entry-page">
        <header className="entry-topbar">
          <button
            className="back-link"
            onClick={() => {
              setActiveRoom(null);
              setError("");
            }}
          >
            ← <span>Todas as salas</span>
          </button>
          <a
            className="brand brand-small"
            href="#inicio"
            onClick={(event) => event.preventDefault()}
          >
            <span className="brand-mark">b!</span>
            <span>Bate-papo</span>
          </a>
          <span className={`connection ${connected ? "is-online" : ""}`}>
            <i />
            {connected ? "Online" : "Conectando"}
          </span>
        </header>
        <section className="entry-card">
          <div className="entry-art">
            <div className="entry-art-orbit orbit-one" />
            <div className="entry-art-orbit orbit-two" />
            <span>{roomSymbol(activeRoom)}</span>
            <i>✦</i>
          </div>
          <p className="eyebrow">VOCÊ ESTÁ QUASE LÁ</p>
          <h1>
            Entrar em <em>{currentRoom?.name}</em>
          </h1>
          <p className="entry-copy">
            Escolha como quer participar dessa conversa.
          </p>
          <form onSubmit={handleEnter} className="entry-form">
            <label className="field-label" htmlFor="nickname">
              Seu apelido
            </label>
            <div className="nickname-field">
              <input
                id="nickname"
                autoComplete="nickname"
                type="text"
                maxLength={20}
                value={nickname}
                onChange={(event) => setNickname(event.target.value)}
                placeholder="Como podemos te chamar?"
              />
              <label
                className="color-picker"
                htmlFor="nickname-color"
                title="Cor do apelido"
              >
                <span style={{ backgroundColor: nicknameColor }} />
                <input
                  id="nickname-color"
                  type="color"
                  value={nicknameColor}
                  onChange={(event) => setNicknameColor(event.target.value)}
                  aria-label="Cor do apelido"
                />
              </label>
            </div>
            <p className="field-hint">
              Até 20 caracteres. Você pode escolher a cor do seu nome.
            </p>
            {error && (
              <div className="inline-error entry-error" role="alert">
                {error}
              </div>
            )}
            <button className="join-button" type="submit">
              Entrar na sala <span>→</span>
            </button>
          </form>
          <div className="entry-divider">
            <span>OU</span>
          </div>
          <button className="spy-button" onClick={handleSpy}>
            <span>◉</span> Espiar em silêncio
          </button>
          <p className="spy-caption">
            Somente leitura · sua presença não será exibida
          </p>
        </section>
        <footer className="page-footer">
          <span>Feito para conversas boas.</span>
          <span>✳</span>
        </footer>
      </main>
    );
  }

  return (
    <main className="home-page">
      <header className="home-topbar">
        <a
          className="brand"
          href="#inicio"
          onClick={(event) => event.preventDefault()}
        >
          <span className="brand-mark">b!</span>
          <span>Bate-papo</span>
        </a>
        <div className="topbar-center">
          <span className="presence-dot" /> Um lugar para conversar
        </div>
        <span className={`connection ${connected ? "is-online" : ""}`}>
          <i />
          {connected ? "Ao vivo" : "Conectando"}
        </span>
      </header>
      <section className="home-hero">
        <div className="hero-copy">
          <div className="hero-kicker">
            <span>✳</span> CONVERSAS QUE ACONTECEM AGORA
          </div>
          <h1>
            Tem sempre um
            <br />
            bom papo <em>por aqui.</em>
          </h1>
          <p>Escolha uma sala, chegue junto e deixe a conversa fluir.</p>
        </div>
        <div className="hero-illustration" aria-hidden="true">
          <div className="illustration-sun" />
          <div className="chat-bubble bubble-back">
            <span>e aí?</span>
            <i>✦</i>
          </div>
          <div className="chat-bubble bubble-front">
            <span>
              oi, tudo bem? <b>☺</b>
            </span>
          </div>
          <div className="hero-orbit">
            <span />
            <span />
            <span />
          </div>
          <div className="spark spark-one">✳</div>
          <div className="spark spark-two">✦</div>
        </div>
      </section>
      <section className="rooms-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">ENCONTRE SUA TURMA</p>
            <h2>
              Salas de conversa{" "}
              <span>{rooms.length.toString().padStart(2, "0")}</span>
            </h2>
          </div>
          <p className="live-caption">
            <i /> Pessoas chegando agora
          </p>
        </div>
        {error && (
          <div className="inline-error home-error" role="alert">
            {error}
          </div>
        )}
        <div className="room-grid">
          {rooms.map((room, index) => (
            <button
              className={`room-card room-card-${index % 4}`}
              key={room.id}
              onClick={() => enterRoom(room.id)}
            >
              <span className="room-card-icon">{roomSymbol(room.id)}</span>
              <span className="room-card-main">
                <strong>{room.name}</strong>
                <small>
                  {room.count === 0
                    ? "Seja o primeiro a chegar"
                    : `${room.count} ${room.count === 1 ? "pessoa" : "pessoas"} por aqui`}
                </small>
              </span>
              <span className="room-card-arrow">↗</span>
              <span
                className={`room-count ${room.count > 0 ? "has-people" : ""}`}
              >
                <i />
                {room.count}
              </span>
            </button>
          ))}
        </div>
      </section>
      <footer className="home-footer">
        <span>Um cantinho para todo tipo de conversa.</span>
        <span>
          Salas abertas <b>·</b> papo livre <b>·</b> gente de verdade
        </span>
      </footer>
    </main>
  );
};

const MessageRow = ({
  message,
  users
}: {
  message: ChatEvent;
  users: ChatUser[];
}) => {
  const recipient = users.find(
    (user) =>
      user.nick.toLocaleLowerCase("pt-BR") ===
      message.recipient.toLocaleLowerCase("pt-BR")
  );
  const time = new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(message.createdAt));

  if (message.type === "join" || message.type === "leave") {
    return (
      <article className="system-message">
        <span className="system-symbol">
          {message.type === "join" ? "↗" : "↙"}
        </span>
        <span>
          <strong style={{ color: message.senderColor }}>
            {message.sender}
          </strong>{" "}
          {message.type === "join" ? "entrou no chat" : "saiu do chat"}
        </span>
        <time>{time}</time>
      </article>
    );
  }

  return (
    <article className="message-row">
      <span
        className="message-avatar"
        style={{ "--avatar-color": message.senderColor } as CSSProperties}
      >
        {message.sender.slice(0, 1).toLocaleUpperCase("pt-BR")}
      </span>
      <div className="message-body">
        <div className="message-meta">
          <strong style={{ color: message.senderColor }}>
            {message.sender}
          </strong>
          {message.private && (
            <span className="message-private">⌑ reservado</span>
          )}
          <time>{time}</time>
        </div>
        <p className="message-text">
          {message.private ? "reservadamente disse a " : "disse a "}
          <strong style={{ color: recipient?.color }}>
            {message.recipient}
          </strong>
          : {message.text}
        </p>
      </div>
    </article>
  );
};

const roomSymbol = (room: RoomId): string => {
  const symbols: Record<RoomId, string> = {
    "papo-livre": "✳",
    musica: "♫",
    esportes: "◉",
    cinema: "▣",
    amizade: "♡",
    tecnologia: "⌘",
    viagens: "⌖",
    games: "✣"
  };

  return symbols[room];
};

const rootElement = document.getElementById("root");

if (rootElement) {
  createRoot(rootElement).render(<App />);
}
