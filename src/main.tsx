import ReactDOM from "react-dom/client";
import App from "./App";
import { installZoom } from "./zoom";

installZoom();

// No React.StrictMode: its double-mounting would connect to Lean twice,
// and each connection starts its own `lake serve`.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<App />);
