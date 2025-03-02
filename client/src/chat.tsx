import { zodResolver } from "@hookform/resolvers/zod";
import { format, parseISO } from "date-fns";
import { Button } from "primereact/button";
import { Checkbox } from "primereact/checkbox";
import { ColorPicker } from "primereact/colorpicker";
import { confirmDialog } from "primereact/confirmdialog";
import { Dialog } from "primereact/dialog";
import { InputText } from "primereact/inputtext";
import { ListBox } from "primereact/listbox";
import { Panel } from "primereact/panel";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { useNavigate, useParams } from "react-router";
import { io } from "socket.io-client";
import { z } from "zod";
import { ChatRoom, ChatRoomService } from "./chat-room-service";
import { useToast } from "./toast-provider";

const service = new ChatRoomService();

const socket = io({
  transports: ["websocket"],
  autoConnect: true
});

interface ChatUser {
  id: string;
  name: string;
  blocked: string[];
  uuid?: string;
  color?: string;
}

interface ChatMessage {
  id: number;
  sender: string;
  receiver?: string;
  message: string;
  dateTime: string;
  private?: boolean;
  color?: string;
  deleted?: boolean;
}

const Sidebar = ({
  value,
  onChange,
  user,
  chatRoom
}: {
  value: ChatUser;
  onChange: (value: ChatUser) => void;
  user?: ChatUser;
  chatRoom?: ChatRoom;
}) => {
  const toastRef = useToast();

  const [people, setPeople] = useState<ChatUser[]>([]);

  useEffect(() => {
    const handlePeople = (people: ChatUser[]) => setPeople(people);

    socket.on("people", handlePeople);

    return () => {
      socket.off("people", handlePeople);
    };
  }, []);

  const userBlockedSet = new Set(user?.blocked || []);

  return (
    <div className="h-full flex flex-column gap-2">
      <ListBox
        className="flex-1"
        css={{ minWidth: "250px" }}
        pt={{
          emptyMessage: {
            className: "text-center"
          }
        }}
        emptyMessage="Sem usuários"
        value={value}
        onChange={(e) => onChange(e.value)}
        options={people}
        optionLabel="name"
        itemTemplate={(option) => {
          const isBlocked = userBlockedSet.has(option.name);

          return (
            <div
              className={`flex align-items-center ${
                isBlocked ? "opacity-50" : ""
              }`}
              style={{ color: option.color ? `#${option.color}` : undefined }}
            >
              {option.name === user?.name && (
                <i className="pi pi-star mr-2"></i>
              )}
              <div className={option.name === user?.name ? "font-bold" : ""}>
                {option.name}
              </div>
              {isBlocked && <i className="pi pi-ban ml-auto"></i>}
            </div>
          );
        }}
      />

      <Button
        label={
          value && userBlockedSet.has(value.name) ? "Desbloquear" : "Bloquear"
        }
        icon="pi pi-ban"
        severity="danger"
        disabled={
          !value || value.name === "Everyone" || value.name === user?.name
        }
        onClick={() => {
          if (value) {
            socket.emit(
              "block",
              {
                roomId: chatRoom?.id,
                name: user?.name,
                target: value.name
              },
              (response: { error?: string }) => {
                if (response?.error) {
                  toastRef?.current?.show?.({
                    severity: "error",
                    summary: "Error",
                    detail: response.error,
                    life: 5000
                  });
                }
              }
            );
          }
        }}
      />
    </div>
  );
};

