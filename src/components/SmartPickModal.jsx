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
const MAX_ODDS = 500
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

export default function SmartPickModal({ open, onClose, picks, onApply, onAnalyse }) {
  const [target, setTarget]   = useState(20)
  const [minLegs, setMinLegs] = useState(10)
  const [maxLegs, setMaxLegs] = useState(15)
  const [sbOnly, setSbOnly]   = useState(true)
  const [analyse, setAnalyse] = useState(true)
  // Restrict the legs to the shared safe-market allow-list. On by default, and the reason the
  // Half Time legs that used to spoil these slips can no longer be chosen at all.
  const [safeOnly, setSafeOnly] = useState(true)

  const [building, setBuilding] = useState(false)
  const [result, setResult]     = useState(null)
  const [error, setError]       = useState(null)

  const [booking, setBooking]   = useState(false)
  const [book, setBook]         = useState(null)

  // Escape closes, and the page behind must not scroll under the modal.
  useEffect(() => {
    if (!open) return
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [open, onClose])

  // A fresh slate invalidates a slip built from the previous one.
  useEffect(() => { setResult(null); setBook(null); setError(null) }, [picks])

  const candidates = useMemo(() => slimPicks(picks || [], CANDIDATE_CAP), [picks])

  if (!open) return null

  async function build() {
    setBuilding(true); setError(null); setResult(null); setBook(null)
    try {
      const { data } = await api.post('/api/betbuilder/target-slip', {
        targetOdds: target, minLegs, maxLegs, sportybetOnly: sbOnly, safeMarketsOnly: safeOnly, candidates,
      }, { timeout: 3 * 60 * 1000 })
      if (!data.ok) { setError(data.reason || 'Could not build a slip from these picks.'); setResult(null) }
      else setResult(data)
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Build failed.')
    } finally {
      setBuilding(false)
    }
  }

  async function getCode() {
    if (!result?.legs?.length) return
    setBooking(true); setError(null)
    try {
      const { data } = await api.post('/api/betbuilder/target-slip/book', {
        legs: result.legs,
        targetOdds: target, minLegs, maxLegs, winProb: result.winProb, sportybetOnly: sbOnly,
      }, { timeout: 2 * 60 * 1000 })
      setBook(data)
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Booking failed.')
    } finally {
      setBooking(false)
    }
  }

  function apply() {
    const ids = (result?.legs || []).map(l => l.fixtureId).filter(Boolean)
    onApply?.(ids)
    if (analyse) onAnalyse?.(ids)
    onClose()
  }

  const overshoot = result ? result.totalOdds / target - 1 : 0

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
            <div className="slider-scale"><span>1.5x</span><span>10x</span><span>50x</span><span>500x</span></div>
            <div className="chip-row" style={{ marginTop: 8 }}>
              {[5, 10, 20, 50, 100].map(v => (
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

          {/* Options */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
            <label className={`switch${sbOnly ? ' on' : ''}`}>
              <input type="checkbox" checked={sbOnly} onChange={e => setSbOnly(e.target.checked)} disabled={building} />
              <div>
                <div className="sw-label">SportyBet matches only</div>
                <div className="sw-hint">Price every leg off the live card. Off, some prices are model estimates and the target is notional.</div>
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
          {result && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                <div className="stat" style={{ padding: '12px 14px' }}>
                  <div className="stat-label">Combined odds</div>
                  <div className="stat-value num" style={{ fontSize: 24, color: 'var(--warn)' }}>{result.totalOdds}x</div>
                  <div className="stat-foot">
                    {overshoot > 0.005 ? `${(overshoot * 100).toFixed(0)}% over target` : 'on target'}
                  </div>
                </div>
                <div className="stat" style={{ padding: '12px 14px' }}>
                  <div className="stat-label">Legs</div>
                  <div className="stat-value num" style={{ fontSize: 24 }}>{result.legs.length}</div>
                  <div className="stat-foot">from {result.considered} fixtures</div>
                </div>
                <div
                  className="stat"
                  style={{ padding: '12px 14px' }}
                  title="Product of every leg's model probability — the chance all of them land. It assumes the legs are independent, which is why one leg per match matters."
                >
                  <div className="stat-label">All land</div>
                  <div className="stat-value num" style={{
                    fontSize: 24,
                    color: result.winProb >= 0.4 ? 'var(--pos)' : result.winProb >= 0.15 ? 'var(--warn)' : 'var(--neg)',
                  }}>{pct(result.winProb)}</div>
                  {/* The headline is now computed on MEASURED hit rates — the correction runs
                      before the search, so these legs were chosen on it rather than merely
                      reported against it afterwards. What the model originally claimed is shown
                      underneath, because the gap is the interesting number. */}
                  {result.winProbClaimed != null ? (
                    <div
                      className="stat-foot"
                      title={`The figure above uses each market's measured hit rate against what it claimed, over this app's own graded picks — and the legs were selected on it. ${result.legsAdjusted} of ${result.legs.length} legs carried a correction. The model's own unadjusted claim was ${pct(result.winProbClaimed)}.`}
                    >
                      model claimed <span style={{ color: 'var(--warn)' }}>{pct(result.winProbClaimed)}</span> · {result.legsAdjusted} legs corrected
                    </div>
                  ) : (
                    <div className="stat-foot">
                      {result.calibrate ? 'no measured corrections yet' : 'model estimate, uncorrected'}
                    </div>
                  )}
                </div>
              </div>

              {/* Concentration.
                  "All land" is a plain product, which only means what it says if the legs are
                  independent. Twelve different markets across twelve fixtures are close enough.
                  Twelve Over 1.5 legs are not — one low-scoring round takes them all, so the real
                  chance is below the number above. Over 1.5 is now a candidate on every fixture
                  and it is both the most reliable market and priced where a target needs it, so
                  slips WILL come back heavy in it. That is the right pick; this is the caveat. */}
              {result.concentration && result.concentration.topCount >= 3 && result.concentration.share >= 0.5 && (
                <div style={{
                  background: 'var(--warn-soft)', border: '1px solid var(--warn-dim)',
                  borderRadius: 'var(--r)', padding: '9px 12px', fontSize: 11.5,
                  color: 'var(--warn)', lineHeight: 1.5,
                }}>
                  {result.concentration.topCount} of {result.legs.length} legs are <b>{result.concentration.topSelection}</b>.
                  {' '}Same-market legs fail together — a low-scoring round takes all of them — so the
                  true chance is below the {pct(result.winProb)} above, which assumes independence.
                  {' '}Lower the target or the leg count for a more mixed slip.
                </div>
              )}

              {/* Legs whose model probability sat far above the market's. Worth showing by name:
                  a 46-point gap is not value, it is the model being wrong about that fixture, and
                  the optimiser would otherwise have preferred exactly those legs. */}
              {result.sportybet?.capped > 0 && (
                <div style={{
                  background: 'var(--info-soft)', border: '1px solid var(--info-dim)',
                  borderRadius: 'var(--r)', padding: '9px 12px', fontSize: 11.5,
                  color: 'var(--info)', lineHeight: 1.55,
                }}>
                  {result.sportybet.capped} candidate leg{result.sportybet.capped === 1 ? '' : 's'} claimed a probability
                  more than {(result.sportybet.maxModelEdge * 100).toFixed(0)}pp above the SportyBet price and
                  {result.sportybet.capped === 1 ? ' was' : ' were'} pulled back to it.
                  {result.sportybet.worstDisagreements?.length > 0 && (
                    <div style={{ marginTop: 5 }}>
                      {result.sportybet.worstDisagreements.slice(0, 3).map((d, i) => (
                        <div key={i} className="muted2" style={{ fontSize: 10.5 }}>
                          {d.match} — {d.market}: {d.selection} · model {pct(d.modelProb)} vs {d.odds}x implying {pct(d.impliedProb)}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {result.sportybet && (
                <div className="muted2" style={{ fontSize: 11 }}>
                  SportyBet: {result.sportybet.legsAvailable} of {result.sportybet.legsChecked} candidate legs priced
                  {result.sportybet.fixturesUnlisted > 0 && ` · ${result.sportybet.fixturesUnlisted} fixtures not on the card`}
                  {result.sportybet.cached && ' · cached card'}
                </div>
              )}

              <div className="leg-list">
                {result.legs.map((l, i) => (
                  <div className="leg" key={`${l.fixtureId}-${i}`}>
                    <span className="n">{i + 1}</span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.match}</div>
                      <div className="pick">
                        {l.market}: {l.selection}
                        {l.source === 'over15' && (
                          <span className="tag tag-pos" style={{ marginLeft: 5 }}
                            title="Over 1.5 — the most reliable market in the backtest (80.7% actual vs 81.2% predicted on low-tier fixtures). Offered on every fixture, not only where it won the main slot.">
                            O1.5
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="p">{pct(l.prob)}</span>
                    <span className="o">{l.odds}x</span>
                  </div>
                ))}
              </div>

              {/* ── Booking code ── */}
              {book?.code && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div className="eyebrow" style={{ color: 'var(--pos)' }}>✓ SportyBet booking code — saved for settlement</div>
                  <div className="code-box">{book.code}</div>
                  <div className="toolbar">
                    <button className="btn btn-pos" onClick={() => navigator.clipboard?.writeText(book.code)}>Copy code</button>
                    {book.shareUrl && (
                      <a className="btn btn-info" href={book.shareUrl} target="_blank" rel="noreferrer">Open on SportyBet ↗</a>
                    )}
                    <span className="muted" style={{ fontSize: 11.5 }}>
                      {book.totalOdds}x
                      {book.deadline && ` · expires ${new Date(book.deadline).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`}
                    </span>
                  </div>
                  {book.rejected > 0 && (
                    <div style={{ fontSize: 11.5, color: 'var(--warn)' }}>
                      SportyBet dropped {book.rejected} leg — check the slip before staking.
                    </div>
                  )}
                  <div className="muted2" style={{ fontSize: 11 }}>
                    {book.recorded
                      ? 'Recorded — this slip will be graded automatically once every leg has played.'
                      : 'Code created, but it could not be saved for settlement.'}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="modal-foot">
          {!result ? (
            <button className="btn btn-primary btn-lg" onClick={build} disabled={building || picks.length < 2} style={{ flex: 1 }}>
              {building ? <><span className="spin" /> Searching combinations…</> : `Build a ${target}x slip`}
            </button>
          ) : (
            <>
              <button className="btn" onClick={build} disabled={building}>
                {building ? <span className="spin" /> : '↻ Rebuild'}
              </button>
              {!book?.code && (
                <button className="btn btn-warn" onClick={getCode} disabled={booking || !sbOnly}
                  title={sbOnly ? 'Create a SportyBet booking code for these legs' : 'Turn on "SportyBet matches only" and rebuild — a booking code needs real SportyBet outcomes'}>
                  {booking ? <><span className="spin" /> Booking…</> : '🎰 Get booking code'}
                </button>
              )}
              <button className="btn btn-primary" onClick={apply} style={{ marginLeft: 'auto' }}>
                Select these {result.legs.length} legs{analyse ? ' & analyse' : ''}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
