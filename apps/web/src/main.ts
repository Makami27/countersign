import { startWebServer } from "./server.ts";

const port = Number(process.env["WEB_PORT"]);
if (!Number.isInteger(port) || port <= 0) throw new Error("WEB_PORT must be a positive integer. Nothing was started.");

startWebServer({
  port,
  network: process.env["NETWORK"] === "mainnet" ? "mainnet" : "testnet",
  proofDatabasePath: process.env["PROOF_DATABASE_PATH"],
  version: process.env["GIT_SHA"] ?? null,
  owner: null,
});
