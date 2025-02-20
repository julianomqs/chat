import { css, Global } from "@emotion/react";
import normalize from "normalize.css?raw";
import primeflex from "primeflex/primeflex.css?raw";
import { PrimeReactProvider } from "primereact/api";
import { ConfirmDialog } from "primereact/confirmdialog";
import primereactCore from "primereact/resources/primereact.min.css?raw";
import primereactTheme from "primereact/resources/themes/bootstrap4-light-blue/theme.css?raw";
import { BrowserRouter, Route, Routes } from "react-router";
import ChatRoom from "./chat-room";
import ChatRooms from "./chat-rooms";
import Home from "./home";
import Layout from "./layout";

import "primeicons/primeicons.css";
import Chat from "./chat";
import { ToastProvider } from "./toast-provider";

const App = () => (
  <PrimeReactProvider>
    <ConfirmDialog />
    <Global
      styles={css`
        @layer normalize, primereact, primeflex;

        @layer normalize {
          ${normalize}
        }

        @layer primereact {
          ${primereactCore}
          ${primereactTheme}
        }

        @layer primeflex {
          ${primeflex}
        }

        html,
        body,
        div#root {
          height: 100%;
          width: 100%;
        }

        .p-card .p-card-content {
          padding: 0;
        }
      `}
    />
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route path="chatRooms" element={<ChatRooms />} />
            <Route path="chatRoom" element={<ChatRoom />}>
              <Route path=":id" element={<ChatRoom />} />
            </Route>
            <Route path="/chat/:id" element={<Chat />} />
            <Route path="/" element={<Home />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  </PrimeReactProvider>
);

export default App;
