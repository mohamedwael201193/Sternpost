export interface Migration { id: number; name: string; sql: string }

export const migrations: Migration[] = [
  {
    id: 1,
    name: "apps_and_requests",
    sql: `
CREATE TABLE apps (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT NOT NULL UNIQUE,
  url TEXT,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE draw_requests (
  id SERIAL PRIMARY KEY,
  app_address TEXT NOT NULL,
  borrower TEXT NOT NULL,
  amount TEXT NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX draw_requests_borrower_idx ON draw_requests (borrower);`,
  },
  {
    id: 2,
    name: "policies",
    sql: `
CREATE TABLE policies (
  governor TEXT PRIMARY KEY,
  borrower TEXT NOT NULL,
  floor_icr TEXT NOT NULL,
  defend_icr TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);`,
  },
  {
    id: 3,
    name: "activity_and_cursor",
    sql: `
CREATE TABLE activity (
  id SERIAL PRIMARY KEY,
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  block_number BIGINT NOT NULL,
  contract TEXT NOT NULL,
  event TEXT NOT NULL,
  args JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tx_hash, log_index)
);
CREATE INDEX activity_contract_idx ON activity (contract);
CREATE TABLE indexer_cursor (
  id INTEGER PRIMARY KEY,
  last_block BIGINT NOT NULL
);`,
  },
  {
    id: 4,
    name: "receipts",
    sql: `
CREATE TABLE receipts (
  id SERIAL PRIMARY KEY,
  payer TEXT NOT NULL,
  pay_to TEXT NOT NULL,
  amount TEXT NOT NULL,
  asset TEXT NOT NULL,
  network TEXT NOT NULL,
  resource TEXT NOT NULL,
  tx_hash TEXT UNIQUE,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX receipts_payer_idx ON receipts (payer);`,
  },
];
