import { useEffect, useMemo, useState } from 'react'
import api from '../api'

/**
 * Build an accumulator to a target price.
 *
 * "Smart Pick 10" used to mean "the ten highest-certainty picks, whatever that multiplies to" —
 * which is not how anyone actually thinks about an accumulator. You decide the payout you want
 * and then look for the safest way to get there. This asks for the target and the leg range,
 * and the server searches for the combination with the best chance of landing at that price
 * (services/slipOptimiser.js).
 *
 * The odds slider is non-linear because the interesting range is not: the difference between 3x
 * and 5x matters far more than between 150x and 160x, so the scale is logarithmic and each step
 * is a roughly constant *proportion* of the current value.
 */

const MIN_ODDS = 1.5
// 10000, raised from 2000 on request 2026-09-14. The DP behind this represents odds as log
// buckets and tops out around 3.6e5x (MAX_BUCKETS 3200 x STEP 0.004), so this is still a slider
// limit rather than an engine one. Whether a card can REACH 10000x is a separate question — it
// usually cannot, and the build says so with the ceiling it actually found.
//
// Be clear about what this end of the slider buys: the 2000x tickets measured 0 wins from 113
// while claiming 0.1%, and 10000x is a longer price on the same card, so it is longer odds on a
// strictly worse-than-claimed base. It is a lottery setting, not a calibration one.
const MAX_ODDS = 10000
const STEPS = 200

// slider position (0..STEPS) ⟷ odds, on a log scale
const posToOdds = pos => {
  const raw = MIN_ODDS * Math.pow(MAX_ODDS / MIN_ODDS, pos / STEPS)
  // Snap to the granularity a person would actually name: 0.1 up to 10x, 1 up to 100x, 5 above.
  if (raw < 10) return Math.round(raw * 10) / 10
  if (raw < 100) return Math.round(raw)
  return Math.round(raw / 5) * 5
}
const oddsToPos = odds =>
  Math.round(Math.log(Math.min(MAX_ODDS, Math.max(MIN_ODDS, odds)) / MIN_ODDS) / Math.log(MAX_ODDS / MIN_ODDS) * STEPS)

const pct = v => (v == null ? '—' : `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`)

/** The slim candidate shape /target-slip expects — a full pick row is far too large to post. */
const slimLeg = o =>
  o && o.market && o.selection
    ? { market: o.market, selection: o.selection, odds: o.odds, modelProbRaw: o.modelProbRaw }
    : null

function slimPicks(picks, cap) {
  return picks.slice(0, cap).map(p => ({
    fixtureId: p.fixtureId,
    match: p.match,
    league: p.league,
    fixtureDate: p.fixtureDate,
    market: p.market,
    selection: p.selection,
    odds: p.odds,
    modelProbRaw: p.modelProbRaw,
    goalsOption: slimLeg(p.goalsOption),
    options: (p.options || []).map(slimLeg).filter(Boolean),
    // The model's Over 1.5 probability, which every pick carries regardless of what won its main
    // slot. Sent bare — there is no stored Over 1.5 price, and the server has SportyBet quote it.
    // Over 1.5 was previously only a candidate leg when it happened to be the fixture's
    // goalsOption, so on much of the card the most reliable market was not on offer at all.
    over15: p.over15,
    // The 1X2 read, so the server can tell a favourite from an underdog. Per-team goals legs are
    // refused on the wrong side (services/marketFamilies.js wrongSideTeamGoals): measured over
    // ~24,000 settled legs, a favourite's Under 2.5 runs 68% against a claimed 77% while the
    // underdog's runs 87%. Without this field Smart Pick cannot make that distinction and keeps
    // picking the bad half.
    blend: p.blend,
  }))
}

const CANDIDATE_CAP = 400

// Matches the optimiser's own DP ceiling (services/slipOptimiser.js MAX_DP_LEGS). The slider used
// to stop at 25, which made the UI the tightest of four different leg limits — and the only one
// visible.
//
// Raised 40 -> 50 on request 2026-09-14, together with MAX_DP_LEGS, to match SportyBet's own
// per-slip ceiling (MAX_BOOKING_LEGS). A single slip the DP builds is still always bookable —
// 50 is accepted, so the guarantee is unchanged, the slider simply stops understating it.
//
// Merging several slips into one selection can still exceed 50, but that is a property of
// merging and always was: two slips overshot at the old 40-leg cap too. It is handled where it
// happens — the Book button disables with a count of how many legs to untick.
const MAX_SLIP_LEGS = 50

// SportyBet's own ceiling on selections per booking code (services/sportybetApi.js
// MAX_BOOKING_LEGS). A single slip can never exceed it — the DP stops at 50 — but a selection
// merged from several slips easily can, and the server rejects the whole booking when it does.
const MAX_BOOKING_LEGS = 50

/**
 * A generated SportyBet code. Rendered per slip and for the merged selection, because several can
 * be live at once — one shared code meant generating a second silently replaced the first on
 * screen while both were still bookable.
 */
/** C(n, k) — how many separate lines a system ticket splits the stake across. */
const systemLines = (n, k) => { let r = 1; for (let i = 1; i <= k; i++) r = r * (n - k + i) / i; return Math.round(r) }

/** P(at least `need` of these land), legs treated as independent — same basis as "all land". */
function atLeastProb(probs, need) {
  let dp = [1]
  for (const q of probs) {
    const p = Math.min(1, Math.max(0, Number(q) || 0))
    const next = new Array(dp.length + 1).fill(0)
    for (let j = 0; j < dp.length; j++) { next[j] += dp[j] * (1 - p); next[j + 1] += dp[j] * p }
    dp = next
  }
  let acc = 0
  for (let j = need; j < dp.length; j++) acc += dp[j]
  return acc
}

/**
 * What one unit staked returns if EVERY leg lands, on a k-of-n system.
 *
 * Not totalOdds. Each of the C(n,k) lines is a different k-leg subset paying a different price,
 * the stake is split evenly across them, so the sweep pays the AVERAGE line — the elementary
 * symmetric polynomial e_k(odds) over C(n,k). On a 38-leg slip at 5,702x, a drop-3 sweep pays
 * 2,904x, and on short slips it is the number that shows what the cover actually costs.
 */
function sweepReturn(odds, k) {
  let dp = new Array(k + 1).fill(0); dp[0] = 1
  for (const x of odds) for (let j = Math.min(k, dp.length - 1); j >= 1; j--) dp[j] += dp[j - 1] * x
  return dp[k] / systemLines(odds.length, k)
}

/** The band the record says breaks tickets. */
const WEAK = 0.60
/** Past this many lines a system stops being a bet anyone places — the stake is dust per line. */
const MAX_LINES = 60

