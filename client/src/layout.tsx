import { Outlet } from "react-router";

const Layout = () => (
  <div className="h-full" css={{ padding: "20px" }}>
    <Outlet />
  </div>
);

export default Layout;
