import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import axios from 'axios'
import PredictionCard from '../components/PredictionCard'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001'

const CONTINENT_ORDER = ['World', 'Europe', 'Americas', 'Asia', 'Africa', 'Oceania']
const CONTINENT_COLOR = {
  World: '#d69e2e', Europe: '#276749', Americas: '#2b6cb0',
  Asia: '#744210', Africa: '#c05621', Oceania: '#553c9a',
}

const RISK_OPTIONS = [
  { key: 'low',    label: 'Low Risk',    emoji: '🛡', color: '#68d391', bg: '#0f2a1a', border: '#276749' },
  { key: 'medium', label: 'Medium Risk', emoji: '⚖', color: '#ecc94b', bg: '#2d2a1a', border: '#744210' },
  { key: 'high',   label: 'High Risk',   emoji: '🔥', color: '#fc8181', bg: '#2a0f0f', border: '#742a2a' },
]

function fmt(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString('en-GB', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function sideBtn(bg) {
  return { background: bg, color: '#fff', border: 'none', borderRadius: '8px', padding: '6px 14px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }
}

function tabBtn(active, color = '#276749') {
  return {
    background: active ? color : 'transparent',
    color: active ? '#fff' : '#718096',
    border: `1px solid ${active ? color : '#2d3748'}`,
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
    axios.get('/api/fixtures/leagues').then(({ data }) => setLeagues(data.leagues || []))
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
      const { data } = await axios.get('/api/fixtures', {
        params: { league: league.name, status: 'upcoming', from: now, limit: 200 }
      })
      // Also fetch live matches for this league
      const { data: liveData } = await axios.get('/api/fixtures/live').catch(() => ({ data: { fixtures: [] } }))
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
          const { data: pred } = await axios.get(`/api/predictions/${f._id}`)
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
      const { data: pred } = await axios.post(`/api/predictions/fixture/${fixtureId}`)
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
      await axios.post('/api/sync/all')
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
      const res = await fetch(`${API}/api/betbuilder/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ risk: risks, duration, limit: 500, showAll, league: selectedLeague.name }),
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
      const { data } = await axios.post(`${API}/api/betbuilder/analyse`,
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
      await axios.post('/api/predictions/run', { league: selectedLeague.name }, { timeout: 5 * 60 * 1000 })
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
      const { data } = await axios.post(`${API}/api/betbuilder/analyse`,
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

  const TIER_COLORS = { low: '#68d391', medium: '#ecc94b', high: '#fc8181', none: '#4a5568' }
  const TIER_LABELS = { low: '🛡 LOW', medium: '⚖ MED', high: '🔥 HIGH', none: 'NO TIER' }

  return (
    <>
      <header>
        <div className="container" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Link to="/" style={{ color: '#718096', textDecoration: 'none', fontSize: '0.85rem', fontWeight: 400 }}>← Dashboard</Link>
            <span style={{ color: '#4a5568' }}>/</span>
            Tournaments
          </h1>
          {selectedLeague && (
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <button onClick={handleSync} disabled={syncing} style={sideBtn('#2b6cb0')}>
                {syncing ? 'Syncing…' : 'Sync Fixtures'}
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="container">
        <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-start' }}>

          {/* ── League sidebar ── */}
          <div style={{ width: '210px', flexShrink: 0 }}>
            <div style={{ marginBottom: '0.75rem' }}>
              <div style={{ fontSize: '0.6rem', color: '#718096', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '6px' }}>Region</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                {continents.map(c => (
                  <button key={c} onClick={() => setContinentFilter(c)}
                    style={{ background: continentFilter === c ? (CONTINENT_COLOR[c] || '#2d3748') : 'transparent', color: continentFilter === c ? '#fff' : '#718096', border: `1px solid ${continentFilter === c ? (CONTINENT_COLOR[c] || '#2d3748') : '#2d3748'}`, borderRadius: '6px', padding: '3px 8px', cursor: 'pointer', fontSize: '0.72rem', fontWeight: 600 }}>
                    {c}
                  </button>
                ))}
              </div>
            </div>

            {leaguesLoading ? (
              <div style={{ color: '#718096', fontSize: '0.8rem' }}>Loading…</div>
            ) : (
              Object.entries(groupedLeagues).map(([continent, group]) => (
                <div key={continent} style={{ marginBottom: '1rem' }}>
                  <div style={{ fontSize: '0.6rem', fontWeight: 700, color: CONTINENT_COLOR[continent] ?? '#718096', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '5px', paddingBottom: '3px', borderBottom: `1px solid ${(CONTINENT_COLOR[continent] ?? '#2d3748')}33` }}>
                    {continent}
                  </div>
                  {group.map(league => (
                    <button key={league.id} onClick={() => selectLeague(league)} style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      background: selectedLeague?.id === league.id ? '#2d3748' : 'transparent',
                      color: selectedLeague?.id === league.id ? '#e2e8f0' : '#a0aec0',
                      border: `1px solid ${selectedLeague?.id === league.id ? '#4a5568' : 'transparent'}`,
                      borderRadius: '6px', padding: '5px 8px', cursor: 'pointer',
                      fontSize: '0.78rem', fontWeight: selectedLeague?.id === league.id ? 600 : 400,
                      marginBottom: '2px'
                    }}>
                      {league.name}
                      {league.upcomingCount > 0 && (
                        <span style={{ float: 'right', fontSize: '0.65rem', color: '#4a5568', background: '#2d3748', borderRadius: '10px', padding: '1px 5px' }}>
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
              <div style={{ color: '#718096', textAlign: 'center', padding: '5rem 0' }}>
                <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>🏆</div>
                <p style={{ fontSize: '0.9rem', margin: 0 }}>Select a tournament on the left.</p>
              </div>
            )}

            {selectedLeague && (
              <>
                {/* League header + tabs */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '8px' }}>
                  <div>
                    <div style={{ fontSize: '1rem', fontWeight: 700, color: '#e2e8f0' }}>{selectedLeague.name}</div>
                    {syncMsg && <div style={{ fontSize: '0.72rem', color: '#68d391', marginTop: 2 }}>{syncMsg}</div>}
                  </div>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button onClick={() => setActiveTab('fixtures')} style={tabBtn(activeTab === 'fixtures', '#276749')}>
                      Fixtures {fixtures.length > 0 ? `(${fixtures.length})` : ''}
                    </button>
                    <button onClick={() => setActiveTab('builder')} style={tabBtn(activeTab === 'builder', '#744210')}>
                      🎯 Bet Builder {picks.length > 0 ? `(${picks.length})` : ''}
                    </button>
                  </div>
                </div>

                {/* ── FIXTURES TAB ── */}
                {activeTab === 'fixtures' && (
                  <div>
                    {fixturesLoading && (
                      <div style={{ color: '#718096', textAlign: 'center', padding: '3rem 0', fontSize: '0.85rem' }}>Loading fixtures…</div>
                    )}

                    {!fixturesLoading && fixtures.length === 0 && (
                      <div style={{ color: '#718096', textAlign: 'center', padding: '3rem 0' }}>
                        <p style={{ marginBottom: '0.5rem' }}>No upcoming fixtures for {selectedLeague.name}.</p>
                        <p style={{ fontSize: '0.8rem', marginBottom: '1rem' }}>Sync to fetch the latest schedule.</p>
                        <button onClick={handleSync} disabled={syncing} style={sideBtn('#2b6cb0')}>
                          {syncing ? 'Syncing…' : 'Sync Now'}
                        </button>
                      </div>
                    )}

                    {!fixturesLoading && sortedDays.map(day => (
                      <div key={day} style={{ marginBottom: '1.5rem' }}>
                        <div style={{ fontSize: '0.68rem', fontWeight: 700, color: day === '🔴 Live Now' ? '#fc8181' : '#718096', textTransform: day === '🔴 Live Now' ? 'none' : 'uppercase', letterSpacing: '0.6px', marginBottom: '0.5rem', paddingBottom: '4px', borderBottom: `1px solid ${day === '🔴 Live Now' ? '#742a2a' : '#2d3748'}` }}>
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
                      <div style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 12, padding: 14, marginBottom: 14 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 8, flexWrap: 'wrap' }}>
                          <div style={{ fontSize: '0.68rem', color: '#718096', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 700 }}>
                            Pick Fixtures ({selectedFixtures.size}/{fixtures.length} selected)
                          </div>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button onClick={selectAllFixtures} style={{ padding: '4px 10px', borderRadius: 6, fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer', background: '#1a2030', color: '#90cdf4', border: '1px solid #2b6cb0' }}>
                              {selectedFixtures.size === fixtures.length ? 'Deselect All' : 'Select All'}
                            </button>
                            {selectedFixtures.size > 0 && (
                              <button
                                onClick={buildForSelectedFixtures}
                                disabled={picksLoading}
                                style={{ padding: '4px 14px', borderRadius: 6, fontSize: '0.72rem', fontWeight: 800, cursor: picksLoading ? 'not-allowed' : 'pointer', background: picksLoading ? '#1a3a2a' : 'linear-gradient(135deg,#744210,#c05621)', color: picksLoading ? '#68d391' : '#fff', border: '1px solid #c05621', whiteSpace: 'nowrap' }}>
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
                              <label key={f._id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', borderRadius: 6, cursor: 'pointer', background: isSel ? '#0f1a2a' : 'transparent', border: `1px solid ${isSel ? '#2b6cb0' : '#1f2937'}` }}>
                                <input type="checkbox" checked={isSel} onChange={() => toggleFixture(f._id)} style={{ cursor: 'pointer', flexShrink: 0 }} />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                    {f.homeTeamName} <span style={{ color: '#4a5568', fontWeight: 400 }}>vs</span> {f.awayTeamName}
                                    {isLive && <span style={{ fontSize: '0.6rem', color: '#fc8181', fontWeight: 800 }}>● LIVE</span>}
                                  </div>
                                  <div style={{ fontSize: '0.65rem', color: '#4a5568', marginTop: 1 }}>{fmt(f.date)}</div>
                                </div>
                                <span style={{ fontSize: '0.65rem', color: hasPred ? '#68d391' : '#4a5568', flexShrink: 0 }}>
                                  {hasPred ? '✓ predicted' : 'no prediction'}
                                </span>
                              </label>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    {/* Controls */}
                    <div style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 12, padding: 16, marginBottom: 16 }}>
                      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>

                        {/* Date window */}
                        <div>
                          <div style={{ fontSize: '0.6rem', color: '#718096', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Date Window</div>
                          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                            {Object.entries(DURATION_LABELS).map(([k, l]) => (
                              <button key={k} onClick={() => setDuration(k)} style={{ padding: '5px 10px', borderRadius: 6, fontSize: '0.75rem', cursor: 'pointer', background: duration === k ? '#1a2a4a' : '#1a2030', color: duration === k ? '#90cdf4' : '#718096', border: `1px solid ${duration === k ? '#2b6cb0' : '#2d3748'}`, fontWeight: duration === k ? 700 : 400 }}>
                                {l}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Risk */}
                        <div style={{ flex: 1, minWidth: 200 }}>
                          <div style={{ fontSize: '0.6rem', color: '#718096', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Risk Level</div>
                          <div style={{ display: 'flex', gap: 6 }}>
                            {RISK_OPTIONS.map(r => {
                              const active = risks.includes(r.key)
                              return (
                                <button key={r.key} onClick={() => toggleRisk(r.key)} style={{ flex: 1, padding: '8px 10px', borderRadius: 8, cursor: 'pointer', background: active ? r.bg : '#1a2030', border: `2px solid ${active ? r.color : r.border}`, textAlign: 'left' }}>
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
                          <button onClick={generatePicks} disabled={picksLoading} style={{ padding: '10px 20px', borderRadius: 10, fontSize: 14, fontWeight: 800, cursor: picksLoading ? 'not-allowed' : 'pointer', background: picksLoading ? '#1a3a2a' : 'linear-gradient(135deg,#276749,#2f855a)', color: picksLoading ? '#48bb78' : '#f0fff4', border: '1px solid #48bb78', whiteSpace: 'nowrap' }}>
                            {picksLoading ? 'Loading picks…' : `Auto-Pick Best Bets`}
                          </button>
                        </div>
                      </div>

                      {loadMsg && (
                        <div style={{ fontSize: '0.72rem', color: '#718096', marginTop: 10, textAlign: 'center' }}>{loadMsg}</div>
                      )}
                    </div>

                    {/* Error */}
                    {picksError && (
                      <div style={{ background: '#2a0f0f', border: '1px solid #742a2a', borderRadius: 8, padding: '10px 14px', marginBottom: 12, color: '#fc8181', fontSize: '0.82rem' }}>
                        {picksError}
                      </div>
                    )}

                    {/* Results */}
                    {picks.length > 0 && (
                      <div>
                        {/* Summary + sort + actions */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 10, background: '#111827', border: '1px solid #1f2937', borderRadius: 8, padding: '10px 14px' }}>
                          <div style={{ fontSize: '0.72rem', color: '#718096', lineHeight: 1.7 }}>
                            <span style={{ color: '#e2e8f0', fontWeight: 700 }}>{picks.length}</span> picks ·{' '}
                            <span>{picksMeta?.fixturesScanned ?? '?'} fixtures scanned</span>
                            {picksMeta?.debug?.noPred > 0 && (
                              <span style={{ color: '#fc8181' }}> · {picksMeta.debug.noPred} no prediction yet</span>
                            )}
                            {picksMeta?.debug?.failedGate > 0 && (
                              <span style={{ color: '#ecc94b' }}> · {picksMeta.debug.failedGate} below probability threshold</span>
                            )}
                            {picksMeta?.failedEnrichment > 0 && (
                              <span style={{ color: '#718096' }}> · {picksMeta.failedEnrichment} blocked by data</span>
                            )}
                            {selected.size > 0 && <span> · <span style={{ color: '#90cdf4', fontWeight: 700 }}>{selected.size} selected</span></span>}
                          </div>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                            {picksMeta?.debug?.noPred > 0 && (
                              <button onClick={runPredictions} disabled={runningPreds || picksLoading} title="Run the prediction engine on all fixtures in this tournament that have no prediction yet, then reload picks" style={{ padding: '5px 12px', borderRadius: 6, fontSize: '0.75rem', fontWeight: 700, cursor: (runningPreds || picksLoading) ? 'not-allowed' : 'pointer', background: '#2a1a3a', color: '#d6bcfa', border: '1px solid #553c9a' }}>
                                {runningPreds ? '⚙️ Running…' : `⚙️ Run ${picksMeta.debug.noPred} Predictions`}
                              </button>
                            )}
                            <button onClick={() => { setShowAll(v => !v) }} title={showAll ? 'Showing all matches — risk gate off' : 'Only showing matches that pass the risk gate'} style={{ padding: '5px 10px', borderRadius: 6, fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer', background: showAll ? '#2a1a3a' : '#1a2030', color: showAll ? '#b794f4' : '#718096', border: `1px solid ${showAll ? '#805ad5' : '#2d3748'}` }}>
                              {showAll ? '🔓 All matches' : '🎯 Filtered'}
                            </button>
                            {selected.size > 0 && (
                              <button onClick={analyseSelected} disabled={analysing} style={{ padding: '5px 12px', borderRadius: 6, fontSize: '0.75rem', fontWeight: 700, cursor: analysing ? 'not-allowed' : 'pointer', background: '#1a2a4a', color: analysing ? '#718096' : '#90cdf4', border: '1px solid #2b6cb0' }}>
                                {analysing ? 'Running Claude…' : `Analyse ${selected.size} Selected`}
                              </button>
                            )}
                            <span style={{ fontSize: '0.68rem', color: '#4a5568' }}>Sort:</span>
                            {[['score','Score'],['prob','Model %'],['odds','Odds'],['time','Time']].map(([k, l]) => (
                              <button key={k} onClick={() => setSortBy(k)} style={{ padding: '4px 8px', borderRadius: 5, fontSize: '0.68rem', fontWeight: 700, cursor: 'pointer', background: sortBy === k ? '#1a2a4a' : '#1a2030', color: sortBy === k ? '#90cdf4' : '#718096', border: `1px solid ${sortBy === k ? '#2b6cb0' : '#2d3748'}` }}>{l}</button>
                            ))}
                          </div>
                        </div>

                        {/* Pick cards */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {sortedPicks.map((pick, i) => {
                            const isSel = selected.has(pick.fixtureId)
                            const hasAI = pick.hasClaudeAnalysis
                            const aiExp = expandedAI.has(pick.fixtureId)
                            const tierColor = TIER_COLORS[pick.tier] ?? '#4a5568'
                            const valColor = pick.value === 'Good value' ? '#68d391' : pick.value === 'Poor value' ? '#fc8181' : '#ecc94b'

                            return (
                              <div key={pick.fixtureId ?? i}
                                onClick={() => pick.fixtureId && toggleSelect(pick.fixtureId)}
                                style={{ background: isSel ? '#0f1a2a' : hasAI ? '#0b140b' : '#111827', border: `1px solid ${isSel ? '#2b6cb0' : '#1f2937'}`, borderRadius: 10, overflow: 'hidden', cursor: 'pointer' }}>

                                {/* Main row */}
                                <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                                  <input type="checkbox" checked={isSel} onChange={() => toggleSelect(pick.fixtureId)} onClick={e => e.stopPropagation()} disabled={!pick.fixtureId} style={{ cursor: 'pointer', flexShrink: 0 }} />

                                  <div style={{ flex: '2', minWidth: 150 }}>
                                    <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                      {pick.match}
                                      <span style={{ fontSize: '0.6rem', fontWeight: 800, padding: '2px 5px', borderRadius: 3, color: tierColor, border: `1px solid ${tierColor}44`, background: `${tierColor}11` }}>
                                        {TIER_LABELS[pick.tier] ?? pick.tier}
                                      </span>
                                      {pick.dataVerified === 'confirmed' && <span style={{ fontSize: '0.6rem', color: '#68d391' }}>✓ DATA</span>}
                                      {pick.dataVerified === 'risky'     && <span style={{ fontSize: '0.6rem', color: '#fc8181' }}>⚠ CHECK</span>}
                                    </div>
                                    <div style={{ fontSize: '0.68rem', color: '#4a5568', marginTop: 2 }}>{fmt(pick.fixtureDate)}</div>
                                  </div>

                                  <div style={{ fontSize: '0.75rem', color: '#90cdf4', fontWeight: 600, minWidth: 90 }}>{pick.market}</div>
                                  <div style={{ fontSize: '0.82rem', color: '#bee3f8', fontWeight: 700, minWidth: 100 }}>{pick.selection}</div>

                                  <div style={{ fontSize: '0.9rem', fontWeight: 800, color: pick.odds < 1.35 ? '#fc8181' : '#ecc94b', minWidth: 48 }}>
                                    {pick.odds}x
                                  </div>

                                  <div style={{ fontSize: '0.75rem', color: '#68d391', fontWeight: 700, minWidth: 44 }}>{pick.modelProb}</div>

                                  {pick.value && (
                                    <span style={{ fontSize: '0.68rem', fontWeight: 700, padding: '2px 6px', borderRadius: 5, color: valColor, border: `1px solid ${valColor}44`, background: `${valColor}11` }}>
                                      {pick.value === 'Good value' ? '↑ Good' : pick.value === 'Poor value' ? '↓ Poor' : '= Fair'}
                                    </span>
                                  )}

                                  {/* AI toggle */}
                                  {hasAI && (
                                    <button onClick={e => { e.stopPropagation(); setExpandedAI(prev => { const s = new Set(prev); s.has(pick.fixtureId) ? s.delete(pick.fixtureId) : s.add(pick.fixtureId); return s }) }}
                                      style={{ padding: '3px 8px', borderRadius: 5, fontSize: '0.68rem', fontWeight: 700, cursor: 'pointer', background: aiExp ? '#1a3a1a' : '#0b1f0b', color: '#68d391', border: '1px solid #276749' }}>
                                      {aiExp ? '▲ AI' : '▼ AI'}
                                    </button>
                                  )}
                                </div>

                                {/* Reason row */}
                                {pick.reason && (
                                  <div style={{ padding: '6px 14px 8px 44px', borderTop: '1px solid #1a2030', fontSize: '0.72rem', color: '#9ae6b4', lineHeight: 1.4 }}>
                                    {pick.reason}
                                  </div>
                                )}

                                {/* AI expanded */}
                                {hasAI && aiExp && (
                                  <div style={{ borderTop: '1px solid #1a3a1a', background: '#080f08', padding: '10px 14px 12px 44px' }}>
                                    <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                                      {pick.verdict && (
                                        <div>
                                          <div style={{ fontSize: '0.6rem', color: '#4a5568', textTransform: 'uppercase', marginBottom: 3 }}>Verdict</div>
                                          <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#90cdf4' }}>{pick.verdict}</div>
                                          {pick.claudeConf && <div style={{ fontSize: '0.65rem', color: pick.claudeConf === 'High' ? '#68d391' : pick.claudeConf === 'Medium' ? '#ecc94b' : '#fc8181' }}>{pick.claudeConf}</div>}
                                          {pick.predictedScore && <div style={{ fontSize: '0.65rem', color: '#718096', marginTop: 2 }}>Score: {pick.predictedScore}</div>}
                                        </div>
                                      )}
                                      {pick.bestBet && (
                                        <div>
                                          <div style={{ fontSize: '0.6rem', color: '#68d391', textTransform: 'uppercase', marginBottom: 3 }}>Best Bet</div>
                                          <div style={{ fontSize: '0.72rem', color: '#9ae6b4' }}>{pick.bestBet}</div>
                                        </div>
                                      )}
                                      {pick.keyFactors?.length > 0 && (
                                        <div style={{ flex: 1, minWidth: 180 }}>
                                          <div style={{ fontSize: '0.6rem', color: '#718096', textTransform: 'uppercase', marginBottom: 3 }}>Key Factors</div>
                                          {pick.keyFactors.map((f, fi) => <div key={fi} style={{ fontSize: '0.68rem', color: '#a0aec0' }}>· {f}</div>)}
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
                      <div style={{ color: '#718096', textAlign: 'center', padding: '3rem 0' }}>
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
      </main>
    </>
  )
}
