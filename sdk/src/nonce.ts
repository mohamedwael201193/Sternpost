/**
 * Mezo signature operations share ONE nonce per borrower. Any signed action (a draw by app A, a nonce burn, a
 * repayment) invalidates every other outstanding signature. NonceCoordinator serialises signing inside a process and
 * re-reads the chain nonce before each signature so a stale nonce is detected instead of silently failing.
 */
export class NonceCoordinator {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly read: () => Promise<bigint>) {}

  /** Run `fn` with the current on-chain nonce, one at a time. */
  run<T>(fn: (nonce: bigint) => Promise<T>): Promise<T> {
    const next = this.tail.then(async () => fn(await this.read()));
    this.tail = next.catch(() => undefined);
    return next;
  }

  /** True when a signature made for `nonce` can still be used. */
  async isFresh(nonce: bigint): Promise<boolean> {
    return (await this.read()) === nonce;
  }
}

export type StandbyState = { amount: bigint; deadline: bigint; nonce: bigint; live: boolean };

/** Plain-language status for the defend() standby, as shown in the dashboard. */
export function describeStandby(s: StandbyState, now = BigInt(Math.floor(Date.now() / 1000))): string {
  if (s.amount === 0n) return "No safety repayment armed.";
  if (s.live) return "Safety repayment armed and valid.";
  if (s.deadline < now) return "Safety repayment expired. Re-arm it.";
  return "Another signed action used your Mezo nonce, so the safety repayment no longer applies. Re-arm it.";
}
