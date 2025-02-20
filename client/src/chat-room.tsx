import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { Panel } from "primereact/panel";
import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { useNavigate, useParams } from "react-router";
import { z } from "zod";
import { ChatRoomService } from "./chat-room-service";
import { useToast } from "./toast-provider";

const service = new ChatRoomService();

const Form = () => {
  const schema = z.object({
    name: z.string().max(50)
  });

  type FormData = z.infer<typeof schema>;

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting }
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: ""
    }
  });

  const params = useParams();

  useEffect(() => {
    const loadData = async () => {
      if (params.id) {
        const data = await service.findById(parseInt(params.id));
        reset(data);
      }
    };

    loadData();
  }, [params.id, reset]);

  const navigate = useNavigate();

  const toastRef = useToast();

  const showError = (message: string) => {
    toastRef?.current?.show?.({
      severity: "error",
      summary: "Error",
      detail: message,
      life: 5000
    });
  };

  const showSuccess = (message: string) => {
    toastRef?.current?.show?.({
      severity: "success",
      summary: "Info",
      detail: message,
      life: 5000
    });
  };

  const handleFormSubmit = async (data: FormData) => {
    try {
      if (params.id) {
        await service.update(parseInt(params.id), data);
      } else {
        await service.create(data);
      }

      showSuccess(
        `ChatRoom ${params.id ? "updated" : "created"} with success!`
      );
      navigate("/chatRooms");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Error saving the chatroom";
      showError(message);
    }
  };

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)}>
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

      <div className="grid">
        <div className="col-12">
          <Button
            label={params.id ? "Update" : "Create"}
            type="submit"
            loading={isSubmitting}
          />
        </div>
      </div>
    </form>
  );
};

const ChatRoom = () => {
  const params = useParams();

  return (
    <Panel header={params.id ? `Chat Room ${params.id}` : "New Chat Room"}>
      <Form />
    </Panel>
  );
};

export default ChatRoom;
