import ReactDOM from "react-dom/client";
import App from "./App";
import { installZoom } from "./zoom";

installZoom();

// No React.StrictMode: its double-mounting would start two LeanMonaco
// instances, and lean4monaco only supports one at a time.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<App />);
