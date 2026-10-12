import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import RiderApp from "./components/Rider/RiderApp.jsx";
import "./index.css";

const path = window.location.pathname;

const RootApp = path.startsWith("/rider") ? RiderApp : App;

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <RootApp />
  </StrictMode>
);
