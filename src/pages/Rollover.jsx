import { useCallback, useEffect, useMemo, useState } from 'react'
import AppShell from '../components/AppShell'
import api from '../api'

/**
 * Rollover chains.
 *
 * A chain is N short bets one after another, each staked with the last one's return. The page
 * does three things: shows what the settled record says a chain of this shape would actually
 * have done BEFORE one is created, creates one, and tracks every step's code and outcome.
 *
 * The projection panel is the point. The natural first request — 2x a step, fifteen steps — is
 * a 32,768x ticket spread over two weeks, and the record lands 2x tickets about 31% of the time,
 * so the panel says "under 1%" before the stake goes down. A straight win at 1.25-1.55 lands
 * 77.5% (n=80 booked legs) and ten of those compound to 29x. That difference is the whole
 * feature, and the screen should make it plainly rather than leave it to arithmetic.
 */

const pct = (v, d = 0) => (v == null ? '—' : `${(v * 100).toFixed(d)}%`)
const money = v => (v == null ? '—' : Number(v).toLocaleString('en-GB', { maximumFractionDigits: 2 }))
const when = d => (d ? new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—')
const kickoff = d => {
  if (!d) return null
  const dt = new Date(d), now = new Date()
  const same = dt.toDateString() === now.toDateString()
  return same ? dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
              : dt.toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' })
}

const STATUS_PILL = {
  active: 'pill-info', completed: 'pill-pos', busted: 'pill-neg', stopped: '',
  pending: 'pill-info', won: 'pill-pos', lost: 'pill-neg', void: 'pill-warn', unbuilt: 'pill-warn', unbooked: 'pill-warn',
}

// ── Projection ───────────────────────────────────────────────────────────────

function Projection({ ins, loading }) {
  if (loading && !ins) return <div className="card card-pad muted">Reading the record…</div>
  if (!ins) return null
  const p = ins.projection, s = ins.sample
  const tone = !p ? 'var(--tx-3)' : p.pComplete < 0.01 ? 'var(--neg)' : p.evPerUnit > 1 ? 'var(--pos)' : 'var(--warn)'
  return (
    <div className="card card-pad" style={{ borderColor: tone }}>
      <div className="card-head" style={{ marginBottom: 8 }}>
        <div className="card-title">
          What the record says about {ins.shape === 'straight' ? `a straight win ${ins.oddsMin}–${ins.oddsMax}x` : `${ins.targetOdds}x`} × {ins.steps}
        </div>
        <span className="muted2" style={{ fontSize: 11 }}>
          {s.n} settled {s.kind}{ins.shape === 'straight' ? ' priced in that window' : ` within ±${Math.round(ins.tolerance * 100)}% of ${ins.targetOdds}x`}
        </span>
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.55, color: tone, fontWeight: 600, marginBottom: 12 }}>{ins.verdict}</div>
      {p && (
        <div className="stat-grid" style={{ marginBottom: 12 }}>
          <div className="stat">
            <div className="stat-label">Per step</div>
            <div className="stat-value num">{pct(p.perStep)}</div>
            <div className="stat-foot">±{pct(p.se)} · model claimed {pct(s.claimed)}{s.claimed != null && s.hit > s.claimed ? ` (+${((s.hit - s.claimed) * 100).toFixed(0)}pp)` : ''} · {s.legs} leg{s.legs === 1 ? '' : 's'}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Complete all {ins.steps}</div>
            <div className="stat-value num" style={{ color: tone }}>{pct(p.pComplete, p.pComplete < 0.01 ? 3 : 1)}</div>
            <div className="stat-foot">range {pct(p.pCompleteLow, 2)}–{pct(p.pCompleteHigh, 2)}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Typical bust</div>
            <div className="stat-value num">step {p.medianBustStep ?? '—'}</div>
            <div className="stat-foot">half of chains die by here · expected run {p.expectedRun}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Pays if complete</div>
            <div className="stat-value num">{money(p.payoutIfComplete)}x</div>
            <div className="stat-foot">fair value {p.evPerUnit} per unit{p.evPerUnit > 1 ? ' — +EV' : ''}</div>
          </div>
        </div>
      )}
      <div className="muted2" style={{ fontSize: 11, marginBottom: 6 }}>
        The whole ladder — every {ins.shape === 'straight' ? 'straight win' : 'ticket'} ever booked here, by price:
      </div>
      <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
        <thead>
          <tr className="muted" style={{ textAlign: 'right' }}>
            <th style={{ textAlign: 'left', fontWeight: 600, padding: '3px 0' }}>{ins.shape === 'straight' ? 'leg price' : 'ticket odds'}</th>
            <th style={{ fontWeight: 600 }}>n</th><th style={{ fontWeight: 600 }}>landed</th><th style={{ fontWeight: 600 }}>legs</th>
            <th style={{ fontWeight: 600 }}>5 in a row</th><th style={{ fontWeight: 600 }}>10</th><th style={{ fontWeight: 600 }}>15</th>
          </tr>
        </thead>
        <tbody>
          {ins.ladder.map(r => {
            const [ba, bb] = r.band.split('-').map(parseFloat)
            const inBand = ins.shape === 'straight' ? (ins.oddsMin < bb && ins.oddsMax > ba) : (ins.targetOdds >= ba && ins.targetOdds < bb)
            return (
              <tr key={r.band} className="num" style={{ textAlign: 'right', background: inBand ? 'var(--accent-soft)' : 'transparent' }}>
                <td style={{ textAlign: 'left', padding: '3px 4px', fontWeight: inBand ? 700 : 400 }}>{r.band}x</td>
                <td>{r.n}</td><td>{pct(r.hit)}</td><td>{r.legs ?? '—'}</td>
                <td>{r.pReach ? pct(r.pReach[5], 1) : '—'}</td>
                <td>{r.pReach ? pct(r.pReach[10], 2) : '—'}</td>
                <td>{r.pReach ? pct(r.pReach[15], 3) : '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {ins.chains.total > 0 && (
        <div className="muted" style={{ fontSize: 11.5, marginTop: 10 }}>
          Chains so far: {ins.chains.total} — {ins.chains.completed} completed, {ins.chains.busted} busted, {ins.chains.active} running.
          Step tickets settled: {ins.chains.stepTickets.won}/{ins.chains.stepTickets.n}
          {ins.chains.stepTickets.n ? ` (${pct(ins.chains.stepTickets.won / ins.chains.stepTickets.n)})` : ''}.
        </div>
      )}
    </div>
  )
}

// ── One chain ────────────────────────────────────────────────────────────────

function Step({ step, total, isCurrent }) {
  const pill = STATUS_PILL[step.status] || ''
  return (
    <div className="card" style={{ padding: '10px 12px', borderColor: isCurrent ? 'var(--accent-dim)' : undefined }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 800, fontSize: 13 }}>Step {step.n}<span className="muted2">/{total}</span></span>
        <span className={`pill ${pill}`}>{step.status}</span>
        {step.totalOdds && <span className="num" style={{ fontWeight: 800, color: 'var(--warn)' }}>{step.totalOdds}x</span>}
        {step.legCount != null && <span className="muted" style={{ fontSize: 12 }}>{step.legCount} leg{step.legCount === 1 ? '' : 's'}</span>}
        {step.winProb != null && <span className="muted" style={{ fontSize: 12 }}>claims {pct(step.winProb)}</span>}
        <span style={{ marginLeft: 'auto', fontSize: 12 }} className="num">
          stake <b>{money(step.stake)}</b>{step.potential ? <> → <b style={{ color: 'var(--pos)' }}>{money(step.potential)}</b></> : null}
        </span>
      </div>
      {step.code && (
        <div className="toolbar" style={{ marginTop: 8, gap: 6 }}>
          <code style={{ fontSize: 13, fontWeight: 800, letterSpacing: '0.04em' }}>{step.code}</code>
          <button className="btn btn-sm" onClick={() => navigator.clipboard?.writeText(step.code)}>Copy</button>
          {step.shareUrl && <a className="btn btn-sm btn-info" href={step.shareUrl} target="_blank" rel="noreferrer">SportyBet ↗</a>}
          {step.deadline && <span className="muted2" style={{ fontSize: 11 }}>code valid until {when(step.deadline)}</span>}
        </div>
      )}
      {step.legs?.length > 0 && (
        <div style={{ marginTop: 8, display: 'grid', gap: 3 }}>
          {step.legs.map((l, i) => {
            const live = step.live?.legs?.find(x => x.match === l.match && x.market === l.market && x.selection === l.selection)
            const won = live?.won
            return (
              <div key={i} style={{ display: 'flex', gap: 8, fontSize: 12, alignItems: 'baseline' }}>
                <span style={{ width: 14, color: won === true ? 'var(--pos)' : won === false ? 'var(--neg)' : 'var(--tx-4)' }}>{won === true ? '✓' : won === false ? '✗' : '·'}</span>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.match}<span className="muted2"> · {l.league}</span></span>
                <span className="muted">{l.market}: <b style={{ color: 'var(--tx-1)' }}>{l.selection}</b></span>
                <span className="num" style={{ color: 'var(--warn)' }}>@{l.odds}</span>
                <span className="muted2 num" style={{ fontSize: 11 }}>{pct(l.prob)}</span>
                {live?.sbScore && <span className="num muted2">{live.sbScore}</span>}
                <span className="muted2" style={{ fontSize: 11 }}>{kickoff(l.kickoff)}</span>
              </div>
            )
          })}
        </div>
      )}
      {step.ai && (step.ai.rejected?.length > 0 || step.ai.notes?.length > 0) && (
        <div style={{ marginTop: 8, paddingTop: 6, borderTop: '1px solid var(--line-soft)' }}>
          <div className="muted2" style={{ fontSize: 10.5, marginBottom: 3 }}>
            AI checked {step.ai.checked} leg{step.ai.checked === 1 ? '' : 's'} over {step.ai.rounds} round{step.ai.rounds === 1 ? '' : 's'}
            {step.ai.rejected?.length ? ` · refused ${step.ai.rejected.length}` : ''}
          </div>
          {(step.ai.notes || []).map((x, i) => (
            <div key={`n${i}`} className="muted2" style={{ fontSize: 11 }}>
              <span style={{ color: 'var(--pos)' }}>✓</span> {x.match} — {x.confidence} confidence, {x.agreement} agreement{x.verdict ? `, calls ${x.verdict}` : ''}
            </div>
          ))}
          {(step.ai.rejected || []).map((x, i) => (
            <div key={`r${i}`} className="muted2" style={{ fontSize: 11 }}>
              <span style={{ color: 'var(--neg)' }}>✗</span> {x.match} ({x.selection}) — {x.why}
            </div>
          ))}
        </div>
      )}
      {step.note && <div className="muted2" style={{ fontSize: 11.5, marginTop: 6 }}>{step.note}</div>}
    </div>
  )
}

