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
 * ── Layout ───────────────────────────────────────────────────────────────────────────────────
 *
 * Running chains come first and the builder collapses once you have one, because after the first
 * visit this is a tracking screen, not a configuration screen. Inside a chain only the step in
 * play is expanded — a 20-step chain rendering every leg of every step was several screens of
 * scrolling to reach the one row that can still change.
 *
 * ── Why the projection panel is as loud as it is ─────────────────────────────────────────────
 *
 * The natural first request — 2x a step, fifteen steps — is a 32,768x ticket spread over two
 * weeks, and the record lands 2x tickets about 31% of the time, so the panel says "under 1%"
 * before the stake goes down. A straight win at 1.15-1.45 lands 83% and three of those double
 * the money 58% of the time. Same engine, same legs; the difference is entirely how many you ask
 * for in a row, and that is a difference the screen should state rather than leave to arithmetic.
 */

const pct = (v, d = 0) => (v == null ? '—' : `${(v * 100).toFixed(d)}%`)
const money = v => (v == null ? '—' : Number(v).toLocaleString('en-GB', { maximumFractionDigits: 2 }))
const when = d => (d ? new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—')
const kickoff = d => {
  if (!d) return null
  const dt = new Date(d), now = new Date()
  return dt.toDateString() === now.toDateString()
    ? dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : dt.toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' })
}

const PILL = {
  active: 'pill-info', completed: 'pill-pos', busted: 'pill-neg', stopped: '',
  pending: 'pill-info', won: 'pill-pos', lost: 'pill-neg',
  void: 'pill-warn', unbuilt: 'pill-warn', unbooked: 'pill-warn', building: 'pill-accent',
}
const DOT = { won: 'var(--pos)', lost: 'var(--neg)', pending: 'var(--info)', building: 'var(--accent-2)' }
const dotFor = s => (s ? DOT[s.status] || 'var(--warn)' : 'var(--line)')
const STEP_WORD = { building: 'building…', unbuilt: 'no ticket yet', unbooked: 'not booked', pending: 'running', won: 'won', lost: 'lost', void: 'void' }

// ── Projection ───────────────────────────────────────────────────────────────

function Projection({ ins, loading }) {
  if (loading && !ins) return <div className="card card-pad muted">Reading the record…</div>
  if (!ins) return null
  const p = ins.projection, s = ins.sample
  const tone = !p ? 'var(--tx-3)' : p.pComplete < 0.01 ? 'var(--neg)' : p.evPerUnit > 1 ? 'var(--pos)' : 'var(--warn)'
  const what = ins.shape === 'straight' ? `a straight win ${ins.oddsMin}–${ins.oddsMax}x` : `${ins.targetOdds}x`
  return (
    <div className="card card-pad" style={{ borderColor: tone }}>
      <div className="card-head" style={{ marginBottom: 8, gap: 8, flexWrap: 'wrap' }}>
        <div className="card-title">What the record says about {what} × {ins.steps}</div>
        <span className="muted2" style={{ fontSize: 11 }}>
          {s.n} settled {s.kind}{ins.shape === 'straight' ? ' in that window' : ` within ±${Math.round(ins.tolerance * 100)}% of ${ins.targetOdds}x`}
        </span>
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.55, color: tone, fontWeight: 600, marginBottom: 12 }}>{ins.verdict}</div>
      {p && (
        <div className="stat-grid" style={{ marginBottom: 12 }}>
          <div className="stat">
            <div className="stat-label">Per step</div>
            <div className="stat-value num">{pct(p.perStep)}</div>
            <div className="stat-foot">
              ±{pct(p.se)} · model claimed {pct(s.claimed)}
              {s.claimed != null && s.hit > s.claimed ? <span style={{ color: 'var(--pos)' }}> (+{((s.hit - s.claimed) * 100).toFixed(0)}pp)</span> : null}
            </div>
          </div>
          <div className="stat">
            <div className="stat-label">Complete all {ins.steps}</div>
            <div className="stat-value num" style={{ color: tone }}>{pct(p.pComplete, p.pComplete < 0.01 ? 3 : 1)}</div>
            <div className="stat-foot">range {pct(p.pCompleteLow, 2)}–{pct(p.pCompleteHigh, 2)}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Typical bust</div>
            <div className="stat-value num">step {p.medianBustStep ?? '—'}</div>
            <div className="stat-foot">half of chains die by here</div>
          </div>
          <div className="stat">
            <div className="stat-label">Pays if complete</div>
            <div className="stat-value num">{money(p.payoutIfComplete)}x</div>
            <div className="stat-foot">fair value {p.evPerUnit}/unit{p.evPerUnit > 1 ? ' — +EV' : ''}</div>
          </div>
        </div>
      )}
      <details>
        <summary className="muted" style={{ fontSize: 11.5, cursor: 'pointer', marginBottom: 6 }}>
          Every {ins.shape === 'straight' ? 'straight win' : 'ticket'} ever booked here, by price
        </summary>
        <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', minWidth: 340, fontSize: 12, borderCollapse: 'collapse' }}>
          <thead>
            <tr className="muted" style={{ textAlign: 'right' }}>
              <th style={{ textAlign: 'left', fontWeight: 600, padding: '3px 0' }}>{ins.shape === 'straight' ? 'leg price' : 'ticket odds'}</th>
              <th style={{ fontWeight: 600 }}>n</th><th style={{ fontWeight: 600 }}>landed</th>
              <th style={{ fontWeight: 600 }}>5 in a row</th><th style={{ fontWeight: 600 }}>10</th><th style={{ fontWeight: 600 }}>15</th>
            </tr>
          </thead>
          <tbody>
            {ins.ladder.map(r => {
              const [ba, bb] = r.band.split('-').map(parseFloat)
              const here = ins.shape === 'straight' ? (ins.oddsMin < bb && ins.oddsMax > ba) : (ins.targetOdds >= ba && ins.targetOdds < bb)
              return (
                <tr key={r.band} className="num" style={{ textAlign: 'right', background: here ? 'var(--accent-soft)' : 'transparent' }}>
                  <td style={{ textAlign: 'left', padding: '3px 4px', fontWeight: here ? 700 : 400 }}>{r.band}x</td>
                  <td>{r.n}</td><td>{pct(r.hit)}</td>
                  <td>{r.pReach ? pct(r.pReach[5], 1) : '—'}</td>
                  <td>{r.pReach ? pct(r.pReach[10], 2) : '—'}</td>
                  <td>{r.pReach ? pct(r.pReach[15], 3) : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        </div>
      </details>
      {ins.chains.total > 0 && (
        <div className="muted" style={{ fontSize: 11.5, marginTop: 10 }}>
          Your chains: {ins.chains.total} — {ins.chains.completed} completed, {ins.chains.busted} busted, {ins.chains.active} running.
          {ins.chains.stepTickets.n ? ` Steps settled: ${ins.chains.stepTickets.won}/${ins.chains.stepTickets.n} (${pct(ins.chains.stepTickets.won / ins.chains.stepTickets.n)}).` : ''}
        </div>
      )}
    </div>
  )
}

// ── One step ─────────────────────────────────────────────────────────────────

function Leg({ l, live }) {
  const won = live?.won
  return (
    <div className="ro-leg">
      <span className="ro-leg-mark" style={{ color: won === true ? 'var(--pos)' : won === false ? 'var(--neg)' : 'var(--tx-4)' }}>
        {won === true ? '✓' : won === false ? '✗' : '·'}
      </span>
      <span className="ro-leg-match">{l.match}<span className="muted2"> · {l.league}</span></span>
      <span className="ro-leg-bet muted">{l.market}: <b style={{ color: 'var(--tx-1)' }}>{l.selection}</b></span>
      <span className="num ro-leg-odds">@{l.odds}</span>
      {live?.sbScore && <span className="num muted2">{live.sbScore}</span>}
      <span className="muted2 ro-leg-ko">{kickoff(l.kickoff)}</span>
    </div>
  )
}

function Step({ step, total, live, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen)
  useEffect(() => { setOpen(defaultOpen) }, [defaultOpen])
  const one = step.legs?.length === 1 ? step.legs[0] : null

  return (
    <div className="card" style={{ padding: '8px 11px', borderColor: defaultOpen ? 'var(--accent-dim)' : 'var(--line-soft)' }}>
      <div className="ro-step-head" onClick={() => setOpen(o => !o)}>
        <span style={{ width: 8, height: 8, borderRadius: 4, background: dotFor(step), flexShrink: 0 }} />
        <span style={{ fontWeight: 700, fontSize: 12.5, flexShrink: 0 }}>Step {step.n}<span className="muted2">/{total}</span></span>
        <span className={`pill ${PILL[step.status] || ''}`} style={{ flexShrink: 0 }}>{STEP_WORD[step.status] || step.status}</span>
        {step.totalOdds > 0 && <span className="num" style={{ fontWeight: 800, color: 'var(--warn)', flexShrink: 0 }}>{step.totalOdds}x</span>}

        {/* Collapsed rows still say what the bet IS — that is the one thing worth seeing at a glance. */}
        {!open && one && (
          <span className="muted ro-step-what">{one.match} · <b style={{ color: 'var(--tx-2)' }}>{one.selection}</b></span>
        )}
        {!open && !one && step.legCount > 0 && <span className="muted ro-step-what">{step.legCount} legs</span>}
        {!open && !step.legCount && <span className="ro-step-what" />}

        <span className="num muted2 ro-step-stake">
          {money(step.stake)}{step.potential ? ` → ${money(step.potential)}` : ''}
        </span>
        <span className="muted2" style={{ fontSize: 11, flexShrink: 0 }}>{open ? '▾' : '▸'}</span>
      </div>

      {open && (
        <div style={{ marginTop: 8 }}>
          {step.status === 'building' && (
            <div className="muted" style={{ fontSize: 12 }}>
              Cutting a ticket from the card, checking it with Claude, then booking it. Usually under two minutes.
            </div>
          )}
          {step.code && (
            <div className="toolbar" style={{ gap: 6, marginBottom: 8 }}>
              <code style={{ fontSize: 13, fontWeight: 800, letterSpacing: '0.04em' }}>{step.code}</code>
              <button className="btn btn-sm" onClick={e => { e.stopPropagation(); navigator.clipboard?.writeText(step.code) }}>Copy</button>
              {step.shareUrl && <a className="btn btn-sm btn-info" href={step.shareUrl} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>SportyBet ↗</a>}
              {step.winProb != null && <span className="muted2" style={{ fontSize: 11 }}>claims {pct(step.winProb)}</span>}
              {step.deadline && <span className="muted2" style={{ fontSize: 11 }}>valid to {when(step.deadline)}</span>}
            </div>
          )}
          {step.legs?.length > 0 && (
            <div style={{ display: 'grid', gap: 3 }}>
              {step.legs.map((l, i) => (
                <Leg key={i} l={l} live={live?.legs?.find(x => x.match === l.match && x.market === l.market && x.selection === l.selection)} />
              ))}
            </div>
          )}
          {step.ai && (step.ai.rejected?.length > 0 || step.ai.notes?.length > 0) && (
            <div style={{ marginTop: 8, paddingTop: 6, borderTop: '1px solid var(--line-soft)' }}>
              <div className="muted2" style={{ fontSize: 10.5, marginBottom: 3 }}>
                Claude checked {step.ai.checked} leg{step.ai.checked === 1 ? '' : 's'} over {step.ai.rounds} round{step.ai.rounds === 1 ? '' : 's'}
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
      )}
    </div>
  )
}

// ── A number field you can actually edit ─────────────────────────────────────

/**
 * A controlled numeric input that keeps the TEXT you are typing, not the number it parses to.
 *
 * The obvious spelling — `value={n} onChange={e => set(parseFloat(e.target.value) || 1)}` —
 * makes the field uneditable in a way that is easy to miss when you only ever nudge the
 * spinner. Clearing it to type a new number produces `''`, which parses to NaN, which `|| 1`
 * turns into 1, which React writes straight back into the box. You cannot select-all and retype:
 * the field fights you on every keystroke and lands on 1.
 *
 * So the text is local state and the parsed number only travels upward when it is actually a
 * number in range. An empty or half-typed box ("1.", "0.0") leaves the last good value in place
 * rather than inventing one. Blur is where it settles up: restore the last good value if what is
 * there is not a number, clamp it if it is out of range, and normalise what is displayed.
 */
function NumField({ value, onChange, min, max, step = 1, integer = false, ...rest }) {
  const [text, setText] = useState(() => String(value))
  const [editing, setEditing] = useState(false)
  // A change from outside (switching shape resets the defaults) only lands while you are not
  // typing — otherwise it would overwrite the box mid-edit.
  useEffect(() => { if (!editing) setText(String(value)) }, [value, editing])

  const parse = raw => (integer ? parseInt(raw, 10) : parseFloat(raw))
  const clamp = n => Math.min(max, Math.max(min, n))

  return (
    <input
      {...rest}
      className="field num"
      type="number"
      inputMode={integer ? 'numeric' : 'decimal'}
      step={step} min={min} max={max}
      value={text}
      onFocus={() => setEditing(true)}
      onChange={e => {
        setText(e.target.value)
        const n = parse(e.target.value)
        if (Number.isFinite(n) && n >= min && n <= max) onChange(n)
      }}
      onBlur={e => {
        setEditing(false)
        const n = parse(e.target.value)
        if (!Number.isFinite(n)) { setText(String(value)); return }
        const c = clamp(n)
        onChange(c)
        setText(String(c))
      }}
    />
  )
}

// ── Countdown ────────────────────────────────────────────────────────────────

/** "3h 20m" / "45m" / "2d 4h" — a person's units, never a timestamp. */
function human(ms) {
  if (!(ms > 0)) return null
  const m = Math.round(ms / 60000)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${m % 60}m`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}

// The settlement pass runs at :15 past every second hour (services/scheduler.js), and that is
// also when an unbuilt step is retried and a won step's successor is cut. So "next check" is a
// real time we can show rather than a vague "soon".
function nextTick(now) {
  const d = new Date(now)
  d.setUTCMinutes(15, 0, 0)
  while (d <= now || d.getUTCHours() % 2 !== 0) d.setUTCMinutes(d.getUTCMinutes() + 60)
  return d
}

/**
 * What this step is waiting for, in one line.
 *
 * A step's life is: built -> first kickoff -> last kickoff -> graded. Each stage has a different
 * honest answer, and "pending" alone tells you none of them.
 */
function waitingOn(step, now) {
  if (!step) return null
  if (step.status === 'building') return { label: 'building the ticket', tone: 'var(--accent-2)' }
  if (step.status === 'unbuilt' || step.status === 'unbooked') {
    return { label: `retrying in ${human(nextTick(now) - now) || 'a moment'}`, tone: 'var(--warn)' }
  }
  if (step.status !== 'pending') return null
  const kos = (step.legs || []).map(l => l.kickoff && new Date(l.kickoff).getTime()).filter(Boolean)
  if (!kos.length) return { label: 'waiting on results', tone: 'var(--info)' }
  const first = Math.min(...kos), last = Math.max(...kos)
  const t = now.getTime()
  if (t < first) return { label: `kicks off in ${human(first - t)}`, tone: 'var(--info)', at: first }
  // ~2 hours covers a match plus stoppage; after the last one it is just waiting for the grade.
  // A multi-leg step says how many are still to come, because "in play" on a step with three
  // legs left to kick off is not the same thing as one in its 80th minute.
  if (t < last + 2 * 3600e3) {
    const toCome = kos.filter(k => k > t).length
    return { label: toCome > 0 ? `in play · ${toCome} still to kick off` : 'in play', tone: 'var(--pos)' }
  }
  return { label: `settles at the ${human(nextTick(now) - now)} check`, tone: 'var(--info)' }
}

// ── One chain ────────────────────────────────────────────────────────────────

function Chain({ r, onChanged, now, defaultOpen = false }) {
  const [busy, setBusy] = useState(null)
  const [open, setOpen] = useState(defaultOpen)
  const [showAll, setShowAll] = useState(false)
  const cfg = r.config
  const won = r.steps.filter(s => s.status === 'won').length
  const live = [...r.steps].reverse().find(s => s.n === r.currentStep && s.status !== 'void')
  const ordered = [...r.steps].sort((a, b) => a.n - b.n || (a.status === 'void' ? -1 : 1))
  const shown = showAll || ordered.length <= 4 ? ordered : ordered.slice(-3)
  const hidden = ordered.length - shown.length
  const wait = waitingOn(live, now)
  const one = live?.legs?.length === 1 ? live.legs[0] : null

  const act = async (what) => {
    setBusy(what)
    try { await api.post(`/api/rollover/${r._id}/${what}`); await onChanged() }
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

  const shapeLine = cfg.shape === 'straight'
    ? `one straight win ${cfg.oddsMin}–${cfg.oddsMax}x`
    : cfg.sizeBy === 'confidence' ? `each step claims ≥${pct(cfg.floor)}`
    : `${cfg.targetOdds}x a step (${(cfg.targetOdds * (1 - (cfg.tolerance ?? 0))).toFixed(2)}–${(cfg.targetOdds * (1 + (cfg.tolerance ?? 0))).toFixed(2)}x)`

  return (
    <div className="card" style={{
      padding: '12px 14px',
      borderColor: r.status === 'busted' ? 'var(--neg-dim)' : r.status === 'completed' ? 'var(--pos-dim)' : undefined,
    }}>
      {/* ── Summary: everything that matters while it runs, in four rows ── */}
      <div className="ro-sum-head" onClick={() => setOpen(o => !o)}>
        <span style={{ width: 8, height: 8, borderRadius: 4, background: dotFor(live), flexShrink: 0 }} />
        <span className="ro-sum-name">{r.name || `${shapeLine} × ${cfg.steps}`}</span>
        <span className={`pill ${PILL[r.status] || ''}`} style={{ flexShrink: 0 }}>{r.status}</span>
        <span className="num ro-sum-count" style={{ flexShrink: 0 }}>{won}<span className="muted2">/{cfg.steps}</span></span>
        <span className="muted2" style={{ fontSize: 11, flexShrink: 0 }}>{open ? '▾' : '▸'}</span>
      </div>

      <div style={{ display: 'flex', gap: 2, margin: '8px 0' }}>
        {Array.from({ length: cfg.steps }, (_, i) => {
          const s = [...r.steps].reverse().find(x => x.n === i + 1 && x.status !== 'void')
          return <div key={i} title={`step ${i + 1}${s ? ` — ${s.status}` : ''}`} style={{ flex: 1, height: 5, borderRadius: 3, background: dotFor(s) }} />
        })}
      </div>

      {/* The live step, as one readable line — the bet, the code, and what it is waiting for. */}
      {live && r.status === 'active' && (
        <div className="ro-sum-live">
          <div className="ro-sum-bet">
            <b style={{ fontSize: 12.5 }}>Step {live.n}</b>
            {one
              ? <span className="muted"> · {one.match} · <b style={{ color: 'var(--tx-1)' }}>{one.selection}</b></span>
              : live.legCount > 0 ? <span className="muted"> · {live.legCount} legs</span> : null}
            {live.totalOdds > 0 && <span className="num" style={{ color: 'var(--warn)', fontWeight: 700 }}> {live.totalOdds}x</span>}
          </div>
          {wait && (
            <div className="ro-sum-wait" style={{ color: wait.tone }}>
              {live.status === 'building' && <span className="ro-spin" />}
              {wait.label}
            </div>
          )}
        </div>
      )}

      {/* A step that could not be built has a reason, and it is always actionable — too narrow a
          window, too high a floor, too few legs allowed. Burying it in the detail panel meant the
          card said "retrying" and nothing else, which is the least useful half of the answer. */}
      {live && ['unbuilt', 'unbooked'].includes(live.status) && live.note && (
        <div className="muted2" style={{ fontSize: 11.5, lineHeight: 1.5, marginTop: 4 }}>{live.note}</div>
      )}

      <div className="ro-sum-foot">
        {live?.code && (
          <>
            <code style={{ fontWeight: 800, letterSpacing: '0.04em' }}>{live.code}</code>
            <button className="btn btn-sm" onClick={e => { e.stopPropagation(); navigator.clipboard?.writeText(live.code) }}>Copy</button>
            {live.shareUrl && <a className="btn btn-sm btn-info" href={live.shareUrl} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>SportyBet ↗</a>}
          </>
        )}
        <span className="num muted" style={{ marginLeft: 'auto', fontSize: 12 }}>
          {money(r.bankroll?.current)}
          {live?.potential ? <> → <b style={{ color: 'var(--pos)' }}>{money(live.potential)}</b></> : null}
          <span className="muted2"> · target {money(r.bankroll?.target)}</span>
        </span>
      </div>

      {/* ── Detail, on demand ── */}
      {open && (
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--line-soft)' }}>
          <div className="card-head" style={{ marginBottom: 10, gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div className="muted2" style={{ fontSize: 11.5, lineHeight: 1.5, minWidth: 0 }}>
              {shapeLine} · {cfg.steps} steps · {cfg.windowHours}h window · {cfg.slate} card · {cfg.mode}
              {cfg.aiCheck ? ' · AI check' : ''} · started {when(r.startedAt)}
            </div>
            <div className="toolbar" style={{ gap: 6 }}>
              {r.status === 'active' && live && !['pending', 'building'].includes(live.status) && (
                <button className="btn btn-sm btn-accent" disabled={!!busy} onClick={() => act('rebuild')}>{busy === 'rebuild' ? 'Building…' : 'Build now'}</button>
              )}
              {r.status === 'active' && <button className="btn btn-sm" disabled={!!busy} onClick={() => act('advance')}>{busy === 'advance' ? 'Checking…' : 'Check'}</button>}
              {r.status === 'active' && <button className="btn btn-sm btn-neg" disabled={!!busy} onClick={() => { if (confirm('Stop this chain?')) act('stop') }}>Stop</button>}
              {r.status !== 'active' && <button className="btn btn-sm btn-ghost" disabled={!!busy} onClick={remove}>Delete</button>}
            </div>
          </div>

          <div className="stat-grid" style={{ marginBottom: 12 }}>
            <div className="stat">
              <div className="stat-label">Progress</div>
              <div className="stat-value num">{won}<span className="muted2" style={{ fontSize: 14 }}>/{cfg.steps}</span></div>
              <div className="stat-foot">steps landed</div>
            </div>
            <div className="stat">
              <div className="stat-label">Bankroll</div>
              <div className="stat-value num">{money(r.bankroll?.current)}</div>
              <div className="stat-foot">from {money(r.bankroll?.initial)}</div>
            </div>
            <div className="stat">
              <div className="stat-label">If it completes</div>
              <div className="stat-value num" style={{ color: 'var(--pos)' }}>{money(r.bankroll?.target)}</div>
              <div className="stat-foot">~{money(Math.pow(cfg.stepOdds || 1, cfg.steps))}x the first stake</div>
            </div>
            <div className="stat">
              <div className="stat-label">Now</div>
              <div className="stat-value" style={{ fontSize: 15 }}>{live ? `step ${live.n} ${STEP_WORD[live.status] || live.status}` : '—'}</div>
              <div className="stat-foot">
                {live?.live ? `${live.live.legsWon} won · ${live.live.legsPending} pending` : r.lastTickAt ? `checked ${when(r.lastTickAt)}` : ''}
              </div>
            </div>
          </div>

          {hidden > 0 && (
            <button className="btn btn-sm btn-ghost" style={{ marginBottom: 6 }} onClick={() => setShowAll(true)}>
              Show {hidden} earlier step{hidden === 1 ? '' : 's'}
            </button>
          )}
          <div style={{ display: 'grid', gap: 6 }}>
            {shown.map((s, i) => (
              <Step
                key={`${s.n}-${s.status}-${i}`}
                step={s}
                total={cfg.steps}
                live={s === live ? live.live : null}
                defaultOpen={s === live && r.status === 'active'}
              />
            ))}
          </div>
          {r.lastError && <div className="muted2" style={{ fontSize: 11.5, marginTop: 8 }}>last error: {r.lastError}</div>}
        </div>
      )}
    </div>
  )
}


// ── Page ─────────────────────────────────────────────────────────────────────

export default function Rollover() {
  const [list, setList] = useState([])
  const [detail, setDetail] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [formTouched, setFormTouched] = useState(false)

  const [name, setName] = useState('')
  const [shape, setShape] = useState('straight')
  const [oddsMin, setOddsMin] = useState(1.15)
  const [oddsMax, setOddsMax] = useState(1.45)
  const [floor, setFloor] = useState(0.85)
  const [targetOdds, setTargetOdds] = useState(1.5)
  const [sizeBy, setSizeBy] = useState('confidence')
  const [steps, setSteps] = useState(3)
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
  // Countdowns move on their own clock, 30s, so they stay live between the 60s data polls.
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(t) }, [])

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/api/rollover')
      setList(data)
      const active = data.filter(r => r.status === 'active')
      const det = await Promise.all(active.map(r => api.get(`/api/rollover/${r._id}`).then(x => x.data).catch(() => null)))
      setDetail(Object.fromEntries(det.filter(Boolean).map(d => [d._id, d])))
      setError(null)
      // The builder starts open only when there is nothing to track yet.
      if (!formTouched) setShowForm(data.length === 0)
    } catch (e) { setError(e.response?.data?.error || e.message) }
    finally { setLoading(false) }
  }, [formTouched])
  useEffect(() => { load() }, [load])

  const merged = useMemo(() => list.map(r => detail[r._id] || r), [list, detail])
  const building = merged.some(r => r.steps?.some(s => s.status === 'building'))
  // Poll hard while a step is being cut, gently otherwise.
  useEffect(() => {
    const t = setInterval(load, building ? 6_000 : 60_000)
    return () => clearInterval(t)
  }, [load, building])

  useEffect(() => {
    const t = setTimeout(async () => {
      setInsLoading(true)
      try {
        const params = shape === 'straight'
          ? { shape, oddsMin, oddsMax, steps }
          : { shape, steps, tolerance, ...(sizeBy === 'target' ? { targetOdds } : { floor }) }
        const { data } = await api.get('/api/rollover/insights', { params })
        setIns(data)
      } catch { /* the panel just stays as it was */ }
      finally { setInsLoading(false) }
    }, 300)
    return () => clearTimeout(t)
  }, [shape, oddsMin, oddsMax, floor, targetOdds, sizeBy, steps, tolerance])

  const create = async () => {
    setCreating(true)
    try {
      await api.post('/api/rollover', {
        name: name || null, shape, steps, stake, windowHours, mode, slate, aiCheck,
        ...(shape === 'straight' ? { oddsMin, oddsMax } : { sizeBy, floor, targetOdds, tolerance, minLegProb, maxLegs }),
      })
      setName('')
      setShowForm(false); setFormTouched(true)
      await load()
    } catch (e) { alert(e.response?.data?.error || e.message) }
    finally { setCreating(false) }
  }

  const advanceAll = async () => {
    try { await api.post('/api/rollover/advance'); await load() }
    catch (e) { alert(e.response?.data?.error || e.message) }
  }

  const active = merged.filter(r => r.status === 'active')
  const done = merged.filter(r => r.status !== 'active')
  const stepOdds = shape === 'straight' ? (oddsMin + oddsMax) / 2 : sizeBy === 'target' ? targetOdds : 1 / (floor * 0.952)
  const payout = Math.pow(stepOdds, steps)

  // ── Can these settings even reach the price being asked for? ──
  //
  // A leg claiming `minLegProb` is priced around 1/minLegProb, so `maxLegs` of them multiply to
  // at most (1/minLegProb)^maxLegs. Ask for more than that and no card can ever supply it — the
  // build fails every retry, for a reason that is arithmetic rather than bad luck. Measured on a
  // real chain: 80% floor, 2 legs, 24h window asked for 1.5x, and the best the card could reach
  // was 1.25x because the floor left three fixtures standing.
  //
  // Deliberately a warning and not a block: the ceiling assumes every leg sits exactly on the
  // floor, so reaching it is possible on a strong card and the user may know that.
  const reach = shape === 'cover' && sizeBy === 'target' ? Math.pow(1 / minLegProb, maxLegs) : null
  const tooFar = reach != null && targetOdds > reach * 0.95
  const thinWindow = windowHours <= 24

  // `.ro-top` is laid out in the stylesheet at the bottom rather than inline: an inline
  // grid-template-columns beats a media query, so the phone breakpoint would never fire.
  const form = (
    <div className="ro-top">
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
              ? 'Each step is a single 1X2 win inside the price window. On the booked record this is the best-calibrated bet in the book — it beats its own claim by 7–21pp — and one fixture means nothing correlated.'
              : 'Each step is a small accumulator of short legs (Double Chance, Over 1.5, team unders), sized by confidence or by price.'}
          </div>

          {shape === 'straight' ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <label className="label">Price from
                <NumField value={oddsMin} onChange={setOddsMin} min={1.02} max={4} step={0.05} />
              </label>
              <label className="label">…to
                <NumField value={oddsMax} onChange={setOddsMax} min={1.03} max={5} step={0.05} />
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
                // The band is stated as the two prices it will actually accept, not as "±15%".
                // A step is built by reaching for a price out of whatever the card offers and
                // will almost never land exactly on the number asked for — so the useful thing
                // to show is the band, and the useful thing to control is how wide it is.
                <>
                <label className="label">Odds / step
                  <NumField value={targetOdds} onChange={setTargetOdds} min={1.05} max={10} step={0.05} />
                </label>
                <label className="label">
                  Take anything from <b className="num" style={{ color: 'var(--tx-1)' }}>{(targetOdds * (1 - tolerance)).toFixed(2)}x</b>
                  {' to '}<b className="num" style={{ color: 'var(--tx-1)' }}>{(targetOdds * (1 + tolerance)).toFixed(2)}x</b>
                  <input type="range" min="0.02" max="0.4" step="0.01" value={tolerance} onChange={e => setTolerance(parseFloat(e.target.value))} />
                  <span className="muted2" style={{ fontSize: 11, lineHeight: 1.5 }}>
                    Wider finds a step on more days; narrower keeps the payout closer to what you asked for.
                    A tight band on a thin card is the usual reason a step comes back unbuilt.
                  </span>
                </label>
                </>
              )}
            </>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <label className="label">Steps
              <NumField value={steps} onChange={setSteps} min={1} max={50} step={1} integer />
            </label>
            <label className="label">Stake
              <NumField value={stake} onChange={setStake} min={0.01} max={1e9} step={1} />
            </label>
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            {stake} → <b className="num" style={{ color: 'var(--pos)' }}>{money(stake * payout)}</b> if all {steps} land (~{money(payout)}x)
          </div>

          {tooFar && (
            <div className="card" style={{ padding: '8px 10px', borderColor: 'var(--warn-dim)', background: 'var(--warn-soft)' }}>
              <div style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--warn)' }}>
                <b>{maxLegs} leg{maxLegs === 1 ? '' : 's'} at ≥{pct(minLegProb)} reach about {reach.toFixed(2)}x at best</b> — short of the {targetOdds}x
                you are asking for, and only if every leg sits exactly on the floor. Allow more legs, or lower the leg floor,
                or ask for a shorter step.
              </div>
            </div>
          )}
          {!tooFar && thinWindow && (
            <div className="muted2" style={{ fontSize: 11.5, lineHeight: 1.5 }}>
              A {windowHours}h window is thin — the card carries roughly a quarter of the fixtures it does at 72h, so a step
              may take a few retries to find. Widen it under “How each step is built” if steps come back unbuilt.
            </div>
          )}

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

          <button className="btn btn-primary" disabled={creating} onClick={create}>{creating ? 'Starting…' : 'Start chain'}</button>
          <div className="muted2" style={{ fontSize: 11 }}>
            The first step is cut in the background — the chain appears straight away and fills in within a couple of minutes.
          </div>
        </div>
      </div>

      <Projection ins={ins} loading={insLoading} />
    </div>
  )

  return (
    <AppShell
      title="Rollover"
      subtitle="Short bets, one after another, each staked with the last one's return"
      actions={
        <>
          <button className="btn btn-sm" onClick={advanceAll}>Check all</button>
          <button
            className={`btn btn-sm ${showForm ? '' : 'btn-primary'}`}
            onClick={() => { setShowForm(v => !v); setFormTouched(true) }}
          >
            {showForm ? 'Hide builder' : 'New chain'}
          </button>
        </>
      }
    >
      {error && <div className="card card-pad" style={{ borderColor: 'var(--neg-dim)', marginBottom: 14 }}>{error}</div>}

      {loading ? <div className="muted">Loading…</div> : (
        <>
          {active.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div className="label" style={{ marginBottom: 8 }}>Running</div>
              <div style={{ display: 'grid', gap: 10 }}>
                {active.map(r => <Chain key={r._id} r={r} onChanged={load} now={now} defaultOpen={active.length === 1 && r.steps.length <= 2} />)}
              </div>
            </div>
          )}

          {showForm && <div style={{ marginBottom: 20 }}>{form}</div>}

          {done.length > 0 && (
            <div>
              <div className="label" style={{ marginBottom: 8 }}>Finished</div>
              <div style={{ display: 'grid', gap: 10 }}>{done.map(r => <Chain key={r._id} r={r} onChanged={load} now={now} />)}</div>
            </div>
          )}

          {!active.length && !done.length && !showForm && (
            <div className="card card-pad muted">No chains yet. Hit <b>New chain</b> to set one up.</div>
          )}
        </>
      )}
      <style>{`
        .ro-top { display: grid; grid-template-columns: minmax(270px, 360px) 1fr; gap: 14px; align-items: start; }
        .ro-leg { display: flex; gap: 8px; font-size: 12px; align-items: baseline; }
        .ro-leg-mark { width: 12px; flex-shrink: 0; }
        .ro-leg-match { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .ro-leg-bet, .ro-leg-odds, .ro-leg-ko { flex-shrink: 0; }
        .ro-leg-ko { font-size: 11px; }
        .ro-step-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; cursor: pointer; }

        .ro-sum-head { display: flex; align-items: center; gap: 8px; cursor: pointer; }
        .ro-sum-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13.5px; font-weight: 650; }
        .ro-sum-count { font-size: 13px; font-weight: 800; }
        .ro-sum-live { display: flex; align-items: baseline; gap: 10px; }
        .ro-sum-bet { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; }
        .ro-sum-wait { flex-shrink: 0; font-size: 12px; font-weight: 650; display: flex; align-items: center; gap: 5px; }
        .ro-sum-foot { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 8px; font-size: 12.5px; }
        /* A build is the one state where something is happening that you cannot see. */
        .ro-spin { width: 9px; height: 9px; border-radius: 50%; border: 2px solid var(--accent-dim); border-top-color: var(--accent-2); animation: ro-sp 0.8s linear infinite; }
        @keyframes ro-sp { to { transform: rotate(360deg); } }
        .ro-step-what { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
        .ro-step-stake { font-size: 11.5px; flex-shrink: 0; }

        @media (max-width: 820px) { .ro-top { grid-template-columns: 1fr; } }

        @media (max-width: 599px) {
          /* The live step stacks: the bet on one line, what it is waiting for underneath, so
             neither gets truncated to nothing by the other. */
          .ro-sum-live { display: block; }
          .ro-sum-bet { white-space: normal; overflow: visible; }
          .ro-sum-wait { margin-top: 3px; }
          .ro-sum-foot code { font-size: 12.5px; }

          /* A leg is three things — which match, which bet, what price. On a phone they stack
             instead of competing for one line, and the match name stops being truncated to
             nothing by the bet text beside it. */
          .ro-leg {
            display: grid;
            grid-template-columns: 12px 1fr auto;
            grid-template-areas: "mark match odds" ". bet ko";
            row-gap: 1px; column-gap: 6px;
            padding: 3px 0; border-bottom: 1px solid var(--line-soft);
          }
          .ro-leg-mark { grid-area: mark; }
          .ro-leg-match { grid-area: match; white-space: normal; overflow: visible; font-size: 12.5px; }
          .ro-leg-bet { grid-area: bet; font-size: 11.5px; }
          .ro-leg-odds { grid-area: odds; align-self: start; }
          .ro-leg-ko { grid-area: ko; justify-self: end; }
          /* The stake reads as a footnote on its own line rather than squeezing the bet off. */
          .ro-step-what { flex-basis: 100%; order: 10; }
          .ro-step-stake { order: 11; margin-left: auto; }
        }
      `}</style>
    </AppShell>
  )
}
