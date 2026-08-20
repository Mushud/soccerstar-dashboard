import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import api from '../api'
import { Link } from 'react-router-dom'
import AppShell from '../components/AppShell'
import PredictionCard from '../components/PredictionCard'
import BacktestView from '../components/BacktestView'

const SLIP_SOURCE = { 'smart-pick': 'Smart Pick', manual: 'Manual', imported: 'Imported' }

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

/** Top 1X2 probability across whichever model output is active. Drives the tier chips. */
function topProb(pred) {
  const b = (pred?.blended?.result1X2 ? pred.blended : null) || pred?.modeB || pred?.modeA
  if (!b?.result1X2) return null
  const { home = 0, draw = 0, away = 0 } = b.result1X2
  return Math.max(home, draw, away)
}

export default function Dashboard() {
  // The view lives in the URL so the sidebar can deep-link straight to Live or Backtest,
  // and so a reload or a shared link lands on the same screen.
  const [params, setParams] = useSearchParams()
  const view = params.get('view') || 'upcoming'
  const setView = v => setParams(v === 'upcoming' ? {} : { view: v }, { replace: true })

  const [selectedDate, setSelectedDate] = useState(() => sessionStorage.getItem('ss_date') || todayStr())
  // Density sticks, because it is a reading preference rather than a per-visit choice.
  const [dense, setDense] = useState(() => sessionStorage.getItem('ss_dense') !== '0')

  // Booking codes still in play. Read-only here — settling is the Booked Slips page's job, so
  // this passes settle=false and stays cheap enough to run on every dashboard load.
  const [liveSlips, setLiveSlips] = useState([])

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

  useEffect(() => {
    let cancelled = false
    api.get('/api/betbuilder/slips', { params: { limit: 40, settle: 'false' } })
      .then(({ data }) => {
        if (cancelled) return
        // Still running, plus anything that resolved in the last three days. A slip that just
        // landed is the most interesting thing on the page, and it disappearing the moment its
        // last leg finished was the wrong behaviour.
        const cutoff = Date.now() - 3 * 86400000
        const rows = (data.slips || []).filter(sl =>
          sl.status === 'pending' ||
          ((sl.status === 'won' || sl.status === 'lost') &&
            new Date(sl.settledAt || sl.updatedAt || 0).getTime() > cutoff))
        // Running first, then most recently settled.
        rows.sort((a, b) => {
          if ((a.status === 'pending') !== (b.status === 'pending')) return a.status === 'pending' ? -1 : 1
          return new Date(b.settledAt || b.createdAt) - new Date(a.settledAt || a.createdAt)
        })
        setLiveSlips(rows.slice(0, 10))
      })
      .catch(() => { /* the strip is supplementary — a failure here must not affect the slate */ })
    return () => { cancelled = true }
  }, [])

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

  const fixturesByLeague = useMemo(() => upcomingFixtures.reduce((acc, f) => {
    (acc[f.league] ||= []).push(f)
    return acc
  }, {}), [upcomingFixtures])

  const liveByLeague = liveFixtures.reduce((acc, f) => {
    (acc[f.league] ||= []).push(f)
    return acc
  }, {})

  const isSearching = query.trim().length >= 2

  /** Headline numbers for the tile strip — cheap derivations, no extra requests. */
  const stats = useMemo(() => {
    const predicted = upcomingFixtures.filter(f => predictions[f._id]).length
    const probs = upcomingFixtures.map(f => topProb(predictions[f._id])).filter(p => p != null)
    const strong = probs.filter(p => p >= 0.56).length
    const best = probs.length ? Math.max(...probs) : null
    return {
      fixtures: upcomingFixtures.length,
      leagues: Object.keys(fixturesByLeague).length,
      predicted,
      strong,
      best,
    }
  }, [upcomingFixtures, predictions, fixturesByLeague])

  const prettyDate = selectedDate === todayStr()
    ? 'Today'
    : new Date(selectedDate).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })

  const TITLE = { upcoming: 'Matches', live: 'Live Now', backtest: 'Model & Backtest' }
  const SUBTITLE = {
    upcoming: `${prettyDate} · ${stats.fixtures} fixtures across ${stats.leagues} competitions`,
    live: `${liveFixtures.length} in play · refreshes every 60s`,
    backtest: 'Calibration, accuracy and blend weights',
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const actions = (
    <>
      <button className="btn btn-sm hide-sm" onClick={handleQuickSync} disabled={quickSyncing || syncing}>
        {quickSyncing ? <><span className="spin" /> Syncing</> : 'Sync fixtures'}
      </button>
      <button className="btn btn-sm btn-accent" onClick={handleSync} disabled={syncing || quickSyncing}>
        {syncing ? <><span className="spin" /> Syncing</> : <>Sync <span className="hide-sm">+ xG</span></>}
      </button>
    </>
  )

  return (
    <AppShell title={TITLE[view] ?? 'Matches'} subtitle={SUBTITLE[view]} actions={actions}>

      <div className="seg seg-accent" style={{ marginBottom: 18 }}>
        {[['upcoming', 'Upcoming'], ['live', liveRefreshing && view === 'live' ? '● Live…' : '● Live'], ['backtest', 'Test Model']].map(([k, l]) => (
          <button key={k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{l}</button>
        ))}
      </div>

      {/* ── Backtest ── */}
      {view === 'backtest' && <BacktestView />}

      {/* ── Live ── */}
      {view === 'live' && (
        <>
          <div className="section-head">
            <div>
              <div className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="dot dot-live" style={{ color: 'var(--neg)' }} /> Live Now
              </div>
              <div className="muted" style={{ fontSize: 12.5, marginTop: 3 }}>
                {liveLoading
                  ? 'Fetching live matches…'
                  : `${liveFixtures.length} match${liveFixtures.length !== 1 ? 'es' : ''} in play · auto-refreshes every 60s`}
              </div>
            </div>
            <button className="btn btn-sm" onClick={() => loadLive(true)} disabled={liveLoading}>
              {liveLoading ? <span className="spin" /> : 'Refresh'}
            </button>
          </div>

          {liveLoading && (
            <div style={{ display: 'grid', gap: 10 }}>
              {[0, 1, 2].map(i => <div key={i} className="skel" style={{ height: 128 }} />)}
            </div>
          )}

          {!liveLoading && liveFixtures.length === 0 && (
            <div className="card empty">
              <div className="empty-ico">📡</div>
              <div className="empty-title">No live matches right now</div>
              <div className="empty-sub">Come back when matches are in play.</div>
            </div>
          )}

          {!liveLoading && Object.entries(liveByLeague).map(([league, fixtures]) => (
            <section key={league} style={{ marginBottom: 22 }}>
              <div className="league-head">{league}<span className="count">{fixtures.length}</span></div>
              {fixtures.map(f => (
                <div key={f._id} style={{ marginBottom: 12 }}>
                  <div style={{
                    background: 'var(--neg-soft)', border: '1px solid var(--neg-dim)', borderBottom: 'none',
                    borderRadius: 'var(--r-lg) var(--r-lg) 0 0', padding: '8px 16px',
                    display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap'
                  }}>
                    <span className="pill pill-neg"><span className="dot dot-live" /> {liveTimeLabel(f.liveStatus, f.elapsed)}</span>
                    <span style={{ fontSize: 13.5, fontWeight: 650 }}>
                      {f.homeTeamName}
                      <span className="num" style={{ color: 'var(--neg)', margin: '0 8px', fontWeight: 800 }}>
                        {f.goalsHome ?? 0}–{f.goalsAway ?? 0}
                      </span>
                      {f.awayTeamName}
                    </span>
                  </div>
                  <PredictionCard
                    fixture={f}
                    prediction={livePredictions[f._id] || null}
                    onPredict={() => handleLivePredict(f._id)}
                    computing={!!liveComputing[f._id]}
                    flushTop
                    isLive
                  />
                </div>
              ))}
            </section>
          ))}
        </>
      )}

      {/* ── Upcoming ── */}
      {view === 'upcoming' && (
        <>
          {/* Stat strip */}
          <div className="stat-grid" style={{ marginBottom: 18 }}>
            <div className="stat">
              <div className="stat-label">Fixtures</div>
              <div className="stat-value">{stats.fixtures}</div>
              <div className="stat-foot">{prettyDate} · {stats.leagues} competitions</div>
            </div>
            <div className="stat">
              <div className="stat-label">Predicted</div>
              <div className="stat-value" style={{ color: 'var(--accent-2)' }}>
                {stats.predicted}<small>/{stats.fixtures || 0}</small>
              </div>
              <div className="stat-foot">Model has run on these</div>
            </div>
            <div className="stat">
              <div className="stat-label">Strong picks</div>
              <div className="stat-value" style={{ color: 'var(--pos)' }}>{stats.strong}</div>
              <div className="stat-foot">≥56% on the favourite</div>
            </div>
            <div className="stat">
              <div className="stat-label">Best edge</div>
              <div className="stat-value">{stats.best != null ? `${Math.round(stats.best * 100)}%` : '—'}</div>
              <div className="stat-foot">Highest single-outcome probability</div>
            </div>
          </div>


          {/* Booking codes still running. Put here because the dashboard is where you land, and
              "which of my slips are still alive" is the first thing worth knowing. */}
          {liveSlips.length > 0 && (
            <section style={{ marginBottom: 18 }}>
              <div className="section-head" style={{ marginBottom: 10 }}>
                <div>
                  <div className="section-title" style={{ fontSize: 14 }}>Your slips</div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {(() => {
                      const running = liveSlips.filter(sl => sl.status === 'pending').length
                      const settled = liveSlips.length - running
                      return [
                        running ? `${running} still running` : null,
                        settled ? `${settled} settled recently` : null,
                      ].filter(Boolean).join(' · ')
                    })()}
                  </div>
                </div>
                <Link to="/slips" className="btn btn-sm">All slips →</Link>
              </div>
              <div className="slip-strip">
                {liveSlips.map(sl => {
                  const done = sl.status === 'won' || sl.status === 'lost'
                  const kicks = sl.legs.map(l => l.kickoff).filter(Boolean).map(d => new Date(d)).sort((a, b) => a - b)
                  const next = kicks.find(k => k > new Date()) || kicks[0]
                  return (
                    <Link key={sl.code} to="/slips"
                      className={`slip-chip${sl.status === 'won' ? ' won' : sl.status === 'lost' ? ' lost' : ''}`}>
                      <div className="top">
                        <span className="code">{sl.code}</span>
                        {done
                          ? <span className={`pill pill-${sl.status === 'won' ? 'pos' : 'neg'}`}>
                              {sl.status === 'won' ? '✓ Won' : '✗ Lost'}
                            </span>
                          : sl.legsLost > 0
                            ? <span className="pill pill-neg">{sl.legsLost} down</span>
                            : sl.legsWon > 0
                              ? <span className="pill pill-pos">{sl.legsWon} up</span>
                              : <span className="pill">{SLIP_SOURCE[sl.source] || sl.source}</span>}
                        <span className="odds">{sl.totalOdds > 0 ? `${sl.totalOdds}x` : '—'}</span>
                      </div>
                      <div className="meta">
                        <span>{sl.legs.length} legs</span>
                        <span className="muted2">·</span>
                        <span style={{ color: 'var(--pos)' }}>{sl.legsWon}✓</span>
                        {sl.legsLost > 0 && <span style={{ color: 'var(--neg)' }}>{sl.legsLost}✗</span>}
                        {!done && <span className="muted2">{sl.legsPending} to play</span>}
                      </div>
                      <div className="meta" style={{ marginTop: 3 }}>
                        {done
                          ? <span className="muted2">
                              settled {new Date(sl.settledAt || sl.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                            </span>
                          : next && (
                            <span>⏱ {next.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                          )}
                      </div>
                    </Link>
                  )
                })}
              </div>
            </section>
          )}

          {/* Controls */}
          <div className="card card-pad" style={{ marginBottom: 18, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <div className="search-wrap" style={{ flex: '1 1 280px' }}>
              <span className="search-ico">🔍</span>
              <input
                className="field"
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search a team or match…"
              />
              {searching && (
                <span className="muted" style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 11.5 }}>
                  <span className="spin" />
                </span>
              )}
            </div>
            <input
              className="field"
              type="date"
              value={selectedDate}
              onChange={e => { setSelectedDate(e.target.value); sessionStorage.setItem('ss_date', e.target.value) }}
              style={{ width: 'auto', flex: '0 0 auto' }}
            />
            <div className="seg seg-accent">
              {[[true, 'Compact'], [false, 'Detailed']].map(([v, l]) => (
                <button key={l} className={dense === v ? 'on' : ''}
                  onClick={() => { setDense(v); sessionStorage.setItem('ss_dense', v ? '1' : '0') }}>{l}</button>
              ))}
            </div>
            <button className="btn" onClick={loadUpcoming} disabled={upcomingLoading}>
              {upcomingLoading ? <span className="spin" /> : '↻'} Refresh
            </button>
          </div>

          {error && (
            <div className="card card-pad" style={{ borderColor: 'var(--neg-dim)', background: 'var(--neg-soft)', color: 'var(--neg)', marginBottom: 16, fontSize: 13 }}>
              {error}
            </div>
          )}

          {syncReport && (
            <div className="card card-pad" style={{ marginBottom: 18 }}>
              <div className="eyebrow" style={{ color: 'var(--pos)', marginBottom: 10 }}>
                Sync complete — {syncReport.leaguesTargeted} leagues · Tier {syncReport.tier}
              </div>
              <div className="chip-row">
                {(syncReport.upcoming || []).map(r => {
                  const xg = syncReport.xg?.find(x => x.league === r.league)
                  const fdco = syncReport.fdco?.find(x => x.league === r.league)
                  const hasErr = r.error || xg?.error
                  return (
                    <span key={r.league} className={`pill${hasErr ? ' pill-neg' : ''}`} style={{ fontWeight: 500 }}>
                      <b style={{ color: hasErr ? 'inherit' : 'var(--tx)' }}>{r.league}</b>
                      <span className="muted2">
                        {r.synced ?? '?'} upcoming
                        {fdco?.synced != null && ` · ${fdco.synced} hist`}
                        {xg?.updated != null && ` · ${xg.updated} xG`}
                        {hasErr && ' ⚠'}
                      </span>
                    </span>
                  )
                })}
              </div>
            </div>
          )}

          {isSearching && (
            <>
              <div className="section-head">
                <div className="section-title">Results for “{query}”</div>
                <span className="muted" style={{ fontSize: 12.5 }}>{searchResults.length} match{searchResults.length !== 1 ? 'es' : ''}</span>
              </div>
              {searchResults.length === 0 && !searching && (
                <div className="card empty">
                  <div className="empty-ico">🔍</div>
                  <div className="empty-title">Nothing found for “{query}”</div>
                  <div className="empty-sub">Try syncing fixtures first, or check the team alias list.</div>
                </div>
              )}
              {searchResults.map(f => (
                <PredictionCard
                  key={f._id}
                  fixture={f}
                  prediction={predictions[f._id] || null}
                  onPredict={() => handlePredict(f._id)}
                  computing={!!computing[f._id]}
                  dense={dense}
                />
              ))}
            </>
          )}

          {!isSearching && (
            <>
              {upcomingLoading && (
                <div style={{ display: 'grid', gap: 10 }}>
                  {[0, 1, 2, 3].map(i => <div key={i} className="skel" style={{ height: 136 }} />)}
                </div>
              )}

              {!upcomingLoading && upcomingFixtures.length === 0 && (
                <div className="card empty">
                  <div className="empty-ico">📅</div>
                  <div className="empty-title">No fixtures for {prettyDate.toLowerCase()}</div>
                  <div className="empty-sub">Sync fixtures to pull the latest schedule for this date.</div>
                  <button className="btn btn-accent" style={{ marginTop: 16 }} onClick={handleQuickSync} disabled={quickSyncing}>
                    {quickSyncing ? <><span className="spin" /> Syncing…</> : 'Sync this date'}
                  </button>
                </div>
              )}

              {!upcomingLoading && Object.entries(fixturesByLeague).map(([league, fixtures]) => (
                <section key={league} style={{ marginBottom: 22 }}>
                  <div className="league-head">{league}<span className="count">{fixtures.length}</span></div>
                  {fixtures.map(f => (
                    <PredictionCard
                      key={f._id}
                      fixture={f}
                      prediction={predictions[f._id] || null}
                      onPredict={() => handlePredict(f._id)}
                      computing={!!computing[f._id]}
                      dense={dense}
                    />
                  ))}
                </section>
              ))}
            </>
          )}
        </>
      )}
    </AppShell>
  )
}
