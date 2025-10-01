import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./styles.css"; // global styles

// Create TanStack Query client (wagmi v2 depends on it)
const queryClient = new QueryClient();

const el = document.getElementById("root");
if (el) {
  createRoot(el).render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  );
}
