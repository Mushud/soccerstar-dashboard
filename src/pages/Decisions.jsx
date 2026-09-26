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

function RuleCard({ rule, onMode, busy }) {
  const [open, setOpen] = useState(false)
  const [la, lb] = rule.labels
  const state = rule.inForce ? 'IN FORCE' : 'off'
  const why = rule.mode !== 'auto'
    ? `held ${rule.mode} by hand`
    : rule.enabled ? 'switched on by its own record' : 'on trial'
  const s = rule.streak
  const toGo = !rule.enabled && s ? (s.passed ? Math.max(0, rule.need.on - s.weeks) : rule.need.on) : rule.need.on
  const latest = rule.weeks.find(w => w.passed != null) || rule.weeks[0]
  return (
    <div className="card card-pad" style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div className="card-title" style={{ margin: 0 }}>{rule.title}</div>
        <span className={`pill ${rule.inForce ? 'pill-pos' : 'pill-info'}`}>{state}</span>
        <span className="muted2" style={{ fontSize: 12 }}>{why}</span>
        <div className="seg" style={{ marginLeft: 'auto' }}>
          {['auto', 'on', 'off'].map(m => (
            <button key={m} className={rule.mode === m ? 'on' : ''} disabled={busy} onClick={() => onMode(rule.key, m)}>
              {m === 'auto' ? 'Auto' : m === 'on' ? 'Force on' : 'Force off'}
            </button>
          ))}
        </div>
      </div>
      <p className="muted" style={{ fontSize: 13, margin: '8px 0 4px' }}>{rule.what}</p>
      <p className="muted2" style={{ fontSize: 12, margin: '0 0 8px' }}>
        Passes a week when {rule.passes}. {rule.enabled
          ? `Switches off after ${rule.need.off} failing weeks in a row.`
          : `Needs ${toGo} more passing week${toGo === 1 ? '' : 's'} in a row to switch on.`}
        {' '}Trial started {day(rule.startedAt)}.
      </p>
      {latest && (
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 13 }}>
          <span>Latest week ({day(latest.weekStart)}): {latest.passed == null ? <span className="muted2">too few to judge</span>
            : <span className={`pill ${latest.passed ? 'pill-pos' : 'pill-neg'}`}>{latest.passed ? 'pass' : 'fail'}</span>}
            {!latest.counts && <span className="muted2"> · before the trial</span>}</span>
          <span>{la}: <b>{latest.a?.n ?? 0}</b> <span style={{ color: tone(latest.a?.edge) }}>{pp(latest.a?.edge)}</span></span>
          <span>{lb}: <b>{latest.b?.n ?? 0}</b> <span style={{ color: tone(latest.b?.edge) }}>{pp(latest.b?.edge)}</span></span>
          {latest.note && <span className="muted2">{latest.note}</span>}
        </div>
      )}
      {rule.weeks.length > 0 && (
        <button className="btn btn-sm" style={{ marginTop: 10 }} onClick={() => setOpen(o => !o)}>{open ? 'Hide' : 'Show'} every week ({rule.weeks.length})</button>
      )}
      {open && (
        <div className="tbl-wrap" style={{ marginTop: 10 }}>
          <table className="tbl">
            <thead><tr><th>Week</th><th>{la}</th><th>vs price</th><th>{lb}</th><th>vs price</th><th>Verdict</th><th></th></tr></thead>
            <tbody>
              {rule.weeks.map(w => (
                <tr key={w.weekStart} style={{ opacity: w.counts ? 1 : 0.55 }}>
                  <td>{day(w.weekStart)} – {day(w.weekEnd)}{w.counts ? '' : ' · reference'}</td>
                  <td className="num">{w.a?.n ?? 0}</td>
                  <td className="num" style={{ color: tone(w.a?.edge) }}>{pp(w.a?.edge)}</td>
                  <td className="num">{w.b?.n ?? 0}</td>
                  <td className="num" style={{ color: tone(w.b?.edge) }}>{pp(w.b?.edge)}</td>
                  <td>{w.passed == null ? <span className="muted2">too few</span>
                    : <span className={`pill ${w.passed ? 'pill-pos' : 'pill-neg'}`}>{w.passed ? 'pass' : 'fail'}</span>}</td>
                  <td className="muted2" style={{ fontSize: 12 }}>{w.note || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Journal({ entries }) {
  const kindPill = { switch: 'pill-warn', override: 'pill-info', error: 'pill-neg', start: 'pill-info', verdict: '' }
  return (
    <div className="card card-pad" style={{ marginBottom: 16 }}>
      <div className="card-title">Journal</div>
      <p className="muted2" style={{ fontSize: 12, margin: '4px 0 10px' }}>What the system decided each Monday, and why, newest first. Switches and hand overrides are marked.</p>
      {entries?.length ? (
        <div style={{ display: 'grid', gap: 8 }}>
          {entries.map((e, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, fontSize: 13, alignItems: 'baseline' }}>
              <span className="muted2 mono" style={{ fontSize: 11.5, whiteSpace: 'nowrap' }}>{day(e.at)}</span>
              {e.kind !== 'verdict' && <span className={`pill ${kindPill[e.kind] || ''}`}>{e.kind}</span>}
              <span>{e.text}</span>
            </div>
          ))}
        </div>
      ) : <p className="muted" style={{ margin: 0 }}>Nothing yet. The first weekly run is Monday 03:40 UTC.</p>}
    </div>
  )
}

function Alerts({ alerts, onSave }) {
  const [text, setText] = useState('')
  useEffect(() => { setText((alerts?.phones || []).join(', ')) }, [alerts])
  return (
    <div className="card card-pad" style={{ marginBottom: 24 }}>
      <div className="card-title">Text me when a rule switches</div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        <input className="field" style={{ flex: 1, minWidth: 220 }} placeholder="233…, 233…" value={text} onChange={e => setText(e.target.value)} />
        <button className="btn btn-sm btn-primary" onClick={() => onSave(text)}>Save</button>
      </div>
      <p className="muted2" style={{ fontSize: 12, margin: '6px 0 0' }}>Up to five numbers. Only switches are texted, never the weekly verdicts.</p>
    </div>
  )
}

function AiModel() {
  const [d, setD] = useState(null)
  const [model, setModel] = useState('')
  const [effort, setEffort] = useState('')
  const [msg, setMsg] = useState(null)
  const load = () => api.get('/api/betbuilder/ai-models').then(r => {
    setD(r.data); setModel(r.data.settings.deep); setEffort(r.data.settings.deepEffort)
  }).catch(e => setMsg(e.message))
  useEffect(() => { load() }, [])
  const save = async () => {
    try { await api.put('/api/betbuilder/ai-models', { deep: model, deepEffort: effort }); setMsg('Saved — the next rollover build uses it.'); load() }
    catch (e) { setMsg(e.response?.data?.error || e.message) }
  }
  const options = d ? [...new Set([...(d.options || []), d.settings.deep])] : []
  return (
    <div className="card card-pad" style={{ marginBottom: 24 }}>
      <div className="card-title">Deep-analysis model</div>
      <p className="muted2" style={{ fontSize: 12, margin: '4px 0 10px' }}>
        The model that reads each leg of a rollover step before it is booked, and how hard it thinks. Changing it
        re-reads a fixture once on the new model. Below it: how the legs each model passed have landed against their price.
      </p>
      {d && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select className="field" value={model} onChange={e => setModel(e.target.value)} style={{ minWidth: 200 }}>
            {options.map(o => <option key={o} value={o}>{o}{o === d.defaults.deep ? ' (default)' : ''}</option>)}
          </select>
          <select className="field" value={effort} onChange={e => setEffort(e.target.value)}>
            {d.efforts.map(o => <option key={o} value={o}>effort: {o}{o === d.defaults.deepEffort ? ' (default)' : ''}</option>)}
          </select>
          <button className="btn btn-sm btn-primary" onClick={save}
            disabled={model === d.settings.deep && effort === d.settings.deepEffort}>Save</button>
          {msg && <span className="muted2" style={{ fontSize: 12 }}>{msg}</span>}
        </div>
      )}
      {d?.record?.length > 0 && (
        <div className="tbl-wrap" style={{ marginTop: 12 }}>
          <table className="tbl">
            <thead><tr><th>Model</th><th>Settled legs</th><th>Landed</th><th>vs price</th></tr></thead>
            <tbody>{d.record.map(r => (
              <tr key={r.model}>
                <td className="mono">{r.model === 'unknown' ? 'not recorded (before 26 Sep)' : r.model}</td>
                <td className="num">{r.n}</td>
                <td className="num">{pct(r.landed, 0)}</td>
                <td className="num" style={{ color: tone(r.edge), fontWeight: 650 }}>{pp(r.edge)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default function Decisions() {
  const [days, setDays] = useState(14)
  const [clv, setClv] = useState(null)
  const [dec, setDec] = useState(null)
  const [busy, setBusy] = useState(false)
  const [sources, setSources] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => {
    setErr(null)
    api.get(`/api/betbuilder/closing-line?days=${days}`).then(r => setClv(r.data)).catch(e => setErr(e.message))
  }, [days])
  useEffect(() => {
    loadDecisions()
    api.get('/api/betbuilder/odds-sources?hours=48').then(r => setSources(r.data)).catch(() => {})
  }, [])

  function loadDecisions() {
    return api.get('/api/betbuilder/decisions').then(r => setDec(r.data)).catch(e => setErr(e.message))
  }
  async function setMode(key, mode) {
    setBusy(true)
    try { await api.put(`/api/betbuilder/decisions/${key}`, { mode }); await loadDecisions() }
    catch (e) { setErr(e.response?.data?.error || e.message) }
    setBusy(false)
  }
  async function saveAlerts(text) {
    try { const r = await api.put('/api/betbuilder/decisions-alerts', { phones: text }); setDec(d => ({ ...d, alerts: r.data })) }
    catch (e) { setErr(e.response?.data?.error || e.message) }
  }

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

      <div className="section-head"><div className="section-title">What the system decided</div></div>
      <p className="muted2" style={{ fontSize: 12.5, maxWidth: 780, margin: '0 0 12px' }}>
        Every rule is judged every Monday on the week just settled, whether it is on or off. Three passing weeks in a row switch
        it on; two failing weeks switch it off. Each one is a preference the build falls back from, so none can starve a chain.
        Force on or off to overrule it; Auto hands it back.
      </p>
      {dec?.rules?.map(r => <RuleCard key={r.key} rule={r} onMode={setMode} busy={busy} />)}
      <Journal entries={dec?.journal} />
      <Alerts alerts={dec?.alerts} onSave={saveAlerts} />
      <AiModel />

      <div className="section-head"><div className="section-title">Are we taking better prices than Pinnacle?</div></div>
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
