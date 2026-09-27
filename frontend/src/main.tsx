import "@fontsource-variable/inter";
import "@fontsource-variable/plus-jakarta-sans";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import App from "./App";
import { AuthProvider } from "./lib/auth";
import { ConfirmProvider } from "./lib/confirm";
import { PhotoViewerProvider } from "./lib/photoViewer";
import { ThemeProvider } from "./lib/theme";
import { ToastProvider } from "./lib/toast";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        <AuthProvider>
          <ToastProvider>
            <ConfirmProvider>
              <PhotoViewerProvider>
                <App />
              </PhotoViewerProvider>
            </ConfirmProvider>
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>,
);
