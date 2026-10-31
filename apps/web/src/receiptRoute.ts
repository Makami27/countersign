import type { ServerResponse } from "node:http";
import { SECURITY_HEADERS } from "./http.ts";
import type { OwnerContext } from "./ownerContext.ts";
import { missingReceiptHtml, receiptHtml } from "./receiptPage.ts";
import { receiptView } from "./receiptView.ts";

const RECEIPT_ID = /^rcpt_[0-9A-Za-z_-]{4,64}$/;

function html(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache", ...SECURITY_HEADERS });
  res.end(body);
}

export async function receiptRoute(ctx: OwnerContext | null, res: ServerResponse, id: string): Promise<void> {
  const view = ctx && RECEIPT_ID.test(id) ? await receiptView(ctx, id) : null;
  return view ? html(res, 200, receiptHtml(view)) : html(res, 404, missingReceiptHtml(ctx !== null));
}
