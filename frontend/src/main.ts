import { mount } from "svelte";
import App from "./App.svelte";
import EmbedAgenda from "./components/EmbedAgenda.svelte";
import { isEmbedRoute } from "./lib/embed";
import "./app.css";

const target = document.getElementById("app");
if (!target) throw new Error("No #app element to mount into");

// The embed is a different, much smaller app: no header, no filters, no
// session. Choosing here rather than inside App keeps it from firing off the
// session and calendar requests it has no use for.
function start() {
  if (!isEmbedRoute(globalThis.location?.pathname ?? "/")) {
    return mount(App, { target: target! });
  }
  document.documentElement.classList.add("embedded");
  return mount(EmbedAgenda, { target: target! });
}

export default start();
