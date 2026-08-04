import { useEffect, useState, useRef, useCallback } from 'react'
import { Link } from 'react-router-dom'
import api from '../api'
import PredictionCard from '../components/PredictionCard'
import BacktestView from '../components/BacktestView'

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

const LIVE_STATUS_LABEL = {
  '1H': '1st Half', 'HT': 'Half Time', '2H': '2nd Half',
  'ET': 'Extra Time', 'P': 'Penalties', 'BT': 'Break'
}

function liveTimeLabel(liveStatus, elapsed) {
  if (!liveStatus) return 'Live'
  if (liveStatus === 'HT') return 'Half Time'
  if (liveStatus === 'BT') return 'Break'
  if (elapsed == null) return LIVE_STATUS_LABEL[liveStatus] ?? 'Live'
  const realMin = ['2H', 'ET', 'P'].includes(liveStatus) ? elapsed + 15 : elapsed
  return `${LIVE_STATUS_LABEL[liveStatus]} ${elapsed}' (${realMin}')`
}

export default function Dashboard() {
  const [view, setView] = useState(() => sessionStorage.getItem('ss_view') || 'upcoming')
  const [selectedDate, setSelectedDate] = useState(() => sessionStorage.getItem('ss_date') || todayStr())

  // Upcoming
  const [upcomingFixtures, setUpcomingFixtures] = useState([])
  const [upcomingLoading, setUpcomingLoading] = useState(true)
  const [predictions, setPredictions] = useState({})
  const [computing, setComputing] = useState({})

  // Live
  const [liveFixtures, setLiveFixtures] = useState([])
  const [liveLoading, setLiveLoading] = useState(false)
  const [livePredictions, setLivePredictions] = useState({})
  const [liveComputing, setLiveComputing] = useState({})
  const [liveRefreshing, setLiveRefreshing] = useState(false)
  const liveIntervalRef = useRef(null)

  // Search / Sync
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [quickSyncing, setQuickSyncing] = useState(false)
  const [syncReport, setSyncReport] = useState(null)
  const [error, setError] = useState(null)
  const debounceRef = useRef(null)

  // ── Upcoming ──────────────────────────────────────────────────────────────

  useEffect(() => {
    loadUpcoming()
  }, [selectedDate])

  async function loadUpcoming() {
    setUpcomingLoading(true)
    try {
      // Auto-sync the date from API if not done recently (cache per date, 20 min TTL)
      const cacheKey = `ss_synced_${selectedDate}`
      const lastSynced = parseInt(sessionStorage.getItem(cacheKey) || '0')
      if (Date.now() - lastSynced > 20 * 60 * 1000) {
        try {
          await api.post('/api/sync/date', { date: selectedDate })
          sessionStorage.setItem(cacheKey, String(Date.now()))
        } catch (e) {
          console.warn('[upcoming] date sync failed:', e.message)
        }
      }

      const from = new Date(selectedDate); from.setUTCHours(0, 0, 0, 0)
      const to   = new Date(selectedDate); to.setUTCHours(23, 59, 59, 999)
      const { data } = await api.get('/api/fixtures', {
        params: { from: from.toISOString(), to: to.toISOString(), limit: 1500 }
      })
      const fixtures = data.fixtures || []
      setUpcomingFixtures(fixtures)
      if (data.total > fixtures.length) {
        console.warn(`[upcoming] showing ${fixtures.length} of ${data.total} fixtures — raise the limit`)
      }

      // One request for every prediction, not one per fixture. The old version fired a
      // separate GET per fixture inside Promise.all — 500 requests on a normal day and 1500
      // on a weekend, all queued behind the browser's per-host connection cap.
      if (fixtures.length) {
        try {
          const { data: predMap } = await api.post('/api/predictions/bulk', {
            fixtureIds: fixtures.map(f => f._id),
          })
          setPredictions(p => ({ ...p, ...predMap }))
        } catch { /* none yet */ }
      }
    } catch {
      // silently fail
    } finally {
      setUpcomingLoading(false)
    }
  }

  // ── Live ──────────────────────────────────────────────────────────────────

  const loadLive = useCallback(async (showLoader = true) => {
    if (showLoader) setLiveLoading(true)
    else setLiveRefreshing(true)
    try {
      // Sync live from API-Football first, then fetch from DB
      await api.post('/api/sync/live')
      const { data } = await api.get('/api/fixtures/live')
      const fixtures = data.fixtures || []
      setLiveFixtures(fixtures)

      const predMap = {}
      await Promise.all(fixtures.map(async (f) => {
        try {
          const { data: pred } = await api.get(`/api/predictions/${f._id}`)
          predMap[f._id] = pred
        } catch { /* none yet */ }
      }))
      setLivePredictions(p => ({ ...p, ...predMap }))
    } catch {
      // silently fail
    } finally {
      setLiveLoading(false)
      setLiveRefreshing(false)
    }
  }, [])

  // Start/stop auto-refresh when live view is active
  useEffect(() => {
    if (view === 'live') {
      loadLive(true)
      liveIntervalRef.current = setInterval(() => loadLive(false), 60000)
    } else {
      clearInterval(liveIntervalRef.current)
    }
    return () => clearInterval(liveIntervalRef.current)
  }, [view, loadLive])

  async function handleLivePredict(fixtureId) {
    setLiveComputing(c => ({ ...c, [fixtureId]: true }))
    try {
      const { data: pred } = await api.post(`/api/predictions/fixture/${fixtureId}`)
      setLivePredictions(p => ({ ...p, [fixtureId]: pred }))
    } catch (e) {
      alert('Prediction failed: ' + (e.response?.data?.error || e.message))
    } finally {
      setLiveComputing(c => ({ ...c, [fixtureId]: false }))
    }
  }

  // ── Search ────────────────────────────────────────────────────────────────

  useEffect(() => {
    clearTimeout(debounceRef.current)
    if (query.trim().length < 2) { setSearchResults([]); return }
    debounceRef.current = setTimeout(() => search(query.trim()), 400)
    return () => clearTimeout(debounceRef.current)
  }, [query])

  async function search(q) {
    setSearching(true)
    setError(null)
    try {
      const { data } = await api.get('/api/fixtures/search', { params: { q } })
      setSearchResults(data.fixtures)
      const predMap = { ...predictions }
      await Promise.all(data.fixtures.map(async (f) => {
        if (predMap[f._id]) return
        try {
          const { data: pred } = await api.get(`/api/predictions/${f._id}`)
          predMap[f._id] = pred
        } catch { /* none yet */ }
      }))
      setPredictions(predMap)
    } catch {
      setError('Search failed.')
    } finally {
      setSearching(false)
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

  async function handleQuickSync() {
    setQuickSyncing(true)
    setSyncReport(null)
    try {
      sessionStorage.removeItem(`ss_synced_${selectedDate}`)
      const { data } = await api.post('/api/sync/date', { date: selectedDate })
      setSyncReport({ upcoming: [{ league: 'All leagues', synced: data.synced }], tier: 'all' })
      await loadUpcoming()
    } catch (e) {
      alert('Quick sync failed: ' + e.message)
    } finally {
      setQuickSyncing(false)
    }
  }

  async function handleSync() {
    setSyncing(true)
    setSyncReport(null)
    try {
      const { data } = await api.post('/api/sync/all')
      setSyncReport(data.report)
      await loadUpcoming()
      if (query.trim().length >= 2) await search(query.trim())
    } catch (e) {
      alert('Sync failed: ' + e.message)
    } finally {
      setSyncing(false)
    }
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  const fixturesByLeague = upcomingFixtures.reduce((acc, f) => {
    if (!acc[f.league]) acc[f.league] = []
    acc[f.league].push(f)
    return acc
  }, {})

  const liveByLeague = liveFixtures.reduce((acc, f) => {
    if (!acc[f.league]) acc[f.league] = []
    acc[f.league].push(f)
    return acc
  }, {})

  const isSearching = query.trim().length >= 2

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <header>
        <div className="container" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <h1>SoccerStar</h1>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <button onClick={() => { setView('upcoming'); sessionStorage.setItem('ss_view', 'upcoming') }} style={tabBtnStyle(view === 'upcoming')}>Upcoming</button>
            <button onClick={() => { setView('live'); sessionStorage.setItem('ss_view', 'live') }} style={{
              ...tabBtnStyle(view === 'live'),
              ...(view === 'live' ? { background: '#742a2a', borderColor: '#fc8181', color: '#fc8181' } : {})
            }}>
              {view === 'live' && liveRefreshing ? '● Live…' : '● Live'}
            </button>
            <button onClick={() => { setView('backtest'); sessionStorage.setItem('ss_view', 'backtest') }} style={tabBtnStyle(view === 'backtest')}>Test Model</button>
            <Link to="/tournaments" style={{ ...btnStyle('#553c9a'), marginLeft: '6px', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>🏆 Tournaments</Link>
            <Link to="/betslip" style={{ ...btnStyle('#276749'), marginLeft: '4px', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>⚡ Bet Slip</Link>
            <Link to="/bet-builder" style={{ ...btnStyle('#744210'), marginLeft: '4px', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>🎯 Bet Builder</Link>
            <button onClick={handleQuickSync} disabled={quickSyncing || syncing} style={{ ...btnStyle('#276749'), marginLeft: '6px' }}>
              {quickSyncing ? 'Syncing...' : 'Sync Fixtures'}
            </button>
            <button onClick={handleSync} disabled={syncing || quickSyncing} style={{ ...btnStyle('#2b6cb0') }}>
              {syncing ? 'Syncing...' : 'Sync + xG'}
            </button>
          </div>
        </div>
      </header>

      <main className="container">

        {/* ── Backtest ── */}
        {view === 'backtest' && <BacktestView />}

        {/* ── Live ── */}
        {view === 'live' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '8px' }}>
              <div>
                <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#fc8181' }}>
                  ● Live Now
                </div>
                <div style={{ fontSize: '0.72rem', color: '#718096', marginTop: 2 }}>
                  {liveLoading ? 'Fetching live matches…' : `${liveFixtures.length} match${liveFixtures.length !== 1 ? 'es' : ''} in play · auto-refreshes every 60s`}
                </div>
              </div>
              <button onClick={() => loadLive(true)} disabled={liveLoading} style={btnStyle('#742a2a')}>
                {liveLoading ? '…' : 'Refresh'}
              </button>
            </div>

            {liveLoading && (
              <div style={{ color: '#718096', textAlign: 'center', padding: '3rem 0', fontSize: '0.85rem' }}>
                Fetching live matches…
              </div>
            )}

            {!liveLoading && liveFixtures.length === 0 && (
              <div style={{ color: '#718096', textAlign: 'center', padding: '3rem 0' }}>
                <p style={{ marginBottom: '0.5rem' }}>No live matches right now.</p>
                <p style={{ fontSize: '0.8rem' }}>Come back when matches are in play.</p>
              </div>
            )}

            {!liveLoading && Object.entries(liveByLeague).map(([league, fixtures]) => (
              <div key={league} style={{ marginBottom: '1.5rem' }}>
                <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#718096', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '0.5rem', paddingBottom: '4px', borderBottom: '1px solid #2d3748' }}>
                  {league}
                </div>
                {fixtures.map(f => (
                  <div key={f._id}>
                    {/* Live score banner */}
                    <div style={{
                      background: '#2d2020', border: '1px solid #742a2a', borderRadius: '8px 8px 0 0',
                      padding: '6px 14px', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap'
                    }}>
                      <span style={{ fontSize: '0.65rem', fontWeight: 700, color: '#fc8181', background: '#742a2a', borderRadius: '4px', padding: '1px 6px' }}>
                        {liveTimeLabel(f.liveStatus, f.elapsed)}
                      </span>
                      <span style={{ fontSize: '0.88rem', fontWeight: 700, color: '#e2e8f0' }}>
                        {f.homeTeamName} <span style={{ color: '#fc8181' }}>{f.goalsHome ?? 0} – {f.goalsAway ?? 0}</span> {f.awayTeamName}
                      </span>
                    </div>
                    <div style={{ borderRadius: '0 0 12px 12px', overflow: 'hidden', marginBottom: '0.75rem' }}>
                      <PredictionCard
                        fixture={f}
                        prediction={livePredictions[f._id] || null}
                        onPredict={() => handleLivePredict(f._id)}
                        computing={!!liveComputing[f._id]}
                        isLive
                      />
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* ── Upcoming ── */}
        {view === 'upcoming' && (
          <div>
            <div style={{ position: 'relative', marginBottom: '1.5rem' }}>
              <input
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search for a team or match (e.g. Arsenal, Man City vs Liverpool...)"
                style={inputStyle}
              />
              {searching && (
                <span style={{ position: 'absolute', right: '14px', top: '50%', transform: 'translateY(-50%)', color: '#718096', fontSize: '0.8rem' }}>
                  Searching...
                </span>
              )}
            </div>

            {error && <p style={{ color: '#fc8181', marginBottom: '1rem' }}>{error}</p>}

            {syncReport && (
              <div style={{ background: '#1a1f2e', border: '1px solid #2d3748', borderRadius: '10px', padding: '1rem', marginBottom: '1.5rem' }}>
                <div style={{ fontSize: '0.7rem', color: '#68d391', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>
                  Sync complete — {syncReport.leaguesTargeted} leagues · Tier {syncReport.tier}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                  {(syncReport.upcoming || []).map(r => {
                    const xg   = syncReport.xg?.find(x => x.league === r.league)
                    const fdco = syncReport.fdco?.find(x => x.league === r.league)
                    const hasErr = r.error || xg?.error
                    return (
                      <div key={r.league} style={{ background: hasErr ? '#2d2020' : '#2d3748', borderRadius: '6px', padding: '5px 9px', fontSize: '0.7rem' }}>
                        <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{r.league}</span>
                        <span style={{ color: '#718096', marginLeft: 5 }}>
                          {r.synced ?? '?'} upcoming
                          {fdco?.synced != null && ` · ${fdco.synced} hist`}
                          {xg?.updated != null && ` · ${xg.updated} xG`}
                          {hasErr && ' ⚠'}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {isSearching && (
              <div>
                {searchResults.length === 0 && !searching && (
                  <p style={{ color: '#718096' }}>No fixtures found for "{query}". Try syncing data first.</p>
                )}
                {searchResults.map(f => (
                  <PredictionCard
                    key={f._id}
                    fixture={f}
                    prediction={predictions[f._id] || null}
                    onPredict={() => handlePredict(f._id)}
                    computing={!!computing[f._id]}
                  />
                ))}
              </div>
            )}

            {!isSearching && (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '8px' }}>
                  <div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#e2e8f0' }}>
                      {selectedDate === todayStr() ? 'Today' : new Date(selectedDate).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: '#718096', marginTop: 2 }}>
                      {upcomingLoading ? 'Loading...' : `${upcomingFixtures.length} fixture${upcomingFixtures.length !== 1 ? 's' : ''}`}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <input
                      type="date"
                      value={selectedDate}
                      onChange={e => { setSelectedDate(e.target.value); sessionStorage.setItem('ss_date', e.target.value) }}
                      style={{ background: '#1a1f2e', border: '1px solid #2d3748', borderRadius: '8px', color: '#e2e8f0', padding: '5px 10px', fontSize: '0.8rem', outline: 'none', cursor: 'pointer' }}
                    />
                    <button onClick={loadUpcoming} disabled={upcomingLoading} style={btnStyle('#2d3748')}>
                      {upcomingLoading ? '...' : 'Refresh'}
                    </button>
                  </div>
                </div>

                {upcomingLoading && (
                  <div style={{ color: '#718096', textAlign: 'center', padding: '3rem 0', fontSize: '0.85rem' }}>
                    Loading fixtures...
                  </div>
                )}

                {!upcomingLoading && upcomingFixtures.length === 0 && (
                  <div style={{ color: '#718096', textAlign: 'center', padding: '3rem 0' }}>
                    <p style={{ marginBottom: '0.5rem' }}>No fixtures found for this date.</p>
                    <p style={{ fontSize: '0.8rem' }}>Try syncing data to fetch the latest schedule.</p>
                  </div>
                )}

                {!upcomingLoading && Object.entries(fixturesByLeague).map(([league, fixtures]) => (
                  <div key={league} style={{ marginBottom: '1.5rem' }}>
                    <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#718096', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '0.5rem', paddingBottom: '4px', borderBottom: '1px solid #2d3748' }}>
                      {league}
                    </div>
                    {fixtures.map(f => (
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
          </div>
        )}

      </main>
    </>
  )
}

const inputStyle = {
  width: '100%', background: '#1a1f2e', border: '1px solid #2d3748',
  borderRadius: '10px', color: '#e2e8f0', fontSize: '0.95rem',
  padding: '12px 16px', outline: 'none'
}

function btnStyle(bg) {
  return {
    background: bg, color: '#fff', border: 'none',
    borderRadius: '8px', padding: '6px 14px',
    cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600
  }
}

function tabBtnStyle(active) {
  return {
    background: active ? '#2d3748' : 'transparent',
    color: active ? '#e2e8f0' : '#718096',
    border: '1px solid ' + (active ? '#4a5568' : '#2d3748'),
    borderRadius: '8px', padding: '5px 14px',
    cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600
  }
}
