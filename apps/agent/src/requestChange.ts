import { randomBytes } from "node:crypto";
import { parseSuiAddress } from "@countersign/core";
import { openDeployed } from "./deployed.ts";

const [payeeId = "", addressText = ""] = process.argv.slice(2);
const address = parseSuiAddress(addressText);
if (!payeeId || !address) throw new Error("Usage: requestChange.ts <payee id> <new address>. Nothing was changed.");
const { engine, storage, publicUrl } = await openDeployed();
const text = `Owner requested a new address for ${payeeId}: ${address}`;
const outcome = await engine.handle({ id: `web:${randomBytes(8).toString("hex")}`, channel: "web", from: "owner", text, receivedAt: new Date().toISOString() }, { kind: "change_address", payeeId, newAddress: address, reasonQuote: text });
console.log(JSON.stringify({ outcome, signUrl: outcome.verdict === "CHANGE_STARTED" ? `${publicUrl}/sign/${outcome.nonce}` : null }, null, 2));
await storage.close();
