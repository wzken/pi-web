import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "./router";
import { AuthProvider } from "./auth";
import { ToastProvider } from "./components";
import { App } from "./App";
import { LanguageProvider } from "./i18n";
import "./mdui/register";
import { startSystemColorSchemeSync } from "./system-color-scheme";

startSystemColorSchemeSync(
  document.documentElement,
  window.matchMedia("(prefers-color-scheme: dark)"),
  new URLSearchParams(window.location.search).get("safe-theme") === "1"
    ? "light"
    : undefined
);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LanguageProvider>
      <BrowserRouter>
        <AuthProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </LanguageProvider>
  </StrictMode>
);
