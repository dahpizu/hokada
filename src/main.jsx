import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";

const App = lazy(() => import("./App.jsx"));
const RiderApp = lazy(() => import("./components/Rider/RiderApp.jsx"));

const path = window.location.pathname.replace(/^\/hokada/, "") || "/";
const params = new URLSearchParams(window.location.search);

const isRiderApp = path.startsWith("/rider") || params.get("app") === "rider";

const RootApp = isRiderApp ? RiderApp : App;

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <Suspense fallback={<main className="app-loading">Loading HOKADA…</main>}>
      <RootApp />
    </Suspense>
  </StrictMode>
);
