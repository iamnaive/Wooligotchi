import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

console.log("[WoollyGotchi] boot");

// TanStack Query client required by wagmi v2
const queryClient = new QueryClient();

const el = document.getElementById("root");
if (el) {
  createRoot(el).render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  );
}
