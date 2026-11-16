import { encodeFunctionData, parseAbi, type Hex, type PublicClient, type WalletClient } from "viem";
import type { FactoryChecker } from "./factory.js";

/**
 * Relayer (plan 5.7, task 2.4): gas-sponsors `drawBySig` for sandbox agents
 * and testnet users. Testnet (chain 31611) ONLY.
 *
 * Hard refusals, in order:
 *  1. chainId 31612 (mainnet) -> 403 `mainnet_refused`. No env override exists:
 *     mainnet relaying is off by design (a mainnet draw costs real BTC gas and
 *     the 10 bps fee cannot cover a micro-payment; plan 3.4). The configured
 *     chain is additionally pinned to 31611 at startup (loadConfig /
 *     buildRuntime / buildRelayer), so no env can enable a mainnet relay.
 *  2. any other chainId -> 400 `unsupported_network`.
 *  3. no account factory configured -> 503 `factory_not_configured`.
 *  4. account not created by the Factory (`isAccount` false, incl. RPC errors)
 *     -> 403 `not_factory_account`.
 *  5. no relayer key configured -> 503 `relayer_unavailable`.
 *  6. eth_call simulation of `drawBySig` reverts -> 422 `simulation_failed`
 *     (the tx is never sent; the revert reason is returned verbatim).
 *  7. per-agent rate limit (20/hour, plan 5.3) -> 429 `relay_rate_limited`.
 *     The limit is taken AFTER simulation on purpose: refused requests
 *     (factory / simulation failures) never burn quota, and only a request
 *     that is about to be sent consumes one unit.
 *  8. send failure (RPC / nonce / broadcast error) -> 502 `relay_send_failed`
 *     with the reason, not a generic 500.
 *
 * Only after all of the above does the relayer sign and send. Responses are
 * labelled `relayedBy: "sternpost-relayer"` and `network: "eip155:31611"`.
 */

export const RELAYER_CHAIN_ID = 31611;
export const MAINNET_CHAIN_ID = 31612;

/**
 * Fail fast at startup when the configured chain is anything but Mezo
 * testnet (31611). Per-request validation in validateRelayDraw is not
 * enough on its own: the runtime builds both viem clients from the
 * configured CHAIN_ID, so CHAIN_ID=31612 + a mainnet RPC would broadcast
 * on mainnet. Called by buildRuntime and buildRelayer; loadConfig enforces
 * the same rule via a zod refinement on CHAIN_ID.
 */
export function assertTestnetChain(chainId: number): void {
  if (chainId !== RELAYER_CHAIN_ID) {
    throw new Error(
      `CHAIN_ID must be ${RELAYER_CHAIN_ID} (Mezo testnet); got ${chainId} — mainnet relaying is refused`,
    );
  }
}
export const RELAY_RATE_LIMIT_PER_HOUR = 20;
export const RELAY_GAS_LIMIT = 6_000_000n; // one drawBySig measures ~4M gas on Mezo; 6M leaves headroom under the 10M block limit

export const drawBySigAbi = parseAbi([
  "function drawBySig(address agent, address payee, uint256 amount, uint256 deadline, bytes sig)",
]);

export interface RelayDrawInput {
  chainId: number;
  account: `0x${string}`;
  agent: `0x${string}`;
  payee: `0x${string}`;
  amount: bigint;
  deadline: number;
  sig: Hex;
}

export interface RelayRefusal {
  error: string;
  status: number;
  reason?: string;
}

export type RelayResult =
  | { ok: true; txHash: `0x${string}`; relayedBy: "sternpost-relayer"; network: "eip155:31611" }
  | { ok: false; error: string; status: number; reason?: string };

/** Pure input validation (no chain access). Returns a refusal or null. */
export function validateRelayDraw(input: RelayDrawInput, nowSec: number): RelayRefusal | null {
  if (input.chainId === MAINNET_CHAIN_ID) return { error: "mainnet_refused", status: 403 };
  if (input.chainId !== RELAYER_CHAIN_ID) return { error: "unsupported_network", status: 400 };
  if (input.amount <= 0n) return { error: "zero_amount", status: 400 };
  if (input.deadline <= nowSec) return { error: "intent_expired", status: 400 };
  if (input.sig.length !== 132) return { error: "bad_signature", status: 400 }; // 0x + 65 bytes
  return null;
}

/** Fixed-window per-agent limiter (20/hour). `now` is injectable for tests.
 *
 * LIMITATION (documented, not fixed): the limit key is the unauthenticated,
 * body-supplied `agent` address — anyone can burn a victim agent's quota by
 * submitting draws naming that agent. There is no authenticated identity
 * available to key on (the relay request carries no signature over the
 * caller), so no authenticated key exists to switch to without inventing
 * auth. The limit still bounds the relayer's total spend per named agent.
 */
