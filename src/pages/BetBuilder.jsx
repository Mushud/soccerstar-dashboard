import { useState, useCallback, useMemo, memo, useEffect } from 'react'
import api, { API_BASE } from '../api'
import AppShell from '../components/AppShell'
import SmartPickModal from '../components/SmartPickModal'
import { SIDE, SIDE_STYLE, selectionSide, pairedOutcome } from '../marketSides'


const DURATION_LABELS = {
  today:    'Today',
  tomorrow: 'Tomorrow',
  '2days':  'Next 2 Days',
  '3days':  'Next 3 Days',
  week:     'This Week',
}

const RISK_OPTIONS = [
  { key: 'low',    label: 'Low Risk',    emoji: '🛡', desc: 'High confidence only.',     tone: 'pos'  },
  { key: 'medium', label: 'Medium Risk', emoji: '⚖', desc: 'High or Medium confidence.', tone: 'warn' },
  { key: 'high',   label: 'High Risk',   emoji: '🔥', desc: 'Chase value, wider net.',    tone: 'neg'  },
]

const GOAL_MARKETS = ['Over 1.5', 'Over 2.5', 'BTTS']

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
  // Kickoff-window filter, independent of the sort. Sorting by Time alone answers "what is
  // next", and sorting by 1X2 alone answers "what is strongest" — neither answers "what is
  // strongest among the ones about to start", which is the actual question when you are
  // building a slip against a deadline. null = no limit.
  const [withinHours, setWithinHours] = useState(null)
  // A specific kickoff slot ('YYYY-MM-DDTHH', local). Narrows to matches starting in that hour —
  // what you want when the legs of an accumulator should all kick off together, where a rolling
  // "within N hours" window still spans everything before it.
  const [kickoffHour, setKickoffHour] = useState(null)
  const [limit, setLimit]         = useState(1500)
  const [page, setPage]           = useState(1)
  const [showAll, setShowAll]       = useState(false)
  const [valueMode, setValueMode]   = useState(false)   // rank by edge vs the real price
  const [minEdge, setMinEdge]       = useState(0.10)
  const [sbLoading, setSbLoading]   = useState(false)
  const [sbResult, setSbResult]     = useState(null)
  const [sbDebug, setSbDebug]       = useState(false)
  // On by default: when the code is generated, every selected leg is re-checked against the
  // other markets on its own fixture, and swapped if the model AND the price both call the
  // alternative clearly safer. Off leaves your selections exactly as picked.
  const [sbUpgrade, setSbUpgrade]   = useState(true)
  const [expandedAI, setExpandedAI] = useState(new Set())
  const [enrichingId, setEnrichingId] = useState(null)
  const [goalsPickCount, setGoalsPickCount] = useState(10)
  const [smartOpen, setSmartOpen] = useState(false)
  const [rerunning, setRerunning] = useState(false)
  const [rerunMsg, setRerunMsg] = useState(null)

  // Compact rows, ON by default.
  //
  // The table was emitting up to ten visual lines per pick — data flags, a goals/results history
  // block, history warnings, a news line, a goals sub-row and two option sub-rows — so twenty
  // picks filled several screens and the columns stopped reading as a table. Compact keeps one
  // row per pick and moves the rest behind a per-row expander, so scanning a slate is scanning,
  // and the detail is one click away rather than always on.
  const [compact, setCompact] = useState(true)
  const [expandedRow, setExpandedRow] = useState(new Set())

  // Haiku by default for the AI pass. It is the same three calls, just on the fast model.
  const [fastAI, setFastAI] = useState(true)

  // Minimum model probability per leg. 80% by default.
  //
  // This is a LEG floor, not a slip floor, and the difference is the whole point: ten legs at
  // 87% (the measured low-risk hit rate) multiply out to a 25% chance of the slip landing, which
  // is what the "Chance all land" tile has been reporting. No per-leg filter fixes that — 80% on
  // a ten-leg slip needs 97.8% per leg, which no football market offers. What this does is stop
  // weak legs riding along on a slate: it drops the 65-79% band the Low Risk gate still allows.
  const [minLegProb, setMinLegProb] = useState(0.80)
  const [legFloorOn, setLegFloorOn] = useState(true)

  // Target for the whole slip, used to answer "how many legs can I actually carry".
  const [slipTarget, setSlipTarget] = useState(0.80)

  // SportyBet availability, checked for the whole slate in one page load rather than discovered
  // one pick at a time while the booking-code run is already going.
  const [sbChecking, setSbChecking] = useState(false)
  const [sbAvail, setSbAvail]       = useState(null)   // { at, listed, byId: { [fixtureId]: status } }
  const [sbOnly, setSbOnly]         = useState(false)

  // The slate the scheduler already built.
  const [autoSlate, setAutoSlate]       = useState(null)
  const [autoBuilding, setAutoBuilding] = useState(false)
  const [autoDismissed, setAutoDismissed] = useState(false)

  const PAGE_SIZE = 20

  function toggleRisk(key) {
    setRisks(prev => prev.includes(key) ? (prev.length > 1 ? prev.filter(r => r !== key) : prev) : [...prev, key])
  }

  // Identity-stable so PickRow's memo holds. Both use the updater form, so neither closes over
  // `selected` / `expandedAI` and neither needs a dependency on them.
  const toggleSelect = useCallback(id => {
    setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  }, [])

  const toggleAI = useCallback(id => {
    setExpandedAI(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  }, [])

  const toggleRow = useCallback(id => {
    setExpandedRow(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  }, [])

  // Operates on the visible set, not every pick — with a kickoff filter on, ticking the header
  // box should not silently add matches that are filtered out of the table.
  function selectAll() {
    setSelected(visible.length === selected.size ? new Set() : new Set(visible.map(p => p.fixtureId)))
  }

  async function runPickAndAnalyse(fixtureIds, { fast = fastAI, preferGoals = false } = {}) {
    setSelected(new Set(fixtureIds))
    if (!fixtureIds.length) return
    setAnalysing(true)
    try {
      const { data } = await api.post(`/api/betbuilder/analyse`, { fixtureIds, risk: risks, fast, preferGoals }, { timeout: 10 * 60 * 1000 })
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
    // The leg floor is applied FIRST and is not relaxed by the fallbacks below. Those fallbacks
    // exist to widen the data-quality requirement when a slate is thin — widening the
    // probability requirement too would quietly hand back the sub-80% legs the floor is for.
    // `visible`, not `picks`: whatever kickoff window / hour filter is set on the toolbar has
    // already narrowed the list on screen, and picking from outside it would hand back legs the
    // filter was there to exclude.
    const source = visible.length ? visible : picks
    const eligible = legFloorOn
      ? source.filter(p => (p.modelProbRaw ?? 0) >= minLegProb)
      : source
    const ranked = [...eligible].sort((a, b) => (b.certaintyScore ?? 0) - (a.certaintyScore ?? 0))
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
    const ranked = [...(visible.length ? visible : picks)]
      .filter(isGoalMarket)
      // Same floor as smartPick. For a fixture whose goals market is the reason it qualified,
      // the goals market's own probability is what has to clear it — not the main pick's.
      .filter(p => !legFloorOn || (GOAL_MARKETS.includes(p.selection)
        ? (p.modelProbRaw ?? 0) >= minLegProb
        : (p.goalsOption?.modelProbRaw ?? 0) >= minLegProb))
      .sort((a, b) => goalStrength(b) - goalStrength(a))
    let pool = ranked.filter(p => risks.includes(p.tier) && p.dataVerified === 'confirmed')
    if (pool.length < n) pool = ranked.filter(p => risks.includes(p.tier) && p.dataVerified !== 'risky')
    if (pool.length < n) pool = ranked.filter(p => risks.includes(p.tier))
    if (pool.length < n) pool = ranked
    // preferGoals makes the returned leg the goals market itself — without it the analysis
    // hands back the fixture's top-scoring market, which is usually Double Chance.
    await runPickAndAnalyse(pool.slice(0, n).map(p => p.fixtureId).filter(Boolean), { fast: true, preferGoals: true })
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
      const { data } = await api.post(`/api/betbuilder/analyse`, { fixtureIds, risk: risks, fast: fastAI }, { timeout: 10 * 60 * 1000 })
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

  // ── The scheduled slate ─────────────────────────────────────────────────────
  // Checked once on open. Cheap — a stored document, no engine run and no Claude call — so the
  // page can offer this morning's finished slate instead of making you rebuild it.
  useEffect(() => {
    let alive = true
    api.get('/api/betbuilder/auto-slate')
      .then(({ data }) => { if (alive && data?.slate) setAutoSlate({ ...data.slate, stale: data.stale }) })
      .catch(() => { /* nothing stored yet, or the endpoint is older than the frontend */ })
    return () => { alive = false }
  }, [])

  function loadAutoSlate() {
    if (!autoSlate?.picks?.length) return
    // Fixtures that have kicked off since the slate was built are dropped rather than shown as
    // pickable — the same rule the live builder applies.
    const now = Date.now()
    const usable = autoSlate.picks.filter(p => !p.fixtureDate || new Date(p.fixtureDate).getTime() > now)
    setPicks(usable)
    setMeta({ ...(autoSlate.meta || {}), duration: `auto · ${autoSlate.day}`, risk: autoSlate.risk, auto: true })
    setSelected(new Set(usable.map(p => p.fixtureId).filter(Boolean)))
    setPage(1)
    setError(null)
    // The stored slate already carries a SportyBet verdict per pick when the 07:30 run did the
    // check — surface it rather than making the button the only way to see it.
    if (autoSlate.sportybet?.checkedAt) {
      setSbAvail({
        at: autoSlate.sportybet.checkedAt,
        listed: autoSlate.sportybet.listed,
        byId: Object.fromEntries(usable.filter(p => p.sportybet).map(p => [p.fixtureId, p.sportybet])),
      })
    }
  }

  async function buildAutoSlateNow() {
    setAutoBuilding(true)
    setError(null)
    try {
      const { data } = await api.post('/api/betbuilder/auto-slate/run',
        { risk: risks, limit: 10, analyse: true },
        { timeout: 15 * 60 * 1000 })
      const { data: fresh } = await api.get('/api/betbuilder/auto-slate')
      if (fresh?.slate) {
        setAutoSlate({ ...fresh.slate, stale: fresh.stale })
        setAutoDismissed(false)
      } else if (!data?.picks?.length) {
        setError(`Nothing cleared the ${risks.join('/')} gate for today.`)
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Auto slate failed.')
    } finally {
      setAutoBuilding(false)
    }
  }

  // ── SportyBet availability ──────────────────────────────────────────────────
  // One scrape of the card answers the whole slate, so you find out which legs are not even
  // listed BEFORE spending a per-pick browser run on them.
  async function checkSportybet() {
    const target = selected.size ? picks.filter(p => selected.has(p.fixtureId)) : visible
    if (!target.length) return
    setSbChecking(true)
    setError(null)
    try {
      const { data } = await api.post('/api/sportybet/availability', {
        picks: target.map(p => ({
          fixtureId: p.fixtureId,
          homeTeam:  p.match?.split(' v ')[0]?.trim() || '',
          awayTeam:  p.match?.split(' v ')[1]?.trim() || '',
        })),
      }, { timeout: 3 * 60 * 1000 })
      setSbAvail({
        at: data.checkedAt,
        listed: data.listed,
        byId: Object.fromEntries((data.results || []).map(r => [r.id, r.status])),
      })
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'SportyBet check failed.')
    } finally {
      setSbChecking(false)
    }
  }

  async function getSportybetCode({ preview = false } = {}) {
    const selectedPicks = picks.filter(p => selected.has(p.fixtureId))
    if (!selectedPicks.length) return
    setSbLoading(preview ? 'preview' : 'book')
    setSbResult(null)
    try {
      // fixtureId and modelProb travel with the pick so the code can be recorded and graded
      // later — without the fixture there is nothing to settle the leg against, and the slip
      // would be dead weight in the results table.
      const payload = selectedPicks.map(p => ({
        fixtureId: p.fixtureId,
        match:     p.match,
        league:    p.league,
        homeTeam:  p.match?.split(' v ')[0]?.trim() || '',
        awayTeam:  p.match?.split(' v ')[1]?.trim() || '',
        market:    p.market,
        selection: p.selection,
        odds:      p.odds,
        modelProb: p.modelProbRaw,
        date:      p.fixtureDate,
      }))
      const { data } = await api.post(`/api/sportybet/booking-code`, { picks: payload, debug: sbDebug, risk: risks, minLegProb: legFloorOn ? minLegProb : 0, upgradePicks: sbUpgrade, preview }, { timeout: 10 * 60 * 1000 })
      setSbResult(data)
    } catch (err) {
      setSbResult({ success: false, error: err.response?.data?.error || err.message })
    } finally {
      setSbLoading(false)
    }
  }

  const enrichOne = useCallback(async (fixtureId, market, selection) => {
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
  }, [enrichingId])

  const analyseOne = useCallback(async (fixtureId) => {
    if (!fixtureId || analysingId) return
    setAnalysingId(fixtureId)
    try {
      const { data } = await api.post(`/api/betbuilder/analyse`, { fixtureIds: [fixtureId], risk: risks, fast: fastAI }, { timeout: 10 * 60 * 1000 })
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
  }, [analysingId, risks, fastAI, mergeAnalysis])

  // Narrow first, then rank — so the sort picks the best of what is left rather than ranking
  // everything and leaving you to scroll for the next kickoff.
  const windowed = useMemo(() => {
    if (!withinHours) return picks
    const cutoff = Date.now() + withinHours * 3600000
    return picks.filter(p => {
      if (!p.fixtureDate) return false
      const t = new Date(p.fixtureDate).getTime()
      return !isNaN(t) && t <= cutoff
    })
  }, [picks, withinHours])

  // Kickoff slots present in the current window. Keyed by local date AND hour, never hour
  // alone: across a multi-day window "18:00" would otherwise merge Saturday's 18:00 kickoffs
  // with Sunday's, which is the opposite of what picking a slot is for.
  const hourOptions = useMemo(() => {
    const p2 = n => String(n).padStart(2, '0')
    const counts = new Map()
    for (const p of windowed) {
      if (!p.fixtureDate) continue
      const d = new Date(p.fixtureDate)
      if (isNaN(d.getTime())) continue
      const key = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}`
      if (!counts.has(key)) {
        counts.set(key, {
          key, count: 0, sort: d.getTime(),
          label: `${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}, ${p2(d.getHours())}:00`,
        })
      }
      counts.get(key).count++
    }
    return [...counts.values()].sort((a, b) => a.sort - b.sort)
  }, [windowed])

  // A slot chosen before a regenerate may no longer exist. Fall back to the whole window rather
  // than showing an empty table under a stale selection.
  const activeHour = hourOptions.some(o => o.key === kickoffHour) ? kickoffHour : null

  // What the selected legs are actually worth as one slip.
  //
  // Why this is here at all: the panel already showed combined ODDS, which grows as you add
  // legs and so reads as the slip getting better. The probability moves the other way. Ten legs
  // at an honest 88% win 29% of the time, and at 78% they win 8% — so a 10-leg card built from
  // well-calibrated legs still loses far more often than it wins. Eight of ten landing feels
  // like the model was wrong when it is exactly what 88%-per-leg predicts.
  //
  // Independence caveat: this is a plain product, which is right for legs on DIFFERENT fixtures
  // and wrong for two legs on the same one (Over 1.5 and BTTS on one match are strongly
  // correlated). `sameFixture` counts that case so the readout can say so rather than quietly
  // overstate. Correlated legs make the true probability HIGHER than the product, not lower.
  const slip = useMemo(() => {
    const legs = picks.filter(p => selected.has(p.fixtureId))
    if (!legs.length) return null
    const priced = legs.filter(p => p.modelProbRaw != null && p.modelProbRaw > 0)
    const winProb = priced.length === legs.length
      ? priced.reduce((s, p) => s * p.modelProbRaw, 1)
      : null
    const odds = legs.every(p => p.odds > 1) ? legs.reduce((s, p) => s * p.odds, 1) : null
    const seen = new Set(), dup = new Set()
    for (const p of legs) { if (seen.has(p.match)) dup.add(p.match); seen.add(p.match) }
    // How many legs the slip target actually allows.
    //
    // Strongest legs first, multiplying until the product would fall under the target. This is
    // the only honest answer to "I want 80%+": at the measured 87% per leg it is two legs, at
    // 93% it is three. The button that trims to it is next to the number, because reading "2"
    // and then hand-unpicking eight rows is how the number gets ignored.
    const byStrength = [...priced].sort((a, b) => b.modelProbRaw - a.modelProbRaw)
    let prod = 1, k = 0
    for (const p of byStrength) {
      const next = prod * p.modelProbRaw
      if (next < slipTarget) break
      prod = next; k++
    }
    const forTarget = { legs: k, prob: k ? prod : null, ids: byStrength.slice(0, k).map(p => p.fixtureId) }

    return { n: legs.length, winProb, odds, missing: legs.length - priced.length, sameFixture: dup.size, forTarget }
  }, [picks, selected, slipTarget])

  const visible = useMemo(() => {
    const p2 = n => String(n).padStart(2, '0')
    let out = windowed
    if (activeHour) {
      out = out.filter(p => {
        const d = new Date(p.fixtureDate)
        if (isNaN(d.getTime())) return false
        return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}` === activeHour
      })
    }
    // Only bites once a check has run. Picks the check has not seen stay visible — hiding a pick
    // for lack of information is worse than showing it without a verdict.
    if (sbOnly && sbAvail?.byId) {
      out = out.filter(p => (sbAvail.byId[p.fixtureId] ?? 'available') === 'available')
    }
    if (legFloorOn) out = out.filter(p => (p.modelProbRaw ?? 0) >= minLegProb)
    return out
  }, [windowed, activeHour, sbOnly, sbAvail, legFloorOn, minLegProb])

  // Memoised because this copies and re-sorts EVERY pick, not just the twenty on screen. A full
  // slate is well over a thousand, and without this it re-ran on every unrelated state change —
  // ticking a checkbox, expanding a panel, each streamed batch.
  const sorted = useMemo(() => [...visible].sort((a, b) => {
    if (sortBy === 'prob')  return parseFloat(b.modelProb) - parseFloat(a.modelProb)
    if (sortBy === 'o15')   return (b.over15 ?? 0) - (a.over15 ?? 0)
    if (sortBy === 'x2') {
      const top = p => p.blend ? Math.max(p.blend.home ?? 0, p.blend.draw ?? 0, p.blend.away ?? 0) : 0
      return top(b) - top(a)
    }
    if (sortBy === 'time')  return new Date(a.fixtureDate) - new Date(b.fixtureDate)
    if (sortBy === 'odds')  return (b.odds || 0) - (a.odds || 0)
    return (b.certaintyScore ?? 0) - (a.certaintyScore ?? 0)
  }), [visible, sortBy])

  const totalPages   = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const displayPicks = useMemo(
    () => sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [sorted, page],
  )

  const rOpt = RISK_OPTIONS.find(r => r.key === (risks.includes('high') ? 'high' : risks.includes('medium') ? 'medium' : 'low'))


  const riskLabel = risks.map(r => RISK_OPTIONS.find(o => o.key === r)?.label).join(' + ')

  const actions = (
    <>
      <button className="btn btn-sm hide-sm" onClick={() => rerunPredictions({ scope: 'picks' })} disabled={loading || rerunning}
        title="Re-run the engine on the fixtures currently listed only. Fast, but a fixture that is not already in the list cannot appear — use Rerun All for that.">
        {rerunning ? <><span className="spin" /> Engine</> : '⚙️ Rerun listed'}
      </button>
      <button className="btn btn-sm btn-warn hide-sm" onClick={() => rerunPredictions({ scope: 'window' })} disabled={loading || rerunning}
        title="Re-run the engine on EVERY upcoming fixture in the selected date window, so fixtures that previously missed the risk gate can re-enter the list. Slow — 15-30 min for a week.">
        ⚙️ Rerun all
      </button>
      <button className="btn btn-sm btn-accent" onClick={() => rerunPredictions({ scope: 'window', refreshOdds: true })} disabled={loading || rerunning}
        title="Rerun All, and also re-fetch live bookmaker odds for every fixture. Slowest option and it consumes API-Football quota — use when prices have moved.">
        ⚙️ <span className="hide-sm">All +</span> 💰
      </button>
    </>
  )

  return (
    <AppShell title="Bet Builder" subtitle={`${riskLabel} · ${dateMode === 'quick' ? DURATION_LABELS[duration] : `${fromDate} → ${toDate}`}`} actions={actions}>

      {/* ── The slate the scheduler already built ── */}
      {autoSlate && !autoDismissed && !!autoSlate.picks?.length && (
        <div className="card card-pad" style={{
          marginBottom: 14, borderColor: 'var(--pos-dim)', background: 'var(--pos-soft)',
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--pos)' }}>
            ✓ Auto slate ready — {autoSlate.picks.length} picks
          </span>
          <span className="muted" style={{ fontSize: 11.5 }}>
            {autoSlate.risk?.join('/')} risk · built {new Date(autoSlate.builtAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
            {autoSlate.analysed ? ` · ${autoSlate.analysed} AI-analysed` : ' · not AI-analysed'}
            {autoSlate.sportybet?.available != null && ` · ${autoSlate.sportybet.available} on SportyBet`}
            {autoSlate.stale ? ` · ${autoSlate.stale} already kicked off` : ''}
          </span>
          <button className="btn btn-sm btn-pos" onClick={loadAutoSlate}>Load it</button>
          <button className="btn btn-sm" onClick={buildAutoSlateNow} disabled={autoBuilding}
            title="Rebuild today's slate now — same gate and same AI pass the scheduler runs">
            {autoBuilding ? <><span className="spin" /> Building…</> : '↻ Rebuild'}
          </button>
          <button className="icon-btn" style={{ width: 26, height: 26, marginLeft: 'auto' }}
            onClick={() => setAutoDismissed(true)} title="Hide">✕</button>
        </div>
      )}
      {autoSlate && !autoSlate.picks?.length && !autoDismissed && (
        <div className="card card-pad" style={{ marginBottom: 14, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="muted" style={{ fontSize: 12 }}>
            The {new Date(autoSlate.builtAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} automatic run found nothing that cleared the {autoSlate.risk?.join('/')} gate
            {autoSlate.meta?.debug ? ` (${autoSlate.meta.fixturesScanned} fixtures scanned)` : ''}.
          </span>
          <button className="btn btn-sm" onClick={buildAutoSlateNow} disabled={autoBuilding}>
            {autoBuilding ? <><span className="spin" /> Building…</> : '↻ Try again now'}
          </button>
          <button className="icon-btn" style={{ width: 26, height: 26, marginLeft: 'auto' }}
            onClick={() => setAutoDismissed(true)} title="Hide">✕</button>
        </div>
      )}

      {/* ── Build panel ── */}
      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-pad" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20, alignItems: 'start' }}>

          {/* Fixture window */}
          <div>
            <span className="label">Fixture window</span>
            <div className="seg seg-fill seg-accent" style={{ marginBottom: 8 }}>
              {[['quick', 'Quick'], ['pick', 'Date range']].map(([m, l]) => (
                <button key={m} className={dateMode === m ? 'on' : ''} onClick={() => setDateMode(m)}>{l}</button>
              ))}
            </div>
            {dateMode === 'quick' && (
              <div className="chip-row">
                {Object.entries(DURATION_LABELS).map(([k, l]) => (
                  <button key={k} className={`chip${duration === k ? ' on' : ''}`} onClick={() => setDuration(k)}>{l}</button>
                ))}
              </div>
            )}
            {dateMode === 'pick' && (
              <div style={{ display: 'flex', gap: 8 }}>
                {[['From', fromDate, v => { setFromDate(v); if (v > toDate) setToDate(v) }, null],
                  ['To',   toDate,   v => setToDate(v), fromDate]].map(([lbl, val, fn, min]) => (
                  <div key={lbl} style={{ flex: 1, minWidth: 0 }}>
                    <div className="muted" style={{ fontSize: 10.5, marginBottom: 4 }}>{lbl}</div>
                    <input className="field" type="date" value={val} min={min || undefined} onChange={e => fn(e.target.value)} />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Risk */}
          <div style={{ gridColumn: 'span 2', minWidth: 0 }}>
            <span className="label">Risk level</span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
              {RISK_OPTIONS.map(r => {
                const active = risks.includes(r.key)
                return (
                  <button
                    key={r.key}
                    onClick={() => toggleRisk(r.key)}
                    style={{
                      padding: '12px 14px', borderRadius: 'var(--r-lg)', textAlign: 'left', position: 'relative',
                      background: active ? `var(--${r.tone}-soft)` : 'var(--surface-2)',
                      border: `1px solid ${active ? `var(--${r.tone})` : 'var(--line)'}`,
                      transition: 'background .14s, border-color .14s',
                    }}
                  >
                    {active && <span style={{ position: 'absolute', top: 9, right: 11, fontSize: 11, color: `var(--${r.tone})`, fontWeight: 800 }}>✓</span>}
                    <div style={{ fontSize: 13, fontWeight: 700, color: active ? `var(--${r.tone})` : 'var(--tx-2)', marginBottom: 3 }}>
                      {r.emoji} {r.label}
                    </div>
                    <div style={{ fontSize: 11, color: active ? `var(--${r.tone})` : 'var(--tx-3)', opacity: active ? 0.85 : 1 }}>{r.desc}</div>
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {/* Options row */}
        <div className="card-pad" style={{ borderTop: '1px solid var(--line-soft)', display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <span className="label">Fetch top</span>
            <div className="chip-row">
              {[50, 100, 500, 1000, 2000].map(n => (
                <button key={n} className={`chip${limit === n ? ' on' : ''}`} onClick={() => setLimit(n)}>{n >= 1000 ? `${n / 1000}k` : n}</button>
              ))}
            </div>
          </div>

          <div>
            <span className="label">Filter</span>
            <div className="chip-row">
              <button
                className={`chip${showAll ? ' on' : ''}`}
                onClick={() => setShowAll(v => !v)}
                title={showAll ? 'Showing ALL matches — risk gates disabled' : 'Only showing matches that pass the selected risk tier'}
              >
                {showAll ? '🔓 All matches' : '🎯 Filtered'}
              </button>
              <button
                className="chip"
                style={valueMode ? { background: 'var(--warn-soft)', borderColor: 'var(--warn-dim)', color: 'var(--warn)' } : undefined}
                onClick={() => { const v = !valueMode; setValueMode(v); generate({ valueMode: v }) }}
                disabled={loading || rerunning}
                title="Value mode: show only bets where the model disagrees with a REAL bookmaker price by at least the chosen edge, ranked by edge. Ignores risk tiers. Expect a handful per week, not a full slate — and only fixtures whose odds we have stored can qualify."
              >
                {valueMode ? '💎 Value on' : '💎 Value off'}
              </button>
              {valueMode && (
                <select className="field" value={minEdge} onChange={e => setMinEdge(Number(e.target.value))} disabled={loading}
                  title="Minimum model-vs-market disagreement. Below 10pp the market has historically been the better forecaster."
                  style={{ width: 'auto', padding: '5px 8px', fontSize: 12, color: 'var(--warn)', borderColor: 'var(--warn-dim)' }}>
                  <option value={0.05}>≥5pp (weak)</option>
                  <option value={0.08}>≥8pp</option>
                  <option value={0.10}>≥10pp</option>
                  <option value={0.15}>≥15pp (rare)</option>
                </select>
              )}
            </div>
          </div>

          <button className="btn btn-lg btn-primary" onClick={generate} disabled={loading || rerunning} style={{ flex: '1 1 300px' }}>
            {loading
              ? <><span className="spin" /> Fetching picks…</>
              : showAll ? `Get all matches — risk filter off` : `Get top ${limit} picks · ${riskLabel}`}
          </button>
        </div>

        {(rerunMsg || (loading && !picks.length)) && (
          <div style={{ padding: '0 clamp(14px,2vw,20px) 14px', fontSize: 12, color: 'var(--info)', textAlign: 'center' }}>
            {rerunMsg || loadMessage || 'Loading picks from database…'}
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="card card-pad" style={{ borderColor: 'var(--neg-dim)', background: 'var(--neg-soft)', color: 'var(--neg)', marginBottom: 16, fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* In-flight batch banner */}
      {picks.length > 0 && loadProgress && (
        <div className="card card-pad" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 14, padding: '11px 16px' }}>
          <span style={{ fontSize: 12.5, color: 'var(--info)', fontWeight: 700, whiteSpace: 'nowrap' }}>
            {loadProgress.sent} of {loadProgress.total} loaded
          </span>
          <div className="meter"><i className="info" style={{ width: `${Math.round(loadProgress.sent / loadProgress.total * 100)}%` }} /></div>
        </div>
      )}

      {picks.length === 0 && !loading && !error && (
        <div className="card empty">
          <div className="empty-ico">🎯</div>
          <div className="empty-title">No picks yet</div>
          <div className="empty-sub">Choose a window and a risk level, then run the builder.</div>
        </div>
      )}

      {/* ── Results ── */}
      {picks.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Slip stat strip */}
          <div className="stat-grid">
            <div className="stat">
              <div className="stat-label">Picks</div>
              <div className="stat-value">{picks.length}</div>
              <div className="stat-foot">{meta?.fixturesScanned ?? '—'} fixtures scanned</div>
            </div>
            <div className="stat">
              <div className="stat-label">Selected</div>
              <div className="stat-value" style={{ color: selected.size ? 'var(--accent-2)' : undefined }}>{selected.size}</div>
              <div className="stat-foot">{picks.filter(p => p.hasClaudeAnalysis).length} AI-analysed</div>
            </div>
            <div className="stat">
              <div className="stat-label">Combined odds</div>
              <div className="stat-value num" style={{ color: slip?.odds ? 'var(--warn)' : undefined }}>
                {slip?.odds ? `${slip.odds.toFixed(2)}x` : '—'}
              </div>
              <div className="stat-foot">{slip ? `${slip.n} leg${slip.n === 1 ? '' : 's'} on the slip` : 'Select picks to build a slip'}</div>
            </div>
            <div
              className="stat"
              title={slip?.winProb != null
                ? `Model probability that ALL ${slip.n} legs land. This is the product of each leg's own probability — adding legs always lowers it, however good each one looks. Ten legs at 88% each win 29% of the time.`
                : undefined}
            >
              <div className="stat-label">Chance all land</div>
              <div className="stat-value num" style={{
                color: slip?.winProb == null ? undefined
                  : slip.winProb >= 0.5 ? 'var(--pos)' : slip.winProb >= 0.25 ? 'var(--warn)' : 'var(--neg)'
              }}>
                {slip?.winProb != null ? `${(slip.winProb * 100).toFixed(slip.winProb < 0.1 ? 1 : 0)}%` : '—'}
              </div>
              <div className="stat-foot">
                {slip?.winProb == null && slip ? `${slip.missing} leg${slip.missing === 1 ? '' : 's'} unpriced` : 'Product of every leg'}
                {/* The number on its own reads as a verdict on the picks. It is arithmetic: the
                    legs are individually strong and there are simply a lot of them. So say what
                    the target costs in legs, and offer the trim. */}
                {slip?.forTarget && slip.winProb != null && slip.winProb < slipTarget && (
                  slip.forTarget.legs > 0 ? (
                    <span style={{ display: 'block', marginTop: 3, color: 'var(--accent-2)' }}>
                      ≥{(slipTarget * 100).toFixed(0)}% = top {slip.forTarget.legs} leg{slip.forTarget.legs === 1 ? '' : 's'} ({(slip.forTarget.prob * 100).toFixed(0)}%)
                      {' '}
                      <button onClick={() => setSelected(new Set(slip.forTarget.ids))}
                        title={`Keep only the ${slip.forTarget.legs} strongest leg(s) — the most this slip can carry and still clear ${(slipTarget * 100).toFixed(0)}%`}
                        style={{ color: 'var(--accent-2)', textDecoration: 'underline', fontSize: 10.5 }}>
                        trim to it
                      </button>
                    </span>
                  ) : (
                    <span style={{ display: 'block', marginTop: 3, color: 'var(--neg)' }}>
                      No single leg reaches {(slipTarget * 100).toFixed(0)}%
                    </span>
                  )
                )}
                {slip?.sameFixture > 0 && (
                  <span style={{ color: 'var(--warn)' }} title="Legs on the same fixture are correlated, so the true chance is higher than this product suggests. One leg per match keeps the figure accurate.">
                    {' '}· ⚠ {slip.sameFixture} same-match
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Notices */}
          {(meta?.failedEnrichment > 0 || meta?.debug?.noPred > 0 || (!showAll && meta && meta.fixturesScanned > picks.length)) && (
            <div className="card card-pad" style={{ padding: '10px 16px', fontSize: 11.5, display: 'flex', gap: 14, flexWrap: 'wrap', color: 'var(--tx-3)' }}>
              {meta?.failedEnrichment > 0 && (
                <span title="Picks excluded because form/standings/H2H contradicted the model" style={{ color: 'var(--neg)' }}>
                  {meta.failedEnrichment} blocked by data
                </span>
              )}
              {meta?.debug?.noPred > 0 && (
                <span title="These fixtures have no prediction — run the engine on them first">{meta.debug.noPred} with no prediction</span>
              )}
              {!showAll && meta && meta.fixturesScanned > picks.length && (
                <span>
                  {meta.fixturesScanned - picks.length} filtered out —{' '}
                  <button onClick={() => { setShowAll(true); generate({ showAll: true }) }}
                    style={{ color: 'var(--accent-2)', textDecoration: 'underline', fontSize: 11.5 }}>show all</button>
                </span>
              )}
            </div>
          )}

          {/* Action bar */}
          <div className="card card-pad" style={{ padding: '12px 16px', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="btn btn-primary" onClick={() => setSmartOpen(true)} disabled={analysing || !picks.length}
              title="Choose a target price and a leg range; the builder finds the safest combination that gets there">
              {analysing ? <><span className="spin" /> Picking…</> : '🎯 Smart Pick'}
            </button>
            <button className="btn" onClick={() => smartPick(10)} disabled={analysing}
              title="Skip the target and just take the ten highest-certainty picks">
              Top 10
            </button>

            <div style={{ display: 'flex' }}>
              <button className="btn btn-info" onClick={() => goalsPick(goalsPickCount)} disabled={analysing}
                style={{ borderRadius: 'var(--r) 0 0 var(--r)', borderRight: 'none' }}
                title="Auto-select top goal-heavy picks (Over 1.5 / Over 2.5 / BTTS) — uses fast Claude Haiku for quick analysis">
                ⚽ Goals Pick {goalsPickCount}
              </button>
              <select className="field" value={goalsPickCount} onChange={e => setGoalsPickCount(Number(e.target.value))} disabled={analysing}
                style={{ width: 'auto', borderRadius: '0 var(--r) var(--r) 0', background: 'var(--info-soft)', borderColor: 'var(--info-dim)', color: 'var(--info)', fontWeight: 700, fontSize: 12.5 }}>
                {[5, 10, 20, 50].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>

            <label className="muted" style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, cursor: 'pointer', userSelect: 'none' }}
              title="Run the AI pass on Claude Haiku instead of Sonnet. Same three calls per pick — enrichment analysis, news, confirm-the-pick — on the fast model. Turn off for the slower, stronger read.">
              <input type="checkbox" checked={fastAI} onChange={e => setFastAI(e.target.checked)} style={{ cursor: 'pointer' }} />
              ⚡ Fast AI (Haiku)
            </label>

            <button className="btn btn-sm" onClick={checkSportybet} disabled={sbChecking || (!picks.length)}
              title="Read SportyBet's card once and mark every pick listed / not listed, before you build a slip. Cached for 10 minutes.">
              {sbChecking ? <><span className="spin" /> Checking…</> : `🔎 Check SportyBet (${selected.size || visible.length})`}
            </button>

            {sbAvail && (
              <>
                <span className="pill" title={`SportyBet was showing ${sbAvail.listed} matches when this was checked`}>
                  {Object.values(sbAvail.byId).filter(v => v === 'available').length} of {Object.keys(sbAvail.byId).length} on SportyBet
                </span>
                <label className="muted" style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, cursor: 'pointer', userSelect: 'none' }}
                  title="Hide picks SportyBet is not listing or not pricing">
                  <input type="checkbox" checked={sbOnly} onChange={e => { setSbOnly(e.target.checked); setPage(1) }} style={{ cursor: 'pointer' }} />
                  Only bettable
                </label>
              </>
            )}

            {selected.size > 0 && (
              <>
                <button className="btn btn-accent" onClick={analyseSelected} disabled={analysing}>
                  {analysing ? <><span className="spin" /> Running Claude…</> : `Analyse ${selected.size} selected`}
                </button>
                {/* Preview first: the upgrade pass can rewrite a leg you deliberately chose, so
                    there is a way to see the finished slip before a code exists. */}
                <button className="btn" onClick={() => getSportybetCode({ preview: true })} disabled={!!sbLoading}>
                  {sbLoading === 'preview' ? <><span className="spin" /> Checking…</> : `👁 Preview (${selected.size})`}
                </button>
                <button className="btn btn-pos" onClick={() => getSportybetCode()} disabled={!!sbLoading}>
                  {sbLoading === 'book' ? <><span className="spin" /> Adding…</> : `🎰 SportyBet code (${selected.size})`}
                </button>
                <label className="muted" style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, cursor: 'pointer', userSelect: 'none' }}
                  title="Before booking, re-check every selected leg against the other markets on the same fixture and swap it when both the model and SportyBet's price call the alternative clearly safer">
                  <input type="checkbox" checked={sbUpgrade} onChange={e => setSbUpgrade(e.target.checked)} style={{ cursor: 'pointer' }} />
                  Upgrade picks
                </label>
                <label className="muted" style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, cursor: 'pointer', userSelect: 'none' }}
                  title="Show browser window so you can see what's happening">
                  <input type="checkbox" checked={sbDebug} onChange={e => setSbDebug(e.target.checked)} style={{ cursor: 'pointer' }} />
                  Debug
                </label>
              </>
            )}
          </div>

          {/* Sort + kickoff filters */}
          <div className="card card-pad" style={{ padding: '11px 16px', display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
              <span className="eyebrow">Sort</span>
              <div className="seg seg-accent">
                {[['prob', 'Model %'], ['x2', '1X2'], ['o15', 'Over 1.5'], ['score', 'Score'], ['odds', 'Odds'], ['time', 'Time']].map(([k, l]) => (
                  <button key={k} className={sortBy === k ? 'on' : ''} onClick={() => setSortBy(k)}>{l}</button>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
              <span className="eyebrow">Kickoff</span>
              <div className="seg seg-accent">
                {[[null, 'Any'], [1, '1h'], [2, '2h'], [3, '3h'], [6, '6h'], [12, '12h'], [24, '24h']].map(([h, l]) => (
                  <button key={l} className={withinHours === h ? 'on' : ''}
                    onClick={() => { setWithinHours(h); setKickoffHour(null); setPage(1) }}
                    title={h ? `Only matches kicking off within ${h} hours — combine with a sort to rank just those` : 'No kickoff limit'}>
                    {l}
                  </button>
                ))}
              </div>
              {hourOptions.length > 0 && (
                <select className="field" value={activeHour ?? ''} onChange={e => { setKickoffHour(e.target.value || null); setPage(1) }}
                  title="Show only matches kicking off in one specific hour — useful when every leg should start together"
                  style={{ width: 'auto', padding: '6px 8px', fontSize: 12, ...(activeHour ? { color: 'var(--accent-2)', borderColor: 'var(--accent-dim)' } : {}) }}>
                  <option value="">At any hour</option>
                  {hourOptions.map(o => <option key={o.key} value={o.key}>{o.label} ({o.count})</option>)}
                </select>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
              <label className="eyebrow" style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', userSelect: 'none' }}
                title="Drop any pick whose model probability is below this. Low Risk already gates at 60-65%, so this cuts the weakest band the gate still lets through. It is a per-LEG floor — see the 'Chance all land' tile for what it means for the whole slip.">
                <input type="checkbox" checked={legFloorOn} onChange={e => { setLegFloorOn(e.target.checked); setPage(1) }} style={{ cursor: 'pointer' }} />
                Min leg
              </label>
              <div className="seg seg-accent">
                {[0.65, 0.70, 0.75, 0.80, 0.85, 0.90].map(v => (
                  <button key={v} className={legFloorOn && minLegProb === v ? 'on' : ''}
                    onClick={() => { setMinLegProb(v); setLegFloorOn(true); setPage(1) }}
                    title={`Only legs the model gives at least ${(v * 100).toFixed(0)}%`}>
                    {(v * 100).toFixed(0)}%
                  </button>
                ))}
              </div>
              {legFloorOn && (
                <span className="pill" style={{ color: visible.length ? 'var(--accent-2)' : 'var(--neg)' }}>
                  {visible.length} of {picks.length} at ≥{(minLegProb * 100).toFixed(0)}%
                </span>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span className="eyebrow" title="Target for the WHOLE slip. The Chance-all-land tile uses it to say how many legs you can carry and still clear it.">Slip target</span>
              <div className="seg seg-accent">
                {[0.5, 0.6, 0.7, 0.8].map(v => (
                  <button key={v} className={slipTarget === v ? 'on' : ''} onClick={() => setSlipTarget(v)}>
                    {(v * 100).toFixed(0)}%
                  </button>
                ))}
              </div>
            </div>

            <label className="muted" style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, cursor: 'pointer', userSelect: 'none', marginLeft: 'auto' }}
              title="One line per pick. The data flags, goals/results history, news line and alternative markets move behind the ▸ button on each row.">
              <input type="checkbox" checked={compact} onChange={e => setCompact(e.target.checked)} style={{ cursor: 'pointer' }} />
              Compact rows
            </label>

            {(withinHours || activeHour) && (
              <span className="pill" style={{ color: visible.length ? 'var(--accent-2)' : 'var(--neg)' }}>
                {visible.length} of {picks.length}
                {withinHours ? ` within ${withinHours}h` : ''}
                {activeHour ? ` at ${hourOptions.find(o => o.key === activeHour)?.label}` : ''}
                {!visible.length && ' — nothing matches'}
              </span>
            )}
          </div>

          {/* Picks */}
          <div className="picks">
            <div className="pk-head">
              <div className="pk-check">
                <input type="checkbox" checked={selected.size === visible.length && visible.length > 0} onChange={selectAll} style={{ cursor: 'pointer' }} />
              </div>
              <div className="pk-match">Match</div>
              <div className="pk-league">League</div>
              <div className="pk-market">Market</div>
              <div className="pk-sel">Selection</div>
              <div className="pk-odds">Odds</div>
              <div className="pk-prob">Model %</div>
              <div className="pk-x2">1X2</div>
              <div className="pk-o15">O1.5</div>
              <div className="pk-value">Value</div>
              <div className="pk-reason">Reason / blend</div>
              <div className="pk-act" />
            </div>

            {displayPicks.map((pick, i) => (
              <PickRow
                key={pick.fixtureId ?? i}
                pick={pick}
                idx={i}
                isSel={selected.has(pick.fixtureId)}
                aiExpanded={expandedAI.has(pick.fixtureId)}
                compact={compact}
                rowExpanded={expandedRow.has(pick.fixtureId)}
                onToggleRow={toggleRow}
                sbStatus={sbAvail?.byId?.[pick.fixtureId] ?? pick.sportybet ?? null}
                isAnalysing={analysingId === pick.fixtureId}
                anyAnalysing={!!analysingId}
                isEnriching={enrichingId === pick.fixtureId}
                anyEnriching={!!enrichingId}
                onToggleSelect={toggleSelect}
                onToggleAI={toggleAI}
                onEnrich={enrichOne}
                onAnalyse={analyseOne}
              />
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="toolbar" style={{ justifyContent: 'center' }}>
              <button className="btn" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>← Prev</button>
              <span className="muted" style={{ fontSize: 12.5 }}>
                Page <b style={{ color: 'var(--tx)' }}>{page}</b> of <b style={{ color: 'var(--tx)' }}>{totalPages}</b>
                <span className="muted2" style={{ marginLeft: 8 }}>
                  ({(withinHours || activeHour)
                    ? `${visible.length} shown of ${picks.length}`
                    : `${picks.length} picks total`})
                </span>
              </span>
              <button className="btn btn-accent" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>Next →</button>
            </div>
          )}

          {/* SportyBet booking code */}
          {sbResult && (
            <div className="card card-pad" style={{ borderColor: sbResult.preview ? 'var(--info-dim)' : sbResult.success ? 'var(--pos-dim)' : 'var(--neg-dim)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: sbResult.preview ? 'var(--info)' : sbResult.success ? 'var(--pos)' : 'var(--neg)' }}>
                  {sbResult.preview ? '👁 Preview — no code created yet'
                    : sbResult.success ? '✓ SportyBet booking code' : '⚠ SportyBet result'}
                </span>
                <button className="icon-btn" style={{ width: 28, height: 28 }} onClick={() => setSbResult(null)}>✕</button>
              </div>

              {sbResult.code && (
                <div className="toolbar" style={{ marginBottom: 14 }}>
                  <div className="mono" style={{
                    fontSize: 26, fontWeight: 700, letterSpacing: '0.14em', color: 'var(--warn)',
                    background: 'var(--warn-soft)', border: '1px solid var(--warn-dim)',
                    borderRadius: 'var(--r-lg)', padding: '10px 22px'
                  }}>
                    {sbResult.code}
                  </div>
                  <button className="btn btn-pos" onClick={() => navigator.clipboard.writeText(sbResult.code)}>Copy</button>
                  {sbResult.totalOdds && (
                    <div className="muted" style={{ fontSize: 12.5 }}>
                      Combined odds: <b style={{ color: 'var(--warn)' }}>{sbResult.totalOdds}x</b>
                    </div>
                  )}
                </div>
              )}

              {/* Preview header: the slip as it would be booked, and the button that commits it. */}
              {sbResult.preview && sbResult.success && (
                <div className="toolbar" style={{ marginBottom: 14 }}>
                  <div className="muted" style={{ fontSize: 12.5 }}>
                    {sbResult.added.length} leg{sbResult.added.length === 1 ? '' : 's'} ·
                    combined odds <b style={{ color: 'var(--warn)' }}>{sbResult.totalOdds}x</b>
                  </div>
                  <button className="btn btn-pos" onClick={() => getSportybetCode()} disabled={!!sbLoading}>
                    {sbLoading === 'book' ? <><span className="spin" /> Adding…</> : 'Generate this code'}
                  </button>
                  <span className="muted2" style={{ fontSize: 10.5 }}>
                    Prices are re-checked at booking, so a leg can still move.
                  </span>
                </div>
              )}

              {sbResult.error && <div style={{ fontSize: 12.5, color: 'var(--neg)', marginBottom: 10 }}>{sbResult.error}</div>}

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
                {sbResult.added?.length > 0 && (
                  <div>
                    <div className="eyebrow" style={{ color: 'var(--pos)', marginBottom: 6 }}>Added ({sbResult.added.length})</div>
                    {sbResult.added.map((a, i) => (
                      <div key={i} style={{ fontSize: 11.5, color: 'var(--pos)', marginBottom: 3 }}>
                        ✓ {a.label}
                        {a.substituted && <span style={{ color: 'var(--info)', fontWeight: 700 }}> {a.upgraded ? '↑' : '⇄'}</span>}
                      </div>
                    ))}
                  </div>
                )}
                {sbResult.substitutions?.length > 0 && (
                  <div>
                    {/* A leg SportyBet would not price is worth more as the fixture's next-safest
                        market than as a hole in the slip — but only when the model AND the price
                        agree it is safe, so both numbers are shown. */}
                    <div className="eyebrow" style={{ color: 'var(--info)', marginBottom: 6 }}>
                      Swapped ({sbResult.substitutions.length})
                    </div>
                    {sbResult.substitutions.map((sub, i) => (
                      <div key={i} style={{ fontSize: 11.5, marginBottom: 5, lineHeight: 1.45 }}>
                        <span style={{ color: 'var(--info)' }}>
                          {sub.kind === 'upgraded' ? '↑' : '⇄'} {sub.match}
                        </span>
                        <div className="muted2" style={{ fontSize: 10.5, paddingLeft: 14 }}>
                          {sub.from}{sub.fromOdds ? ` @${sub.fromOdds}` : ''} → <b style={{ color: 'var(--tx)' }}>{sub.to}</b>
                          {sub.odds && <span style={{ color: 'var(--warn)' }}> @{sub.odds}</span>}
                          {sub.toProb != null && sub.bookProb != null && (
                            <> · model {(sub.toProb * 100).toFixed(0)}% · book {(sub.bookProb * 100).toFixed(0)}%</>
                          )}
                          {sub.gain != null && (
                            <span style={{ color: 'var(--pos)' }}> · +{(sub.gain * 100).toFixed(0)}pp safer</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {sbResult.skipped?.length > 0 && (
                  <div>
                    {/* "Not found" lumped two different things together, and the common one was
                        not "missing": the match is on SportyBet, they just are not pricing that
                        market. Split, because the fix differs — one needs a different fixture,
                        the other needs a different market. */}
                    <div className="eyebrow" style={{ color: 'var(--warn)', marginBottom: 6 }}>
                      Left off ({sbResult.skipped.length})
                    </div>
                    {sbResult.skipped.map((s, i) => (
                      <div key={i} style={{ fontSize: 11.5, marginBottom: 5, lineHeight: 1.45 }}>
                        <span style={{ color: s.status === 'unlisted' ? 'var(--neg)' : 'var(--warn)' }}>
                          {s.status === 'unlisted' ? '✗' : '◐'} {s.label}
                        </span>
                        {s.reason && <div className="muted2" style={{ fontSize: 10.5, paddingLeft: 14 }}>{s.reason}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {sbResult.success && !sbResult.preview && (
                <div className="muted2" style={{ fontSize: 11.5, marginTop: 12 }}>
                  Enter this code on SportyBet Ghana to load your slip → place bet with your account.
                </div>
              )}
            </div>
          )}

          {/* AI pick summary */}
          {picks.some(p => p.hasClaudeAnalysis) && (
            <div className="card card-pad" style={{ padding: '12px 16px', display: 'flex', flexWrap: 'wrap', gap: 7, alignItems: 'center' }}>
              <span className="eyebrow">AI picks</span>
              {picks.filter(p => p.hasClaudeAnalysis).map((p, i) => {
                const tone = p.value === 'Good value' ? 'pos' : p.value === 'Poor value' ? 'neg' : 'warn'
                return (
                  <span key={i} className="pill" style={{ fontWeight: 500 }}>
                    <b style={{ color: 'var(--tx)' }}>{p.match?.split(' v ')[0]}</b> {p.selection}
                    <span style={{ color: 'var(--warn)' }}>@{p.odds}</span>
                    {p.value && <span style={{ color: `var(--${tone})`, fontWeight: 800 }}>{p.value === 'Good value' ? '↑' : p.value === 'Poor value' ? '↓' : '='}</span>}
                  </span>
                )
              })}
            </div>
          )}
        </div>
      )}

      <SmartPickModal
        open={smartOpen}
        onClose={() => setSmartOpen(false)}
        // The filtered list, for the same reason the other pickers use it — a kickoff window set
        // on the toolbar should constrain what the builder is allowed to choose from.
        picks={visible.length ? visible : picks}
        onApply={ids => setSelected(new Set(ids))}
        onAnalyse={ids => runPickAndAnalyse(ids)}
      />
    </AppShell>
  )
}


/** Small labelled badge used across the match cell. */
const TAGS = {
  low:        { cls: 'tag-pos',  text: '🛡 LOW',     tip: 'Passed Low Risk gate — high certainty pick' },
  medium:     { cls: 'tag-warn', text: '⚖ MED',     tip: 'Passed Medium Risk gate — moderate certainty' },
  high:       { cls: 'tag-neg',  text: '🔥 HIGH',    tip: 'High Risk pick — uncertain, value-hunting' },
  none:       { cls: '',         text: 'NO TIER',    tip: 'Does not pass any risk tier — model confidence too low' },
  confirmed:  { cls: 'tag-pos',  text: '✓ DATA',     tip: 'Form/standings/H2H confirm this pick' },
  risky:      { cls: 'tag-neg',  text: '⚠ CHECK',    tip: 'Data raises concerns — check flags below' },
  mixed:      { cls: 'tag-warn', text: '~ MIXED',    tip: 'Mixed signals from data' },
  unverified: { cls: '',         text: 'NO DATA',    tip: 'No enrichment data yet — click AI to fetch' },
}

/**
 * One pick: the main row, its goals sub-row, alternative-option sub-rows, and the expandable
 * AI panel. Memoised on primitive props rather than the parent Sets so that ticking one
 * checkbox re-renders one row instead of all twenty — with a full slate in state a plain
 * re-render of the table measured 79-96ms on a throttled machine, which blocked scrolling
 * for the whole of that time.
 *
 * Layout is entirely in `.pk` (index.css): twelve columns on desktop, the same cells
 * re-flowed into a stacked card below 900px.
 */
const PickRow = memo(function PickRow({
  pick, idx, isSel, aiExpanded, isAnalysing, anyAnalysing, isEnriching, anyEnriching,
  compact, rowExpanded, sbStatus,
  onToggleSelect, onToggleAI, onToggleRow, onEnrich, onAnalyse,
}) {
  // In compact mode the per-row detail (data flags, goals/results history, news, alternative
  // markets) is behind the ▸ button. `showDetail` is what every one of those blocks tests, so
  // there is one rule rather than a condition repeated at each block.
  const showDetail = !compact || rowExpanded
  const hasAI = pick.hasClaudeAnalysis
  const pickChanged = hasAI && pick.originalMarket && (
    pick.market !== pick.originalMarket || pick.selection !== pick.originalSelection
  )
  const valTone = pick.value === 'Good value' ? 'pos' : pick.value === 'Poor value' ? 'neg' : 'warn'

  const optRows = (pick.options || []).map((opt, j) => (
    <div key={`${pick.fixtureId ?? idx}-opt-${j}`} className="pk-sub alt">
      <span className="lead">└ Option {j + 2}</span>
      <span className="muted">{opt.market}</span>
      <span style={{ fontWeight: 700, color: 'var(--info)' }}>{opt.selection}</span>
      <span className="num" style={{ fontWeight: 700, color: 'var(--warn)' }}>{opt.odds}x</span>
      <span className="num" style={{ fontWeight: 700, color: 'var(--pos)' }}>{opt.modelProb}</span>
    </div>
  ))

  // Goals line, shown only when the main pick is NOT already a goals market.
  // High Risk picks come out as 1X2 almost every time, yet those fixtures are the
  // highest-scoring on the card — this surfaces the goals market before kickoff
  // instead of leaving it to be noticed in the final score.
  const g = pick.goalsOption
  const goalsRow = (g && !GOAL_MARKETS.includes(pick.selection)) ? (
    <div key={`${pick.fixtureId ?? idx}-goals`} className="pk-sub goals">
      <span className="lead" style={{ color: 'var(--pos)' }}>└ ⚽ Goals</span>
      <span className="muted">{g.market}</span>
      <span style={{ fontWeight: 700, color: 'var(--pos)' }}>{g.selection}</span>
      <span className="num" style={{ fontWeight: 700, color: 'var(--warn)' }}>{g.odds}x{g.hasRealOdds ? '' : '*'}</span>
      <span className="num" style={{ fontWeight: 700, color: 'var(--pos)' }}>{g.modelProb}</span>
    </div>
  ) : null

  const tags = [
    TAGS[pick.tier],
    TAGS[pick.dataVerified],
    // Only rendered once a check has run — an unchecked pick shows no SB badge rather than a
    // misleading "unknown".
    sbStatus === 'available' && { cls: 'tag-pos', text: '✓ SB',    tip: 'Listed and priced on SportyBet right now' },
    sbStatus === 'no-odds'   && { cls: 'tag-warn', text: '~ SB',   tip: 'On the SportyBet card but no price on the row — the booking-code run will skip it' },
    sbStatus === 'unlisted'  && { cls: 'tag-neg',  text: '✗ SB',   tip: 'Not on the SportyBet card. Either the fixture is not offered, or the club names differ too much to match — check /api/sportybet/listed if you can see it on the site' },
    pick.historyVerdict === 'contradicted' && { cls: 'tag-neg', text: '📉 HIST', tip: "Both teams' recent goals/results history argues against this pick — see the history line below" },
    pick.historyVerdict === 'supported' && pick.historyScore >= 0.8 && { cls: 'tag-pos', text: '📈 HIST', tip: "Both teams' recent goals/results history backs this pick" },
    pick.claudeConf === 'Medium' && { cls: 'tag-warn', text: 'AI: Medium', tip: 'Claude rated this Medium confidence — not High. Review before selecting.' },
    pick.claudeConf === 'Low' && { cls: 'tag-neg', text: 'AI: Low', tip: 'Claude rated this Low confidence. High risk pick.' },
  ].filter(Boolean)

  return (
    <>
      <div
        className={`pk${compact ? ' pk-compact' : ''}${isSel ? ' sel' : ''}${hasAI ? ' ai' : ''}`}
        onClick={() => pick.fixtureId && onToggleSelect(pick.fixtureId)}
      >
        <div className="pk-check" onClick={e => e.stopPropagation()}>
          <input type="checkbox" checked={isSel} onChange={() => onToggleSelect(pick.fixtureId)} disabled={!pick.fixtureId} style={{ cursor: 'pointer' }} />
        </div>

        <div className="pk-match">
          <div style={{ fontSize: 12.5, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {pick.match}
            <span className="pk-tags">
              {tags.map((t, ti) => <span key={ti} className={`tag ${t.cls}`} title={t.tip}>{t.text}</span>)}
            </span>
          </div>
          {pick.fixtureDate && <div className="muted2" style={{ fontSize: 10.5, marginTop: 2 }}>{fmt(pick.fixtureDate)}</div>}

          {showDetail && pick.dataFlags?.filter(f => f.type !== 'info' || pick.dataVerified === 'unverified').slice(0, 3).map((f, fi) => (
            <div key={fi} style={{ fontSize: 10, marginTop: 2, color: f.type === 'good' ? 'var(--pos)' : f.type === 'warn' ? 'var(--neg)' : 'var(--tx-4)' }}>
              {f.label}
            </div>
          ))}

          {/* Point-in-time goals/results history for both clubs, computed from our own graded
              fixtures. The badge above summarises it; this shows the numbers behind it.
              Only the rows relevant to the PICK are shown — a goals leg does not need to know
              who is unbeaten, and a Double Chance leg does not need the over-1.5 counts.
              Counts ("9 of 10") rather than percentages: the window is 10 matches, and a reader
              can sanity-check a count against a form guide in a way they cannot with "90%". */}
          {showDetail && pick.history && (pick.history.home || pick.history.away) && (() => {
            const h = pick.history
            const isGoals = /over|under|btts|both teams/i.test(`${pick.market} ${pick.selection}`)
            const w = h.window
            const gg = v => v == null ? '–' : v.toFixed(1)
            // Denominator is the team's OWN match count, which is <= the window whenever a club
            // has played fewer games than that (new season, promoted side, cup-only entrant).
            // Using the nominal window there would overstate the count.
            const cnt = (r, n) => r == null ? '–' : `${Math.round(r * n)} of ${n}`
            const row = (label, body) => (
              <div style={{ display: 'flex', gap: 6 }}>
                <span className="muted2" style={{ minWidth: 40, flexShrink: 0 }}>{label}</span>
                <span>{body}</span>
              </div>
            )
            return (
              <div
                title={isGoals
                  ? `How often each side's recent matches produced goals. "6 of 10 over 1.5" means 6 of that team's last 10 matches had 2 or more goals in them. "gpg" is the average total goals in those matches, both teams combined. Up to ${w} matches per side.`
                  : `Each side's recent results. "unbeaten" counts wins and draws. "ppg" is league points per match (win 3, draw 1) — the gap between the two sides is the form edge. Up to ${w} matches per side.`}
                style={{ fontSize: 9.5, color: 'var(--tx-3)', marginTop: 5, lineHeight: 1.65, cursor: 'help' }}
              >
                <div className="muted2" style={{ fontWeight: 700, marginBottom: 1 }}>
                  {isGoals ? 'Goals history' : 'Results history'}
                </div>
                {h.home && row('Home', isGoals
                  ? `${cnt(h.home.over15, h.home.matches)} over 1.5 · ${gg(h.home.meanGoals)} gpg`
                  : `${cnt(h.home.nonLoss, h.home.matches)} unbeaten · ${gg(h.home.ppg)} ppg`)}
                {h.away && row('Away', isGoals
                  ? `${cnt(h.away.over15, h.away.matches)} over 1.5 · ${gg(h.away.meanGoals)} gpg`
                  : `${cnt(h.away.nonLoss, h.away.matches)} unbeaten · ${gg(h.away.ppg)} ppg`)}
                {isGoals && h.h2h && row('H2H',
                  <span>
                    {Math.round(h.h2h.over15 * h.h2h.matches)} of {h.h2h.matches} over 1.5 · {gg(h.h2h.meanGoals)} gpg
                    {/* Under 4 meetings the H2H is corroboration at best — say so rather than
                        letting a 2-of-3 read like a trend. */}
                    {h.h2h.matches < 4 && <span className="muted2"> (small sample)</span>}
                  </span>
                )}
                {isGoals && h.league && row('Lg', `${Math.round(h.league.over15 * 100)}% over 1.5 · ${gg(h.league.meanGoals)} gpg`)}
              </div>
            )
          })()}

          {showDetail && pick.historyFlags?.filter(f => f.type === 'warn').slice(0, 2).map((f, fi) => (
            <div key={`h${fi}`} style={{ fontSize: 9.5, marginTop: 2, color: 'var(--neg)' }}>📉 {f.message}</div>
          ))}

          {showDetail && pick.newsSentiment && (() => {
            const c = pick.newsSentiment === 'Home-favoured' ? 'var(--info)'
                    : pick.newsSentiment === 'Away-favoured' ? 'var(--warn)'
                    : pick.newsSentiment === 'Draw-likely'   ? 'var(--accent-2)'
                    : 'var(--tx-3)'
            return (
              <div style={{ fontSize: 9.5, color: c, marginTop: 3, display: 'flex', alignItems: 'center', gap: 4 }}>
                <span>News:</span>
                <span style={{ fontWeight: 700 }}>{pick.newsSentiment}</span>
                {pick.newsAgreement === false && <span style={{ color: 'var(--neg)' }}>⚠ conflicts model</span>}
                {pick.newsShift === 'Higher' && <span style={{ color: 'var(--pos)' }}>↑</span>}
                {pick.newsShift === 'Lower'  && <span style={{ color: 'var(--neg)' }}>↓</span>}
              </div>
            )
          })()}
        </div>

        <div className="pk-league">{pick.league}</div>

        <div className="pk-market" style={{ color: pickChanged ? 'var(--warn)' : 'var(--info)' }}>
          {pick.market}
          {pickChanged && pick.market !== pick.originalMarket && (
            <span className="muted2" title={`Engine suggested: ${pick.originalMarket}`} style={{ display: 'block', fontSize: 9.5, textDecoration: 'line-through' }}>
              {pick.originalMarket}
            </span>
          )}
        </div>

        {(() => {
          const side  = selectionSide(pick.market, pick.selection)
          const style = side ? SIDE_STYLE[side] : null
          const pair  = pairedOutcome(pick.market, pick.selection, pick.blend)
          // A manual override keeps its own amber colour — knowing the pick was changed matters
          // more than knowing which side it backs.
          const colour = pickChanged ? 'var(--warn)' : (style?.color ?? 'var(--info)')
          return (
            <div className="pk-sel" style={{ color: colour }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                {style?.tag && (
                  <span
                    title={side === SIDE.HOME ? 'Backs the home side' : side === SIDE.AWAY ? 'Backs the away side' : 'Backs the draw'}
                    style={{ fontSize: 9, fontWeight: 800, lineHeight: 1, padding: '2px 4px', borderRadius: 3, border: `1px solid ${colour}`, color: colour, opacity: 0.85, flexShrink: 0 }}
                  >{style.tag}</span>
                )}
                <span>{pick.selection}</span>
              </span>
              {pair && (
                <span
                  className="muted"
                  title={`${pick.selection} and the straight result are the same directional call — the Double Chance simply also collects the draw.`}
                  style={{ display: 'block', fontSize: 9.5, fontWeight: 400, marginTop: 1 }}
                >
                  {pair.label}: {pair.detail}
                </span>
              )}
              {pickChanged && pick.selection !== pick.originalSelection && (
                <span className="muted" title={`Engine suggested: ${pick.originalSelection}`} style={{ display: 'block', fontSize: 9.5, fontWeight: 400, textDecoration: 'line-through' }}>
                  {pick.originalSelection}
                </span>
              )}
            </div>
          )
        })()}

        <div className="pk-odds" style={{ color: pick.odds < 1.35 ? 'var(--neg)' : 'var(--warn)' }}>
          {pick.odds}x
          {pick.odds < 1.35 && <span title="Very short odds — model may be overconfident. One loss costs many wins." style={{ fontSize: 10 }}>⚠</span>}
        </div>

        <div className="pk-prob">
          {pick.modelProb && (
            <span className="num"
              title={`Model probability for this selection${pick.certaintyScore != null ? ` · engine score ${pick.certaintyScore.toFixed(3)}` : ''}`}
              style={{ fontSize: 14, color: 'var(--pos)', fontWeight: 800 }}>{pick.modelProb}</span>
          )}
          {/* Edge is only meaningful against a REAL price — against estOdds it is
              structurally zero, since estOdds is derived from modelProb itself. */}
          {pick.hasRealOdds && pick.edge != null && (
            <span className={`tag ${pick.edge >= 0.10 ? 'tag-warn' : pick.edge > 0 ? 'tag-pos' : 'tag-neg'}`}
              title={`Model ${pick.modelProb} vs bookmaker ${(pick.bookImplied * 100).toFixed(0)}% implied`}
              style={{ marginLeft: 5 }}>
              {pick.edge >= 0 ? '+' : ''}{(pick.edge * 100).toFixed(0)}pp
            </span>
          )}
        </div>

        {/* The straight 1X2 view. A Double Chance pick at 92% and a 1X2 top
            outcome at 53% describe the same fixture — DC 1X is P(home)+P(draw), a
            strictly easier event — so showing only the pick's own probability made
            confident-looking picks out of matches the model sees as close. */}
        <div className="pk-x2">
          {pick.blend ? (() => {
            const { home = 0, draw = 0, away = 0 } = pick.blend
            const top = home >= draw && home >= away ? ['H', home]
                      : away >= draw ? ['A', away] : ['D', draw]
            return (
              <span className="num" title={`Blended 1X2 — Home ${(home * 100).toFixed(0)}% · Draw ${(draw * 100).toFixed(0)}% · Away ${(away * 100).toFixed(0)}%`}
                style={{ fontSize: 12.5, fontWeight: 700, color: top[1] >= 0.60 ? 'var(--pos)' : top[1] >= 0.45 ? 'var(--accent-2)' : 'var(--tx-3)' }}>
                {top[0]} {(top[1] * 100).toFixed(0)}%
              </span>
            )
          })() : <span className="muted2">—</span>}
        </div>

        {/* Over 1.5 on every row regardless of the pick's own market. It is the
            most reliable market in the data (80.7% on low-tier fixtures) and the
            one most often worth taking instead, so it belongs in the table rather
            than only inside the goals sub-row. */}
        <div className="pk-o15">
          {pick.over15 != null ? (
            <span className="num" title="Model probability of Over 1.5 goals in this fixture"
              style={{ fontSize: 12.5, fontWeight: 700, color: pick.over15 >= 0.80 ? 'var(--pos)' : pick.over15 >= 0.65 ? 'var(--pos)' : 'var(--tx-3)', opacity: pick.over15 >= 0.80 ? 1 : pick.over15 >= 0.65 ? 0.8 : 1 }}>
              {(pick.over15 * 100).toFixed(0)}%
            </span>
          ) : <span className="muted2">—</span>}
        </div>

        <div className="pk-value">
          {pick.value
            ? <span className={`pill pill-${valTone}`}>{pick.value === 'Good value' ? '↑ Good' : pick.value === 'Poor value' ? '↓ Poor' : '= Fair'}</span>
            : <span className="muted2">—</span>}
        </div>

        <div className="pk-reason">
          {pick.reason ? (
            <div>
              {pickChanged && (
                <div style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--warn)', marginBottom: 3, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                  <span>↻ AI changed pick</span>
                  {pick.originalSelection && pick.selection !== pick.originalSelection && (
                    <span className="muted" style={{ fontWeight: 400 }}>({pick.originalSelection} → {pick.selection})</span>
                  )}
                </div>
              )}
              <span style={{ color: 'var(--pos)' }}>{pick.reason}</span>
            </div>
          ) : pick.blend ? (
            <span className="muted2 num">
              H{(pick.blend.home * 100).toFixed(0)} D{(pick.blend.draw * 100).toFixed(0)} A{(pick.blend.away * 100).toFixed(0)}
              {pick.over25 != null && ` · O2.5 ${(pick.over25 * 100).toFixed(0)}%`}
              {pick.btts   != null && ` · BTTS ${(pick.btts * 100).toFixed(0)}%`}
            </span>
          ) : <span className="muted2">—</span>}
        </div>

        <div className="pk-act" onClick={e => e.stopPropagation()}>
          {/* Detail expander. Only in compact mode — uncompacted rows already show everything,
              so a button that reveals nothing would be worse than no button. */}
          {compact && (
            <button className="btn btn-sm btn-ghost" style={{ padding: '2px 5px', fontSize: 10 }}
              onClick={e => { e.stopPropagation(); onToggleRow(pick.fixtureId) }}
              title={rowExpanded ? 'Hide flags, history, news and alternative markets' : 'Show flags, goals/results history, news and alternative markets'}>
              {rowExpanded ? '▾' : '▸'}
            </button>
          )}
          {/* Enrich button — only when no data cached yet */}
          {pick.dataVerified === 'unverified' && (
            isEnriching
              ? <span style={{ fontSize: 10, color: 'var(--warn)' }}>fetching…</span>
              : (
                <button className="btn btn-sm btn-warn" disabled={anyEnriching}
                  onClick={e => { e.stopPropagation(); onEnrich(pick.fixtureId, pick.market, pick.selection) }}
                  title="Fetch form, standings & H2H data for this match">
                  + Data
                </button>
              )
          )}
          {isAnalysing ? (
            <span className="spin" style={{ color: 'var(--tx-3)' }} />
          ) : hasAI ? (
            <button className="btn btn-sm btn-pos" onClick={e => { e.stopPropagation(); onToggleAI(pick.fixtureId) }}
              title={aiExpanded ? 'Hide AI analysis' : 'Show AI analysis'}>
              {aiExpanded ? '▲ AI' : '▼ AI'}
            </button>
          ) : (
            <button className="btn btn-sm btn-info" disabled={!pick.fixtureId || anyAnalysing}
              onClick={e => { e.stopPropagation(); onAnalyse(pick.fixtureId) }}
              title="Run Claude analysis on this pick">
              AI
            </button>
          )}
        </div>
      </div>

      {showDetail && goalsRow}
      {showDetail && optRows}

      {hasAI && aiExpanded && (
        <div key={`${pick.fixtureId ?? idx}-ai`} className="pk-ai">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
            <div className="toolbar">
              <span className="eyebrow" style={{ color: 'var(--pos)' }}>AI analysis</span>
              {pickChanged && (
                <span className="pill pill-warn">
                  ↻ Changed: {pick.originalMarket !== pick.market ? `${pick.originalMarket} → ${pick.market}` : ''}
                  {pick.originalSelection !== pick.selection ? (pick.originalMarket !== pick.market ? ' · ' : '') + `${pick.originalSelection} → ${pick.selection}` : ''}
                </span>
              )}
            </div>
            <button className="btn btn-sm btn-ghost" onClick={e => { e.stopPropagation(); onToggleAI(pick.fixtureId) }}>▲ hide</button>
          </div>

          {/* Pick decision reason — shown first when AI changed the pick */}
          {pick.reason && (
            <div style={{
              marginBottom: 14, borderRadius: 'var(--r)', padding: '10px 13px',
              background: pickChanged ? 'var(--warn-soft)' : 'var(--pos-soft)',
              border: `1px solid ${pickChanged ? 'var(--warn-dim)' : 'var(--pos-dim)'}`,
            }}>
              <div className="eyebrow" style={{ color: pickChanged ? 'var(--warn)' : 'var(--pos)', marginBottom: 5 }}>
                {pickChanged ? 'Why AI changed this pick' : 'Pick reasoning'}
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--tx)', lineHeight: 1.55 }}>{pick.reason}</div>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 20 }}>
            <div>
              {pick.verdict && (
                <div style={{ marginBottom: 7 }}>
                  <span className="muted2" style={{ fontSize: 11 }}>Verdict: </span>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: pick.verdict === 'Home Win' ? 'var(--info)' : pick.verdict === 'Away Win' ? 'var(--warn)' : 'var(--accent-2)' }}>
                    {pick.verdict}
                  </span>
                  {pick.claudeConf && (
                    <span style={{ fontSize: 10.5, marginLeft: 6, fontWeight: 700, color: pick.claudeConf === 'High' ? 'var(--pos)' : pick.claudeConf === 'Medium' ? 'var(--warn)' : 'var(--neg)' }}>
                      {pick.claudeConf}
                    </span>
                  )}
                  {pick.predictedScore && <span className="muted" style={{ fontSize: 11.5, marginLeft: 8 }}>({pick.predictedScore})</span>}
                </div>
              )}
              {pick.modelAgreement && (
                <div style={{ fontSize: 10.5, marginBottom: 4, color: pick.modelAgreement === 'Strong' ? 'var(--pos)' : pick.modelAgreement === 'Conflicting' ? 'var(--neg)' : 'var(--warn)' }}>
                  Models: {pick.modelAgreement}
                </div>
              )}
              {pick.riskFactor && <div style={{ fontSize: 10.5, color: 'var(--neg)', marginBottom: 4 }}>Risk: {pick.riskFactor}</div>}
              {pick.formEdge && pick.formEdge !== 'Neutral' && <div style={{ fontSize: 10.5, color: 'var(--info)', marginBottom: 4 }}>Form edge: {pick.formEdge}</div>}
              {pick.injuryImpact && pick.injuryImpact !== 'None' && <div style={{ fontSize: 10.5, color: 'var(--warn)', marginBottom: 4 }}>Injuries: {pick.injuryImpact} impact</div>}
            </div>

            <div>
              {pick.bestBet && (
                <div style={{ marginBottom: 10 }}>
                  <div className="eyebrow" style={{ color: 'var(--pos)', marginBottom: 4 }}>Best bet</div>
                  <div style={{ fontSize: 12, color: 'var(--pos)', lineHeight: 1.45 }}>{pick.bestBet}</div>
                </div>
              )}
              {pick.valueBet && (
                <div>
                  <div className="eyebrow" style={{ color: 'var(--warn)', marginBottom: 4 }}>Value bet</div>
                  <div style={{ fontSize: 12, color: 'var(--warn)', lineHeight: 1.45 }}>{pick.valueBet}</div>
                </div>
              )}
              {pick.updatedBestBet && (
                <div style={{ marginTop: 10 }}>
                  <div className="eyebrow" style={{ color: 'var(--info)', marginBottom: 4 }}>News-updated pick</div>
                  <div style={{ fontSize: 12, color: 'var(--info)', lineHeight: 1.45 }}>{pick.updatedBestBet}</div>
                </div>
              )}
            </div>

            <div>
              {pick.keyFactors?.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <div className="eyebrow" style={{ marginBottom: 5 }}>Key factors</div>
                  {pick.keyFactors.map((f, fi) => (
                    <div key={fi} style={{ fontSize: 11.5, color: 'var(--tx-2)', marginBottom: 2 }}>· {f}</div>
                  ))}
                </div>
              )}
              {pick.fullAnalysis && (
                <div>
                  <div className="eyebrow" style={{ marginBottom: 5 }}>Analysis</div>
                  <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.6 }}>{pick.fullAnalysis}</div>
                </div>
              )}
              {pick.newsAnalysisText && (
                <div style={{ marginTop: 10 }}>
                  <div className="eyebrow" style={{ color: 'var(--info)', marginBottom: 5 }}>News</div>
                  <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.6 }}>{pick.newsAnalysisText}</div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
})
