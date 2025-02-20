import { zodResolver } from "@hookform/resolvers/zod";
import { format } from "date-fns";
import { Button } from "primereact/button";
import { Card } from "primereact/card";
import { Column } from "primereact/column";
import { confirmDialog } from "primereact/confirmdialog";
import { DataTable } from "primereact/datatable";
import { InputText } from "primereact/inputtext";
import { Panel } from "primereact/panel";
import { useEffect, useState } from "react";
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
  onChange,
  loading
}: {
  value: ChatRoom[];
  onChange: () => void;
  loading: boolean;
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
      loading={loading}
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
  const [loading, setLoading] = useState(false);
  const toastRef = useToast();

  useEffect(() => {
    const loadInitialData = async () => {
      try {
        setLoading(true);
        const data = await service.findAll();
        setChatRooms(data);
      } catch {
        showError("Failed to load chat rooms");
      } finally {
        setLoading(false);
      }
    };

    loadInitialData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSearch = async (filter?: { name: string }) => {
    try {
      setLoading(true);
      const data = await service.findAll(filter?.name);
      setChatRooms(data);
    } catch {
      showError("Failed to search chat rooms");
    } finally {
      setLoading(false);
    }
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

        <Table value={chatRooms} loading={loading} onChange={handleSearch} />
      </div>
    </Panel>
  );
};

export default ChatRooms;
