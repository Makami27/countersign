import { PAYMENT_STATES, PAYMENT_TRANSITIONS } from "@countersign/core";

const stateList = PAYMENT_STATES.map((s) => `'${s}'`).join(",");
const allowedMoves = Object.entries(PAYMENT_TRANSITIONS).flatMap(([from, tos]) => tos.map((to) => `('${from}','${to}')`)).join(",");

export const INDEX_SCHEMA = `
CREATE TABLE IF NOT EXISTS payee_versions (
  payee_id TEXT NOT NULL, version INTEGER NOT NULL, address TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('VERIFIED','STATED','REVOKED')),
  record TEXT NOT NULL, PRIMARY KEY (payee_id, version));
CREATE TABLE IF NOT EXISTS receipts (
  receipt TEXT PRIMARY KEY,
  verdict TEXT NOT NULL CHECK (verdict IN ('PAID','PAYMENT_FAILED','REFUSED','CHANGE_VERIFIED','CHANGE_REJECTED')),
  attack_address TEXT, payee_id TEXT, created_at TEXT NOT NULL, record TEXT NOT NULL);
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS blob_id TEXT;
CREATE TABLE IF NOT EXISTS pending_onboardings (
  nonce TEXT PRIMARY KEY, payee_id TEXT NOT NULL, name TEXT NOT NULL, address TEXT NOT NULL,
  expires TEXT NOT NULL, used BOOLEAN NOT NULL DEFAULT FALSE);
CREATE TABLE IF NOT EXISTS pending_changes (
  nonce TEXT PRIMARY KEY, payee_id TEXT NOT NULL, from_address TEXT NOT NULL, to_address TEXT NOT NULL,
  expires TEXT NOT NULL, used BOOLEAN NOT NULL DEFAULT FALSE);
`;

export const LEDGER_SCHEMA = `
CREATE TABLE IF NOT EXISTS payment_budget (
  period TEXT PRIMARY KEY,
  reserved NUMERIC(40,0) NOT NULL CHECK (reserved >= 0));
CREATE TABLE IF NOT EXISTS payment_intents (
  id TEXT PRIMARY KEY,
  payee_id TEXT NOT NULL,
  payee_version INTEGER NOT NULL CHECK (payee_version >= 1),
  payee_blob_id TEXT,
  address TEXT NOT NULL CHECK (address ~ '^0x[0-9a-f]{64}$'),
  amount NUMERIC(40,0) NOT NULL CHECK (amount > 0),
  period TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN (${stateList})),
  digest TEXT UNIQUE,
  valid_until_epoch TEXT CHECK (valid_until_epoch IS NULL OR valid_until_epoch ~ '^[0-9]+$'),
  detail TEXT,
  reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (state IN ('RESERVED','FAILED') OR digest IS NOT NULL));
CREATE OR REPLACE FUNCTION payment_state_moves() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.state, NEW.state) NOT IN (VALUES ${allowedMoves}) THEN
    RAISE EXCEPTION 'payment state move not allowed' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS payment_state_moves ON payment_intents;
CREATE TRIGGER payment_state_moves BEFORE UPDATE OF state ON payment_intents
FOR EACH ROW EXECUTE FUNCTION payment_state_moves();
`;
