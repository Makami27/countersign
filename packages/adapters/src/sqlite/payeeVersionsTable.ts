export const PAYEE_VERSIONS_TABLE = `
CREATE TABLE IF NOT EXISTS payee_versions (
  payee_id TEXT NOT NULL, version INTEGER NOT NULL, address TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('VERIFIED','STATED','REVOKED')),
  record TEXT NOT NULL, PRIMARY KEY (payee_id, version));
`;
