# Sternpost API

Hono + TypeScript service that indexes Sternpost contracts on Mezo testnet (31611), stores app/draw requests and policies in Postgres, and sells a demo API over **x402 v2, paid in MUSD**.

Live: **https://sternpost-api.vercel.app** · DB: Render Postgres 16 (`sternpost-db`)

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | DB + chain head check |
| GET/POST | `/v1/apps` | App registry |
| GET/POST | `/v1/requests` · PATCH `/v1/requests/:id` | Draw requests (pending → approved/rejected/drawn, once) |
| GET `/v1/policies/:governor` · PUT `/v1/policies` | Policy mirror (floor ≥ 110% MCR, defend ≥ floor) |
| GET | `/v1/activity?contract=&event=&limit=` | Indexed Factory / Governor / SpendWallet events |
| POST | `/v1/indexer/sync` | Catch-up sync (throttled, for serverless) |
| GET | `/v1/receipts?payer=` · `/v1/receipts/:tx` | x402 settlement receipts |
| GET | `/v1/paid/brief` | **x402-paid** endpoint: 402 challenge → facilitator verify → settle → content |
| GET | `/v1/paid/price` | Current price/asset/payTo |

## x402 flow
`GET /v1/paid/brief` returns `402` with a `PAYMENT-REQUIRED` header (scheme `exact`, `eip155:31611`, MUSD, Permit2). The client retries with `PAYMENT-SIGNATURE`; the server verifies and settles through `facilitator.vativ.io`, stores a receipt, and returns `PAYMENT-RESPONSE`. If the facilitator broadcasts but times out reading the receipt, the server confirms the tx on chain itself.

```bash
PAYER_PK=0x... node scripts/pay-brief.mjs                       # EOA
AGENT_PK=0x... SPEND_WALLET=0x... node scripts/pay-brief.mjs    # Sternpost SpendWallet (EIP-1271)
```
Live proof: [0x6a3830…0fb0](https://explorer.test.mezo.org/tx/0x6a38307226af8e2c0e4d9cc011bdfaa53544c124911a57b2458fdb014f770fb0)

## Security
zod validation on every input · per-IP rate limit · CORS allowlist (`CORS_ORIGINS`, supports `*.vercel.app`) · secure headers · 32 KB body limit · parameterized SQL · payment headers redacted from logs.

## Develop
```bash
npm ci && npm test        # vitest + v8 coverage, Postgres via PGlite (no docker)
DATABASE_URL=... npm run dev
```
Deploy: `render.yaml` (Render web + Postgres) or `vercel.json` (serverless, `api/index.js`).
