import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "./router";
import { AuthProvider } from "./auth";
import { ToastProvider } from "./components";
import { App } from "./App";
import { LanguageProvider } from "./i18n";
import "./app.css";
import {
  applySystemColorScheme,
  initialColorScheme
} from "./system-color-scheme";
import { ThemeProvider } from "./theme";
import {
  applyMaterialThemeSettingsToRoot,
  readMaterialThemeSettings
} from "./theme-customization";

const colorScheme = initialColorScheme();
applySystemColorScheme(document.documentElement, colorScheme);
const materialTheme = readMaterialThemeSettings();
if (materialTheme.enabled) {
  applyMaterialThemeSettingsToRoot(
    document.documentElement,
    materialTheme,
    colorScheme
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LanguageProvider>
      <BrowserRouter>
        <AuthProvider>
          <ThemeProvider>
            <ToastProvider>
              <App />
            </ToastProvider>
          </ThemeProvider>
        </AuthProvider>
      </BrowserRouter>
    </LanguageProvider>
  </StrictMode>
);
