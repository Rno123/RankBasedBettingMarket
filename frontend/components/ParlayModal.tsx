"use client";

import { useMemo, useState } from "react";
import { BN } from "@coral-xyz/anchor";
import { SystemProgram, Transaction } from "@solana/web3.js";
import { useAnchorWallet, useConnection, useWallet } from "@solana/wallet-adapter-react";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { getProgram } from "@/lib/program";
import { stakePda } from "@/lib/pda";
import { buildStakeAccounts } from "@/lib/transactions";
import { formatTokens, parseTokens, repoName } from "@/lib/format";
import { computeShares, estimatePayout, formatRoi, splitSlipAmounts } from "@/lib/payout";
import { useTokenBalance } from "@/hooks/useTokenBalance";
import type { HackathonInfo } from "@/hooks/useHackathons";
import type { ProjectInfo } from "@/hooks/useProjects";
import type { UserStakeInfo } from "@/hooks/useUserStake";

const MAX_PICKS = 3;
const MAX_STAKE_PER_PROJECT = 250_000_000n;

// ── Payout estimation ────────────────────────────────────────────────────────

interface LegEstimate {
  amountLamports: bigint;
  estimated: bigint;
  tierLabel: string;
}

interface ParlayEstimate {
  legs: LegEstimate[];
  combinedEstimated: bigint;
  scenarioLabel: string;
}

function estimateParlayPayout(
  picks: ProjectInfo[],
  totalLamports: bigint,
  stakesByProject: Record<string, UserStakeInfo | null>,
  hackathon: HackathonInfo,
): ParlayEstimate {
  const n = picks.length;
  if (n === 0 || totalLamports <= 0n) {
    return { legs: [], combinedEstimated: 0n, scenarioLabel: "" };
  }

  const {
    tierPcts, tierExpectedCounts, totalPool,
    startTimestamp, cutoffTimestamp, protocolFeeBps,
  } = hackathon;
  const nowSecs = Math.floor(Date.now() / 1000);
  const feeBps = protocolFeeBps ?? 150;
  const nextPool = totalPool + totalLamports;

  // If tier 1 has ≥2 expected winners, the top picks share tier 1 allocation.
  // All remaining picks fall to tier 2.
  const tier1Count = Math.max(1, tierExpectedCounts[0] ?? 1);
  const tier1Multi = tier1Count >= 2 && n === MAX_PICKS;

  function getEffectiveTierPct(i: number): { pct: number; label: string } {
    if (tier1Multi) {
      if (i < tier1Count) {
        return { pct: tierPcts[0] / tier1Count, label: `Tier 1 (1 of ${tier1Count})` };
      }
      return { pct: tierPcts[1] ?? 0, label: "Tier 2" };
    }
    const idx = Math.min(i, tierPcts.length - 1);
    return { pct: tierPcts[idx] ?? 0, label: `Tier ${idx + 1}` };
  }

  const scenarioLabel = tier1Multi
    ? `Picks 1–${tier1Count} each take a Tier-1 slot · Pick ${n} takes Tier 2`
    : n === 1 ? "Your pick finishes 1st"
    : n === 2 ? "Your picks finish 1st and 2nd"
    : "Your picks finish 1st, 2nd, and 3rd";

  const amounts = splitSlipAmounts(totalLamports, Array(n).fill(1));

  const legs: LegEstimate[] = picks.map((project, i) => {
    const key = project.pubkey.toBase58();
    const existing = stakesByProject[key];
    const amountLamports = amounts[i] ?? 0n;
    const newShares = computeShares(amountLamports, nowSecs, startTimestamp, cutoffTimestamp);
    const totalUserShares = (existing?.shares ?? 0n) + newShares;
    const totalProjectShares = project.totalShares + newShares;
    const { pct, label } = getEffectiveTierPct(i);
    const projectsInTier = tierExpectedCounts[i] ?? 1;
    const estimated = estimatePayout(totalUserShares, totalProjectShares, nextPool, pct, projectsInTier, feeBps);
    return { amountLamports, estimated, tierLabel: label };
  });

  return {
    legs,
    combinedEstimated: legs.reduce((s, l) => s + l.estimated, 0n),
    scenarioLabel,
  };
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  hackathon: HackathonInfo;
  projects: ProjectInfo[];
  projectNames: Record<string, string>;
  stakesByProject: Record<string, UserStakeInfo | null>;
  isWhitelisted: boolean | null;
  onClose: () => void;
  onSuccess: () => void;
}

