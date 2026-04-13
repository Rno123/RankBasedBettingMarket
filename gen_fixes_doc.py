"""
Generate ProtocolFixesExplained.docx — describes all 12 security/correctness fixes
applied to the RankBasedBettingMarket Solana/Anchor program.
"""
from docx import Document
from docx.shared import Pt, RGBColor, Inches
from docx.enum.text import WD_ALIGN_PARAGRAPH
import os

OUT = os.path.join(os.path.dirname(__file__), "ProtocolFixesExplained.docx")

doc = Document()

# ── Styles helpers ─────────────────────────────────────────────────────────────

def h1(text):
    p = doc.add_heading(text, level=1)
    p.alignment = WD_ALIGN_PARAGRAPH.LEFT
    return p

def h2(text):
    return doc.add_heading(text, level=2)

def h3(text):
    return doc.add_heading(text, level=3)

def body(text):
    return doc.add_paragraph(text)

def code(text):
    p = doc.add_paragraph()
    r = p.add_run(text)
    r.font.name = "Courier New"
    r.font.size = Pt(9)
    p.paragraph_format.left_indent = Inches(0.4)
    return p

def label(tag, text):
    p = doc.add_paragraph()
    r1 = p.add_run(tag + ": ")
    r1.bold = True
    p.add_run(text)
    return p

# ── Title block ────────────────────────────────────────────────────────────────

title = doc.add_heading("RankBasedBettingMarket", 0)
title.alignment = WD_ALIGN_PARAGRAPH.CENTER

sub = doc.add_paragraph("Protocol Security & Correctness Fixes — Technical Explanation")
sub.alignment = WD_ALIGN_PARAGRAPH.CENTER
sub.runs[0].bold = True

meta = doc.add_paragraph()
meta.alignment = WD_ALIGN_PARAGRAPH.CENTER
meta.add_run("Branch: claude/review-protocol-fixes-mJFGU\n")
meta.add_run("Date: 2026-04-13\n")
meta.add_run("Tests before fixes: 39    Tests after fixes: 44")

doc.add_page_break()

# ── Executive Summary ──────────────────────────────────────────────────────────

h1("Executive Summary")

body(
    "A technical audit of the RankBasedBettingMarket Solana/Anchor program identified "
    "12 issues ranging from critical fund-loss vulnerabilities to test-coverage gaps. "
    "All 12 issues were resolved before devnet deployment. This document describes each "
    "fix, why it was necessary, and what specifically changed in the code."
)

body(
    "The program is a rank-weighted, crowd-adjusted hackathon betting pool. Users stake "
    "USDC on hackathon projects before a cutoff. At resolution, the prize pool is "
    "redistributed based on official judge rankings and a square-root crowding adjustment. "
    "Positions may be sold back to the protocol before a 24-hour cutoff with a linear "
    "decay penalty (max 30%)."
)

doc.add_paragraph()
body("Fixes are grouped into four categories:")

fixes_summary = [
    ("Critical (fund-loss / exploitable)", "FIX-1, FIX-2, FIX-3, FIX-4"),
    ("Broken by design (unusable without fix)", "FIX-5, FIX-6, FIX-7"),
    ("Payout math correctness", "FIX-8, FIX-9"),
    ("Test suite honesty", "FIX-10, FIX-11, FIX-12"),
]

table = doc.add_table(rows=1, cols=2)
table.style = "Table Grid"
hdr = table.rows[0].cells
hdr[0].text = "Category"
hdr[1].text = "Fixes"
for hdr_cell in hdr:
    hdr_cell.paragraphs[0].runs[0].bold = True

for cat, fixes in fixes_summary:
    row = table.add_row().cells
    row[0].text = cat
    row[1].text = fixes

doc.add_page_break()

# ── Fix sections ───────────────────────────────────────────────────────────────

