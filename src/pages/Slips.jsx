import { useEffect, useState, useCallback } from 'react'
import api, { API_BASE } from '../api'
import AppShell from '../components/AppShell'

/**
 * Every SportyBet code this app has handed out, and whether it landed.
 *
 * Codes used to be shown once and then exist only in the user's betting history, so there was
 * no way to ask whether the slips actually worked — which is the only question that matters for
 * tuning the thing that builds them. Both sources are here: Smart Pick's target-odds slips and
 * hand-assembled ones from the picks table.
 *
 * The market table at the bottom is the training signal: per market and selection, how often the
 * leg landed against how often it claimed it would.
 */

const STATUS = {
  won:     { tone: 'pos',  label: 'Won' },
  lost:    { tone: 'neg',  label: 'Lost' },
  pending: { tone: 'info', label: 'Pending' },
  void:    { tone: null,   label: 'Void' },
}

const SOURCE_LABEL = { 'smart-pick': 'Smart Pick', manual: 'Manual', imported: 'Imported' }

const pct = v => (v == null ? '—' : `${(v * 100).toFixed(v < 0.1 && v > 0 ? 1 : 0)}%`)
/** An imported slip can arrive with a leg SportyBet no longer prices, leaving no total. */
const odds = v => (v > 0 ? `${v}x` : '—')
const when = d => (d ? new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '')
/** Kickoff, shown per leg: day + time when it is not today, just the time when it is. */
const kickoff = d => {
  if (!d) return null
  const t = new Date(d)
  if (isNaN(t)) return null
  const today = new Date()
  const sameDay = t.toDateString() === today.toDateString()
  return t.toLocaleString('en-GB', sameDay
    ? { hour: '2-digit', minute: '2-digit' }
    : { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function SlipRow({ s }) {
  const [open, setOpen] = useState(false)
  const st = STATUS[s.status] || STATUS.pending
  return (
    <div className="card" style={{ borderColor: st.tone ? `var(--${st.tone}-dim)` : 'var(--line)' }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', cursor: 'pointer', flexWrap: 'wrap' }}
      >
        <code className="mono" style={{ fontSize: 14, fontWeight: 700, color: 'var(--info)' }}>{s.code}</code>
        <span className={`pill${st.tone ? ` pill-${st.tone}` : ''}`}>{st.label}</span>
        <span className="pill">{SOURCE_LABEL[s.source] || s.source}</span>

        <span className="num" style={{ fontSize: 13, fontWeight: 800, color: 'var(--warn)' }}>{odds(s.totalOdds)}</span>
        <span className="muted" style={{ fontSize: 12 }}>{s.legs.length} legs</span>

        {/* How far through the slip is — the useful number while it is still running. */}
        <span className="muted" style={{ fontSize: 12 }}>
          <span style={{ color: 'var(--pos)' }}>{s.legsWon}✓</span>
          {s.legsLost > 0 && <span style={{ color: 'var(--neg)' }}> {s.legsLost}✗</span>}
          {s.legsPending > 0 && <span className="muted2"> {s.legsPending} to play</span>}
        </span>

        {s.winProb != null && (
          <span className="muted2" style={{ fontSize: 11.5 }} title="What the model said the chance of all legs landing was, at build time">
            claimed {pct(s.winProb)}
          </span>
        )}
        {(() => {
          const ks = s.legs.map(l => l.kickoff).filter(Boolean).map(d => new Date(d)).sort((a, b) => a - b)
          if (!ks.length) return null
          const first = ks[0], last = ks[ks.length - 1]
          const spansDays = first.toDateString() !== last.toDateString()
          return (
            <span className="muted2" style={{ fontSize: 11 }} title={`First kickoff ${when(first)}${spansDays ? ` · last ${when(last)}` : ''}`}>
              ⏱ {kickoff(first)}{spansDays ? ` → ${kickoff(last)}` : ''}
            </span>
          )
        })()}
        {/* A slip with a match in progress is the one you want to open, so it says so without
            being expanded. */}
        {s.liveLegs > 0 && (
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--neg)', display: 'inline-flex', alignItems: 'center', gap: 4 }}
            title={`${s.liveLegs} of this slip's matches ${s.liveLegs === 1 ? 'is' : 'are'} being played right now`}>
            <span className="live-dot" />{s.liveLegs} live
          </span>
        )}
        <span className="muted2" style={{ fontSize: 11, marginLeft: 'auto' }}>booked {when(s.createdAt)}</span>
        <span className="muted2" style={{ fontSize: 10 }}>{open ? '▲' : '▼'}</span>
      </div>

      {open && (
        <div className="leg-list tight" style={{ borderTop: '1px solid var(--line-soft)', border: 'none', borderRadius: 0 }}>
          {/* By kickoff, not by booking order. A slip is read as a running order — what starts
              first, what you are waiting on — and SportyBet's own leg order carries none of that.
              Legs with no kickoff sink to the bottom rather than jumping to the front. */}
          {[...s.legs]
            .sort((a, b) => (a.kickoff ? new Date(a.kickoff) : Infinity) - (b.kickoff ? new Date(b.kickoff) : Infinity))
            .map((l, i) => {
            const tone = l.won === true ? 'pos' : l.won === false ? 'neg' : null
            return (
              // Six fixed tracks, and the score cell always renders even when empty — a
              // conditional cell left the row one column short and wrapped the ✓/✗ onto its
              // own line.
              <div key={i} className="leg" style={{ gridTemplateColumns: '22px minmax(0,1fr) auto auto auto 16px' }}>
                <span className="n">{i + 1}</span>
                <div className="stack">
                  <span className="name">{l.match}</span>
                  <span className="pick">
                    {l.market}: {l.selection}
                    {kickoff(l.kickoff) && <span className="muted2"> · {kickoff(l.kickoff)}</span>}
                    {/* Whose choice this leg was. Only shown where the two actually differ —
                        on an auto-slate leg the engine and the AI often pick different markets,
                        and which one got booked is not otherwise recoverable from the slip. */}
                    {l.aiChangedMarket && (
                      <span className="tag tag-warn" style={{ marginLeft: 5, fontSize: 9 }}
                        title={`Engine picked ${l.engineChoice.market}: ${l.engineChoice.selection} — the AI moved it to ${l.aiChoice.market}: ${l.aiChoice.selection}`}>
                        AI moved
                      </span>
                    )}
                    {l.ai?.verdict && (
                      <span className="muted2" style={{ marginLeft: 5, fontSize: 10 }}
                        title={[
                          `AI verdict: ${l.ai.verdict}${l.ai.confidence ? ` (${l.ai.confidence} confidence)` : ''}`,
                          l.ai.predictedScore ? `predicted ${l.ai.predictedScore}` : null,
                          l.ai.modelAgreement ? `model agreement: ${l.ai.modelAgreement}` : null,
                          l.ai.formEdge ? `form edge: ${l.ai.formEdge}` : null,
                          l.ai.injuryImpact && l.ai.injuryImpact !== 'None' ? `injuries: ${l.ai.injuryImpact}` : null,
                          l.ai.bestBet ? `\nbest bet: ${l.ai.bestBet}` : null,
                          l.ai.riskFactor ? `\nrisk: ${l.ai.riskFactor}` : null,
                          ...(l.ai.keyFactors || []).map(f => `\n• ${f}`),
                        ].filter(Boolean).join(' · ')}>
                        🤖 {l.ai.verdict}{l.ai.confidence ? ` · ${l.ai.confidence}` : ''}
                      </span>
                    )}
                  </span>
                </div>
                {/* Score. A settled leg shows its stored final; an unsettled one shows whatever
                    the fixture is doing right now, which is the only thing worth looking at while
                    a slip is running. `actual` is written at settlement, so before that it is
                    empty and this cell used to sit blank through the entire match. */}
                <span className="num" style={{ fontSize: 11.5, whiteSpace: 'nowrap' }}>
                  {l.actual?.goalsHome != null ? (
                    <span className="muted">{l.actual.goalsHome}–{l.actual.goalsAway}</span>
                  ) : l.live?.status === 'live' ? (
                    <span style={{ color: 'var(--neg)', fontWeight: 800 }}
                      title={`Live${l.live.elapsed != null ? ` — ${l.live.elapsed} minutes played` : ''}`}>
                      <span className="live-dot" />
                      {l.live.goalsHome ?? 0}–{l.live.goalsAway ?? 0}
                      {l.live.elapsed != null && <span className="muted2" style={{ fontWeight: 600 }}> {l.live.elapsed}'</span>}
                    </span>
                  ) : l.live?.status === 'finished' && l.live.goalsHome != null ? (
                    // Played but not yet graded — settlement runs on its own cycle, and "2–1,
                    // waiting to be graded" is a different state from "not started".
                    <span className="muted" title="Finished — not graded yet">
                      {l.live.goalsHome}–{l.live.goalsAway}
                    </span>
                  ) : ''}
                </span>
                <span className="p" style={{ color: 'var(--tx-3)' }}>{pct(l.modelProb)}</span>
                <span className="o">{odds(l.odds)}</span>
                <span
                  style={{ fontSize: 13, fontWeight: 800, textAlign: 'right', color: tone ? `var(--${tone})` : 'var(--tx-4)' }}
                  title={l.resultSource === 'sportybet' ? "SportyBet's own settled result"
                    : l.resultSource === 'model' ? 'Graded from the stored final score'
                    : 'Not settled yet'}
                >
                  {l.won === true ? '✓' : l.won === false ? '✗' : '·'}
                </span>
              </div>
            )
          })}
          {/* What the AI said, spelled out. The tooltip above is fine for a glance, but "the engine
              wanted Over 1.5 and the AI booked a Double Chance instead" is the kind of thing you
              want to be able to read back after the slip settles — it is the only record of why
              the leg is what it is. Auto-slate slips always carry this; hand-built ones only do
              where the fixture also appeared on a slate. */}
          {s.legs.some(l => l.ai || l.aiChangedMarket) && (
            <details style={{ padding: '8px 14px', borderTop: '1px solid var(--line-soft)' }}>
              <summary className="muted2" style={{ fontSize: 11, cursor: 'pointer' }}>
                🤖 AI analysis
                {(() => {
                  const moved = s.legs.filter(l => l.aiChangedMarket).length
                  return moved ? ` — moved ${moved} of ${s.legs.length} legs to a different market` : ''
                })()}
              </summary>
              <div style={{ marginTop: 7, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[...s.legs]
                  .sort((a, b) => (a.kickoff ? new Date(a.kickoff) : Infinity) - (b.kickoff ? new Date(b.kickoff) : Infinity))
                  .filter(l => l.ai || l.aiChangedMarket)
                  .map((l, i) => (
                    <div key={i} style={{ fontSize: 11, lineHeight: 1.55, borderLeft: '2px solid var(--line)', paddingLeft: 9 }}>
                      <div style={{ fontWeight: 600 }}>{l.match}</div>
                      {/* Three opinions, not two — and they are genuinely different steps.
                          The engine scores every market on the fixture and picks one; the AI
                          re-reads the fixture and may pick another; then the ticket builder picks
                          a THIRD, because it is choosing the leg that best serves the slip's
                          target under the Over 1.5 lean, not the leg that is best on its own.
                          Showing only the first two next to a booked leg that matches neither is
                          how you end up mistrusting all three. */}
                      {l.engineChoice && (
                        <div className="muted">
                          model: <span style={{ color: 'var(--tx-2)' }}>{l.engineChoice.market}: {l.engineChoice.selection}</span>
                          {' → '}
                          AI: <span style={{ color: l.aiChangedMarket ? 'var(--warn)' : 'var(--tx-2)' }}>
                            {l.aiChoice.market}: {l.aiChoice.selection}
                          </span>
                          {!l.aiChangedMarket && <span className="muted2"> (unchanged)</span>}
                        </div>
                      )}
                      {l.aiChoice && (l.aiChoice.market !== l.market || l.aiChoice.selection !== l.selection) && (
                        <div style={{ color: 'var(--info)' }}>
                          booked: <b>{l.market}: {l.selection}</b>
                          <span className="muted2"> — the slip builder chose this over the AI's, to fit the target price</span>
                        </div>
                      )}
                      {l.ai?.verdict && (
                        <div className="muted">
                          verdict <b style={{ color: 'var(--tx-2)' }}>{l.ai.verdict}</b>
                          {l.ai.confidence && ` (${l.ai.confidence})`}
                          {l.ai.predictedScore && ` · score ${l.ai.predictedScore}`}
                          {l.ai.modelAgreement && ` · agreement ${l.ai.modelAgreement}`}
                        </div>
                      )}
                      {l.ai?.bestBet && <div className="muted2">best bet: {l.ai.bestBet}</div>}
                      {l.ai?.riskFactor && <div style={{ color: 'var(--warn)' }}>⚠ {l.ai.riskFactor}</div>}
                      {(l.ai?.keyFactors || []).length > 0 && (
                        <ul style={{ margin: '3px 0 0', paddingLeft: 15 }}>
                          {l.ai.keyFactors.map((f, j) => <li key={j} className="muted2">{f}</li>)}
                        </ul>
                      )}
                    </div>
                  ))}
              </div>
            </details>
          )}

          <div className="toolbar" style={{ padding: '10px 14px', borderTop: '1px solid var(--line-soft)' }}>
            <button className="btn btn-sm" onClick={() => navigator.clipboard?.writeText(s.code)}>Copy code</button>
            {s.shareUrl && <a className="btn btn-sm btn-info" href={s.shareUrl} target="_blank" rel="noreferrer">Open on SportyBet ↗</a>}
            {s.targetOdds && <span className="muted2" style={{ fontSize: 11 }}>target was {s.targetOdds}x</span>}
            {s.settledAt && <span className="muted2" style={{ fontSize: 11 }}>settled {when(s.settledAt)}</span>}
          </div>
        </div>
      )}
    </div>
  )
}

export default function Slips() {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [settling, setSettling] = useState(false)
  const [error, setError]     = useState(null)
  const [source, setSource]   = useState('')
  // Pending by default. A booked slip is only actionable before it settles — the won and lost
  // ones are a record, and opening the page on "All" buried today's live tickets under weeks of
  // history. "All" is one click away.
  const [status, setStatus]   = useState('pending')
  const [addCode, setAddCode]   = useState('')
  // How many to fetch. The hourly slate books five tickets a run, so the list grows by ~120 a
  // day and any fixed number becomes a wall — "Show more" raises it rather than capping the
  // record at whatever seemed generous when this was written.
  const [limit, setLimit]         = useState(200)
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState(null)

  // `quiet` skips the spinner. The live refresh below uses it: a list that flashes "Loading…"
  // every minute is unreadable, and the whole point of the refresh is that you are sitting
  // watching it.
  const load = useCallback(async (src = source, { quiet = false, take = limit } = {}) => {
    if (!quiet) setLoading(true)
    setError(null)
    try {
      const { data } = await api.get('/api/betbuilder/slips', {
        params: { limit: take, ...(src ? { source: src } : {}) },
        timeout: 2 * 60 * 1000,
      })
      setData(data)
    } catch (err) {
      setError(err.response?.data?.error || err.message)
    } finally {
      setLoading(false)
    }
  }, [source])

  useEffect(() => { load(source) }, [source, load])

  function showMore() {
    const next = limit + 300
    setLimit(next)
    load(source, { take: next })
  }

  // Poll while a match is in progress, and only then.
  //
  // The live scores come from the fixture sync, which updates every minute, so anything faster
  // is asking the database for the same answer. Anything at all when nothing is live would be
  // asking it for no reason — so the interval exists only while at least one leg is being
  // played, and stops on its own when the last one finishes.
  const anyLive = (data?.slips || []).some(s => s.liveLegs > 0)
  useEffect(() => {
    if (!anyLive) return
    const t = setInterval(() => load(source, { quiet: true }), 60_000)
    return () => clearInterval(t)
  }, [anyLive, source, load])

  async function importCode() {
    const code = addCode.trim()
    if (!code) return
    setImporting(true); setImportMsg(null)
    try {
      const { data } = await api.post('/api/betbuilder/slips/import', { code }, { timeout: 2 * 60 * 1000 })
      if (data.alreadyTracked) {
        setImportMsg({ ok: true, text: `${data.code} is already being tracked.` })
      } else {
        // Say plainly how much of the slip can actually be settled — a code whose legs are all
        // unmatched will sit at "pending" forever, and that should not look like success.
        setImportMsg({
          ok: data.gradeable > 0,
          text: data.gradeable === data.legs
            ? `Tracking ${data.code} — all ${data.legs} legs can be settled.`
            : `Tracking ${data.code} — ${data.gradeable} of ${data.legs} legs can be settled. The rest will stay unresolved:`,
          unmapped: data.unmapped,
        })
      }
      setAddCode('')
      await load(source)
    } catch (err) {
      setImportMsg({ ok: false, text: err.response?.data?.error || err.message })
    } finally {
      setImporting(false)
    }
  }

  async function resettle() {
    setSettling(true)
    try {
      await api.post('/api/betbuilder/slips/settle', { days: 90, force: true }, { timeout: 2 * 60 * 1000 })
      await load(source)
    } catch (err) {
      setError(err.response?.data?.error || err.message)
    } finally {
      setSettling(false)
    }
  }

  const st = data?.stats
  const allSlips = data?.slips || []

  // Status is a view filter, applied here rather than server-side on purpose: `source` changes
  // which slips the headline stats are computed over (Smart Pick's win rate versus manual is a
  // real question), but narrowing to "Won" and then reporting a 100% win rate would be nonsense.
  // So the tiles above keep describing the whole source-filtered set whatever is selected here.
  const counts = allSlips.reduce((a, sl) => { a[sl.status] = (a[sl.status] || 0) + 1; return a }, {})
  // Live slips first, then by kickoff, then newest booked.
  //
  // Sorting on `liveLegs` alone is not enough: within the pending list the useful order is "what
  // is happening now, then what is about to". A slip booked yesterday whose matches start in an
  // hour matters more than one booked this morning for tomorrow night.
  const kickoffs = sl => (sl.legs || []).map(l => l.kickoff).filter(Boolean).map(d => new Date(d).getTime())
  const firstKickoff = sl => { const ks = kickoffs(sl); return ks.length ? Math.min(...ks) : Infinity }
  const lastKickoff  = sl => { const ks = kickoffs(sl); return ks.length ? Math.max(...ks) : 0 }
  /**
   * The next leg still to start. Infinity once every leg has kicked off.
   *
   * Deliberately not the FIRST kickoff, which is what this used at first and got wrong: a slip
   * whose opener began twenty minutes ago but has six more legs tonight was being classed as
   * "stuck" alongside one whose matches all finished last week. What matters is whether anything
   * is still to come.
   */
  const nextKickoff = sl => {
    const ks = kickoffs(sl).filter(t => t >= Date.now())
    return ks.length ? Math.min(...ks) : Infinity
  }
  // Rank within the pending group: live now, then starting soonest, then stuck.
  //
  // "Stuck" is the case worth separating out — a pending slip whose matches all finished days ago
  // is not upcoming, it is ungraded, and sorting purely by kickoff floated a slip from 08-28
  // above tonight's tickets. It still belongs on the page (a slip stuck at pending forever should
  // not look like success) but it belongs at the bottom of the group, not the top.
  const rank = sl => {
    if (sl.liveLegs > 0) return 0                    // being played now
    if (nextKickoff(sl) !== Infinity) return 1       // something still to come
    return 2                                         // every leg started, still ungraded
  }
  const slips = (status ? allSlips.filter(sl => sl.status === status) : allSlips)
    .slice()
    .sort((a, b) => {
      const aP = a.status === 'pending', bP = b.status === 'pending'
      if (aP !== bP) return aP ? -1 : 1
      if (aP) {
        const ra = rank(a), rb = rank(b)
        if (ra !== rb) return ra - rb
        // Live: most matches in play first, then whichever has the next leg starting soonest.
        if (ra === 0) {
          if ((b.liveLegs || 0) !== (a.liveLegs || 0)) return (b.liveLegs || 0) - (a.liveLegs || 0)
          return nextKickoff(a) - nextKickoff(b)
        }
        if (ra === 1) return nextKickoff(a) - nextKickoff(b)     // starting soonest
        return lastKickoff(b) - lastKickoff(a)                   // most recently stuck first
      }
      // Settled slips: by kickoff too, most recent first. Booking date was the old order and it
      // is the wrong one for a record — a slip booked on Monday for Saturday's card sat above one
      // booked Friday for Friday, so the list did not read as a timeline of what was played.
      // Falls back to the booking date only when a slip carries no kickoff at all.
      const ka = firstKickoff(a), kb = firstKickoff(b)
      if (ka !== kb && ka !== Infinity && kb !== Infinity) return kb - ka
      return new Date(b.createdAt) - new Date(a.createdAt)
    })

  return (
    <AppShell
      title="Booked slips"
      subtitle="Every SportyBet code generated, and whether it landed"
      actions={
        <>
          <a className="btn btn-sm hide-sm" href={`${API_BASE}/api/betbuilder/slips/export?format=csv`}
             title="One row per graded leg — what was claimed, what it was priced at, and what happened">
            Export CSV
          </a>
          <button className="btn btn-sm btn-accent" onClick={resettle} disabled={settling}>
            {settling ? <><span className="spin" /> Settling…</> : 'Re-settle all'}
          </button>
        </>
      }
    >
      {/* Headline: did they land as often as they said they would? */}
      <div className="stat-grid" style={{ marginBottom: 18 }}>
        <div className="stat">
          <div className="stat-label">Codes generated</div>
          <div className="stat-value">{st?.total ?? '—'}</div>
          <div className="stat-foot">{st?.pending ?? 0} still running</div>
        </div>
        <div className="stat">
          <div className="stat-label">Settled</div>
          <div className="stat-value">{st?.settled ?? '—'}</div>
          <div className="stat-foot">
            <span style={{ color: 'var(--pos)' }}>{st?.won ?? 0} won</span> · <span style={{ color: 'var(--neg)' }}>{st?.lost ?? 0} lost</span>
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Actual win rate</div>
          <div className="stat-value num" style={{ color: st?.actualWinRate != null ? 'var(--pos)' : undefined }}>
            {pct(st?.actualWinRate)}
          </div>
          <div className="stat-foot">of {st?.settled ?? 0} finished slips</div>
        </div>
        <div
          className="stat"
          title="Average of what the model said each slip's chance was, at the time it was built. Compare it with the actual rate to the left — that gap is the thing worth watching."
        >
          <div className="stat-label">Claimed win rate</div>
          <div className="stat-value num" style={{ color: 'var(--warn)' }}>{pct(st?.claimedWinRate)}</div>
          <div className="stat-foot">
            {st?.claimedFrom ? `across ${st.claimedFrom} slips that stated one` : 'no slip stated one yet'}
          </div>
        </div>
      </div>

      {/* A handful of slips cannot separate a good model from a lucky one — say so rather than
          letting two wins out of three read as a 67% strike rate. */}
      {st?.settled > 0 && st.settled < 20 && (
        <div className="card card-pad" style={{ marginBottom: 18, borderColor: 'var(--info-dim)', background: 'var(--info-soft)', fontSize: 12.5, color: 'var(--info)', lineHeight: 1.55 }}>
          Only {st.settled} slip{st.settled === 1 ? ' has' : 's have'} finished. That is far too few to
          compare against the claimed rate — expect around 30 before the gap means anything.
        </div>
      )}

      {/* Track a code made anywhere — the SportyBet site, the app, a friend's slip. */}
      <div className="card card-pad" style={{ marginBottom: 14 }}>
        <span className="label">Track an existing code</span>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            className="field"
            value={addCode}
            onChange={e => setAddCode(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && importCode()}
            placeholder="Booking code or share link — e.g. B6REM6"
            style={{ flex: '1 1 240px' }}
            disabled={importing}
          />
          <button className="btn btn-primary" onClick={importCode} disabled={importing || !addCode.trim()}>
            {importing ? <><span className="spin" /> Looking it up…</> : 'Track code'}
          </button>
        </div>
        {importMsg && (
          <div style={{
            marginTop: 10, fontSize: 12.5, lineHeight: 1.55,
            color: importMsg.ok ? 'var(--pos)' : 'var(--neg)',
          }}>
            {importMsg.text}
            {importMsg.unmapped?.length > 0 && (
              <ul style={{ margin: '6px 0 0 16px', color: 'var(--warn)', fontSize: 11.5 }}>
                {importMsg.unmapped.map((u, i) => (
                  <li key={i}>{u.match} — {u.market}: {u.selection} ({u.reason})</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className="toolbar" style={{ marginBottom: 14 }}>
        <div className="seg seg-accent">
          {[['', 'All'], ['smart-pick', 'Smart Pick'], ['manual', 'Manual'], ['imported', 'Imported']].map(([k, l]) => (
            <button key={k} className={source === k ? 'on' : ''} onClick={() => setSource(k)}>{l}</button>
          ))}
        </div>

        {/* Status. Void is only offered when something is actually void, so the control does not
            carry a permanently empty option. */}
        <div className="seg seg-accent">
          {[['', 'All', allSlips.length],
            ['pending', 'Pending', counts.pending || 0],
            ['won', 'Won', counts.won || 0],
            ['lost', 'Lost', counts.lost || 0],
            ...(counts.void ? [['void', 'Void', counts.void]] : [])].map(([k, l, n]) => (
            <button key={k || 'all'} className={status === k ? 'on' : ''} onClick={() => setStatus(k)}>
              {l}
              <span className="muted2" style={{ marginLeft: 5, fontWeight: 600 }}>{n}</span>
            </button>
          ))}
        </div>

        <button className="btn btn-sm" onClick={() => load(source)} disabled={loading}>
          {loading ? <span className="spin" /> : '↻'} Refresh
        </button>
        {data?.total > 0 && (
          <span className="muted2" style={{ fontSize: 11 }}>
            showing {data.returned ?? allSlips.length} of {data.total}
          </span>
        )}
        {data?.total > (data?.returned ?? 0) && (
          <button className="btn btn-sm" onClick={showMore} disabled={loading}>Show more</button>
        )}
      </div>

      {error && (
        <div className="card card-pad" style={{ borderColor: 'var(--neg-dim)', background: 'var(--neg-soft)', color: 'var(--neg)', marginBottom: 16, fontSize: 13 }}>
          {error}
        </div>
      )}

      {loading && !slips.length && (
        <div style={{ display: 'grid', gap: 10 }}>{[0, 1, 2].map(i => <div key={i} className="skel" style={{ height: 58 }} />)}</div>
      )}

      {!loading && !slips.length && (
        <div className="card empty">
          <div className="empty-ico">🎟</div>
          {allSlips.length ? (
            <>
              <div className="empty-title">
                No {STATUS[status]?.label.toLowerCase() || ''} slips{source ? ` from ${SOURCE_LABEL[source]}` : ''}
              </div>
              <div className="empty-sub">{allSlips.length} slip{allSlips.length === 1 ? '' : 's'} match the other filters.</div>
              <button className="btn btn-accent" style={{ marginTop: 16 }} onClick={() => setStatus('')}>Show all</button>
            </>
          ) : (
            <>
              <div className="empty-title">No booking codes yet</div>
              <div className="empty-sub">Build one with Smart Pick, or select picks and generate a SportyBet code.</div>
            </>
          )}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {slips.map(s => <SlipRow key={s.code} s={s} />)}
      </div>

      {/* ── Leg-level performance: the training signal ── */}
      {data?.byMarket?.length > 0 && (
        <div style={{ marginTop: 26 }}>
          <div className="section-head">
            <div>
              <div className="section-title">How each market performed</div>
              <div className="muted" style={{ fontSize: 12.5, marginTop: 3 }}>
                Every graded leg across all booked slips — hit rate against what the model claimed.
              </div>
            </div>
          </div>
          <div className="card">
            <div className="tbl-wrap">
              <table className="tbl" style={{ minWidth: 560 }}>
                <thead>
                  <tr>
                    <th>Market</th>
                    <th className="r">Legs</th>
                    <th className="r">Won</th>
                    <th className="r">Hit rate</th>
                    <th className="r">Claimed</th>
                    <th className="r">Gap</th>
                    <th className="r">Avg odds</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byMarket.map(m => (
                    <tr key={`${m.market}|${m.selection}`}>
                      <td style={{ color: 'var(--tx)' }}>{m.market}: {m.selection}</td>
                      <td className="r">{m.legs}</td>
                      <td className="r">{m.won}</td>
                      <td className="r" style={{ color: 'var(--tx)', fontWeight: 700 }}>{pct(m.hitRate)}</td>
                      <td className="r">{pct(m.meanClaimed)}</td>
                      <td
                        className="r"
                        style={{ color: m.gap == null ? 'var(--tx-4)' : m.gap >= 0 ? 'var(--pos)' : 'var(--neg)', fontWeight: 700 }}
                        title="Hit rate minus claimed probability. Negative means the market promised more than it delivered."
                      >
                        {m.gap == null ? '—' : `${m.gap >= 0 ? '+' : ''}${(m.gap * 100).toFixed(1)}pp`}
                      </td>
                      <td className="r">{m.meanOdds ?? '—'}x</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="muted2" style={{ fontSize: 11, marginTop: 8, lineHeight: 1.5 }}>
            A market with few legs tells you nothing yet. The gap column is only worth acting on
            once a row has a few dozen graded legs behind it.
          </div>
        </div>
      )}
    </AppShell>
  )
}
