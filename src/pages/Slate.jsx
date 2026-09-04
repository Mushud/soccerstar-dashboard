import { useCallback, useEffect, useState } from 'react'
import AppShell from '../components/AppShell'
import api from '../api'

/**
 * Slate management.
 *
 * The bet builder shows the slate as a banner — "here is what was built, load it" — which answers
 * "what should I bet now" and nothing else. Once the slate runs unattended every five hours and
 * books its own tickets, the questions change: did the last run fire, what did it produce, are the
 * codes still valid, and is it quietly failing. A banner cannot answer any of those, so this is
 * the page that does.
 */

const pct = v => (v == null ? '—' : `${(v * 100).toFixed(0)}%`)
const clock = d => (d ? new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—')
const dayLabel = d => (d ? new Date(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : '—')

/** "2h 14m" — a countdown a person reads, not a timestamp. */
function until(iso, now) {
  if (!iso) return null
  const ms = new Date(iso).getTime() - now
  if (!(ms > 0)) return 'any moment now'
  const m = Math.round(ms / 60000)
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`
}

/** One built ticket. Shared by the current slate and the history rows. */
function Ticket({ slip, compact = false }) {
  if (!slip.ok) {
    return (
      <div className="card" style={{ padding: '9px 12px', minWidth: 220, borderColor: 'var(--line)' }}>
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 3 }}>{slip.label}</div>
        <div className="muted2" style={{ fontSize: 10.5, lineHeight: 1.5 }}>{slip.reason || 'Not buildable'}</div>
      </div>
    )
  }
  return (
    <div className="card" style={{ padding: '9px 12px', minWidth: 230 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, flexWrap: 'wrap' }}>
        <b style={{ fontSize: 12 }}>{slip.label}</b>
        <span className="num" style={{ fontSize: 16, fontWeight: 800, color: 'var(--warn)' }}>{slip.totalOdds}x</span>
        <span className="muted" style={{ fontSize: 11 }}>{slip.legs?.length ?? slip.legs} legs</span>
        <span className="num" style={{
          fontSize: 11.5, fontWeight: 700,
          color: slip.winProb >= 0.4 ? 'var(--pos)' : slip.winProb >= 0.15 ? 'var(--warn)' : 'var(--neg)',
        }}>{pct(slip.winProb)}</span>
      </div>
      {/* On a fixed-count ticket the leg count is the constraint, so the weakest leg it had to
          accept IS the quality reading — the number that says what the tenth leg cost you. */}
      {slip.kind === 'legs' && slip.weakestLeg != null && (
        <div className="muted2" style={{ fontSize: 10.5, marginTop: 3 }}>
          weakest leg <b style={{ color: slip.weakestLeg >= 0.8 ? 'var(--pos)' : slip.weakestLeg >= 0.7 ? 'var(--warn)' : 'var(--neg)' }}>
            {pct(slip.weakestLeg)}
          </b>
        </div>
      )}
      {slip.shortOfRequested > 0 && (
        <div style={{ fontSize: 10.5, color: 'var(--warn)', marginTop: 3 }}>
          {/* The old wording blamed SportyBet for all of it, which was simply wrong — on the card
              that prompted this, two legs were below the ticket's own probability floor, two more
              lost their slot to the market cap, and none of the four were a listing problem. */}
          {slip.shortOfRequested} short of {slip.wantedLegs} — the rest were below the
          probability floor, capped by market mix, or not on SportyBet's card.
        </div>
      )}
      {slip.toppedUp && (
        <div className="muted2" style={{ fontSize: 10.5, marginTop: 3 }}>
          Filled from the wider pool — the slate alone could not supply {slip.wantedLegs} legs.
        </div>
      )}
      {slip.code ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
          <code style={{ fontFamily: 'var(--mono)', fontSize: 13.5, fontWeight: 700, color: 'var(--warn)', letterSpacing: '0.08em' }}>
            {slip.code}
          </code>
          <button className="btn btn-sm" style={{ padding: '2px 7px', fontSize: 10.5 }}
            onClick={() => navigator.clipboard?.writeText(slip.code)}>Copy</button>
          {slip.shareUrl && (
            <a className="btn btn-sm btn-info" style={{ padding: '2px 7px', fontSize: 10.5 }}
              href={slip.shareUrl} target="_blank" rel="noreferrer">Open ↗</a>
          )}
        </div>
      ) : (
        <div className="muted2" style={{ fontSize: 10.5, marginTop: 5 }}>
          {slip.bookError ? `Not booked — ${slip.bookError}` : 'Built, not booked.'}
        </div>
      )}
      {!compact && slip.legs?.length > 0 && typeof slip.legs !== 'number' && (
        <div style={{ marginTop: 7, borderTop: '1px solid var(--line-soft)', paddingTop: 6 }}>
          {slip.legs.map((l, i) => (
            <div key={i} style={{ display: 'flex', gap: 7, fontSize: 10.5, lineHeight: 1.7 }}>
              <span className="muted2" style={{ minWidth: 34 }}>{clock(l.kickoff)}</span>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.match}</span>
              <span className="muted">{l.selection}</span>
              <span className="num" style={{ color: 'var(--warn)', minWidth: 30, textAlign: 'right' }}>{l.odds}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * One slate pick, with the AI's verdict and — when it changed the market — what it changed from.
 *
 * All of this was already being written to the slate by the AI pass and never read back: the
 * verdict, the confidence, the key factors, the full write-up, and `originalMarket` /
 * `originalSelection`, which are the only record that the engine had picked something else. A
 * slate that says "10 AI-analysed" without showing any of it is asking to be trusted rather than
 * checked.
 */
function PickRow({ p }) {
  const [open, setOpen] = useState(false)
  const changed = p.originalMarket &&
    (p.originalMarket !== p.market || p.originalSelection !== p.selection)
  const conf = String(p.claudeConf || '').toLowerCase()
  const confColor = conf === 'high' ? 'var(--pos)' : conf === 'low' ? 'var(--neg)' : 'var(--warn)'
  const factors = Array.isArray(p.keyFactors) ? p.keyFactors : []

  return (
    <div style={{ borderTop: '1px solid var(--line-soft)', padding: '7px 0' }}>
      <button onClick={() => setOpen(v => !v)}
        style={{ display: 'flex', gap: 9, alignItems: 'baseline', width: '100%', textAlign: 'left', flexWrap: 'wrap', padding: 0 }}>
        <span className="muted2" style={{ fontSize: 10.5, minWidth: 38 }}>{clock(p.fixtureDate)}</span>
        <span style={{ fontSize: 12, fontWeight: 600, flex: '1 1 200px', minWidth: 0 }}>{p.match}</span>
        <span className="muted" style={{ fontSize: 11.5 }}>
          {p.market}: <span style={{ color: 'var(--tx-2)', fontWeight: 600 }}>{p.selection}</span>
        </span>
        {changed && (
          <span className="tag tag-warn" style={{ fontSize: 9.5 }}
            title={`The engine picked ${p.originalMarket}: ${p.originalSelection}; the AI moved it`}>
            was {p.originalSelection}
          </span>
        )}
        <span className="num" style={{ fontSize: 11, color: 'var(--warn)', minWidth: 34, textAlign: 'right' }}>{p.odds ?? '—'}</span>
        <span className="num" style={{ fontSize: 11, minWidth: 34, textAlign: 'right', color: (p.modelProbRaw ?? 0) >= 0.8 ? 'var(--pos)' : 'var(--warn)' }}>
          {pct(p.modelProbRaw)}
        </span>
        {p.claudeConf && (
          <span style={{ fontSize: 10.5, color: confColor, minWidth: 40, textAlign: 'right' }}>{p.claudeConf}</span>
        )}
        <span className="muted2" style={{ fontSize: 10 }}>{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div style={{ marginTop: 7, paddingLeft: 47, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {!p.hasClaudeAnalysis && (
            <div className="muted2" style={{ fontSize: 11 }}>This pick was not AI-analysed.</div>
          )}
          {changed && (
            <div style={{ fontSize: 11, color: 'var(--warn)' }}>
              Engine picked <b>{p.originalMarket}: {p.originalSelection}</b> — AI moved it to{' '}
              <b>{p.market}: {p.selection}</b>
            </div>
          )}
          {(p.verdict || p.predictedScore || p.modelAgreement) && (
            <div className="muted" style={{ fontSize: 11 }}>
              {p.verdict && <>verdict <b style={{ color: 'var(--tx-2)' }}>{p.verdict}</b></>}
              {p.predictedScore && <> · score <b style={{ color: 'var(--tx-2)' }}>{p.predictedScore}</b></>}
              {p.modelAgreement && <> · agreement {p.modelAgreement}</>}
              {p.formEdge && <> · form {p.formEdge}</>}
              {p.injuryImpact && p.injuryImpact !== 'None' && <> · injuries {p.injuryImpact}</>}
            </div>
          )}
          {p.reason && <div style={{ fontSize: 11.5, lineHeight: 1.55 }}>{p.reason}</div>}
          {factors.length > 0 && (
            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11, lineHeight: 1.55 }}>
              {factors.map((f, j) => <li key={j} className="muted">{f}</li>)}
            </ul>
          )}
          {p.riskFactor && (
            <div style={{ fontSize: 11, color: 'var(--warn)', lineHeight: 1.55 }}>⚠ {p.riskFactor}</div>
          )}
          {p.bestBet && <div className="muted2" style={{ fontSize: 11, lineHeight: 1.55 }}>Best bet: {p.bestBet}</div>}
          {p.newsAnalysisText && (
            <div className="muted2" style={{ fontSize: 10.5, lineHeight: 1.5 }}>
              News: {p.newsAnalysisText}
            </div>
          )}
          {p.fullAnalysis && (
            <details>
              <summary className="muted2" style={{ fontSize: 10.5, cursor: 'pointer' }}>full analysis</summary>
              <div className="muted" style={{ fontSize: 11, lineHeight: 1.6, marginTop: 4, whiteSpace: 'pre-wrap' }}>{p.fullAnalysis}</div>
            </details>
          )}
        </div>
      )}
    </div>
  )
}

export default function Slate() {
  const [slate, setSlate]       = useState(null)
  const [schedule, setSchedule] = useState(null)
  const [history, setHistory]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [running, setRunning]   = useState(false)
  const [error, setError]       = useState(null)
  const [now, setNow]           = useState(() => Date.now())

  // A countdown that never moves reads as "in 3 hours" an hour later.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [{ data: cur }, { data: hist }] = await Promise.all([
        api.get('/api/betbuilder/auto-slate'),
        api.get('/api/betbuilder/auto-slate/history?limit=25'),
      ])
      if (cur?.schedule) setSchedule(cur.schedule)
      else if (hist?.schedule) setSchedule(hist.schedule)
      setSlate(cur?.slate ? { ...cur.slate, stale: cur.stale } : null)
      setHistory(hist?.slates || [])
      setError(null)
    } catch (e) {
      setError(e.response?.data?.error || e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function runNow() {
    setRunning(true); setError(null)
    try {
      // The same shape the scheduler runs, so "run now" produces what the next automatic run
      // would have — a differently-scoped manual run would make this page misleading.
      await api.post('/api/betbuilder/auto-slate/run', {
        risk: ['low'], limit: 10, analyse: true,
        hoursAhead: schedule?.windowHours || 24,
        buildSlips: true,
        bookSlips: schedule?.booking !== false,
        slipTargets: schedule?.targets,
        slipSafestLegs: schedule?.safestLegs,
      }, { timeout: 20 * 60 * 1000 })
      await load()
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Run failed.')
    } finally {
      setRunning(false)
    }
  }

  const slips = slate?.autoSlips || []
  const changedCount = (slate?.picks || []).filter(p =>
    p.originalMarket && (p.originalMarket !== p.market || p.originalSelection !== p.selection)).length

  return (
    <AppShell>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 4 }}>
        <h1 style={{ fontSize: 19, margin: 0 }}>🗓 Slate</h1>
        <span className="muted2" style={{ fontSize: 11.5 }}>
          What the scheduler built, the tickets it booked, and when it runs again.
        </span>
        <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={runNow} disabled={running}>
          {running ? <><span className="spin" /> Running…</> : '▶ Run now'}
        </button>
        <button className="btn" onClick={load} disabled={loading || running}>↻ Refresh</button>
      </div>

      {/* ── Schedule ── */}
      {schedule && (
        <div className="card card-pad" style={{ marginBottom: 14, display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          {schedule.enabled ? (
            <>
              <div>
                <div className="eyebrow">Next run</div>
                <div style={{ fontSize: 17, fontWeight: 800 }}>{until(schedule.nextRunAt, now)}</div>
                <div className="muted2" style={{ fontSize: 10.5 }}>{clock(schedule.nextRunAt)} · every {schedule.everyHours}h</div>
              </div>
              <div>
                <div className="eyebrow">Fixture window</div>
                <div style={{ fontSize: 17, fontWeight: 800 }}>next {schedule.windowHours}h</div>
                <div className="muted2" style={{ fontSize: 10.5 }}>rolling from the moment it runs</div>
              </div>
              <div>
                <div className="eyebrow">Tickets</div>
                <div style={{ fontSize: 17, fontWeight: 800 }}>
                  {[...(schedule.targets || []).map(t => `${t}x`), ...(schedule.safestLegs || []).map(n => `${n} legs`)].join(' · ') || '—'}
                </div>
                <div className="muted2" style={{ fontSize: 10.5 }}>
                  {schedule.booking ? 'booked automatically' : 'built, not booked'}
                </div>
              </div>
            </>
          ) : (
            <span className="muted" style={{ fontSize: 12 }}>
              The automatic slate is switched off (AUTO_SLATE=off). “Run now” still works.
            </span>
          )}
        </div>
      )}

      {error && (
        <div style={{
          fontSize: 12.5, color: 'var(--neg)', marginBottom: 12, lineHeight: 1.55,
          background: 'var(--neg-soft)', border: '1px solid var(--neg-dim)',
          borderRadius: 'var(--r-sm)', padding: '9px 12px',
        }}>{error}</div>
      )}

      {/* ── Current slate ── */}
      {loading && !slate ? (
        <div className="muted" style={{ fontSize: 12 }}>Loading…</div>
      ) : !slate ? (
        <div className="card card-pad muted" style={{ fontSize: 12 }}>
          No slate stored yet. Run one, or wait for the next scheduled build.
        </div>
      ) : (
        <>
          <div className="card card-pad" style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'baseline', marginBottom: 10 }}>
              <b style={{ fontSize: 13 }}>{dayLabel(slate.day)} · {slate.picks?.length || 0} picks</b>
              <span className="muted" style={{ fontSize: 11.5 }}>
                {slate.risk?.join('/')} risk · built {clock(slate.builtAt)}
                {slate.windowHours ? ` · ${slate.windowHours}h window` : ''}
                {slate.analysed ? ` · ${slate.analysed} AI-analysed` : ' · not AI-analysed'}
                {slate.sportybet?.available != null && ` · ${slate.sportybet.available} on SportyBet`}
                {slate.stale ? ` · ${slate.stale} already kicked off` : ''}
              </span>
              {slate.aiError && (
                <span style={{ fontSize: 11, color: 'var(--warn)' }}>⚠ AI pass failed: {slate.aiError}</span>
              )}
            </div>

            {slips.length > 0 ? (
              <>
                <div className="eyebrow" style={{ marginBottom: 7 }}>
                  Tickets{slate.autoSlipsAt ? ` · built ${clock(slate.autoSlipsAt)}` : ''}
                </div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {slips.map((s, i) => <Ticket key={i} slip={s} />)}
                </div>
              </>
            ) : (
              <div className="muted2" style={{ fontSize: 11.5 }}>
                No tickets were built for this slate — it predates automatic ticket building, or
                the run was told not to.
              </div>
            )}
          </div>

          {/* The picks themselves. This is the AI-analysed ten the leg-count ticket is drawn from,
              so it belongs next to the tickets rather than a page away — and the AI's reasoning
              belongs with the pick rather than being written to the database and never read. */}
          {!!slate.picks?.length && (
            <div className="card card-pad" style={{ marginBottom: 14 }}>
              <div className="eyebrow" style={{ marginBottom: 7 }}>
                The {slate.picks.length} picks
                {changedCount > 0 && (
                  <span className="muted2" style={{ textTransform: 'none', letterSpacing: 0, marginLeft: 8 }}>
                    — the AI moved <b style={{ color: 'var(--warn)' }}>{changedCount}</b> of them to a different market
                  </span>
                )}
              </div>
              {slate.picks.map((p, i) => <PickRow key={i} p={p} />)}
              <div className="muted2" style={{ fontSize: 10.5, marginTop: 8, lineHeight: 1.5 }}>
                Click a pick to read what the AI said about it. “was …” marks a pick the AI moved
                off the engine's own market — the market shown is the one the tickets were built
                from.
              </div>
            </div>
          )}
        </>
      )}

      {/* ── History ── */}
      {history.length > 0 && (
        <div className="card card-pad">
          <div className="eyebrow" style={{ marginBottom: 8 }}>Recent runs</div>
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl" style={{ fontSize: 11.5, minWidth: 720 }}>
              <thead><tr>
                <th>Built</th><th>Day</th><th className="num">Picks</th><th className="num">AI</th>
                <th className="num">Scanned</th><th className="num">Gate</th><th>Tickets</th>
              </tr></thead>
              <tbody>
                {history.map(h => (
                  <tr key={h.id}>
                    <td className="muted2">{dayLabel(h.builtAt)} {clock(h.builtAt)}</td>
                    <td>{h.day}{h.windowHours ? ` (${h.windowHours}h)` : ''}</td>
                    <td className="num" style={{ fontWeight: 700 }}>{h.picks}</td>
                    <td className="num" style={{ color: h.analysed ? 'var(--pos)' : 'var(--tx-4)' }}>{h.analysed || '—'}</td>
                    <td className="num muted2">{h.fixturesScanned ?? '—'}</td>
                    <td className="num muted2">{h.passedGate ?? '—'}</td>
                    <td>
                      {h.autoSlips?.length ? (
                        <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          {h.autoSlips.map((s, i) => (
                            <span key={i} style={{ fontSize: 10.5, color: s.ok ? 'var(--tx-2)' : 'var(--tx-4)' }}>
                              {s.label}: {s.ok ? `${s.totalOdds}x` : 'failed'}
                              {s.code && <code style={{ marginLeft: 4, color: 'var(--warn)', fontFamily: 'var(--mono)' }}>{s.code}</code>}
                            </span>
                          ))}
                        </span>
                      ) : <span className="muted2" style={{ fontSize: 10.5 }}>none</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </AppShell>
  )
}
