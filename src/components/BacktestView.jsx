import { useState } from 'react'
import axios from 'axios'

function yesterday() {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

function pct(n) { return n != null ? (n * 100).toFixed(1) + '%' : '—' }
const CORRECT   = '#68d391'
const WRONG     = '#fc8181'
const NEUTRAL   = '#a0aec0'

export default function BacktestView() {
  const [date, setDate]         = useState(yesterday())
  const [loading, setLoading]   = useState(false)
  const [syncing, setSyncing]   = useState(false)
  const [fixtures, setFixtures] = useState(null)
  const [accuracy, setAccuracy] = useState(null)
  const [accRisk, setAccRisk]   = useState('')
  const [results, setResults]   = useState({})
  const [running, setRunning]   = useState({})
  const [error, setError]       = useState(null)
  const [optimising, setOptimising] = useState(false)
  const [optimResult, setOptimResult] = useState(null)
  const [savedWeights, setSavedWeights] = useState(null)

  async function loadSavedWeights() {
    try {
      const { data } = await axios.get('/api/backtest/weights')
      if (data?.value) setSavedWeights(data)
    } catch {}
  }

  async function optimiseWeights() {
    setOptimising(true)
    setOptimResult(null)
    try {
      const { data } = await axios.post('/api/backtest/optimise-weights', { minSamples: 20 })
      setOptimResult(data)
      await loadSavedWeights()
    } catch (e) {
      setOptimResult({ error: e.response?.data?.error || e.message })
    } finally {
      setOptimising(false)
    }
  }

  async function resetWeights() {
    if (!window.confirm('Reset blend weights to defaults (Poisson 35%, ELO 25%, Odds 40%)?')) return
    try {
      await axios.delete('/api/backtest/weights')
      setSavedWeights(null)
      setOptimResult({ message: 'Weights reset to defaults.' })
    } catch (e) {
      setOptimResult({ error: e.response?.data?.error || e.message })
    }
  }

  // Load saved weights on mount
  useState(() => { loadSavedWeights() })

  async function syncResults() {
    setSyncing(true)
    setError(null)
    try {
      await axios.post('/api/sync/all/backfill')
    } catch { /* non-fatal */ }
    finally { setSyncing(false) }
    await loadFixtures()
  }

  async function refreshAccuracy(risk) {
    const params = { days: 60 }
    if (risk) params.risk = risk
    const { data: acc } = await axios.get('/api/backtest/accuracy', { params })
    setAccuracy(acc)
  }

  async function loadFixtures() {
    setLoading(true)
    setError(null)
    setFixtures(null)
    setResults({})
    try {
      const accParams = { days: 60 }
      if (accRisk) accParams.risk = accRisk
      const [{ data: fx }, { data: acc }] = await Promise.all([
        axios.get('/api/backtest/fixtures', { params: { date } }),
        axios.get('/api/backtest/accuracy', { params: accParams })
      ])
      setFixtures(fx.items || [])
      setAccuracy(acc)

      // Pre-fill already-analysed fixtures using the full result from buildResult()
      const prefilled = {}
      for (const item of (fx.items || [])) {
        if (item.storedResult) {
          prefilled[item.fixture._id] = item.storedResult
        }
      }
      setResults(prefilled)
    } catch (e) {
      setError(e.response?.data?.error || e.message)
    } finally {
      setLoading(false)
    }
  }

  async function runFixture(fixtureId, force = false) {
    setRunning(r => ({ ...r, [fixtureId]: true }))
    try {
      const { data } = await axios.post(`/api/backtest/fixture/${fixtureId}${force ? '?force=true' : ''}`)
      setResults(r => ({ ...r, [fixtureId]: data }))
      await refreshAccuracy(accRisk)
    } catch (e) {
      alert('Analysis failed: ' + (e.response?.data?.error || e.message))
    } finally {
      setRunning(r => ({ ...r, [fixtureId]: false }))
    }
  }

  const done = fixtures ? fixtures.filter(f => results[f.fixture._id]).length : 0

  return (
    <div>
      {/* Controls */}
      <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: '0.7rem', color: '#718096', marginBottom: '4px' }}>Select date</div>
          <input
            type="date" value={date} max={today()}
            onChange={e => setDate(e.target.value)}
            style={{ background: '#1a1f2e', border: '1px solid #2d3748', borderRadius: '8px', color: '#e2e8f0', padding: '8px 12px', fontSize: '0.875rem', outline: 'none' }}
          />
        </div>
        <button onClick={loadFixtures} disabled={loading || syncing}
          style={{ background: loading ? '#2d3748' : '#2b6cb0', color: loading ? '#718096' : '#fff', border: 'none', borderRadius: '8px', padding: '9px 20px', cursor: loading ? 'default' : 'pointer', fontSize: '0.875rem', fontWeight: 600 }}>
          {loading ? 'Loading...' : 'Load Fixtures'}
        </button>
        <button onClick={syncResults} disabled={syncing || loading}
          style={{ background: syncing ? '#2d3748' : '#276749', color: syncing ? '#718096' : '#fff', border: 'none', borderRadius: '8px', padding: '9px 20px', cursor: syncing ? 'default' : 'pointer', fontSize: '0.875rem', fontWeight: 600 }}>
          {syncing ? 'Syncing…' : 'Sync Results'}
        </button>
        <div>
          <div style={{ fontSize: '0.7rem', color: '#718096', marginBottom: '4px' }}>Accuracy filter</div>
          <select value={accRisk} onChange={e => { setAccRisk(e.target.value); refreshAccuracy(e.target.value) }}
            style={{ background: '#1a1f2e', border: '1px solid #2d3748', borderRadius: '8px', color: '#e2e8f0', padding: '8px 12px', fontSize: '0.875rem', outline: 'none', cursor: 'pointer' }}>
            <option value="">All predictions</option>
            <option value="low">Bet Builder – Low risk</option>
            <option value="medium">Bet Builder – Medium risk</option>
            <option value="high">Bet Builder – High risk</option>
          </select>
        </div>
      </div>

      {error && <p style={{ color: '#fc8181', marginBottom: '1rem' }}>{error}</p>}

      {/* Historical accuracy (from stored backtest results) */}
      {accuracy?.total === 0 && accuracy?.risk && (
        <div style={{ background: '#1a1f2e', border: '1px solid #2d3748', borderRadius: '12px', padding: '1rem 1.25rem', marginBottom: '1.5rem', color: '#718096', fontSize: '0.8rem' }}>
          No backtest results pass the <strong style={{ color: '#e2e8f0' }}>{accuracy.risk}</strong> risk gate yet.
          Run more fixture analyses so the gate fields get saved, then try again.
        </div>
      )}
      {accuracy?.total >= 5 && (
        <div style={{ background: '#1a1f2e', border: '1px solid #2d3748', borderRadius: '12px', padding: '1rem 1.25rem', marginBottom: '1.5rem' }}>
          <div style={{ fontSize: '0.7rem', color: '#718096', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '10px' }}>
            {accuracy.risk
              ? `Bet Builder (${accuracy.risk} risk) accuracy · last 60 days · ${accuracy.total} qualifying picks`
              : `Historical accuracy · last 60 days · ${accuracy.total} tested`}
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <AccBadge label="Blended 1X2"  data={accuracy.blended?.result1X2} />
            <AccBadge label="Poisson 1X2"  data={accuracy.poisson?.result1X2} />
            <AccBadge label="ELO 1X2"      data={accuracy.elo?.result1X2} />
            <AccBadge label="Odds 1X2"     data={accuracy.odds?.result1X2} />
            <AccBadge label="Over 1.5"     data={accuracy.poisson?.over15} />
            <AccBadge label="Over 2.5"     data={accuracy.blended?.over25 || accuracy.poisson?.over25} />
            <AccBadge label="Over 3.5"     data={accuracy.poisson?.over35} />
            <AccBadge label="DC 1X"        data={accuracy.poisson?.dc_homeOrDraw} />
            {accuracy.claude && <AccBadge label="Claude" data={accuracy.claude} highlight />}
          </div>
          {(accuracy.blended?.byOutcome || accuracy.poisson?.byOutcome) && (
            <div style={{ display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }}>
              {Object.entries(accuracy.blended?.byOutcome || accuracy.poisson?.byOutcome || {}).map(([o, s]) => s.total > 0 && (
                <div key={o} style={{ background: '#2d3748', borderRadius: '6px', padding: '3px 8px', fontSize: '0.7rem' }}>
                  <span style={{ color: '#e2e8f0', fontWeight: 700, textTransform: 'capitalize' }}>{o}</span>
                  <span style={{ color: '#718096', marginLeft: 5 }}>{s.correct}/{s.total} ({Math.round(s.correct / s.total * 100)}%)</span>
                </div>
              ))}
            </div>
          )}
          <div style={{ fontSize: '0.68rem', color: '#4a5568', marginTop: '6px' }}>
            These figures are fed into Claude to calibrate its confidence.
          </div>
        </div>
      )}

      {/* Weight optimiser */}
      <div style={{ background: '#1a1f2e', border: '1px solid #2d3748', borderRadius: '12px', padding: '1rem 1.25rem', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: savedWeights || optimResult ? '12px' : 0 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#e2e8f0', marginBottom: 2 }}>Blend Weight Optimiser</div>
            <div style={{ fontSize: '0.7rem', color: '#718096' }}>
              Grid-searches Poisson / ELO / Odds weights to minimise log-loss on your backtest results. Needs 20+ analysed fixtures (odds optional).
            </div>
          </div>
          <button onClick={optimiseWeights} disabled={optimising}
            style={{ padding: '8px 18px', borderRadius: '8px', fontSize: '0.8rem', fontWeight: 700, cursor: optimising ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap',
              background: optimising ? '#2d3748' : '#553c9a', color: optimising ? '#718096' : '#e9d8fd', border: '1px solid #6b46c1' }}>
            {optimising ? 'Optimising…' : 'Optimise Weights'}
          </button>
          {savedWeights?.value && (
            <button onClick={resetWeights}
              style={{ padding: '8px 14px', borderRadius: '8px', fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
                background: 'transparent', color: '#fc8181', border: '1px solid #fc8181' }}>
              Reset to Defaults
            </button>
          )}
        </div>

        {/* Current saved weights */}
        {savedWeights?.value && (
          <div style={{ fontSize: '0.72rem', color: '#a0aec0', marginBottom: optimResult ? '10px' : 0 }}>
            <span style={{ color: '#718096' }}>Active weights </span>
            <WeightPill label="Poisson" val={savedWeights.value.full?.poisson} color="#bee3f8" />
            <WeightPill label="ELO"     val={savedWeights.value.full?.elo}     color="#fbd38d" />
            <WeightPill label="Odds"    val={savedWeights.value.full?.odds}    color="#a0aec0" />
            {savedWeights.meta?.optimisedAt && (
              <span style={{ color: '#4a5568', marginLeft: 8 }}>
                · last run {new Date(savedWeights.meta.optimisedAt).toLocaleDateString()} on {savedWeights.meta.samples} samples
              </span>
            )}
          </div>
        )}

        {/* Optimisation result */}
        {optimResult?.error && (
          <div style={{ fontSize: '0.75rem', color: '#fc8181', marginTop: 4 }}>{optimResult.error}</div>
        )}
        {optimResult && !optimResult.error && (
          <div style={{ fontSize: '0.75rem', color: '#e2e8f0' }}>
            <div style={{ marginBottom: 4 }}>
              <span style={{ color: '#718096' }}>Optimised on </span>
              <b>{optimResult.samples}</b>
              <span style={{ color: '#718096' }}> records — log-loss </span>
              <b style={{ color: '#fc8181' }}>{optimResult.baselineLogLoss}</b>
              <span style={{ color: '#718096' }}> → </span>
              <b style={{ color: '#68d391' }}>{optimResult.optimisedLogLoss}</b>
              <span style={{ color: optimResult.improvement > 0 ? '#68d391' : '#fc8181', marginLeft: 6 }}>
                ({optimResult.improvement > 0 ? '−' : '+'}{Math.abs(optimResult.improvement)} improvement)
              </span>
            </div>
            <div>
              <span style={{ color: '#718096' }}>New weights (with odds): </span>
              <WeightPill label="Poisson" val={optimResult.weights?.full?.poisson} color="#bee3f8" />
              <WeightPill label="ELO"     val={optimResult.weights?.full?.elo}     color="#fbd38d" />
              <WeightPill label="Odds"    val={optimResult.weights?.full?.odds}    color="#a0aec0" />
            </div>
            {optimResult.noOddsSamples >= 10 && (
              <div style={{ marginTop: 2 }}>
                <span style={{ color: '#718096' }}>No-odds weights: </span>
                <WeightPill label="Poisson" val={optimResult.weights?.noOdds?.poisson} color="#bee3f8" />
                <WeightPill label="ELO"     val={optimResult.weights?.noOdds?.elo}     color="#fbd38d" />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Fixture list */}
      {fixtures !== null && (
        <>
          {fixtures.length === 0 && (
            <div style={{ color: '#718096', textAlign: 'center', padding: '3rem 0' }}>
              No finished fixtures found for {date}. Try syncing data first.
            </div>
          )}

          {fixtures.length > 0 && (
            <div style={{ fontSize: '0.75rem', color: '#718096', marginBottom: '0.75rem' }}>
              {fixtures.length} fixtures · {done} analysed
            </div>
          )}

          {fixtures.map(item => (
            <FixtureCard
              key={item.fixture._id}
              item={item}
              result={results[item.fixture._id] || null}
              running={!!running[item.fixture._id]}
              onRun={(force) => runFixture(item.fixture._id, force)}
            />
          ))}
        </>
      )}
    </div>
  )
}

function WeightPill({ label, val, color }) {
  if (val == null) return null
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, background: '#2d3748', borderRadius: 5, padding: '1px 7px', marginRight: 4, fontSize: '0.7rem' }}>
      <span style={{ color }}>{label}</span>
      <span style={{ color: '#e2e8f0', fontWeight: 700 }}>{Math.round(val * 100)}%</span>
    </span>
  )
}

function AccBadge({ label, data, highlight }) {
  if (!data || data.total === 0) return null
  const pctVal = data.pct ?? (data.total ? Math.round(data.correct / data.total * 100) : null)
  const good = pctVal >= 50
  return (
    <div style={{ background: highlight ? (good ? '#1c4532' : '#2d2020') : '#2d3748', border: highlight ? `1px solid ${good ? '#276749' : '#742a2a'}` : '1px solid transparent', borderRadius: '8px', padding: '5px 10px', textAlign: 'center', minWidth: '70px' }}>
      <div style={{ fontSize: '0.6rem', color: '#718096', marginBottom: 1 }}>{label}</div>
      <div style={{ fontSize: '0.95rem', fontWeight: 700, color: good ? '#68d391' : '#fc8181' }}>{pctVal}%</div>
      <div style={{ fontSize: '0.6rem', color: '#718096' }}>{data.correct}/{data.total}</div>
    </div>
  )
}

const LIVE_STATUS_LABEL = { '1H': '1H', 'HT': 'HT', '2H': '2H', 'ET': 'ET', 'P': 'PEN', 'BT': 'BT' }

function liveTimeLabel(liveStatus, elapsed) {
  if (!liveStatus) return 'LIVE'
  if (liveStatus === 'HT') return 'HT'
  if (liveStatus === 'BT') return 'BT'
  if (elapsed == null) return LIVE_STATUS_LABEL[liveStatus] ?? 'LIVE'
  // Real time: add 15-min HT break if in 2nd half or ET
  const realMin = ['2H', 'ET', 'P'].includes(liveStatus) ? elapsed + 15 : elapsed
  return `${LIVE_STATUS_LABEL[liveStatus]} ${elapsed}' (${realMin}')`
}

function FixtureCard({ item, result, running, onRun }) {
  // onRun(force): pass true to force re-run, false/undefined for first-run
  const [expanded, setExpanded] = useState(false)
  const { fixture } = item

  const isLive = fixture.status === 'live'

  const actual1X2  = fixture.goalsHome > fixture.goalsAway ? 'home' : fixture.goalsHome < fixture.goalsAway ? 'away' : 'draw'
  const actualLabel = actual1X2 === 'home' ? fixture.homeTeamName : actual1X2 === 'away' ? fixture.awayTeamName : 'Draw'
  const m          = result?.models?.blended || result?.models?.poisson || result?.markets
  // Suppress correctness for live matches — the score isn't final
  const correct1X2 = isLive ? undefined : m?.result1X2?.correct

  // Border: neutral for live/pre-analysis, green/red only for finished
  const borderColor = isLive ? '#744210' : correct1X2 === true ? '#276749' : correct1X2 === false ? '#742a2a' : '#2d3748'

  const resultColor = (correct) => isLive ? NEUTRAL : correct === true ? CORRECT : correct === false ? WRONG : NEUTRAL

  return (
    <div style={{ background: '#1a1f2e', border: `1px solid ${borderColor}`, borderRadius: '12px', marginBottom: '0.75rem', overflow: 'hidden' }}>

      {/* Header row */}
      <div style={{ padding: '0.875rem 1.25rem', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: '200px' }}>
          <div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: '6px' }}>
            {fixture.homeTeamName} <span style={{ fontWeight: 800 }}>{fixture.goalsHome} – {fixture.goalsAway}</span> {fixture.awayTeamName}
            {isLive && (
              <span style={{ fontSize: '0.6rem', fontWeight: 700, color: '#f6ad55', background: '#744210', borderRadius: '4px', padding: '1px 5px' }}>
                {liveTimeLabel(fixture.liveStatus, fixture.elapsed)}
              </span>
            )}
          </div>
          <div style={{ fontSize: '0.7rem', color: '#718096', marginTop: 1 }}>{fixture.league}</div>
        </div>

        {/* Actual outcome */}
        <div style={{ textAlign: 'center', minWidth: '80px' }}>
          <div style={{ fontSize: '0.6rem', color: '#718096', marginBottom: 2 }}>{isLive ? 'SCORE' : 'ACTUAL'}</div>
          <div style={{ fontSize: '0.78rem', fontWeight: 700, color: isLive ? '#f6ad55' : '#e2e8f0' }}>{actualLabel}</div>
        </div>

        {/* Model result */}
        <div style={{ textAlign: 'center', minWidth: '90px' }}>
          <div style={{ fontSize: '0.6rem', color: '#718096', marginBottom: 2 }}>MODEL</div>
          {m?.result1X2 ? (
            <>
              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: resultColor(m.result1X2.correct) }}>
                {m.result1X2.predicted === 'home' ? fixture.homeTeamName : m.result1X2.predicted === 'away' ? fixture.awayTeamName : 'Draw'}
              </div>
              <div style={{ fontSize: '0.65rem', color: '#718096' }}>{pct(m.result1X2.prob)}</div>
            </>
          ) : (
            <div style={{ fontSize: '0.75rem', color: '#4a5568' }}>—</div>
          )}
        </div>

        {/* Claude result */}
        <div style={{ textAlign: 'center', minWidth: '80px' }}>
          <div style={{ fontSize: '0.6rem', color: '#718096', marginBottom: 2 }}>CLAUDE</div>
          {result?.claude ? (
            <>
              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: resultColor(result.claude.correct) }}>
                {result.claude.predicted === 'home' ? fixture.homeTeamName : result.claude.predicted === 'away' ? fixture.awayTeamName : 'Draw'}
              </div>
              <div style={{ fontSize: '0.62rem', color: '#718096' }}>{result.claude.confidence}</div>
            </>
          ) : (
            <div style={{ fontSize: '0.75rem', color: '#4a5568' }}>—</div>
          )}
        </div>

        {/* O/U badges */}
        {m && (
          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
            {[['1.5', m.over15], ['2.5', m.over25], ['3.5', m.over35]].map(([threshold, mk]) => mk && (
              <span key={threshold} style={{ fontSize: '0.62rem', fontWeight: 600, padding: '2px 6px', borderRadius: '4px',
                background: isLive ? '#2d3748' : mk.correct ? '#1c4532' : '#2d2020',
                color: isLive ? NEUTRAL : mk.correct ? CORRECT : WRONG }}>
                {isLive ? (mk.predicted === 'over' ? 'O' : 'U') : (mk.actual === 'over' ? 'O' : 'U')}{threshold} {isLive ? '?' : mk.correct ? '✓' : '✗'}
              </span>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: '6px', marginLeft: 'auto', alignItems: 'center' }}>
          {!result && (
            <button onClick={onRun} disabled={running}
              style={{ background: running ? '#2d3748' : '#276749', color: running ? '#718096' : '#fff', border: 'none', borderRadius: '6px', padding: '5px 14px', cursor: running ? 'default' : 'pointer', fontSize: '0.75rem', fontWeight: 600, whiteSpace: 'nowrap' }}>
              {running ? 'Analysing…' : 'Analyse'}
            </button>
          )}
          {result && (
            <>
              <button onClick={() => onRun(true)} disabled={running}
                style={{ background: running ? '#2d3748' : '#2d3748', color: running ? '#718096' : '#a0aec0', border: '1px solid #4a5568', borderRadius: '6px', padding: '5px 10px', cursor: running ? 'default' : 'pointer', fontSize: '0.72rem' }}>
                {running ? 'Analysing…' : 'Re-run'}
              </button>
              <button onClick={() => setExpanded(e => !e)}
                style={{ background: '#2d3748', color: '#a0aec0', border: 'none', borderRadius: '6px', padding: '5px 10px', cursor: 'pointer', fontSize: '0.75rem' }}>
                {expanded ? 'Hide ▲' : 'Details ▼'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && result && (
        <div style={{ borderTop: '1px solid #2d3748', padding: '1rem 1.25rem' }}>

          {/* ── All-models comparison table ── */}
          <ModelsTable result={result} actual1X2={actual1X2} fixture={fixture} isLive={isLive} />

          {/* ── Primary model full market detail ── */}
          {m && (
            <div style={{ marginTop: '1rem' }}>
              <div style={{ fontSize: '0.62rem', color: '#553c9a', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: '8px', fontWeight: 600 }}>
                {result.models?.blended ? 'Blended' : 'Poisson'} — Market Detail
                {m.bookmaker && <span style={{ marginLeft: 6, color: '#718096', fontWeight: 400 }}>· {m.bookmaker}</span>}
                {result.confidence != null && <span style={{ marginLeft: 6, color: '#4a5568', fontWeight: 400 }}>· Conf {result.confidence}/100</span>}
              </div>
              <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>

                {/* 1X2 boxes */}
                {m.result1X2 && (
                  <Boxes1X2 m={m} actual1X2={actual1X2} fixture={fixture} isLive={isLive} />
                )}

                {/* Over/Under */}
                {(m.over15 || m.over25 || m.over35) && (
                  <MarketTable title="Over / Under" rows={[
                    m.over15 && { label: 'Over 1.5', prob: m.over15.predicted === 'over' ? m.over15.prob : 1 - m.over15.prob, correct: m.over15.correct, actual: m.over15.actual, predicted: m.over15.predicted },
                    m.over25 && { label: 'Over 2.5', prob: m.over25.predicted === 'over' ? m.over25.prob : 1 - m.over25.prob, correct: m.over25.correct, actual: m.over25.actual, predicted: m.over25.predicted },
                    m.over35 && { label: 'Over 3.5', prob: m.over35.predicted === 'over' ? m.over35.prob : 1 - m.over35.prob, correct: m.over35.correct, actual: m.over35.actual, predicted: m.over35.predicted }
                  ].filter(Boolean)} isLive={isLive} />
                )}

                {/* BTTS */}
                {m.btts && (
                  <MarketTable title="BTTS" rows={[
                    { label: 'Both Score', prob: m.btts.prob, correct: m.btts.correct, predicted: m.btts.predicted ? 'yes' : 'no', actual: m.btts.actual ? 'yes' : 'no' }
                  ]} isLive={isLive} />
                )}

                {/* Double Chance */}
                {m.doubleChance && (
                  <MarketTable title="Double Chance" rows={[
                    { label: '1X (H or D)', prob: m.doubleChance.homeOrDraw?.prob, correct: m.doubleChance.homeOrDraw?.correct, actual: m.doubleChance.homeOrDraw?.actual },
                    { label: 'X2 (D or A)', prob: m.doubleChance.awayOrDraw?.prob, correct: m.doubleChance.awayOrDraw?.correct, actual: m.doubleChance.awayOrDraw?.actual },
                    { label: '12 (H or A)', prob: m.doubleChance.homeOrAway?.prob, correct: m.doubleChance.homeOrAway?.correct, actual: m.doubleChance.homeOrAway?.actual }
                  ]} dcMode isLive={isLive} />
                )}

                {/* HT */}
                {m.halfTime && (
                  <div style={{ minWidth: '130px' }}>
                    <div style={{ fontSize: '0.65rem', color: '#718096', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: '6px' }}>Half-Time</div>
                    <div style={{ fontSize: '0.78rem', color: '#a0aec0' }}>
                      <span style={{ color: outcomeColor(m.halfTime.predicted), fontWeight: 600, textTransform: 'capitalize' }}>{m.halfTime.predicted}</span>
                      <span style={{ color: '#718096' }}> ({pct(m.halfTime.prob)})</span>
                    </div>
                    {m.halfTime.over05 != null && <div style={{ fontSize: '0.7rem', color: '#718096', marginTop: 2 }}>HT O0.5: {pct(m.halfTime.over05)}</div>}
                  </div>
                )}
              </div>

              {/* Blended component breakdown */}
              {m.poissonProbs && (
                <BlendBreakdown m={m} isLive={isLive} />
              )}
            </div>
          )}

          {/* ── Claude analysis ── */}
          {result.claude && (
            <div style={{ marginTop: '1rem', paddingTop: '0.75rem', borderTop: '1px solid #2d3748' }}>
              <ClaudeStrip claude={result.claude} fixture={fixture} result={result} isLive={isLive} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function outcomeColor(outcome) {
  if (outcome === 'home') return '#68d391'
  if (outcome === 'away') return '#fc8181'
  return '#bee3f8'
}

function Boxes1X2({ m, actual1X2, fixture, isLive }) {
  return (
    <div style={{ minWidth: '150px' }}>
      <div style={{ fontSize: '0.65rem', color: '#718096', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: '6px' }}>1X2</div>
      <div style={{ display: 'flex', gap: '5px' }}>
        {[{ label: 'H', key: 'home' }, { label: 'D', key: 'draw' }, { label: 'A', key: 'away' }].map(({ label, key }) => {
          const prob = m.result1X2.probs?.[key]
          const isPred = m.result1X2.predicted === key
          const isAct  = actual1X2 === key
          const boxCorrect = isPred && isAct
          return (
            <div key={key} style={{
              flex: 1, textAlign: 'center', borderRadius: '6px', padding: '5px 4px',
              background: isLive ? '#2d3748' : isPred ? (boxCorrect ? '#1c4532' : '#2d2020') : isAct ? '#2a2d3a' : '#2d3748',
              border: `1px solid ${isLive ? '#4a5568' : isPred ? (boxCorrect ? '#276749' : '#742a2a') : isAct ? '#4a5568' : 'transparent'}`
            }}>
              <div style={{ fontSize: '0.6rem', color: '#718096' }}>{label}</div>
              <div style={{ fontSize: '0.82rem', fontWeight: 700, color: isLive ? '#a0aec0' : isPred ? (boxCorrect ? CORRECT : WRONG) : '#a0aec0' }}>{pct(prob)}</div>
              <div style={{ fontSize: '0.58rem', color: '#4a5568' }}>{isPred && '↑'}{isAct && '★'}</div>
            </div>
          )
        })}
      </div>
      <div style={{ fontSize: '0.6rem', color: '#4a5568', marginTop: 3 }}>↑ predicted · ★ actual</div>
    </div>
  )
}

function MarketTable({ title, rows, dcMode, isLive }) {
  return (
    <div style={{ minWidth: '160px' }}>
      <div style={{ fontSize: '0.65rem', color: '#718096', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: '6px' }}>{title}</div>
      {rows.map((row, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0', gap: '8px', fontSize: '0.75rem' }}>
          <span style={{ color: '#a0aec0' }}>{row.label}</span>
          <span style={{ color: '#718096' }}>{pct(row.prob)}</span>
          {!dcMode && <span style={{ fontSize: '0.68rem', color: '#718096' }}>{row.predicted}</span>}
          {!isLive && (
            <span style={{ fontWeight: 600, fontSize: '0.7rem', padding: '1px 5px', borderRadius: '3px', background: (dcMode ? row.actual : row.correct) ? '#1c4532' : '#2d2020', color: (dcMode ? row.actual : row.correct) ? '#68d391' : '#fc8181' }}>
              {dcMode ? (row.actual ? 'Covered ✓' : 'Missed ✗') : (row.correct ? '✓' : '✗')}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

// All-models comparison: Poisson | ELO | Blended | Odds
function ModelsTable({ result, actual1X2, fixture, isLive }) {
  const models = [
    { key: 'poisson', label: 'Poisson',  color: '#bee3f8' },
    { key: 'elo',     label: 'ELO',      color: '#fbd38d' },
    { key: 'blended', label: 'Blended',  color: '#d6bcfa' },
    { key: 'odds',    label: 'Odds',     color: '#a0aec0' },
  ].filter(({ key }) => result.models?.[key]?.result1X2)

  if (!models.length) return null

  const homeLabel = fixture.homeTeamName
  const awayLabel = fixture.awayTeamName

  return (
    <div>
      <div style={{ fontSize: '0.62rem', color: '#718096', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: '6px' }}>Models comparison</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', color: '#718096', padding: '3px 8px', borderBottom: '1px solid #2d3748' }}>Model</th>
              <th style={{ textAlign: 'center', color: '#718096', padding: '3px 8px', borderBottom: '1px solid #2d3748' }}>Prediction</th>
              <th style={{ textAlign: 'right', color: '#718096', padding: '3px 8px', borderBottom: '1px solid #2d3748' }}>Home</th>
              <th style={{ textAlign: 'right', color: '#718096', padding: '3px 8px', borderBottom: '1px solid #2d3748' }}>Draw</th>
              <th style={{ textAlign: 'right', color: '#718096', padding: '3px 8px', borderBottom: '1px solid #2d3748' }}>Away</th>
              {!isLive && <th style={{ textAlign: 'center', color: '#718096', padding: '3px 8px', borderBottom: '1px solid #2d3748' }}>Result</th>}
            </tr>
          </thead>
          <tbody>
            {models.map(({ key, label, color }) => {
              const mod = result.models[key]
              const r1x2 = mod.result1X2
              const predLabel = r1x2.predicted === 'home' ? homeLabel : r1x2.predicted === 'away' ? awayLabel : 'Draw'
              const correct = r1x2.correct
              return (
                <tr key={key} style={{ borderBottom: '1px solid #1a1f2e' }}>
                  <td style={{ padding: '5px 8px', color, fontWeight: 600 }}>{label}
                    {key === 'elo' && mod.homeElo && <span style={{ color: '#4a5568', fontWeight: 400, fontSize: '0.65rem', marginLeft: 4 }}>{mod.homeElo}v{mod.awayElo}</span>}
                    {key === 'odds' && mod.bookmaker && <span style={{ color: '#4a5568', fontWeight: 400, fontSize: '0.65rem', marginLeft: 4 }}>{mod.bookmaker}</span>}
                  </td>
                  <td style={{ padding: '5px 8px', textAlign: 'center', color: '#e2e8f0', fontWeight: 600 }}>{predLabel}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', color: r1x2.predicted === 'home' ? color : '#718096' }}>{pct(r1x2.probs?.home)}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', color: r1x2.predicted === 'draw' ? color : '#718096' }}>{pct(r1x2.probs?.draw)}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', color: r1x2.predicted === 'away' ? color : '#718096' }}>{pct(r1x2.probs?.away)}</td>
                  {!isLive && (
                    <td style={{ padding: '5px 8px', textAlign: 'center' }}>
                      <span style={{ fontSize: '0.72rem', fontWeight: 700, color: correct ? CORRECT : WRONG }}>{correct ? '✓' : '✗'}</span>
                    </td>
                  )}
                </tr>
              )
            })}
            {/* Actual outcome row */}
            <tr style={{ borderTop: '1px solid #2d3748' }}>
              <td style={{ padding: '5px 8px', color: '#718096', fontSize: '0.7rem' }}>Actual</td>
              <td style={{ padding: '5px 8px', textAlign: 'center', color: '#e2e8f0', fontWeight: 700, textTransform: 'capitalize' }}>
                {actual1X2 === 'home' ? fixture.homeTeamName : actual1X2 === 'away' ? fixture.awayTeamName : 'Draw'}
              </td>
              <td colSpan={isLive ? 3 : 4} style={{ padding: '5px 8px', textAlign: 'right', color: '#718096', fontSize: '0.7rem' }}>
                {fixture.goalsHome} – {fixture.goalsAway}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

// Blended breakdown: Poisson | ELO | Odds (devigged) | Raw | Blended
function BlendBreakdown({ m, isLive }) {
  const w = m.weights ?? {}
  return (
    <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid #2d3748' }}>
      <div style={{ fontSize: '0.62rem', color: '#718096', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: '6px' }}>
        Blend weights: Poisson {Math.round((w.poisson ?? 0) * 100)}% · ELO {Math.round((w.elo ?? 0) * 100)}% · Odds {Math.round((w.odds ?? 0) * 100)}%
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ fontSize: '0.72rem', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['', 'Poisson', 'ELO', m.oddsProbs ? 'Odds (devig)' : null, m.rawOdds ? 'Raw Odds' : null, 'Blended'].filter(Boolean).map(h => (
                <th key={h} style={{ color: h === 'Blended' ? '#d6bcfa' : h === 'Odds (devig)' ? '#a0aec0' : h === 'ELO' ? '#fbd38d' : '#718096', fontWeight: 600, padding: '3px 10px', textAlign: h === '' ? 'left' : 'right', borderBottom: '1px solid #2d3748' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[['Home', 'home'], ['Draw', 'draw'], ['Away', 'away']].map(([label, key]) => (
              <tr key={key} style={{ borderBottom: '1px solid #1a1f2e' }}>
                <td style={{ padding: '4px 10px', color: '#a0aec0' }}>{label}</td>
                <td style={{ padding: '4px 10px', textAlign: 'right', color: '#bee3f8' }}>{pct(m.poissonProbs?.[key])}</td>
                <td style={{ padding: '4px 10px', textAlign: 'right', color: '#fbd38d' }}>{pct(m.eloProbs?.[key])}</td>
                {m.oddsProbs && <td style={{ padding: '4px 10px', textAlign: 'right', color: '#a0aec0' }}>{pct(m.oddsProbs?.[key])}</td>}
                {m.rawOdds && <td style={{ padding: '4px 10px', textAlign: 'right', color: '#718096' }}>{m.rawOdds?.[key]?.toFixed(2) ?? '—'}</td>}
                <td style={{ padding: '4px 10px', textAlign: 'right', color: '#d6bcfa', fontWeight: 700 }}>{pct(m.result1X2?.probs?.[key])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// Full Claude analysis strip
function ClaudeStrip({ claude, fixture, result, isLive }) {
  return (
    <div>
      {/* FT verdict */}
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '6px' }}>
        <span style={{ fontSize: '0.62rem', color: '#718096', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Claude FT</span>
        <span style={{ fontSize: '0.82rem', fontWeight: 700, color: isLive ? '#a0aec0' : claude.correct ? CORRECT : WRONG }}>
          {claude.verdict}
          {!isLive && <span style={{ marginLeft: 4 }}>{claude.correct ? '✓' : '✗'}</span>}
        </span>
        {claude.confidence && <span style={{ fontSize: '0.68rem', color: '#718096', background: '#2d3748', padding: '1px 6px', borderRadius: '4px' }}>{claude.confidence}</span>}
        {claude.oddsAlignment && claude.oddsAlignment !== 'N/A' && (
          <span style={{ fontSize: '0.68rem', color: claude.oddsAlignment === 'Agree' ? CORRECT : '#f6e05e' }}>
            Odds {claude.oddsAlignment} {claude.oddsAlignment === 'Agree' ? '✓' : '⚠'}
          </span>
        )}
        {claude.bestBet && <span style={{ fontSize: '0.7rem', color: '#bee3f8' }}>Best: {claude.bestBet}</span>}
        {claude.valueBet && <span style={{ fontSize: '0.7rem', color: '#68d391' }}>Value: {claude.valueBet}</span>}
      </div>

      {/* HT */}
      {claude.ht && (
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '6px' }}>
          <span style={{ fontSize: '0.62rem', color: '#718096', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Claude HT</span>
          <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#e2e8f0' }}>
            {claude.ht.verdict} · {claude.ht.confidence}
            {claude.ht.predictedScore && <span style={{ color: '#718096', fontWeight: 400 }}> ({claude.ht.predictedScore})</span>}
          </span>
          {claude.ht.over05 != null && <span style={{ fontSize: '0.7rem', color: '#718096' }}>O0.5: <span style={{ color: claude.ht.over05 ? CORRECT : NEUTRAL }}>{claude.ht.over05 ? 'Yes' : 'No'}</span></span>}
          {claude.ht.over15 != null && <span style={{ fontSize: '0.7rem', color: '#718096' }}>O1.5: <span style={{ color: claude.ht.over15 ? CORRECT : NEUTRAL }}>{claude.ht.over15 ? 'Yes' : 'No'}</span></span>}
          {result.fixture?.htGoalsHome != null && (
            <span style={{ fontSize: '0.7rem', color: '#718096' }}>
              Actual HT: <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{result.fixture.htGoalsHome}–{result.fixture.htGoalsAway}</span>
            </span>
          )}
        </div>
      )}

      {/* Analysis text */}
      {claude.analysis && (
        <p style={{ fontSize: '0.75rem', color: '#a0aec0', lineHeight: 1.55, margin: '6px 0' }}>{claude.analysis}</p>
      )}

      {/* Odds alignment note */}
      {claude.oddsAlignmentNote && (
        <p style={{ fontSize: '0.7rem', color: '#d6bcfa', margin: '4px 0' }}>{claude.oddsAlignmentNote}</p>
      )}

      {/* Key factors */}
      {claude.keyFactors?.length > 0 && (
        <div style={{ marginTop: '4px' }}>
          {claude.keyFactors.map((f, i) => (
            <div key={i} style={{ fontSize: '0.7rem', color: '#718096', marginBottom: 2 }}>· {f}</div>
          ))}
        </div>
      )}

      {/* Risk / form / injury */}
      {(claude.riskFactor || claude.formEdge || claude.injuryImpact) && (
        <div style={{ display: 'flex', gap: '1rem', marginTop: '6px', flexWrap: 'wrap' }}>
          {claude.riskFactor && <span style={{ fontSize: '0.68rem', color: '#fc8181' }}>Risk: {claude.riskFactor}</span>}
          {claude.formEdge && claude.formEdge !== 'Neutral' && <span style={{ fontSize: '0.68rem', color: '#f6e05e' }}>Form edge: {claude.formEdge}</span>}
          {claude.injuryImpact && claude.injuryImpact !== 'None' && <span style={{ fontSize: '0.68rem', color: '#fc8181' }}>Injuries: {claude.injuryImpact}</span>}
        </div>
      )}

      {/* News */}
      {claude.newsVerdict && (
        <div style={{ marginTop: '6px', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: '0.62rem', color: '#718096', textTransform: 'uppercase', letterSpacing: '0.4px' }}>News</span>
          <span style={{ fontSize: '0.72rem', color: claude.newsAgrees ? CORRECT : '#f6e05e' }}>{claude.newsVerdict} {claude.newsAgrees ? '↑ confirms' : '⚠ conflicts'}</span>
          {claude.updatedBestBet && <span style={{ fontSize: '0.7rem', color: '#bee3f8' }}>Updated: {claude.updatedBestBet}</span>}
        </div>
      )}

      {result.historicalAccuracy && (
        <div style={{ fontSize: '0.62rem', color: '#4a5568', marginTop: '6px' }}>
          Calibrated from {result.historicalAccuracy.sample} {result.historicalAccuracy.league} matches
        </div>
      )}
    </div>
  )
}
