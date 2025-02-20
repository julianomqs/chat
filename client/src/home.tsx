import { useEffect, useState } from "react";
import { ChatRoom, ChatRoomService } from "./chat-room-service";
import { Card } from "primereact/card";
import { useNavigate } from "react-router";

const service = new ChatRoomService();

const Home = () => {
  const [chatRooms, setChatRooms] = useState<ChatRoom[]>([]);

  const navigate = useNavigate();

  useEffect(() => {
    const loadData = async () => {
      const chatRooms = await service.findAll();
      setChatRooms(chatRooms);
    };

    loadData();
  }, []);

  return (
    <div className="grid">
      {chatRooms.map((cr) => (
        <div className="col-3" key={cr.id}>
          <Card
            title={cr.name}
            css={{ cursor: "pointer" }}
            onClick={() => navigate(`/chat/${cr.id}`)}
          >
            <div className="flex align-items-center">
              <i className="pi pi-users mr-2"></i>
              <span>{cr.count}</span>
              <i className="pi pi-chevron-right ml-auto"></i>
            </div>
          </Card>
        </div>
      ))}
    </div>
  );
};

export default Home;
