import { zodResolver } from "@hookform/resolvers/zod";
import { format } from "date-fns";
import { BlockUI } from "primereact/blockui";
import { Button } from "primereact/button";
import { Card } from "primereact/card";
import { Column } from "primereact/column";
import { confirmDialog } from "primereact/confirmdialog";
import { DataTable } from "primereact/datatable";
import { InputText } from "primereact/inputtext";
import { Panel } from "primereact/panel";
import { ProgressSpinner } from "primereact/progressspinner";
import { useEffect, useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { useNavigate } from "react-router";
import { useDebouncedCallback } from "use-debounce";
import { z } from "zod";
import { ChatRoom, ChatRoomService } from "./chat-room-service";
import { useToast } from "./toast-provider";

const service = new ChatRoomService();

const SearchForm = ({
  onChange
}: {
  onChange: (data: { name: string }) => void;
}) => {
  const schema = z.object({
    name: z.string().max(255)
  });

  type FormData = z.infer<typeof schema>;

  const {
    control,
    handleSubmit,
    formState: { errors }
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: ""
    }
  });

  const debouncedSearch = useDebouncedCallback((data: FormData) => {
    onChange(data);
  }, 300);

  return (
    <Card>
      <form onSubmit={handleSubmit(debouncedSearch)}>
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
                  onChange={(e) => {
                    field.onChange(e);
                    debouncedSearch({ name: e.target.value });
                  }}
                  aria-label="Search chat rooms by name"
                />
              )}
            />
            {errors.name && (
              <small className="p-error">{errors.name.message}</small>
            )}
          </div>
        </div>
      </form>
    </Card>
  );
};

const Table = ({
  value,
  onChange
}: {
  value: ChatRoom[];
  onChange: () => void;
}) => {
  const navigate = useNavigate();

  const toastRef = useToast();

  const showSuccess = (message: string) => {
    toastRef?.current?.show({
      severity: "success",
      summary: "Info",
      detail: message,
      life: 5000
    });
  };

  return (
    <DataTable
      value={value}
      paginator
      rows={10}
      emptyMessage="No chat rooms found"
    >
      <Column
        field="id"
        header="ID"
        sortable
        align="center"
        alignHeader="center"
      />
      <Column field="name" header="Name" sortable />
      <Column
        field="createdAt"
        header="Created At"
        sortable
        body={(rowData) => format(rowData.createdAt, "dd/MM/yyyy HH:mm")}
        align="center"
        alignHeader="center"
      />
      <Column
        body={(rowData) => (
          <div className="flex gap-2">
            <Button
              icon="pi pi-pencil"
              size="small"
              onClick={() => navigate(`/chatroom/${rowData.id}`)}
              aria-label={`Edit record ${rowData.id}`}
            />
            <Button
              icon="pi pi-trash"
              severity="danger"
              size="small"
              onClick={() =>
                confirmDialog({
                  message: `Do you want to delete record ${rowData.name}?`,
                  header: "Delete",
                  icon: "pi pi-exclamation-triangle",
                  defaultFocus: "reject",
                  acceptClassName: "p-button-danger",
                  accept: async () => {
                    await service.delete(rowData.id);

                    showSuccess("Record removed with success!");

                    onChange();
                  }
                })
              }
              aria-label={`Delete record ${rowData.id}`}
            />
          </div>
        )}
        align="center"
        alignHeader="center"
      />
    </DataTable>
  );
};

const ChatRooms = () => {
  const navigate = useNavigate();
  const [chatRooms, setChatRooms] = useState<ChatRoom[]>([]);
  const toastRef = useToast();
  const [isPending, startTransition] = useTransition();

  const loadInitialData = () => {
    startTransition(async () => {
      try {
        const data = await service.findAll();
        setChatRooms(data);
      } catch {
        showError("Failed to load chat rooms");
      }
    });
  };

  useEffect(() => {
    loadInitialData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSearch = (filter?: { name: string }) => {
    startTransition(async () => {
      try {
        const data = await service.findAll(filter?.name);
        setChatRooms(data);
      } catch {
        showError("Failed to search chat rooms");
      }
    });
  };

  const showError = (message: string) => {
    toastRef?.current?.show({
      severity: "error",
      summary: "Error",
      detail: message,
      life: 5000
    });
  };

  return (
    <>
      <BlockUI fullScreen blocked={isPending} template={<ProgressSpinner />} />

      <Panel header="Chat Rooms">
        <div className="flex flex-column gap-3">
          <Button
            label="New Chat Room"
            onClick={() => navigate("/chatroom")}
            className="align-self-start"
            icon="pi pi-plus"
            aria-label="Create new chat room"
          />

          <SearchForm onChange={handleSearch} />

          <Table value={chatRooms} onChange={handleSearch} />
        </div>
      </Panel>
    </>
  );
};

export default ChatRooms;
