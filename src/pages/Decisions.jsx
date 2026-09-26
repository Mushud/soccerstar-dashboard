import { useEffect, useState } from 'react'
import api from '../api'
import AppShell from '../components/AppShell'

/**
 * Decisions — are we choosing well?
 *
 * Wins and losses answer that slowly and badly: an 80% leg loses one time in five by design. The
 * number that answers it quickly is how our PRICE compared with the sharpest market's — Pinnacle's
 * fair price when we booked, and again just before kick-off (closing-line value). Bettors who beat
 * the close are almost always profitable over time; those who do not almost never are.
 *
 * Everything on this page is measured by the server (services/closingLine.js, leagueTrial.js,
 * agreementTrial.js, fetchers/odds.js) except the lab table at the bottom, which is a fixed research
 * result and is labelled as one.
 */
const pct = (v, d = 1) => (v == null ? '—' : `${(v * 100).toFixed(d)}%`)
const pp = v => (v == null ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`)
const tone = v => (v == null ? 'var(--tx-3)' : v > 0.005 ? 'var(--pos)' : v < -0.005 ? 'var(--neg)' : 'var(--tx-2)')
const day = d => (d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '—')

function Row({ name, s }) {
  return (
    <tr>
      <td>{name}</td>
      <td className="num">{s.legs}</td>
      <td className="num">{pct(s.overpaid, 0)}</td>
      <td className="num" style={{ color: tone(s.valueAtBooking), fontWeight: 650 }}>{pp(s.valueAtBooking)}</td>
      <td className="num" style={{ color: tone(s.closingValue), fontWeight: 650 }}>{pp(s.closingValue)}</td>
      <td className="num">{pct(s.beatTheClose, 0)}</td>
      <td className="num" style={{ color: tone(s.lineMove) }}>{s.lineMove == null ? '—' : `${s.lineMove >= 0 ? '+' : ''}${(s.lineMove * 100).toFixed(1)}pt`}</td>
      <td className="num">{s.settled ? `${pct(s.landed, 0)} vs ${pct(s.sharpSaid, 0)}` : '—'}</td>
    </tr>
  )
}

function Table({ title, hint, rows }) {
  const entries = Object.entries(rows || {})
  return (
    <div className="card card-pad" style={{ marginBottom: 16 }}>
      <div className="card-title">{title}</div>
      {hint && <p className="muted2" style={{ fontSize: 12, margin: '4px 0 10px' }}>{hint}</p>}
      {entries.length ? (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th></th><th>Legs</th><th>Beat Pinnacle</th><th>Value at booking</th><th>Closing value</th>
                <th>Beat the close</th><th>Line move</th><th>Landed vs Pinnacle said</th>
              </tr>
            </thead>
            <tbody>{entries.map(([k, s]) => <Row key={k} name={k} s={s} />)}</tbody>
          </table>
        </div>
      ) : <p className="muted" style={{ margin: 0 }}>Nothing measured yet.</p>}
    </div>
  )
}

function Trial({ name, what, trial, keptLabel, restLabel, pick }) {
  const weeks = [...(trial?.weeks || [])].reverse()
  const counted = (trial?.weeks || []).filter(w => w.counts && w.passed !== null)
  const run = (() => { let n = 0; for (const w of [...counted].reverse()) { if (w.passed) n++; else break } return n })()
  const need = trial?.rule?.PASS_TO_ENABLE ?? 3
  return (
    <div className="card card-pad" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div className="card-title" style={{ margin: 0 }}>{name}</div>
        <span className={`pill ${trial?.enabled ? 'pill-pos' : 'pill-info'}`}>{trial?.enabled ? 'ON' : 'off — on trial'}</span>
        {trial && !trial.enabled && <span className="muted2" style={{ fontSize: 12 }}>{run} of {need} passing weeks in a row · started {day(trial.startedAt)}</span>}
      </div>
      <p className="muted2" style={{ fontSize: 12, margin: '6px 0 10px' }}>{what}</p>
      {!trial ? <p className="muted" style={{ margin: 0 }}>Not started yet — the first weekly check runs Monday 03:40 UTC.</p> : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Week</th><th>{keptLabel}</th><th>vs price</th><th>{restLabel}</th><th>vs price</th><th>Verdict</th></tr></thead>
            <tbody>
              {weeks.map(w => {
                const [a, b] = pick(w)
                return (
                  <tr key={w.weekStart} style={{ opacity: w.counts ? 1 : 0.55 }}>
                    <td>{day(w.weekStart)} – {day(w.weekEnd)}{w.counts ? '' : ' · before the trial'}</td>
                    <td className="num">{a?.n ?? 0}</td>
                    <td className="num" style={{ color: tone(a?.edge) }}>{pp(a?.edge)}</td>
                    <td className="num">{b?.n ?? 0}</td>
                    <td className="num" style={{ color: tone(b?.edge) }}>{pp(b?.edge)}</td>
                    <td>{w.passed == null ? <span className="muted2">too few to judge</span>
                      : <span className={`pill ${w.passed ? 'pill-pos' : 'pill-neg'}`}>{w.passed ? 'pass' : 'fail'}</span>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default function Decisions() {
  const [days, setDays] = useState(14)
  const [clv, setClv] = useState(null)
  const [league, setLeague] = useState(null)
  const [agree, setAgree] = useState(null)
  const [sources, setSources] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => {
    setErr(null)
    api.get(`/api/betbuilder/closing-line?days=${days}`).then(r => setClv(r.data)).catch(e => setErr(e.message))
  }, [days])
  useEffect(() => {
    api.get('/api/betbuilder/league-trial').then(r => setLeague(r.data.trial)).catch(() => {})
    api.get('/api/betbuilder/agreement-trial').then(r => setAgree(r.data.trial)).catch(() => {})
    api.get('/api/betbuilder/odds-sources?hours=48').then(r => setSources(r.data)).catch(() => {})
  }, [])

  const o = clv?.overall
  const pin = sources?.books?.find(b => b.book === 'Pinnacle')

  return (
    <AppShell title="Decisions">
      <p className="muted" style={{ maxWidth: 780, marginBottom: 18 }}>
        Are we choosing well? Not "did it win" — an 80% leg loses one time in five by design — but
        <b> did we take a better price than the sharpest market</b>. Every booked leg Pinnacle prices is
        scored twice: against Pinnacle's fair price when we booked, and again just before kick-off.
        Beating the close, sustained, is the most reliable sign of a real edge.
      </p>

      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {[7, 14, 30].map(d => (
          <button key={d} className={`btn btn-sm${days === d ? ' btn-primary' : ''}`} onClick={() => setDays(d)}>Last {d} days</button>
        ))}
      </div>
      {err && <p style={{ color: 'var(--neg)' }}>{err}</p>}

      <div className="stat-grid" style={{ marginBottom: 18 }}>
        <div className="stat">
          <div className="stat-label">Legs measured</div>
          <div className="stat-value">{o?.legs ?? '—'}</div>
          <div className="stat-foot">{o?.withClose ?? 0} with a closing price</div>
        </div>
        <div className="stat">
          <div className="stat-label">Value at booking</div>
          <div className="stat-value" style={{ color: tone(o?.valueAtBooking) }}>{pp(o?.valueAtBooking)}</div>
          <div className="stat-foot">{pct(o?.overpaid, 0)} of legs beat Pinnacle's fair price</div>
        </div>
        <div className="stat">
          <div className="stat-label">Closing value</div>
          <div className="stat-value" style={{ color: tone(o?.closingValue) }}>{pp(o?.closingValue)}</div>
          <div className="stat-foot">{pct(o?.beatTheClose, 0)} beat the close</div>
        </div>
        <div className="stat">
          <div className="stat-label">Odds from Pinnacle</div>
          <div className="stat-value">{pin ? pct(pin.share, 0) : '—'}</div>
          <div className="stat-foot">of {sources?.total ?? 0} predictions, last 48h</div>
        </div>
      </div>

      {o && !o.legs && (
        <div className="card card-pad" style={{ marginBottom: 16 }}>
          <p className="muted" style={{ margin: 0 }}>
            No legs measured yet. Pinnacle's price is stamped on tickets booked from the 2026-09-26 deploy
            onward, and its closing price about 30 minutes before each kick-off — the first numbers appear
            within a day of booking.
          </p>
        </div>
      )}

      <Table title="By price — does SportyBet ever overpay on short legs?"
        hint="Across 48,228 matches a soft book beat Pinnacle's fair price on a market landing 60%+ just 5 times. This is where we find out whether SportyBet is different."
        rows={clv?.byPrice} />
      <Table title="By where the leg came from" rows={clv?.bySource} />
      <Table title="By market" rows={clv?.byMarket} />

      <Trial name="Strong-agreement preference"
        what="When the AI and the model strongly agree, the rollover tries to build the ticket from those legs first, and falls back to every leg if that cannot reach the target. Switches on after 3 passing weeks in a row; off after 2 bad ones."
        trial={agree} keptLabel="Strong legs" restLabel="Other legs" pick={w => [w.strong, w.rest]} />
      <Trial name="League filter"
        what="Refuses leagues whose record says they lose. Switches on only if the legs it keeps beat the price, three new weeks running."
        trial={league} keptLabel="Kept legs" restLabel="Dropped legs" pick={w => [w.kept, w.dropped]} />

      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="card-title">Odds sources, last 48 hours</div>
        <p className="muted2" style={{ fontSize: 12, margin: '4px 0 10px' }}>
          Each market is taken from the sharpest book that prices it — Pinnacle first. Pinnacle prices about half a day's card; the rest falls back in measured order.
        </p>
        {sources?.books?.length ? (
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>Match-result odds from</th><th>Predictions</th><th>Share</th></tr></thead>
            <tbody>{sources.books.map(b => (
              <tr key={b.book}><td style={{ fontWeight: b.book === 'Pinnacle' ? 700 : 400 }}>{b.book}</td><td className="num">{b.predictions}</td><td className="num">{pct(b.share, 0)}</td></tr>
            ))}</tbody>
          </table></div>
        ) : <p className="muted" style={{ margin: 0 }}>No predictions in the window.</p>}
      </div>

      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="card-title">What the lab found — which choice wins</div>
        <p className="muted2" style={{ fontSize: 12, margin: '4px 0 10px' }}>
          Fixed research result, not live: 48,228 matches (football-data.co.uk, 2016–2026), five markets each, priced by Bet365 and judged by Pinnacle's pre-match line.
        </p>
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>Rule for choosing the market</th><th>Won</th><th>Avg price</th><th>Return</th></tr></thead>
          <tbody>
            {[
              ['Safest market (what a safe-leg rollover does)', '59.5%', '1.64', -0.038],
              ['Shortest price', '59.4%', '1.64', -0.040],
              ['Random market', '40.1%', '2.82', -0.069],
              ['Most overpaid vs Pinnacle', '37.8%', '3.18', -0.024],
              ['Most overpaid, only when positive', '25.8%', '4.78', -0.006],
              ['Overpaid by 3%+, else skip (not yet significant)', '22.1%', '6.16', 0.037],
            ].map(([r, w, a, ret]) => (
              <tr key={r}><td>{r}</td><td className="num">{w}</td><td className="num">{a}</td><td className="num" style={{ color: tone(ret), fontWeight: 650 }}>{pp(ret)}</td></tr>
            ))}
          </tbody>
        </table></div>
      </div>
    </AppShell>
  )
}
