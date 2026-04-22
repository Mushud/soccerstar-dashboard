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
  const [results, setResults]   = useState({})   // fixtureId → result
  const [running, setRunning]   = useState({})   // fixtureId → bool
  const [error, setError]       = useState(null)

  async function syncResults() {
    setSyncing(true)
    setError(null)
    try {
      await axios.post('/api/sync/all/backfill')
    } catch { /* non-fatal */ }
    finally { setSyncing(false) }
    await loadFixtures()
  }

  async function loadFixtures() {
    setLoading(true)
    setError(null)
    setFixtures(null)
    setResults({})
    try {
      const [{ data: fx }, { data: acc }] = await Promise.all([
        axios.get('/api/backtest/fixtures', { params: { date } }),
        axios.get('/api/backtest/accuracy', { params: { days: 60 } })
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
      // Refresh accuracy totals
      const { data: acc } = await axios.get('/api/backtest/accuracy', { params: { days: 60 } })
      setAccuracy(acc)
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
      </div>

      {error && <p style={{ color: '#fc8181', marginBottom: '1rem' }}>{error}</p>}

      {/* Historical accuracy (from stored backtest results) */}
      {accuracy?.total >= 5 && (
        <div style={{ background: '#1a1f2e', border: '1px solid #2d3748', borderRadius: '12px', padding: '1rem 1.25rem', marginBottom: '1.5rem' }}>
          <div style={{ fontSize: '0.7rem', color: '#718096', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '10px' }}>
            Historical accuracy · last 60 days · {accuracy.total} tested
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <AccBadge label="1X2" data={accuracy.result1X2} />
            <AccBadge label="Over 1.5" data={accuracy.over15} />
            <AccBadge label="Over 2.5" data={accuracy.over25} />
            <AccBadge label="Over 3.5" data={accuracy.over35} />
            <AccBadge label="DC 1X"   data={accuracy.dc_homeOrDraw} />
            <AccBadge label="DC X2"   data={accuracy.dc_awayOrDraw} />
            <AccBadge label="DC 12"   data={accuracy.dc_homeOrAway} />
            {accuracy.claude && <AccBadge label="Claude" data={accuracy.claude} highlight />}
          </div>
          {accuracy.byOutcome && (
            <div style={{ display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }}>
              {Object.entries(accuracy.byOutcome).map(([o, s]) => s.total > 0 && (
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
  const m          = result?.markets
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
                {mk.predicted === 'over' ? 'O' : 'U'}{threshold} {isLive ? '?' : mk.correct ? '✓' : '✗'}
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

      {/* Expanded market detail */}
      {expanded && result && m && (
        <div style={{ borderTop: '1px solid #2d3748', padding: '1rem 1.25rem' }}>
          <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>

            {/* 1X2 boxes */}
            {m.result1X2 && (
              <div style={{ minWidth: '150px' }}>
                <div style={{ fontSize: '0.65rem', color: '#718096', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: '6px' }}>1X2</div>
                <div style={{ display: 'flex', gap: '5px' }}>
                  {[{ label: 'H', key: 'home' }, { label: 'D', key: 'draw' }, { label: 'A', key: 'away' }].map(({ label, key }) => {
                    const prob   = m.result1X2.probs?.[key]
                    const isPred = m.result1X2.predicted === key
                    const isAct  = actual1X2 === key
                    const boxCorrect = isPred && isAct
                    const boxWrong   = isPred && !isAct
                    return (
                      <div key={key} style={{
                        flex: 1, textAlign: 'center', borderRadius: '6px', padding: '5px 4px',
                        background: isPred ? (boxCorrect ? '#1c4532' : '#2d2020') : isAct ? '#2a2d3a' : '#2d3748',
                        border: `1px solid ${isPred ? (boxCorrect ? '#276749' : '#742a2a') : isAct ? '#4a5568' : 'transparent'}`
                      }}>
                        <div style={{ fontSize: '0.6rem', color: '#718096' }}>{label}</div>
                        <div style={{ fontSize: '0.82rem', fontWeight: 700, color: isPred ? (boxCorrect ? CORRECT : WRONG) : '#a0aec0' }}>{pct(prob)}</div>
                        <div style={{ fontSize: '0.58rem', color: '#4a5568' }}>{isPred && '↑'}{isAct && '★'}</div>
                      </div>
                    )
                  })}
                </div>
                <div style={{ fontSize: '0.6rem', color: '#4a5568', marginTop: 3 }}>↑ predicted · ★ actual</div>
              </div>
            )}

            {/* Over/Under */}
            {(m.over15 || m.over25 || m.over35) && (
              <MarketTable title="Over / Under" rows={[
                m.over15 && { label: 'Over 1.5', prob: m.over15.predicted === 'over' ? m.over15.prob : 1 - m.over15.prob, correct: m.over15.correct, actual: m.over15.actual, predicted: m.over15.predicted },
                m.over25 && { label: 'Over 2.5', prob: m.over25.predicted === 'over' ? m.over25.prob : 1 - m.over25.prob, correct: m.over25.correct, actual: m.over25.actual, predicted: m.over25.predicted },
                m.over35 && { label: 'Over 3.5', prob: m.over35.predicted === 'over' ? m.over35.prob : 1 - m.over35.prob, correct: m.over35.correct, actual: m.over35.actual, predicted: m.over35.predicted }
              ].filter(Boolean)} />
            )}

            {/* Double Chance */}
            {m.doubleChance && (
              <MarketTable title="Double Chance" rows={[
                { label: '1X (H or D)', prob: m.doubleChance.homeOrDraw.prob, correct: m.doubleChance.homeOrDraw.correct, dcCovered: m.doubleChance.homeOrDraw.covered },
                { label: 'X2 (D or A)', prob: m.doubleChance.awayOrDraw.prob, correct: m.doubleChance.awayOrDraw.correct, dcCovered: m.doubleChance.awayOrDraw.covered },
                { label: '12 (H or A)', prob: m.doubleChance.homeOrAway.prob, correct: m.doubleChance.homeOrAway.correct, dcCovered: m.doubleChance.homeOrAway.covered }
              ]} dcMode />
            )}

            {/* HT */}
            {m.halfTime && (
              <div style={{ minWidth: '130px' }}>
                <div style={{ fontSize: '0.65rem', color: '#718096', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: '6px' }}>Half-Time (model)</div>
                <div style={{ fontSize: '0.78rem', color: '#a0aec0' }}>
                  <span style={{ color: outcomeColor(m.halfTime.predicted), fontWeight: 600, textTransform: 'capitalize' }}>{m.halfTime.predicted}</span>
                  <span style={{ color: '#718096' }}> ({pct(m.halfTime.prob)})</span>
                </div>
                {m.halfTime.over05 != null && <div style={{ fontSize: '0.7rem', color: '#718096', marginTop: 2 }}>HT Over 0.5: {pct(m.halfTime.over05)}</div>}
              </div>
            )}
          </div>

          {/* Claude strip */}
          {result.claude && (
            <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid #2d3748' }}>
              {/* FT */}
              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '4px' }}>
                <span style={{ fontSize: '0.65rem', color: '#718096', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Claude FT</span>
                <span style={{ fontSize: '0.78rem', fontWeight: 600, color: result.claude.correct ? CORRECT : WRONG }}>
                  {result.claude.verdict} · {result.claude.confidence} {result.claude.correct ? '✓' : '✗'}
                </span>
                {result.claude.bestBet && <span style={{ fontSize: '0.72rem', color: '#bee3f8' }}>Best bet: {result.claude.bestBet}</span>}
                {result.claude.newsVerdict && (
                  <span style={{ fontSize: '0.72rem', color: '#718096' }}>
                    News: <span style={{ color: result.claude.newsAgrees ? CORRECT : '#f6e05e' }}>{result.claude.newsVerdict}</span>
                    {!result.claude.newsAgrees && ' (conflicts model)'}
                  </span>
                )}
              </div>
              {/* HT */}
              {result.claude.ht && (
                <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '4px' }}>
                  <span style={{ fontSize: '0.65rem', color: '#718096', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Claude HT</span>
                  <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#e2e8f0' }}>
                    {result.claude.ht.verdict} · {result.claude.ht.confidence}
                    {result.claude.ht.predictedScore && <span style={{ color: '#718096', fontWeight: 400 }}> ({result.claude.ht.predictedScore})</span>}
                  </span>
                  {result.claude.ht.over05 != null && (
                    <span style={{ fontSize: '0.7rem', color: '#718096' }}>O0.5: <span style={{ color: result.claude.ht.over05 ? CORRECT : NEUTRAL }}>{result.claude.ht.over05 ? 'Yes' : 'No'}</span></span>
                  )}
                  {result.claude.ht.over15 != null && (
                    <span style={{ fontSize: '0.7rem', color: '#718096' }}>O1.5: <span style={{ color: result.claude.ht.over15 ? CORRECT : NEUTRAL }}>{result.claude.ht.over15 ? 'Yes' : 'No'}</span></span>
                  )}
                  {result.fixture.htGoalsHome != null && (
                    <span style={{ fontSize: '0.7rem', color: '#718096' }}>
                      Actual HT: <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{result.fixture.htGoalsHome}–{result.fixture.htGoalsAway}</span>
                    </span>
                  )}
                </div>
              )}
              {result.historicalAccuracy && (
                <div style={{ fontSize: '0.65rem', color: '#4a5568', marginTop: 2 }}>
                  Calibrated from {result.historicalAccuracy.sample} {result.historicalAccuracy.league} matches
                </div>
              )}
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

function MarketTable({ title, rows, dcMode }) {
  return (
    <div style={{ minWidth: '160px' }}>
      <div style={{ fontSize: '0.65rem', color: '#718096', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: '6px' }}>{title}</div>
      {rows.map((row, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0', gap: '8px', fontSize: '0.75rem' }}>
          <span style={{ color: '#a0aec0' }}>{row.label}</span>
          <span style={{ color: '#718096' }}>{pct(row.prob)}</span>
          {!dcMode && <span style={{ fontSize: '0.68rem', color: '#718096' }}>{row.predicted}</span>}
          <span style={{ fontWeight: 600, fontSize: '0.7rem', padding: '1px 5px', borderRadius: '3px', background: row.correct ? '#1c4532' : '#2d2020', color: row.correct ? '#68d391' : '#fc8181' }}>
            {dcMode ? (row.dcCovered ? 'Covered ✓' : 'Missed ✗') : (row.correct ? '✓' : '✗')}
          </span>
        </div>
      ))}
    </div>
  )
}
