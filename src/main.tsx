import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { toast } from "./app/state";
import { takeInviteFromUrl } from "./lib/groups";
import { startLook } from "./lib/look";
import { captureInstallPrompt, registerServiceWorker } from "./lib/pwa";
import "./styles.css";

// Before the first render, so the app opens in its colours rather than switching to them.
startLook();
// An invite in the address (`/?moi=`): kept for after signing in, taken out of the address.
takeInviteFromUrl();
captureInstallPrompt();
registerServiceWorker((apply) => toast("Có bản mới của app.", { label: "Cập nhật", run: apply }));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
