import { api } from "./api.ts";
import { h, listen } from "./dom.ts";

export function signOutButton(status: HTMLElement): HTMLButtonElement {
  const button = h("button", { class: "btn", type: "button", "data-key": "sign-out" }, "Sign out");
  listen(button, "click", async () => {
    await api("DELETE", "/api/session");
    location.assign("/app/login");
  }, status);
  return button;
}
