import { useState } from 'react'
import { Link } from 'react-router-dom'
import axios from 'axios'
import PredictionCard from '../components/PredictionCard'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001'

const DURATION_LABELS = {
  today:    'Today',
  tomorrow: 'Tomorrow',
  '2days':  'Next 2 Days',
  '3days':  'Next 3 Days',
  week:     'This Week',
}

const RISK_OPTIONS = [
  {
    key: 'low',
    label: 'Low Risk',
    emoji: '🛡',
    desc: 'High confidence only. No conflicts, no doubt.',
    color: '#68d391', bg: '#1a3a2a', border: '#276749', activeBg: '#276749',
  },
  {
    key: 'medium',
    label: 'Medium Risk',
    emoji: '⚖',
    desc: 'High or Medium confidence. Balanced payout.',
    color: '#ecc94b', bg: '#2d2a1a', border: '#744210', activeBg: '#744210',
  },
  {
    key: 'high',
    label: 'High Risk',
    emoji: '🔥',
    desc: 'Chase value. Higher odds, some uncertainty.',
    color: '#fc8181', bg: '#3a1a1a', border: '#742a2a', activeBg: '#742a2a',
  },
]

function formatDate(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString('en-GB', {
    weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function OddsTag({ odds }) {
  return (
    <span style={{
      background: '#0f1520', border: '1px solid #ecc94b', color: '#ecc94b',
      fontSize: 14, fontWeight: 800, padding: '4px 12px', borderRadius: 6,
    }}>
      {odds}x
    </span>
  )
}

// Lazy-loads the full fixture+prediction when expanded, then renders PredictionCard
function PickCard({ pick, i }) {
  const [open, setOpen] = useState(false)
  const [fetchState, setFetchState] = useState('idle') // idle | loading | done | error
  const [fixtureData, setFixtureData] = useState(null)
  const [analysing, setAnalysing] = useState(false)
  const [analysed, setAnalysed] = useState(pick.hasClaudeAnalysis)

  async function loadFixture() {
    if (!pick.fixtureId) return
    setFetchState('loading')
    try {
      const { data } = await axios.get(`${API}/api/fixtures/${pick.fixtureId}`)
      setFixtureData(data)
      setFetchState('done')
    } catch {
      setFetchState('error')
    }
  }

  async function expand() {
    const next = !open
    setOpen(next)
    if (next && fetchState === 'idle') loadFixture()
  }

  async function runAnalysis(e) {
    e.stopPropagation()
    if (!pick.fixtureId || analysing) return
    setAnalysing(true)
    try {
      await axios.post(`${API}/api/predictions/fixture/${pick.fixtureId}`)
      setAnalysed(true)
      // Reload the fixture data so PredictionCard shows the new Claude analysis
      setFetchState('idle')
      setFixtureData(null)
      if (open) loadFixture()
    } catch {
      // silently fail — user can retry
    } finally {
      setAnalysing(false)
    }
  }

  return (
    <div style={{ background: '#1a1f2e', border: `1px solid ${analysed ? '#27674966' : '#2d374855'}`, borderRadius: 12, overflow: 'hidden' }}>

      {/* Header — click to expand */}
      <div
        onClick={expand}
        style={{ padding: '14px 16px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 9 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {/* Number badge */}
          <span style={{
            width: 24, height: 24, borderRadius: '50%', background: '#276749',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, color: '#68d391', flexShrink: 0, fontWeight: 800,
          }}>{i}</span>

          <div style={{ flex: 1, minWidth: 140 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0' }}>{pick.match}</div>
            <div style={{ fontSize: 11, color: '#718096', marginTop: 2 }}>
              {pick.league}
              {pick.fixtureDate && <span style={{ marginLeft: 6 }}>&middot; {formatDate(pick.fixtureDate)}</span>}
            </div>
          </div>

          <OddsTag odds={pick.odds} />

          {/* Analyse button — shown when no Claude analysis yet */}
          {!analysed && pick.fixtureId && (
            <button
              onClick={runAnalysis}
              disabled={analysing}
              style={{
                padding: '5px 11px', borderRadius: 7, fontSize: 11, fontWeight: 700,
                cursor: analysing ? 'not-allowed' : 'pointer',
                background: analysing ? '#1a2a3a' : '#1a2030',
                color: analysing ? '#718096' : '#ecc94b',
                border: '1px solid #744210',
                whiteSpace: 'nowrap',
              }}
            >
              {analysing ? 'Analysing…' : 'Analyse'}
            </button>
          )}
          {analysed && (
            <span style={{ fontSize: 10, color: '#68d391', fontWeight: 700 }}>✓ Claude</span>
          )}
          {pick.calibrated && (
            <span style={{ fontSize: 10, color: '#90cdf4', fontWeight: 700 }}>✓ Cal</span>
          )}

          <span style={{ fontSize: 10, color: '#4a5568' }}>{open ? '▲' : '▼'}</span>
        </div>

        {/* Pick badges */}
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', paddingLeft: 34 }}>
          <span style={{
            background: '#1a2a3a', border: '1px solid #2b4a6a', color: '#90cdf4',
            fontSize: 11, padding: '3px 9px', borderRadius: 20,
          }}>{pick.market}</span>
          <span style={{
            background: '#1a2a4a', border: '1px solid #2b6cb0', color: '#bee3f8',
            fontSize: 12, fontWeight: 700, padding: '3px 9px', borderRadius: 20,
          }}>{pick.selection}</span>
          {pick.modelProb && (
            <span style={{ fontSize: 11, color: '#4a5568', alignSelf: 'center' }}>model: {pick.modelProb}</span>
          )}
          {pick.certaintyScore != null && (
            <span style={{ fontSize: 11, color: '#4a5568', alignSelf: 'center' }}>
              score: {pick.certaintyScore.toFixed(3)}
            </span>
          )}
        </div>

        {/* Claude's reason for picking this */}
        {pick.reason && (
          <div style={{ paddingLeft: 34, fontSize: 12, color: '#9ae6b4', lineHeight: 1.5 }}>
            {pick.reason}
          </div>
        )}

        {!analysed && (
          <div style={{ paddingLeft: 34, fontSize: 11, color: '#744210' }}>
            Statistical pick — click Analyse to run Claude analysis
          </div>
        )}
      </div>

      {/* Expanded: full PredictionCard */}
      {open && (
        <div style={{ borderTop: '1px solid #2d3748' }}>
          {fetchState === 'loading' && (
            <div style={{ padding: '16px 20px', fontSize: 12, color: '#718096' }}>Loading prediction detail…</div>
          )}
          {fetchState === 'error' && (
            <div style={{ padding: '16px 20px', fontSize: 12, color: '#fc8181' }}>Could not load prediction. Check the match on the dashboard.</div>
          )}
          {fetchState === 'done' && fixtureData && (
            <div style={{ padding: '0 4px 4px' }}>
              <PredictionCard
                fixture={fixtureData.fixture}
                prediction={fixtureData.prediction}
              />
            </div>
          )}
          {!pick.fixtureId && (
            <div style={{ padding: '16px 20px', fontSize: 12, color: '#718096' }}>No fixture ID — prediction detail unavailable.</div>
          )}
        </div>
      )}
    </div>
  )
}

export default function BetBuilder() {
  const [numTeams, setNumTeams] = useState(5)
  const [duration, setDuration] = useState('today')
  const [risks, setRisks] = useState(['low'])

  function toggleRisk(key) {
    setRisks(prev => {
      if (prev.includes(key)) {
        // must keep at least one selected
        if (prev.length === 1) return prev
        return prev.filter(r => r !== key)
      }
      return [...prev, key]
    })
  }
  const [dateMode, setDateMode] = useState('quick') // 'quick' | 'pick'
  // Use local date so the picker opens on the correct calendar day for the user
  const localToday = () => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  const [fromDate, setFromDate] = useState(localToday)
  const [toDate, setToDate] = useState(localToday)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [offset, setOffset] = useState(0)

  async function generate(pageOffset = 0) {
    setLoading(true)
    setError(null)
    if (pageOffset === 0) setResult(null)
    const body = { numTeams, risk: risks, offset: pageOffset }
    if (dateMode === 'pick') {
      body.from = fromDate
      body.to   = toDate || fromDate
    } else {
      body.duration = duration
    }
    try {
      const { data } = await axios.post(`${API}/api/betbuilder/generate`, body, { timeout: 180000 })
      setResult(data)
      setOffset(pageOffset)
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Request timed out — try a narrower date window.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0a0e1a', color: '#e2e8f0', fontFamily: 'system-ui, sans-serif' }}>

      {/* Nav */}
      <div style={{ background: '#111827', borderBottom: '1px solid #1f2937', padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 20 }}>
        <Link to="/" style={{ color: '#68d391', textDecoration: 'none', fontSize: 13 }}>← Dashboard</Link>
        <Link to="/betslip" style={{ color: '#718096', textDecoration: 'none', fontSize: 13 }}>Bet Slip Analyzer</Link>
        <span style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0', marginLeft: 'auto' }}>Bet Builder</span>
      </div>

      <div style={{ maxWidth: 720, margin: '0 auto', padding: '28px 16px' }}>

        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#e2e8f0', marginBottom: 6 }}>Best Bet Builder</div>
          <div style={{ fontSize: 13, color: '#718096', lineHeight: 1.6 }}>
            Choose your risk appetite and a time window. <b style={{ color: '#68d391' }}>Low</b> = zero doubt, High confidence only. <b style={{ color: '#ecc94b' }}>Medium</b> = balanced. <b style={{ color: '#fc8181' }}>High</b> = chase value. Mix two tiers for a wider pool — up to <b style={{ color: '#e2e8f0' }}>25 picks</b>.
          </div>
        </div>

        {/* Form */}
        <div style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 12, padding: '20px', marginBottom: 24, display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>

            {/* Number of picks */}
            <div style={{ flex: 1, minWidth: 160 }}>
              <label style={{ display: 'block', fontSize: 11, color: '#718096', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Number of Picks
              </label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                {[2, 3, 4, 5, 6, 8, 10, 15, 20, 25].map(n => (
                  <button key={n} onClick={() => setNumTeams(n)} style={{
                    padding: '7px 13px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer',
                    background: numTeams === n ? '#276749' : '#1a2030',
                    color: numTeams === n ? '#68d391' : '#718096',
                    border: `1px solid ${numTeams === n ? '#48bb78' : '#2d3748'}`,
                  }}>{n}</button>
                ))}
              </div>
              <input
                type="number" min={1} max={20} value={numTeams}
                onChange={e => setNumTeams(Math.min(25, Math.max(1, parseInt(e.target.value, 10) || 1)))}
                style={{
                  width: '100%', boxSizing: 'border-box', background: '#0a0e1a',
                  border: '1px solid #2d3748', color: '#e2e8f0', borderRadius: 6,
                  padding: '7px 10px', fontSize: 13,
                }}
                placeholder="Custom (1–25)"
              />
            </div>

            {/* Fixture window */}
            <div style={{ flex: 1, minWidth: 160 }}>
              <label style={{ display: 'block', fontSize: 11, color: '#718096', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Fixture Window
              </label>

              {/* Mode toggle */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                {[['quick', 'Quick pick'], ['pick', 'Date picker']].map(([mode, label]) => (
                  <button key={mode} onClick={() => setDateMode(mode)} style={{
                    flex: 1, padding: '6px 10px', borderRadius: 7, fontSize: 12, cursor: 'pointer',
                    background: dateMode === mode ? '#1a2a4a' : '#1a2030',
                    color: dateMode === mode ? '#90cdf4' : '#718096',
                    border: `1px solid ${dateMode === mode ? '#2b6cb0' : '#2d3748'}`,
                    fontWeight: dateMode === mode ? 700 : 400,
                  }}>{label}</button>
                ))}
              </div>

              {/* Quick shortcuts */}
              {dateMode === 'quick' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {Object.entries(DURATION_LABELS).map(([key, label]) => (
                    <button key={key} onClick={() => setDuration(key)} style={{
                      padding: '8px 14px', borderRadius: 8, fontSize: 13, cursor: 'pointer', textAlign: 'left',
                      background: duration === key ? '#1a2a4a' : '#1a2030',
                      color: duration === key ? '#90cdf4' : '#718096',
                      border: `1px solid ${duration === key ? '#2b6cb0' : '#2d3748'}`,
                      fontWeight: duration === key ? 700 : 400,
                    }}>{label}</button>
                  ))}
                </div>
              )}

              {/* Date picker */}
              {dateMode === 'pick' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 10, color: '#718096', marginBottom: 4 }}>From</div>
                    <input
                      type="date"
                      value={fromDate}
                      onChange={e => {
                        setFromDate(e.target.value)
                        if (e.target.value > toDate) setToDate(e.target.value)
                      }}
                      style={{
                        width: '100%', boxSizing: 'border-box', background: '#0a0e1a',
                        border: '1px solid #2b6cb0', color: '#e2e8f0', borderRadius: 6,
                        padding: '8px 10px', fontSize: 13, cursor: 'pointer',
                      }}
                    />
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: '#718096', marginBottom: 4 }}>To (optional)</div>
                    <input
                      type="date"
                      value={toDate}
                      min={fromDate}
                      onChange={e => setToDate(e.target.value)}
                      style={{
                        width: '100%', boxSizing: 'border-box', background: '#0a0e1a',
                        border: '1px solid #2b6cb0', color: '#e2e8f0', borderRadius: 6,
                        padding: '8px 10px', fontSize: 13, cursor: 'pointer',
                      }}
                    />
                  </div>
                  {fromDate === toDate && (
                    <div style={{ fontSize: 11, color: '#718096' }}>Single day selected</div>
                  )}
                  {fromDate && toDate && fromDate !== toDate && (
                    <div style={{ fontSize: 11, color: '#90cdf4' }}>
                      {fromDate} → {toDate}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Risk level — multi-select */}
          <div>
            <label style={{ display: 'block', fontSize: 11, color: '#718096', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Risk Level <span style={{ color: '#4a5568', textTransform: 'none', fontWeight: 400 }}>(select one or more)</span>
            </label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {RISK_OPTIONS.map(r => {
                const active = risks.includes(r.key)
                return (
                  <button key={r.key} onClick={() => toggleRisk(r.key)} style={{
                    flex: 1, minWidth: 130, padding: '10px 14px', borderRadius: 10, cursor: 'pointer',
                    background: active ? r.activeBg : r.bg,
                    border: `2px solid ${active ? r.color : r.border}`,
                    textAlign: 'left', position: 'relative',
                  }}>
                    {active && (
                      <span style={{
                        position: 'absolute', top: 7, right: 9, fontSize: 10,
                        color: r.color, fontWeight: 800,
                      }}>✓</span>
                    )}
                    <div style={{ fontSize: 13, fontWeight: 700, color: r.color, marginBottom: 3 }}>
                      {r.emoji} {r.label}
                    </div>
                    <div style={{ fontSize: 11, color: active ? r.color : '#718096', lineHeight: 1.4 }}>
                      {r.desc}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          <button
            onClick={() => { setOffset(0); generate(0) }}
            disabled={loading}
            style={{
              padding: '13px 24px', borderRadius: 10, fontSize: 15, fontWeight: 800,
              cursor: loading ? 'not-allowed' : 'pointer',
              background: loading ? '#1a3a2a' : 'linear-gradient(135deg, #276749, #2f855a)',
              color: loading ? '#48bb78' : '#f0fff4',
              border: '1px solid #48bb78',
            }}
          >
            {loading ? 'Finding picks…' : `Generate ${numTeams}-Pick Accumulator (${risks.map(r => RISK_OPTIONS.find(o => o.key === r)?.emoji).join('')} ${risks.join('+').charAt(0).toUpperCase() + risks.join('+').slice(1)})`}
          </button>

          {loading && (
            <div style={{ fontSize: 12, color: '#718096', textAlign: 'center', lineHeight: 1.9 }}>
              Scanning fixtures for {dateMode === 'pick' ? (fromDate === toDate ? fromDate : `${fromDate} → ${toDate}`) : DURATION_LABELS[duration]?.toLowerCase()}…<br />
              <span style={{ color: '#4a5568' }}>Running Poisson + ELO models</span><br />
              <span style={{ color: '#4a5568' }}>Fetching live standings, form, injuries &amp; odds for top candidates</span><br />
              <span style={{ color: '#4a5568' }}>This takes 30–60s for new dates</span>
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div style={{ background: '#3a1a1a', border: '1px solid #742a2a', borderRadius: 10, padding: '14px 18px', marginBottom: 20, color: '#fc8181', fontSize: 13, lineHeight: 1.6 }}>
            {error}
          </div>
        )}

        {/* Results */}
        {result && (() => {
          const rKeys = Array.isArray(result.meta?.risk) ? result.meta.risk : [result.meta?.risk || 'low']
          // Banner uses the "loudest" selected risk for colour
          const rOpt = RISK_OPTIONS.find(r => r.key === (rKeys.includes('high') ? 'high' : rKeys.includes('medium') ? 'medium' : 'low'))
          return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* Combined odds banner */}
            <div style={{
              background: `linear-gradient(135deg, ${rOpt.bg}, #0a0e1a)`,
              border: `1px solid ${rOpt.border}`, borderRadius: 12, padding: '18px 20px',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              flexWrap: 'wrap', gap: 12,
            }}>
              <div>
                <div style={{ fontSize: 11, color: rOpt.color, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
                  {result.picks?.length}-Pick · {DURATION_LABELS[result.meta?.duration]} · {rKeys.map(k => RISK_OPTIONS.find(o => o.key === k)?.emoji + ' ' + RISK_OPTIONS.find(o => o.key === k)?.label).join(' + ')}
                </div>
                <div style={{ fontSize: 38, fontWeight: 900, color: rOpt.color, lineHeight: 1 }}>
                  {result.combinedOdds}x
                </div>
                <div style={{ fontSize: 11, color: rOpt.color, opacity: 0.7, marginTop: 4 }}>
                  {(result.meta?.total ?? result.meta?.passedGate) > numTeams
                    ? `Showing ${offset + 1}–${Math.min(offset + numTeams, result.meta.total ?? result.meta.passedGate)} of ${result.meta.total ?? result.meta.passedGate} qualifying picks`
                    : `${result.meta?.passedGate} of ${result.meta?.fixturesScanned} fixtures cleared the gate`}
                </div>
              </div>
              <div style={{ fontSize: 13, color: '#a0aec0', maxWidth: 300, lineHeight: 1.6 }}>
                {result.overview}
              </div>
            </div>

            {/* Staking tip */}
            {result.tip && (
              <div style={{ background: '#1a2a3a', border: '1px solid #2b4a6a', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#90cdf4' }}>
                💡 {result.tip}
              </div>
            )}

            {/* Section label */}
            <div style={{ fontSize: 11, color: '#718096', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 4 }}>
              Picks ranked by model score — click Analyse on each to run Claude
            </div>

            {/* Pick cards */}
            {(result.picks || []).map((pick, i) => (
              <PickCard key={`${offset}-${i}`} pick={pick} i={offset + i + 1} />
            ))}

            {/* Pagination */}
            {(result.meta?.total ?? result.meta?.passedGate) > numTeams && (() => {
              const total    = result.meta.total ?? result.meta.passedGate
              const pageSize = result.meta.pageSize ?? numTeams
              const from     = offset + 1
              const to       = Math.min(offset + pageSize, total)
              const hasPrev  = offset > 0
              const hasNext  = offset + pageSize < total
              return (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '4px 0' }}>
                  <button onClick={() => generate(Math.max(0, offset - pageSize))} disabled={!hasPrev || loading}
                    style={{ padding: '9px 18px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: hasPrev && !loading ? 'pointer' : 'not-allowed',
                      background: hasPrev ? '#1a2a4a' : '#1a2030', color: hasPrev ? '#90cdf4' : '#4a5568', border: `1px solid ${hasPrev ? '#2b6cb0' : '#2d3748'}` }}>
                    ← Prev {pageSize}
                  </button>
                  <span style={{ fontSize: 12, color: '#718096' }}>
                    Showing <b style={{ color: '#e2e8f0' }}>{from}–{to}</b> of <b style={{ color: '#e2e8f0' }}>{total}</b> qualifying picks
                  </span>
                  <button onClick={() => generate(offset + pageSize)} disabled={!hasNext || loading}
                    style={{ padding: '9px 18px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: hasNext && !loading ? 'pointer' : 'not-allowed',
                      background: hasNext ? '#1a2a4a' : '#1a2030', color: hasNext ? '#90cdf4' : '#4a5568', border: `1px solid ${hasNext ? '#2b6cb0' : '#2d3748'}` }}>
                    Next {Math.min(pageSize, total - offset - pageSize)} →
                  </button>
                </div>
              )
            })()}

            {/* Quick reference strip */}
            <div style={{
              background: '#111827', border: '1px solid #1f2937', borderRadius: 10,
              padding: '12px 16px', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center',
            }}>
              <span style={{ fontSize: 11, color: '#718096' }}>Summary:</span>
              {(result.picks || []).map((p, i) => (
                <span key={i} style={{
                  fontSize: 11, background: '#0a0e1a', border: '1px solid #2d3748',
                  borderRadius: 6, padding: '4px 10px', color: '#a0aec0',
                }}>
                  <b style={{ color: '#e2e8f0' }}>{p.match?.split(' v ')[0]}</b>
                  {' '}{p.selection}
                  {' '}<span style={{ color: '#ecc94b' }}>@{p.odds}</span>
                </span>
              ))}
            </div>
          </div>
          )
        })()}
      </div>
    </div>
  )
}
