import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "./router";
import { AuthProvider } from "./auth";
import { ToastProvider } from "./components";
import { App } from "./App";
import { ThemeProvider } from "./theme";
import { LanguageProvider } from "./i18n";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LanguageProvider>
      <ThemeProvider>
        <BrowserRouter>
          <AuthProvider>
            <ToastProvider>
              <App />
            </ToastProvider>
          </AuthProvider>
        </BrowserRouter>
      </ThemeProvider>
    </LanguageProvider>
  </StrictMode>
);
