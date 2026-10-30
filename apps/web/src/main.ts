import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { LabSessions, isLabPayee, type LabReply } from "./lab.ts";
import { readProof } from "./proof.ts";

const port = Number(process.env["WEB_PORT"]);
if (!Number.isInteger(port) || port <= 0) throw new Error("WEB_PORT must be a positive integer. Nothing was started.");
const network = process.env["NETWORK"] === "mainnet" ? "mainnet" : "testnet";
const databasePath = process.env["PROOF_DATABASE_PATH"];

const PUBLIC_DIR = fileURLToPath(new URL("../public/", import.meta.url));
const MAX_BODY_BYTES = 8 * 1024;
const COOKIE = "cs_lab";
const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".ico": "image/x-icon" };
const SECURITY_HEADERS = {
  "content-security-policy": "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; script-src 'self'; connect-src 'self'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

const lab = new LabSessions();

function send(res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...SECURITY_HEADERS, ...extra });
  res.end(JSON.stringify(body, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v)));
}

async function body(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(chunk as Buffer);
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function cookieId(req: IncomingMessage): string | null {
  const match = /(?:^|;\s*)cs_lab=([0-9a-f]{32})/.exec(req.headers.cookie ?? "");
  return match?.[1] ?? null;
}

function labCookie(id: string): Record<string, string> {
  return { "set-cookie": `${COOKIE}=${id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=1800` };
}

async function api(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  if (req.method === "GET" && path === "/api/health") return send(res, 200, { ok: true, network });
  if (req.method === "GET" && path === "/api/proof") return send(res, 200, readProof(databasePath, network));
  if (req.method === "POST" && path === "/api/lab/reset") {
    lab.reset(cookieId(req));
    const { id, session } = await lab.open(null);
    return send(res, 200, { view: session.view() }, labCookie(id));
  }
  if (req.method !== "POST" || !path.startsWith("/api/lab/")) return send(res, 404, { error: "Not found." });
  const input = await body(req);
  if (!input) return send(res, 400, { error: "Send a JSON object under 8 KB. Nothing was changed." });
  const { id, session } = await lab.open(cookieId(req));
  const payeeId = input["payeeId"] ?? "landlord";
  if (path === "/api/lab/state") return send(res, 200, { view: session.view() }, labCookie(id));
  if (!isLabPayee(payeeId)) return send(res, 400, { error: "Choose Landlord or Designer. Nothing was changed." }, labCookie(id));
  let reply: LabReply;
  if (path === "/api/lab/message") {
    const text = input["text"];
    if (typeof text !== "string" || text.trim().length === 0) return send(res, 400, { error: "Write a message to send to the agent. Nothing was changed." }, labCookie(id));
    reply = await session.scam(payeeId, text);
  } else if (path === "/api/lab/pay") reply = await session.pay(payeeId);
  else if (path === "/api/lab/genuine") reply = await session.genuineChange(payeeId);
  else return send(res, 404, { error: "Not found." }, labCookie(id));
  return send(res, 200, reply, labCookie(id));
}

async function staticFile(res: ServerResponse, path: string): Promise<void> {
  const target = path === "/" ? "/index.html" : path;
  const resolved = normalize(join(PUBLIC_DIR, target));
  if (!resolved.startsWith(PUBLIC_DIR)) return send(res, 404, { error: "Not found." });
  try {
    const file = await readFile(resolved);
    res.writeHead(200, { "content-type": TYPES[extname(resolved)] ?? "application/octet-stream", "cache-control": "public, max-age=300", ...SECURITY_HEADERS });
    res.end(file);
  } catch {
    const notFound = await readFile(join(PUBLIC_DIR, "index.html"));
    res.writeHead(404, { "content-type": TYPES[".html"] ?? "text/html", ...SECURITY_HEADERS });
    res.end(notFound);
  }
}

const server = createServer((req, res) => {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  const handled = path.startsWith("/api/") ? api(req, res, path) : staticFile(res, path);
  handled.catch(() => {
    if (!res.headersSent) send(res, 500, { error: "Something failed on the server. Nothing was changed." });
    else res.end();
  });
});

server.listen(port, () => console.log(`Countersign web on http://localhost:${port}`));
