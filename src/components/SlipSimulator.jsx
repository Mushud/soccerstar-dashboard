import { useState } from 'react'
import api from '../api'

const pct = n => n != null ? (n * 100).toFixed(1) + '%' : '—'
const sign = n => n == null ? '—' : `${n >= 0 ? '+' : ''}${n}pp`

function daysAgo(n) {
  const d = new Date(); d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

// How the SportyBet filter resolved. This is shown prominently rather than buried because a
// proxy result and a measured one are not the same claim, and the difference is invisible in
// the numbers themselves.
const SB_TONE = {
  'stamped only':          ['var(--pos)',  'Every fixture had a recorded availability check — exact.'],
  'stamped + league proxy':['var(--warn)', 'Recorded checks where they exist, league coverage elsewhere — partly estimated.'],
  'league proxy only':     ['var(--warn)', 'No fixture in this window was ever checked; filtered on league coverage measured today.'],
  'unavailable — not filtered': ['var(--neg)', 'No availability data at all — these slips include fixtures that may never have been bookable.'],
  off:                     ['var(--tx-3)', 'SportyBet filter disabled — every fixture in the database was eligible.'],
}

/**
 * One simulated slip, every leg shown — not only the ones that lost.
 *
 * A slip that went down on a single 49% leg reached for to hit the target teaches something
 * quite different from one beaten by five, and a list of failures alone cannot tell you which
 * you are looking at. The score line is there so each leg can be checked against what happened.
 */
function SlipDetail({ slip, lost, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={{ marginBottom: 6, borderLeft: `2px solid var(--${lost ? 'neg' : 'pos'}-dim)`, paddingLeft: 10 }}>
      <button onClick={() => setOpen(v => !v)}
        style={{ fontSize: 11.5, textAlign: 'left', width: '100%', padding: '2px 0' }}>
        <span className="muted">{slip.day}</span>
        {slip.round > 1 && <span className="muted2"> #{slip.round}</span>} · {slip.legs} legs @{' '}
        <b style={{ color: 'var(--warn)' }}>{slip.odds}x</b>
        {lost
          ? <span style={{ color: 'var(--neg)' }}> · {slip.legsLost} leg{slip.legsLost === 1 ? '' : 's'} lost</span>
          : <span style={{ color: 'var(--pos)' }}> · won</span>}
        <span className="muted2" style={{ marginLeft: 6, fontSize: 10.5 }}>{open ? '▾ hide legs' : '▸ show all legs'}</span>
      </button>
      {open && (
        <div style={{ overflowX: 'auto', margin: '4px 0 8px' }}>
          <table className="tbl" style={{ fontSize: 11, minWidth: 520 }}>
            <thead><tr>
              <th style={{ width: 22 }} /><th>Match</th><th className="num">Result</th>
              <th>Selection</th><th className="num">Odds</th><th className="num">Model</th>
            </tr></thead>
            <tbody>
              {(slip.allLegs || []).map((l, j) => (
                <tr key={j} style={{ opacity: l.won ? 1 : 0.95 }}>
                  <td style={{ color: l.won ? 'var(--pos)' : 'var(--neg)', fontWeight: 800 }}>{l.won ? '✓' : '✗'}</td>
                  <td style={{ color: l.won ? 'var(--tx)' : 'var(--neg)' }}>{l.match}</td>
                  <td className="num mono" style={{ fontWeight: 700 }}>{l.score || '—'}</td>
                  <td className="muted">{l.market}: <span style={{ color: 'var(--tx-2)', fontWeight: 600 }}>{l.selection}</span></td>
                  <td className="num" style={{ color: 'var(--warn)' }}>{l.odds}</td>
                  <td className="num" style={{ color: l.prob >= 0.8 ? 'var(--pos)' : l.prob >= 0.6 ? 'var(--warn)' : 'var(--neg)' }}>
                    {l.prob != null ? (l.prob * 100).toFixed(0) + '%' : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default function SlipSimulator() {
  const [from, setFrom]           = useState(daysAgo(60))
  const [to, setTo]               = useState(daysAgo(0))
  const [targetOdds, setTarget]   = useState(20)
  const [minLegs, setMinLegs]     = useState(8)
  const [maxLegs, setMaxLegs]     = useState(12)
  const [safeOnly, setSafeOnly]   = useState(true)
  const [sbOnly, setSbOnly]       = useState(true)
  const [realOdds, setRealOdds]   = useState(false)
  // One slip a day is what you would actually place, but it caps the sample at one point per
  // matchday — 30 days is far too few to read a win rate off. Extra slips are built from the
  // fixtures the earlier ones did not use, so they are separate bets, not re-cuts of the same one.
  const [perDay, setPerDay]       = useState(1)
  const [running, setRunning]     = useState(false)
  const [sweeping, setSweeping]   = useState(false)
  const [res, setRes]             = useState(null)
  const [sweep, setSweep]         = useState(null)
  const [error, setError]         = useState(null)
  const [slipTab, setSlipTab]     = useState('lost')
  const [label, setLabel]         = useState('')
  const [runs, setRuns]           = useState(null)

  const body = extra => ({
    from, to, targetOdds: Number(targetOdds), minLegs: Number(minLegs), maxLegs: Number(maxLegs),
    safeOnly, sportybetOnly: sbOnly, realOddsOnly: realOdds, slipsPerDay: Number(perDay), label: label || null, ...extra,
  })

  async function run() {
    setRunning(true); setError(null); setRes(null); setSweep(null)
    try {
      const { data } = await api.post('/api/betbuilder/slip-backtest', body(), { timeout: 5 * 60 * 1000 })
      if (!data.ok) setError(data.reason || 'No slips could be built')
      setRes(data.ok ? data : null)
    } catch (e) {
      setError(e.response?.data?.error || e.message)
    } finally { setRunning(false); loadRuns() }
  }

  // Recorded runs. The slips themselves are deliberately not stored — they contain nothing the
  // Pick rows do not already carry — but the run is, so a configuration can be compared against
  // itself after a model change.
  async function loadRuns() {
    try {
      const { data } = await api.get('/api/betbuilder/slip-backtest/runs?limit=15')
      setRuns(data.runs || [])
    } catch { /* history is a convenience, not the result */ }
  }

  // The comparison that actually answers "which settings should I use" — same days, same data,
  // one row per shape of slip.
  async function runSweep() {
    setSweeping(true); setError(null); setRes(null); setSweep(null)
    const shapes = [[2, 3, 2], [3, 4, 3], [4, 5, 5], [6, 8, 10], [8, 12, 20], [10, 15, 50]]
    const out = []
    try {
      for (const [lo, hi, t] of shapes) {
        const { data } = await api.post('/api/betbuilder/slip-backtest',
          body({ minLegs: lo, maxLegs: hi, targetOdds: t }), { timeout: 5 * 60 * 1000 })
        out.push({ label: `${lo}–${hi} legs @ ${t}x`, ...(data.ok ? data : { failed: data.reason }) })
        setSweep([...out])
      }
    } catch (e) {
      setError(e.response?.data?.error || e.message)
    } finally { setSweeping(false) }
  }

  const busy = running || sweeping
  const sb = res?.sportybet
  // Default to the tab that has slips in it. Landing on an empty "Near misses" after a run where
  // everything won made the result look like it had produced nothing at all.
  const tab = (slipTab === 'lost' && !res?.worstDays?.length && res?.wonDays?.length) ? 'won'
            : (slipTab === 'won' && !res?.wonDays?.length && res?.worstDays?.length) ? 'lost'
            : slipTab
  const [sbColor, sbNote] = SB_TONE[sb?.mode] || ['var(--tx-3)', '']

  return (
    <div className="card card-pad" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>🎟 Slip Simulator</span>
        <span className="muted2" style={{ fontSize: 11 }}>
          Replays the real Smart Pick optimiser over settled history and grades the slips it would have built.
        </span>
      </div>

      <div className="toolbar" style={{ margin: '12px 0', flexWrap: 'wrap', gap: 8 }}>
        <label className="muted" style={{ fontSize: 11.5 }}>From
          <input className="field" type="date" value={from} onChange={e => setFrom(e.target.value)}
            style={{ marginLeft: 6, width: 'auto', padding: '4px 8px' }} />
        </label>
        <label className="muted" style={{ fontSize: 11.5 }}>To
          <input className="field" type="date" value={to} onChange={e => setTo(e.target.value)}
            style={{ marginLeft: 6, width: 'auto', padding: '4px 8px' }} />
        </label>
        <label className="muted" style={{ fontSize: 11.5 }}>Target
          <input className="field" type="number" min="1.1" step="0.5" value={targetOdds} onChange={e => setTarget(e.target.value)}
            style={{ marginLeft: 6, width: 78, padding: '4px 8px' }} />
        </label>
        <label className="muted" style={{ fontSize: 11.5 }}
          title="Slips to build per matchday. Each one uses fixtures the previous slips did not, so they are independent bets — more sample without reusing a result.">
          Slips/day
          <select className="field" value={perDay} onChange={e => setPerDay(e.target.value)}
            style={{ marginLeft: 6, width: 'auto', padding: '4px 8px' }}>
            {[1, 3, 5, 10, 20].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label className="muted" style={{ fontSize: 11.5 }}>Legs
          <input className="field" type="number" min="1" max="20" value={minLegs} onChange={e => setMinLegs(e.target.value)}
            style={{ marginLeft: 6, width: 58, padding: '4px 8px' }} />
          <span style={{ margin: '0 4px' }}>–</span>
          <input className="field" type="number" min="1" max="20" value={maxLegs} onChange={e => setMaxLegs(e.target.value)}
            style={{ width: 58, padding: '4px 8px' }} />
        </label>
      </div>

      <div className="toolbar" style={{ marginBottom: 12, flexWrap: 'wrap', gap: 12 }}>
        <label className="muted" style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, cursor: 'pointer' }}
          title="Restrict legs to the safe-market allow-list, exactly as Smart Pick does">
          <input type="checkbox" checked={safeOnly} onChange={e => setSafeOnly(e.target.checked)} /> Safe markets only
        </label>
        <label className="muted" style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, cursor: 'pointer' }}
          title="Drop fixtures SportyBet was not carrying. Exact where an availability check was recorded, league-coverage proxy otherwise.">
          <input type="checkbox" checked={sbOnly} onChange={e => setSbOnly(e.target.checked)} /> SportyBet only
        </label>
        <label className="muted" style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, cursor: 'pointer' }}
          title="Only legs whose price was a real bookmaker quote. Smaller sample, but the odds and the ROI mean something.">
          <input type="checkbox" checked={realOdds} onChange={e => setRealOdds(e.target.checked)} /> Real odds only
        </label>
        <button className="btn btn-primary" onClick={run} disabled={busy}>
          {running ? <><span className="spin" /> Simulating…</> : '▶ Run simulation'}
        </button>
        <input className="field" placeholder="label this run (optional)" value={label}
          onChange={e => setLabel(e.target.value)}
          style={{ width: 210, padding: '5px 8px', fontSize: 11.5 }} />
        <button className="btn" onClick={runSweep} disabled={busy}>
          {sweeping ? <><span className="spin" /> Sweeping…</> : '⚖ Compare slip shapes'}
        </button>
      </div>

      {error && <div style={{ fontSize: 12.5, color: 'var(--neg)', marginBottom: 10 }}>{error}</div>}

      {/* ── Sweep ── */}
      {sweep?.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl" style={{ fontSize: 11.5, minWidth: 640 }}>
            <thead><tr>
              <th>Shape</th><th className="num">Slips</th><th className="num">Won</th>
              <th className="num">Actual</th><th className="num">Claimed</th><th className="num">Gap</th>
              <th className="num">Leg hit</th><th className="num">Mean odds</th><th className="num">ROI*</th>
            </tr></thead>
            <tbody>
              {sweep.map((r, i) => r.failed ? (
                <tr key={i}><td>{r.label}</td><td colSpan={8} className="muted2">{r.failed}</td></tr>
              ) : (
                <tr key={i}>
                  <td style={{ fontWeight: 600 }}>{r.label}</td>
                  <td className="num">{r.slips.n}</td>
                  <td className="num">{r.slips.won}</td>
                  <td className="num" style={{ fontWeight: 700, color: 'var(--pos)' }}>{pct(r.slips.actualWinRate)}</td>
                  <td className="num muted">{pct(r.slips.claimedWinRate)}</td>
                  <td className="num" style={{ color: Math.abs(r.slips.gapPP) <= 3 ? 'var(--pos)' : 'var(--warn)' }}>{sign(r.slips.gapPP)}</td>
                  <td className="num">{pct(r.legs.actualHitRate)}</td>
                  <td className="num" style={{ color: 'var(--warn)' }}>{r.slips.meanOdds}x</td>
                  <td className="num" style={{ color: r.slips.roi >= 0 ? 'var(--pos)' : 'var(--neg)' }}>{r.slips.roi}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Single run ── */}
      {res && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 14 }}>
            {[
              ['Slips built', `${res.slips.won} / ${res.slips.n}`,
                `${res.days.withSlips ?? res.days.built} of ${res.days.considered} days` +
                (res.config?.slipsPerDay > 1 ? ` · ${res.config.slipsPerDay}/day` : '')],
              ['Actual win rate', pct(res.slips.actualWinRate), `claimed ${pct(res.slips.claimedWinRate)}`],
              // A positive gap means the slips did BETTER than claimed. Calling that "overstated"
              // had it exactly backwards.
              ['Prediction gap', sign(res.slips.gapPP),
                Math.abs(res.slips.gapPP) <= 3 ? 'honest'
                  : res.slips.gapPP > 0 ? 'model was pessimistic' : 'model was optimistic'],
              ['Leg hit rate', pct(res.legs.actualHitRate), `claimed ${pct(res.legs.claimedHitRate)} · ${res.legs.n} legs`],
              ['Mean slip', `${res.slips.meanOdds}x`, `${res.slips.meanLegs} legs`],
              ['ROI*', `${res.slips.roi}%`, 'notional unless real odds'],
            ].map(([k, v, sub]) => (
              <div key={k} className="card" style={{ padding: '10px 12px' }}>
                <div className="eyebrow" style={{ marginBottom: 4 }}>{k}</div>
                <div style={{ fontSize: 19, fontWeight: 700 }}>{v}</div>
                <div className="muted2" style={{ fontSize: 10.5 }}>{sub}</div>
              </div>
            ))}
          </div>

          {res.slips.n < 10 && (
            <div style={{ fontSize: 11, color: 'var(--warn)', marginBottom: 8 }}>
              ⚠ Only {res.slips.n} slip{res.slips.n === 1 ? '' : 's'} was built, so the rates above are
              {res.slips.n === 1 ? ' just that one result — 100% or 0%, nothing in between' : ' very noisy'}.
              Widen the date range before reading anything into the percentages.
            </div>
          )}
          <div style={{ fontSize: 11, color: sbColor, marginBottom: 12 }}>
            🎰 SportyBet filter: <b>{sb.mode}</b> — {sbNote}
            {sb.picksDropped > 0 && ` ${sb.picksDropped} picks dropped, ${sb.stampedFixtures} fixtures had a recorded check.`}
          </div>

          {Object.keys(res.byMarket || {}).length > 0 && (
            <div style={{ overflowX: 'auto', marginBottom: 14 }}>
              <div className="eyebrow" style={{ marginBottom: 6 }}>How each chosen market performed</div>
              <table className="tbl" style={{ fontSize: 11.5, minWidth: 460 }}>
                <thead><tr><th>Market</th><th className="num">Legs</th><th className="num">Landed</th><th className="num">Claimed</th><th className="num">Gap</th></tr></thead>
                <tbody>
                  {Object.entries(res.byMarket).slice(0, 12).map(([k, v]) => (
                    <tr key={k}>
                      <td>{k.replace('|', ': ')}</td>
                      <td className="num">{v.n}</td>
                      <td className="num" style={{ fontWeight: 700 }}>{pct(v.hitRate)}</td>
                      <td className="num muted">{pct(v.claimed)}</td>
                      <td className="num" style={{ color: v.gapPP >= -2 ? 'var(--pos)' : 'var(--neg)' }}>{sign(v.gapPP)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {(res.worstDays?.length > 0 || res.wonDays?.length > 0) && (
            <div>
              <div className="toolbar" style={{ marginBottom: 8, gap: 6 }}>
                <div className="seg">
                  <button className={tab === 'lost' ? 'on' : ''} onClick={() => setSlipTab('lost')}>
                    Near misses ({res.worstDays?.length || 0})
                  </button>
                  <button className={tab === 'won' ? 'on' : ''} onClick={() => setSlipTab('won')}>
                    Winners ({res.wonDays?.length || 0})
                  </button>
                </div>
              </div>
              {((tab === 'lost' ? res.worstDays : res.wonDays) || []).map((d, i) => (
                <SlipDetail key={`${tab}-${i}`} slip={d} lost={tab === 'lost'} defaultOpen={
                  // One slip, nothing to choose between — open it rather than make the user click.
                  ((tab === 'lost' ? res.worstDays : res.wonDays) || []).length === 1
                } />
              ))}
              {!((tab === 'lost' ? res.worstDays : res.wonDays) || []).length && (
                <div className="muted2" style={{ fontSize: 11.5 }}>
                  {tab === 'lost' ? 'No slip lost in this run.' : 'No slip won in this run.'}
                </div>
              )}
            </div>
          )}

          {runs?.length > 1 && (
            <div style={{ overflowX: 'auto', marginTop: 16 }}>
              <div className="eyebrow" style={{ marginBottom: 6 }}>
                Recorded runs — same config, before and after a model change
              </div>
              <table className="tbl" style={{ fontSize: 11, minWidth: 620 }}>
                <thead><tr>
                  <th>When</th><th>Label</th><th className="num">Shape</th>
                  <th className="num">Slips</th><th className="num">Actual</th>
                  <th className="num">Claimed</th><th className="num">Leg hit</th><th className="num">Markets</th>
                </tr></thead>
                <tbody>
                  {runs.map(r => (
                    <tr key={r.id}>
                      <td className="muted">{new Date(r.ranAt).toISOString().slice(5, 16).replace('T', ' ')}</td>
                      <td>{r.label || <span className="muted2">—</span>}</td>
                      <td className="num muted">{r.config.targetOdds}x {r.config.minLegs}–{r.config.maxLegs}</td>
                      <td className="num">{r.slips.won}/{r.slips.n}</td>
                      <td className="num" style={{ fontWeight: 700, color: 'var(--pos)' }}>{pct(r.slips.actualWinRate)}</td>
                      <td className="num muted">{pct(r.slips.claimedWinRate)}</td>
                      <td className="num">{pct(r.legs.actualHitRate)}</td>
                      <td className="num muted2">{r.safeMarketCount ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="muted2" style={{ fontSize: 10.5, marginTop: 6 }}>
                The slips themselves are not stored: their legs come from Pick rows the reliability
                loop already learns from, so keeping them would count the same evidence twice.
                Each row records the configuration and the model it was measured against.
              </div>
            </div>
          )}

          <div className="muted2" style={{ fontSize: 10.5, marginTop: 12, lineHeight: 1.5 }}>
            * ROI is notional unless "Real odds only" is on: about 19% of stored prices are real bookmaker
            quotes and the rest are derived from our own probability, so the returns are circular even though
            the win rates are not — those come from the final score.
          </div>
        </>
      )}
    </div>
  )
}
