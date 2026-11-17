// Token Radar's scoring model, radar-2.
//
// One sealed snapshot goes in, one ranked board comes out. The board always
// covers the snapshot's watchlist — that list is a floor, not a ceiling — and
// then adds every rankable pre-token protocol sitting below the floor, the
// early finds the radar exists to surface. A protocol counts as pre-token
// when its record shows no token at all: no market cap, no CoinGecko id, no
// symbol. Protocols whose token already trades are kept apart and shown with
// the market's own numbers, never folded into the ranking.
//
// A row's implied value comes only from the snapshot's own figures, through
// the same function for every protocol:
//
//   size     = tvl_usd times 0.25
//   growth   = seven-day TVL change, clamped to the range -60 to +120 percent
//   growthFactor  = 1 + (growth / 100) times 0.6
//   maturity = 0.6 + 0.4 times min(age in days, 1095) / 1095 (age unknown: 365)
//   breadth  = 1 + 0.04 times min(chains - 1, 5)
//   implied  = max(1, round(size times growthFactor times maturity times breadth))
//
// The four inputs each say something different: TVL is how big the prize
// is, seven-day growth is which way it is moving, age without a token is how
// long the protocol has run before issuing one (a longer runway means the
// launch is nearer), and chain breadth is how many ecosystems would farm it
// at once. No protocol is ever treated specially by name. A protocol that
// already trades gets no implied value at all: its market cap is the fact.

/** One protocol entry from the snapshot: exactly its ten recorded fields. */
export interface ProtocolRecord {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The snapshot document as a whole. */
export interface SnapshotDoc {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: ProtocolRecord[];
  watchlist: string[];
}

/** The tunable numbers of the model, the same ones the dashboard prints. */
export interface ModelParams {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_step: number;
  breadth_cap: number;
}

export const MODEL_PARAMS: ModelParams = {
  base_multiple: 0.25,
  growth_weight: 0.6,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  breadth_step: 0.04,
  breadth_cap: 5,
};

/** The label the dashboard shows next to the model. */
export const MODEL_LABEL = 'radar-2';

/** How many live-token protocols the live view lists, largest market cap first. */
export const LIVE_LIMIT = 24;

/** One farm step before it is flattened into a single string. */
export interface FarmAction {
  text: string;
  cost: string;
  time: string;
}

/** A single row of board.json. */
export interface ScoredRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The slim row the dashboard's data.js carries; the page rebuilds the plan itself. */
export interface CompactRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
}

/** A protocol whose token already trades, shown with the market's own value. */
export interface LiveEntry {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard renders, built from one snapshot. */
export interface RadarDataset {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelParams;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  watchlist_slugs: string[];
  rows: CompactRow[];
  live: LiveEntry[];
}

/** The four factors plus the implied value one protocol scores. */
export interface ScoreBreakdown {
  implied: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  breadthMult: number;
  age: number | null;
}

/** Thrown when the snapshot is not the shape this model can score. */
export class SnapshotProblem extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotProblem';
  }
}

const MS_PER_DAY = 86_400_000;

/** `value` when it is a finite number, `fallback` otherwise. */
function numOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Whole days from `listedAt` to `asOf`, never below zero; null when a date is missing or unparseable. */
export function daysSinceListed(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const start = Date.parse(`${asOf}T00:00:00Z`);
  const listed = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(listed)) return null;
  return Math.max(0, Math.floor((start - listed) / MS_PER_DAY));
}

/** Score one protocol under `params`: the four factors and its implied value. */
export function scoreProtocol(protocol: ProtocolRecord, asOf: string, params: ModelParams): ScoreBreakdown {
  const age = daysSinceListed(asOf, protocol.listed_at);
  const rawGrowth = numOr(protocol.change_7d, 0);
  const growthPct = Math.min(params.growth_cap, Math.max(params.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * params.growth_weight;
  const ageUsed = age ?? params.unknown_age_days;
  const maturityMult = params.maturity_floor + (Math.min(Math.max(ageUsed, 0), params.maturity_days) / params.maturity_days) * params.maturity_range;
  const breadthMult = 1 + params.breadth_step * Math.min(Math.max(protocol.chains.length - 1, 0), params.breadth_cap);
  const base = protocol.tvl_usd * params.base_multiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * breadthMult));
  return { implied, growthPct, growthMult, maturityMult, breadthMult, age };
}

