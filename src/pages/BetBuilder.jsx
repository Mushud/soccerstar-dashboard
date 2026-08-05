import { useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import api, { API_BASE } from '../api'


const DURATION_LABELS = {
  today:    'Today',
  tomorrow: 'Tomorrow',
  '2days':  'Next 2 Days',
  '3days':  'Next 3 Days',
  week:     'This Week',
}

const RISK_OPTIONS = [
  { key: 'low',    label: 'Low Risk',    emoji: '🛡', desc: 'High confidence only.',      color: '#68d391', bg: '#1a3a2a', border: '#276749', activeBg: '#276749' },
  { key: 'medium', label: 'Medium Risk', emoji: '⚖', desc: 'High or Medium confidence.',  color: '#ecc94b', bg: '#2d2a1a', border: '#744210', activeBg: '#744210' },
  { key: 'high',   label: 'High Risk',   emoji: '🔥', desc: 'Chase value, wider net.',     color: '#fc8181', bg: '#3a1a1a', border: '#742a2a', activeBg: '#742a2a' },
]

function fmt(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString('en-GB', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function BetBuilder() {
  const [duration, setDuration]   = useState('today')
  const [risks, setRisks]         = useState(['low'])
  const [dateMode, setDateMode]   = useState('quick')
  const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` }
  const [fromDate, setFromDate]   = useState(localToday)
  const [toDate, setToDate]       = useState(localToday)
  const [loading, setLoading]         = useState(false)
  const [loadProgress, setLoadProgress] = useState(null) // { sent, total }
  const [loadMessage, setLoadMessage]   = useState('')
  const [error, setError]         = useState(null)
  const [picks, setPicks]         = useState([])
  const [meta, setMeta]           = useState(null)
  const [selected, setSelected]   = useState(new Set())
  const [analysing, setAnalysing] = useState(false)
  const [analysingId, setAnalysingId] = useState(null)
  const [sortBy, setSortBy]       = useState('score')
  const [limit, setLimit]         = useState(1500)
  const [page, setPage]           = useState(1)
  const [showAll, setShowAll]       = useState(false)
  const [valueMode, setValueMode]   = useState(false)   // rank by edge vs the real price
  const [minEdge, setMinEdge]       = useState(0.10)
  const [sbLoading, setSbLoading]   = useState(false)
  const [sbResult, setSbResult]     = useState(null)
  const [sbDebug, setSbDebug]       = useState(false)
  const [expandedAI, setExpandedAI] = useState(new Set())
  const [enrichingId, setEnrichingId] = useState(null)
  const [goalsPickCount, setGoalsPickCount] = useState(10)
  const [rerunning, setRerunning] = useState(false)
  const [rerunMsg, setRerunMsg] = useState(null)
  const PAGE_SIZE = 20

  function toggleRisk(key) {
    setRisks(prev => prev.includes(key) ? (prev.length > 1 ? prev.filter(r => r !== key) : prev) : [...prev, key])
  }

  function toggleSelect(id) {
    setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  }

  function selectAll() {
    setSelected(picks.length === selected.size ? new Set() : new Set(picks.map(p => p.fixtureId)))
  }

  const GOAL_MARKETS = ['Over 1.5', 'Over 2.5', 'BTTS']

  async function runPickAndAnalyse(fixtureIds, { fast = false } = {}) {
    setSelected(new Set(fixtureIds))
    if (!fixtureIds.length) return
    setAnalysing(true)
    try {
      const { data } = await api.post(`/api/betbuilder/analyse`, { fixtureIds, risk: risks, fast }, { timeout: 10 * 60 * 1000 })
      const byId = {}
      for (const r of (data.results || [])) byId[r.fixtureId] = r
      setPicks(prev => prev.map(p => {
        const r = byId[p.fixtureId]
        if (!r) return p
        return mergeAnalysis(p, r)
      }))
      setExpandedAI(prev => { const s = new Set(prev); fixtureIds.forEach(id => s.add(id)); return s })
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Auto-analysis failed.')
    } finally {
      setAnalysing(false)
    }
  }

  async function smartPick(n = 10) {
    const ranked = [...picks].sort((a, b) => (b.certaintyScore ?? 0) - (a.certaintyScore ?? 0))
    let pool = ranked.filter(p => risks.includes(p.tier) && p.dataVerified === 'confirmed')
    if (pool.length < n) pool = ranked.filter(p => risks.includes(p.tier) && p.dataVerified !== 'risky')
    if (pool.length < n) pool = ranked.filter(p => risks.includes(p.tier))
    if (pool.length < n) pool = ranked.filter(p => p.dataVerified !== 'risky')
    if (pool.length < n) pool = ranked
    await runPickAndAnalyse(pool.slice(0, n).map(p => p.fixtureId).filter(Boolean))
  }

  async function goalsPick(n = 10) {
    // Prioritise goal markets: Over 1.5 / Over 2.5 / BTTS.
    //
    // This used to filter on the pick's OWN selection, which meant it found almost nothing in
    // High Risk: that tier's scoring curve makes 93% of its main picks 1X2 Home/Away Win, even
    // though high-risk fixtures are the highest-scoring on the card (2.94 goals average) and
    // Over 1.5 landed 75.8% on them versus 31-41% for the 1X2 picks. `goalsOption` carries the
    // best goals market for every fixture regardless of what won the main slot, so a fixture
    // now qualifies on the strength of its goals market rather than being skipped.
    const isGoalMarket = p => GOAL_MARKETS.includes(p.selection) || !!p.goalsOption
    const goalStrength = p => GOAL_MARKETS.includes(p.selection)
      ? (p.certaintyScore ?? 0)
      : (p.goalsOption?.modelProbRaw ?? 0)
    const ranked = [...picks]
      .filter(isGoalMarket)
      .sort((a, b) => goalStrength(b) - goalStrength(a))
    let pool = ranked.filter(p => risks.includes(p.tier) && p.dataVerified === 'confirmed')
    if (pool.length < n) pool = ranked.filter(p => risks.includes(p.tier) && p.dataVerified !== 'risky')
    if (pool.length < n) pool = ranked.filter(p => risks.includes(p.tier))
    if (pool.length < n) pool = ranked
    await runPickAndAnalyse(pool.slice(0, n).map(p => p.fixtureId).filter(Boolean), { fast: true })
  }

  async function generate(overrides = {}) {
    const effectiveShowAll = overrides.showAll ?? showAll
    setLoading(true)
    setError(null)
    setPicks([])
    setMeta(null)
    setLoadProgress(null)
    setLoadMessage('')
    setSelected(new Set())
    setPage(1)

    const useValue = overrides.valueMode ?? valueMode
    const body = { risk: risks, limit, showAll: effectiveShowAll }
    // Value mode ranks by disagreement with a REAL bookmaker price instead of by risk tier,
    // so the tier gate and showAll are irrelevant to it.
    if (useValue) { body.mode = 'edge'; body.minEdge = minEdge }
    if (dateMode === 'pick') { body.from = fromDate; body.to = toDate || fromDate }
    else body.duration = duration

    try {
      const res = await fetch(`${API_BASE}/api/betbuilder/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        setError(json.error || `Server error ${res.status}`)
        setLoading(false)
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const parts = buf.split('\n\n')
        buf = parts.pop()   // last partial chunk — keep for next read
        for (const part of parts) {
          if (!part.startsWith('data: ')) continue
          let evt
          try { evt = JSON.parse(part.slice(6)) } catch { continue }

          if (evt.type === 'progress') {
            setLoadMessage(evt.message)
          } else if (evt.type === 'batch') {
            setPicks(prev => [...prev, ...evt.picks])
            setLoadProgress(evt.progress)
            setLoadMessage('')
          } else if (evt.type === 'done') {
            setMeta(evt.meta)
            setLoadProgress(null)
            setLoadMessage('')
            setLoading(false)
          } else if (evt.type === 'error') {
            setError(evt.error)
            setLoading(false)
          }
        }
      }
      // Make sure loading is cleared even if 'done' event didn't arrive
      setLoading(false)
    } catch (err) {
      setError(err.message || 'Request failed.')
      setLoading(false)
    }
  }

  // scope 'picks'  — only the fixtures currently on screen (fast)
  // scope 'window' — EVERY upcoming fixture in the selected date window
  //
  // 'window' matters because refreshing only the fixtures that already qualified can only ever
  // confirm what already qualified. A fixture that missed the risk gate on stale strengths or
  // absent odds is never re-predicted under 'picks', so it can never re-enter the list however
  // much has changed underneath.
  async function rerunPredictions({ scope = 'picks', refreshOdds = false } = {}) {
    const body = { refreshOdds }
    if (scope === 'window') {
      body.scope = 'window'
      if (dateMode === 'pick') { body.from = fromDate; body.to = toDate || fromDate }
      else body.duration = duration
      const label = dateMode === 'pick' ? `${fromDate}${toDate && toDate !== fromDate ? ` → ${toDate}` : ''}` : duration
      if (!window.confirm(
        `Re-run the prediction engine on EVERY upcoming fixture in "${label}".\n\n` +
        `This can take 15–30 minutes for a week-long window` +
        (refreshOdds ? ` and will also re-fetch bookmaker odds (slower again, and uses API quota)` : '') +
        `.\n\nProgress is shown as it runs. Continue?`
      )) return
    } else {
      const fixtureIds = picks.map(p => p.fixtureId).filter(Boolean)
      if (!fixtureIds.length) {
        setError('Load picks first, then rerun to refresh their predictions.')
        return
      }
      body.fixtureIds = fixtureIds
    }

    setRerunning(true)
    setRerunMsg(scope === 'window' ? 'Starting full-window engine run…' : `Rerunning engine for ${body.fixtureIds.length} fixtures…`)
    try {
      // SSE, not JSON: a large batch takes ~2 minutes of server work and nginx closes idle
      // connections at 60s, so the old single-response version always failed as a network
      // error. Streaming keeps the connection alive and surfaces real progress.
      const res = await fetch(`${API_BASE}/api/betbuilder/rerun`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok || !res.body) throw new Error(`Engine run failed (${res.status})`)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      let result = null

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const parts = buf.split('\n\n')
        buf = parts.pop()
        for (const part of parts) {
          if (!part.startsWith('data: ')) continue
          let evt
          try { evt = JSON.parse(part.slice(6)) } catch { continue }
          if (evt.type === 'start') {
            const mins = Math.round((evt.estimatedSeconds || 0) / 60)
            setRerunMsg(`${evt.fixtures} fixtures across ${evt.leagues} leagues${evt.window ? ` (${evt.window})` : ''} — roughly ${mins < 1 ? 'under a minute' : `${mins} min`}…`)
          }
          else if (evt.type === 'progress') setRerunMsg(evt.message)
          else if (evt.type === 'done') result = evt
          else if (evt.type === 'error') throw new Error(evt.error)
        }
      }

      setRerunMsg(`Done — ${result?.ran ?? 0} updated${result?.oddsFetched ? `, ${result.oddsFetched} odds refreshed` : ''}. Refreshing picks…`)
      await generate()
    } catch (err) {
      setRerunMsg(null)
      setError(err.response?.data?.error || err.message || 'Engine run failed.')
    } finally {
      setRerunning(false)
      setTimeout(() => setRerunMsg(null), 4000)
    }
  }

  const mergeAnalysis = useCallback((pick, r) => ({
    ...pick,
    // Track original engine pick so we can show a "changed" badge
    originalMarket:    pick.market,
    originalSelection: pick.selection,
    market: r.market, selection: r.selection, odds: r.odds,
    value: r.value, reason: r.reason, hasClaudeAnalysis: true,
    verdict: r.verdict, claudeConf: r.claudeConf, predictedScore: r.predictedScore,
    modelAgreement: r.modelAgreement, riskFactor: r.riskFactor,
    formEdge: r.formEdge, injuryImpact: r.injuryImpact,
    keyFactors: r.keyFactors, fullAnalysis: r.fullAnalysis,
    bestBet: r.bestBet, valueBet: r.valueBet,
    newsVerdict: r.newsVerdict, newsSentiment: r.newsSentiment,
    newsAgreement: r.newsAgreement, newsShift: r.newsShift,
    updatedBestBet: r.updatedBestBet, newsAnalysisText: r.newsAnalysisText,
  }), [])

  async function analyseSelected() {
    if (!selected.size) return
    setAnalysing(true)
    const fixtureIds = [...selected]
    try {
      const { data } = await api.post(`/api/betbuilder/analyse`, { fixtureIds, risk: risks }, { timeout: 10 * 60 * 1000 })
      const byId = {}
      for (const r of (data.results || [])) byId[r.fixtureId] = r
      setPicks(prev => prev.map(p => {
        const r = byId[p.fixtureId]
        if (!r) return p
        return mergeAnalysis(p, r)
      }))
      setExpandedAI(prev => { const s = new Set(prev); fixtureIds.forEach(id => s.add(id)); return s })
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Claude analysis failed.')
    } finally {
      setAnalysing(false)
    }
  }

  async function getSportybetCode() {
    const selectedPicks = picks.filter(p => selected.has(p.fixtureId))
    if (!selectedPicks.length) return
    setSbLoading(true)
    setSbResult(null)
    try {
      const payload = selectedPicks.map(p => ({
        homeTeam:  p.match?.split(' v ')[0]?.trim() || '',
        awayTeam:  p.match?.split(' v ')[1]?.trim() || '',
        market:    p.market,
        selection: p.selection,
        odds:      p.odds,
        date:      p.fixtureDate,
      }))
      const { data } = await api.post(`/api/sportybet/booking-code`, { picks: payload, debug: sbDebug }, { timeout: 10 * 60 * 1000 })
      setSbResult(data)
    } catch (err) {
      setSbResult({ success: false, error: err.response?.data?.error || err.message })
    } finally {
      setSbLoading(false)
    }
  }

  async function enrichOne(fixtureId, market, selection) {
    if (!fixtureId || enrichingId) return
    setEnrichingId(fixtureId)
    try {
      const { data } = await api.post(`/api/betbuilder/enrich`, { fixtureId, market, selection })
      setPicks(prev => prev.map(p => p.fixtureId === fixtureId
        ? { ...p, dataFlags: data.dataFlags, dataVerified: data.dataVerified }
        : p
      ))
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Enrichment failed.')
    } finally {
      setEnrichingId(null)
    }
  }

  async function analyseOne(fixtureId) {
    if (!fixtureId || analysingId) return
    setAnalysingId(fixtureId)
    try {
      const { data } = await api.post(`/api/betbuilder/analyse`, { fixtureIds: [fixtureId], risk: risks }, { timeout: 10 * 60 * 1000 })
      const r = (data.results || [])[0]
      if (r) {
        setPicks(prev => prev.map(p => p.fixtureId === fixtureId ? mergeAnalysis(p, r) : p))
        setExpandedAI(prev => { const s = new Set(prev); s.add(fixtureId); return s })
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Claude analysis failed.')
    } finally {
      setAnalysingId(null)
    }
  }

  const sorted = [...picks].sort((a, b) => {
    if (sortBy === 'prob')  return parseFloat(b.modelProb) - parseFloat(a.modelProb)
    if (sortBy === 'time')  return new Date(a.fixtureDate) - new Date(b.fixtureDate)
    if (sortBy === 'odds')  return (b.odds || 0) - (a.odds || 0)
    return (b.certaintyScore ?? 0) - (a.certaintyScore ?? 0)
  })

  const totalPages   = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const displayPicks = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const rOpt = RISK_OPTIONS.find(r => r.key === (risks.includes('high') ? 'high' : risks.includes('medium') ? 'medium' : 'low'))

  return (
    <div style={{ minHeight: '100vh', background: '#0a0e1a', color: '#e2e8f0', fontFamily: 'system-ui, sans-serif' }}>

      {/* Nav */}
      <div style={{ background: '#111827', borderBottom: '1px solid #1f2937', padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 20 }}>
        <Link to="/" style={{ color: '#68d391', textDecoration: 'none', fontSize: 13 }}>← Dashboard</Link>
        <Link to="/betslip" style={{ color: '#718096', textDecoration: 'none', fontSize: 13 }}>Bet Slip Analyzer</Link>
        <span style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0', marginLeft: 'auto' }}>Bet Builder</span>
      </div>

      <div style={{ maxWidth: 900, margin: '0 auto', padding: '28px 16px' }}>

        {/* Form */}
        <div style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 12, padding: 20, marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {/* Fixture window */}
            <div style={{ flex: 1, minWidth: 160 }}>
              <div style={{ fontSize: 11, color: '#718096', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Fixture Window</div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                {[['quick','Quick'],['pick','Date']].map(([m,l]) => (
                  <button key={m} onClick={() => setDateMode(m)} style={{ flex: 1, padding: '6px 10px', borderRadius: 7, fontSize: 12, cursor: 'pointer', background: dateMode===m ? '#1a2a4a' : '#1a2030', color: dateMode===m ? '#90cdf4' : '#718096', border: `1px solid ${dateMode===m ? '#2b6cb0' : '#2d3748'}`, fontWeight: dateMode===m ? 700 : 400 }}>{l}</button>
                ))}
              </div>
              {dateMode === 'quick' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {Object.entries(DURATION_LABELS).map(([k, l]) => (
                    <button key={k} onClick={() => setDuration(k)} style={{ padding: '7px 12px', borderRadius: 7, fontSize: 13, cursor: 'pointer', textAlign: 'left', background: duration===k ? '#1a2a4a' : '#1a2030', color: duration===k ? '#90cdf4' : '#718096', border: `1px solid ${duration===k ? '#2b6cb0' : '#2d3748'}`, fontWeight: duration===k ? 700 : 400 }}>{l}</button>
                  ))}
                </div>
              )}
              {dateMode === 'pick' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {[['From', fromDate, v => { setFromDate(v); if (v > toDate) setToDate(v) }, null],
                    ['To',   toDate,   v => setToDate(v), fromDate]].map(([lbl, val, fn, min]) => (
                    <div key={lbl}>
                      <div style={{ fontSize: 10, color: '#718096', marginBottom: 3 }}>{lbl}</div>
                      <input type="date" value={val} min={min || undefined} onChange={e => fn(e.target.value)}
                        style={{ width: '100%', boxSizing: 'border-box', background: '#0a0e1a', border: '1px solid #2b6cb0', color: '#e2e8f0', borderRadius: 6, padding: '7px 10px', fontSize: 13 }} />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Risk */}
            <div style={{ flex: 2, minWidth: 220 }}>
              <div style={{ fontSize: 11, color: '#718096', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Risk Level</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {RISK_OPTIONS.map(r => {
                  const active = risks.includes(r.key)
                  return (
                    <button key={r.key} onClick={() => toggleRisk(r.key)} style={{ flex: 1, minWidth: 110, padding: '10px 12px', borderRadius: 10, cursor: 'pointer', background: active ? r.activeBg : r.bg, border: `2px solid ${active ? r.color : r.border}`, textAlign: 'left', position: 'relative' }}>
                      {active && <span style={{ position: 'absolute', top: 6, right: 8, fontSize: 10, color: r.color, fontWeight: 800 }}>✓</span>}
                      <div style={{ fontSize: 13, fontWeight: 700, color: r.color, marginBottom: 2 }}>{r.emoji} {r.label}</div>
                      <div style={{ fontSize: 11, color: active ? r.color : '#718096' }}>{r.desc}</div>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 11, color: '#718096', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Fetch top</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {[50, 100, 500, 1000, 2000].map(n => (
                  <button key={n} onClick={() => setLimit(n)} style={{ padding: '6px 12px', borderRadius: 7, fontSize: 13, fontWeight: 700, cursor: 'pointer', background: limit === n ? '#1a3a2a' : '#1a2030', color: limit === n ? '#68d391' : '#718096', border: `1px solid ${limit === n ? '#48bb78' : '#2d3748'}` }}>{n >= 1000 ? `${n/1000}k` : n}</button>
                ))}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#718096', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Filter</div>
              <button
                onClick={() => setShowAll(v => !v)}
                title={showAll ? 'Showing ALL matches — risk gates disabled' : 'Only showing matches that pass the selected risk tier'}
                style={{ padding: '6px 14px', borderRadius: 7, fontSize: 13, fontWeight: 700, cursor: 'pointer', background: showAll ? '#2a1a3a' : '#1a2030', color: showAll ? '#b794f4' : '#718096', border: `1px solid ${showAll ? '#805ad5' : '#2d3748'}` }}
              >
                {showAll ? '🔓 All matches' : '🎯 Filtered'}
              </button>
              <button
                onClick={() => { const v = !valueMode; setValueMode(v); generate({ valueMode: v }) }}
                disabled={loading || rerunning}
                title="Value mode: show only bets where the model disagrees with a REAL bookmaker price by at least the chosen edge, ranked by edge. Ignores risk tiers. Expect a handful per week, not a full slate — and only fixtures whose odds we have stored can qualify."
                style={{ padding: '6px 14px', borderRadius: 7, fontSize: 13, fontWeight: 700, cursor: (loading || rerunning) ? 'not-allowed' : 'pointer', background: valueMode ? '#2a2410' : '#1a2030', color: valueMode ? '#f6e05e' : '#718096', border: `1px solid ${valueMode ? '#d69e2e' : '#2d3748'}` }}
              >
                {valueMode ? '💎 Value' : '💎 Value off'}
              </button>
              {valueMode && (
                <select value={minEdge} onChange={e => { setMinEdge(Number(e.target.value)); }} disabled={loading}
                  title="Minimum model-vs-market disagreement. Below 10pp the market has historically been the better forecaster."
                  style={{ padding: '6px 8px', borderRadius: 7, fontSize: 12, fontWeight: 700, background: '#1a2030', color: '#f6e05e', border: '1px solid #d69e2e', cursor: 'pointer' }}>
                  <option value={0.05}>≥5pp (weak)</option>
                  <option value={0.08}>≥8pp</option>
                  <option value={0.10}>≥10pp</option>
                  <option value={0.15}>≥15pp (rare)</option>
                </select>
              )}
            </div>
            <button onClick={generate} disabled={loading || rerunning} style={{ flex: 1, padding: '12px 24px', borderRadius: 10, fontSize: 15, fontWeight: 800, cursor: (loading || rerunning) ? 'not-allowed' : 'pointer', background: loading ? '#1a3a2a' : 'linear-gradient(135deg,#276749,#2f855a)', color: loading ? '#48bb78' : '#f0fff4', border: '1px solid #48bb78' }}>
              {loading ? 'Fetching picks…' : showAll ? `Get All Matches (${risks.map(r => RISK_OPTIONS.find(o=>o.key===r)?.label).join('+')} filter off)` : `Get Top ${limit} Picks — ${risks.map(r => RISK_OPTIONS.find(o=>o.key===r)?.label).join(' + ')}`}
            </button>
            <button onClick={() => rerunPredictions({ scope: 'picks' })} disabled={loading || rerunning} title="Re-run the engine on the fixtures currently listed only. Fast, but a fixture that is not already in the list cannot appear — use Rerun All for that." style={{ padding: '12px 18px', borderRadius: 10, fontSize: 13, fontWeight: 800, cursor: (loading || rerunning) ? 'not-allowed' : 'pointer', background: rerunning ? '#1a2a3a' : '#1a2030', color: rerunning ? '#90cdf4' : '#4a5568', border: '1px solid #2d3748', whiteSpace: 'nowrap' }}>
              {rerunning ? '⚙️ Running engine…' : '⚙️ Rerun Listed'}
            </button>
            <button onClick={() => rerunPredictions({ scope: 'window' })} disabled={loading || rerunning} title="Re-run the engine on EVERY upcoming fixture in the selected date window, so fixtures that previously missed the risk gate can re-enter the list. Slow — 15-30 min for a week." style={{ padding: '12px 18px', borderRadius: 10, fontSize: 13, fontWeight: 800, cursor: (loading || rerunning) ? 'not-allowed' : 'pointer', background: rerunning ? '#1a2a3a' : '#2a2030', color: rerunning ? '#90cdf4' : '#d69e2e', border: '1px solid #744210', whiteSpace: 'nowrap' }}>
              ⚙️ Rerun All
            </button>
            <button onClick={() => rerunPredictions({ scope: 'window', refreshOdds: true })} disabled={loading || rerunning} title="Rerun All, and also re-fetch live bookmaker odds for every fixture. Slowest option and it consumes API-Football quota — use when prices have moved." style={{ padding: '12px 14px', borderRadius: 10, fontSize: 13, fontWeight: 800, cursor: (loading || rerunning) ? 'not-allowed' : 'pointer', background: rerunning ? '#1a2a3a' : '#2a1a2a', color: rerunning ? '#90cdf4' : '#b794f4', border: '1px solid #553c9a', whiteSpace: 'nowrap' }}>
              ⚙️+💰 All&nbsp;+&nbsp;Odds
            </button>
          </div>
          {rerunMsg && (
            <div style={{ fontSize: 12, color: '#90cdf4', textAlign: 'center', marginTop: 4 }}>{rerunMsg}</div>
          )}

          {loading && !picks.length && (
            <div style={{ fontSize: 12, color: '#718096', textAlign: 'center' }}>
              {loadMessage || 'Loading picks from database…'}
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div style={{ background: '#3a1a1a', border: '1px solid #742a2a', borderRadius: 10, padding: '12px 16px', marginBottom: 16, color: '#fc8181', fontSize: 13 }}>
            {error}
          </div>
        )}

        {/* In-flight batch banner — shown while first batch is displayed but more are coming */}
        {picks.length > 0 && loadProgress && (
          <div style={{ background: '#1a2030', border: '1px solid #2b6cb0', borderRadius: 8, padding: '10px 16px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 13, color: '#90cdf4', fontWeight: 700 }}>
              Showing {loadProgress.sent} of {loadProgress.total} picks — loading more…
            </span>
            <div style={{ flex: 1, height: 4, background: '#0a0e1a', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${Math.round(loadProgress.sent / loadProgress.total * 100)}%`, background: '#2b6cb0', borderRadius: 4, transition: 'width 0.3s ease' }} />
            </div>
          </div>
        )}

        {/* Results */}
        {picks.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

            {/* Summary bar */}
            <div style={{ background: `linear-gradient(135deg,${rOpt.bg},#0a0e1a)`, border: `1px solid ${rOpt.border}`, borderRadius: 10, padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
              <div>
                <div style={{ fontSize: 11, color: rOpt.color, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
                  {picks.length} picks · {meta?.fixturesScanned} fixtures scanned · {risks.map(r => RISK_OPTIONS.find(o=>o.key===r)?.label).join(' + ')}
                </div>
                <div style={{ fontSize: 11, color: '#718096' }}>
                  {picks.filter(p=>p.hasClaudeAnalysis).length} AI-analysed · {selected.size} selected · page {page}/{totalPages}
                  {meta?.failedEnrichment > 0 && (
                    <span title="Picks excluded because form/standings/H2H contradicted the model" style={{ marginLeft: 8, color: '#fc8181' }}>
                      · {meta.failedEnrichment} blocked by data
                    </span>
                  )}
                  {meta?.debug?.noPred > 0 && (
                    <span title="These fixtures have no prediction — run the engine on them first" style={{ marginLeft: 8, color: '#4a5568' }}>
                      · {meta.debug.noPred} no prediction
                    </span>
                  )}
                  {!showAll && meta && meta.fixturesScanned > picks.length && (
                    <span style={{ marginLeft: 8, color: '#4a5568' }}>
                      · {meta.fixturesScanned - picks.length} filtered out —{' '}
                      <button onClick={() => { setShowAll(true); generate({ showAll: true }) }} style={{ background: 'none', border: 'none', color: '#90cdf4', cursor: 'pointer', fontSize: 11, padding: 0, textDecoration: 'underline' }}>
                        show all
                      </button>
                    </span>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                {selected.size > 0 && (
                  <button onClick={analyseSelected} disabled={analysing} style={{ padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: analysing ? 'not-allowed' : 'pointer', background: analysing ? '#1a2a3a' : '#1a2a4a', color: analysing ? '#718096' : '#90cdf4', border: '1px solid #2b6cb0' }}>
                    {analysing ? 'Running Claude…' : `Analyse ${selected.size} Selected`}
                  </button>
                )}
                {selected.size > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <button onClick={getSportybetCode} disabled={sbLoading} style={{ padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: sbLoading ? 'not-allowed' : 'pointer', background: sbLoading ? '#1a2a1a' : '#0f2a1a', color: sbLoading ? '#718096' : '#68d391', border: '1px solid #276749', whiteSpace: 'nowrap' }}>
                      {sbLoading ? 'Adding to SportyBet…' : `🎰 SportyBet Code (${selected.size})`}
                    </button>
                    <label title="Show browser window so you can see what's happening" style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: sbDebug ? '#ecc94b' : '#4a5568', cursor: 'pointer', userSelect: 'none' }}>
                      <input type="checkbox" checked={sbDebug} onChange={e => setSbDebug(e.target.checked)} style={{ cursor: 'pointer' }} />
                      Debug
                    </label>
                  </div>
                )}
                <button onClick={() => smartPick(10)} disabled={analysing} title="Auto-select the top 10 highest-certainty picks for the selected risk level and confirm the best bet for each" style={{ padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 800, cursor: analysing ? 'not-allowed' : 'pointer', background: analysing ? '#1a3a2a' : 'linear-gradient(135deg,#276749,#2f855a)', color: analysing ? '#48bb78' : '#f0fff4', border: '1px solid #48bb78', whiteSpace: 'nowrap' }}>
                  {analysing ? '🎯 Picking bets…' : '🎯 Smart Pick 10'}
                </button>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <button onClick={() => goalsPick(goalsPickCount)} disabled={analysing} title="Auto-select top goal-heavy picks (Over 1.5 / Over 2.5 / BTTS) — uses fast Claude Haiku for quick analysis" style={{ padding: '8px 16px', borderRadius: '8px 0 0 8px', fontSize: 13, fontWeight: 800, cursor: analysing ? 'not-allowed' : 'pointer', background: analysing ? '#1a2a3a' : 'linear-gradient(135deg,#1a3a5a,#2b6cb0)', color: analysing ? '#718096' : '#bee3f8', border: '1px solid #3182ce', borderRight: 'none', whiteSpace: 'nowrap' }}>
                    ⚽ Goals Pick {goalsPickCount}
                  </button>
                  <select value={goalsPickCount} onChange={e => setGoalsPickCount(Number(e.target.value))} disabled={analysing} style={{ padding: '8px 6px', borderRadius: '0 8px 8px 0', fontSize: 13, fontWeight: 700, background: '#1a2a3a', color: '#bee3f8', border: '1px solid #3182ce', cursor: 'pointer' }}>
                    {[5, 10, 20, 50].map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
                <span style={{ fontSize: 11, color: '#4a5568' }}>Sort:</span>
                {[['score','Score'],['prob','Model %'],['odds','Odds'],['time','Time']].map(([k,l]) => (
                  <button key={k} onClick={() => setSortBy(k)} style={{ padding: '5px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: sortBy===k ? '#1a2a4a' : '#1a2030', color: sortBy===k ? '#90cdf4' : '#718096', border: `1px solid ${sortBy===k ? '#2b6cb0' : '#2d3748'}` }}>{l}</button>
                ))}
              </div>
            </div>

            {/* Picks table */}
            <div style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 10, overflow: 'hidden' }}>

              {/* Header */}
              <div style={{ display: 'grid', gridTemplateColumns: '32px 2fr 1.2fr 1.1fr 1.1fr 0.65fr 0.75fr 0.85fr 2fr 56px', gap: 8, padding: '8px 14px', background: '#0a0e1a', borderBottom: '1px solid #1f2937' }}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <input type="checkbox" checked={selected.size === picks.length && picks.length > 0} onChange={selectAll} style={{ cursor: 'pointer' }} />
                </div>
                {['Match','League','Market','Selection','Odds','Model %','Value','Reason / Blend',''].map((h,i) => (
                  <div key={i} style={{ fontSize: 10, color: '#4a5568', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</div>
                ))}
              </div>

              {/* Rows */}
              {displayPicks.map((pick, i) => {
                const isSel = selected.has(pick.fixtureId)
                const hasAI = pick.hasClaudeAnalysis
                const pickChanged = hasAI && pick.originalMarket && (
                  pick.market !== pick.originalMarket || pick.selection !== pick.originalSelection
                )
                const valColor = pick.value === 'Good value' ? '#68d391'
                               : pick.value === 'Poor value' ? '#fc8181'
                               : '#ecc94b'
                const valBg    = pick.value === 'Good value' ? '#0f2a1a'
                               : pick.value === 'Poor value' ? '#2a0f0f'
                               : '#2a2510'
                const optRows  = (pick.options || []).map((opt, j) => (
                  <div key={`${pick.fixtureId ?? i}-opt-${j}`} style={{ display: 'grid', gridTemplateColumns: '32px 2fr 1.2fr 1.1fr 1.1fr 0.65fr 0.75fr 0.85fr 2fr 56px', gap: 8, padding: '5px 14px 5px 28px', borderTop: '1px solid #111827', background: '#0b0f1c', alignItems: 'center', borderLeft: '3px solid #1e3a5a' }}>
                    <div />
                    <div style={{ fontSize: 10, color: '#2d4a6a' }}>└ Option {j + 2}</div>
                    <div />
                    <div style={{ fontSize: 11, color: '#4a6080' }}>{opt.market}</div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#7097b8' }}>{opt.selection}</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#8a7a40' }}>{opt.odds}x</div>
                    <div style={{ fontSize: 11, color: '#4a7a5a', fontWeight: 700 }}>{opt.modelProb}</div>
                    <div /><div /><div />
                  </div>
                ))
                // Goals line, shown only when the main pick is NOT already a goals market.
                // High Risk picks come out as 1X2 almost every time, yet those fixtures are the
                // highest-scoring on the card — this surfaces the goals market before kickoff
                // instead of leaving it to be noticed in the final score.
                const g = pick.goalsOption
                const goalsRow = (g && !GOAL_MARKETS.includes(pick.selection)) ? (
                  <div key={`${pick.fixtureId ?? i}-goals`} style={{ display: 'grid', gridTemplateColumns: '32px 2fr 1.2fr 1.1fr 1.1fr 0.65fr 0.75fr 0.85fr 2fr 56px', gap: 8, padding: '5px 14px 5px 28px', borderTop: '1px solid #111827', background: '#0b1410', alignItems: 'center', borderLeft: '3px solid #2f6b4a' }}>
                    <div />
                    <div style={{ fontSize: 10, color: '#3d6b52' }}>└ ⚽ Goals</div>
                    <div />
                    <div style={{ fontSize: 11, color: '#4a806a' }}>{g.market}</div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#68b892' }}>{g.selection}</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#8a7a40' }}>{g.odds}x{g.hasRealOdds ? '' : '*'}</div>
                    <div style={{ fontSize: 11, color: '#48bb78', fontWeight: 700 }}>{g.modelProb}</div>
                    <div /><div /><div />
                  </div>
                ) : null
                const aiExpanded = expandedAI.has(pick.fixtureId)
                return [
                  <div key={pick.fixtureId ?? i} style={{ display: 'grid', gridTemplateColumns: '32px 2fr 1.2fr 1.1fr 1.1fr 0.65fr 0.75fr 0.85fr 2fr 56px', gap: 8, padding: '10px 14px', borderTop: '1px solid #1a2030', background: isSel ? '#0f1a2a' : hasAI ? '#0b140b' : undefined, alignItems: 'center', cursor: 'pointer' }} onClick={() => pick.fixtureId && toggleSelect(pick.fixtureId)}>

                    <div onClick={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center' }}>
                      <input type="checkbox" checked={isSel} onChange={() => toggleSelect(pick.fixtureId)} disabled={!pick.fixtureId} style={{ cursor: 'pointer' }} />
                    </div>

                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        {pick.match}
                        {pick.tier === 'low'    && <span title="Passed Low Risk gate — high certainty pick" style={{ fontSize: 9, background: '#0f2a1a', color: '#68d391', border: '1px solid #276749', borderRadius: 4, padding: '1px 5px', fontWeight: 700 }}>🛡 LOW</span>}
                        {pick.tier === 'medium' && <span title="Passed Medium Risk gate — moderate certainty" style={{ fontSize: 9, background: '#2a2510', color: '#ecc94b', border: '1px solid #744210', borderRadius: 4, padding: '1px 5px', fontWeight: 700 }}>⚖ MED</span>}
                        {pick.tier === 'high'   && <span title="High Risk pick — uncertain, value-hunting" style={{ fontSize: 9, background: '#2a0f0f', color: '#fc8181', border: '1px solid #742a2a', borderRadius: 4, padding: '1px 5px', fontWeight: 700 }}>🔥 HIGH</span>}
                        {pick.tier === 'none'   && <span title="Does not pass any risk tier — model confidence too low" style={{ fontSize: 9, background: '#1a1a2a', color: '#4a5568', border: '1px solid #2d3748', borderRadius: 4, padding: '1px 5px' }}>NO TIER</span>}
                        {pick.dataVerified === 'confirmed' && <span title="Form/standings/H2H confirm this pick" style={{ fontSize: 9, background: '#0f2a1a', color: '#68d391', border: '1px solid #276749', borderRadius: 4, padding: '1px 5px', fontWeight: 700 }}>✓ DATA</span>}
                        {pick.dataVerified === 'risky'     && <span title="Data raises concerns — check flags below" style={{ fontSize: 9, background: '#2a0f0f', color: '#fc8181', border: '1px solid #742a2a', borderRadius: 4, padding: '1px 5px', fontWeight: 700 }}>⚠ CHECK</span>}
                        {pick.dataVerified === 'mixed'     && <span title="Mixed signals from data" style={{ fontSize: 9, background: '#2a2510', color: '#ecc94b', border: '1px solid #744210', borderRadius: 4, padding: '1px 5px', fontWeight: 700 }}>~ MIXED</span>}
                        {pick.dataVerified === 'unverified'&& <span title="No enrichment data yet — click AI to fetch" style={{ fontSize: 9, background: '#1a1a2a', color: '#4a5568', border: '1px solid #2d3748', borderRadius: 4, padding: '1px 5px' }}>NO DATA</span>}
                        {pick.claudeConf === 'Medium' && <span title="Claude rated this Medium confidence — not High. Review before selecting." style={{ fontSize: 9, background: '#2a2510', color: '#ecc94b', border: '1px solid #744210', borderRadius: 4, padding: '1px 5px' }}>AI: Medium</span>}
                        {pick.claudeConf === 'Low'    && <span title="Claude rated this Low confidence. High risk pick." style={{ fontSize: 9, background: '#2a0f0f', color: '#fc8181', border: '1px solid #742a2a', borderRadius: 4, padding: '1px 5px' }}>AI: Low</span>}
                      </div>
                      {pick.fixtureDate && <div style={{ fontSize: 10, color: '#4a5568', marginTop: 1 }}>{fmt(pick.fixtureDate)}</div>}
                      {pick.dataFlags?.filter(f => f.type !== 'info' || pick.dataVerified === 'unverified').slice(0, 3).map((f, fi) => (
                        <div key={fi} style={{ fontSize: 9, marginTop: 2, color: f.type === 'good' ? '#68d391' : f.type === 'warn' ? '#fc8181' : '#4a5568' }}>
                          {f.label}
                        </div>
                      ))}
                      {pick.newsSentiment && (() => {
                        const c = pick.newsSentiment === 'Home-favoured' ? '#90cdf4'
                                : pick.newsSentiment === 'Away-favoured' ? '#f6ad55'
                                : pick.newsSentiment === 'Draw-likely'   ? '#b794f4'
                                : '#718096'
                        return (
                          <div style={{ fontSize: 9, color: c, marginTop: 3, display: 'flex', alignItems: 'center', gap: 3 }}>
                            <span>News:</span>
                            <span style={{ fontWeight: 700 }}>{pick.newsSentiment}</span>
                            {pick.newsAgreement === false && <span style={{ color: '#fc8181' }}>⚠ conflicts model</span>}
                            {pick.newsShift === 'Higher' && <span style={{ color: '#68d391' }}>↑</span>}
                            {pick.newsShift === 'Lower'  && <span style={{ color: '#fc8181' }}>↓</span>}
                          </div>
                        )
                      })()}
                    </div>

                    <div style={{ fontSize: 11, color: '#718096', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pick.league}</div>

                    <div style={{ fontSize: 11, color: pickChanged ? '#f6ad55' : '#90cdf4' }}>
                      {pick.market}
                      {pickChanged && pick.market !== pick.originalMarket && (
                        <span title={`Engine suggested: ${pick.originalMarket}`} style={{ display: 'block', fontSize: 9, color: '#718096', textDecoration: 'line-through' }}>{pick.originalMarket}</span>
                      )}
                    </div>

                    <div style={{ fontSize: 12, fontWeight: 700, color: pickChanged ? '#f6ad55' : '#bee3f8' }}>
                      {pick.selection}
                      {pickChanged && pick.selection !== pick.originalSelection && (
                        <span title={`Engine suggested: ${pick.originalSelection}`} style={{ display: 'block', fontSize: 9, fontWeight: 400, color: '#718096', textDecoration: 'line-through' }}>{pick.originalSelection}</span>
                      )}
                    </div>

                    <div style={{ fontSize: 13, fontWeight: 800, color: pick.odds < 1.35 ? '#fc8181' : '#ecc94b', display: 'flex', alignItems: 'center', gap: 3 }}>
                      {pick.odds}x
                      {pick.odds < 1.35 && <span title="Very short odds — model may be overconfident. One loss costs many wins." style={{ fontSize: 10, color: '#fc8181' }}>⚠</span>}
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {pick.modelProb && <span style={{ fontSize: 12, color: '#68d391', fontWeight: 700 }}>{pick.modelProb}</span>}
                      {/* Edge is only meaningful against a REAL price — against estOdds it is
                          structurally zero, since estOdds is derived from modelProb itself. */}
                      {pick.hasRealOdds && pick.edge != null && (
                        <span title={`Model ${pick.modelProb} vs bookmaker ${(pick.bookImplied * 100).toFixed(0)}% implied`}
                          style={{ fontSize: 10, marginLeft: 5, fontWeight: 800, padding: '1px 5px', borderRadius: 4,
                            background: pick.edge >= 0.10 ? '#2a2410' : pick.edge > 0 ? '#12211a' : '#241414',
                            color: pick.edge >= 0.10 ? '#f6e05e' : pick.edge > 0 ? '#68d391' : '#fc8181',
                            border: `1px solid ${pick.edge >= 0.10 ? '#d69e2e' : pick.edge > 0 ? '#2f6b4a' : '#742a2a'}` }}>
                          {pick.edge >= 0 ? '+' : ''}{(pick.edge * 100).toFixed(0)}pp
                        </span>
                      )}
                      {pick.certaintyScore != null && <span style={{ fontSize: 10, color: '#4a5568' }}>{pick.certaintyScore.toFixed(3)}</span>}
                    </div>

                    <div>
                      {pick.value ? (
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 7px', borderRadius: 6, background: valBg, color: valColor, border: `1px solid ${valColor}44`, whiteSpace: 'nowrap' }}>
                          {pick.value === 'Good value' ? '↑ Good' : pick.value === 'Poor value' ? '↓ Poor' : '= Fair'}
                        </span>
                      ) : (
                        <span style={{ fontSize: 10, color: '#2d3748' }}>—</span>
                      )}
                    </div>

                    <div style={{ fontSize: 11, lineHeight: 1.4 }}>
                      {pick.reason ? (
                        <div>
                          {pickChanged && (
                            <div style={{ fontSize: 9, fontWeight: 700, color: '#f6ad55', marginBottom: 3, display: 'flex', alignItems: 'center', gap: 4 }}>
                              <span>↻ AI changed pick</span>
                              {pick.originalSelection && pick.selection !== pick.originalSelection && (
                                <span style={{ color: '#718096', fontWeight: 400 }}>({pick.originalSelection} → {pick.selection})</span>
                              )}
                            </div>
                          )}
                          <span style={{ color: pick.reason ? '#9ae6b4' : '#4a5568' }}>{pick.reason}</span>
                        </div>
                      ) : pick.blend ? (
                        <span style={{ color: '#4a5568' }}>
                          H{(pick.blend.home*100).toFixed(0)} D{(pick.blend.draw*100).toFixed(0)} A{(pick.blend.away*100).toFixed(0)}
                          {pick.over25 != null && ` · O2.5 ${(pick.over25*100).toFixed(0)}%`}
                          {pick.btts   != null && ` · BTTS ${(pick.btts*100).toFixed(0)}%`}
                        </span>
                      ) : (
                        <span style={{ color: '#2d3748' }}>—</span>
                      )}
                    </div>

                    <div onClick={e => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {/* Enrich button — only when no data cached yet */}
                      {pick.dataVerified === 'unverified' && (
                        enrichingId === pick.fixtureId ? (
                          <span style={{ fontSize: 10, color: '#ecc94b' }}>fetching…</span>
                        ) : (
                          <button
                            disabled={!!enrichingId}
                            onClick={e => { e.stopPropagation(); enrichOne(pick.fixtureId, pick.market, pick.selection) }}
                            title="Fetch form, standings & H2H data for this match"
                            style={{ padding: '4px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700, cursor: !!enrichingId ? 'not-allowed' : 'pointer', background: '#2a2510', color: '#ecc94b', border: '1px solid #744210', opacity: (!!enrichingId && enrichingId !== pick.fixtureId) ? 0.4 : 1 }}
                          >
                            + Data
                          </button>
                        )
                      )}
                      {/* AI button */}
                      {analysingId === pick.fixtureId ? (
                        <span style={{ fontSize: 10, color: '#718096' }}>…</span>
                      ) : hasAI ? (
                        <button
                          onClick={e => { e.stopPropagation(); setExpandedAI(prev => { const s = new Set(prev); s.has(pick.fixtureId) ? s.delete(pick.fixtureId) : s.add(pick.fixtureId); return s }) }}
                          title={aiExpanded ? 'Hide AI analysis' : 'Show AI analysis'}
                          style={{ padding: '4px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: aiExpanded ? '#1a3a1a' : '#0b1f0b', color: '#68d391', border: '1px solid #276749' }}
                        >
                          {aiExpanded ? '▲ AI' : '▼ AI'}
                        </button>
                      ) : (
                        <button
                          disabled={!pick.fixtureId || !!analysingId}
                          onClick={e => { e.stopPropagation(); analyseOne(pick.fixtureId) }}
                          title="Run Claude analysis on this pick"
                          style={{ padding: '4px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: (!pick.fixtureId || !!analysingId) ? 'not-allowed' : 'pointer', background: '#1a2a4a', color: '#90cdf4', border: '1px solid #2b6cb0', opacity: (!!analysingId && analysingId !== pick.fixtureId) ? 0.4 : 1 }}
                        >
                          AI
                        </button>
                      )}
                    </div>
                  </div>,
                  ...(goalsRow ? [goalsRow] : []),
                  ...optRows,
                  hasAI && aiExpanded && (
                    <div key={`${pick.fixtureId ?? i}-ai`} style={{ borderTop: '1px solid #1a3a1a', background: '#080f08', padding: '12px 18px 14px 46px' }}>
                      {/* Toggle collapse */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: '#68d391', textTransform: 'uppercase', letterSpacing: '0.06em' }}>AI Analysis</span>
                          {pickChanged && (
                            <span style={{ fontSize: 10, fontWeight: 700, color: '#f6ad55', background: '#2a1a05', border: '1px solid #744210', borderRadius: 5, padding: '2px 7px' }}>
                              ↻ Changed: {pick.originalMarket !== pick.market ? `${pick.originalMarket} → ${pick.market}` : ''}{pick.originalSelection !== pick.selection ? (pick.originalMarket !== pick.market ? ' · ' : '') + `${pick.originalSelection} → ${pick.selection}` : ''}
                            </span>
                          )}
                        </div>
                        <button onClick={e => { e.stopPropagation(); setExpandedAI(prev => { const s = new Set(prev); s.delete(pick.fixtureId); return s }) }}
                          style={{ background: 'none', border: 'none', color: '#4a5568', cursor: 'pointer', fontSize: 13, padding: '0 4px' }}>▲ hide</button>
                      </div>
                      {/* Pick decision reason — shown first when AI changed the pick */}
                      {pick.reason && (
                        <div style={{ marginBottom: 12, background: pickChanged ? '#1a120a' : '#0b130b', border: `1px solid ${pickChanged ? '#744210' : '#1a3a1a'}`, borderRadius: 7, padding: '8px 12px' }}>
                          {pickChanged && <div style={{ fontSize: 9, fontWeight: 700, color: '#f6ad55', textTransform: 'uppercase', marginBottom: 4 }}>Why AI changed this pick</div>}
                          {!pickChanged && <div style={{ fontSize: 9, fontWeight: 700, color: '#4a7a4a', textTransform: 'uppercase', marginBottom: 4 }}>Pick reasoning</div>}
                          <div style={{ fontSize: 12, color: '#c6f6d5', lineHeight: 1.5 }}>{pick.reason}</div>
                        </div>
                      )}

                      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                        {/* Verdict block */}
                        <div style={{ minWidth: 180 }}>
                          {pick.verdict && (
                            <div style={{ marginBottom: 6 }}>
                              <span style={{ fontSize: 11, color: '#4a5568' }}>Verdict: </span>
                              <span style={{ fontSize: 12, fontWeight: 700, color: pick.verdict === 'Home Win' ? '#90cdf4' : pick.verdict === 'Away Win' ? '#f6ad55' : '#b794f4' }}>{pick.verdict}</span>
                              {pick.claudeConf && <span style={{ fontSize: 10, color: pick.claudeConf === 'High' ? '#68d391' : pick.claudeConf === 'Medium' ? '#ecc94b' : '#fc8181', marginLeft: 6, fontWeight: 700 }}>{pick.claudeConf}</span>}
                              {pick.predictedScore && <span style={{ fontSize: 11, color: '#718096', marginLeft: 8 }}>({pick.predictedScore})</span>}
                            </div>
                          )}
                          {pick.modelAgreement && (
                            <div style={{ fontSize: 10, color: pick.modelAgreement === 'Strong' ? '#68d391' : pick.modelAgreement === 'Conflicting' ? '#fc8181' : '#ecc94b', marginBottom: 4 }}>
                              Models: {pick.modelAgreement}
                            </div>
                          )}
                          {pick.riskFactor && <div style={{ fontSize: 10, color: '#fc8181', marginBottom: 4 }}>Risk: {pick.riskFactor}</div>}
                          {pick.formEdge && pick.formEdge !== 'Neutral' && <div style={{ fontSize: 10, color: '#90cdf4', marginBottom: 4 }}>Form edge: {pick.formEdge}</div>}
                          {pick.injuryImpact && pick.injuryImpact !== 'None' && <div style={{ fontSize: 10, color: '#f6ad55', marginBottom: 4 }}>Injuries: {pick.injuryImpact} impact</div>}
                        </div>

                        {/* Best/Value bets */}
                        <div style={{ minWidth: 200 }}>
                          {pick.bestBet && (
                            <div style={{ marginBottom: 8 }}>
                              <div style={{ fontSize: 10, color: '#68d391', textTransform: 'uppercase', marginBottom: 3 }}>Best Bet</div>
                              <div style={{ fontSize: 12, color: '#9ae6b4', lineHeight: 1.4 }}>{pick.bestBet}</div>
                            </div>
                          )}
                          {pick.valueBet && (
                            <div>
                              <div style={{ fontSize: 10, color: '#ecc94b', textTransform: 'uppercase', marginBottom: 3 }}>Value Bet</div>
                              <div style={{ fontSize: 12, color: '#faf089', lineHeight: 1.4 }}>{pick.valueBet}</div>
                            </div>
                          )}
                          {pick.updatedBestBet && (
                            <div style={{ marginTop: 8 }}>
                              <div style={{ fontSize: 10, color: '#90cdf4', textTransform: 'uppercase', marginBottom: 3 }}>News-updated Pick</div>
                              <div style={{ fontSize: 12, color: '#bee3f8', lineHeight: 1.4 }}>{pick.updatedBestBet}</div>
                            </div>
                          )}
                        </div>

                        {/* Key factors + full analysis */}
                        <div style={{ flex: 1, minWidth: 220 }}>
                          {pick.keyFactors?.length > 0 && (
                            <div style={{ marginBottom: 8 }}>
                              <div style={{ fontSize: 10, color: '#718096', textTransform: 'uppercase', marginBottom: 4 }}>Key Factors</div>
                              {pick.keyFactors.map((f, fi) => (
                                <div key={fi} style={{ fontSize: 11, color: '#a0aec0', marginBottom: 2 }}>· {f}</div>
                              ))}
                            </div>
                          )}
                          {pick.fullAnalysis && (
                            <div>
                              <div style={{ fontSize: 10, color: '#718096', textTransform: 'uppercase', marginBottom: 4 }}>Analysis</div>
                              <div style={{ fontSize: 11, color: '#718096', lineHeight: 1.5 }}>{pick.fullAnalysis}</div>
                            </div>
                          )}
                          {pick.newsAnalysisText && (
                            <div style={{ marginTop: 8 }}>
                              <div style={{ fontSize: 10, color: '#90cdf4', textTransform: 'uppercase', marginBottom: 4 }}>News</div>
                              <div style={{ fontSize: 11, color: '#718096', lineHeight: 1.5 }}>{pick.newsAnalysisText}</div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ),
                ]
              })}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                  style={{ padding: '8px 20px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: page === 1 ? 'not-allowed' : 'pointer', background: '#1a2030', color: page === 1 ? '#2d3748' : '#90cdf4', border: `1px solid ${page === 1 ? '#2d3748' : '#2b6cb0'}` }}>
                  ← Prev
                </button>
                <span style={{ fontSize: 12, color: '#718096' }}>
                  Page <b style={{ color: '#e2e8f0' }}>{page}</b> of <b style={{ color: '#e2e8f0' }}>{totalPages}</b>
                  <span style={{ marginLeft: 8, color: '#4a5568' }}>({picks.length} picks total)</span>
                </span>
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                  style={{ padding: '8px 20px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: page === totalPages ? 'not-allowed' : 'pointer', background: '#1a2a4a', color: page === totalPages ? '#2d3748' : '#90cdf4', border: `1px solid ${page === totalPages ? '#2d3748' : '#2b6cb0'}` }}>
                  Next →
                </button>
              </div>
            )}

            {/* SportyBet booking code result */}
            {sbResult && (
              <div style={{ background: sbResult.success ? '#0b1f0b' : '#1f0b0b', border: `1px solid ${sbResult.success ? '#276749' : '#742a2a'}`, borderRadius: 12, padding: '16px 20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: sbResult.success ? '#68d391' : '#fc8181' }}>
                    {sbResult.success ? '✓ SportyBet Booking Code' : '⚠ SportyBet Result'}
                  </span>
                  <button onClick={() => setSbResult(null)} style={{ background: 'none', border: 'none', color: '#718096', cursor: 'pointer', fontSize: 16 }}>✕</button>
                </div>

                {sbResult.code && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                    <div style={{ fontSize: 28, fontWeight: 900, letterSpacing: '0.15em', color: '#f6e05e', background: '#1a1a0a', border: '2px solid #ecc94b', borderRadius: 10, padding: '10px 24px', fontFamily: 'monospace' }}>
                      {sbResult.code}
                    </div>
                    <button
                      onClick={() => navigator.clipboard.writeText(sbResult.code)}
                      style={{ padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', background: '#1a2a1a', color: '#68d391', border: '1px solid #276749' }}
                    >
                      Copy
                    </button>
                    {sbResult.totalOdds && (
                      <div style={{ fontSize: 12, color: '#718096' }}>
                        Combined odds: <b style={{ color: '#ecc94b' }}>{sbResult.totalOdds}x</b>
                      </div>
                    )}
                  </div>
                )}

                {sbResult.error && (
                  <div style={{ fontSize: 12, color: '#fc8181', marginBottom: 10 }}>{sbResult.error}</div>
                )}

                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  {sbResult.added?.length > 0 && (
                    <div>
                      <div style={{ fontSize: 10, color: '#68d391', textTransform: 'uppercase', marginBottom: 6 }}>Added ({sbResult.added.length})</div>
                      {sbResult.added.map((a, i) => (
                        <div key={i} style={{ fontSize: 11, color: '#9ae6b4', marginBottom: 3 }}>✓ {a.label}</div>
                      ))}
                    </div>
                  )}
                  {sbResult.skipped?.length > 0 && (
                    <div>
                      <div style={{ fontSize: 10, color: '#fc8181', textTransform: 'uppercase', marginBottom: 6 }}>Not Found ({sbResult.skipped.length})</div>
                      {sbResult.skipped.map((s, i) => (
                        <div key={i} style={{ fontSize: 11, color: '#fc8181', marginBottom: 3 }}>✗ {s.label}</div>
                      ))}
                    </div>
                  )}
                </div>

                {sbResult.success && (
                  <div style={{ fontSize: 11, color: '#4a5568', marginTop: 10 }}>
                    Enter this code on SportyBet Ghana to load your slip → place bet with your account.
                  </div>
                )}
              </div>
            )}

            {/* Quick summary of AI picks */}
            {picks.some(p => p.hasClaudeAnalysis) && (
              <div style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 10, padding: '12px 16px', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <span style={{ fontSize: 11, color: '#718096' }}>AI picks:</span>
                {picks.filter(p => p.hasClaudeAnalysis).map((p, i) => {
                  const vc = p.value === 'Good value' ? '#68d391' : p.value === 'Poor value' ? '#fc8181' : '#ecc94b'
                  return (
                    <span key={i} style={{ fontSize: 11, background: '#0a0e1a', border: `1px solid ${vc}44`, borderRadius: 6, padding: '3px 10px', color: '#a0aec0' }}>
                      <b style={{ color: '#e2e8f0' }}>{p.match?.split(' v ')[0]}</b> {p.selection} <span style={{ color: '#ecc94b' }}>@{p.odds}</span>
                      {p.value && <span style={{ color: vc, marginLeft: 5, fontWeight: 700 }}>{p.value === 'Good value' ? '↑' : p.value === 'Poor value' ? '↓' : '='}</span>}
                    </span>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