const Messages = ({
  chatRoom,
  user
}: {
  chatRoom?: ChatRoom;
  user?: ChatUser;
}) => {
  const toastRef = useToast();

  const [messages, setMessages] = useState<ChatMessage[]>([]);

  useEffect(() => {
    const handleMessages = (message: ChatMessage | ChatMessage[]) => {
      setMessages((prev) => {
        const newMessages = Array.isArray(message) ? message : [message];
        const existingIds = new Set(prev.map((m) => m.id));
        const filteredMessages = newMessages.filter(
          (m) => !existingIds.has(m.id)
        );

        return [...prev, ...filteredMessages];
      });
    };

    const handleMessageDeleted = ({ id }: { id: number }) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, deleted: true } : m))
      );
    };

    socket.on("message", handleMessages);
    socket.on("messageDeleted", handleMessageDeleted);

    return () => {
      socket.off("message", handleMessages);
      socket.off("messageDeleted", handleMessageDeleted);
    };
  }, []);

  const isValidURL = (text: string) => {
    try {
      new URL(text);
      return true;
    } catch {
      return false;
    }
  };

  const isMediaURL = (text: string) => {
    const imageRegex = /\.(jpeg|jpg|gif|png|webp)$/i;
    const videoRegex = /\.(mp4|webm|ogv)$/i;
    const audioRegex = /\.(mp3|wav|ogg|m4a)$/i;

    const isYouTube = isYouTubeURL(text);

    return {
      isImage: imageRegex.test(text) && !isYouTube,
      isVideo: videoRegex.test(text) && !isYouTube,
      isAudio: audioRegex.test(text) && !isYouTube
    };
  };

  const isYouTubeURL = (url: string) => {
    try {
      const parsed = new URL(url);

      return (
        parsed.hostname.includes("youtube.com") ||
        parsed.hostname.includes("youtu.be")
      );
    } catch {
      return false;
    }
  };

  const getYouTubeId = (url: string) => {
    const regExp =
      /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    return match && match[2].length === 11 ? match[2] : null;
  };

  return (
    <div
      className="h-full flex flex-column flex-1 overflow-y-auto"
      css={{
        border: "1px solid #dee2e6",
        borderRadius: "4px",
        padding: "20px"
      }}
    >
      {messages.map((m) => {
        let title = null;

        if (m.private === true) {
          title = (
            <>
              <span
                style={{
                  color: m?.color ? `#${m.color}` : undefined
                }}
              >
                {m.sender}
              </span>{" "}
              says privately to {m.receiver}:
            </>
          );
        } else if (m.receiver) {
          title = (
            <>
              <span
                style={{
                  color: m?.color ? `#${m.color}` : undefined
                }}
              >
                {m.sender}
              </span>{" "}
              says to {m.receiver}:
            </>
          );
        } else {
          title = (
            <>
              <span
                style={{
                  color: m?.color ? `#${m.color}` : undefined
                }}
              >
                {m.sender}
              </span>{" "}
              says:
            </>
          );
        }

        return (
          <div className="flex flex-column gap-2 mb-2" key={m.id}>
            <div className="flex">
              <div className="font-bold">{title}</div>
              <div className="ml-auto text-sm flex align-items-center gap-2">
                {format(parseISO(m.dateTime), "dd/MM/yyyy HH:mm")}
                {!m.deleted && user?.name === m.sender && (
                  <Button
                    icon="pi pi-trash"
                    className="p-button-text p-button-sm"
                    onClick={() =>
                      confirmDialog({
                        message:
                          "Are you sure you want to delete this message?",
                        header: "Delete Message",
                        icon: "pi pi-exclamation-triangle",
                        accept: () =>
                          socket.emit(
                            "deleteMessage",
                            {
                              roomId: chatRoom?.id,
                              messageId: m.id
                            },
                            (response: { error?: string }) => {
                              if (response?.error) {
                                toastRef?.current?.show?.({
                                  severity: "error",
                                  summary: "Error",
                                  detail: response.error,
                                  life: 5000
                                });
                              }
                            }
                          )
                      })
                    }
                  />
                )}
              </div>
            </div>

            <div>
              {!m.deleted && isValidURL(m.message) ? (
                <>
                  {isYouTubeURL(m.message) ? (
                    <div className="youtube-container">
                      <iframe
                        width="100%"
                        height="315"
                        src={`https://www.youtube-nocookie.com/embed/${getYouTubeId(
                          m.message
                        )}?modestbranding=1&rel=0`}
                        frameBorder="0"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                        title="YouTube video player"
                      />
                    </div>
                  ) : (
                    <>
                      {isMediaURL(m.message).isImage && (
                        <img
                          src={m.message}
                          alt="Content"
                          style={{ maxWidth: "100%", maxHeight: "200px" }}
                        />
                      )}
                      {isMediaURL(m.message).isVideo && (
                        <video
                          controls
                          style={{ maxWidth: "100%", maxHeight: "200px" }}
                        >
                          <source src={m.message} />
                        </video>
                      )}
                      {isMediaURL(m.message).isAudio && (
                        <audio controls style={{ width: "100%" }}>
                          <source src={m.message} />
                        </audio>
                      )}
                      {!isMediaURL(m.message).isImage &&
                        !isMediaURL(m.message).isVideo &&
                        !isMediaURL(m.message).isAudio && (
                          <a
                            href={m.message}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {m.message}
                          </a>
                        )}
                    </>
                  )}
                </>
              ) : m.deleted ? (
                <div css={{ color: "#6c757d", fontStyle: "italic" }}>
                  Message deleted
                </div>
              ) : (
                <div>{m.message}</div>
              )}
            </div>

            <div css={{ borderBottom: "1px solid #ced4da" }}></div>
          </div>
        );
      })}
    </div>
  );
};

