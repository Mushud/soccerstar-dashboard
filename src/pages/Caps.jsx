import { useState, useEffect, useCallback } from 'react'
import api from '../api'
import AppShell from '../components/AppShell'

/**
 * The price ceilings a rollover step is cut under — set here, next to what the record says.
 *
 * These were environment variables, and that failed twice. `ROLLOVER_LEG_MAX=12` was set once in
 * the belief it meant twelve legs; and a value out of range was silently discarded, so a chain
 * stalled for hours with the reason sitting in a log nobody reads. Neither is a mistake you can
 * make against a screen that shows you the number, the unit and the evidence side by side.
 *
 * The recommendation is computed from settled legs (services/rolloverCaps.js): walk the price
 * bands upward, take the last one that both has a real sample and still returns EV >= 1. Every
 * band is shown underneath it, because a recommendation you cannot check is just another number
 * somebody has to trust.
 */
const pct = n => (n == null ? '—' : `${(n * 100).toFixed(1)}%`)

/** Colour the EV by the only question that matters: is this price still paying? */
const evTone = ev => (ev == null ? 'var(--tx-3)' : ev >= 1 ? 'var(--pos)' : ev >= 0.95 ? 'var(--tx-2)' : 'var(--neg)')

function Bands({ summary, cap }) {
  if (!summary?.bands?.length) return null
  return (
    <table className="caps-bands">
      <tbody>
        {summary.bands.filter(b => b.n).map(b => {
          const over = cap != null && b.lo >= cap
          return (
            <tr key={`${b.lo}-${b.hi}`} style={{ opacity: over ? 0.45 : 1 }}>
              <td className="num">{b.lo}–{b.hi === 99 ? '∞' : b.hi}</td>
              <td className="num muted2">n={b.n}</td>
              <td className="num">{pct(b.rate)}</td>
              <td className="num" style={{ color: evTone(b.ev), fontWeight: b.ev >= 1 ? 700 : 400 }}>EV {b.ev}</td>
              <td className="muted2" style={{ fontSize: 11 }}>{over ? 'above your cap' : ''}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function Cap({ label, hint, value, recent, allTime, onChange }) {
  const rec = recent?.recommended
  const differs = rec != null && Number(value) !== Number(rec)
  return (
    <div className="caps-row">
      <div className="caps-head">
        <div>
          <div className="caps-label">{label}</div>
          <div className="muted2" style={{ fontSize: 12 }}>{hint}</div>
        </div>
        <input className="caps-input num" type="number" step="0.05" min="1.01" max="10"
          value={value} onChange={e => onChange(e.target.value)} />
      </div>
      <div className="caps-rec">
        <span>
          the record recommends <b className="num">{rec ?? 'no cap'}</b>
          <span className="muted2"> from the last {recent?.days ?? 14} days ({recent?.n} legs)</span>
          {allTime?.recommended != null && allTime.recommended !== rec && (
            <span className="muted2"> · all time says {allTime.recommended} ({allTime.n} legs)</span>
          )}
        </span>
        {differs && (
          <button type="button" className="btn-mini" onClick={() => onChange(String(rec))}>use {rec}</button>
        )}
      </div>
      <Bands summary={recent} cap={Number(value)} />
    </div>
  )
}

export default function Caps() {
  const [data, setData]       = useState(null)
  const [caps, setCaps]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState(null)
  const [saved, setSaved]     = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const { data } = await api.get('/api/caps?fresh=1')
      setData(data); setCaps(data.caps)
    } catch (err) { setError(err?.response?.data?.error || err.message) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const save = async () => {
    setSaving(true); setError(null); setSaved(false)
    try {
      const { data: r } = await api.put('/api/caps', caps)
      setCaps(r.caps); setSaved(true); setTimeout(() => setSaved(false), 2500)
    } catch (err) { setError(err?.response?.data?.error || err.message) }
    finally { setSaving(false) }
  }

  if (loading) return <AppShell title="Rollover caps"><div className="muted">Reading the record…</div></AppShell>
  if (!caps) return <AppShell title="Rollover caps"><div className="err">{error || 'Could not load'}</div></AppShell>

  const rec = data.recommended
  const marketRows = (rec.allTime.markets || []).map(m => ({
    ...m,
    recent: (rec.recent.markets || []).find(x => x.market === m.market) || null,
    current: caps.markets?.[m.market] ?? null,
  }))

  return (
    <AppShell title="Rollover caps">
      <p className="muted" style={{ maxWidth: 760, marginBottom: 20 }}>
        The most a single leg of a rollover step may be priced at. Hit rate tracks <b>price</b> far
        more closely than it tracks market — at 1.20–1.30 an Over 1.5, a Double Chance and a team
        Under all land within two points of each other — so the ceiling is global, with per-market
        carve-outs for the cases the record separates. These are <b>prices</b>, not leg counts; the
        number of legs is each chain's own <span className="mono">maxLegs</span>.
      </p>

      <label className="caps-toggle">
        <input type="checkbox" checked={caps.enabled !== false}
          onChange={e => setCaps({ ...caps, enabled: e.target.checked })} />
        <span>Apply these ceilings. Off means a step is limited only by the per-market record
          and whatever the learner has refused — useful for seeing what the optimiser does
          unconstrained, not for running on.</span>
      </label>

      <Cap label="Every leg" hint="the global ceiling, unless a market below overrides it"
        value={caps.legMaxOdds}
        recent={rec.recent.overall} allTime={rec.allTime.overall}
        onChange={v => setCaps({ ...caps, legMaxOdds: v })} />

      <Cap label="Straight wins" hint="1X2 Home/Away Win — the one market that beats its price band rather than tracking it"
        value={caps.straightMaxOdds}
        recent={rec.recent.straight} allTime={rec.allTime.straight}
        onChange={v => setCaps({ ...caps, straightMaxOdds: v })} />

      {/* ── Blind fixtures ──────────────────────────────────────────────────────────────────
          Matches where our data has no bookmaker odds, so the model is guessing (lower leagues,
          cup ties). They are judged at SportyBet's own probability; these two numbers are the
          rest of that rule, here rather than in .env so they can be changed without a deploy. */}
      <h3 style={{ marginTop: 28 }}>Spread</h3>
      <p className="muted2" style={{ fontSize: 12.5, maxWidth: 700, marginTop: 4 }}>
        How many pending rollover and auto-slate tickets one <b>match</b> may be on, whatever the bet. Last 14 days:
        a match on one ticket failed 16% of the time, on 3–4 tickets 36%, and those caused 79 of 141 lost
        tickets — every builder reaches for the same matches. Once a match is full the builder moves on to the
        next best; it never leaves a step unbuilt because of this.
      </p>
      <div className="caps-row">
        <div className="caps-head">
          <div>
            <div className="caps-label">Most tickets one match may be on</div>
            <div className="muted2" style={{ fontSize: 12 }}>any match, any bet — blind matches use the tighter limit below</div>
          </div>
          <input className="caps-input num" type="number" step="1" min="1" max="50"
            value={caps.matchMaxTickets ?? 2} onChange={e => setCaps({ ...caps, matchMaxTickets: e.target.value })} />
        </div>
      </div>

      <h3 style={{ marginTop: 28 }}>Blind matches</h3>
      <p className="muted2" style={{ fontSize: 12.5, maxWidth: 700, marginTop: 4 }}>
        A match is <b>blind</b> when our data holds no bookmaker odds for it, so the model is guessing —
        lower leagues and cup ties. Measured 26–30 Sep: blind legs landed 66% where their price needed 78%,
        anchored ones 92% against 83%. Blind legs are judged at SportyBet's own probability; these two
        settings are the rest of that rule.
      </p>
      <div className="caps-row">
        <div className="caps-head">
          <div>
            <div className="caps-label">Most tickets one <b>blind</b> match may be on</div>
            <div className="muted2" style={{ fontSize: 12 }}>whatever the bet — a guessed match should not ride on several chains</div>
          </div>
          <input className="caps-input num" type="number" step="1" min="1" max="50"
            value={caps.blindMaxTickets ?? 1} onChange={e => setCaps({ ...caps, blindMaxTickets: e.target.value })} />
        </div>
      </div>
      <div className="caps-row">
        <div className="caps-head">
          <div>
            <div className="caps-label">Offer SportyBet's favourite as a straight win from</div>
            <div className="muted2" style={{ fontSize: 12 }}>on a blind match, the book's favourite at this chance or more is put forward as a straight-win leg (percent)</div>
          </div>
          <input className="caps-input num" type="number" step="1" min="50" max="95"
            value={Math.round((caps.blindFavouriteMin ?? 0.6) * 100)}
            onChange={e => setCaps({ ...caps, blindFavouriteMin: Number(e.target.value) / 100 })} />
        </div>
      </div>

      <h3 style={{ marginTop: 28 }}>Per market</h3>
      <p className="muted2" style={{ fontSize: 12.5, maxWidth: 700, marginTop: 4 }}>
        Blank means the global ceiling applies. A number here <b>replaces</b> it for that market —
        naming a market is the act of carving it out. Only markets with at least{' '}
        {rec.allTime.minSample} settled legs are listed, because a ceiling drawn from fewer is
        worse than none.
      </p>
      <table className="caps-markets">
        <thead>
          <tr><th>Market</th><th className="num">legs</th><th className="num">recommended</th><th className="num">your cap</th></tr>
        </thead>
        <tbody>
          {marketRows.map(m => (
            <tr key={m.market}>
              <td>{m.market.replace('|', ' — ')}</td>
              <td className="num muted2">{m.n}</td>
              <td className="num">
                {m.recommended ?? 'no cap'}
                {m.recent?.recommended != null && m.recent.recommended !== m.recommended && (
                  <span className="muted2" style={{ fontSize: 11 }}> (14d: {m.recent.recommended})</span>
                )}
              </td>
              <td className="num">
                <input className="caps-input caps-input-sm num" type="number" step="0.05" min="1.01" max="10"
                  placeholder="—" value={m.current ?? ''}
                  onChange={e => {
                    const markets = { ...(caps.markets || {}) }
                    if (e.target.value === '') delete markets[m.market]
                    else markets[m.market] = e.target.value
                    setCaps({ ...caps, markets })
                  }} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {error && <div className="err" style={{ marginTop: 16 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 22 }}>
        <button className="btn btn-primary" disabled={saving} onClick={save}>
          {saving ? 'Saving…' : 'Save caps'}
        </button>
        <button className="btn" onClick={load} disabled={saving}>Reload</button>
        {saved && <span style={{ color: 'var(--pos)', fontWeight: 600 }}>Saved — it applies to the next step cut.</span>}
      </div>
    </AppShell>
  )
}
