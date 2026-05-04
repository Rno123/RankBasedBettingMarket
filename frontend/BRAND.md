# HackBet — Ledger Brand Tokens

This file is the source of truth for the **Ledger** visual direction (black + orange).
It maps directly onto the existing CSS variables in `frontend/app/globals.css` — Claude Code
should patch the existing tokens **in place** rather than introducing a parallel system.

The aesthetic is a confident sportsbook DNA: pure black ink, warm off-white "bone" surfaces,
a single hot orange accent. No purple/indigo, no emerald.

---

## 1. Color tokens

### Core palette

| Name           | Hex         | Use                                                |
|----------------|-------------|----------------------------------------------------|
| `ink`          | `#0A0A0A`   | Primary text, dark surfaces, headers               |
| `ink-deep`     | `#000000`   | True black for OLED / hero panels                  |
| `bone`         | `#F4F1EA`   | Page background (light mode), light text on dark   |
| `bone-dim`     | `#E9E3D4`   | Card alt background (light mode), subtle surfaces  |
| `orange`       | `#FF5B14`   | Single accent — CTAs, links, highlights, brand     |
| `orange-deep`  | `#E0440A`   | Hover state for `orange`                           |
| `orange-glow`  | `#FF7A3D`   | Soft glow / focus rings                            |

**Rules**
- `orange` is the **only** accent. Do not introduce a second hue.
- Status colors below all sit *under* the orange — they're functional, not brand.
- Never use gradients on brand surfaces. Flat fills only.

### Functional / status palette (kept from existing system, retoned)

| Name      | Light hex   | Dark hex                  | Use                  |
|-----------|-------------|---------------------------|----------------------|
| `success` | `#0E8F5C`   | `#34C77F`                 | Stake confirmed, won |
| `warning` | `#D97706`   | `#FBBF24`                 | Cutoff, pending      |
| `danger`  | `#C72A1F`   | `#F26E5F`                 | Errors, slashed      |
| `info`    | `#3A4FE3`   | `#7C8AF0`                 | Neutral notice       |

(Existing `--c-amber-*`, `--c-red-*`, `--c-emerald-*`, `--c-sky-*` tokens map to these
values respectively. Indigo (`--c-indigo-*`) should be retired as a brand color and
remapped to either `orange` (when used as accent/CTA) or `info` (when used as neutral notice).)

### Light-mode surface map

```
--page-bg:       #F4F1EA          (was: indigo→white→violet gradient)
--card-bg:       #FFFFFF
--card-bg-alt:   #E9E3D4
--card-border:   rgba(10,10,10,0.10)
--card-shadow:   0 1px 3px rgba(10,10,10,0.06)
--nav-bg:        rgba(244,241,234,0.8)
--nav-border:    rgba(10,10,10,0.10)

--c-text:        #0A0A0A
--c-text-2:      #2A2A2A
--c-text-3:      #5A5A55
--c-text-4:      #8A8A82
--c-text-5:      #BFBFB5
--c-divider:     rgba(10,10,10,0.10)
--c-divider-2:   rgba(10,10,10,0.05)
```

### Dark-mode surface map

```
--page-bg:       #0A0A0A          (was: #08080f)
--card-bg:       rgba(255,255,255,0.03)
--card-bg-alt:   rgba(255,255,255,0.05)
--card-border:   rgba(255,255,255,0.08)
--card-shadow:   none
--modal-bg:      #141414
--nav-bg:        rgba(10,10,10,0.85)
--nav-border:    rgba(255,91,20,0.15)

--c-text:        #F4F1EA
--c-text-2:      #CFCBC0
--c-text-3:      #8A8A82
--c-text-4:      #5A5A55
--c-text-5:      #3A3A37
--c-divider:     rgba(255,255,255,0.08)
--c-divider-2:   rgba(255,255,255,0.05)
```

### Accent token rename (the important one)

The existing system has both `--c-indigo-*` (primary) and `--c-emerald-*` (secondary "for-devs")
accents. Ledger collapses both to **a single orange accent**. Do this rename:

| Old token             | New value (light)        | New value (dark)              |
|-----------------------|--------------------------|-------------------------------|
| `--c-indigo`          | `#FF5B14`                | `#FF5B14`                     |
| `--c-indigo-hover`    | `#E0440A`                | `#FF7A3D`                     |
| `--c-indigo-light`    | `#FFE9DC`                | `rgba(255,91,20,0.10)`        |
| `--c-indigo-border`   | `#FFC8A8`                | `rgba(255,91,20,0.25)`        |
| `--c-indigo-text`     | `#E0440A`                | `#FF7A3D`                     |
| `--c-emerald`         | `#FF5B14`                | `#FF5B14`                     |
| `--c-emerald-hover`   | `#E0440A`                | `#FF7A3D`                     |
| `--c-emerald-light`   | `#FFE9DC`                | `rgba(255,91,20,0.10)`        |
| `--c-emerald-border`  | `#FFC8A8`                | `rgba(255,91,20,0.25)`        |
| `--c-emerald-text`    | `#E0440A`                | `#FF7A3D`                     |

