# Demo script

About seven minutes. It follows one flagged zone end to end and shows an "insufficient data" zone.
Run `npm run seed` first so the data matches these steps.

## 1. The idea (30 seconds)

Open http://localhost:5173. Say the one line: instead of "this area contains illegal businesses", EconoScope says "this zone shows an anomaly, here is why, here is how sure we are; validate it".

## 2. See the layers diverge (1 minute)

Sign in as the **policy analyst**. Open **Activity map → Shadow map**.
The left map is inferred activity; the right is the registered footprint. Point at the north coast (Mandrem, Morjim, Arambol): bright on the left, dimmer on the right.
Then point at Calangute: bright on both. Busy is not the same as under-recorded.

## 3. Rank zones fairly (1 minute)

Open **Zone priorities**. Mandrem, Morjim and Arambol are at the top of North Goa. Calangute is not on the list, because it is only compared with zones of its own kind.
Filter **Any tier → Insufficient data**: these zones get no score at all.

## 4. Explain a flag (1.5 minutes)

Open **Mandrem**. Read the plain-language summary aloud.
Show the likely range band, the signal decomposition (every source agrees), the peer group, the hot-spot test, and coverage by source.
Scroll to the **seasonality lens**: the gap is the same in peak and off season, so it is not just seasonal trade.

## 5. An honest "we don't know" (30 seconds)

Search for **Cotigao SW**. Coverage is 59%, below the 60% minimum. No score, no confidence band, no expected figure.

## 6. Act, carefully (1.5 minutes)

Open **Flags**, pick the Arambol visibility gap. Show **What to check on a visit** and **Outreach first**.
Export the validation list as PDF: it carries the disclaimer and has no officer names.
Open a flag in a **sensitive zone** (for example Sirigao NE) and click *Assign field team*: an analyst is blocked; it needs administrator sign-off.

## 7. Close the loop (1 minute)

Sign in as the **field validation officer (North)**. Open the Arambol task, click *Record field outcome*, choose an outcome, enter a count, tick that support was offered, submit.

## 8. Is it working, and is it fair? (1 minute)

Sign in as the **auditor**. Open **Governance**.
- *Pilot success metrics*: prioritised visits confirm far more often than random controls.
- *Bias & coverage*: flag rates by zone type and data quality. Poor data gives "no score", not more flags.
- *Audit log*: every view, export and outcome, append-only.

End on the **Guardrails** tab: four layers, and the enforcement decision sits outside the system.
