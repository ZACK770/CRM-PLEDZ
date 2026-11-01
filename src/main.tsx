import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { MarketingApp } from "./Marketing";
import "./style.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {location.pathname.startsWith(import.meta.env.BASE_URL + "marketing") ? <MarketingApp /> : <App />}
  </React.StrictMode>,
);
