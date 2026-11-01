import { createServer, type Server, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { LabSessions } from "./lab.ts";
import { labRoute } from "./labRoutes.ts";
import type { SqlRows } from "@countersign/adapters/sql";
import { readProof } from "./proof.ts";
import { receiptRoute } from "./receiptRoute.ts";
import type { StatusView } from "./status.ts";
import { claimRowsHtml, readClaims } from "./claims.ts";
import { readFile } from "node:fs/promises";
import { SECURITY_HEADERS, SIGN_PAGE_CSP, problem, send, serveFile } from "./http.ts";
import { ownerRoute } from "./ownerRoutes.ts";
import { sessionRoute } from "./signInRoutes.ts";
import { completedBy, signRoute } from "./signRoutes.ts";
import { proofPageRoute, statusPageRoute } from "./publicRoutes.ts";
import type { OwnerContext } from "./ownerContext.ts";
import type { OwnerDirectory } from "./ownerDirectory.ts";

export const PUBLIC_DIR = fileURLToPath(new URL("../public/", import.meta.url));
export const DIST_DIR = fileURLToPath(new URL("../dist/", import.meta.url));

export type WebServerOptions = {
  readonly port: number;
  readonly network: "mainnet" | "testnet";
  readonly proof: SqlRows | undefined;
  readonly version: string | null;
  readonly owners: OwnerDirectory | null;
  readonly status?: () => Promise<StatusView>;
};

async function landing(res: ServerResponse): Promise<void> {
  const page = (await readFile(`${PUBLIC_DIR}index.html`, "utf8")).replace(`<tbody id="claims-rows"></tbody>`, `<tbody id="claims-rows">${claimRowsHtml(await readClaims())}</tbody>`);
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache", ...SECURITY_HEADERS });
  res.end(page);
}

async function ownerForNonce(owners: OwnerDirectory, nonce: string): Promise<OwnerContext> {
  for (const { ctx } of owners.all()) if ((await ctx.index.pendingOnboarding(nonce)) || (await ctx.index.pendingChange(nonce)) || (await completedBy(ctx, nonce))) return ctx;
  return owners.get(owners.adminOwnerId) ?? (owners.all()[0]?.ctx as OwnerContext);
}

async function ownerForReceipt(owners: OwnerDirectory | null, id: string): Promise<OwnerContext | null> {
  for (const { ctx } of owners?.all() ?? []) if (await ctx.index.receipt(id)) return ctx;
  return owners?.get(owners.adminOwnerId) ?? null;
}

export function startWebServer(options: WebServerOptions): Server {
  const lab = new LabSessions();
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    const handle = async (): Promise<void> => {
      if (path === "/api/health" && req.method === "GET") return send(res, 200, { ok: true, network: options.network, version: options.version });
      if (path === "/api/status" && req.method === "GET") return options.status ? send(res, 200, await options.status()) : problem(res, 404, "This server isn't connected to the live agent.");
      if (path === "/api/claims" && req.method === "GET") return send(res, 200, { source: "CLAIMS.md", claims: await readClaims() });
      if (path === "/api/proof" && req.method === "GET") return send(res, 200, await readProof(options.proof, options.network));
      if (path.startsWith("/api/lab/") && req.method === "POST") return labRoute(lab, req, res, path);
      const owners = options.owners;
      if ((path === "/api/session" || path === "/api/session/challenge") && owners) return sessionRoute(owners, options.network, req, res, path);
      if (path.startsWith("/api/app/") && owners) return ownerRoute(owners, req, res, path);
      if (path.startsWith("/api/sign/") && owners) return signRoute(await ownerForNonce(owners, path.slice("/api/sign/".length)), req, res, path);
      if (path.startsWith("/api/")) return problem(res, 404, "Not found.");
      if (path === "/proof" && req.method === "GET") return proofPageRoute(res, options.proof, options.network, owners?.get(owners.adminOwnerId) ?? null);
      if (path === "/status" && req.method === "GET") return statusPageRoute(res, options.status);
      if (path.startsWith("/r/") && req.method === "GET") return receiptRoute(await ownerForReceipt(owners, decodeURIComponent(path.slice("/r/".length))), res, decodeURIComponent(path.slice("/r/".length)));
      if (path.startsWith("/build/") && (await serveFile(res, DIST_DIR, path.slice("/build/".length), 200, "no-cache"))) return;
      if ((path === "/app" || path.startsWith("/app/")) && (await serveFile(res, PUBLIC_DIR, "app.html", 200, "no-cache"))) return;
      if (path.startsWith("/sign/") && (await serveFile(res, PUBLIC_DIR, "sign.html", 200, "no-cache", { "content-security-policy": SIGN_PAGE_CSP }))) return;
      if ((path === "/" || path === "/index.html") && req.method === "GET") return landing(res);
      if (await serveFile(res, PUBLIC_DIR, path)) return;
      if (!(await serveFile(res, PUBLIC_DIR, "index.html", 404, "no-cache"))) problem(res, 404, "Not found.");
    };
    handle().catch(() => {
      if (!res.headersSent) problem(res, 500, "Something failed on the server. Nothing was changed.");
      else res.end();
    });
  });
  server.listen(options.port, () => console.log(`Countersign web on http://localhost:${options.port}`));
  return server;
}
