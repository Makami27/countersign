import { createHash, generateKeyPairSync, sign, verify, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export const LOOKALIKE_PREFIX = 4;
export const LOOKALIKE_SUFFIX = 4;
export const ADDRESS_PATTERN = /0x[0-9a-f]{64}/g;

export const REASONS = Object.freeze({
  PAYEE_NOT_VERIFIED: { retryable: false, nextAction: "Verify the payee before paying." },
  ADDRESS_NOT_IN_MESSAGE: { retryable: false, nextAction: "Nothing was changed." },
  LOOKALIKE_ADDRESS: { retryable: false, nextAction: "Nothing was changed. Check the address with the payee directly." },
  CONFLICT: { retryable: false, nextAction: "Payee frozen. Resolve in the owner app." },
  CAP_EXCEEDED: { retryable: false, nextAction: "Nothing was sent." },
  NO_CONTINUITY: { retryable: true, nextAction: "Ask the payee to sign from their current wallet, or confirm in the owner app." },
  CONTROL_NOT_PROVEN: { retryable: true, nextAction: "The new address must prove control." },
  NONCE_REUSED: { retryable: false, nextAction: "Start a new change request." },
  EXPIRED: { retryable: false, nextAction: "Start a new change request." },
  MEMORY_INCOMPLETE: { retryable: true, nextAction: "Nothing was sent. Retry when memory is complete." },
  KNOWN_ATTACK_PATTERN: { retryable: false, nextAction: "Nothing was changed. This matches an earlier refused attempt." },
  UNKNOWN_PAYEE: { retryable: false, nextAction: "Nothing was sent." },
});

export function addressesIn(text) {
  return [...text.toLowerCase().matchAll(ADDRESS_PATTERN)].map((m) => m[0]);
}

export function isLookalike(candidate, known) {
  if (candidate === known) return false;
  const a = candidate.slice(2);
  const b = known.slice(2);
  return a.slice(0, LOOKALIKE_PREFIX) === b.slice(0, LOOKALIKE_PREFIX) && a.slice(-LOOKALIKE_SUFFIX) === b.slice(-LOOKALIKE_SUFFIX);
}

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function createAgentKeys() {
  return generateKeyPairSync("ed25519");
}

export function signRecord(keys, record) {
  return { record, sig: sign(null, Buffer.from(canonical(record)), keys.privateKey).toString("base64") };
}

export function openRecord(keys, envelope) {
  if (!envelope || typeof envelope !== "object" || typeof envelope.sig !== "string") return null;
  try {
    const ok = verify(null, Buffer.from(canonical(envelope.record)), keys.publicKey, Buffer.from(envelope.sig, "base64"));
    return ok ? envelope.record : null;
  } catch {
    return null;
  }
}

export class MemoryStore {
  constructor() { this.texts = []; }
  remember(text) { this.texts.push(text); return { blobId: createHash("sha256").update(text).digest("hex").slice(0, 16) }; }
  recallAll() { return { results: this.texts.map((text) => ({ text })), dropped_count: 0 }; }
}

export class Countersign {
  constructor({ memory, keys, verifySignature, now, caps }) {
    this.memory = memory;
    this.keys = keys;
    this.verifySignature = verifySignature;
    this.now = now;
    this.caps = caps;
    this.db = new DatabaseSync(":memory:");
    this.db.exec(`
      CREATE TABLE payee_versions (payee_id TEXT, version INTEGER, address TEXT, status TEXT CHECK (status IN ('VERIFIED','STATED','REVOKED')), supersedes INTEGER, PRIMARY KEY (payee_id, version));
      CREATE TABLE nonces (nonce TEXT PRIMARY KEY, payee_id TEXT, new_address TEXT, expires TEXT, used INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE refused (address TEXT, source TEXT, receipt TEXT);
      CREATE TABLE budget (period TEXT PRIMARY KEY, reserved INTEGER NOT NULL CHECK (reserved >= 0));
      CREATE TABLE payments (id TEXT PRIMARY KEY, payee_id TEXT, address TEXT, amount INTEGER, state TEXT CHECK (state IN ('RESERVED','SENDING','SENT','UNKNOWN','SETTLED','FAILED')));
    `);
    this.receipts = [];
  }

  write(record) {
    const envelope = signRecord(this.keys, record);
    const { blobId } = this.memory.remember(JSON.stringify(envelope));
    this.index(record);
    return blobId;
  }

  index(record) {
    if (record.type === "payee_version") {
      this.db.prepare("INSERT OR REPLACE INTO payee_versions VALUES (?,?,?,?,?)").run(record.payeeId, record.version, record.address, record.status, record.supersedes);
    }
    if (record.type === "refusal" && record.address) {
      this.db.prepare("INSERT INTO refused VALUES (?,?,?)").run(record.address, record.source, record.receipt);
    }
  }

  restoreFromMemory() {
    const recall = this.memory.recallAll();
    if (recall.dropped_count > 0) return { ok: false, reason: "MEMORY_INCOMPLETE" };
    this.db.exec("DELETE FROM payee_versions; DELETE FROM refused;");
    let ignored = 0;
    for (const { text } of recall.results) {
      let parsed;
      try { parsed = JSON.parse(text); } catch { ignored += 1; continue; }
      const record = openRecord(this.keys, parsed);
      if (!record) { ignored += 1; continue; }
      this.index(record);
    }
    return { ok: true, ignored };
  }

  head(payeeId) {
    const verified = this.db.prepare("SELECT * FROM payee_versions WHERE payee_id = ? AND status = 'VERIFIED' ORDER BY version DESC").all(payeeId);
    if (verified.length === 0) return { kind: "none" };
    const superseded = new Set(verified.map((v) => v.supersedes).filter((v) => v !== null));
    const heads = verified.filter((v) => !superseded.has(v.version));
    if (heads.length !== 1) return { kind: "conflict" };
    return { kind: "verified", row: heads[0] };
  }

  knownAddresses() {
    return this.db.prepare("SELECT DISTINCT address FROM payee_versions WHERE status = 'VERIFIED'").all().map((r) => r.address);
  }

  onboard(payeeId, address, ownerConfirmationId) {
    return this.write({ type: "payee_version", payeeId, version: 1, address, status: "VERIFIED", supersedes: null, evidence: { kind: "owner_onboarding", ownerConfirmationId } });
  }

  refuse(reason, ref, address, source) {
    const receipt = `rcpt_${this.receipts.length + 1}`;
    const blob = this.write({ type: "refusal", reason, ref, address: address ?? null, source: source ?? null, receipt });
    this.receipts.push({ receipt, reason, blob });
    return { verdict: "REFUSED", reason, receipt };
  }

  handleProposal(message, proposal) {
    if (proposal.kind === "none") return { verdict: "NONE" };
    if (proposal.kind === "change_address") return this.requestChange(message, proposal);
    if (proposal.kind === "pay") return this.pay(message, proposal);
    return { verdict: "NONE" };
  }

  requestChange(message, proposal) {
    const newAddress = proposal.newAddress.toLowerCase();
    if (!addressesIn(message.text).includes(newAddress)) return this.refuse("ADDRESS_NOT_IN_MESSAGE", message.id);
    const head = this.head(proposal.payeeId);
    if (head.kind === "none") return this.refuse("PAYEE_NOT_VERIFIED", message.id, newAddress, message.from);
    if (head.kind === "conflict") return this.refuse("CONFLICT", message.id, newAddress, message.from);
    const earlier = this.db.prepare("SELECT receipt FROM refused WHERE address = ? LIMIT 1").get(newAddress);
    if (earlier) return { ...this.refuse("KNOWN_ATTACK_PATTERN", message.id, newAddress, message.from), cites: earlier.receipt };
    if (this.knownAddresses().some((k) => isLookalike(newAddress, k))) return this.refuse("LOOKALIKE_ADDRESS", message.id, newAddress, message.from);
    const version = head.row.version + 1;
    this.write({ type: "payee_version", payeeId: proposal.payeeId, version, address: newAddress, status: "STATED", supersedes: head.row.version, evidence: { kind: "stated", sourceMessageId: message.id } });
    const nonce = randomBytes(16).toString("hex");
    const expires = new Date(this.now().getTime() + 24 * 3600 * 1000).toISOString();
    this.db.prepare("INSERT INTO nonces (nonce, payee_id, new_address, expires) VALUES (?,?,?,?)").run(nonce, proposal.payeeId, newAddress, expires);
    return { verdict: "CHANGE_STARTED", nonce, expires, fromAddress: head.row.address, version };
  }

  completeChange({ nonce, continuity, control }) {
    const row = this.db.prepare("SELECT * FROM nonces WHERE nonce = ?").get(nonce);
    if (!row) return this.refuse("NONCE_REUSED", nonce);
    if (row.used) return this.refuse("NONCE_REUSED", nonce);
    if (new Date(row.expires) < this.now()) return this.refuse("EXPIRED", nonce);
    const head = this.head(row.payee_id);
    if (head.kind !== "verified") return this.refuse("CONFLICT", nonce);
    const message = changeMessage(row.payee_id, head.row.address, row.new_address, nonce, row.expires);
    const continuityOk = continuity?.kind === "signature"
      ? this.verifySignature(message, continuity.signature, head.row.address) === "VALID"
      : continuity?.kind === "owner_confirmed" && continuity.cooldownEndedAt && new Date(continuity.cooldownEndedAt) <= this.now();
    if (!continuityOk) return this.refuse("NO_CONTINUITY", nonce, row.new_address);
    const controlOk = control?.kind === "signature" && this.verifySignature(message, control.signature, row.new_address) === "VALID";
    if (!controlOk) return this.refuse("CONTROL_NOT_PROVEN", nonce, row.new_address);
    const marked = this.db.prepare("UPDATE nonces SET used = 1 WHERE nonce = ? AND used = 0").run(nonce);
    if (marked.changes !== 1) return this.refuse("NONCE_REUSED", nonce);
    const version = head.row.version + 1;
    const blob = this.write({ type: "payee_version", payeeId: row.payee_id, version, address: row.new_address, status: "VERIFIED", supersedes: head.row.version, evidence: { kind: continuity.kind, nonce } });
    return { verdict: "CHANGE_VERIFIED", version, blob };
  }

  pay(message, proposal) {
    const recall = this.memory.recallAll();
    if (recall.dropped_count > 0) return this.refuse("MEMORY_INCOMPLETE", message.id);
    const head = this.head(proposal.payeeId);
    if (head.kind === "none") return this.refuse("UNKNOWN_PAYEE", message.id);
    if (head.kind === "conflict") return this.refuse("CONFLICT", message.id);
    const amount = BigInt(proposal.amountBaseUnits);
    if (amount > this.caps.perPayment) return this.refuse("CAP_EXCEEDED", message.id);
    const reservation = this.reserve(amount);
    if (!reservation) return this.refuse("CAP_EXCEEDED", message.id);
    const id = `pay_${randomBytes(6).toString("hex")}`;
    this.db.prepare("INSERT INTO payments VALUES (?,?,?,?,?)").run(id, proposal.payeeId, head.row.address, Number(amount), "RESERVED");
    return { verdict: "PAY_RESERVED", id, address: head.row.address };
  }

  reserve(amount) {
    this.db.prepare("INSERT OR IGNORE INTO budget VALUES ('today', 0)").run();
    const r = this.db.prepare("UPDATE budget SET reserved = reserved + ? WHERE period = 'today' AND reserved + ? <= ?").run(Number(amount), Number(amount), Number(this.caps.perDay));
    return r.changes === 1;
  }
}

export function changeMessage(payeeId, from, to, nonce, expires) {
  return ["Countersign payee change v1", `payee:${payeeId}`, `from:${from}`, `to:${to}`, `nonce:${nonce}`, `expires:${expires}`].join("\n");
}

export class NaiveAgent {
  constructor() { this.book = new Map(); }
  onboard(payeeId, address) { this.book.set(payeeId, address); }
  handleProposal(message, proposal) {
    if (proposal.kind === "change_address") { this.book.set(proposal.payeeId, proposal.newAddress.toLowerCase()); return { verdict: "CHANGED" }; }
    if (proposal.kind === "pay") return { verdict: "PAY_RESERVED", address: this.book.get(proposal.payeeId) };
    return { verdict: "NONE" };
  }
}