/**
 * ── Shapes ────────────────────────────────────────────────────────────────────
 * Measured over all 41 settled Smart Pick slips (2026-09-18) by cutting each one to its N
 * most confident legs and covering it drop-D. `pays` is how often the ticket returned anything;
 * `ret` is the average return per unit staked, which is the number that decides.
 *
 *    legs  cover  lines  pays   return        legs  cover  lines  pays   return
 *      3     -0      1    76%   1.19x           6     -1      6    70%   0.90x
 *      3     -1      3    88%   1.08x           6     -2     15    88%   0.90x
 *      3     -2      3    95%   1.00x           8     -2     28    85%   0.89x
 *      4     -0      1    56%   1.04x          10     -1     10    37%   0.82x
 *      4     -1      4    85%   1.01x          10     -3    120    89%   0.92x
 *      4     -3      4    98%   0.98x
 *
 * Two things fall out of that table and both are load-bearing:
 *
 *   NOTHING from five legs up returns a profit, at any cover depth. Cover moves a ticket along
 *   its row — more often, smaller — at roughly constant money. It cannot rescue the row. The row
 *   is chosen by leg count alone, so leg count is the only decision that matters.
 *
 *   Pairing a weak leg with its own Double Chance in the same slip does NOT help, and was
 *   measured before being rejected: safest 8, drop-2 went 85% plain and 82% paired, for 35 lines
 *   instead of 28. A slip counts LOSSES, and adding a leg can only add one — Union Brescia
 *   finished 2-2, the Home Win lost, and carrying 1X alongside it does not un-lose it. (56% of
 *   losing 1X2 legs did lose to a draw, so the instinct is right about the football; the fix is
 *   to SWAP the leg, not to add to it — and by the time you have cut to the safest six there is
 *   0.1 such leg left per slip, so the cut has already done it for you.)
 */
const SHAPES = [
  { key: 'safest',   label: 'Safest',   legs: 3, drop: 1, pays: 88, ret: 1.08,
    why: 'Three most confident legs, covered so one may lose. Pays 88% of the time and still returns 1.08x — the only shape in the record that is both reliable and profitable.' },
  { key: 'steady',   label: 'Steady',   legs: 4, drop: 1, pays: 85, ret: 1.01,
    why: 'Four legs, one may lose. Pays 85% at break-even money — a bigger ticket for the same reliability.' },
  { key: 'sure',     label: 'Near-sure', legs: 4, drop: 3, pays: 98, ret: 0.98,
    why: 'Four legs, any one of them is enough. Pays 98% of the time but returns slightly less than it costs — for a chain you must not break, not for making money.' },
  { key: 'reach',    label: 'Reach',    legs: 6, drop: 2, pays: 88, ret: 0.90,
    why: 'Six legs, two may lose. Same 88% as Safest but returns 0.90x — you are paying 18% for the bigger headline price.' },
  { key: 'long',     label: 'Long shot', legs: 0, drop: 0, pays: 0, ret: 0,
    why: 'No cut and no cover — whatever the target price needs. This is what booked 38-leg tickets claiming 0.00%. Kept because it is what you asked for before; it has never won.' },
]

/**
 * ── Cover ─────────────────────────────────────────────────────────────────────
 * Book the legs as a system instead of an accumulator: pay out when at least (n - drop) of
 * them land, rather than dying on the first that does not.
 *
 * Measured over the 41 settled Smart Pick slips: safest 6 legs as an accumulator paid on 27% of
 * slips at a 0.89x average; the same six covered drop-1 paid on 71% at the same 0.89x. The
 * system adds no money — the stake splits across C(n,k) lines — it trades win size for win
 * frequency. Right for a chain step or a weak leg worth carrying, worthless for a lottery ticket.
 *
 * "Worthless" is not a figure of speech, and it is why every option here now shows its own claim.
 * EU9JY9 was 38 legs at 5,702x with every leg 71%+: acca claimed 0.00%, drop-3 claimed 1.35% and
 * split the stake 8,436 ways. The control used to show only the line count, so a cover that
 * changed nothing looked like it was doing something. Cover cannot fix a long ticket. Only
 * fewer legs fix a long ticket.
 */
/**
 * ── CoverLegs ─────────────────────────────────────────────────────────────────
 * The "add it to the slip" control. A cover leg is a second selection on a match already on the
 * ticket that cannot lose if the leg there wins — a home win IS "home or draw" — so SportyBet
 * books both in one code and the price multiplies for nothing. Measured on the live card: six
 * favourites at 7.53x became 66.73x, a free x8.86.
 *
 * Two buttons because they are different questions. "Weak legs" covers the picks under 65%, which
 * is where the Double Chance is worth most (1.22-1.30 against 1.06-1.11 on a solid leg) and where
 * the goal-based companions are deliberately skipped — they all die on the same 0-0. "Everything"
 * takes every companion the slip has earned.
 */
function CoverLegs({ legs, added, busy, onAdd, onClear }) {
  if (!legs?.length) return null
  const weak = legs.filter(l => (l.prob ?? 1) < 0.65 && !l.freeLeg).length
  const gain = (added || []).reduce((a, l) => a * (l.odds || 1), 1)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', fontSize: 10.5, marginTop: 7 }}>
      <button className="btn btn-pos" style={{ padding: '3px 9px', fontSize: 10.5 }}
        disabled={!!busy || !weak} onClick={() => onAdd(true)}
        title={weak
          ? `Add the Double Chance for the ${weak} leg(s) the model rates under 65%. Same match, and it cannot lose if the leg already on the slip wins.`
          : 'No leg on this ticket is rated under 65%'}>
        {busy === 'weak' ? <span className="spin" /> : `+ Cover weak legs${weak ? ` (${weak})` : ''}`}
      </button>
      <button className="btn" style={{ padding: '3px 9px', fontSize: 10.5 }}
        disabled={!!busy} onClick={() => onAdd(false)}
        title="Add every companion this slip has earned — Double Chance, team Over 0.5, Over 0.5 and Result-or-Total, wherever SportyBet prices them.">
        {busy === 'all' ? <span className="spin" /> : '+ Cover everything'}
      </button>
      {added?.length > 0 && (
        <>
          <span style={{ color: 'var(--pos)' }}>+{added.length} free · price x{gain.toFixed(2)}</span>
          <button className="btn" style={{ padding: '2px 7px', fontSize: 10 }} onClick={onClear}>Undo</button>
        </>
      )}
    </div>
  )
}

function Cover({ legs, odds, drop, onChange }) {
  const n = legs.length
  if (n < 3) return null
  const probs = legs.map(l => l.prob ?? l.modelProb ?? null)
  const known = probs.every(p => Number.isFinite(p) && p > 0)
  const weak = legs.filter(l => (l.prob ?? 1) < WEAK).length
  const prices = legs.map(l => Number(l.odds) || 1)

  const opts = [0]
  for (let d = 1; d <= Math.min(3, n - 2); d++) {
    if (systemLines(n, d) > MAX_LINES) break
    opts.push(d)
  }
  const capped = Math.min(3, n - 2) > opts.length - 1
  const claim = d => (known ? atLeastProb(probs, n - d) : null)

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', fontSize: 10.5 }}>
      <span className="muted2">Cover</span>
      {opts.map(d => {
        const on = d === drop
        const c = claim(d)
        return (
          <button key={d} className={on ? 'btn btn-info' : 'btn'} style={{ padding: '2px 7px', fontSize: 10.5 }}
            onClick={() => onChange(d)}
            title={d === 0
              ? `Accumulator — every leg must land. Claims ${c != null ? (c * 100).toFixed(1) + '%' : '—'}.`
              : `System ${n - d}/${n} — pays when at least ${n - d} legs land. Claims ${c != null ? (c * 100).toFixed(1) + '%' : '—'}. The stake splits across ${systemLines(n, d)} lines, so if every leg lands you get ${sweepReturn(prices, n - d).toFixed(2)}x instead of ${prices.reduce((a, b) => a * b, 1).toFixed(2)}x.`}>
            {d === 0 ? 'Acca' : `\u2212${d}`}
            {c != null && <span style={{ opacity: 0.7, marginLeft: 4 }}>{(c * 100).toFixed(c >= 0.1 ? 0 : 1)}%</span>}
          </button>
        )
      })}
      {drop > 0 && (
        <span className="muted2">
          {n - drop}/{n} · {systemLines(n, drop)} lines · sweep pays {sweepReturn(prices, n - drop).toFixed(2)}x
        </span>
      )}
      {/* The honest warning. A long ticket cannot be rescued by covering it, and the claims on the
          buttons above say so — but only if you read them, so say it outright. */}
      {known && claim(opts[opts.length - 1]) < 0.15 && (
        <span style={{ color: 'var(--neg)' }}
          title="Every cover this ticket can take still leaves it a long shot. The legs are fine; there are too many of them. Lower the target price and rebuild — the same legs cut to the safest 5 or 6 claim 35-45%.">
          ⚠ {n} legs — no cover reaches 15%; cut the target, not the risk
        </span>
      )}
      {capped && (
        <span className="muted2" title={`Deeper cover on ${n} legs needs more than ${MAX_LINES} lines — the stake per line stops being a real bet.`}>
          (deeper cover &gt; {MAX_LINES} lines)
        </span>
      )}
      {weak > 0 && drop === 0 && (
        <span style={{ color: 'var(--warn)' }}
          title={`Legs claiming under ${(WEAK * 100).toFixed(0)}% are where the settled record loses tickets. Covering drop-1 keeps them without letting one of them kill the slip.`}>
          ⚠ {weak} leg{weak > 1 ? 's' : ''} under {(WEAK * 100).toFixed(0)}%
        </span>
      )}
    </div>
  )
}

