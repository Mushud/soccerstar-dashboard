import { useEffect, useState, useCallback } from 'react'
import api, { API_BASE } from '../api'
import AppShell from '../components/AppShell'
import PredictionCard from '../components/PredictionCard'


const CONTINENT_ORDER = ['World', 'Europe', 'Americas', 'Asia', 'Africa', 'Oceania']
const CONTINENT_COLOR = {
  World: 'var(--warn)', Europe: 'var(--pos-dim)', Americas: 'var(--info-dim)',
  Asia: 'var(--warn-dim)', Africa: 'var(--warn)', Oceania: 'var(--accent-dim)',
}

const RISK_OPTIONS = [
  { key: 'low',    label: 'Low Risk',    emoji: '🛡', color: 'var(--pos)', bg: 'var(--pos-soft)', border: 'var(--pos-dim)' },
  { key: 'medium', label: 'Medium Risk', emoji: '⚖', color: 'var(--warn)', bg: 'var(--warn-soft)', border: 'var(--warn-dim)' },
  { key: 'high',   label: 'High Risk',   emoji: '🔥', color: 'var(--neg)', bg: 'var(--neg-soft)', border: 'var(--neg-dim)' },
]

function fmt(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString('en-GB', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function sideBtn(bg) {
  return { background: bg, color: '#fff', border: 'none', borderRadius: '8px', padding: '6px 14px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }
}

function tabBtn(active, color = 'var(--pos-dim)') {
  return {
    background: active ? color : 'transparent',
    color: active ? '#fff' : 'var(--tx-3)',
    border: `1px solid ${active ? color : 'var(--line-strong)'}`,
    borderRadius: '8px', padding: '6px 16px',
    cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600,
  }
}

export default function Tournaments() {
  const [leagues, setLeagues]             = useState([])
  const [leaguesLoading, setLeaguesLoading] = useState(true)
  const [continentFilter, setContinentFilter] = useState('All')
  const [selectedLeague, setSelectedLeague]   = useState(null)
  const [activeTab, setActiveTab]             = useState('fixtures') // 'fixtures' | 'builder'

  // ── Fixtures tab ──
  const [fixtures, setFixtures]     = useState([])
  const [fixturesLoading, setFixturesLoading] = useState(false)
  const [predictions, setPredictions] = useState({})
  const [computing, setComputing]     = useState({})
  const [syncing, setSyncing]         = useState(false)
  const [syncMsg, setSyncMsg]         = useState(null)

  // ── Bet Builder tab ──
  const [risks, setRisks]           = useState(['low'])
  const [duration, setDuration]     = useState('week')
  const [picks, setPicks]           = useState([])
  const [picksLoading, setPicksLoading] = useState(false)
  const [picksMeta, setPicksMeta]   = useState(null)
  const [picksError, setPicksError] = useState(null)
  const [loadMsg, setLoadMsg]       = useState('')
  const [selected, setSelected]     = useState(new Set())
  const [sortBy, setSortBy]         = useState('score')
  const [showAll, setShowAll]         = useState(false)
  const [analysing, setAnalysing]     = useState(false)
  const [expandedAI, setExpandedAI]   = useState(new Set())
  const [runningPreds, setRunningPreds] = useState(false)
  const [selectedFixtures, setSelectedFixtures] = useState(new Set()) // manual fixture picker

  const DURATION_LABELS = { today: 'Today', tomorrow: 'Tomorrow', '3days': 'Next 3 Days', week: 'This Week' }

  // ── Load leagues list ──
  useEffect(() => {
    api.get('/api/fixtures/leagues').then(({ data }) => setLeagues(data.leagues || []))
      .catch(() => {}).finally(() => setLeaguesLoading(false))
  }, [])

  // ── Select a league ──
  async function selectLeague(league) {
    setSelectedLeague(league)
    setFixtures([])
    setPredictions({})
    setPicks([])
    setPicksMeta(null)
    setPicksError(null)
    setSelected(new Set())
    setSelectedFixtures(new Set())
    setSyncMsg(null)
    setActiveTab('fixtures')
    await loadFixtures(league)
  }

  async function loadFixtures(league) {
    setFixturesLoading(true)
    try {
      const now = new Date().toISOString()
      const { data } = await api.get('/api/fixtures', {
        params: { league: league.name, status: 'upcoming', from: now, limit: 1500 }
      })
      // Also fetch live matches for this league
      const { data: liveData } = await api.get('/api/fixtures/live').catch(() => ({ data: { fixtures: [] } }))
      const liveForLeague = (liveData.fixtures || []).filter(f =>
        f.league?.toLowerCase().includes(league.name.toLowerCase())
      )
      const all = [...liveForLeague, ...(data.fixtures || [])]
      // Deduplicate by _id
      const seen = new Set()
      const deduped = all.filter(f => { if (seen.has(f._id)) return false; seen.add(f._id); return true })
      setFixtures(deduped)

      const predMap = {}
      await Promise.all(deduped.map(async (f) => {
        try {
          const { data: pred } = await api.get(`/api/predictions/${f._id}`)
          predMap[f._id] = pred
        } catch { /* none yet */ }
      }))
      setPredictions(predMap)
    } catch {
      // silently fail
    } finally {
      setFixturesLoading(false)
    }
  }

  async function handlePredict(fixtureId) {
    setComputing(c => ({ ...c, [fixtureId]: true }))
    try {
      const { data: pred } = await api.post(`/api/predictions/fixture/${fixtureId}`)
      setPredictions(p => ({ ...p, [fixtureId]: pred }))
    } catch (e) {
      alert('Prediction failed: ' + (e.response?.data?.error || e.message))
    } finally {
      setComputing(c => ({ ...c, [fixtureId]: false }))
    }
  }

  async function handleSync() {
    if (!selectedLeague) return
    setSyncing(true); setSyncMsg(null)
    try {
      await api.post('/api/sync/all')
      setSyncMsg('Synced!')
      await loadFixtures(selectedLeague)
      setSyncMsg(null)
    } catch (e) { setSyncMsg('Sync failed: ' + e.message) }
    finally { setSyncing(false) }
  }

  // ── Bet Builder ──
  function toggleRisk(key) {
    setRisks(prev => prev.includes(key)
      ? (prev.length > 1 ? prev.filter(r => r !== key) : prev)
      : [...prev, key])
  }

  function toggleSelect(id) {
    setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  }

  async function generatePicks() {
    if (!selectedLeague) return
    setPicksLoading(true)
    setPicksError(null)
    setPicks([])
    setPicksMeta(null)
    setSelected(new Set())
    setLoadMsg('')

    try {
      const res = await fetch(`${API_BASE}/api/betbuilder/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ risk: risks, duration, limit: 1500, showAll, league: selectedLeague.name }),
      })

      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        setPicksError(json.error || `Server error ${res.status}`)
        setPicksLoading(false)
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
        buf = parts.pop()
        for (const part of parts) {
          if (!part.startsWith('data: ')) continue
          let evt
          try { evt = JSON.parse(part.slice(6)) } catch { continue }
          if (evt.type === 'progress') { setLoadMsg(evt.message) }
          else if (evt.type === 'batch') { setPicks(prev => [...prev, ...evt.picks]); setLoadMsg('') }
          else if (evt.type === 'done')  { setPicksMeta(evt.meta); setPicksLoading(false) }
          else if (evt.type === 'error') { setPicksError(evt.error); setPicksLoading(false) }
        }
      }
      setPicksLoading(false)
    } catch (err) {
      setPicksError(err.message || 'Request failed.')
      setPicksLoading(false)
    }
  }

  async function analyseSelected() {
    if (!selected.size) return
    setAnalysing(true)
    try {
      const { data } = await api.post(`/api/betbuilder/analyse`,
        { fixtureIds: [...selected], risk: risks },
        { timeout: 10 * 60 * 1000 }
      )
      const byId = {}
      for (const r of (data.results || [])) byId[r.fixtureId] = r
      setPicks(prev => prev.map(p => {
        const r = byId[p.fixtureId]
        if (!r) return p
        return { ...p, market: r.market, selection: r.selection, odds: r.odds,
          value: r.value, reason: r.reason, hasClaudeAnalysis: true,
          verdict: r.verdict, claudeConf: r.claudeConf, predictedScore: r.predictedScore,
          bestBet: r.bestBet, fullAnalysis: r.fullAnalysis, keyFactors: r.keyFactors }
      }))
      setExpandedAI(prev => { const s = new Set(prev); for (const id of selected) s.add(id); return s })
    } catch (err) {
      setPicksError(err.response?.data?.error || err.message || 'Analysis failed.')
    } finally { setAnalysing(false) }
  }

  async function runPredictions() {
    if (!selectedLeague) return
    setRunningPreds(true)
    setPicksError(null)
    setLoadMsg(`Running predictions for ${selectedLeague.name}…`)
    try {
      await api.post('/api/predictions/run', { league: selectedLeague.name }, { timeout: 5 * 60 * 1000 })
      setLoadMsg('Done! Generating picks…')
      await generatePicks()
    } catch (e) {
      setPicksError('Prediction run failed: ' + (e.response?.data?.error || e.message))
    } finally {
      setRunningPreds(false)
      setLoadMsg('')
    }
  }

  function toggleFixture(id) {
    setSelectedFixtures(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  }
  function selectAllFixtures() {
    setSelectedFixtures(prev => prev.size === fixtures.length ? new Set() : new Set(fixtures.map(f => f._id)))
  }

  async function buildForSelectedFixtures() {
    if (!selectedFixtures.size) return
    const ids = [...selectedFixtures]
    setPicksLoading(true)
    setPicksError(null)
    setPicks([])
    setPicksMeta(null)
    setSelected(new Set())
    setLoadMsg(`Analysing ${ids.length} fixture${ids.length !== 1 ? 's' : ''}…`)
    try {
      const { data } = await api.post(`/api/betbuilder/analyse`,
        { fixtureIds: ids, risk: risks },
        { timeout: 10 * 60 * 1000 }
      )
      const newPicks = (data.results || []).map(r => ({
        fixtureId:        r.fixtureId,
        match:            fixtures.find(f => f._id === r.fixtureId)
                            ? `${fixtures.find(f => f._id === r.fixtureId).homeTeamName} v ${fixtures.find(f => f._id === r.fixtureId).awayTeamName}`
                            : r.fixtureId,
        fixtureDate:      fixtures.find(f => f._id === r.fixtureId)?.date ?? null,
        league:           selectedLeague?.name,
        market:           r.market,
        selection:        r.selection,
        odds:             r.odds,
        value:            r.value,
        reason:           r.reason,
        hasClaudeAnalysis: true,
        verdict:          r.verdict,
        claudeConf:       r.claudeConf,
        predictedScore:   r.predictedScore,
        bestBet:          r.bestBet,
        fullAnalysis:     r.fullAnalysis,
        keyFactors:       r.keyFactors,
        tier:             null,
        certaintyScore:   null,
        modelProb:        null,
        dataVerified:     'unverified',
      }))
      setPicks(newPicks)
      setPicksMeta({ fixturesScanned: ids.length, debug: {} })
    } catch (err) {
      setPicksError(err.response?.data?.error || err.message || 'Build failed.')
    } finally {
      setPicksLoading(false)
      setLoadMsg('')
    }
  }

  // ── Derived ──
  const continents = ['All', ...CONTINENT_ORDER.filter(c => leagues.some(l => l.continent === c))]
  const visibleLeagues = leagues.filter(l => continentFilter === 'All' || l.continent === continentFilter)
  const groupedLeagues = CONTINENT_ORDER.reduce((acc, c) => {
    const g = visibleLeagues.filter(l => l.continent === c)
    if (g.length) acc[c] = g
    return acc
  }, {})

  const fixturesByDate = fixtures.reduce((acc, f) => {
    const isLive = f.status === 'live'
    const day = isLive
      ? '🔴 Live Now'
      : new Date(f.date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
    if (!acc[day]) acc[day] = []
    acc[day].push(f)
    return acc
  }, {})

  // Sort day keys so Live is always first
  const sortedDays = Object.keys(fixturesByDate).sort((a, b) => {
    if (a === '🔴 Live Now') return -1
    if (b === '🔴 Live Now') return 1
    return new Date(fixturesByDate[a][0].date) - new Date(fixturesByDate[b][0].date)
  })

  const sortedPicks = [...picks].sort((a, b) => {
    if (sortBy === 'prob')  return parseFloat(b.modelProb) - parseFloat(a.modelProb)
    if (sortBy === 'odds')  return (b.odds || 0) - (a.odds || 0)
    if (sortBy === 'time')  return new Date(a.fixtureDate) - new Date(b.fixtureDate)
    return (b.certaintyScore ?? 0) - (a.certaintyScore ?? 0)
  })

  const TIER_COLORS = { low: 'var(--pos)', medium: 'var(--warn)', high: 'var(--neg)', none: 'var(--tx-4)' }
  const TIER_LABELS = { low: '🛡 LOW', medium: '⚖ MED', high: '🔥 HIGH', none: 'NO TIER' }

  return (
    <AppShell
      title="Tournaments"
      subtitle={selectedLeague ? selectedLeague.name : 'Pick a competition to see its fixtures and picks'}
      actions={selectedLeague && (
        <button className="btn btn-sm btn-info" onClick={handleSync} disabled={syncing}>
          {syncing ? <><span className="spin" /> Syncing…</> : 'Sync fixtures'}
        </button>
      )}
    >
        <div className="tour-layout">

          {/* ── League rail ── */}
          <div className="tour-rail">
            <div style={{ marginBottom: '0.75rem' }}>
              <div style={{ fontSize: '0.6rem', color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '6px' }}>Region</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                {continents.map(c => (
                  <button key={c} onClick={() => setContinentFilter(c)}
                    style={{ background: continentFilter === c ? (CONTINENT_COLOR[c] || 'var(--line-strong)') : 'transparent', color: continentFilter === c ? '#fff' : 'var(--tx-3)', border: `1px solid ${continentFilter === c ? (CONTINENT_COLOR[c] || 'var(--line-strong)') : 'var(--line-strong)'}`, borderRadius: '6px', padding: '3px 8px', cursor: 'pointer', fontSize: '0.72rem', fontWeight: 600 }}>
                    {c}
                  </button>
                ))}
              </div>
            </div>

            {leaguesLoading ? (
              <div style={{ color: 'var(--tx-3)', fontSize: '0.8rem' }}>Loading…</div>
            ) : (
              Object.entries(groupedLeagues).map(([continent, group]) => (
                <div key={continent} style={{ marginBottom: '1rem' }}>
                  <div style={{ fontSize: '0.6rem', fontWeight: 700, color: CONTINENT_COLOR[continent] ?? 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '5px', paddingBottom: '3px', borderBottom: `1px solid ${(CONTINENT_COLOR[continent] ?? 'var(--line-strong)')}33` }}>
                    {continent}
                  </div>
                  {group.map(league => (
                    <button key={league.id} onClick={() => selectLeague(league)} style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      background: selectedLeague?.id === league.id ? 'var(--line-strong)' : 'transparent',
                      color: selectedLeague?.id === league.id ? 'var(--tx)' : 'var(--tx-2)',
                      border: `1px solid ${selectedLeague?.id === league.id ? 'var(--tx-4)' : 'transparent'}`,
                      borderRadius: '6px', padding: '5px 8px', cursor: 'pointer',
                      fontSize: '0.78rem', fontWeight: selectedLeague?.id === league.id ? 600 : 400,
                      marginBottom: '2px'
                    }}>
                      {league.name}
                      {league.upcomingCount > 0 && (
                        <span style={{ float: 'right', fontSize: '0.65rem', color: 'var(--tx-4)', background: 'var(--line-strong)', borderRadius: '10px', padding: '1px 5px' }}>
                          {league.upcomingCount}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>

          {/* ── Main panel ── */}
          <div style={{ flex: 1, minWidth: 0 }}>

            {!selectedLeague && (
              <div className="card empty">
                <div className="empty-ico">🏆</div>
                <div className="empty-title">Pick a competition</div>
                <div className="empty-sub">Choose one from the list to see its fixtures, table and picks.</div>
              </div>
            )}

            {selectedLeague && (
              <>
                {/* League header + tabs */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '8px' }}>
                  <div>
                    <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--tx)' }}>{selectedLeague.name}</div>
                    {syncMsg && <div style={{ fontSize: '0.72rem', color: 'var(--pos)', marginTop: 2 }}>{syncMsg}</div>}
                  </div>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button onClick={() => setActiveTab('fixtures')} style={tabBtn(activeTab === 'fixtures', 'var(--pos-dim)')}>
                      Fixtures {fixtures.length > 0 ? `(${fixtures.length})` : ''}
                    </button>
                    <button onClick={() => setActiveTab('builder')} style={tabBtn(activeTab === 'builder', 'var(--warn-dim)')}>
                      🎯 Bet Builder {picks.length > 0 ? `(${picks.length})` : ''}
                    </button>
                  </div>
                </div>

                {/* ── FIXTURES TAB ── */}
                {activeTab === 'fixtures' && (
                  <div>
                    {fixturesLoading && (
                      <div style={{ color: 'var(--tx-3)', textAlign: 'center', padding: '3rem 0', fontSize: '0.85rem' }}>Loading fixtures…</div>
                    )}

                    {!fixturesLoading && fixtures.length === 0 && (
                      <div style={{ color: 'var(--tx-3)', textAlign: 'center', padding: '3rem 0' }}>
                        <p style={{ marginBottom: '0.5rem' }}>No upcoming fixtures for {selectedLeague.name}.</p>
                        <p style={{ fontSize: '0.8rem', marginBottom: '1rem' }}>Sync to fetch the latest schedule.</p>
                        <button onClick={handleSync} disabled={syncing} style={sideBtn('var(--info-dim)')}>
                          {syncing ? 'Syncing…' : 'Sync Now'}
                        </button>
                      </div>
                    )}

                    {!fixturesLoading && sortedDays.map(day => (
                      <div key={day} style={{ marginBottom: '1.5rem' }}>
                        <div style={{ fontSize: '0.68rem', fontWeight: 700, color: day === '🔴 Live Now' ? 'var(--neg)' : 'var(--tx-3)', textTransform: day === '🔴 Live Now' ? 'none' : 'uppercase', letterSpacing: '0.6px', marginBottom: '0.5rem', paddingBottom: '4px', borderBottom: `1px solid ${day === '🔴 Live Now' ? 'var(--neg-dim)' : 'var(--line-strong)'}` }}>
                          {day}
                        </div>
                        {fixturesByDate[day].map(f => (
                          <PredictionCard
                            key={f._id}
                            fixture={f}
                            prediction={predictions[f._id] || null}
                            onPredict={() => handlePredict(f._id)}
                            computing={!!computing[f._id]}
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                )}

                {/* ── BET BUILDER TAB ── */}
                {activeTab === 'builder' && (
                  <div>

                    {/* ── Fixture picker ── */}
                    {fixtures.length > 0 && (
                      <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, padding: 14, marginBottom: 14 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 8, flexWrap: 'wrap' }}>
                          <div style={{ fontSize: '0.68rem', color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 700 }}>
                            Pick Fixtures ({selectedFixtures.size}/{fixtures.length} selected)
                          </div>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button onClick={selectAllFixtures} style={{ padding: '4px 10px', borderRadius: 6, fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer', background: 'var(--surface-2)', color: 'var(--info)', border: '1px solid var(--info-dim)' }}>
                              {selectedFixtures.size === fixtures.length ? 'Deselect All' : 'Select All'}
                            </button>
                            {selectedFixtures.size > 0 && (
                              <button
                                onClick={buildForSelectedFixtures}
                                disabled={picksLoading}
                                style={{ padding: '4px 14px', borderRadius: 6, fontSize: '0.72rem', fontWeight: 800, cursor: picksLoading ? 'not-allowed' : 'pointer', background: picksLoading ? 'var(--pos-soft)' : 'linear-gradient(135deg,var(--warn-dim),var(--warn))', color: picksLoading ? 'var(--pos)' : '#fff', border: '1px solid var(--warn)', whiteSpace: 'nowrap' }}>
                                {picksLoading ? 'Building…' : `Build Bets for ${selectedFixtures.size} Fixture${selectedFixtures.size !== 1 ? 's' : ''}`}
                              </button>
                            )}
                          </div>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 260, overflowY: 'auto' }}>
                          {fixtures.map(f => {
                            const isSel = selectedFixtures.has(f._id)
                            const isLive = f.status === 'live'
                            const hasPred = !!predictions[f._id]
                            return (
                              <label key={f._id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', borderRadius: 6, cursor: 'pointer', background: isSel ? 'var(--info-soft)' : 'transparent', border: `1px solid ${isSel ? 'var(--info-dim)' : 'var(--line)'}` }}>
                                <input type="checkbox" checked={isSel} onChange={() => toggleFixture(f._id)} style={{ cursor: 'pointer', flexShrink: 0 }} />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--tx)', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                    {f.homeTeamName} <span style={{ color: 'var(--tx-4)', fontWeight: 400 }}>vs</span> {f.awayTeamName}
                                    {isLive && <span style={{ fontSize: '0.6rem', color: 'var(--neg)', fontWeight: 800 }}>● LIVE</span>}
                                  </div>
                                  <div style={{ fontSize: '0.65rem', color: 'var(--tx-4)', marginTop: 1 }}>{fmt(f.date)}</div>
                                </div>
                                <span style={{ fontSize: '0.65rem', color: hasPred ? 'var(--pos)' : 'var(--tx-4)', flexShrink: 0 }}>
                                  {hasPred ? '✓ predicted' : 'no prediction'}
                                </span>
                              </label>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    {/* Controls */}
                    <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, padding: 16, marginBottom: 16 }}>
                      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>

                        {/* Date window */}
                        <div>
                          <div style={{ fontSize: '0.6rem', color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Date Window</div>
                          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                            {Object.entries(DURATION_LABELS).map(([k, l]) => (
                              <button key={k} onClick={() => setDuration(k)} style={{ padding: '5px 10px', borderRadius: 6, fontSize: '0.75rem', cursor: 'pointer', background: duration === k ? 'var(--info-soft)' : 'var(--surface-2)', color: duration === k ? 'var(--info)' : 'var(--tx-3)', border: `1px solid ${duration === k ? 'var(--info-dim)' : 'var(--line-strong)'}`, fontWeight: duration === k ? 700 : 400 }}>
                                {l}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Risk */}
                        <div style={{ flex: 1, minWidth: 200 }}>
                          <div style={{ fontSize: '0.6rem', color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Risk Level</div>
                          <div style={{ display: 'flex', gap: 6 }}>
                            {RISK_OPTIONS.map(r => {
                              const active = risks.includes(r.key)
                              return (
                                <button key={r.key} onClick={() => toggleRisk(r.key)} style={{ flex: 1, padding: '8px 10px', borderRadius: 8, cursor: 'pointer', background: active ? r.bg : 'var(--surface-2)', border: `2px solid ${active ? r.color : r.border}`, textAlign: 'left' }}>
                                  {active && <span style={{ float: 'right', fontSize: 10, color: r.color, fontWeight: 800 }}>✓</span>}
                                  <div style={{ fontSize: 12, fontWeight: 700, color: r.color }}>{r.emoji} {r.label}</div>
                                </button>
                              )
                            })}
                          </div>
                        </div>

                        {/* Generate button */}
                        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                          <div style={{ fontSize: '0.6rem', color: 'transparent', marginBottom: 6 }}>.</div>
                          <button onClick={generatePicks} disabled={picksLoading} style={{ padding: '10px 20px', borderRadius: 10, fontSize: 14, fontWeight: 800, cursor: picksLoading ? 'not-allowed' : 'pointer', background: picksLoading ? 'var(--pos-soft)' : 'linear-gradient(135deg,var(--pos-dim),var(--pos))', color: picksLoading ? 'var(--pos)' : 'var(--pos)', border: '1px solid var(--pos)', whiteSpace: 'nowrap' }}>
                            {picksLoading ? 'Loading picks…' : `Auto-Pick Best Bets`}
                          </button>
                        </div>
                      </div>

                      {loadMsg && (
                        <div style={{ fontSize: '0.72rem', color: 'var(--tx-3)', marginTop: 10, textAlign: 'center' }}>{loadMsg}</div>
                      )}
                    </div>

                    {/* Error */}
                    {picksError && (
                      <div style={{ background: 'var(--neg-soft)', border: '1px solid var(--neg-dim)', borderRadius: 8, padding: '10px 14px', marginBottom: 12, color: 'var(--neg)', fontSize: '0.82rem' }}>
                        {picksError}
                      </div>
                    )}

                    {/* Results */}
                    {picks.length > 0 && (
                      <div>
                        {/* Summary + sort + actions */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 10, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, padding: '10px 14px' }}>
                          <div style={{ fontSize: '0.72rem', color: 'var(--tx-3)', lineHeight: 1.7 }}>
                            <span style={{ color: 'var(--tx)', fontWeight: 700 }}>{picks.length}</span> picks ·{' '}
                            <span>{picksMeta?.fixturesScanned ?? '?'} fixtures scanned</span>
                            {picksMeta?.debug?.noPred > 0 && (
                              <span style={{ color: 'var(--neg)' }}> · {picksMeta.debug.noPred} no prediction yet</span>
                            )}
                            {picksMeta?.debug?.failedGate > 0 && (
                              <span style={{ color: 'var(--warn)' }}> · {picksMeta.debug.failedGate} below probability threshold</span>
                            )}
                            {picksMeta?.failedEnrichment > 0 && (
                              <span style={{ color: 'var(--tx-3)' }}> · {picksMeta.failedEnrichment} blocked by data</span>
                            )}
                            {selected.size > 0 && <span> · <span style={{ color: 'var(--info)', fontWeight: 700 }}>{selected.size} selected</span></span>}
                          </div>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                            {picksMeta?.debug?.noPred > 0 && (
                              <button onClick={runPredictions} disabled={runningPreds || picksLoading} title="Run the prediction engine on all fixtures in this tournament that have no prediction yet, then reload picks" style={{ padding: '5px 12px', borderRadius: 6, fontSize: '0.75rem', fontWeight: 700, cursor: (runningPreds || picksLoading) ? 'not-allowed' : 'pointer', background: 'var(--accent-soft)', color: 'var(--accent-2)', border: '1px solid var(--accent-dim)' }}>
                                {runningPreds ? '⚙️ Running…' : `⚙️ Run ${picksMeta.debug.noPred} Predictions`}
                              </button>
                            )}
                            <button onClick={() => { setShowAll(v => !v) }} title={showAll ? 'Showing all matches — risk gate off' : 'Only showing matches that pass the risk gate'} style={{ padding: '5px 10px', borderRadius: 6, fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer', background: showAll ? 'var(--accent-soft)' : 'var(--surface-2)', color: showAll ? 'var(--accent-2)' : 'var(--tx-3)', border: `1px solid ${showAll ? 'var(--accent)' : 'var(--line-strong)'}` }}>
                              {showAll ? '🔓 All matches' : '🎯 Filtered'}
                            </button>
                            {selected.size > 0 && (
                              <button onClick={analyseSelected} disabled={analysing} style={{ padding: '5px 12px', borderRadius: 6, fontSize: '0.75rem', fontWeight: 700, cursor: analysing ? 'not-allowed' : 'pointer', background: 'var(--info-soft)', color: analysing ? 'var(--tx-3)' : 'var(--info)', border: '1px solid var(--info-dim)' }}>
                                {analysing ? 'Running Claude…' : `Analyse ${selected.size} Selected`}
                              </button>
                            )}
                            <span style={{ fontSize: '0.68rem', color: 'var(--tx-4)' }}>Sort:</span>
                            {[['score','Score'],['prob','Model %'],['odds','Odds'],['time','Time']].map(([k, l]) => (
                              <button key={k} onClick={() => setSortBy(k)} style={{ padding: '4px 8px', borderRadius: 5, fontSize: '0.68rem', fontWeight: 700, cursor: 'pointer', background: sortBy === k ? 'var(--info-soft)' : 'var(--surface-2)', color: sortBy === k ? 'var(--info)' : 'var(--tx-3)', border: `1px solid ${sortBy === k ? 'var(--info-dim)' : 'var(--line-strong)'}` }}>{l}</button>
                            ))}
                          </div>
                        </div>

                        {/* Pick cards */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {sortedPicks.map((pick, i) => {
                            const isSel = selected.has(pick.fixtureId)
                            const hasAI = pick.hasClaudeAnalysis
                            const aiExp = expandedAI.has(pick.fixtureId)
                            const tierColor = TIER_COLORS[pick.tier] ?? 'var(--tx-4)'
                            const valColor = pick.value === 'Good value' ? 'var(--pos)' : pick.value === 'Poor value' ? 'var(--neg)' : 'var(--warn)'

                            return (
                              <div key={pick.fixtureId ?? i}
                                onClick={() => pick.fixtureId && toggleSelect(pick.fixtureId)}
                                style={{ background: isSel ? 'var(--info-soft)' : hasAI ? 'var(--pos-soft)' : 'var(--surface)', border: `1px solid ${isSel ? 'var(--info-dim)' : 'var(--line)'}`, borderRadius: 10, overflow: 'hidden', cursor: 'pointer' }}>

                                {/* Main row */}
                                <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                                  <input type="checkbox" checked={isSel} onChange={() => toggleSelect(pick.fixtureId)} onClick={e => e.stopPropagation()} disabled={!pick.fixtureId} style={{ cursor: 'pointer', flexShrink: 0 }} />

                                  <div style={{ flex: '2', minWidth: 150 }}>
                                    <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--tx)', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                      {pick.match}
                                      <span style={{ fontSize: '0.6rem', fontWeight: 800, padding: '2px 5px', borderRadius: 3, color: tierColor, border: `1px solid ${tierColor}44`, background: `${tierColor}11` }}>
                                        {TIER_LABELS[pick.tier] ?? pick.tier}
                                      </span>
                                      {pick.dataVerified === 'confirmed' && <span style={{ fontSize: '0.6rem', color: 'var(--pos)' }}>✓ DATA</span>}
                                      {pick.dataVerified === 'risky'     && <span style={{ fontSize: '0.6rem', color: 'var(--neg)' }}>⚠ CHECK</span>}
                                    </div>
                                    <div style={{ fontSize: '0.68rem', color: 'var(--tx-4)', marginTop: 2 }}>{fmt(pick.fixtureDate)}</div>
                                  </div>

                                  <div style={{ fontSize: '0.75rem', color: 'var(--info)', fontWeight: 600, minWidth: 90 }}>{pick.market}</div>
                                  <div style={{ fontSize: '0.82rem', color: 'var(--info)', fontWeight: 700, minWidth: 100 }}>{pick.selection}</div>

                                  <div style={{ fontSize: '0.9rem', fontWeight: 800, color: pick.odds < 1.35 ? 'var(--neg)' : 'var(--warn)', minWidth: 48 }}>
                                    {pick.odds}x
                                  </div>

                                  <div style={{ fontSize: '0.75rem', color: 'var(--pos)', fontWeight: 700, minWidth: 44 }}>{pick.modelProb}</div>

                                  {pick.value && (
                                    <span style={{ fontSize: '0.68rem', fontWeight: 700, padding: '2px 6px', borderRadius: 5, color: valColor, border: `1px solid ${valColor}44`, background: `${valColor}11` }}>
                                      {pick.value === 'Good value' ? '↑ Good' : pick.value === 'Poor value' ? '↓ Poor' : '= Fair'}
                                    </span>
                                  )}

                                  {/* AI toggle */}
                                  {hasAI && (
                                    <button onClick={e => { e.stopPropagation(); setExpandedAI(prev => { const s = new Set(prev); s.has(pick.fixtureId) ? s.delete(pick.fixtureId) : s.add(pick.fixtureId); return s }) }}
                                      style={{ padding: '3px 8px', borderRadius: 5, fontSize: '0.68rem', fontWeight: 700, cursor: 'pointer', background: aiExp ? 'var(--pos-soft)' : 'var(--pos-soft)', color: 'var(--pos)', border: '1px solid var(--pos-dim)' }}>
                                      {aiExp ? '▲ AI' : '▼ AI'}
                                    </button>
                                  )}
                                </div>

                                {/* Reason row */}
                                {pick.reason && (
                                  <div style={{ padding: '6px 14px 8px 44px', borderTop: '1px solid var(--surface-2)', fontSize: '0.72rem', color: 'var(--pos)', lineHeight: 1.4 }}>
                                    {pick.reason}
                                  </div>
                                )}

                                {/* AI expanded */}
                                {hasAI && aiExp && (
                                  <div style={{ borderTop: '1px solid var(--pos-soft)', background: 'var(--pos-soft)', padding: '10px 14px 12px 44px' }}>
                                    <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                                      {pick.verdict && (
                                        <div>
                                          <div style={{ fontSize: '0.6rem', color: 'var(--tx-4)', textTransform: 'uppercase', marginBottom: 3 }}>Verdict</div>
                                          <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--info)' }}>{pick.verdict}</div>
                                          {pick.claudeConf && <div style={{ fontSize: '0.65rem', color: pick.claudeConf === 'High' ? 'var(--pos)' : pick.claudeConf === 'Medium' ? 'var(--warn)' : 'var(--neg)' }}>{pick.claudeConf}</div>}
                                          {pick.predictedScore && <div style={{ fontSize: '0.65rem', color: 'var(--tx-3)', marginTop: 2 }}>Score: {pick.predictedScore}</div>}
                                        </div>
                                      )}
                                      {pick.bestBet && (
                                        <div>
                                          <div style={{ fontSize: '0.6rem', color: 'var(--pos)', textTransform: 'uppercase', marginBottom: 3 }}>Best Bet</div>
                                          <div style={{ fontSize: '0.72rem', color: 'var(--pos)' }}>{pick.bestBet}</div>
                                        </div>
                                      )}
                                      {pick.keyFactors?.length > 0 && (
                                        <div style={{ flex: 1, minWidth: 180 }}>
                                          <div style={{ fontSize: '0.6rem', color: 'var(--tx-3)', textTransform: 'uppercase', marginBottom: 3 }}>Key Factors</div>
                                          {pick.keyFactors.map((f, fi) => <div key={fi} style={{ fontSize: '0.68rem', color: 'var(--tx-2)' }}>· {f}</div>)}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    {!picksLoading && !picksError && picks.length === 0 && (
                      <div style={{ color: 'var(--tx-3)', textAlign: 'center', padding: '3rem 0' }}>
                        <p>Choose risk level and date window, then click Get Picks.</p>
                        <p style={{ fontSize: '0.8rem', marginTop: '0.5rem' }}>
                          Make sure fixtures are synced and predictions are run first (Fixtures tab → Predict buttons).
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
    </AppShell>
  )
}