> Reason: keeping the token names lets every existing component work unchanged. We only
> change *what they resolve to*. A follow-up PR can rename the tokens themselves to
> `--c-accent-*` once everything's stable.

The "For developers" emerald pill on the landing page becomes **the same orange** as the
"For stakers" pill — differentiate by **outline vs. fill** instead, e.g.:
- Stakers card: filled orange button (`background: var(--c-indigo)`)
- Devs card: outlined orange button (`border: 2px solid var(--c-indigo); background: transparent; color: var(--c-indigo-text)`)

### Rank / leaderboard colors (light)

```
--rank-1-bg:   #FF5B14;   --rank-1-text:   #0A0A0A;   /* gold → orange */
--rank-2-bg:   #E9E3D4;   --rank-2-text:   #0A0A0A;
--rank-3-bg:   rgba(255,91,20,0.15); --rank-3-text: #E0440A;
--rank-other-bg:  rgba(10,10,10,0.04);  --rank-other-text:  #0A0A0A;
--rank-none-bg:   rgba(10,10,10,0.03);  --rank-none-text:   #8A8A82;
```

---

## 2. Type

| Role     | Family                           | Weight | Usage                                  |
|----------|----------------------------------|--------|----------------------------------------|
| Display  | `Archivo Black`                  | 900    | Hero, big numbers, the wordmark        |
| UI       | `Inter` (or current system stack)| 400-700| Body, labels, buttons                  |
| Mono     | `JetBrains Mono`                 | 400-700| Stats, addresses, status pills, ticker |

Add to `app/layout.tsx` (or wherever fonts are loaded):

```tsx
import { Archivo_Black, Inter, JetBrains_Mono } from "next/font/google";

const archivoBlack = Archivo_Black({ subsets: ["latin"], weight: "400", variable: "--font-display" });
const inter        = Inter({ subsets: ["latin"], variable: "--font-ui" });
const jetbrains    = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });
```

Then in `:root`:

```
--font:         var(--font-ui), ui-sans-serif, system-ui, sans-serif;
--font-display: "Archivo Black", "Helvetica Neue", Arial Black, sans-serif;
--font-mono:    "JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace;
```

---

## 3. Visual rules

- **Wordmark.** `HACK` (ink) + `BET` (orange) + period in opposite color. Block-caps, `Archivo Black`, letter-spacing `-0.055em`.
- **Corners.** 6–14px. Big cards use 14px; pills use 9999px.
- **Borders.** 1–2px solid. Use full opacity black on bone, low-alpha white on ink.
- **Shadows.** Light mode: `4px 4px 0 0 #0A0A0A` for "stamp" feel on stickers/badges; soft `0 1px 3px rgba(10,10,10,0.06)` for cards. Dark mode: no shadow.
- **Mono in UI.** Use mono for: addresses, % returns, USDC amounts, statuses (`● LIVE`, `ROUND 04`), countdown timers.
- **Casing.** Display headings = ALL CAPS. Body = sentence case.

---

## 4. How to apply (Claude Code instructions)

1. Read `frontend/app/globals.css`.
2. **In `:root` (light)** — replace the values of `--page-bg`, `--card-bg`, `--card-bg-alt`, `--card-border`, `--card-shadow`, `--nav-bg`, `--nav-border`, all `--c-text-*`, `--c-divider*`, all `--c-indigo-*`, all `--c-emerald-*`, and all `--rank-*` tokens with the values from §1 above. Leave `--c-amber-*`, `--c-red-*`, `--c-sky-*`, and `--c-orange-*` alone (they're status colors).
3. **In `html.dark`** — same substitutions using the dark-mode values.
4. Update the wallet adapter override:
   ```css
   .wallet-adapter-button {
     background: #FF5B14 !important;
     color: #0A0A0A !important;
   }
   .wallet-adapter-button:not([disabled]):hover {
     background: #E0440A !important;
   }
   ```
   (Remove the gradient — Ledger uses flat fills only.)
5. Update the ambient-glow blobs in `frontend/app/page.tsx` (`rgba(79,70,229,...)` and `rgba(109,28,217,...)`) to `rgba(255,91,20,0.18)` and `rgba(255,91,20,0.10)` respectively, OR remove them entirely (Ledger doesn't use glows).
6. In the same file, the wordmark already uses `--c-text` + `--c-indigo-text` — that automatically becomes ink + orange after step 2, no change needed. But replace the "For developers" emerald pill+button styling with an *outlined* orange variant (see §1, accent rename).
7. Add `Archivo Black` + `JetBrains Mono` to the font loader (§2). Drop them on the wordmark and on every existing `font-family: monospace`, respectively.
8. Sanity-check: search for hardcoded `#4f46e5`, `#7c3aed`, `#059669`, `#10b981` outside `globals.css` and replace with the appropriate token.

After step 8 the entire app reflects the Ledger direction with no component-level rewrites.

---

## 5. Don'ts

- ❌ No purple, indigo, or violet anywhere.
- ❌ No emerald/teal as a brand accent (status only).
- ❌ No gradients on brand surfaces.
- ❌ No drop shadows on dark-mode cards.
- ❌ Never split brand into two accents (e.g. orange + lime). One accent.
