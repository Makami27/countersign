import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import { LabSessions } from "./lab.ts";
import { labRoute } from "./labRoutes.ts";
import { readProof } from "./proof.ts";
import { problem, send, serveFile } from "./http.ts";
import { ownerRoute, sessionRoute } from "./ownerRoutes.ts";
import { signRoute } from "./signRoutes.ts";
import type { OwnerContext } from "./ownerContext.ts";

export const PUBLIC_DIR = fileURLToPath(new URL("../public/", import.meta.url));
export const DIST_DIR = fileURLToPath(new URL("../dist/", import.meta.url));

export type WebServerOptions = {
  readonly port: number;
  readonly network: "mainnet" | "testnet";
  readonly proofDatabasePath: string | undefined;
  readonly version: string | null;
  readonly owner: OwnerContext | null;
};

export function startWebServer(options: WebServerOptions): Server {
  const lab = new LabSessions();
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    const handle = async (): Promise<void> => {
      if (path === "/api/health" && req.method === "GET") return send(res, 200, { ok: true, network: options.network, version: options.version });
      if (path === "/api/proof" && req.method === "GET") return send(res, 200, readProof(options.proofDatabasePath, options.network));
      if (path.startsWith("/api/lab/") && req.method === "POST") return labRoute(lab, req, res, path);
      if (path === "/api/session" && options.owner) return sessionRoute(options.owner, req, res);
      if (path.startsWith("/api/app/") && options.owner) return ownerRoute(options.owner, req, res, path);
      if (path.startsWith("/api/sign/") && options.owner) return signRoute(options.owner, req, res, path);
      if (path.startsWith("/api/")) return problem(res, 404, "Not found.");
      if (path.startsWith("/build/") && (await serveFile(res, DIST_DIR, path.slice("/build/".length), 200, "no-cache"))) return;
      if ((path === "/app" || path.startsWith("/app/")) && (await serveFile(res, PUBLIC_DIR, "app.html", 200, "no-cache"))) return;
      if (path.startsWith("/sign/") && (await serveFile(res, PUBLIC_DIR, "sign.html", 200, "no-cache"))) return;
      if (await serveFile(res, PUBLIC_DIR, path === "/" ? "index.html" : path)) return;
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