export class RelayRateLimiter {
  private hits = new Map<string, { count: number; reset: number }>();
  constructor(
    private limit = RELAY_RATE_LIMIT_PER_HOUR,
    private windowMs = 3_600_000,
    private now = () => Date.now(),
  ) {}

  /** True when the agent still has quota (and consumes one unit). */
  take(agent: string): boolean {
    const key = agent.toLowerCase();
    const t = this.now();
    let e = this.hits.get(key);
    if (!e || e.reset <= t) {
      e = { count: 0, reset: t + this.windowMs };
      this.hits.set(key, e);
    }
    e.count++;
    if (e.count > this.limit) return false;
    if (this.hits.size > 10_000) for (const [k, v] of this.hits) if (v.reset <= t) this.hits.delete(k);
    return true;
  }
}

export interface RelayerDeps {
  factory: `0x${string}` | null;
  isAccount: FactoryChecker;
  /** Null when RELAYER_PRIVATE_KEY is unset: refusals still apply, sends return 503. */
  relayerAddress: `0x${string}` | null;
  /** eth_call simulation of drawBySig from the relayer address. Throws on revert. */
  simulate: (input: RelayDrawInput) => Promise<void>;
  /** Submits drawBySig and returns the tx hash. */
  send: (input: RelayDrawInput) => Promise<`0x${string}`>;
  /**
   * REQUIRED, and exactly one instance per runtime (built by buildRelayer).
   * It must NOT be defaulted per call (`?? new RelayRateLimiter()`): a fresh
   * limiter per request can never fill, so the 429 could never fire.
   */
  rateLimit: RelayRateLimiter;
  nowSec?: () => number;
}

/**
 * Full relay pipeline: validate -> factory gate -> simulate -> rate limit
 * (taken only once the request is about to be sent, so refusals never burn
 * quota) -> send. The rate limit is keyed on the unauthenticated
 * body-supplied `agent` address — see RelayRateLimiter.
 */
export async function relayDraw(deps: RelayerDeps, input: RelayDrawInput): Promise<RelayResult> {
  const bad = validateRelayDraw(input, deps.nowSec?.() ?? Math.floor(Date.now() / 1000));
  if (bad) return { ok: false, ...bad };
  if (!deps.factory) return { ok: false, error: "factory_not_configured", status: 503 };
  // Fail closed: any factory-read error (incl. RPC outage) refuses the relay.
  let isFactoryAccount = false;
  try {
    isFactoryAccount = await deps.isAccount(input.account);
  } catch {
    isFactoryAccount = false;
  }
  if (!isFactoryAccount) {
    return { ok: false, error: "not_factory_account", status: 403 };
  }
  if (!deps.relayerAddress) return { ok: false, error: "relayer_unavailable", status: 503 };
  try {
    await deps.simulate(input);
  } catch (err) {
    return { ok: false, error: "simulation_failed", status: 422, reason: String(err) };
  }
  if (!deps.rateLimit.take(input.agent)) {
    return { ok: false, error: "relay_rate_limited", status: 429 };
  }
  try {
    const txHash = await deps.send(input);
    return { ok: true, txHash, relayedBy: "sternpost-relayer", network: "eip155:31611" };
  } catch (err) {
    return { ok: false, error: "relay_send_failed", status: 502, reason: String(err) };
  }
}

export function encodeDrawBySig(input: RelayDrawInput): Hex {
  return encodeFunctionData({
    abi: drawBySigAbi,
    functionName: "drawBySig",
    args: [input.agent, input.payee, input.amount, BigInt(input.deadline), input.sig],
  });
}

/** Live chain deps from viem clients (used by runtime.ts; never in tests). */
export function liveRelayerClients(publicClient: PublicClient, walletClient: WalletClient | null) {
  return {
    simulate: async (input: RelayDrawInput) => {
      await publicClient.call({
        account: walletClient?.account?.address,
        to: input.account,
        data: encodeDrawBySig(input),
      });
    },
    send: async (input: RelayDrawInput): Promise<`0x${string}`> => {
      if (!walletClient || !walletClient.account) throw new Error("relayer_unavailable");
      return walletClient.sendTransaction({
        account: walletClient.account,
        to: input.account,
        data: encodeDrawBySig(input),
        gas: RELAY_GAS_LIMIT,
        chain: walletClient.chain,
      });
    },
    relayerAddress: (walletClient?.account?.address ?? null) as `0x${string}` | null,
  };
}
