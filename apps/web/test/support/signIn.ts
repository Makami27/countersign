import type { TestWallet } from "../../../../packages/core/test/fixtures.ts";

const HEADERS = { "content-type": "application/json", "x-countersign": "1" };

export async function signInAs(base: string, who: TestWallet, sign: (message: string) => string = who.sign) {
  const challenge = (await (await fetch(`${base}/api/session/challenge`, { method: "POST", headers: HEADERS, body: JSON.stringify({ address: who.address }) })).json()) as { nonce: string; message: string };
  const answer = await fetch(`${base}/api/session`, { method: "POST", headers: HEADERS, body: JSON.stringify({ address: who.address, nonce: challenge.nonce, signature: sign(challenge.message) }) });
  const setCookie = answer.headers.get("set-cookie") ?? "";
  return { status: answer.status, setCookie, cookie: setCookie.split(";")[0] ?? "", body: (await answer.json()) as Record<string, unknown>, challenge };
}