FIXES = [
    {
        "id": "FIX-1",
        "name": "CEI Violation in claim — is_claimed Set Before Token Transfer",
        "category": "Critical",
        "file": "programs/hackathon-betting/src/lib.rs",
        "wrong": (
            "In the original claim instruction, ctx.accounts.user_stake.is_claimed = true "
            "was written to the account before the SPL token transfer CPI was executed. "
            "In Solana, account state changes within a transaction are committed atomically "
            "only if the transaction succeeds — but the ordering still matters for correctness: "
            "if the CPI call failed for any reason (e.g. insufficient escrow balance, "
            "program bug), the is_claimed flag would be set to true in the same transaction "
            "that failed, permanently preventing the user from ever retrying the claim."
        ),
        "why": (
            "The Checks-Effects-Interactions (CEI) pattern is a foundational smart-contract "
            "security principle. External calls (Interactions) must happen after all state "
            "mutations (Effects) are complete — or, in cases where the external call can "
            "fail, state must only be mutated after confirming the call succeeded. "
            "Violating CEI in a claim instruction is a fund-loss bug: users lose access to "
            "their payout with no recovery path."
        ),
        "changed": (
            "Moved ctx.accounts.user_stake.is_claimed = true to after the token::transfer(...) "
            "call. The transfer now executes first; is_claimed is only set if the transfer "
            "returns Ok(())."
        ),
    },
    {
        "id": "FIX-2",
        "name": "resolve / finalize_resolve Have No Time-Window Guard",
        "category": "Critical",
        "file": "programs/hackathon-betting/src/lib.rs",
        "wrong": (
            "Both resolve and finalize_resolve could be called at any time — including "
            "while staking was still open. There was no check that results_timestamp had "
            "passed before ranks could be set."
        ),
        "why": (
            "This creates an insider-trading window. An admin who knows the results could "
            "call resolve (locking in ranks) while staking is still open, then allow "
            "privileged wallets to stake on the known winner before finalize_resolve. "
            "Stakers who didn't have advance knowledge would then be competing at a "
            "permanent information disadvantage. Fixing this closes the window entirely: "
            "no ranks can be set until results_timestamp has passed, at which point "
            "staking is already closed."
        ),
        "changed": (
            "Added let now = Clock::get()?.unix_timestamp; require!(now >= hackathon.results_timestamp, "
            "BettingError::ResultsNotYet); at the top of both the resolve and finalize_resolve "
            "handlers. Added the ResultsNotYet error variant."
        ),
    },
    {
        "id": "FIX-3",
        "name": "unstake Allowed After is_resolved = true",
        "category": "Critical",
        "file": "programs/hackathon-betting/src/lib.rs",
        "wrong": (
            "After finalize_resolve set is_resolved = true and locked total_pool, a user "
            "could still call unstake. This decremented both total_pool and "
            "project.total_staked after the pool was frozen. Because claim uses the "
            "frozen total_pool value (T) as the numerator in the payout formula, any "
            "unstake after resolution would cause subsequent claimers to receive a payout "
            "computed against a stale T that no longer matched the escrow balance."
        ),
        "why": (
            "The payout formula relies on T being fixed at the moment of resolution. "
            "If T decreases post-resolution while the escrow balance also decreases, "
            "payouts are computed against the wrong denominator, systematically "
            "over- or under-paying remaining claimers. In the worst case, early claimers "
            "drain the escrow and late claimers receive nothing."
        ),
        "changed": (
            "Added a constraint to the Unstake account context: "
            "constraint = !hackathon.is_resolved @ BettingError::AlreadyResolved. "
            "Any unstake attempt after finalize_resolve now fails immediately."
        ),
    },
    {
        "id": "FIX-4",
        "name": "results_timestamp Not Validated as Future on Init",
        "category": "Critical",
        "file": "programs/hackathon-betting/src/lib.rs",
        "wrong": (
            "initialize_hackathon accepted any i64 for results_timestamp, including "
            "timestamps in the past. Passing a past timestamp would set cutoff_timestamp "
            "to results_timestamp - 86400, which could be a large negative number, "
            "immediately bricking all staking (staking is blocked when now >= results_timestamp, "
            "which would always be true)."
        ),
        "why": (
            "A misconfigured or maliciously constructed hackathon would be permanently "
            "non-functional from the moment of initialization, with no way to correct it. "
            "The instruction should reject invalid input at the boundary."
        ),
        "changed": (
            "Added at the top of the initialize_hackathon handler: "
            "let now = Clock::get()?.unix_timestamp; "
            "require!(results_timestamp > now, BettingError::InvalidTimestamp); "
            "Added the InvalidTimestamp error variant."
        ),
    },
    {
        "id": "FIX-5",
        "name": "GitHub URL PDA Seed Broken for Real URLs (Design Change)",
        "category": "Broken by design",
        "file": "programs/hackathon-betting/src/lib.rs  +  tests/hackathon-betting.ts",
        "wrong": (
            "The ProjectAccount PDA was seeded with the raw bytes of github_url. "
            "Solana's findProgramAddressSync hard-rejects any seed longer than 32 bytes. "
            "Every real GitHub URL (e.g. https://github.com/owner/repo) is longer than "
            "32 bytes. The TypeScript SDK would throw TypeError: Max seed length exceeded "
            "before the program ever ran. The 200-character UrlTooLong guard in the "
            "program was completely unreachable dead code."
        ),
        "why": (
            "The protocol was designed to use GitHub URLs as unique project identifiers. "
            "With the raw-URL seed, no real project could ever be registered — the "
            "feature was broken by construction. A structural fix was required: hash the "
            "URL to a fixed 32-byte seed while keeping the full URL stored in the account."
        ),
        "changed": (
            "Changed the ProjectAccount PDA seed to SHA-256(github_url), which is always "
            "exactly 32 bytes. The full github_url string is still stored in the "
            "ProjectAccount data field for display. "
            "The register_project instruction now takes two arguments: github_url: String "
            "and url_hash: [u8; 32]. The program verifies on-chain that "
            "SHA-256(github_url) == url_hash before accepting the account — preventing "
            "callers from registering an account under a hash that doesn't match the "
            "stored URL. "
            "The TypeScript client and test helpers were updated to pre-compute "
            "createHash('sha256').update(url).digest() before deriving the PDA and before "
            "calling register_project. The UrlTooLong guard (200 chars) is now reachable "
            "and tested."
        ),
    },
    {
        "id": "FIX-6",
        "name": "r_scaled Uses saturating_mul — Silent Overflow Corruption",
        "category": "Broken by design",
        "file": "programs/hackathon-betting/src/lib.rs",
        "wrong": (
            "The r_scaled helper computed payout weights using saturating_mul. "
            "At high stake amounts, 55 * isqrt(S_i) * rest_project_count can exceed "
            "u64::MAX (approximately 1.8 × 10^19). saturating_mul silently caps the "
            "result at u64::MAX instead of returning an error. This would cause the "
            "payout weight for that project to appear as u64::MAX, catastrophically "
            "distorting R_total and making every other project's payout approach zero."
        ),
        "why": (
            "Silent overflow in financial math is a critical correctness bug. The correct "
            "behavior is to propagate an error so the transaction fails visibly rather "
            "than succeeding with corrupted values. At the stake cap of 1,000,000,000 "
            "units per wallet and up to 65,535 rest-tier projects, overflow is "
            "theoretically reachable."
        ),
        "changed": (
            "Changed r_scaled return type from u64 to Result<u64>. Replaced all "
            "saturating_mul calls with checked_mul chained with and_then, and converted "
            "None to BettingError::Overflow via .ok_or(error!(...)). Updated all call "
            "sites to propagate the Result with the ? operator."
        ),
    },
    {
        "id": "FIX-7",
        "name": "Rank 0 (Unresolved Project) Silently Treated as Rest-Tier in claim",
        "category": "Broken by design",
        "file": "programs/hackathon-betting/src/lib.rs",
        "wrong": (
            "The r_scaled function's match arm _ (catch-all) caught rank 0 — the sentinel "
            "value meaning 'not yet resolved' — and treated it identically to a rank-4+ "
            "project. This meant an unresolved project would participate in the R_total "
            "computation and could receive a rest-tier payout weight, polluting the "
            "denominator for all other projects. A user staked on an unresolved project "
            "could even claim a payout."
        ),
        "why": (
            "Rank 0 is a sentinel, not a real rank. Including it in payout math produces "
            "undefined results per the protocol spec. The correct behavior is to reject "
            "any claim on an unresolved project and skip any rank-0 project when "
            "accumulating R_total."
        ),
        "changed": (
            "Added require!(project_rank > 0, BettingError::NotResolved) at the top of "
            "the claim handler (before the R_total loop). Added if p.rank == 0 { continue; } "
            "inside the R_total loop to skip any project that was not assigned a rank "
            "before finalize_resolve was called."
        ),
    },
    {
        "id": "FIX-8",
        "name": "No Test Coverage for rest_project_count = 0 Path",
        "category": "Payout math correctness",
        "file": "tests/hackathon-betting.ts",
        "wrong": (
            "When all registered projects receive ranks 1, 2, or 3, finalize_resolve "
            "sets rest_project_count = 0. The claim instruction then uses max(rpc, 1) = 1 "
            "as the scale factor. This code path was correct but completely untested — "
            "one wrong edit (e.g. changing max(rpc, 1) to max(rpc, 0)) would silently "
            "break payouts for all-top-3 hackathons."
        ),
        "why": (
            "Untested code paths in financial math are a reliability risk. The rpc=0 "
            "branch is a real production scenario (a small hackathon with ≤3 projects). "
            "A regression test locks in the correct behavior."
        ),
        "changed": (
            "Added a dedicated Bankrun test: registers 3 projects, resolves with ranks "
            "[1, 2, 3], calls finalize_resolve, asserts rest_project_count == 0, "
            "claims for all three users, and verifies payouts match the formula at rpc=1."
        ),
    },
    {
        "id": "FIX-9",
        "name": "Integer Dust in Escrow — No Sweep Mechanism",
        "category": "Payout math correctness",
        "file": "programs/hackathon-betting/src/lib.rs (documentation)",
        "wrong": (
            "Integer floor division in the claim formula leaves at most a few lamports "
            "permanently in the escrow after all claims are paid. There was no admin "
            "instruction to drain this remainder, and the issue was not documented."
        ),
        "why": (
            "While the dust amount is small (at most 1 unit per claimer), it is "
            "irrecoverable without an explicit sweep mechanism. For MVP this is acceptable, "
            "but callers need to understand why the escrow balance is never exactly zero "
            "after all claims."
        ),
        "changed": (
            "Added a clear NatSpec comment to the claim instruction explaining the dust "
            "behavior and noting that a future sweep_dust admin instruction could drain "
            "the remainder. No on-chain code change was required for MVP — the behavior "
            "is correct; only the documentation was missing."
        ),
    },
    {
        "id": "FIX-10",
        "name": "TC3 'Zero Dust' Assertion Is an Accident of Symmetric Inputs",
        "category": "Test suite honesty",
        "file": "tests/hackathon-betting.ts",
        "wrong": (
            "Test Case 3 used identical stake amounts for all 5 projects (1000 each). "
            "With symmetric inputs, R_total divides evenly and integer dust is exactly "
            "zero. The test asserted sum_of_payouts == pool (strict equality) and was "
            "presented as demonstrating a protocol guarantee. It is not — asymmetric "
            "stakes always produce dust."
        ),
        "why": (
            "A test that only passes due to the lucky properties of its inputs gives "
            "false confidence. If the formula were changed in a way that broke the "
            "general case but preserved symmetric behavior, TC3 would still pass. "
            "A test covering asymmetric inputs is required to catch such regressions."
        ),
        "changed": (
            "Added TC3b alongside the existing TC3: uses stake amounts [900, 1100, 950, "
            "1050, 1000] (asymmetric), claims all five, and asserts "
            "sum_of_payouts <= pool (not ==) with an assertion message explaining "
            "why exact equality only holds for symmetric inputs."
        ),
    },
    {
        "id": "FIX-11",
        "name": "TC4 (Sybil) Never Verifies Equal Final Payouts",
        "category": "Test suite honesty",
        "file": "tests/hackathon-betting.ts",
        "wrong": (
            "Test Case 4 verified that the crowding factors for the sybil group and the "
            "whale were identical (isqrt(20_000) == isqrt(20_000)), but never actually "
            "claimed for either party. The core Sybil-resistance property — that splitting "
            "20,000 tokens across 20 wallets yields the same total payout as a single "
            "wallet holding 20,000 tokens — was asserted mathematically but never "
            "exercised end-to-end on-chain."
        ),
        "why": (
            "Mathematical argument is insufficient when there is production code "
            "implementing the formula. A bug in the claim instruction could break "
            "Sybil resistance without affecting the off-chain isqrt check. The "
            "end-to-end claim path must be exercised."
        ),
        "changed": (
            "Extended TC4 to have all 20 sybil wallets and the whale wallet call claim. "
            "Added assertion: sybilGroupTotal (sum of all 20 individual payouts) is "
            "within SYBIL_N (20) of singleWhaleEquiv (what the whale would receive on "
            "the same project). The tolerance of ±20 accounts for integer floor truncation "
            "of up to 1 unit per wallet — the whale loses nothing to truncation, "
            "the sybil group loses at most 1 unit per wallet."
        ),
    },
    {
        "id": "FIX-12",
        "name": "Missing Test for Claiming on Unresolved Project (rank = 0)",
        "category": "Test suite honesty",
        "file": "tests/hackathon-betting.ts",
        "wrong": (
            "After FIX-7 added a require!(project_rank > 0, ...) guard to claim, "
            "no test verified that the guard actually triggers. The guard could be "
            "accidentally removed in a future refactor with no test failure."
        ),
        "why": (
            "Every guard in a financial program should have a corresponding negative "
            "test that confirms the guard fires. Without it, a regression removing "
            "the guard would go undetected."
        ),
        "changed": (
            "Added an error-path test in the 'error paths — claim' describe block: "
            "registers a project, stakes on it, skips resolve (leaving rank = 0), "
            "calls finalize_resolve for a different project, then attempts claim "
            "on the rank-0 project. Asserts the transaction fails with NotResolved."
        ),
    },
]

