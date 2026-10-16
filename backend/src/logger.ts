import pino from "pino";
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "sternpost-api" },
  redact: ["req.headers.authorization", "req.headers['payment-signature']", "req.headers['x-payment']"],
});
