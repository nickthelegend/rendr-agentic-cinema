// Notarising a film on a public chain.
//
// The question this answers is the one every generative-video tool eventually
// gets asked: *how does anyone know what was machine-generated, and from what?*
// A claim in a README is worth nothing. A digest of the render manifest, signed
// and written to a public ledger at a known time, is checkable by someone who
// does not trust us — which is the entire point.
//
// Stellar testnet, for three reasons. Its faucet funds an account over plain
// HTTP with no captcha and no sign-up, so this works on a fresh machine with no
// credential in sight. A transaction carries a 32-byte MEMO_HASH, which is
// exactly a SHA-256 digest with nothing to truncate. And `manageData` puts a
// few human-legible fields on the account itself, so reading the chain back
// returns something a person can look at rather than an opaque blob.
//
// The key lives here, in the server's environment, and never in the bundle —
// the same rule the Clickhouse credential follows. It is a testnet key holding
// test lamports of no value; that is stated plainly rather than implied.

import { createHash } from "node:crypto";

import * as Stellar from "@stellar/stellar-sdk";

const HORIZON = process.env.STELLAR_HORIZON ?? "https://horizon-testnet.stellar.org";
const FRIENDBOT = process.env.STELLAR_FRIENDBOT ?? "https://friendbot.stellar.org";
const PASSPHRASE = process.env.STELLAR_PASSPHRASE ?? Stellar.Networks.TESTNET;
const EXPLORER = "https://stellar.expert/explorer/testnet/tx/";

let cached = null;

/**
 * The signing account, funded on first use.
 *
 * A configured secret is used as-is. Without one the server makes a keypair and
 * asks the faucet to fund it, which keeps a fresh deployment working — but the
 * account is then only as durable as the process, so the secret is logged once
 * with instructions rather than silently lost.
 */
async function signer() {
	if (cached) return cached;
	const configured = process.env.STELLAR_SECRET;
	const keypair = configured
		? Stellar.Keypair.fromSecret(configured)
		: Stellar.Keypair.random();
	const server = new Stellar.Horizon.Server(HORIZON);

	try {
		await server.loadAccount(keypair.publicKey());
	} catch {
		// Not on chain yet. The faucet creates and funds it in one step; a
		// failure here is worth surfacing rather than retrying forever, because
		// every later call would fail the same way.
		const funded = await fetch(`${FRIENDBOT}?addr=${encodeURIComponent(keypair.publicKey())}`);
		if (!funded.ok) {
			throw new Error(
				`The testnet faucet refused to fund ${keypair.publicKey()} (${funded.status}).`,
			);
		}
		await server.loadAccount(keypair.publicKey());
	}

	if (!configured) {
		console.log(
			`[notary] no STELLAR_SECRET set; using a generated account. To keep the same ` +
				`identity across restarts set STELLAR_SECRET=${keypair.secret()} — it is a ` +
				`testnet key and holds nothing of value.`,
		);
	}
	cached = { keypair, server };
	return cached;
}

/** The digest a manifest gets, computed the same way on both sides. */
export const digestOf = (manifest) =>
	createHash("sha256").update(JSON.stringify(manifest)).digest();

/**
 * Stellar's data entries are 64 bytes at most, and a value longer than that is
 * rejected by the network rather than truncated. Cutting here keeps a long film
 * name from failing the whole transaction.
 */
const field = (value) => Buffer.from(String(value)).subarray(0, 64).toString();

/**
 * Signs and submits one notarisation.
 *
 * The digest is the payload; the data entries exist so that reading the account
 * back tells a person which film they are looking at without having to hold the
 * original manifest to compare against.
 */
export async function notarise(manifest) {
	const { keypair, server } = await signer();
	const digest = digestOf(manifest);
	const account = await server.loadAccount(keypair.publicKey());

	const transaction = new Stellar.TransactionBuilder(account, {
		fee: Stellar.BASE_FEE,
		networkPassphrase: PASSPHRASE,
	})
		.addMemo(Stellar.Memo.hash(digest))
		.addOperation(
			Stellar.Operation.manageData({ name: "film", value: field(manifest.film ?? "untitled") }),
		)
		.addOperation(
			Stellar.Operation.manageData({ name: "shots", value: field(manifest.shots ?? 0) }),
		)
		.addOperation(
			Stellar.Operation.manageData({ name: "model", value: field(manifest.model ?? "unknown") }),
		)
		.setTimeout(60)
		.build();
	transaction.sign(keypair);

	const result = await server.submitTransaction(transaction);
	return {
		hash: result.hash,
		ledger: result.ledger,
		account: keypair.publicKey(),
		digest: digest.toString("hex"),
		network: "stellar-testnet",
		explorer: EXPLORER + result.hash,
	};
}

/**
 * Reads a notarisation back off the chain.
 *
 * Deliberately a fetch from Horizon rather than anything this process
 * remembers. A verification that consults our own memory verifies nothing — the
 * whole value is that the record is somewhere we do not control.
 */
export async function readBack(hash) {
	const { server } = await signer();
	const transaction = await server.transactions().transaction(hash).call();
	if (transaction.memo_type !== "hash") {
		throw new Error("That transaction carries no digest.");
	}
	return {
		hash: transaction.hash,
		ledger: transaction.ledger_attr ?? transaction.ledger,
		at: transaction.created_at,
		account: transaction.source_account,
		digest: Buffer.from(transaction.memo, "base64").toString("hex"),
		network: "stellar-testnet",
		explorer: EXPLORER + transaction.hash,
	};
}