export default function ParlayModal({
  hackathon, projects, projectNames, stakesByProject, isWhitelisted, onClose, onSuccess,
}: Props) {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const anchorWallet = useAnchorWallet();

  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [amountInput, setAmountInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [txError, setTxError] = useState<string | null>(null);

  const walletBalance = useTokenBalance(publicKey, hackathon.usdcMint);

  const totalLamports = useMemo(() => {
    const v = parseTokens(amountInput);
    return v > 0n ? v : 0n;
  }, [amountInput]);

  const selectedProjects = useMemo(
    () => selectedKeys.flatMap((k) => {
      const p = projects.find((proj) => proj.pubkey.toBase58() === k);
      return p ? [p] : [];
    }),
    [selectedKeys, projects],
  );

  const { legs, combinedEstimated, scenarioLabel } = useMemo(
    () => estimateParlayPayout(selectedProjects, totalLamports, stakesByProject, hackathon),
    [selectedProjects, totalLamports, stakesByProject, hackathon],
  );

  const amounts = useMemo(
    () => splitSlipAmounts(totalLamports, Array(selectedKeys.length).fill(1)),
    [totalLamports, selectedKeys.length],
  );

  function togglePick(key: string) {
    setSelectedKeys((cur) => {
      if (cur.includes(key)) return cur.filter((k) => k !== key);
      if (cur.length >= MAX_PICKS) return cur;
      return [...cur, key];
    });
  }

  const validationError = useMemo(() => {
    if (!publicKey) return "Connect your wallet to place a parlay.";
    if (isWhitelisted === false) return "Your wallet is not whitelisted for this hackathon.";
    if (selectedKeys.length === 0) return "Select at least one project.";
    if (totalLamports <= 0n) return "Enter a total USDC amount.";
    if (walletBalance !== null && totalLamports > walletBalance) return "Insufficient wallet balance.";
    if (hackathon.depositAmount > 0n && selectedProjects.some((p) => p.depositAmountPaid === 0n)) {
      return "Every selected project must have its builder deposit paid before staking is allowed.";
    }
    for (let i = 0; i < selectedProjects.length; i++) {
      const existing = stakesByProject[selectedProjects[i].pubkey.toBase58()];
      if ((existing?.amount ?? 0n) + (amounts[i] ?? 0n) > MAX_STAKE_PER_PROJECT) {
        return "A pick would exceed the 250 USDC per-project cap.";
      }
    }
    return null;
  }, [publicKey, isWhitelisted, selectedKeys.length, selectedProjects, totalLamports, walletBalance, stakesByProject, amounts]);

  async function handleSubmit() {
    if (!publicKey || !anchorWallet || validationError) return;
    setBusy(true);
    setTxError(null);
    try {
      const program = getProgram(anchorWallet);

      const ixs = await Promise.all(
        selectedProjects.map((project, i) => {
          const { userAta, escrow, userStake, whitelistEntry } = buildStakeAccounts({
            hackathon: hackathon.pubkey,
            project: project.pubkey,
            user: publicKey,
            usdcMint: hackathon.usdcMint,
            feeRecipient: hackathon.feeRecipient,
            openStaking: hackathon.openStaking,
          });
          const builder = (program.methods as any)
            .stake(new BN((amounts[i] ?? 0n).toString()))
            .accounts({
              user: publicKey,
              hackathon: hackathon.pubkey,
              project: project.pubkey,
              userStake,
              userTokenAccount: userAta,
              escrow,
              tokenProgram: TOKEN_PROGRAM_ID,
              systemProgram: SystemProgram.programId,
            });
          if (whitelistEntry) {
            builder.remainingAccounts([{ pubkey: whitelistEntry, isWritable: false, isSigner: false }]);
          }
          return builder.instruction();
        }),
      );

      const tx = new Transaction().add(...ixs);
      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");
      onSuccess();
      onClose();
    } catch (e: any) {
      setTxError(e.message ?? "Transaction failed");
    } finally {
      setBusy(false);
    }
  }

  const sortedProjects = useMemo(
    () => [...projects].sort((a, b) => Number(b.totalStaked - a.totalStaked)),
    [projects],
  );

  const hasParlayReady = selectedKeys.length > 0 && totalLamports > 0n;

  return (
    <div
      className="ui-modal-overlay"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div style={{ width: "100%", maxWidth: "480px", maxHeight: "90vh", display: "flex", flexDirection: "column", borderRadius: "16px", border: "1px solid var(--card-border)", background: "var(--modal-bg)", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>

        {/* Header */}
        <div style={{ padding: "20px 20px 16px", borderBottom: "1px solid var(--c-divider)", display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexShrink: 0 }}>
          <div>
            <p style={{ margin: "0 0 2px", fontSize: "0.7rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--c-indigo-text)" }}>
              Parlay Bet
            </p>
            <h2 style={{ margin: 0, fontSize: "1.125rem", fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.025em", color: "var(--c-text)" }}>
              Pick {MAX_PICKS} · One Transaction
            </h2>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--c-text-4)", fontSize: "1rem", padding: "4px" }}>
            ✕
          </button>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>

          {/* Selected picks */}
          <div style={{ marginBottom: "16px" }}>
            <p style={{ margin: "0 0 8px", fontSize: "0.75rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--c-text-4)" }}>
              Your picks ({selectedKeys.length} / {MAX_PICKS})
            </p>
            {selectedKeys.length === 0 ? (
              <div style={{ borderRadius: "10px", border: "1px dashed var(--c-divider)", padding: "12px 14px", fontSize: "0.875rem", color: "var(--c-text-4)", textAlign: "center" }}>
                Tap a project below to add it
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {selectedKeys.map((key, i) => {
                  const name = projectNames[key] || key.slice(0, 8);
                  const tierLabel = legs[i]?.tierLabel;
                  return (
                    <div key={key} style={{ display: "flex", alignItems: "center", gap: "10px", borderRadius: "10px", border: "1px solid var(--c-indigo-border)", background: "var(--c-indigo-light)", padding: "10px 12px" }}>
                      <span style={{ display: "flex", height: "24px", width: "24px", flexShrink: 0, alignItems: "center", justifyContent: "center", borderRadius: "6px", background: "var(--c-indigo)", color: "#0A0A0A", fontSize: "0.7rem", fontWeight: 900 }}>
                        {i + 1}
                      </span>
                      <span style={{ flex: 1, fontSize: "0.875rem", fontWeight: 600, color: "var(--c-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {name}
                      </span>
                      {tierLabel && (
                        <span style={{ fontSize: "0.7rem", fontWeight: 600, color: "var(--c-indigo-text)", flexShrink: 0 }}>
                          {tierLabel}
                        </span>
                      )}
                      <button
                        onClick={() => togglePick(key)}
                        aria-label="Remove"
                        style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--c-text-4)", fontSize: "0.875rem", padding: "2px 4px", flexShrink: 0, lineHeight: 1 }}
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Project picker */}
          <div style={{ marginBottom: "16px" }}>
            <p style={{ margin: "0 0 8px", fontSize: "0.75rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--c-text-4)" }}>
              Projects
            </p>
            <div style={{ maxHeight: "220px", overflowY: "auto", borderRadius: "10px", border: "1px solid var(--c-divider)" }}>
              {sortedProjects.map((project, rowIndex) => {
                const key = project.pubkey.toBase58();
                const name = projectNames[key] || repoName(project.githubUrl);
                const isSelected = selectedKeys.includes(key);
                const pickIndex = selectedKeys.indexOf(key);
                const isFull = !isSelected && selectedKeys.length >= MAX_PICKS;

                return (
                  <div
                    key={key}
                    onClick={() => !isFull && togglePick(key)}
                    style={{
                      display: "flex", alignItems: "center", gap: "10px",
                      padding: "10px 12px",
                      borderBottom: rowIndex < sortedProjects.length - 1 ? "1px solid var(--c-divider-2)" : "none",
                      cursor: isFull ? "not-allowed" : "pointer",
                      background: isSelected ? "var(--c-indigo-light)" : "transparent",
                      opacity: isFull ? 0.45 : 1,
                      transition: "background 0.1s",
                      userSelect: "none" as const,
                    }}
                  >
                    <div style={{
                      display: "flex", height: "22px", width: "22px", flexShrink: 0,
                      alignItems: "center", justifyContent: "center", borderRadius: "6px",
                      border: isSelected ? "none" : "1px solid var(--c-divider)",
                      background: isSelected ? "var(--c-indigo)" : "transparent",
                      color: isSelected ? "#0A0A0A" : "var(--c-text-4)",
                      fontSize: "0.65rem", fontWeight: 900,
                    }}>
                      {isSelected ? pickIndex + 1 : "+"}
                    </div>
                    <span style={{ flex: 1, fontSize: "0.875rem", fontWeight: 600, color: "var(--c-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {name}
                    </span>
                    <span style={{ fontSize: "0.72rem", color: "var(--c-text-4)", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
                      {formatTokens(project.totalStaked)} USDC
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Amount */}
          <div style={{ marginBottom: "16px" }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: "6px" }}>
              <label style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--c-text-2)" }}>
                Total stake (USDC)
              </label>
              {walletBalance !== null && (
                <span style={{ fontSize: "0.75rem", color: "var(--c-text-4)" }}>
                  Available: <span style={{ fontWeight: 600, color: "var(--c-text-3)" }}>{formatTokens(walletBalance)}</span>
                </span>
              )}
            </div>
            {selectedKeys.length > 1 && totalLamports > 0n && (
              <p style={{ margin: "0 0 6px", fontSize: "0.72rem", color: "var(--c-text-4)" }}>
                Split equally — ~{formatTokens(totalLamports / BigInt(selectedKeys.length))} USDC per pick
              </p>
            )}
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.000001"
              placeholder="0.00"
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              className="ui-input"
            />
          </div>

          {/* Payout estimate */}
          {hasParlayReady && (
            <div style={{ marginBottom: "16px", borderRadius: "12px", border: "1px solid var(--c-indigo-border)", background: "var(--c-indigo-light)", padding: "14px" }}>
              <p style={{ margin: "0 0 2px", fontSize: "0.7rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--c-text-4)" }}>
                Estimated payout
              </p>
              <p style={{ margin: "0 0 10px", fontSize: "0.75rem", color: "var(--c-text-3)" }}>
                {scenarioLabel}
              </p>
              {legs.length > 0 && (
                <div style={{ marginBottom: "10px", display: "flex", flexDirection: "column", gap: "5px" }}>
                  {legs.map((leg, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "0.8rem" }}>
                      <span style={{ color: "var(--c-text-3)" }}>Pick {i + 1} · {leg.tierLabel}</span>
                      <span style={{ fontWeight: 700, color: "var(--c-text)" }}>
                        ~{formatTokens(leg.estimated)} USDC
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ borderTop: "1px solid var(--c-indigo-border)", paddingTop: "10px" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
                  <span style={{ fontSize: "1.25rem", fontWeight: 900, color: "var(--c-text)" }}>
                    ~{formatTokens(combinedEstimated)} USDC
                  </span>
                  <span style={{ fontSize: "0.875rem", fontWeight: 600, color: combinedEstimated >= totalLamports ? "var(--c-indigo-text)" : "var(--c-text-4)" }}>
                    {formatRoi(combinedEstimated, totalLamports)}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* 3% penalty warning */}
          <div style={{ marginBottom: "14px", borderRadius: "10px", border: "1px solid var(--c-amber-border)", background: "var(--c-amber-light)", padding: "10px 14px", fontSize: "0.8rem", color: "var(--c-amber-text)" }}>
            <span style={{ fontWeight: 700 }}>3% unstake fee</span> — a 3% penalty is imposed should you wish to unstake.
          </div>

          {txError && (
            <div style={{ marginBottom: "12px", borderRadius: "8px", border: "1px solid var(--c-red-border)", background: "var(--c-red-light)", padding: "12px", fontSize: "0.875rem", color: "var(--c-red-text)" }}>
              {txError}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: "14px 20px 18px", borderTop: "1px solid var(--c-divider)", flexShrink: 0, background: "var(--modal-bg)" }}>
          {validationError && (selectedKeys.length > 0 || totalLamports > 0n) && (
            <p style={{ margin: "0 0 10px", fontSize: "0.8rem", color: "var(--c-red-text)" }}>
              {validationError}
            </p>
          )}
          <button
            onClick={handleSubmit}
            disabled={busy || !!validationError}
            className="ui-btn ui-btn-indigo"
            style={{ width: "100%", fontWeight: 900 }}
          >
            {busy
              ? "Placing parlay…"
              : selectedKeys.length > 0
              ? `Place ${selectedKeys.length}-pick parlay`
              : "Select projects to continue"}
          </button>
          <p style={{ margin: "10px 0 0", fontSize: "0.68rem", color: "var(--c-text-4)", lineHeight: 1.5 }}>
            These payout numbers are estimated at the time of entry and are subject to change over the course of the hackathon.
          </p>
        </div>

      </div>
    </div>
  );
}
