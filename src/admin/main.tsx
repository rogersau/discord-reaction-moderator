import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import App from "./App";

const root = document.getElementById("admin-root");
if (!root) throw new Error("Missing #admin-root element");

const initialAuthenticated = root.dataset.authenticated === "true";
const initialPath = root.dataset.initialPath ?? "/admin";
const initialSearch = root.dataset.initialSearch ?? "";

createRoot(root).render(
  <StrictMode>
    <App
      initialAuthenticated={initialAuthenticated}
      initialPath={initialPath}
      initialSearch={initialSearch}
    />
  </StrictMode>,
);
