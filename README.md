# EconoScope

A geospatial intelligence platform that shows government users where observed economic activity diverges from official registration records, zone by zone, with a confidence score and a plain-language explanation for every flag.
Team Chakravyuh, IDEAS 5.0 Idea to Impact 2026, Padre Conceição College of Engineering, Goa.

> A flag is a zone-level anomaly to validate. It is never a finding about a business or a person, and scores must not be used as inspection quotas.

## Quick start

Requires **Node.js 22.5+** (it uses the built-in `node:sqlite`, so there are no native builds).

```bash
npm run setup     # install everything + build the demo database
npm run dev       # API on :4000, web app on http://localhost:5173
```

Single server on http://localhost:4000: `npm start`. Rebuild the database: `npm run seed`. Run the tests: `npm test`.

### Demo accounts

| Role | Email | Password | Can |
|---|---|---|---|
| Administrator | admin@econoscope.in | admin123 | Everything; users, settings, API keys; sign-off for sensitive zones |
| Policy analyst | analyst@econoscope.in | analyst123 | Rank zones, assign field teams, export lists, run the engine, draw control samples |
| Field validation officer | field.north@econoscope.in / field.south@econoscope.in | field123 | Own visit list and outcome form only |
| Planner / formalisation lead | planner@econoscope.in | planner123 | Read-only, plus outreach referrals |
| Auditor | auditor@econoscope.in | auditor123 | Read-only, audit log, bias review, peer-group sign-off |

A walkthrough for presenting is in [DEMO.md](DEMO.md).

## The model

A peer-normalised economic–registration residual model (`server/src/engine`):

1. **Zone and aggregate.** Everything on the same ~2.7 km zones. Small counts are suppressed; missing values stay missing and lower coverage.
2. **Peer groups.** k-means on structural traits (built density, tourism, access, distance to a centre, land use). Never registration data.
3. **Expected footprint.** Robust ridge regression of registered footprint on seasonally adjusted independent signals; statewide slopes, a partially pooled level per peer group.
4. **Residual.** Expected minus registered, standardised within the peer group, with a likely range.
5. **Spatial significance.** Local Moran's I / Getis-Ord Gi* with a permutation test: hot spot, cold spot, outlier, not significant.
6. **Change-point.** Is the gap new, widening, stable or narrowing?
7. **Confidence.** Coverage, signal agreement, model error, stability, spatial support.
8. **Priority.** Gap × confidence, ranked within district. Tiers: High, Medium, Low, Insufficient data.
9. **Learn.** Field outcomes and a random control sample measure lift and calibration, and recalibrate zones.

The in-app **Methodology** page has the formulas.

## What's in the portal

| Page | What it does |
|---|---|
| Overview | Tiers, emerging gaps, lift over random controls, statewide trend, priority queue |
| Activity map | 13 layers, month slider, **Economic Shadow Map** (activity and registered footprint side by side), table view of the same data |
| Zone priorities | Every zone ranked within its district; filters; CSV export |
| Zone evidence card | Plain-language summary, signal decomposition, peer group, likely range, coverage by source, **seasonality lens** |
| Flags | Register with emergence filter; validation list export (CSV / PDF) with reasons, suggested checks and a disclaimer |
| Field tasks | Officer visit list, checklist, outcome form (gap confirmed, legitimately busy, new development, nothing unusual, data error) |
| Analytics & model | Lift vs controls, calibration, outcomes, peer-group model, model card |
| Governance | Bias and coverage audit, pilot success metrics, random audit sample, guardrails, peer-group review, audit log |
| Data & pipeline | Catalogue with licence, version and completeness; CSV upload; engine runs with input hashes |
| Admin | Users and roles, detection settings, partner API keys |

Partner API (zone-level outputs only): `GET /api/v1/zones`, `GET /api/v1/zones/:code` with an `X-API-Key` header.

## Data

The seeded dataset is **synthetic**, generated deterministically in `server/src/sim/generator.js` to behave like the real sources. It includes scenarios the model should find (Mopa airport growth, fast-growing beach villages with lagging registrations, the mining-belt decline) and ones it should not flag (busy, well-registered tourist cores such as Calangute), plus patchy data in forest zones so "insufficient data" appears.

To use real data, upload zone aggregates as long-format CSV (`cell_code, month, metric, value`) under **Data & pipeline**, then run the engine.

## How this build differs from the PRD

- **Stack.** The PRD proposes Python, PostGIS, Airflow, FastAPI, MapLibre and Keycloak. This build implements the same pipeline and methods in Node.js, SQLite, Express, React and Leaflet so it runs from one command with no infrastructure. See the tech-stack document for the mapping.
- **Zone grid.** A fixed square grid; ward or hex grids are not configurable yet.
- **Not built.** Cross-region transfer to other states, Konkani / Marathi / Hindi labels, government SSO, and a Bayesian hierarchical model (partial pooling stands in for it).
- **Not measurable on synthetic data.** The formalisation-outcome metric needs real post-visit registrations.

## Structure

```
server/   Express API, SQLite, model engine, synthetic generator, tests
client/   React + Vite, React Router, Leaflet, Recharts
```

Environment variables: `PORT` (default 4000), `JWT_SECRET` (generated into `server/data/` if unset), `ECONOSCOPE_DATA` (database folder).
