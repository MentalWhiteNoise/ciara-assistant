import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";

// QueryClient is the TanStack Query cache manager.
// It holds all fetched API data and manages re-fetching.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Don't retry failed requests immediately — wait and see
      retry: 1,
      // Data is considered "fresh" for 30 seconds before background refetch
      staleTime: 30_000,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {/* BrowserRouter handles URL-based navigation */}
    <BrowserRouter>
      {/* QueryClientProvider makes the cache available to all components */}
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </BrowserRouter>
  </React.StrictMode>
);