function BookingCode({ book }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 9, paddingTop: 9, borderTop: '1px solid var(--bd)' }}>
      <div className="eyebrow" style={{ color: 'var(--pos)' }}>✓ Booking code — saved for settlement</div>
      <div className="code-box">{book.code}</div>
      <div className="toolbar" style={{ gap: 8 }}>
        <button className="btn btn-pos" style={{ padding: '4px 9px', fontSize: 11 }}
          onClick={() => navigator.clipboard?.writeText(book.code)}>Copy</button>
        {book.shareUrl && (
          <a className="btn btn-info" style={{ padding: '4px 9px', fontSize: 11 }}
            href={book.shareUrl} target="_blank" rel="noreferrer">Open on SportyBet ↗</a>
        )}
        <span className="muted" style={{ fontSize: 11 }}>
          {book.totalOdds}x
          {book.deadline && ` · expires ${new Date(book.deadline).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`}
        </span>
      </div>
      {book.freeLegs?.length > 0 && (
        <div style={{ fontSize: 11, color: 'var(--pos)', lineHeight: 1.55 }}>
          <b>+{book.freeLegs.length} free leg{book.freeLegs.length > 1 ? 's' : ''}</b> — a second selection on
          a match already on the slip that cannot lose if that leg wins, so the price goes up and the
          chance of landing does not move.
          <div className="muted2" style={{ marginTop: 3 }}>
            {book.freeLegs.map((f, i) => (
              <div key={i}>+{f.odds} · {f.leg} <span style={{ opacity: 0.7 }}>(free with {f.from})</span></div>
            ))}
          </div>
          <div className="muted2" style={{ marginTop: 3 }}>
            A leg the model rates under 65% takes only its Double Chance — goal-based companions all
            die on the same 0-0, which is what took two legs off BW6SR9.
          </div>
        </div>
      )}
      {book.system && (
        <div style={{ fontSize: 11, color: 'var(--info)', lineHeight: 1.5 }}>
          Booked as a <b>system {book.system.minWinners}/{book.system.legs}</b> — {book.system.lines} lines,
          pays when at least {book.system.minWinners} legs land.
          {' '}The code opens as an accumulator: on SportyBet, switch the slip to
          {' '}<b>System {book.system.minWinners}/{book.system.legs}</b> before staking.
          {' '}This app grades it as the system.
        </div>
      )}
      {book.rejected > 0 && (
        <div style={{ fontSize: 11, color: 'var(--warn)' }}>
          SportyBet dropped {book.rejected} leg — check the slip before staking.
        </div>
      )}
      <div className="muted2" style={{ fontSize: 10.5 }}>
        {book.recorded
          ? 'Recorded — graded automatically once every leg has played.'
          : 'Code created, but it could not be saved for settlement.'}
      </div>
    </div>
  )
}

