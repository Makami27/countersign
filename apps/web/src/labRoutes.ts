import type { IncomingMessage, ServerResponse } from "node:http";
import { usdcToBaseUnits } from "@countersign/core";
import { LabSessions, isLabPayee, type LabReply } from "./lab.ts";
import { cookie, problem, readJson, send } from "./http.ts";
import { isLetter } from "./labLetters.ts";

const LAB_COOKIE = "cs_lab";
const LAB_ID = /^[0-9a-f]{32}$/;

function labCookie(id: string): Record<string, string> {
  return { "set-cookie": `${LAB_COOKIE}=${id}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=1800` };
}

function labId(req: IncomingMessage): string | null {
  const value = cookie(req, LAB_COOKIE);
  return value && LAB_ID.test(value) ? value : null;
}

export async function labRoute(lab: LabSessions, req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  if (path === "/api/lab/reset") {
    lab.reset(labId(req));
    const { id, session } = await lab.open(null);
    return send(res, 200, { view: session.view() }, labCookie(id));
  }
  const input = await readJson(req);
  if (!input) return problem(res, 400, "Send a JSON object under 8 KB. Nothing was changed.");
  const { id, session } = await lab.open(labId(req));
  const payeeId = input["payeeId"] ?? "landlord";
  if (path === "/api/lab/state") return send(res, 200, { view: session.view() }, labCookie(id));
  if (!isLabPayee(payeeId)) return problem(res, 400, "Choose Landlord or Designer. Nothing was changed.", labCookie(id));
  let reply: LabReply;
  if (path === "/api/lab/message") {
    const text = input["text"];
    if (typeof text !== "string" || text.trim().length === 0) return problem(res, 400, "Write a message to send to the agent. Nothing was changed.", labCookie(id));
    reply = await session.scam(payeeId, text);
  } else if (path === "/api/lab/letter") {
    const letter = input["letter"];
    if (!isLetter(letter)) return problem(res, 400, "Choose one of the letters. Nothing was changed.", labCookie(id));
    reply = await session.letter(letter, payeeId);
  } else if (path === "/api/lab/pay") {
    const amountBaseUnits = usdcToBaseUnits(String(input["amount"] ?? "").trim());
    if (!amountBaseUnits) return problem(res, 400, "Give the amount in USDC, for example 0.10. Nothing was sent.", labCookie(id));
    reply = await session.pay(payeeId, amountBaseUnits);
  }
  else if (path === "/api/lab/genuine") reply = await session.genuineChange(payeeId);
  else return problem(res, 404, "Not found.", labCookie(id));
  return send(res, 200, reply, labCookie(id));
}
