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
        <span className="muted2" style={{ fontSize: 11, marginLeft: 'auto' }}>booked {when(s.createdAt)}</span>
        <span className="muted2" style={{ fontSize: 10 }}>{open ? '▲' : '▼'}</span>
      </div>

      {open && (
        <div className="leg-list tight" style={{ borderTop: '1px solid var(--line-soft)', border: 'none', borderRadius: 0 }}>
          {s.legs.map((l, i) => {
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
                  </span>
                </div>
                <span className="num muted" style={{ fontSize: 11.5 }}>
                  {l.actual?.goalsHome != null ? `${l.actual.goalsHome}–${l.actual.goalsAway}` : ''}
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
  const [addCode, setAddCode]   = useState('')
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState(null)

  const load = useCallback(async (src = source) => {
    setLoading(true); setError(null)
    try {
      const { data } = await api.get('/api/betbuilder/slips', {
        params: { limit: 100, ...(src ? { source: src } : {}) },
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
  const slips = data?.slips || []

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
        <button className="btn btn-sm" onClick={() => load(source)} disabled={loading}>
          {loading ? <span className="spin" /> : '↻'} Refresh
        </button>
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
          <div className="empty-title">No booking codes yet</div>
          <div className="empty-sub">Build one with Smart Pick, or select picks and generate a SportyBet code.</div>
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
