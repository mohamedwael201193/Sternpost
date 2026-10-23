#!/usr/bin/env python3
"""Prove deployed runtime bytecode equals a local `forge build`, with immutable slots masked.

Usage: forge build && python3 script/bytecode-match.py   (reads ../shared/deployments/testnet.json)
Used because explorer source verification on Mezo testnet was unavailable (see judges/VERIFY.md)."""
import json, subprocess, sys, pathlib

RPC = "https://rpc.test.mezo.org"
root = pathlib.Path(__file__).resolve().parents[1]
dep = json.loads((root.parent / "shared/deployments/testnet.json").read_text())["sternpost"]
targets = {
    "SternpostFactory": dep["SternpostFactory"]["address"],
    "SternpostGovernor": dep["governor"],
    "SpendWallet": dep["spendWallet"],
}
ok = True
for name, addr in targets.items():
    art = json.loads((root / f"out/{name}.sol/{name}.json").read_text())["deployedBytecode"]
    local = bytearray.fromhex(art["object"][2:])
    chain = bytearray.fromhex(subprocess.check_output(["cast", "code", addr, "--rpc-url", RPC], text=True).strip()[2:])
    masked = 0
    for refs in art.get("immutableReferences", {}).values():
        for r in refs:
            s, n = r["start"], r["length"]
            local[s:s + n] = chain[s:s + n] = b"\0" * n
            masked += 1
    same = local == chain
    ok &= same
    print(f"{'MATCH' if same else 'DIFF '} {name:18} {addr} ({len(chain)} bytes, {masked} immutable slots masked, ipfs metadata 0x{chain[-45:-11].hex()[:16]}…)")
sys.exit(0 if ok else 1)