/** A name that ends in a version marker belongs to another protocol's pool, not its own launch. */
const VERSION_MARKER = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** True when the record shows no token at all. */
export function hasNoToken(p: ProtocolRecord): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** True when the board may rank a protocol: pre-token, not an exchange, not a versioned pool. */
export function canRank(p: ProtocolRecord): boolean {
  return hasNoToken(p) && p.category !== 'CEX' && !VERSION_MARKER.test(p.name);
}

/** Protocols keyed by slug, for watchlist lookups. */
function indexBySlug(protocols: ProtocolRecord[]): Map<string, ProtocolRecord> {
  const index = new Map<string, ProtocolRecord>();
  for (const p of protocols) index.set(p.slug, p);
  return index;
}

/** Round to four decimals, for the multipliers the board and the page both print. */
function roundTo4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/** Build the ranked board: watchlist first, then every rankable early protocol below the floor. */
export function rankBoard(snapshot: SnapshotDoc, params: ModelParams = MODEL_PARAMS): ScoredRow[] {
  const index = indexBySlug(snapshot.protocols);
  const chosen = new Map<string, ProtocolRecord>();
  // The watchlist is the floor: take every slug it names, even one the
  // snapshot no longer carries (it cannot, but the board's coverage is the
  // gate's row and is never left to chance over a missing record).
  for (const slug of snapshot.watchlist) {
    const found = index.get(slug);
    if (found !== undefined) chosen.set(slug, found);
  }
  // The early radar: every rankable pre-token protocol under the floor, most
  // TVL first. No cap — the radar exists to find these, and a cap would hide
  // the smallest ones the reader came for.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && canRank(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const breakdown = scoreProtocol(p, snapshot.as_of, params);
    return { protocol: p, ...breakdown };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.protocol.slug < b.protocol.slug ? -1 : a.protocol.slug > b.protocol.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.protocol.slug,
    name: s.protocol.name,
    category: s.protocol.category,
    chains: s.protocol.chains,
    tvl_usd: s.protocol.tvl_usd,
    change_7d: s.protocol.change_7d,
    mcap_usd: s.protocol.mcap_usd,
    listed_at: s.protocol.listed_at,
    gecko_id: s.protocol.gecko_id,
    symbol: s.protocol.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      base_multiple: params.base_multiple,
      growth_pct: s.growthPct,
      growth_multiplier: roundTo4(s.growthMult),
      maturity_multiplier: roundTo4(s.maturityMult),
      breadth_multiplier: roundTo4(s.breadthMult),
      age_days: s.age,
    },
    farm_steps: planSteps(s.protocol, s.age).map(renderStep),
  }));
}

