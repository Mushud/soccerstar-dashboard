import { useState } from 'react'
import api from '../api'

const pct = n => n != null ? (n * 100).toFixed(1) + '%' : '—'
const sign = n => n == null ? '—' : `${n >= 0 ? '+' : ''}${n}pp`

const HOURS = Array.from({ length: 24 }, (_, i) => i)

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
              {/* Human mode only: what the model claimed on its own, before the league, club,
                  price-source and data-quality records moved it. The gap IS the judgement
                  layer — without it the mode is unfalsifiable. */}
              {(slip.allLegs || []).some(l => l.modelProb != null) && <th className="num">Judged</th>}
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
                    {(l.modelProb ?? l.prob) != null ? ((l.modelProb ?? l.prob) * 100).toFixed(0) + '%' : '—'}
                  </td>
                  {(slip.allLegs || []).some(x => x.modelProb != null) && (
                    <td className="num" style={{ color: l.prob >= 0.8 ? 'var(--pos)' : l.prob >= 0.6 ? 'var(--warn)' : 'var(--neg)' }}
                      title={(l.why || []).length
                        ? (l.why || []).map(w => `${w.term} ${w.deltaPP >= 0 ? '+' : ''}${w.deltaPP}pp`).join(', ')
                        : 'nothing moved this leg'}>
                      {l.prob != null ? (l.prob * 100).toFixed(0) + '%' : '—'}
                      {(l.why || []).length > 0 && <span className="muted2" style={{ marginLeft: 3, fontSize: 9.5 }}>ⓘ</span>}
                    </td>
                  )}
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
  // Kickoff time of day, 0-23 inclusive, or '' for no limit. The dates choose which DAYS are
  // replayed; this chooses which part of a day — a different question, and one the date range
  // cannot answer. A Saturday is an early programme, a mid-afternoon block and an evening one,
  // and they are not the same fixtures, leagues or prices. Start after end wraps midnight.
  const [fromHour, setFromHour]   = useState('')
  const [toHour, setToHour]       = useState('')
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
  // How many days of fixtures feed ONE slip. The bet builder works in windows — Today, Next 2
  // Days, Next 3 Days, This Week — and Smart Pick builds a single slip from everything in the
  // window, so simulating one slip per calendar day does not reproduce what you actually do.
  const [windowDays, setWindowDays] = useState(3)
  // 'safest' takes the N most likely legs and accepts whatever they pay; 'target' reaches for a
  // price. Measured, safest wins +7.5pp at matched odds and never uses a leg below ~72%, which
  // is why it is the default here.
  const [mode, setMode]           = useState('safest')
  // ── Human mode ──
  // How wrong the judgement is allowed to be. Not decoration: a strategy that only works on the
  // exact argmax of a score fitted to this same history is not a strategy, and jittering the
  // score before ranking is how you find that out. 0 makes the ranking deterministic.
  const [gutNoise, setGutNoise]   = useState(0.03)
  // Off by default. The cap's argument is sound — same-family legs fail together — but it cannot
  // choose what it forces in, and what it forces in is worse: over August at 3x, cap 3 landed 38
  // per 100, cap 6 landed 42, no cap landed 45, while the Unders share fell 18% → 3% → 0%.
  const [maxPerFamily, setMaxPerFamily] = useState(0)
  // Lean toward Over 1.5 and away from the Unders. An instruction, not something fitted — but
  // the one the record argues for: inside human-mode slips Over 1.5 ran 87.9% against a claimed
  // 88.9% on 783 legs, while Under 3.5 ran 70.1% vs 83.0% and Under 4.5 68.2% vs 84.0%.
  // +6pp by default: that is where the effect saturates (41 → 45 → 46 → 46 → 45 landed per 100
  // at 0/4/6/8/12pp over August at a 3x target), not a number chosen to flatter it.
  const [preferOver15, setPreferOver15] = useState(0.06)
  // Each term of the judgement, on or off. Off is the interesting setting — with all five off the
  // run reproduces "Hit a target" exactly, which is how you tell whether any of them carry
  // anything. Measured over 372 slips, none of them did.
  const [terms, setTerms] = useState({ league: true, team: true, tier: true, price: true, data: true })
  const [minLegProb, setMinLegProb]   = useState(0)
  const [minSlipProb, setMinSlipProb] = useState(0)
  const [uniqueBy, setUniqueBy]   = useState('team')
  // Identical shape to Smart Pick's, so a rule set tested here is the rule set that gets booked.
  const [useRules, setUseRules]   = useState(false)
  const [rules, setRules]         = useState(() => ({
    'Over/Under|Over 1.5':             { on: true,  min: 0.80 },
    'Double Chance|1X (Home or Draw)': { on: true,  min: 0.85 },
    'Double Chance|X2 (Away or Draw)': { on: true,  min: 0.85 },
    'Over/Under|Over 2.5':             { on: false, min: 0.70 },
    'Over/Under|Under 3.5':            { on: false, min: 0.75 },
    'Home Goals|Under 2.5':            { on: false, min: 0.80 },
    'Away Goals|Under 2.5':            { on: false, min: 0.80 },
    '1X2|Home Win':                    { on: false, min: 0.70 },
    '1X2|Away Win':                    { on: false, min: 0.70 },
  }))
  const [running, setRunning]     = useState(false)
  const [sweeping, setSweeping]   = useState(false)
  const [res, setRes]             = useState(null)
  const [sweep, setSweep]         = useState(null)
  const [error, setError]         = useState(null)
  const [slipTab, setSlipTab]     = useState('lost')
  const [label, setLabel]         = useState('')
  const [runs, setRuns]           = useState(null)

  const body = extra => ({
    from, to,
    fromHour: fromHour === '' ? null : Number(fromHour),
    toHour:   toHour   === '' ? null : Number(toHour),
    // The hours are read off the user's clock, so the database has to evaluate them in the same
    // zone. Sent rather than assumed: the server need not be in the same timezone as the browser,
    // and "the 15:00 kickoffs" silently meaning 15:00 UTC would be wrong by an hour for half the
    // year in the UK alone.
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    targetOdds: Number(targetOdds), minLegs: Number(minLegs), maxLegs: Number(maxLegs),
    safeOnly, sportybetOnly: sbOnly, realOddsOnly: realOdds, slipsPerDay: Number(perDay), windowDays: Number(windowDays),
    mode, minLegProb: Number(minLegProb), minSlipProb: Number(minSlipProb), uniqueBy,
    marketRules: (() => {
      const active = Object.entries(rules).filter(([, v]) => v.on)
      return useRules && active.length
        ? { allow: active.map(([k]) => k), minProb: Object.fromEntries(active.map(([k, v]) => [k, v.min])) }
        : null
    })(),
    ...(mode === 'human' ? {
      gutNoise: Number(gutNoise), maxPerFamily: Number(maxPerFamily), preferOver15: Number(preferOver15),
      humanWeights: Object.fromEntries(Object.entries(terms).map(([k, v]) => [k, v ? 1 : 0])),
    } : {}),
    label: label || null, ...extra,
  })

  async function run() {
    setRunning(true); setError(null); setRes(null); setSweep(null)
    try {
      const { data } = await api.post('/api/betbuilder/slip-backtest', body(), { timeout: 5 * 60 * 1000 })
      if (!data.ok) {
        // Keep the per-reason breakdown too: "nothing built" is rarely the useful part.
        const detail = data.failures && Object.keys(data.failures).length
          ? ' · ' + Object.entries(data.failures).map(([k, v]) => `${k} (${v})`).join(', ')
          : ''
        setError((data.reason || 'No slips could be built') + detail)
      }
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
    // In safest mode the target is meaningless, so the sweep varies the leg count instead.
    // Human mode reaches for a price the same way Target does, so it sweeps prices too. The low
    // end is where the useful answers are — a 2x that lands half the time is a different
    // proposition from a 50x that lands twice a season, and only one of them is placeable.
    const shapes = mode === 'safest'
      ? [[2, 2, 0], [3, 3, 0], [4, 4, 0], [5, 5, 0], [6, 6, 0], [8, 8, 0], [10, 10, 0]]
      : [[2, 14, 2], [2, 14, 3], [2, 14, 5], [4, 14, 10], [6, 14, 20], [8, 15, 50]]
    const out = []
    try {
      for (const [lo, hi, t] of shapes) {
        const { data } = await api.post('/api/betbuilder/slip-backtest',
          body({ minLegs: lo, maxLegs: hi, targetOdds: t }), { timeout: 5 * 60 * 1000 })
        out.push({ label: mode === 'safest' ? `${lo} legs` : `${t}x target`,
                   ...(data.ok ? data : { failed: data.reason }) })
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
        <label className="muted" style={{ fontSize: 11.5 }}
          title="Only fixtures kicking off inside this window, on every day in the range. Inclusive at both ends, read off your own clock. Set the start later than the end to wrap midnight — 22 to 02 is the late programme.">
          Kickoff
          <select className="field" value={fromHour} onChange={e => setFromHour(e.target.value)}
            style={{ marginLeft: 6, width: 'auto', padding: '4px 6px' }}>
            <option value="">any</option>
            {HOURS.map(h => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
          </select>
          <span style={{ margin: '0 4px' }}>–</span>
          <select className="field" value={toHour} onChange={e => setToHour(e.target.value)}
            style={{ width: 'auto', padding: '4px 6px' }}>
            <option value="">any</option>
            {HOURS.map(h => <option key={h} value={h}>{String(h).padStart(2, '0')}:59</option>)}
          </select>
        </label>
        <label className="muted" style={{ fontSize: 11.5 }}
          title="Safest: take the N most likely legs, accept whatever odds result. Target: reach for a price, which is what forces a weak leg into the slip. Human: the same search as Target, but ranking legs on what this league, these clubs, this price source and this data quality have actually delivered rather than on the model's claim alone.">
          Mode
          <select className="field" value={mode} onChange={e => setMode(e.target.value)}
            style={{ marginLeft: 6, width: 'auto', padding: '4px 8px' }}>
            <option value="safest">Safest legs</option>
            <option value="target">Hit a target</option>
            <option value="human">Human judgement</option>
          </select>
        </label>
        <label className="muted" style={{ fontSize: 11.5, opacity: mode === 'safest' ? 0.45 : 1 }}>Target
          <input className="field" type="number" min="1.1" step="0.5" value={targetOdds} onChange={e => setTarget(e.target.value)}
            disabled={mode === 'safest'} style={{ marginLeft: 6, width: 78, padding: '4px 8px' }} />
          {mode !== 'safest' && (
            <span style={{ marginLeft: 6 }}>
              {[2, 3, 5].map(v => (
                <button key={v} className={`chip${Number(targetOdds) === v ? ' on' : ''}`}
                  onClick={() => setTarget(v)} style={{ marginLeft: 3, padding: '2px 7px', fontSize: 10.5 }}>{v}x</button>
              ))}
            </span>
          )}
        </label>
        <label className="muted" style={{ fontSize: 11.5 }}
          title="Days of fixtures in one slip's candidate pool — the same choice the bet builder's fixture window gives you. Smart Pick builds a single slip from everything in the window.">
          Window
          <select className="field" value={windowDays} onChange={e => setWindowDays(e.target.value)}
            style={{ marginLeft: 6, width: 'auto', padding: '4px 8px' }}>
            <option value={1}>Per day</option>
            <option value={2}>2 days</option>
            <option value={3}>3 days</option>
            <option value={7}>This week</option>
            <option value={0}>Whole range</option>
          </select>
        </label>
        <label className="muted" style={{ fontSize: 11.5 }}
          title="Slips to build per window. Each one uses fixtures the previous slips did not, so they are independent bets — more sample without reusing a result. Widen the window and you get fewer windows, so raise this to keep the sample size up.">
          Slips/window
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
        <label className="muted" style={{ fontSize: 11.5 }}
          title="Refuse any leg the model rates below this. In safest mode it rarely binds — that mode already stays above ~72% on its own.">
          Min leg
          <select className="field" value={minLegProb} onChange={e => setMinLegProb(e.target.value)}
            style={{ marginLeft: 6, width: 'auto', padding: '4px 8px' }}>
            {[0, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85].map(v =>
              <option key={v} value={v}>{v ? `${(v * 100).toFixed(0)}%` : 'any'}</option>)}
          </select>
        </label>
        <label className="muted" style={{ fontSize: 11.5 }}
          title="Refuse a slip whose combined chance falls below this. In safest mode it also decides the leg count — legs are added while the slip still clears the floor.">
          Min slip
          <select className="field" value={minSlipProb} onChange={e => setMinSlipProb(e.target.value)}
            style={{ marginLeft: 6, width: 'auto', padding: '4px 8px' }}>
            {[0, 0.5, 0.6, 0.7, 0.8, 0.9].map(v =>
              <option key={v} value={v}>{v ? `${(v * 100).toFixed(0)}%` : 'any'}</option>)}
          </select>
        </label>
        <label className="muted" style={{ fontSize: 11.5 }}
          title="What may not repeat across the slips built for one window. Two slips sharing a leg are not two bets — they lose together. Allow repeats lets slips share fixtures, reusing a match on a different market; they are still never identical, but they overlap, so the sample counts for less than its size.">
          Unique
          <select className="field" value={uniqueBy} onChange={e => setUniqueBy(e.target.value)}
            style={{ marginLeft: 6, width: 'auto', padding: '4px 8px' }}>
            <option value="team">Team once</option>
            <option value="match">Match once</option>
            <option value="none">Allow repeats (overlapping)</option>
          </select>
        </label>
        <label className="muted" style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, cursor: 'pointer' }}
          title="Choose which markets may be used and the minimum each must clear — the same rules Smart Pick applies.">
          <input type="checkbox" checked={useRules} onChange={e => setUseRules(e.target.checked)} /> Market rules
        </label>
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

      {mode === 'human' && (
        <div className="card" style={{ padding: '10px 12px', marginBottom: 12 }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>
            What the judgement is allowed to know, and how sure of itself it is
          </div>
          <div className="toolbar" style={{ gap: 14, flexWrap: 'wrap', marginBottom: 8 }}>
            <label className="muted" style={{ fontSize: 11.5 }}
              title="Probability points of jitter added to every leg before ranking. A strategy that only works on the exact best-scoring legs is not a strategy — this is how you find out whether yours survives picking slightly the wrong ones. Seeded, so the same settings always give the same answer.">
              Fallibility
              <select className="field" value={gutNoise} onChange={e => setGutNoise(e.target.value)}
                style={{ marginLeft: 6, width: 'auto', padding: '4px 8px' }}>
                <option value={0}>none (exact)</option>
                <option value={0.02}>±2pp</option>
                <option value={0.03}>±3pp</option>
                <option value={0.05}>±5pp</option>
                <option value={0.08}>±8pp</option>
              </select>
            </label>
            <label className="muted" style={{ fontSize: 11.5 }}
              title="Push Over 1.5 up the ranking and the Unders down, by this many probability points. It steers the SEARCH only — the probability each leg claims is unchanged, so the slip's stated confidence stays honest. Measured over 372 August slips at a 3x target with no market cap: 4pp took Over 1.5 from 58% of legs to 93%, Unders to zero, and slips landed 45 per 100 against the plain model's 40.">
              Prefer Over 1.5
              <select className="field" value={preferOver15} onChange={e => setPreferOver15(e.target.value)}
                style={{ marginLeft: 6, width: 'auto', padding: '4px 8px' }}>
                {[0, 0.02, 0.04, 0.06, 0.1].map(v =>
                  <option key={v} value={v}>{v ? `+${(v * 100).toFixed(0)}pp` : 'no lean'}</option>)}
              </select>
            </label>
            <label className="muted" style={{ fontSize: 11.5 }}
              title="Most legs one market family may take. Six Over 1.5s on one ticket is one bet on a high-scoring round wearing six names, and the win probability — a plain product — assumes an independence it does not have.">
              Max/market
              <select className="field" value={maxPerFamily} onChange={e => setMaxPerFamily(e.target.value)}
                style={{ marginLeft: 6, width: 'auto', padding: '4px 8px' }}>
                {[0, 2, 3, 4, 6].map(v => <option key={v} value={v}>{v || 'no cap'}</option>)}
              </select>
            </label>
            {/* One click to the configuration that measured best, because the settings live in
                component state: a hot reload keeps the old values alive, so a default changed in
                the source never reaches a tab that was already open. Reloading works too — this
                is here so you do not have to know that. */}
            <button className="btn btn-pos" style={{ padding: '4px 9px', fontSize: 11 }}
              onClick={() => { setPreferOver15(0.06); setMaxPerFamily(0); setGutNoise(0) }}
              disabled={Number(preferOver15) === 0.06 && Number(maxPerFamily) === 0 && Number(gutNoise) === 0}
              title="Over 1.5 lean +6pp, no market cap, no fallibility — 46 slips landed per 100 at a 3x target over August, against the plain model's 40.">
              ⚡ Use measured-best
            </button>
            {Object.keys(terms).map(k => (
              <label key={k} className="muted" style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, cursor: 'pointer' }}
                title={{
                  league: 'Mark a leg down when its competition has run below its claimed rate, shrunk by how much evidence there is.',
                  team:   'Mark a leg down on the worse-performing of the two clubs. One unreliable side is enough to lose the leg.',
                  tier:   'Mark a leg down when its risk tier has underdelivered.',
                  price:  'Mark a leg down when the model claims more than a real bookmaker price implies. Only fires where a bookmaker actually quoted — about 15% of picks.',
                  data:   'Mark a leg down when the fixture\'s input data was unverified rather than confirmed.',
                }[k]}>
                <input type="checkbox" checked={terms[k]} onChange={e => setTerms(t => ({ ...t, [k]: e.target.checked }))} />
                {k}
              </label>
            ))}
          </div>
          <div className="muted2" style={{ fontSize: 10.5, lineHeight: 1.55 }}>
            Same search as “Hit a target” — only the number each leg is ranked on changes. Records
            are fitted strictly on days BEFORE this window, so a leg is never judged by a table
            that already contains its own result. Turn all five terms off and this reproduces
            “Hit a target” exactly, which is the control worth running first: measured over 372
            slips in August, every term landed within noise of the plain model, and all five
            together did too. “Prefer Over 1.5” is the exception — an instruction rather than a
            fitted term, and the only setting that beat the plain model. With no market cap it
            took slips from 41 landed per 100 to 46 at a 3x target, and 27 to 31 at 5x.
            {' '}<b>The market cap costs more than it protects</b>: cap 3 landed 38, cap 6 landed
            42, no cap landed 45, because the cap cannot choose what it substitutes and what it
            substitutes is Double Chance and the Unders — the markets running 4-13pp short of
            their claims. The concentration is real (97% of legs become Over 1.5) and the figures
            above already contain it, since they are realised results; the longest losing run did
            not worsen. One month of data, so both dials stay.
          </div>
        </div>
      )}

      {useRules && (
        <div className="card" style={{ padding: '10px 12px', marginBottom: 12 }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Markets allowed, and the minimum for each</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 6 }}>
            {Object.entries(rules).map(([key, v]) => {
              const [market, selection] = key.split('|')
              return (
                <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, opacity: v.on ? 1 : 0.5, cursor: 'pointer' }}>
                  <input type="checkbox" checked={v.on}
                    onChange={e => setRules(r => ({ ...r, [key]: { ...r[key], on: e.target.checked } }))} />
                  <span style={{ flex: 1 }}><span className="muted">{market}:</span> <b style={{ color: 'var(--tx-2)' }}>{selection}</b></span>
                  <select className="field" value={v.min} disabled={!v.on}
                    onChange={e => setRules(r => ({ ...r, [key]: { ...r[key], min: Number(e.target.value) } }))}
                    style={{ width: 'auto', padding: '3px 6px', fontSize: 11 }}>
                    {[0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95].map(mn =>
                      <option key={mn} value={mn}>≥{(mn * 100).toFixed(0)}%</option>)}
                  </select>
                </label>
              )
            })}
          </div>
        </div>
      )}

      {error && (
        <div style={{
          fontSize: 12.5, color: 'var(--neg)', marginBottom: 10, lineHeight: 1.55,
          background: 'var(--neg-soft)', border: '1px solid var(--neg-dim)',
          borderRadius: 'var(--r-sm)', padding: '9px 12px',
        }}>{error}</div>
      )}

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
                `${res.days.windows ?? res.days.considered} window${(res.days.windows ?? 0) === 1 ? '' : 's'} over ${res.days.considered} days` +
                (res.config?.slipsPerDay > 1 ? ` · ${res.config.slipsPerDay} each` : '')],
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

          {/* The question as actually asked — "out of a hundred, how many land" — stated as a
              sentence rather than left to be read off a win rate. `matchesUsed` is there because
              these slips come out of a pool: a 5x that needs six legs eats six of the matches on
              the card, and how many hundred-match cards you would need is a real limit on
              placing them. */}
          {(res.config?.fromHour != null || res.config?.toHour != null) && (
            <div className="muted2" style={{ fontSize: 11, marginBottom: 8 }}>
              Kickoffs {res.config.fromHour != null ? `from ${String(res.config.fromHour).padStart(2, '0')}:00` : 'any time'}
              {' '}{res.config.toHour != null ? `to ${String(res.config.toHour).padStart(2, '0')}:59` : ''}
              {' '}({res.config.timezone})
              {res.config.fromHour != null && res.config.toHour != null && res.config.fromHour > res.config.toHour && ' — wrapping midnight'}
              {' · '}every day from {res.config.from} to {res.config.to}
            </div>
          )}

          {res.perHundred && (
            <div style={{
              background: 'var(--info-soft)', border: '1px solid var(--info-dim)',
              borderRadius: 'var(--r-sm)', padding: '10px 13px', marginBottom: 12,
              fontSize: 12.5, lineHeight: 1.6, color: 'var(--tx-2)',
            }}>
              Out of <b>100 of these tickets</b> at <b style={{ color: 'var(--warn)' }}>{res.slips.meanOdds}x</b>,{' '}
              <b style={{ color: 'var(--pos)' }}>{res.perHundred.landed}</b> landed — staking 100 units returned{' '}
              <b style={{ color: res.perHundred.profit >= 0 ? 'var(--pos)' : 'var(--neg)' }}>
                {res.perHundred.returned}
              </b>{' '}({res.perHundred.profit >= 0 ? '+' : ''}{res.perHundred.profit}).
              {' '}They consume about <b>{res.perHundred.matchesUsed}</b> matches, and the worst run of
              consecutive losses was <b style={{ color: 'var(--neg)' }}>{res.slips.longestLosingRun}</b>.
              <div className="muted2" style={{ fontSize: 10.5, marginTop: 4 }}>
                {/* The losing run is the number that decides whether a positive ROI is actually
                    placeable — an edge you cannot sit through is not an edge you collect. */}
                Returns are notional unless “Real odds only” is on — 15% of stored prices were real
                bookmaker quotes; the rest are derived from the model's own probability.
              </div>
            </div>
          )}

          {/* What the judgement layer knew, and the extremes of what it believed. Named, because
              "it helped" is not checkable and "it stopped backing these leagues" is. */}
          {res.human && (
            <div className="card" style={{ padding: '10px 12px', marginBottom: 12 }}>
              {/* What this run actually used, stated first. The settings are sent from the page's
                  own state, so a tab left open across a default change keeps sending the old
                  values and the result looks like the new behaviour failing. */}
              <div style={{ fontSize: 11.5, marginBottom: 6 }}>
                <b>Ran with:</b>{' '}
                <span style={{ color: res.human.preferOver15 > 0 ? 'var(--pos)' : 'var(--neg)' }}>
                  Over 1.5 lean {res.human.preferOver15 > 0 ? `+${(res.human.preferOver15 * 100).toFixed(0)}pp` : 'OFF'}
                </span>
                {' · '}
                <span style={{ color: res.human.maxPerFamily > 0 ? 'var(--warn)' : 'var(--pos)' }}>
                  market cap {res.human.maxPerFamily > 0 ? res.human.maxPerFamily : 'off'}
                </span>
                {' · '}fallibility {res.human.gutNoise ? `±${(res.human.gutNoise * 100).toFixed(0)}pp` : 'none'}
                {(!res.human.preferOver15 || res.human.maxPerFamily > 0) && (
                  <span className="muted2" style={{ marginLeft: 6 }}>
                    — measured best is a +6pp lean with the cap off; reload the page if these look stale.
                  </span>
                )}
              </div>
              <div className="eyebrow" style={{ marginBottom: 6 }}>
                Human judgement — fitted on {res.human.fittedOnPicks.toLocaleString()} picks
                {res.human.fittedBefore ? ` before ${res.human.fittedBefore}` : ''}
                {' · '}{res.human.counts.leagues} leagues, {res.human.counts.teams} clubs
              </div>
              {/* An empty fit is silent otherwise: with no earlier days to learn from, every
                  adjustment is zero and the run is target mode wearing a different name. That
                  is easy to hit — set "From" to the first day you have data for and there is
                  nothing before it. */}
              {res.human.fittedOnPicks < 500 && (
                <div style={{ fontSize: 11, color: 'var(--warn)', marginBottom: 6 }}>
                  ⚠ Only {res.human.fittedOnPicks.toLocaleString()} settled picks sit before this
                  window, so the records barely move any leg — this run is close to plain “Hit a
                  target”. Move “From” later to leave more history behind it.
                </div>
              )}
              {res.human.inSample && (
                <div style={{ fontSize: 11, color: 'var(--warn)', marginBottom: 6 }}>
                  ⚠ Fitted on every settled day, this window included — the records already know
                  these results, so this run is a description, not evidence.
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
                {[['Marked down', res.human.distrusted, 'var(--neg)'], ['Marked up', res.human.trusted, 'var(--pos)']].map(([title, grp, col]) => (
                  <div key={title}>
                    <div className="muted2" style={{ fontSize: 10.5, marginBottom: 3 }}>{title}</div>
                    {(grp.leagues || []).slice(0, 5).map(l => (
                      <div key={l.k} style={{ fontSize: 11, display: 'flex', gap: 6 }}>
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.k}</span>
                        <span className="num muted2">n={l.n}</span>
                        <span className="num" style={{ color: col, minWidth: 46, textAlign: 'right' }}>{sign(l.deltaPP)}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              <div className="muted2" style={{ fontSize: 10.5, marginTop: 7, lineHeight: 1.55 }}>
                Every adjustment is shrunk toward zero by how little evidence sits behind it and
                capped at a few points, so a club seen twenty times cannot overturn the model.
              </div>
            </div>
          )}

          {/* Said out loud wherever the slips overlap. Every rate above counts each slip as one
              observation, and overlapping slips cannot lose independently — so `n` is a count of
              tickets, not a count of evidence. */}
          {res.sampling?.note && (
            <div style={{ fontSize: 11.5, color: 'var(--warn)', marginBottom: 8, lineHeight: 1.55 }}>
              ⚠ {res.sampling.note}
            </div>
          )}

          {res.pendingInWindow > 0 && (
            <div style={{ fontSize: 11, color: 'var(--warn)', marginBottom: 8 }}>
              ⏳ {res.pendingInWindow} pick{res.pendingInWindow === 1 ? '' : 's'} in this window
              {' '}have not settled yet — matches grade as they finish, so recent days are incomplete
              and the rates below are built on only part of the card.
            </div>
          )}
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
              {res.lossProfile && res.lossProfile.lost > 0 && (
                <div className="muted2" style={{ fontSize: 11, marginBottom: 8, lineHeight: 1.5 }}>
                  {/* The list below shows only the closest twelve losses. Without the totals it
                      reads like the slips are constantly one leg away, whatever the real spread. */}
                  <b style={{ color: 'var(--tx-2)' }}>{res.lossProfile.lost}</b> slip{res.lossProfile.lost === 1 ? '' : 's'} lost
                  {res.lossProfile.lostByOneLeg != null && <> · <b style={{ color: 'var(--warn)' }}>{pct(res.lossProfile.lostByOneLeg)}</b> of them by a single leg</>}
                  <span style={{ marginLeft: 8 }}>
                    {Object.entries(res.lossProfile.byLegsLost).map(([k, v]) => (
                      <span key={k} style={{ marginRight: 8 }}>{k} leg{k === '1' ? '' : 's'}: {v}</span>
                    ))}
                  </span>
                  <div style={{ marginTop: 2 }}>Showing the {res.worstDays?.length || 0} closest below.</div>
                </div>
              )}
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
