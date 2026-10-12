import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "./index.css"
import App from "./App"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { I18nProvider } from "@/i18n"
import { registrarServiceWorker } from "@/pwa/registrar"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <I18nProvider>
        <TooltipProvider delayDuration={300}>
          <App />
          <Toaster position="top-center" richColors={false} closeButton />
        </TooltipProvider>
      </I18nProvider>
    </ThemeProvider>
  </StrictMode>
)

registrarServiceWorker()
