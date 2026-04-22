# Builder Deposit — Design Alternatives

This document records two alternative approaches that were considered but **not** built for the MVP. They are preserved here as technical references for future iterations.

---

## Sub-option 2: Merkle Root Batch Approval

Instead of passing approved project PDAs as `remaining_accounts` (current approach, ~30 per tx), the admin could commit a Merkle root of all approved builder pubkeys on-chain in a single transaction.

### How it works

**Admin side (off-chain):**
1. Collect the set of approved builder public keys (e.g., from a CSV of submitted projects).
2. Build a Merkle tree where each leaf = `sha256(builder_pubkey)`.
3. Emit the 32-byte Merkle root in a single `set_approval_root(root: [u8; 32])` instruction.

**Builder side (on-chain claim):**
1. Builder calls `claim_deposit_refund(proof: Vec<[u8; 32]>)` with their Merkle proof (log2(N) hashes).
2. The program re-derives the root by hashing the builder's pubkey up the tree: `leaf = sha256(builder.key()); ... verify(root, leaf, proof)`.
3. If the root matches `hackathon.approval_root`, the refund is processed.

### Trade-offs vs. current approach

| | Current (remaining_accounts) | Merkle root |
|---|---|---|
| Admin tx count | ceil(N/30) | 1 |
| Builder action | Admin pushes; builder passive | Builder must submit proof |
| On-chain complexity | Simple iteration | Hash verification loop |
| Proof size per claim | N/A | O(log₂ N) |
| Trust model | Admin-gated write | Cryptographic inclusion proof |

The Merkle approach is better at scale (hundreds of builders) and gives builders a trustless proof of inclusion. For an MVP with ≤30 approved projects per batch, the current approach is simpler to audit and ship.

---

## Option C: Ed25519 Oracle (Trustless Off-Chain Verification)

A fully trustless design where the admin never touches the chain for approvals. Instead, an off-chain oracle signs an attestation, and any builder can verify it on-chain via Solana's native `Ed25519Program` precompile.

### How it works

**Admin/oracle side (off-chain):**
1. Admin generates a keypair `oracle_keypair` whose public key is stored in `HackathonState.oracle_pubkey` at initialization.
2. For each approved builder, admin signs: `msg = sha256("approved" || hackathon_pubkey || builder_pubkey || unix_timestamp)`.
3. Admin hands the `(signature, timestamp)` to the approved builder out-of-band (e.g., via email/Discord).

**Builder side (on-chain claim):**
1. Builder submits a transaction with two instructions:
   - `Ed25519Program.createInstructionWithPublicKey(oracle_pubkey, msg, signature)` — validates the signature in the precompile.
   - `claim_deposit_refund()` — the program reads `sysvar::instructions` to confirm the preceding Ed25519 check passed for the correct message.
2. If both pass, the refund is processed. The oracle signature acts as the admin approval.

### Trade-offs

| | Current (remaining_accounts) | Ed25519 Oracle |
|---|---|---|
| Admin on-chain action | Required (approve_submissions) | None — purely off-chain signing |
| Builder trust requirement | Trust admin to call approve_submissions | Trust oracle keypair security |
| Replay protection | PDA flag (`deposit_refunded`) | Timestamp + PDA flag |
| Implementation complexity | Low | High (sysvar::instructions parsing) |
| Audit surface | Anchor constraints | Ed25519 precompile + instruction introspection |

Ed25519 oracle is the gold standard for trustless off-chain attestation and avoids any admin on-chain transactions entirely. It is the right design for a production protocol where the admin key should be cold. For a hackathon MVP, the operational complexity outweighs the trust reduction.
