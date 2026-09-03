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
// 2000, not 500. The DP behind this represents odds as log buckets and tops out around 3.6e5x
// (MAX_BUCKETS 3200 x STEP 0.004), so the old ceiling was a slider limit rather than an engine
// one. Whether a card can REACH 2000x is a separate question — it usually cannot, and the build
// says so with the ceiling it actually found.
const MAX_ODDS = 2000
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
  }))
}

const CANDIDATE_CAP = 400

// Matches the optimiser's own DP ceiling (services/slipOptimiser.js MAX_DP_LEGS). The slider used
// to stop at 25, which made the UI the tightest of four different leg limits — and the only one
// visible. The booking guard sits above this at 50, so a slip built here is always bookable.
const MAX_SLIP_LEGS = 40

// SportyBet's own ceiling on selections per booking code (services/sportybetApi.js
// MAX_BOOKING_LEGS). A single slip can never exceed it — the DP stops at 40 — but a selection
// merged from several slips easily can, and the server rejects the whole booking when it does.
const MAX_BOOKING_LEGS = 50

/**
 * A generated SportyBet code. Rendered per slip and for the merged selection, because several can
 * be live at once — one shared code meant generating a second silently replaced the first on
 * screen while both were still bookable.
 */
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
  const [minLegs, setMinLegs] = useState(10)
  const [maxLegs, setMaxLegs] = useState(15)
  const [sbOnly, setSbOnly]   = useState(true)
  const [analyse, setAnalyse] = useState(true)
  // Restrict the legs to the shared safe-market allow-list. On by default, and the reason the
  // Half Time legs that used to spoil these slips can no longer be chosen at all.
  const [safeOnly, setSafeOnly] = useState(true)
  // How many slips to build. Each uses fixtures the previous ones did not, so three slips are
  // three separate bets — booking three cuts of one pool means one result takes every ticket.
  const [slipCount, setSlipCount] = useState(1)
  const [minLegProb, setMinLegProb] = useState(0)
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
        targetOdds: target, minLegs, maxLegs, sportybetOnly: sbOnly, safeMarketsOnly: safeOnly,
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
    try {
      const { data } = await api.post('/api/betbuilder/target-slip/book', {
        legs,
        targetOdds: target, minLegs, maxLegs,
        winProb: legs.reduce((a, l) => a * (l.prob ?? 1), 1),
        sportybetOnly: sbOnly,
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

          {/* Target odds */}
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
            <div className="slider-scale"><span>1.5x</span><span>15x</span><span>150x</span><span>2000x</span></div>
            <div className="chip-row" style={{ marginTop: 8 }}>
              {[5, 20, 50, 100, 500, 1000, 2000].map(v => (
                <button key={v} className={`chip${target === v ? ' on' : ''}`} onClick={() => setTarget(v)} disabled={building}>{v}x</button>
              ))}
            </div>
          </div>

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
