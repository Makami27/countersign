import { existsSync } from "node:fs";
import { SqliteRows } from "@countersign/adapters/sqlite";
import { startWebServer } from "./server.ts";

const port = Number(process.env["WEB_PORT"]);
if (!Number.isInteger(port) || port <= 0) throw new Error("WEB_PORT must be a positive integer. Nothing was started.");

const proofPath = process.env["PROOF_DATABASE_PATH"];

startWebServer({
  port,
  network: process.env["NETWORK"] === "mainnet" ? "mainnet" : "testnet",
  proof: proofPath && existsSync(proofPath) ? new SqliteRows(proofPath, { readOnly: true }) : undefined,
  version: process.env["GIT_SHA"] ?? null,
  owner: null,
});