const Footer = ({
  chatRoom,
  user,
  target
}: {
  chatRoom?: ChatRoom;
  user?: ChatUser;
  target?: ChatUser;
}) => {
  const toastRef = useToast();

  const navigate = useNavigate();

  const [message, setMessage] = useState("");

  const [privateMessage, setPrivateMessage] = useState(false);

  const sendMessage = () => {
    socket.emit(
      "message",
      {
        name: user?.name,
        roomId: chatRoom?.id,
        message,
        privateMessage: target?.name === "Everyone" ? false : privateMessage,
        target: target?.name === "Everyone" ? undefined : target?.name
      },
      (response: { error?: string }) => {
        if (response?.error) {
          toastRef?.current?.show?.({
            severity: "error",
            summary: "Error",
            detail: response.error,
            life: 5000
          });
        }
      }
    );
    setMessage("");
  };

  return (
    <footer className="flex flex-column gap-2">
      <div className="flex align-items-center gap-2">
        <InputText
          className="flex-1 w-full"
          css={{ minWidth: "50px" }}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && message.trim() !== "") {
              e.preventDefault();
              sendMessage();
            }
          }}
        />

        <div
          className="gap-2 flex-shrink-0"
          css={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr"
          }}
        >
          <Button
            label="Enviar"
            icon="pi pi-send"
            onClick={() => sendMessage()}
            disabled={message.trim() === ""}
          />

          <Button
            label="Sair"
            severity="danger"
            icon="pi pi-sign-out"
            onClick={() =>
              confirmDialog({
                message: `Do you want to logout room ${chatRoom?.name}?`,
                header: "Exit",
                icon: "pi pi-exclamation-triangle",
                defaultFocus: "reject",
                acceptClassName: "p-button-danger",
                accept: () => {
                  socket.emit(
                    "logout",
                    {
                      roomId: chatRoom?.id,
                      name: user?.name
                    },
                    (response: { error?: string }) => {
                      if (response?.error) {
                        toastRef?.current?.show?.({
                          severity: "error",
                          summary: "Error",
                          detail: response.error,
                          life: 5000
                        });
                      } else {
                        sessionStorage.removeItem("user");
                        navigate("/");
                      }
                    }
                  );
                }
              })
            }
          />
        </div>
      </div>

      <div className="flex align-items-center w-full">
        <Checkbox
          inputId="private"
          name="private"
          value="private"
          checked={privateMessage}
          onChange={(e) => setPrivateMessage(e.checked as boolean)}
          disabled={target?.name === "Everyone"}
        />
        <label htmlFor="private" className="ml-2">
          Private message
        </label>
      </div>
    </footer>
  );
};

