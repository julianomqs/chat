import { zodResolver } from "@hookform/resolvers/zod";
import { format, parseISO } from "date-fns";
import { Button } from "primereact/button";
import { Card } from "primereact/card";
import { Checkbox } from "primereact/checkbox";
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
}

const Sidebar = ({
  value,
  onChange,
  user
}: {
  value: ChatUser;
  onChange: (value: ChatUser) => void;
  user?: ChatUser;
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
    <div className="flex flex-column gap-2">
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
            >
              {option.name === user?.name && (
                <i className="pi pi-star mr-2"></i>
              )}
              <div>{option.name}</div>
              {isBlocked && <i className="pi pi-ban ml-auto text-red-500"></i>}
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
              { name: user?.name, target: value.name },
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (response: any) => {
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

interface ChatMessage {
  sender: string;
  receiver?: string;
  message: string;
  dateTime: string;
  private?: boolean;
}

const Messages = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  useEffect(() => {
    const handleMessages = (message: ChatMessage) => {
      setMessages((prev) => [...prev, message]);
    };

    socket.on("message", handleMessages);

    return () => {
      socket.off("message", handleMessages);
    };
  }, []);

  return (
    <Card className="flex-1 overflow-y-auto">
      {messages.map((m, idx) => {
        let title = "";

        if (m.private === true) {
          title = `${m.sender} says privately to ${m.receiver}:`;
        } else if (m.receiver) {
          title = `${m.sender} says to ${m.receiver}:`;
        } else {
          title = `${m.sender} says:`;
        }

        return (
          <div className="flex flex-column gap-2 mb-2" key={idx}>
            <div className="flex">
              <div className="font-bold">{title}</div>
              <div className="ml-auto text-sm">
                {format(parseISO(m.dateTime), "dd/MM/yyyy HH:mm")}
              </div>
            </div>

            <div>{m.message}</div>

            <div css={{ borderBottom: "1px solid #ced4da" }}></div>
          </div>
        );
      })}
    </Card>
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
        message,
        privateMessage: target?.name === "Everyone" ? false : privateMessage,
        target: target?.name === "Everyone" ? undefined : target?.name
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (response: any) => {
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
    <footer className="flex gap-2 flex-column">
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
                  socket.disconnect();
                  navigate("/");
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
    name: z.string().max(20)
  });

  type FormData = z.infer<typeof schema>;

  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting }
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: ""
    }
  });

  const handleFormSubmit = async (data: FormData) => {
    socket.emit(
      "join",
      { roomId: chatRoom?.id, name: data.name },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (response: any) => {
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
        </div>
      </form>
    </Dialog>
  );
};

const Chat = () => {
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
    const handleUpdateUser = (user: ChatUser) => setUser(user);

    socket.on("updateUser", handleUpdateUser);

    return () => {
      socket.off("updateUser", handleUpdateUser);
    };
  }, []);

  return (
    <>
      <Panel
        header={chatRoom?.name}
        className="h-full"
        pt={{
          content: {
            className: "h-full"
          },
          toggleableContent: {
            style: { height: "calc(100% - 50px)" }
          }
        }}
      >
        <div className="flex flex-column h-full gap-2">
          <div className="flex flex-1 gap-2">
            <Sidebar
              value={target}
              onChange={(target) => setTarget(target)}
              user={user}
            />
            <Messages />
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