function Chain({ r, onChanged }) {
  const [busy, setBusy] = useState(null)
  const won = r.steps.filter(s => s.status === 'won').length
  const cfg = r.config
  const act = async (what) => {
    setBusy(what)
    try { await api.post(`/api/rollover/${r._id}/${what}`) ; await onChanged() }
    catch (e) { alert(e.response?.data?.error || e.message) }
    finally { setBusy(null) }
  }
  const remove = async () => {
    if (!confirm('Delete this chain from the record?')) return
    setBusy('delete')
    try { await api.delete(`/api/rollover/${r._id}`); await onChanged() }
    catch (e) { alert(e.response?.data?.error || e.message) }
    finally { setBusy(null) }
  }
  const cur = [...r.steps].reverse().find(s => s.n === r.currentStep && s.status !== 'void')
  const steps = [...r.steps].sort((a, b) => a.n - b.n || (a.status === 'void' ? -1 : 1))
  return (
    <div className="card card-pad" style={{ borderColor: r.status === 'busted' ? 'var(--neg-dim)' : r.status === 'completed' ? 'var(--pos-dim)' : undefined }}>
      <div className="card-head" style={{ marginBottom: 10, gap: 8, flexWrap: 'wrap' }}>
        <div>
          <div className="card-title">
            {r.name || (cfg.shape === 'straight' ? `straight win ${cfg.oddsMin}–${cfg.oddsMax}x × ${cfg.steps}` : `${cfg.stepOdds}x × ${cfg.steps}`)}
            <span className={`pill ${STATUS_PILL[r.status] || ''}`} style={{ marginLeft: 6 }}>{r.status}</span>
          </div>
          <div className="muted2" style={{ fontSize: 11.5, marginTop: 2 }}>
            {cfg.shape === 'straight' ? `one straight win ${cfg.oddsMin}–${cfg.oddsMax}x` : cfg.sizeBy === 'confidence' ? `each step claims ≥${pct(cfg.floor)}` : `${cfg.targetOdds}x a step`}
            {' · '}{cfg.steps} steps · {cfg.windowHours}h window · {cfg.slate} card · {cfg.mode}{cfg.aiCheck ? ' · AI check' : ''}
            {cfg.leagues?.length ? ` · ${cfg.leagues.join(', ')}` : ''} · started {when(r.startedAt)}
          </div>
        </div>
        <div className="toolbar" style={{ gap: 6 }}>
          {r.status === 'active' && cur && cur.status !== 'pending' && (
            <button className="btn btn-sm btn-accent" disabled={!!busy} onClick={() => act('rebuild')}>{busy === 'rebuild' ? 'Building…' : 'Build now'}</button>
          )}
          {r.status === 'active' && <button className="btn btn-sm" disabled={!!busy} onClick={() => act('advance')}>{busy === 'advance' ? 'Checking…' : 'Check'}</button>}
          {r.status === 'active' && <button className="btn btn-sm btn-neg" disabled={!!busy} onClick={() => { if (confirm('Stop this chain?')) act('stop') }}>Stop</button>}
          {r.status !== 'active' && <button className="btn btn-sm btn-ghost" disabled={!!busy} onClick={remove}>Delete</button>}
        </div>
      </div>

      {/* Progress */}
      <div style={{ display: 'flex', gap: 3, marginBottom: 10 }}>
        {Array.from({ length: cfg.steps }, (_, i) => {
          const s = [...r.steps].reverse().find(x => x.n === i + 1 && x.status !== 'void')
          const c = !s ? 'var(--line)' : s.status === 'won' ? 'var(--pos)' : s.status === 'lost' ? 'var(--neg)' : s.status === 'pending' ? 'var(--info)' : 'var(--warn)'
          return <div key={i} title={`step ${i + 1}${s ? ` — ${s.status}` : ''}`} style={{ flex: 1, height: 6, borderRadius: 3, background: c }} />
        })}
      </div>
      <div className="stat-grid" style={{ marginBottom: 12 }}>
        <div className="stat"><div className="stat-label">Progress</div><div className="stat-value num">{won}<span className="muted2" style={{ fontSize: 14 }}>/{cfg.steps}</span></div><div className="stat-foot">steps landed</div></div>
        <div className="stat"><div className="stat-label">Bankroll</div><div className="stat-value num">{money(r.bankroll?.current)}</div><div className="stat-foot">from {money(r.bankroll?.initial)} · peak {money(r.bankroll?.peak)}</div></div>
        <div className="stat"><div className="stat-label">If it completes</div><div className="stat-value num" style={{ color: 'var(--pos)' }}>{money(r.bankroll?.target)}</div><div className="stat-foot">~{money(Math.pow(cfg.stepOdds || 1, cfg.steps))}x the first stake</div></div>
        <div className="stat"><div className="stat-label">Now</div><div className="stat-value" style={{ fontSize: 15 }}>{cur ? `step ${cur.n} ${cur.status}` : '—'}</div>
          <div className="stat-foot">{cur?.live ? `${cur.live.legsWon} won · ${cur.live.legsPending} pending` : r.lastTickAt ? `checked ${when(r.lastTickAt)}` : ''}</div></div>
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        {steps.map((s, i) => <Step key={`${s.n}-${s.status}-${i}`} step={s} total={cfg.steps} isCurrent={s.n === r.currentStep && s.status !== 'void'} />)}
      </div>
      {r.lastError && <div className="muted2" style={{ fontSize: 11.5, marginTop: 8 }}>last error: {r.lastError}</div>}
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function Rollover() {
  const [list, setList] = useState([])
  const [detail, setDetail] = useState({})           // id -> full chain with live step
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Form. Defaults are the user's own ask (2x, 15 steps); the projection panel is what tells
  // them what the record thinks of it before the stake goes down.
  const [name, setName] = useState('')
  const [shape, setShape] = useState('straight')
  const [oddsMin, setOddsMin] = useState(1.25)
  const [oddsMax, setOddsMax] = useState(1.55)
  const [floor, setFloor] = useState(0.85)
  const [targetOdds, setTargetOdds] = useState(1.5)
  const [sizeBy, setSizeBy] = useState('confidence')
  const [steps, setSteps] = useState(10)
  const [stake, setStake] = useState(10)
  const [windowHours, setWindowHours] = useState(72)
  const [minLegProb, setMinLegProb] = useState(0.75)
  const [maxLegs, setMaxLegs] = useState(4)
  const [mode, setMode] = useState('human')
  const [slate, setSlate] = useState('main')
  const [aiCheck, setAiCheck] = useState(true)
  const [tolerance, setTolerance] = useState(0.15)
  const [creating, setCreating] = useState(false)

  const [ins, setIns] = useState(null)
  const [insLoading, setInsLoading] = useState(false)

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/api/rollover')
      setList(data)
      // Live detail for every active chain (the step in play's leg grading).
      const active = data.filter(r => r.status === 'active')
      const det = await Promise.all(active.map(r => api.get(`/api/rollover/${r._id}`).then(x => x.data).catch(() => null)))
      setDetail(Object.fromEntries(det.filter(Boolean).map(d => [d._id, d])))
      setError(null)
    } catch (e) { setError(e.response?.data?.error || e.message) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => { const t = setInterval(load, 60_000); return () => clearInterval(t) }, [load])

  // Projection follows the form, debounced.
  useEffect(() => {
    const t = setTimeout(async () => {
      setInsLoading(true)
      try {
        const params = shape === 'straight'
          ? { shape, oddsMin, oddsMax, steps }
          : { shape, steps, tolerance: 0.2, ...(sizeBy === 'target' ? { targetOdds } : { floor }) }
        const { data } = await api.get('/api/rollover/insights', { params })
        setIns(data)
      } catch { /* the panel just stays as it was */ }
      finally { setInsLoading(false) }
    }, 300)
    return () => clearTimeout(t)
  }, [shape, oddsMin, oddsMax, floor, targetOdds, sizeBy, steps])

  const create = async () => {
    setCreating(true)
    try {
      await api.post('/api/rollover', {
        name: name || null, shape, steps, stake, windowHours, mode, slate, aiCheck,
        ...(shape === 'straight' ? { oddsMin, oddsMax } : { sizeBy, floor, targetOdds, tolerance, minLegProb, maxLegs }),
      })
      setName('')
      await load()
    } catch (e) { alert(e.response?.data?.error || e.message) }
    finally { setCreating(false) }
  }

  const advanceAll = async () => {
    try { await api.post('/api/rollover/advance'); await load() }
    catch (e) { alert(e.response?.data?.error || e.message) }
  }

  const merged = useMemo(() => list.map(r => detail[r._id] || r), [list, detail])
  const active = merged.filter(r => r.status === 'active')
  const done = merged.filter(r => r.status !== 'active')
  const stepOdds = shape === 'straight' ? (oddsMin + oddsMax) / 2 : sizeBy === 'target' ? targetOdds : 1 / (floor * 0.952)
  const payout = Math.pow(stepOdds, steps)

  return (
    <AppShell
      title="Rollover"
      subtitle="Short tickets, one after another, each staked with the last one's return"
      actions={<button className="btn btn-sm" onClick={advanceAll}>Check all</button>}
    >
      {error && <div className="card card-pad" style={{ borderColor: 'var(--neg-dim)', marginBottom: 14 }}>{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 380px) 1fr', gap: 14, marginBottom: 18, alignItems: 'start' }} className="rollover-top">
        {/* Config */}
        <div className="card card-pad">
          <div className="card-title" style={{ marginBottom: 10 }}>New chain</div>
          <div style={{ display: 'grid', gap: 10 }}>
            <label className="label">Name <input className="field" value={name} onChange={e => setName(e.target.value)} placeholder="optional" /></label>
            <div className="seg">
              <button className={shape === 'straight' ? 'on' : ''} onClick={() => setShape('straight')}>One straight win</button>
              <button className={shape === 'cover' ? 'on' : ''} onClick={() => setShape('cover')}>Short accumulator</button>
            </div>
            <div className="muted2" style={{ fontSize: 11, lineHeight: 1.5 }}>
              {shape === 'straight'
                ? 'Each step is a single 1X2 win inside the price window. On the booked record this is the best-calibrated bet in the book — it beats its own claim by 7-21pp — and one fixture means nothing correlated.'
                : 'Each step is a small accumulator of short legs (Double Chance, Over 1.5, team unders), sized by confidence or by price.'}
            </div>
            {shape === 'straight' ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <label className="label">Price from
                  <input className="field num" type="number" step="0.05" min="1.02" max="4" value={oddsMin} onChange={e => setOddsMin(parseFloat(e.target.value) || 1.05)} />
                </label>
                <label className="label">…to
                  <input className="field num" type="number" step="0.05" min="1.03" max="5" value={oddsMax} onChange={e => setOddsMax(parseFloat(e.target.value) || 1.55)} />
                </label>
              </div>
            ) : (
              <>
                <div className="seg">
                  <button className={sizeBy === 'confidence' ? 'on' : ''} onClick={() => setSizeBy('confidence')}>By confidence</button>
                  <button className={sizeBy === 'target' ? 'on' : ''} onClick={() => setSizeBy('target')}>By price</button>
                </div>
                {sizeBy === 'confidence' ? (
                  <label className="label">Each step must claim ≥ {pct(floor)}
                    <input type="range" min="0.6" max="0.95" step="0.01" value={floor} onChange={e => setFloor(parseFloat(e.target.value))} />
                  </label>
                ) : (
                  <label className="label">Odds / step
                    <input className="field num" type="number" step="0.05" min="1.05" max="10" value={targetOdds} onChange={e => setTargetOdds(parseFloat(e.target.value) || 1.5)} />
                  </label>
                )}
              </>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <label className="label">Steps
                <input className="field num" type="number" min="1" max="50" value={steps} onChange={e => setSteps(parseInt(e.target.value, 10) || 1)} />
              </label>
              <label className="label">Stake
                <input className="field num" type="number" min="0.01" step="1" value={stake} onChange={e => setStake(parseFloat(e.target.value) || 1)} />
              </label>
            </div>
            <div className="muted" style={{ fontSize: 12 }}>
              {stake} → <b className="num" style={{ color: 'var(--pos)' }}>{money(stake * payout)}</b> if all {steps} land (~{money(payout)}x)
            </div>
            <details>
              <summary className="muted" style={{ fontSize: 12, cursor: 'pointer' }}>How each step is built</summary>
              <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
                <label className="label">Kickoff window — {windowHours}h (nearest first)
                  <input type="range" min="12" max="168" step="12" value={windowHours} onChange={e => setWindowHours(parseInt(e.target.value, 10))} />
                </label>
                {shape === 'cover' && (
                  <>
                    <label className="label">Leg floor — {pct(minLegProb)}
                      <input type="range" min="0.5" max="0.92" step="0.01" value={minLegProb} onChange={e => setMinLegProb(parseFloat(e.target.value))} />
                    </label>
                    <label className="label">Max legs per step — {maxLegs}
                      <input type="range" min="1" max="8" value={maxLegs} onChange={e => setMaxLegs(parseInt(e.target.value, 10))} />
                    </label>
                  </>
                )}
                <div className="seg">
                  <button className={mode === 'human' ? 'on' : ''} onClick={() => setMode('human')}>Judged</button>
                  <button className={mode === 'model' ? 'on' : ''} onClick={() => setMode('model')}>Model only</button>
                </div>
                <div className="seg">
                  <button className={slate === 'main' ? 'on' : ''} onClick={() => setSlate('main')}>Main card</button>
                  <button className={slate === 'focus' ? 'on' : ''} onClick={() => setSlate('focus')}>Focus leagues</button>
                </div>
                <label className="label" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={aiCheck} onChange={e => setAiCheck(e.target.checked)} />
                  Ask Claude about every leg, and drop the ones it argues against
                </label>
                <div className="muted2" style={{ fontSize: 11, lineHeight: 1.5 }}>
                  Every step uses the same pipeline as the scheduler's tickets: safe markets only, history veto, the learned price-band refusals, SportyBet-priced legs. It draws from the chosen slate's pool, nearest kickoffs first, so steps settle soon.
                  {aiCheck && (shape === 'straight'
                    ? ' The AI check is strict here: Claude has to call that exact side with High confidence, or the fixture is dropped and the step rebuilt.'
                    : ' A leg is dropped when Claude is unconfident, disagrees with the model, or the news pass contradicts it.')}
                </div>
              </div>
            </details>
            <button className="btn btn-primary" disabled={creating} onClick={create}>{creating ? 'Building step 1…' : 'Start chain'}</button>
          </div>
        </div>

        <Projection ins={ins} loading={insLoading} />
      </div>

      {loading ? <div className="muted">Loading…</div> : (
        <>
          {active.length > 0 && (
            <>
              <div className="label" style={{ marginBottom: 8 }}>Running</div>
              <div style={{ display: 'grid', gap: 12, marginBottom: 20 }}>{active.map(r => <Chain key={r._id} r={r} onChanged={load} />)}</div>
            </>
          )}
          {done.length > 0 && (
            <>
              <div className="label" style={{ marginBottom: 8 }}>Finished</div>
              <div style={{ display: 'grid', gap: 12 }}>{done.map(r => <Chain key={r._id} r={r} onChanged={load} />)}</div>
            </>
          )}
          {!active.length && !done.length && <div className="card card-pad muted">No chains yet. Set the odds and steps above, read what the record says, then start one.</div>}
        </>
      )}
      <style>{`@media (max-width: 800px) { .rollover-top { grid-template-columns: 1fr !important; } }`}</style>
    </AppShell>
  )
}