const LoginDialog = ({
  visible,
  chatRoom,
  onHide
}: {
  visible: boolean;
  chatRoom?: ChatRoom;
  onHide: () => void;
}) => {
  const toastRef = useToast();

  const schema = z.object({
    name: z
      .string()
      .max(20)
      .superRefine((val, ctx) => {
        if (val.trim().length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Name is required"
          });
        }
      }),
    color: z.string().optional()
  });

  type FormData = z.infer<typeof schema>;

  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting }
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      color: undefined
    }
  });

  const handleFormSubmit = async (data: FormData) => {
    socket.emit(
      "join",
      {
        roomId: chatRoom?.id,
        name: data.name,
        color: data.color
      },
      (response: { error?: string }) => {
        if (response?.error) {
          toastRef?.current?.show?.({
            severity: "error",
            summary: "Error",
            detail: response.error,
            life: 5000
          });
        } else {
          onHide();
        }
      }
    );
  };

  return (
    <Dialog
      header="Login"
      visible={visible}
      onHide={onHide}
      footer={
        <>
          <Button
            form="loginDialogForm"
            label="Login"
            type="submit"
            loading={isSubmitting}
          />
        </>
      }
      className="w-30rem"
      closable={false}
      draggable={false}
      resizable={false}
    >
      <form id="loginDialogForm" onSubmit={handleSubmit(handleFormSubmit)}>
        <div className="grid">
          <div className="col-12">
            <label htmlFor="name" className="block mb-1">
              Name
            </label>
            <Controller
              name="name"
              control={control}
              render={({ field }) => (
                <InputText
                  id="name"
                  type="text"
                  {...field}
                  className={
                    errors.name ? "w-full mb-1 p-invalid" : "w-full mb-1"
                  }
                />
              )}
            />
            {errors.name && (
              <small className="p-error">{errors.name.message}</small>
            )}
          </div>
          <div className="col-12">
            <label htmlFor="color" className="block mb-1">
              Color
            </label>
            <Controller
              name="color"
              control={control}
              render={({ field }) => (
                <ColorPicker id="color" {...field} className="mb-1" />
              )}
            />
          </div>
        </div>
      </form>
    </Dialog>
  );
};

const Chat = () => {
  const toastRef = useToast();

  const params = useParams();

  const [user, setUser] = useState<ChatUser>();

  const [target, setTarget] = useState<ChatUser>({
    id: "-1",
    name: "Everyone",
    blocked: []
  });

  const [chatRoom, setChatRoom] = useState<ChatRoom>();

  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (params.id) {
      const loadData = async () => {
        const chatRoom = await service.findById(parseInt(params.id as string));
        setChatRoom(chatRoom);
      };

      loadData();
    }
  }, [params.id]);

  useEffect(() => {
    const handleUpdateUser = (user: ChatUser) => {
      sessionStorage.setItem(
        "user",
        JSON.stringify({
          roomId: chatRoom?.id,
          name: user.name,
          uuid: user.uuid
        })
      );

      setUser(user);
    };

    socket.on("updateUser", handleUpdateUser);

    return () => {
      socket.off("updateUser", handleUpdateUser);
    };
  }, [chatRoom?.id]);

  useEffect(() => {
    const user = sessionStorage.getItem("user");

    if (user) {
      const { roomId, name, uuid } = JSON.parse(user);

      socket.emit(
        "join",
        {
          roomId,
          name,
          uuid
        },
        (response: { error?: string }) => {
          if (response?.error) {
            if (response?.error) {
              toastRef?.current?.show?.({
                severity: "error",
                summary: "Error",
                detail: response.error,
                life: 5000
              });
            }
          } else {
            setVisible(false);
          }
        }
      );
    }
  }, [toastRef]);

  useEffect(() => {
    const interval = setInterval(() => {
      const user = sessionStorage.getItem("user");

      if (socket.connected && user) {
        const { roomId, name } = JSON.parse(user);

        socket.emit(
          "heartbeat",
          {
            roomId,
            name
          },
          (response: { error?: string }) => {
            if (response?.error) {
              if (response?.error) {
                toastRef?.current?.show?.({
                  severity: "error",
                  summary: "Error",
                  detail: response.error,
                  life: 5000
                });
              }
            }
          }
        );
      }
    }, 30000);

    return () => clearInterval(interval);
  }, [toastRef]);

  return (
    <>
      <Panel
        header={chatRoom?.name}
        className="h-full flex flex-column"
        pt={{
          content: {
            className: "h-full flex flex-column"
          },
          toggleableContent: {
            style: { height: "calc(100% - 50px)" }
          }
        }}
      >
        <div className="h-full flex flex-column gap-2">
          <div className="h-full flex flex-1 gap-2 overflow-hidden">
            <Sidebar
              value={target}
              onChange={(target) => setTarget(target)}
              user={user}
              chatRoom={chatRoom}
            />
            <Messages chatRoom={chatRoom} user={user} />
          </div>
          <Footer chatRoom={chatRoom} user={user} target={target} />
        </div>
      </Panel>

      <LoginDialog
        visible={visible}
        chatRoom={chatRoom}
        onHide={() => setVisible(false)}
      />
    </>
  );
};

export default Chat;
