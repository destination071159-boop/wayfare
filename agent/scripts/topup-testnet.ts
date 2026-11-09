// Tops up a testnet account with free testnet NEAR: the faucet helper funds a new throwaway account, which is then
// deleted with the target as beneficiary (its balance moves over). Run: pnpm -C agent topup [account]
import { KeyPair } from "near-api-js";
import { account, env } from "../src/near.js";

const target = process.argv[2] ?? env("TRAVELER_ACCOUNT");
const id = `wftop${Date.now().toString(36)}.testnet`;
const kp = KeyPair.fromRandom("ed25519");
const r = await fetch("https://helper.nearprotocol.com/account", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ newAccountId: id, newAccountPublicKey: kp.getPublicKey().toString() }),
});
if (!r.ok) throw new Error(`faucet: ${r.status} ${await r.text()}`);
const tmp = await account(id, kp.toString());
await tmp.deleteAccount(target);
const bal = await (await account(target)).getAccountBalance();
console.log(`${target}: ${(Number(BigInt(bal.available) / 10n ** 21n) / 1000).toFixed(2)} NEAR available`);