/** Flatten one farm step into its single string: action, cost and time, inside the gate's 20..600 characters. */
export function renderStep(step: FarmAction): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol lists, or a neutral phrase when it lists none. */
function mainChain(p: ProtocolRecord): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The capital one farm position needs, tiered from the protocol's own TVL. */
function capitalTier(p: ProtocolRecord): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols need a longer qualifying window. */
function holdWindow(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** What one transaction costs on a chain: Ethereum mainnet is dear, the rest are cheap. */
function gasNote(chain: string): string {
  return chain === 'Ethereum' ? 'about $8 of gas' : 'under $1 of gas';
}

type ActionBuilder = (name: string, capital: number, chain: string) => string;

/** The category rules, first match wins: each names the one action a farmer takes. */
const ACTION_RULES: Array<{ matches: (category: string) => boolean; build: ActionBuilder }> = [
  {
    matches: (c) => c.includes('lend') || c.includes('cdp') || c.includes('collateral'),
    build: (name, capital, chain) => `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`,
  },
  {
    matches: (c) => c.includes('dex') || c.includes('yield') || c.includes('leveraged farm'),
    build: (name, capital, chain) => `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`,
  },
  {
    matches: (c) => c.includes('bridge'),
    build: (name, capital, chain) => `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`,
  },
  {
    matches: (c) => c.includes('staking') || c.includes('restak'),
    build: (name, capital, chain) => `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`,
  },
  {
    matches: (c) => c.includes('perpetual') || c.includes('derivative'),
    build: (name, capital, chain) => `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`,
  },
  {
    matches: (c) => c.includes('prediction'),
    build: (name, capital, chain) => `Fund $${capital} and place one market position on ${name}.`,
  },
  {
    matches: (c) => c.includes('curator') || c.includes('allocator'),
    build: (name, capital, chain) => `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`,
  },
  {
    matches: (c) => c.includes('stable'),
    build: (name, capital, chain) => `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`,
  },
  {
    matches: (c) => c.includes('rwa'),
    build: (name, capital, chain) => `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`,
  },
  {
    matches: (c) => c.includes('insurance'),
    build: (name, capital, chain) => `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`,
  },
];

/** The one action for a protocol's category, in words a farmer can follow. */
function actionLine(p: ProtocolRecord, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  for (const rule of ACTION_RULES) {
    if (rule.matches(c)) return rule.build(p.name, capital, chain);
  }
  return `Deposit $${capital} of USDC into ${p.name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a
 * time. The plan is derived from the protocol's own record — category,
 * chains, TVL and age — never from a hand-written list of names. Multichain
 * protocols get a second-chain step; single-chain ones get a watch step.
 */
export function planSteps(p: ProtocolRecord, age: number | null): FarmAction[] {
  const chain = mainChain(p);
  const capital = capitalTier(p);
  const hold = holdWindow(age);
  const gas = gasNote(chain);
  const steps: FarmAction[] = [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: actionLine(p, capital, chain),
      cost: `$${capital} of capital and ${gas}`,
      time: '15 minutes to set up',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
  ];
  if (p.chains.length > 1) {
    const second = p.chains[1]!;
    steps.push({
      text: `Repeat the qualifying action once on ${second}, the protocol's second chain, so both deployments count.`,
      cost: `$${Math.round(capital / 2)} of capital and ${gasNote(second)}`,
      time: '15 minutes',
    });
  } else {
    steps.push({
      text: `Watch the protocol's own announcements channel for a points program or a token date before you move more funds.`,
      cost: 'nothing to watch',
      time: '5 minutes a week',
    });
  }
  steps.push(
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  );
  return steps;
}

/** The live-token protocols, largest market cap first, for the dashboard's live view. */
export function liveEntries(snapshot: SnapshotDoc): LiveEntry[] {
  return snapshot.protocols
    .filter((p) => !hasNoToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_LIMIT)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row slimmed down for data.js; the page rebuilds the farm plan from it. */
export function compactRow(row: ScoredRow): CompactRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
  };
}

/** Score the snapshot into the board and everything the dashboard renders. */
export function runRadar(snapshot: SnapshotDoc, params: ModelParams = MODEL_PARAMS): { board: ScoredRow[]; radar: RadarDataset } {
  const board = rankBoard(snapshot, params);
  const live = liveEntries(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarDataset = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: params,
    model_version: MODEL_LABEL,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    watchlist_slugs: snapshot.watchlist.slice(),
    rows: board.map(compactRow),
    live,
  };
  return { board, radar };
}

/** Decode the snapshot from a file's text, refusing anything that is not the shape the model scores. */
export function decodeSnapshot(text: string): SnapshotDoc {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotProblem('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotProblem('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotProblem('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotProblem('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotProblem('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotProblem('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotProblem('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotProblem(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotProblem(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** The reason a board is not one the gate will take, or null when it passes: coverage, ranks, order, one shared implied value, and farm steps. */
export function findBoardProblem(board: ScoredRow[], snapshot: SnapshotDoc): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** The dashboard's whole dataset as one script: `window.RADAR`, no fetch, no network. */
export function radarScript(radar: RadarDataset): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
