[![token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/competitions/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/dimasamirul1899-afk/token-radar-01/rank.svg)](https://make.fun/competitions/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/dimasamirul1899-afk/token-radar-01/reward.svg)](https://make.fun/competitions/token-radar-01)

# token-radar-01 — Token Radar (radar-2)

A radar for pre-token protocols: which ones are worth farming before they
launch a token. Entry for the
[token-radar-01 competition on make.fun](https://make.fun/competitions/token-radar-01).

**Value model** (derived from the snapshot's own figures, never hardcoded
names): `implied = TVL × 0.25 × growth × maturity × breadth`

- growth: 7-day TVL change, clamped −60/+120%, weight 0.6
- maturity: 0.6 + 0.4 × min(age, 1095 days)/1095
- breadth: 1 + 0.04 × min(chains − 1, 5)

**Board**: 226 rows — all 40 watchlist protocols plus every rankable
pre-token protocol below the floor. Live-token tab (top 24 by market cap)
kept separate. Each row carries a concrete 7-step farm plan with gas
costs by main chain, capital tiers from TVL, and hold days from age.

**Dashboard** (`dashboard/`): dark navy + amber, sortable columns, search,
category and chain filters, watchlist-only toggle, pre-token/live tabs, and
a detail dialog showing all four multipliers with an in-page recompute
check against `board.json`.

```sh
node main.ts   # reads /input/snapshot.json, writes /output/board.json + data.js + dossier
```

## License

MIT — see [LICENSE](LICENSE).