export default function SmartPickModal({ open, onClose, picks, onApply, onAnalyse }) {
  const [target, setTarget]   = useState(20)
  // How the slip is sized. 'confidence' asks for a win probability and lets the leg count fall
  // out of it; 'price' is the old target-odds search.
  //
  // Confidence is the default on measurement, not taste. Over 2026-08-01..09-10 with judgement
  // on, a 60% floor landed 73.9% of 115 slips against a 67.3% claim — it BEAT its claim — with a
  // worst losing run of 3. The 20x price target landed 7 of 118 with a 31-slip losing run, and
  // the 2000x tickets that were actually being booked landed 0 of 113 while claiming 0.1%.
  const [sizeBy, setSizeBy]   = useState('confidence')
  const [floor, setFloor]     = useState(0.60)
  // Seeded from the default shape ('safest' = 3 legs), not from a 10-15 leg range. The chip row
  // says "Safest" on open, so the controls have to already BE that — and on the record a 10-leg
  // ticket returns 0.82x against a 3-leg one's 1.19x, so this is the better default regardless.
  const [minLegs, setMinLegs] = useState(3)
  const [maxLegs, setMaxLegs] = useState(3)
  const [sbOnly, setSbOnly]   = useState(true)
  const [analyse, setAnalyse] = useState(true)
  // Restrict the legs to the shared safe-market allow-list. On by default, and the reason the
  // Half Time legs that used to spoil these slips can no longer be chosen at all.
  const [safeOnly, setSafeOnly] = useState(true)
  // How many slips to build. Each uses fixtures the previous ones did not, so three slips are
  // three separate bets — booking three cuts of one pool means one result takes every ticket.
  const [slipCount, setSlipCount] = useState(1)
  // ── Default 70%, not "any" ────────────────────────────────────────────────────────────────
  //
  // This defaulted to no floor, and the cost is visible in a single slip. BW6SR9: 25 legs, 18 won,
  // FOUR lost — and all four claimed under 70%. Three of them were the model's own 22nd, 23rd and
  // 24th most confident legs out of 25. The model said they were its weakest picks and they went
  // on the slip anyway, because reaching 5,473x needed them.
  //
  // The same slip cut to its safest eight legs: every settled leg won, at 5.78x.
  //
  // 70 rather than 75 because it is the floor that removes exactly the legs that broke it without
  // starting to cut winners — the weakest leg in that all-winning eight claimed 70%.
  const [minLegProb, setMinLegProb] = useState(0.7)
  // Ceiling on how many legs of one market family a slip may carry. Not only taste: same-family
  // legs fail together, so eleven per-team Unders is one bet on "goals are scarce today" wearing
  // eleven names, and winProb — a plain product — assumes an independence it does not have.
  // No cap by default, and the change is deliberate. It was 0.35, which meant Smart Pick applied
  // a diversity rule the simulator's own baseline never applied — so the configuration being
  // booked was not the configuration being measured. Measured with it: cap 3 landed 38 slips per
  // 100, cap 6 landed 42, no cap landed 45. The cap cannot choose what it forces in, and what it
  // forces in is Double Chance and the Unders.
  const [slipShare, setSlipShare] = useState(0)
  // Per-market floors. `on` is the whitelist; a market switched off is not used at all.
  const [rules, setRules] = useState(() => ({
    'Over/Under|Over 1.5':             { on: true,  min: 0.80 },
    'Double Chance|1X (Home or Draw)': { on: true,  min: 0.85 },
    'Double Chance|X2 (Away or Draw)': { on: true,  min: 0.85 },
    'Over/Under|Over 2.5':             { on: false, min: 0.70 },
    'Over/Under|Under 3.5':            { on: false, min: 0.75 },
    'Home Goals|Under 2.5':            { on: false, min: 0.80 },
    'Away Goals|Under 2.5':            { on: false, min: 0.80 },
    '1X2|Home Win':                    { on: false, min: 0.70 },
    '1X2|Away Win':                    { on: false, min: 0.70 },
  }))
  const [useRules, setUseRules] = useState(false)

  const [building, setBuilding] = useState(false)
  const [result, setResult]     = useState(null)
  const [error, setError]       = useState(null)

  const [booking, setBooking]   = useState(false)
  // Booking codes, keyed by which slip they belong to — a slip index, or 'selection' for the
  // merged pick. One shared code meant generating a second replaced the first on screen while
  // both were live on SportyBet.
  const [books, setBooks]       = useState({})
  const [bookingKey, setBookingKey] = useState(null)
  // How many legs each ticket may lose and still pay — keyed the same way as `books` (slip index,
  // or 'selection'). Unset means "decide from the legs": see coverFor below.
  const [drops, setDrops] = useState({})
  // Which measured shape the build is aiming at. Sets the leg count and the default cover in
  // one move, because the record says those two are the whole decision.
  const [shape, setShape] = useState('safest')
  // Free legs the user has pulled in by hand, keyed like `books` (slip index, or 'selection').
  const [covers, setCovers] = useState({})
  const [covering, setCovering] = useState(null)

  /**
   * Add the cover legs this ticket has earned. `onlyWeak` asks for just the shaky picks — a leg
   * the model rates under 65% gets its Double Chance, which is a second selection on the SAME
   * match that cannot lose if the leg already there wins. It lifts the price and leaves the
   * chance of landing alone, so there is nothing to weigh up: the answer is always yes.
   */
  async function addCover(key, legs, onlyWeak) {
    if (!legs?.length) return
    setCovering(key); setError(null)
    try {
      const { data } = await api.post('/api/betbuilder/target-slip/free-legs',
        { legs, onlyWeak }, { timeout: 90 * 1000 })
      if (!data.added?.length) {
        setError(data.reason || 'SportyBet is not pricing a cover for these legs right now.')
      } else {
        setCovers(c => {
          const have = new Set((c[key] || []).map(l => `${l.fixtureId}|${l.market}|${l.selection}`))
          const fresh = data.added.filter(l => !have.has(`${l.fixtureId}|${l.market}|${l.selection}`))
          return { ...c, [key]: [...(c[key] || []), ...fresh] }
        })
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Could not price the cover legs.')
    } finally {
      setCovering(null)
    }
  }

  // ── Mode ──
  // 'human' ranks legs on the judgement layer the Slip Simulator measures rather than on the
  // model's probability alone. Kept identical in shape to the simulator's control so a setting
  // tested there is the setting booked here.
  // Human judgement with the Over 1.5 lean is the configuration the Slip Simulator measures as
  // best over August — 46 slips landed per 100 at a 3x target against the plain model's 40 —
  // so it is what this offers first. Switch back to Model probability to compare.
  const [mode, setMode] = useState('human')
  const [preferOver15, setPreferOver15] = useState(0.06)

  // ── Merged selection ──
  // Legs ticked across every slip on screen, keyed fixtureId|market|selection. It deliberately
  // SURVIVES a rebuild: that is what makes mixing possible — build with the model, tick the legs
  // you like, switch to human judgement, rebuild, tick more, and book the combination.
  const [picked, setPicked] = useState(() => new Map())

  // Escape closes, and the page behind must not scroll under the modal.
  useEffect(() => {
    if (!open) return
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [open, onClose])

  // A fresh slate invalidates a slip built from the previous one.
  useEffect(() => { setResult(null); setBooks({}); setError(null); setPicked(new Map()) }, [picks])

  const candidates = useMemo(() => slimPicks(picks || [], CANDIDATE_CAP), [picks])

  if (!open) return null

  async function build() {
    setBuilding(true); setError(null); setResult(null); setBooks({})
    try {
      const active = Object.entries(rules).filter(([, v]) => v.on)
      const marketRules = useRules && active.length
        ? { allow: active.map(([k]) => k),
            minProb: Object.fromEntries(active.map(([k, v]) => [k, v.min])) }
        : null
      const { data } = await api.post('/api/betbuilder/target-slip', {
        ...(sizeBy === 'confidence' ? { minSlipProb: floor } : { targetOdds: target }),
        minLegs, maxLegs, sportybetOnly: sbOnly, safeMarketsOnly: safeOnly,
        slips: slipCount, uniqueBy: 'team', minLegProb, marketRules, maxMarketShare: slipShare, candidates,
        mode, preferOver15: mode === 'human' ? preferOver15 : 0,
      }, { timeout: 3 * 60 * 1000 })
      if (!data.ok) {
        setError(data.reason || 'Could not build a slip from these picks.')
        // Keep the payload even on failure — it carries the candidate pool, which is the only way
        // to see whether the filters were too tight or the card genuinely could not reach it.
        setResult(data)
      } else { setResult(data) }
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Build failed.')
    } finally {
      setBuilding(false)
    }
  }

  /**
   * Book one set of legs. `key` is the slip index, or 'selection' for the merged pick, so several
   * codes can be live at once and each stays attached to the thing it was made from.
   */
  async function getCode(key, legs) {
    if (!legs?.length) return
    setBooking(true); setBookingKey(key); setError(null)
    // Anything pulled in by hand goes with it. The server runs the same pass and de-duplicates,
    // so sending them cannot double them up.
    legs = [...legs, ...(covers[key] || [])]
    const drop = coverFor(key, legs)
    try {
      const { data } = await api.post('/api/betbuilder/target-slip/book', {
        legs,
        targetOdds: sizeBy === 'confidence' ? null : target, minLegs, maxLegs,
        winProb: legs.reduce((a, l) => a * (l.prob ?? 1), 1),
        sportybetOnly: sbOnly,
        // null keeps it an accumulator; anything else books a system that survives `drop` losses.
        minWinners: drop > 0 ? legs.length - drop : null,
      }, { timeout: 2 * 60 * 1000 })
      setBooks(b => ({ ...b, [key]: data }))
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Booking failed.')
    } finally {
      setBooking(false); setBookingKey(null)
    }
  }

  const legKey = l => `${l.fixtureId}|${l.market}|${l.selection}`

  /**
   * How many losses this ticket should absorb. An explicit choice wins; otherwise the default is
   * drop-1 when the ticket carries a leg in the band that breaks tickets, and a plain accumulator
   * when it does not. Nothing is covered below 3 legs — drop-1 on a double is two singles.
   */
  function coverFor(key, legs) {
    if (drops[key] != null) return drops[key]
    if (!legs || legs.length < 3) return 0
    // The chosen shape decides, as long as the ticket is the length that shape was measured at.
    const sh = SHAPES.find(x => x.key === shape)
    if (sh?.legs && legs.length <= sh.legs + 1) return Math.min(sh.drop, legs.length - 2)
    // Otherwise fall back to protecting a weak leg, and nothing more.
    return legs.some(l => (l.prob ?? 1) < WEAK) ? 1 : 0
  }

  /**
   * Tick or untick a leg.
   *
   * One leg per FIXTURE, enforced here rather than left to the user. Ticking a second leg on a
   * match that is already in the selection replaces it — two legs on one match are correlated,
   * the combined probability below would stop meaning anything, and SportyBet would reject the
   * pair anyway. It matters most in exactly the case this feature exists for: the same fixture
   * can appear in a model-built slip and a human-built one under different markets.
   */
  function toggleLeg(l) {
    setPicked(prev => {
      const m = new Map(prev)
      const k = legKey(l)
      if (m.has(k)) { m.delete(k); return m }
      for (const [k2, v] of m) if (v.fixtureId === l.fixtureId) m.delete(k2)
      m.set(k, l)
      return m
    })
  }

  function toggleSlip(legs, allOn) {
    setPicked(prev => {
      const m = new Map(prev)
      for (const l of legs) {
        const k = legKey(l)
        if (allOn) m.delete(k)
        else {
          for (const [k2, v] of m) if (v.fixtureId === l.fixtureId) m.delete(k2)
          m.set(k, l)
        }
      }
      return m
    })
  }

  // The LEGS, not the fixture ids. Which market each fixture contributes is the whole output of
  // the optimiser — it will take a fixture's Over 1.5 or its Double Chance line over the engine's
  // own pick whenever that is the cheaper honest way to the target. Handing back ids alone threw
  // that away, and the builder then booked each fixture's engine pick at a different price to the
  // slip shown here.
  function apply(legs) {
    const use = (legs || []).filter(l => l.fixtureId)
    if (!use.length) return
    onApply?.(use)
    if (analyse) onAnalyse?.(use.map(l => l.fixtureId))
    onClose()
  }

  // Every slip the build returned. Falling back to the top-level result keeps this working
  // against an older response that had no `slips` array.
  const allSlips = result?.slips?.length ? result.slips : result?.ok ? [result] : []
  // Kept for the failure path and the header stats; the slips themselves now all render at once.
  const view = allSlips[0] || null
  const sel = [...picked.values()]
  const selOdds = sel.reduce((a, l) => a * (l.odds || 1), 1)
  const selProb = sel.reduce((a, l) => a * (l.prob ?? 1), 1)

  return (
    <div className="modal-scrim" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal modal-wide" role="dialog" aria-modal="true" aria-label="Smart Pick">

        <div className="modal-head">
          <span style={{ fontSize: 18 }}>🎯</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="modal-title">Smart Pick</div>
            <div className="muted" style={{ fontSize: 11.5 }}>
              The safest combination that reaches your target price
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="modal-body">

          {/* ── Shape ──
              The first decision, and on the record the only one that changes the outcome. Each
              button carries what it did over the 41 settled slips, so the trade is on screen
              rather than in a comment. */}
          <div style={{ marginBottom: 12 }}>
            <div className="label" style={{ marginBottom: 6 }}>Shape — how many legs, and how much cover</div>
            <div className="chip-row" style={{ flexWrap: 'wrap', gap: 6 }}>
              {SHAPES.map(sh => (
                <button key={sh.key} className={`chip${shape === sh.key ? ' on' : ''}`}
                  disabled={building} title={sh.why}
                  onClick={() => {
                    setShape(sh.key)
                    if (sh.legs) {
                      setSizeBy('confidence')
                      setMinLegs(sh.legs); setMaxLegs(sh.legs)
                      // The cover applies to whatever gets booked, so clear any per-slip override.
                      setDrops({})
                    }
                  }}>
                  {sh.label}
                  {sh.legs > 0 && (
                    <span style={{ opacity: 0.65, marginLeft: 5, fontSize: 10 }}>
                      {sh.legs}{sh.drop ? `\u2212${sh.drop}` : ''} · {sh.pays}% · {sh.ret}x
                    </span>
                  )}
                </button>
              ))}
            </div>
            {shape !== 'long' && (
              <div className="muted2" style={{ fontSize: 10.5, marginTop: 6, lineHeight: 1.5 }}>
                {SHAPES.find(x => x.key === shape)?.why}
              </div>
            )}
            {shape === 'long' && (
              <div style={{ fontSize: 10.5, marginTop: 6, lineHeight: 1.5, color: 'var(--warn)' }}>
                Nothing from five legs up returned a profit at any cover depth — 8 legs paid 0.89x,
                10 legs 0.87x, and the 38-leg tickets claimed 0.00%. Cover cannot fix this; only
                fewer legs can.
              </div>
            )}
          </div>

          {/* How to size the slip */}
          <div>
            <div className="chip-row" style={{ marginBottom: 10 }}>
              <button
                className={`chip${sizeBy === 'confidence' ? ' on' : ''}`}
                onClick={() => setSizeBy('confidence')} disabled={building}
                title="Ask for a win probability and take however many legs deliver it. Measured: a 60% floor landed 73.9% of 115 slips against a 67.3% claim, worst losing run 3.">
                By confidence
              </button>
              <button
                className={`chip${sizeBy === 'price' ? ' on' : ''}`}
                onClick={() => setSizeBy('price')} disabled={building}
                title="Reach for a price. Higher headline returns but they rest on a handful of results — the 20x target had a 31-slip losing run, and 2000x landed 0 of 113.">
                By target odds
              </button>
            </div>
          </div>

          {sizeBy === 'confidence' ? (
          <div>
            <div className="slider-head">
              <span className="label" style={{ marginBottom: 0 }}>Least confidence to accept</span>
              <span className="slider-value" style={{ color: 'var(--ok, var(--warn))' }}>{(floor * 100).toFixed(0)}%</span>
            </div>
            <input
              type="range" min={40} max={90} step={5}
              value={Math.round(floor * 100)}
              onChange={e => setFloor(Number(e.target.value) / 100)}
              disabled={building}
            />
            <div className="slider-scale"><span>40%</span><span>60%</span><span>75%</span><span>90%</span></div>
            <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
              Legs are added safest-first and stop at the last one that still clears this. The
              number of legs is whatever the card supports on the day — usually 3 or 4.
            </div>
          </div>
          ) : (
          <div>
            <div className="slider-head">
              <span className="label" style={{ marginBottom: 0 }}>Target odds</span>
              <span className="slider-value" style={{ color: 'var(--warn)' }}>{target}x</span>
            </div>
            <input
              type="range" min={0} max={STEPS} step={1}
              value={oddsToPos(target)}
              onChange={e => setTarget(posToOdds(Number(e.target.value)))}
              disabled={building}
            />
            <div className="slider-scale"><span>1.5x</span><span>25x</span><span>500x</span><span>10000x</span></div>
            <div className="chip-row" style={{ marginTop: 8 }}>
              {[5, 20, 50, 100, 500, 2000, 10000].map(v => (
                <button key={v} className={`chip${target === v ? ' on' : ''}`} onClick={() => setTarget(v)} disabled={building}>{v}x</button>
              ))}
            </div>
            {target >= 500 && (
              <div className="muted" style={{ fontSize: 11, marginTop: 6, color: 'var(--warn)' }}>
                Slips at this target claimed 0.1–0.6% and landed 0 of 113 in simulation. The price
                is reached by taking legs the model has no conviction in.
              </div>
            )}
          </div>
          )}

          {/* Legs */}
          <div>
            <div className="slider-head">
              <span className="label" style={{ marginBottom: 0 }}>Number of legs</span>
              <span className="slider-value">{minLegs}–{maxLegs}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <div className="muted" style={{ fontSize: 11, marginBottom: 2 }}>At least {minLegs}</div>
                <input
                  type="range" min={2} max={MAX_SLIP_LEGS} step={1} value={minLegs} disabled={building}
                  onChange={e => { const v = Number(e.target.value); setMinLegs(v); if (v > maxLegs) setMaxLegs(v) }}
                />
              </div>
              <div>
                <div className="muted" style={{ fontSize: 11, marginBottom: 2 }}>At most {maxLegs}</div>
                <input
                  type="range" min={2} max={MAX_SLIP_LEGS} step={1} value={maxLegs} disabled={building}
                  onChange={e => { const v = Number(e.target.value); setMaxLegs(v); if (v < minLegs) setMinLegs(v) }}
                />
              </div>
            </div>
            <div className="muted2" style={{ fontSize: 11, marginTop: 6, lineHeight: 1.5 }}>
              One leg per match, always — two legs on the same fixture are correlated, and the
              win probability below would stop being true.
            </div>
          </div>

          {/* How many slips, and the floor under every leg */}
          <div className="toolbar" style={{ gap: 14, flexWrap: 'wrap', marginBottom: 12 }}>
            <label className="muted" style={{ fontSize: 12 }}
              title="Each slip is built from the fixtures the previous ones did not use, so no club appears in two slips. Book them separately.">
              Slips
              <select className="field" value={slipCount} onChange={e => setSlipCount(Number(e.target.value))}
                disabled={building} style={{ marginLeft: 6, width: 'auto', padding: '5px 9px' }}>
                {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label className="muted" style={{ fontSize: 12 }}
              title="Most legs one market family may take. Per-team Unders carry the most probability per unit of price, so without a cap the optimiser fills the whole slip with them — and same-market legs fail together.">
              Max/market
              <select className="field" value={slipShare} onChange={e => setSlipShare(Number(e.target.value))}
                disabled={building} style={{ marginLeft: 6, width: 'auto', padding: '5px 9px' }}>
                {[0, 0.25, 0.35, 0.5].map(v =>
                  <option key={v} value={v}>{v ? `${(v * 100).toFixed(0)}%` : 'no cap'}</option>)}
              </select>
            </label>
            <label className="muted" style={{ fontSize: 12 }}
              title="Refuse any leg below this, whatever its market. Applied after the reliability correction, so it is the number you see on the leg.">
              Min leg
              <select className="field" value={minLegProb} onChange={e => setMinLegProb(Number(e.target.value))}
                disabled={building} style={{ marginLeft: 6, width: 'auto', padding: '5px 9px' }}>
                {[0, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9].map(v =>
                  <option key={v} value={v}>{v ? `${(v * 100).toFixed(0)}%` : 'any'}</option>)}
              </select>
            </label>
          </div>

          {useRules && (
            <div className="card card-pad" style={{ padding: '10px 12px', marginBottom: 12 }}>
              <div className="eyebrow" style={{ marginBottom: 8 }}>
                Markets Smart Pick may use, and the minimum for each
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 6 }}>
                {Object.entries(rules).map(([key, v]) => {
                  const [market, selection] = key.split('|')
                  return (
                    <label key={key} style={{
                      display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5,
                      opacity: v.on ? 1 : 0.5, cursor: 'pointer',
                    }}>
                      <input type="checkbox" checked={v.on} disabled={building}
                        onChange={e => setRules(r => ({ ...r, [key]: { ...r[key], on: e.target.checked } }))} />
                      <span style={{ flex: 1 }}>
                        <span className="muted">{market}:</span>{' '}
                        <b style={{ color: 'var(--tx-2)' }}>{selection}</b>
                      </span>
                      <select className="field" value={v.min} disabled={building || !v.on}
                        onChange={e => setRules(r => ({ ...r, [key]: { ...r[key], min: Number(e.target.value) } }))}
                        style={{ width: 'auto', padding: '3px 6px', fontSize: 11 }}>
                        {[0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95].map(m =>
                          <option key={m} value={m}>≥{(m * 100).toFixed(0)}%</option>)}
                      </select>
                    </label>
                  )
                })}
              </div>
              <div className="muted2" style={{ fontSize: 10.5, marginTop: 8, lineHeight: 1.5 }}>
                Thresholds are checked against the corrected probability shown on each leg, not the
                model's raw claim — so a leg on screen can never sit below its own rule.
              </div>
            </div>
          )}

          {/* How the legs are ranked.
              Identical in shape to the Slip Simulator's mode control, so a setting measured
              there is the setting booked here — the two drifting apart would make the simulator
              a measurement of something you never place. */}
          <div className="toolbar" style={{ gap: 14, flexWrap: 'wrap', marginBottom: 12 }}>
            <label className="muted" style={{ fontSize: 12 }}
              title="Model ranks legs on the model's corrected probability. Human judgement ranks them on the same layer the Slip Simulator grades — the model's number marked up or down by what this league, these clubs, this price source and this data quality have actually delivered.">
              Rank by
              <select className="field" value={mode} onChange={e => setMode(e.target.value)}
                disabled={building} style={{ marginLeft: 6, width: 'auto', padding: '5px 9px' }}>
                <option value="model">Model probability</option>
                <option value="human">Human judgement</option>
              </select>
            </label>
            {mode === 'human' && (
              <label className="muted" style={{ fontSize: 12 }}
                title="Push Over 1.5 up the ranking and the Unders down. It steers the search only — what each leg claims is unchanged, so the win probability stays honest. Measured over 372 simulated August slips at a 3x target: +4pp took slips from 40 landing per 100 to 45.">
                Prefer Over 1.5
                <select className="field" value={preferOver15} onChange={e => setPreferOver15(Number(e.target.value))}
                  disabled={building} style={{ marginLeft: 6, width: 'auto', padding: '5px 9px' }}>
                  {[0, 0.02, 0.04, 0.06, 0.1].map(v =>
                    <option key={v} value={v}>{v ? `+${(v * 100).toFixed(0)}pp` : 'no lean'}</option>)}
                </select>
              </label>
            )}
            {mode === 'human' && (
              <button className="btn btn-pos" style={{ padding: '4px 9px', fontSize: 11 }}
                onClick={() => { setPreferOver15(0.06); setSlipShare(0) }}
                disabled={building || (preferOver15 === 0.06 && slipShare === 0)}
                title="Over 1.5 lean +6pp and no market cap — the configuration the Slip Simulator measures as best (46 slips landed per 100 at a 3x target over August, against the plain model's 40).">
                ⚡ Use measured-best
              </button>
            )}
            {mode === 'human' && (
              <span className="muted2" style={{ fontSize: 10.5, maxWidth: 340, lineHeight: 1.45 }}>
                Build with one, tick the legs you want, switch to the other and rebuild — the
                selection is kept, so a ticket can hold legs chosen by both.
              </span>
            )}
          </div>

          {/* Options */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
            <label className={`switch${sbOnly ? ' on' : ''}`}>
              <input type="checkbox" checked={sbOnly} onChange={e => setSbOnly(e.target.checked)} disabled={building} />
              <div>
                <div className="sw-label">SportyBet matches only</div>
                <div className="sw-hint">Price every leg off the live card. Off, some prices are model estimates and the target is notional.</div>
              </div>
            </label>
            <label className={`switch${useRules ? ' on' : ''}`}>
              <input type="checkbox" checked={useRules} onChange={e => setUseRules(e.target.checked)} disabled={building} />
              <div>
                <div className="sw-label">Choose markets & thresholds</div>
                <div className="sw-hint">Pick which markets may be used and the minimum the model must give each one.</div>
              </div>
            </label>
            <label className={`switch${safeOnly ? ' on' : ''}`}>
              <input type="checkbox" checked={safeOnly} onChange={e => setSafeOnly(e.target.checked)} disabled={building} />
              <div>
                <div className="sw-label">Safe markets only</div>
                <div className="sw-hint">1X2, Double Chance and Over/Under. Excludes Half Time, BTTS and Win to Nil — the markets measured to miss most often.</div>
              </div>
            </label>
            <label className={`switch${analyse ? ' on' : ''}`}>
              <input type="checkbox" checked={analyse} onChange={e => setAnalyse(e.target.checked)} disabled={building} />
              <div>
                <div className="sw-label">Analyse with AI</div>
                <div className="sw-hint">Run Claude over the chosen legs once they are selected.</div>
              </div>
            </label>
          </div>

          {/* The search pool is whatever the builder currently lists, so the window and risk
              tiers on the page behind still apply. Said out loud, because a five-pick card
              cannot produce a fifteen-leg slip and the reason should not be a surprise. */}
          <div className="muted2" style={{ fontSize: 11.5 }}>
            {picks.length > CANDIDATE_CAP
              ? `Searching the strongest ${CANDIDATE_CAP} of ${picks.length} listed picks.`
              : `Searching the ${picks.length} pick${picks.length === 1 ? '' : 's'} currently listed — widen the window or add a risk tier for more to choose from.`}
          </div>

          {error && (
            <div style={{ background: 'var(--neg-soft)', border: '1px solid var(--neg-dim)', color: 'var(--neg)', borderRadius: 'var(--r)', padding: '11px 13px', fontSize: 12.5, lineHeight: 1.5 }}>
              {error}
            </div>
          )}

          {/* ── Result ── */}
          {/* What it had to work with, when it could not build anything. */}
          {result && !result.ok && result.pool?.length > 0 && (
            <div className="card" style={{ padding: '10px 12px', marginBottom: 12 }}>
              <div className="eyebrow" style={{ marginBottom: 6 }}>
                The {result.poolSize} fixture{result.poolSize === 1 ? '' : 's'} it had, longest price first
              </div>
              <div style={{ overflowX: 'auto', maxHeight: 300, overflowY: 'auto' }}>
                <table className="tbl" style={{ fontSize: 11, minWidth: 460 }}>
                  <thead><tr>
                    <th>Match</th><th>Best leg</th><th className="num">Odds</th><th className="num">Model</th><th className="num">Alts</th>
                  </tr></thead>
                  <tbody>
                    {result.pool.map((c, i) => (
                      <tr key={i}>
                        <td>{c.match}</td>
                        <td className="muted">{c.market}: <span style={{ color: 'var(--tx-2)' }}>{c.selection}</span></td>
                        <td className="num" style={{ color: 'var(--warn)' }}>{c.odds}</td>
                        <td className="num" style={{ color: c.prob >= 0.8 ? 'var(--pos)' : 'var(--warn)' }}>{(c.prob * 100).toFixed(0)}%</td>
                        <td className="num muted2">{c.alternatives || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="muted2" style={{ fontSize: 10.5, marginTop: 6, lineHeight: 1.5 }}>
                Multiply the longest few together to see the ceiling. These are the best leg per
                fixture — "Alts" is how many other markets that fixture also offered.
              </div>
            </div>
          )}

          {allSlips.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

              {result?.slipsNote && (
                <div style={{ fontSize: 11.5, color: 'var(--warn)', lineHeight: 1.5 }}>
                  ⚠ {result.slipsNote}
                </div>
              )}

              {result?.human && (
                <div className="muted2" style={{ fontSize: 11 }}>
                  Human judgement over {result.human.legsJudged} legs, from {result.human.fittedOnPicks.toLocaleString()} settled picks
                  {result.human.preferOver15 > 0 && ` · Over 1.5 lean +${(result.human.preferOver15 * 100).toFixed(0)}pp`}
                </div>
              )}

              {result.sportybet?.capped > 0 && (
                <div style={{
                  background: 'var(--info-soft)', border: '1px solid var(--info-dim)',
                  borderRadius: 'var(--r)', padding: '9px 12px', fontSize: 11.5,
                  color: 'var(--info)', lineHeight: 1.55,
                }}>
                  {result.sportybet.capped} candidate leg{result.sportybet.capped === 1 ? '' : 's'} claimed a probability
                  more than {(result.sportybet.maxModelEdge * 100).toFixed(0)}pp above the SportyBet price and
                  {result.sportybet.capped === 1 ? ' was' : ' were'} pulled back to it.
                </div>
              )}

              {result.sportybet && (
                <div className="muted2" style={{ fontSize: 11 }}>
                  SportyBet: {result.sportybet.legsAvailable} of {result.sportybet.legsChecked} candidate legs priced
                  {result.sportybet.fixturesUnlisted > 0 && ` · ${result.sportybet.fixturesUnlisted} fixtures not on the card`}
                  {result.sportybet.cached && ' · cached card'}
                </div>
              )}

              {/* ── Every slip, listed ──
                  These used to be tabs, which showed one slip and hid the rest — so asking for
                  three produced what looked like one. Listing them makes the whole build visible
                  and, more to the point, makes legs from different slips tickable side by side. */}
              {allSlips.map((sl, i) => {
                const legs = sl.legs || []
                const allOn = legs.length > 0 && legs.every(l => picked.has(legKey(l)))
                const someOn = legs.some(l => picked.has(legKey(l)))
                const over = sl.totalOdds / target - 1
                const bk = books[i]
                return (
                  <div key={i} className="card" style={{ padding: '10px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap', marginBottom: 8 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
                        title={allOn ? 'Remove every leg of this slip from the selection' : 'Add every leg of this slip to the selection'}>
                        <input type="checkbox" checked={allOn}
                          ref={el => { if (el) el.indeterminate = someOn && !allOn }}
                          onChange={() => toggleSlip(legs, allOn)} />
                        <b style={{ fontSize: 12.5 }}>Slip {i + 1}</b>
                      </label>
                      <span className="muted" style={{ fontSize: 11.5 }}>{legs.length} legs</span>
                      <span className="num" style={{ fontSize: 13, fontWeight: 700, color: 'var(--warn)' }}>{sl.totalOdds}x</span>
                      <span className="muted2" style={{ fontSize: 10.5 }}>
                        {over > 0.005 ? `${(over * 100).toFixed(0)}% over target` : 'on target'}
                      </span>
                      <span className="num" style={{
                        fontSize: 12, fontWeight: 700,
                        color: sl.winProb >= 0.4 ? 'var(--pos)' : sl.winProb >= 0.15 ? 'var(--warn)' : 'var(--neg)',
                      }} title="Product of every leg's probability — the chance all of them land.">
                        {pct(sl.winProb)} all land
                      </span>
                      {sl.concentration && sl.concentration.topCount >= 3 && sl.concentration.share >= 0.5 && (
                        <span style={{ fontSize: 10.5, color: 'var(--warn)' }}
                          title="Same-market legs fail together — one low-scoring round takes all of them — so the true chance is below the figure shown, which assumes independence.">
                          ⚠ {sl.concentration.topCount} × {sl.concentration.topSelection}
                        </span>
                      )}
                      <button className="btn" style={{ marginLeft: 'auto', padding: '4px 9px', fontSize: 11 }}
                        onClick={() => getCode(i, legs)} disabled={booking || !sbOnly}
                        title={sbOnly ? 'Book this slip on its own' : 'Turn on "SportyBet matches only" and rebuild — a booking code needs real SportyBet outcomes'}>
                        {booking && bookingKey === i ? <span className="spin" /> : '🎰 Code'}
                      </button>
                    </div>

                    <div style={{ marginBottom: 7 }}>
                      <Cover legs={[...legs, ...(covers[i] || [])]} odds={sl.totalOdds}
                        drop={coverFor(i, [...legs, ...(covers[i] || [])])}
                        onChange={d => setDrops(p => ({ ...p, [i]: d }))} />
                      <CoverLegs legs={legs} added={covers[i]} busy={covering === i ? 'weak' : null}
                        onAdd={w => addCover(i, legs, w)}
                        onClear={() => setCovers(c => ({ ...c, [i]: [] }))} />
                    </div>

                    <div className="leg-list">
                      {legs.map((l, j) => {
                        const on = picked.has(legKey(l))
                        return (
                          <label className="leg" key={`${l.fixtureId}-${j}`} style={{ cursor: 'pointer', opacity: on ? 1 : 0.82 }}>
                            <input type="checkbox" checked={on} onChange={() => toggleLeg(l)} />
                            <div style={{ minWidth: 0 }}>
                              <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.match}</div>
                              <div className="pick">
                                {l.market}: {l.selection}
                                {l.source === 'over15' && (
                                  <span className="tag tag-pos" style={{ marginLeft: 5 }}
                                    title="Over 1.5 — the most reliable market in the measured data.">O1.5</span>
                                )}
                                {/* Only present in human mode: the model's own number before the
                                    judgement moved it, and the terms that moved it. */}
                                {l.judgedFrom != null && Math.abs(l.judgedFrom - l.prob) >= 0.005 && (
                                  <span className="muted2" style={{ marginLeft: 6, fontSize: 10 }}
                                    title={(l.why || []).map(w => `${w.term} ${w.deltaPP >= 0 ? '+' : ''}${w.deltaPP}pp`).join(', ') || 'judged'}>
                                    model {pct(l.judgedFrom)} → {pct(l.prob)}
                                  </span>
                                )}
                              </div>
                            </div>
                            <span className="p">{pct(l.prob)}</span>
                            <span className="o">{l.odds}x</span>
                          </label>
                        )
                      })}
                    </div>

                    {covers[i]?.length > 0 && (
                      <div className="leg-list" style={{ marginTop: 6, opacity: 0.9 }}>
                        {covers[i].map((l, j) => (
                          <div className="leg" key={`cov-${j}`} style={{ borderLeft: '2px solid var(--pos)' }}>
                            <span style={{ width: 14 }} />
                            <div style={{ minWidth: 0 }}>
                              <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.match}</div>
                              <div className="pick">
                                {l.market}: {l.selection}
                                <span className="tag tag-pos" style={{ marginLeft: 5 }} title={`Cannot lose if ${l.freeFor} wins`}>free</span>
                              </div>
                            </div>
                            <span className="p">—</span>
                            <span className="o">{l.odds}x</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {bk?.code && <BookingCode book={bk} />}
                  </div>
                )
              })}

              {/* ── The merged selection ──
                  Survives a rebuild on purpose: tick what you like from a model-built card,
                  switch to human judgement, rebuild, tick more, and book the combination. */}
              <div className="card" style={{
                padding: '10px 12px', position: 'sticky', bottom: 0,
                border: `1px solid ${sel.length ? 'var(--pos-dim)' : 'var(--bd)'}`,
                background: 'var(--bg-1)',
              }}>
                {sel.length === 0 ? (
                  <div className="muted2" style={{ fontSize: 11.5, lineHeight: 1.55 }}>
                    Tick legs from any of the slips above to build one ticket out of them. The
                    selection is kept when you rebuild, so you can change the mode or the target
                    and keep adding to it — one leg per match, always.
                  </div>
                ) : (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <b style={{ fontSize: 12.5 }}>Selection</b>
                      <span className="muted" style={{ fontSize: 11.5 }}>{sel.length} legs</span>
                      <span className="num" style={{ fontSize: 15, fontWeight: 800, color: 'var(--warn)' }}>
                        {selOdds.toFixed(2)}x
                      </span>
                      <span className="num" style={{
                        fontSize: 12, fontWeight: 700,
                        color: selProb >= 0.4 ? 'var(--pos)' : selProb >= 0.15 ? 'var(--warn)' : 'var(--neg)',
                      }}>{pct(selProb)} all land</span>
                      <button className="btn" style={{ padding: '4px 9px', fontSize: 11 }}
                        onClick={() => setPicked(new Map())}>Clear</button>
                      <button className="btn btn-warn" style={{ marginLeft: 'auto', padding: '5px 10px', fontSize: 11.5 }}
                        onClick={() => getCode('selection', sel)} disabled={booking || !sbOnly || sel.length > MAX_BOOKING_LEGS}
                        title={!sbOnly ? 'Turn on "SportyBet matches only" and rebuild — a booking code needs real SportyBet outcomes'
                          : sel.length > MAX_BOOKING_LEGS ? `SportyBet accepts at most ${MAX_BOOKING_LEGS} selections — untick ${sel.length - MAX_BOOKING_LEGS}`
                          : 'One booking code for the legs you have ticked'}>
                        {booking && bookingKey === 'selection' ? <><span className="spin" /> Booking…</> : '🎰 Code for selection'}
                      </button>
                    </div>
                    <div style={{ marginTop: 7 }}>
                      <Cover legs={[...sel, ...(covers.selection || [])]} odds={selOdds}
                        drop={coverFor('selection', [...sel, ...(covers.selection || [])])}
                        onChange={d => setDrops(p => ({ ...p, selection: d }))} />
                      <CoverLegs legs={sel} added={covers.selection} busy={covering === 'selection' ? 'weak' : null}
                        onAdd={w => addCover('selection', sel, w)}
                        onClear={() => setCovers(c => ({ ...c, selection: [] }))} />
                    </div>
                    <div className="muted2" style={{ fontSize: 10.5, marginTop: 6, lineHeight: 1.5 }}>
                      Drawn from {new Set(sel.map(l => l.fixtureId)).size} matches.
                      {' '}“All land” is a plain product and assumes the legs are independent —
                      true enough across different matches and different markets, less so the more
                      of one market you take.
                    </div>
                    {books.selection?.code && <BookingCode book={books.selection} />}
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="modal-foot">
          {/* Keyed on `view`, not `result`. A failed build still sets `result` (it carries the
              candidate pool, which is the only way to see WHY nothing was buildable), so keying
              on `result` crashed the modal the moment a build came back ok:false — which is
              exactly what "choose markets & thresholds" does when the rules are tight. */}
          {!view ? (
            <button className="btn btn-primary btn-lg" onClick={build} disabled={building || picks.length < 2} style={{ flex: 1 }}>
              {building ? <><span className="spin" /> Searching combinations…</> : result ? `Try again at ${target}x` : `Build a ${target}x slip`}
            </button>
          ) : (
            <>
              <button className="btn" onClick={build} disabled={building}
                title="Rebuild with the current settings. Anything you have ticked is kept, so this is how you mix a model-built card with a human-judged one.">
                {building ? <span className="spin" /> : '↻ Rebuild'}
              </button>
              <span className="muted2" style={{ fontSize: 10.5, maxWidth: 260, lineHeight: 1.4 }}>
                {sel.length ? `${sel.length} legs ticked — kept across rebuilds` : 'Tick legs above to build one ticket from several slips'}
              </span>
              <button className="btn btn-primary" style={{ marginLeft: 'auto' }}
                onClick={() => apply(sel.length ? sel : (allSlips[0]?.legs || []))}
                disabled={!sel.length && !allSlips[0]?.legs?.length}>
                {sel.length
                  ? `Select these ${sel.length} legs${analyse ? ' & analyse' : ''}`
                  : `Select slip 1's ${allSlips[0]?.legs?.length || 0} legs${analyse ? ' & analyse' : ''}`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
