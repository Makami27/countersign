import { api } from "../api.ts";
import { h, listen, liveRegion, when } from "../dom.ts";

export function telegramPanel(): HTMLElement {
  const status = liveRegion();
  const state = h("p", { class: "note" }, "Checking whether a chat is connected…");
  const button = h("button", { class: "btn", type: "button" }, "Connect Telegram");
  const link = h("p", {});
  void api<{ linked: boolean }>("GET", "/api/app/telegram").then((r) => {
    state.textContent = r.ok ? (r.data.linked ? "A Telegram chat is connected. It gets your notices and can pay your verified payees within your caps." : "No Telegram chat is connected.") : r.error.message;
  });
  listen(button, "click", async () => {
    button.disabled = true;
    const made = await api<{ url: string; expires: string }>("POST", "/api/app/telegram", {});
    button.disabled = false;
    if (!made.ok) return void (status.textContent = made.error.message);
    link.replaceChildren(h("a", { href: made.data.url, target: "_blank", rel: "noreferrer" }, "Open the Countersign bot in Telegram"));
    status.textContent = `The link works once and expires ${when(made.data.expires)}. Connecting a new chat replaces the old one.`;
  }, status);
  return h("section", { class: "card", "aria-labelledby": "telegram-title" }, h("h2", { id: "telegram-title" }, "Telegram (optional)"),
    h("p", {}, "Connect a chat to get notices and to pay or forward messages from your phone. Signing in and sensitive changes still need your wallet."), state, status, link, h("div", { class: "actions" }, button));
}
