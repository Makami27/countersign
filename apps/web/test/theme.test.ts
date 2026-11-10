import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { startWebServer } from "../src/server.ts";
import { inChosenTheme, publicPage } from "../src/publicPage.ts";
import { THEME_COLOR, THEME_COOKIE, THEME_KEY, readTheme, rememberTheme, themeAction, themeCookie } from "../client/themeChoice.ts";

const read = (name: string) => readFileSync(new URL(`../public/${name}`, import.meta.url), "utf8");

test("V33 the light theme is the default whatever the system prefers: dark colours apply only when the page is marked dark", () => {
  const tokens = read("tokens.css");
  assert.equal(/prefers-color-scheme/.test(tokens), false);
  const dark = tokens.slice(tokens.indexOf(':root[data-theme="dark"]'));
  assert.ok(dark.includes(`--paper: ${THEME_COLOR.dark};`));
  assert.ok(tokens.slice(0, tokens.indexOf(':root[data-theme="dark"]')).includes(`--paper: ${THEME_COLOR.light};`));
  for (const css of ["styles.css", "app.css", "shell.css", "landing.css"]) assert.equal(/prefers-color-scheme/.test(read(css)), false, css);
});

test("V33 every page applies the remembered theme before its styles load, from one small script the page's own policy allows", async (t) => {
  const pages = ["index.html", "app.html", "demo.html", "sign.html"].map((name) => [name, read(name)] as const);
  for (const [name, html] of pages) {
    const script = html.indexOf('<script src="/theme.js"></script>');
    assert.ok(script > 0 && script < html.indexOf('rel="stylesheet"'), `${name}: theme script before the styles`);
    assert.equal((html.match(/name="theme-color"/g) ?? []).length, 1, `${name}: one theme colour`);
    assert.equal(/prefers-color-scheme/.test(html), false, name);
  }
  const early = read("theme.js");
  assert.ok(early.includes(`"${THEME_KEY}"`) && early.includes(`"${THEME_COLOR.dark}"`));
  const server = startWebServer({ port: 0, network: "testnet", proof: undefined, version: null, owners: null });
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const served = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/theme.js`);
  assert.equal(served.status, 200);
  assert.match(served.headers.get("content-type") ?? "", /javascript/);
});

test("V33 receipts, /proof and /status stay free of scripts and follow the chosen theme from its cookie", async (t) => {
  const page = publicPage("Proof", "<h1>Proof</h1>", "testnet");
  assert.doesNotMatch(page, /<script/);
  assert.equal((page.match(/name="theme-color"/g) ?? []).length, 1);
  assert.equal(inChosenTheme(page, false), page);
  const dark = inChosenTheme(page, true);
  assert.ok(dark.includes('<html lang="en" data-theme="dark">') && dark.includes(`<meta name="theme-color" content="${THEME_COLOR.dark}">`));
  assert.equal(themeCookie("dark"), `${THEME_COOKIE}=dark; Path=/; Max-Age=31536000; SameSite=Lax`);
  const server = startWebServer({ port: 0, network: "testnet", proof: undefined, version: null, owners: null });
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  for (const path of ["/proof", "/status", "/r/rcpt_missing0001"]) {
    const chosen = await fetch(`${base}${path}`, { headers: { cookie: `${THEME_COOKIE}=dark` } });
    assert.ok((await chosen.text()).includes('<html lang="en" data-theme="dark">'), `${path} in dark`);
    assert.equal(chosen.headers.get("vary"), "cookie", path);
    for (const cookie of ["", `${THEME_COOKIE}=light`, `${THEME_COOKIE}=<script>`]) assert.ok(!(await (await fetch(`${base}${path}`, { headers: { cookie } })).text()).includes("data-theme"), `${path} with "${cookie}"`);
  }
});

test("V33 the choice is remembered per browser, and blocked storage means light without throwing", () => {
  const kept = new Map<string, string>();
  const storage = { getItem: (key: string) => kept.get(key) ?? null, setItem: (key: string, value: string) => void kept.set(key, value) };
  assert.equal(readTheme(storage), "light");
  rememberTheme(storage, "dark");
  assert.equal(kept.get(THEME_KEY), "dark");
  assert.equal(readTheme(storage), "dark");
  rememberTheme(storage, "light");
  assert.equal(readTheme(storage), "light");
  const blocked = { getItem: (): string => { throw new Error("blocked"); }, setItem: (): void => { throw new Error("blocked"); } };
  assert.equal(readTheme(blocked), "light");
  assert.doesNotThrow(() => rememberTheme(blocked, "dark"));
  assert.equal(readTheme(null), "light");
  assert.deepEqual([themeAction("light"), themeAction("dark")], ["Switch to dark mode", "Switch to light mode"]);
});

test("V33 V34 headers carry a round icon button named for what it does, with a moon and a sun drawn inline; the phone menu and Settings use a labelled Dark mode switch", () => {
  const landing = read("index.html");
  const app = read("app.html");
  const icon = /<button class="theme-icon" type="button" data-theme-toggle aria-label="Switch to dark mode" aria-pressed="false"><svg class="moon"[^>]*><path d="[^"]+"\/><\/svg><svg class="sun"[^>]*><circle[^>]*\/><path d="[^"]+"\/><\/svg><\/button>/;
  const landingIcon = icon.exec(landing)?.[0];
  assert.ok(landingIcon && landing.includes(`${landingIcon}<a class="btn demo" href="/demo">Try the demo</a>`), "the icon button sits just before Try the demo");
  assert.equal(icon.exec(app)?.[0], landingIcon, "/app's header uses the same button");
  assert.ok(app.indexOf("theme-icon") > app.indexOf('class="side-top"') && app.indexOf("theme-icon") < app.indexOf('id="nav"'));
  const menu = landing.slice(landing.indexOf('class="site-menu"'), landing.indexOf("</details>", landing.indexOf('class="site-menu"')));
  assert.ok(menu.includes('<button class="theme-switch" type="button" role="switch" aria-checked="false" data-theme-toggle><span>Dark mode</span><span class="track" aria-hidden="true"><span class="knob"></span></span></button>'));
  assert.equal(/Dark mode: (on|off)/.test(landing + app), false);
  assert.match(readFileSync(new URL("../client/views/settings.ts", import.meta.url), "utf8"), /soundToggle\("btn"\), themeSwitch\(\)/);
  const styles = read("styles.css");
  assert.ok(styles.includes(".theme-icon { appearance: none; flex: none; width: var(--tap); height: var(--tap);") && styles.includes("border: 1px solid var(--line-strong); border-radius: 50%;"));
  assert.ok(styles.includes(':root[data-theme="dark"] .theme-icon .sun { display: block; }'));
});
