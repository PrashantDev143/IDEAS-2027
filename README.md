# EconoScope

A geospatial intelligence platform that detects economic activity beyond official records.
Team Chakravyuh, IDEAS 5.0 Idea to Impact 2026, Padre Conceição College of Engineering, Goa.

It compares **official records** (business registrations, ASUSE-style survey baselines) with **observed signals** (night-time lights, built-up surface, digital payment points, power connections, hospitality listings, tourist footfall) on a ~2.7 km grid over Goa. It then raises evidence-backed alerts for field validation.

> Alerts describe *economic-activity anomalies to investigate*. They are never findings of illegal activity.

## Quick start

Requires **Node.js 22.5+** (it uses the built-in `node:sqlite`, so there are no native builds).

```bash
npm run setup     # install everything + seed the demo database
npm run dev       # API on :4000, web app on http://localhost:5173
```

Production-style (single server on http://localhost:4000):

```bash
npm start         # builds the client, then serves API + app
```

`npm run seed` rebuilds the database from scratch at any time.

### Demo accounts

| Role | Email | Password |
|---|---|---|
| Administrator | admin@econoscope.in | admin123 |
| Analyst | analyst@econoscope.in | analyst123 |
| Field officer (North Goa) | field.north@econoscope.in | field123 |
| Field officer (South Goa) | field.south@econoscope.in | field123 |

## What's inside

| Area | Features |
|---|---|
| Landing page | Problem, solution, pipeline, impact, roadmap, team, live map preview |
| Overview | Statewide observed vs recorded trend, KPIs, priority queue, taluka table, activity feed |
| Activity map | 7 layers (activity index, visibility gap, YoY change, registrations, night lights, footfall, payment points), month slider back to Sep 2023, street/satellite basemap, anomaly markers, cell search |
| Alerts | Filterable register with CSV export. Each alert shows a plain-language explanation, a confidence breakdown, per-signal evidence, historical trend, minimap, field validations and an audit trail |
| Field tasks | Officer queue; validation form (outcome, counts, GPS, notes) |
| Analytics & model | Field precision, confidence calibration, ground-truth error, seasonality by zone, taluka growth, model coefficients, feedback-calibrated cells |
| Data & pipeline | Dataset catalogue, CSV upload (real data), manual engine run, "ingest next month" (simulated continuous feed), run history |
| Admin | Users and roles, detection thresholds and confidence weights, full audit log |

## Detection engine (`server/src/engine`)

1. **Nowcast**: a ridge regression maps signals to establishment counts, trained on the latest survey FY.
2. **Baseline**: a per-cell seasonal index gives seasonally adjusted activity. κ is the normal observed/recorded ratio from the baseline window, so expected = κ × registered × field calibration.
3. **Detect**: robust (median/MAD) z-scores flag visibility gaps, record mismatches, emerging hotspots and contractions. An Isolation Forest scores each cell's multivariate profile.
4. **Confidence**: combines signal agreement, magnitude, persistence and isolation score. Priority = confidence × impact.
5. **Feedback**: "explained" or "false positive" outcomes recalibrate that cell's baseline. Counts measure accuracy.

The full write-up is on the in-app **Methodology** page.

## Data

The seeded dataset is **synthetic**, generated deterministically in `server/src/sim/generator.js`. It is shaped to behave like the real sources and includes planted scenarios the engine should find:

- Mopa airport-led growth
- Morjim and Mandrem expansion with lagging registrations
- Low registration coverage in the coastal tourism belt
- Mining-belt decline with dormant registrations
- Verna industrial expansion (formal)
- A single-signal night-light spike at Kundaim

Statewide tourist footfall is calibrated to about 1 crore arrivals a year.

To use real data, upload long-format CSV (`cell_code, month, metric, value`) under **Data & pipeline**, then run the engine. The template and the grid-cell reference can be downloaded there.

## Structure

```
server/   Express API, SQLite (node:sqlite), JWT auth, engine, synthetic generator
client/   React 19 + Vite, React Router, Leaflet, Recharts
```

Environment variables: `PORT` (default 4000), `JWT_SECRET` (a random secret is generated into `server/data/` if unset), `ECONOSCOPE_DATA` (database directory).