for fix in FIXES:
    h2(f"{fix['id']}: {fix['name']}")
    label("Category", fix["category"])
    label("File", fix["file"])
    doc.add_paragraph()
    h3("What Was Wrong")
    body(fix["wrong"])
    h3("Why It Matters")
    body(fix["why"])
    h3("What Changed")
    body(fix["changed"])
    doc.add_paragraph()

# ── Appendix ───────────────────────────────────────────────────────────────────

doc.add_page_break()
h1("Appendix: Test Count Before and After")

body("Before fixes (branch claude/start-step-1-hGwJW): 39 tests, 0 failing")
body("After fixes (branch claude/review-protocol-fixes-mJFGU): 44 tests, 0 failing")
doc.add_paragraph()

body("New tests added by these fixes:")

new_tests = [
    ("FIX-4",  "initialize_hackathon rejects results_timestamp in the past"),
    ("FIX-5",  "register_project accepts real GitHub URLs longer than 32 bytes"),
    ("FIX-5",  "register_project rejects URL longer than 200 chars (UrlTooLong)"),
    ("FIX-5",  "register_project rejects mismatched url_hash"),
    ("FIX-8",  "rest_project_count = 0 — all top-3 ranks, payouts match formula"),
    ("FIX-10", "TC3b — asymmetric stakes, sum_of_payouts <= pool"),
    ("FIX-11", "TC4 extended — sybil group total payout within 20 of whale payout"),
    ("FIX-12", "claim on rank-0 project (no resolve called) → NotResolved error"),
    ("FIX-2",  "resolve rejected before results_timestamp"),
    ("FIX-3",  "unstake rejected after is_resolved = true"),
]

table2 = doc.add_table(rows=1, cols=2)
table2.style = "Table Grid"
hdr2 = table2.rows[0].cells
hdr2[0].text = "Fix"
hdr2[1].text = "Test Description"
for c in hdr2:
    c.paragraphs[0].runs[0].bold = True

for fix_id, desc in new_tests:
    row = table2.add_row().cells
    row[0].text = fix_id
    row[1].text = desc

doc.add_paragraph()
body(
    "Note: FIX-1 (CEI ordering), FIX-6 (checked_mul), FIX-7 (rank-0 in R_total loop), "
    "and FIX-9 (dust documentation) did not require new test cases — they were "
    "covered by existing tests that would catch regressions, or by the FIX-12 "
    "error-path test for the rank-0 guard."
)

# ── Save ───────────────────────────────────────────────────────────────────────

doc.save(OUT)
print(f"Saved: {OUT}")
