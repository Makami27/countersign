import { api } from "../api.ts";
import { h, listen, liveRegion } from "../dom.ts";
import { dayAndTime } from "../dayGroups.ts";

type DiscordState = { readonly enabled: boolean; readonly linked: boolean; readonly installs: { readonly account: string; readonly server: string } | null };

export const DISCORD_LINKED = "A Discord account is connected. It gets your notices by DM and can pay your verified payees within your caps.";
export const DISCORD_NOT_LINKED = "No Discord account is connected.";

export function discordPanel(): HTMLElement {
  const status = liveRegion();
  const state = h("p", { class: "note" }, "Checking whether a Discord account is connected…");
  const installs = h("p", { class: "links" });
  const code = h("p", { class: "link-text", hidden: true });
  const button = h("button", { class: "btn", type: "button" }, "Connect Discord");
  const panel = h("section", { class: "card", "aria-labelledby": "discord-title", hidden: true }, h("h2", { id: "discord-title" }, "Discord (optional)"),
    h("p", {}, "Use the same commands from Discord: /pay, /payees, /balance, /schedules, /check. Replies are visible only to you. Signing in and sensitive changes still need your wallet."),
    state, installs, status, code, h("div", { class: "actions" }, button));
  void api<DiscordState>("GET", "/api/app/discord").then((r) => {
    if (!r.ok) return void ((panel.hidden = false), (state.textContent = r.error.message));
    if (!r.data.enabled) return;
    panel.hidden = false;
    state.textContent = r.data.linked ? DISCORD_LINKED : DISCORD_NOT_LINKED;
    if (r.data.installs) installs.replaceChildren("Add the Countersign app ", h("a", { href: r.data.installs.account, target: "_blank", rel: "noreferrer" }, "to your Discord account"), " (use it anywhere) or ", h("a", { href: r.data.installs.server, target: "_blank", rel: "noreferrer" }, "to a server"), ".");
  });
  listen(button, "click", async () => {
    button.disabled = true;
    const made = await api<{ code: string; expires: string }>("POST", "/api/app/discord", {});
    button.disabled = false;
    if (!made.ok) return void (status.textContent = made.error.message);
    code.hidden = false;
    code.textContent = `/link ${made.data.code}`;
    status.textContent = `In Discord, run the command below. The code works once and expires ${dayAndTime(made.data.expires)}. Connecting another Discord account replaces this one.`;
  }, status);
  return panel;
}
