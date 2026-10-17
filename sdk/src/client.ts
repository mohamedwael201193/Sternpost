import {
  type Account, type Address, type Hex, type PublicClient, type WalletClient, type Chain, type Transport,
  zeroAddress,
} from "viem";
import { sternpostGovernorAbi, sternpostFactoryAbi } from "./abi.js";
import { domain, withdrawTypes, repayTypes, addCollTypes, MAX_WINDOW } from "./typed.js";
import { explain } from "./reasons.js";
import { NonceCoordinator, type StandbyState } from "./nonce.js";
import { testnetAddresses } from "./chain.js";

const sigsAbi = [
  { type: "function", name: "getNonce", stateMutability: "view", inputs: [{ name: "b", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

export type Wallet = WalletClient<Transport, Chain, Account>;

export type DrawAuthorization = {
  amount: bigint; nonce: bigint;
  withdrawDeadline: bigint; withdrawSig: Hex;
  healDeadline: bigint; healSig: Hex;
};

export type Preview = { ok: boolean; reason: string; text: string; icrAfter: bigint };

export type GovernorState = {
  address: Address; borrower: Address; icr: bigint; floorICR: bigint; defendICR: bigint; frozen: boolean;
  buffer: bigint; parked: bigint; excess: bigint; nonce: bigint; standby: StandbyState;
};

export class Sternpost {
  readonly nonces: Map<Address, NonceCoordinator> = new Map();
  constructor(
    readonly publicClient: PublicClient,
    readonly addresses: { factory: Address; signatures: Address } = testnetAddresses,
  ) {}

  private now = async () => (await this.publicClient.getBlock()).timestamp;

  nonceOf(borrower: Address): Promise<bigint> {
    return this.publicClient.readContract({ address: this.addresses.signatures, abi: sigsAbi, functionName: "getNonce", args: [borrower] });
  }

  coordinator(borrower: Address): NonceCoordinator {
    let c = this.nonces.get(borrower);
    if (!c) { c = new NonceCoordinator(() => this.nonceOf(borrower)); this.nonces.set(borrower, c); }
    return c;
  }

  async governorOf(borrower: Address): Promise<Address | null> {
    const g = await this.publicClient.readContract({ address: this.addresses.factory, abi: sternpostFactoryAbi, functionName: "governorOf", args: [borrower] });
    return g === zeroAddress ? null : g;
  }

  async createGovernor(wallet: Wallet, floorICR: bigint, defendICR: bigint): Promise<Hex> {
    return wallet.writeContract({ address: this.addresses.factory, abi: sternpostFactoryAbi, functionName: "createGovernor", args: [floorICR, defendICR] });
  }

  async state(governor: Address): Promise<GovernorState> {
    const r = (fn: string) => this.publicClient.readContract({ address: governor, abi: sternpostGovernorAbi, functionName: fn as never }) as Promise<never>;
    const [borrower, icr, floorICR, defendICR, frozen, buffer, parked, excess, sb] = await Promise.all([
      r("borrower"), r("icr"), r("floorICR"), r("defendICR"), r("frozen"), r("buffer"), r("parked"), r("excess"), r("standby"),
    ]) as unknown as [Address, bigint, bigint, bigint, boolean, bigint, bigint, bigint, readonly [bigint, bigint, bigint, boolean]];
    return {
      address: governor, borrower, icr, floorICR, defendICR, frozen, buffer, parked, excess,
      nonce: await this.nonceOf(borrower),
      standby: { amount: sb[0], deadline: sb[1], nonce: sb[2], live: sb[3] },
    };
  }

  /** Dry-run the policy: same checks draw() enforces, with a plain-language reason. */
  async previewDraw(governor: Address, app: Address, amount: bigint, payee: Address): Promise<Preview> {
    const [ok, reason, icrAfter] = await this.publicClient.readContract({
      address: governor, abi: sternpostGovernorAbi, functionName: "previewDraw", args: [app, amount, payee],
    });
    return { ok, reason, text: explain(reason), icrAfter };
  }

  /** Borrower signs the withdraw (to the governor, <=120 s) and its paired heal (repay at nonce+1). */
  async authorizeDraw(borrowerWallet: Wallet, governor: Address, amount: bigint, opts: { window?: bigint; healWindow?: bigint } = {}): Promise<DrawAuthorization> {
    const borrower = borrowerWallet.account.address;
    return this.coordinator(borrower).run(async (nonce) => {
      const t = await this.now();
      const window = opts.window ?? 90n;
      if (window > MAX_WINDOW) throw new Error("withdraw window must be <= 120 s");
      const withdrawDeadline = t + window;
      const healDeadline = t + (opts.healWindow ?? 7n * 86400n);
      const d = domain(borrowerWallet.chain.id, this.addresses.signatures);
      const withdrawSig = await borrowerWallet.signTypedData({ domain: d, types: withdrawTypes, primaryType: "WithdrawMUSD",
        message: { amount, borrower, recipient: governor, nonce, deadline: withdrawDeadline } });
      const healSig = await borrowerWallet.signTypedData({ domain: d, types: repayTypes, primaryType: "RepayMUSD",
        message: { amount, borrower, nonce: nonce + 1n, deadline: healDeadline } });
      return { amount, nonce, withdrawDeadline, withdrawSig, healDeadline, healSig };
    });
  }

  /** The app submits the draw. Refuses locally if the nonce moved since signing. */
  async requestDraw(appWallet: Wallet, governor: Address, payee: Address, a: DrawAuthorization): Promise<Hex> {
    const borrower = (await this.state(governor)).borrower;
    if (!(await this.coordinator(borrower).isFresh(a.nonce))) {
      throw new Error("Stale authorization: another signed Mezo action used this nonce. Ask the borrower to sign again.");
    }
    return appWallet.writeContract({ address: governor, abi: sternpostGovernorAbi, functionName: "draw",
      args: [a.amount, payee, a.withdrawDeadline, a.withdrawSig, a.healDeadline, a.healSig] });
  }

  /** Freeze draws and burn the native nonce (1 wei AddColl), invalidating every outstanding Mezo signature. */
  async revoke(borrowerWallet: Wallet, governor: Address, burnNonce = true): Promise<Hex> {
    const borrower = borrowerWallet.account.address;
    return this.coordinator(borrower).run(async (nonce) => {
      if (!burnNonce) return borrowerWallet.writeContract({ address: governor, abi: sternpostGovernorAbi, functionName: "revoke", args: [0n, "0x"] });
      const deadline = (await this.now()) + 600n;
      const sig = await borrowerWallet.signTypedData({ domain: domain(borrowerWallet.chain.id, this.addresses.signatures), types: addCollTypes,
        primaryType: "AddColl", message: { assetAmount: 1n, borrower, nonce, deadline } });
      return borrowerWallet.writeContract({ address: governor, abi: sternpostGovernorAbi, functionName: "revoke", args: [deadline, sig], value: 1n });
    });
  }

  async unfreeze(borrowerWallet: Wallet, governor: Address): Promise<Hex> {
    return borrowerWallet.writeContract({ address: governor, abi: sternpostGovernorAbi, functionName: "unfreeze" });
  }

  /** Re-arm the defend() standby at the current nonce (needed after any other signed action). */
  async rearm(borrowerWallet: Wallet, governor: Address, amount: bigint, healWindow = 7n * 86400n): Promise<Hex> {
    const borrower = borrowerWallet.account.address;
    return this.coordinator(borrower).run(async (nonce) => {
      const deadline = (await this.now()) + healWindow;
      const sig = await borrowerWallet.signTypedData({ domain: domain(borrowerWallet.chain.id, this.addresses.signatures), types: repayTypes,
        primaryType: "RepayMUSD", message: { amount, borrower, nonce, deadline } });
      return borrowerWallet.writeContract({ address: governor, abi: sternpostGovernorAbi, functionName: "rearm", args: [amount, deadline, sig] });
    });
  }

  async authorizeApp(borrowerWallet: Wallet, governor: Address, p: { app: Address; budget: bigint; perDrawMax: bigint; expiry: bigint; payee?: Address }): Promise<Hex> {
    return borrowerWallet.writeContract({ address: governor, abi: sternpostGovernorAbi, functionName: "authorizeApp",
      args: [p.app, p.budget, p.perDrawMax, p.expiry, p.payee ?? zeroAddress] });
  }
}
