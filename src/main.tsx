import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

// Simple boot log to verify bundle runs
console.log("[WoollyGotchi] boot");

const el = document.getElementById("root");
if (!el) {
  const warn = document.createElement("div");
  warn.textContent = "Root element not found.";
  document.body.appendChild(warn);
} else {
  createRoot(el).render(React.createElement(App));
}
