import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { startWebServer } from "../src/server.ts";
import { inChosenTheme, publicPage } from "../src/publicPage.ts";
import { THEME_COLOR, THEME_COOKIE, THEME_KEY, readTheme, rememberTheme, themeCookie, themeLabel } from "../client/themeChoice.ts";

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
  assert.deepEqual([themeLabel("light"), themeLabel("dark")], ["Dark mode: off", "Dark mode: on"]);
});

test("V33 the landing offers the toggle in the header and in the phone menu, labelled in words", () => {
  const landing = read("index.html");
  const toggles = landing.match(/<button class="theme-toggle" type="button" data-theme-toggle aria-pressed="false">Dark mode: off<\/button>/g) ?? [];
  assert.equal(toggles.length, 2);
  assert.ok(landing.indexOf("data-theme-toggle") < landing.indexOf('class="site-menu"'));
  assert.ok(landing.lastIndexOf("data-theme-toggle") > landing.indexOf('class="site-menu"'));
  assert.match(readFileSync(new URL("../client/views/settings.ts", import.meta.url), "utf8"), /soundToggle\("btn"\), themeToggle\("btn"\)/);
});
