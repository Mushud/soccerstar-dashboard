import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import axios from 'axios'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001'

const RISK_COLORS = {
  'Low Risk':    { bg: '#1a3a2a', border: '#48bb78', badge: '#276749', text: '#9ae6b4' },
  'Medium Risk': { bg: '#2d2a1a', border: '#ecc94b', badge: '#744210', text: '#fefcbf' },
  'High Risk':   { bg: '#3a1a1a', border: '#fc8181', badge: '#742a2a', text: '#fed7d7' },
}
const CONFIDENCE_COLOR = { High: '#68d391', Medium: '#ecc94b', Low: '#fc8181' }
const ALIGNMENT_STYLE = {
  agree:    { bg: '#1a3a2a', border: '#276749', icon: '✅', label: 'Model agrees',        color: '#68d391' },
  disagree: { bg: '#3a1a1a', border: '#742a2a', icon: '❌', label: 'Model disagrees',     color: '#fc8181' },
  no_data:  { bg: '#1e2230', border: '#2d3748', icon: '—',  label: 'No model data',       color: '#4a5568' },
}
const MATCH_REASON_LABEL = {
  no_fixture:    { icon: '🔍', text: 'Not in SoccerStar — run a prediction first', color: '#718096' },
  no_prediction: { icon: '⚙️', text: 'Fixture found but prediction not generated yet', color: '#ecc94b' },
}
const VERDICT_STYLE = {
  Keep:    { color: '#68d391', bg: '#1a3a2a' },
  Change:  { color: '#ecc94b', bg: '#2d2a1a' },
  Remove:  { color: '#fc8181', bg: '#3a1a1a' },
  Caution: { color: '#90cdf4', bg: '#1a2a3a' },
}
const CHANGE_LABEL = {
  odds_changed:      { icon: '📊', color: '#ecc94b', label: 'Odds changed' },
  selection_changed: { icon: '🔄', color: '#fc8181', label: 'Pick changed' },
  pick_added:        { icon: '➕', color: '#68d391', label: 'Pick added' },
  pick_removed:      { icon: '➖', color: '#fc8181', label: 'Pick removed' },
}

function timeAgo(dateStr) {
  if (!dateStr) return ''
  const diff = Date.now() - new Date(dateStr).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function PickCard({ p, i }) {
  const [open, setOpen] = useState(false)
  const al = ALIGNMENT_STYLE[p.modelAlignment] || ALIGNMENT_STYLE.no_data
  const vd = VERDICT_STYLE[p.verdict] || VERDICT_STYLE.Caution
  const md = p.modelDetail

  return (
    <div style={{ background: al.bg, border: `1px solid ${al.border}`, borderRadius: 8, overflow: 'hidden' }}>
      {/* Header row — always visible */}
      <div
        onClick={() => md && setOpen(o => !o)}
        style={{ padding: '11px 13px', cursor: md ? 'pointer' : 'default' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 5 }}>
          <span style={{ width: 20, height: 20, background: '#0f1520', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#718096', flexShrink: 0 }}>{i + 1}</span>
          <div style={{ flex: 1, minWidth: 130 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>{p.match}</span>
            <span style={{ fontSize: 12, color: '#718096', marginLeft: 8 }}>
              {p.slipPick} <span style={{ color: '#ecc94b' }}>@ {p.slipOdds}x</span>
              {p.modelProb && <span style={{ color: '#4a5568' }}> · model: {p.modelProb}</span>}
            </span>
          </div>
          <span style={{ fontSize: 10, color: al.color, background: '#0f1520', border: `1px solid ${al.border}`, padding: '2px 7px', borderRadius: 99 }}>{al.icon} {al.label}</span>
          <span style={{ fontSize: 11, fontWeight: 700, background: vd.bg, color: vd.color, padding: '2px 7px', borderRadius: 4 }}>{p.verdict}</span>
          {md && <span style={{ fontSize: 10, color: '#4a5568' }}>{open ? '▲' : '▼'} detail</span>}
        </div>
        <div style={{ paddingLeft: 28, fontSize: 12, color: '#a0aec0' }}>
          {p.suggestion}{p.reason && <span style={{ color: '#4a5568' }}> — {p.reason}</span>}
        </div>
        {p.matchReason && MATCH_REASON_LABEL[p.matchReason] && (
          <div style={{ paddingLeft: 28, marginTop: 3, fontSize: 11, color: MATCH_REASON_LABEL[p.matchReason].color }}>
            {MATCH_REASON_LABEL[p.matchReason].icon} {MATCH_REASON_LABEL[p.matchReason].text}
          </div>
        )}
        {p.dbMatch && p.dbMatch !== p.match && (
          <div style={{ paddingLeft: 28, marginTop: 2, fontSize: 10, color: '#4a5568' }}>matched as: {p.dbMatch}</div>
        )}
      </div>

      {/* Expanded Claude analysis detail */}
      {open && md && (
        <div style={{ borderTop: `1px solid ${al.border}`, background: 'rgba(0,0,0,0.3)', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Score + verdicts row */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {md.predictedScore && (
              <div style={{ background: '#1a1f2e', borderRadius: 6, padding: '6px 12px', textAlign: 'center' }}>
                <div style={{ fontSize: 9, color: '#4a5568', textTransform: 'uppercase' }}>Predicted score</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: '#ecc94b' }}>{md.predictedScore}</div>
              </div>
            )}
            {md.htPredictedScore && (
              <div style={{ background: '#1a1f2e', borderRadius: 6, padding: '6px 12px', textAlign: 'center' }}>
                <div style={{ fontSize: 9, color: '#4a5568', textTransform: 'uppercase' }}>HT score</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: '#90cdf4' }}>{md.htPredictedScore}</div>
              </div>
            )}
            {md.claudeVerdict && (
              <div style={{ background: '#1a1f2e', borderRadius: 6, padding: '6px 12px' }}>
                <div style={{ fontSize: 9, color: '#4a5568', textTransform: 'uppercase' }}>Our verdict</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#68d391' }}>{md.claudeVerdict} <span style={{ color: '#4a5568', fontWeight: 400 }}>({md.claudeConfidence})</span></div>
              </div>
            )}
            {md.riskFactor && (
              <div style={{ background: '#1a1f2e', borderRadius: 6, padding: '6px 12px' }}>
                <div style={{ fontSize: 9, color: '#4a5568', textTransform: 'uppercase' }}>Risk</div>
                <div style={{ fontSize: 12, color: '#fc8181' }}>{md.riskFactor}</div>
              </div>
            )}
          </div>

          {/* Best bet + value bet */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {(md.updatedBestBet || md.claudeBestBet) && (
              <div style={{ flex: 1, minWidth: 140, background: '#1a2a1a', border: '1px solid #276749', borderRadius: 6, padding: '8px 12px' }}>
                <div style={{ fontSize: 9, color: '#4a5568', textTransform: 'uppercase', marginBottom: 3 }}>Best Bet</div>
                <div style={{ fontSize: 12, color: '#68d391', fontWeight: 600 }}>{md.updatedBestBet || md.claudeBestBet}</div>
              </div>
            )}
            {md.claudeValueBet && (
              <div style={{ flex: 1, minWidth: 140, background: '#1a2630', border: '1px solid #2b4c7e', borderRadius: 6, padding: '8px 12px' }}>
                <div style={{ fontSize: 9, color: '#4a5568', textTransform: 'uppercase', marginBottom: 3 }}>Value Bet</div>
                <div style={{ fontSize: 12, color: '#90cdf4', fontWeight: 600 }}>{md.claudeValueBet}</div>
              </div>
            )}
          </div>

          {/* Full analysis text */}
          {md.analysis && (
            <div style={{ fontSize: 12, color: '#a0aec0', lineHeight: 1.7, borderLeft: '2px solid #4a5568', paddingLeft: 10 }}>
              {md.analysis}
            </div>
          )}

          {/* Key factors */}
          {md.keyFactors?.length > 0 && (
            <div>
              <div style={{ fontSize: 10, color: '#4a5568', textTransform: 'uppercase', marginBottom: 5 }}>Key Factors</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {md.keyFactors.map((f, fi) => (
                  <div key={fi} style={{ fontSize: 11, color: '#a0aec0', display: 'flex', gap: 6 }}>
                    <span style={{ color: '#4a5568', flexShrink: 0 }}>•</span>{f}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Form + injuries */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {md.formEdge && (
              <div style={{ flex: 1, minWidth: 160, background: '#1a1f2e', borderRadius: 6, padding: '8px 10px' }}>
                <div style={{ fontSize: 9, color: '#4a5568', textTransform: 'uppercase', marginBottom: 3 }}>Form Edge</div>
                <div style={{ fontSize: 11, color: '#cbd5e0' }}>{md.formEdge}</div>
              </div>
            )}
            {md.injuryImpact && (
              <div style={{ flex: 1, minWidth: 160, background: '#1a1f2e', borderRadius: 6, padding: '8px 10px' }}>
                <div style={{ fontSize: 9, color: '#4a5568', textTransform: 'uppercase', marginBottom: 3 }}>Injury Impact</div>
                <div style={{ fontSize: 11, color: '#cbd5e0' }}>{md.injuryImpact}</div>
              </div>
            )}
          </div>

          {/* Model agreement */}
          {md.modelAgreement && (
            <div style={{ fontSize: 11, color: '#718096', fontStyle: 'italic' }}>Models: {md.modelAgreement}</div>
          )}

          {/* News section */}
          {(md.newsVerdict || md.newsAnalysis) && (
            <div style={{ background: md.agreesWithModel ? '#1a2a1a' : '#2d1a1a', border: `1px solid ${md.agreesWithModel ? '#276749' : '#742a2a'}`, borderRadius: 6, padding: '10px 12px' }}>
              <div style={{ fontSize: 10, color: '#4a5568', textTransform: 'uppercase', marginBottom: 5 }}>
                📰 News {md.agreesWithModel ? '— agrees with model' : '— ⚠️ disagrees with model'}
                {md.confidenceShift && <span style={{ marginLeft: 8, color: '#ecc94b' }}>({md.confidenceShift})</span>}
              </div>
              {md.newsVerdict && <div style={{ fontSize: 12, fontWeight: 600, color: md.agreesWithModel ? '#68d391' : '#fc8181', marginBottom: 4 }}>{md.newsVerdict}</div>}
              {md.newsAnalysis && <div style={{ fontSize: 11, color: '#a0aec0', lineHeight: 1.6 }}>{md.newsAnalysis}</div>}
              {md.keyHeadlines?.length > 0 && (
                <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {md.keyHeadlines.map((h, hi) => (
                    <div key={hi} style={{ fontSize: 10, color: '#718096' }}>› {h}</div>
                  ))}
                </div>
              )}
              {md.updatedBestBet && md.updatedBestBet !== md.claudeBestBet && (
                <div style={{ marginTop: 6, fontSize: 11, color: '#ecc94b' }}>Updated best bet: <strong>{md.updatedBestBet}</strong></div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function BetSlipAnalyzer() {
  const [input, setInput]               = useState('')
  const [fetchState, setFetchState]     = useState('idle')
  const [analyzeState, setAnalyzeState] = useState('idle')
  const [slip, setSlip]                 = useState(null)
  const [analysis, setAnalysis]         = useState(null)
  const [fetchError, setFetchError]     = useState(null)
  const [analyzeError, setAnalyzeError] = useState(null)
  const [recentSlips, setRecentSlips]   = useState([])
  const [sidebarOpen, setSidebarOpen]   = useState(true)

  const loadRecent = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API}/api/betslip/recent`)
      setRecentSlips(data)
    } catch {}
  }, [])

  useEffect(() => { loadRecent() }, [loadRecent])

  async function handleFetch(overrideInput) {
    const val = (overrideInput || input).trim()
    if (!val) return
    setFetchState('loading')
    setAnalyzeState('idle')
    setSlip(null)
    setAnalysis(null)
    setFetchError(null)
    setAnalyzeError(null)
    try {
      const { data } = await axios.get(`${API}/api/betslip/fetch`, { params: { input: val } })
      setSlip(data)
      setFetchState('done')
      loadRecent()
    } catch (err) {
      setFetchError(err.response?.data?.error || err.message)
      setFetchState('error')
    }
  }

  // Load a saved slip from sidebar (shows stored analysis immediately, re-fetches live in background)
  async function loadSaved(shareCode) {
    setFetchState('loading')
    setAnalyzeState('idle')
    setSlip(null)
    setAnalysis(null)
    setFetchError(null)
    setAnalyzeError(null)
    setInput(shareCode)
    try {
      // Show saved data instantly
      const { data: saved } = await axios.get(`${API}/api/betslip/saved/${shareCode}`)
      const slipData = { shareCode: saved.shareCode, selections: saved.selections, totalOdds: saved.totalOdds, hasChanges: saved.hasChanges, lastChanges: saved.lastChanges, changedAt: saved.changedAt }
      setSlip(slipData)
      setFetchState('done')
      if (saved.overview) {
        setAnalysis({ overview: saved.overview, pickAnalysis: saved.pickAnalysis, strategies: saved.strategies, matchedCount: saved.matchedCount, totalSelections: saved.totalSelections })
        setAnalyzeState('done')
      }
      // Re-fetch live from Sportybet in background to check for changes
      handleFetch(shareCode)
    } catch (err) {
      setFetchError(err.response?.data?.error || err.message)
      setFetchState('error')
    }
  }

  async function runAnalysis(slipData) {
    const s = slipData || slip
    if (!s) return
    setAnalyzeState('loading')
    setAnalysis(null)
    setAnalyzeError(null)
    try {
      const { data } = await axios.post(`${API}/api/betslip/analyze`, {
        selections: s.selections,
        shareCode: s.shareCode,
      })
      setAnalysis(data)
      setAnalyzeState('done')
      loadRecent()
    } catch (err) {
      setAnalyzeError(err.response?.data?.error || err.message)
      setAnalyzeState('error')
    }
  }

  const verdictCounts = analysis?.pickAnalysis
    ? { Keep: 0, Change: 0, Remove: 0, Caution: 0, ...Object.fromEntries(Object.entries(analysis.pickAnalysis.reduce((a, p) => { a[p.verdict] = (a[p.verdict] || 0) + 1; return a }, {}))) }
    : null

  return (
    <div style={{ minHeight: '100vh', background: '#1a1f2e', color: '#e2e8f0', fontFamily: 'system-ui, sans-serif', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ background: '#0f1520', borderBottom: '1px solid #2d3748', padding: '13px 20px', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <Link to="/" style={{ color: '#63b3ed', textDecoration: 'none', fontSize: 13 }}>← Dashboard</Link>
        <div style={{ width: 1, height: 16, background: '#2d3748' }} />
        <h1 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>⚽ Bet Slip Analyzer</h1>
        <button onClick={() => setSidebarOpen(o => !o)} style={{ marginLeft: 'auto', background: sidebarOpen ? '#2d3748' : '#1a2a3a', border: '1px solid #4a5568', borderRadius: 6, color: '#a0aec0', padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}>
          {sidebarOpen ? '◀ History' : '▶ History'}
        </button>
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* Sidebar — recent slips */}
        {sidebarOpen && (
          <div style={{ width: 230, background: '#0f1520', borderRight: '1px solid #2d3748', overflowY: 'auto', flexShrink: 0, padding: '12px 0' }}>
            <div style={{ padding: '0 14px 10px', fontSize: 11, color: '#4a5568', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              Recent Slips
            </div>
            {recentSlips.length === 0 && (
              <div style={{ padding: '12px 14px', fontSize: 12, color: '#4a5568' }}>No saved slips yet.</div>
            )}
            {recentSlips.map(s => (
              <button
                key={s.shareCode}
                onClick={() => loadSaved(s.shareCode)}
                style={{
                  width: '100%', textAlign: 'left', background: slip?.shareCode === s.shareCode ? '#1a2a3a' : 'transparent',
                  border: 'none', borderLeft: slip?.shareCode === s.shareCode ? '3px solid #3182ce' : '3px solid transparent',
                  padding: '10px 14px', cursor: 'pointer', color: '#e2e8f0',
                  borderBottom: '1px solid #1a1f2e',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                  <code style={{ fontSize: 13, fontWeight: 700, color: '#90cdf4' }}>{s.shareCode}</code>
                  {s.hasChanges && (
                    <span style={{ fontSize: 9, background: '#742a2a', color: '#fc8181', padding: '1px 5px', borderRadius: 99, fontWeight: 700 }}>CHANGED</span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: '#718096' }}>{s.totalSelections || s.selections?.length || 0} picks · {s.totalOdds}x</div>
                <div style={{ fontSize: 10, color: '#4a5568', marginTop: 2 }}>
                  {s.analysedAt ? `Analysed ${timeAgo(s.analysedAt)}` : `Fetched ${timeAgo(s.lastFetchedAt)}`}
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Main content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 20px' }}>
          <div style={{ maxWidth: 900, margin: '0 auto' }}>

            {/* Input */}
            <div style={{ background: '#242938', borderRadius: 12, padding: 18, marginBottom: 22, border: '1px solid #2d3748' }}>
              <p style={{ margin: '0 0 10px', fontSize: 13, color: '#718096' }}>
                Paste a Sportybet share link or code — we'll fetch the slip, cross-check each pick against our model, and suggest changes.
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleFetch()}
                  placeholder="https://www.sportybet.com/?shareCode=B6REM6  or  B6REM6"
                  style={{ flex: 1, background: '#1a1f2e', border: '1px solid #4a5568', borderRadius: 8, color: '#e2e8f0', padding: '10px 13px', fontSize: 13, outline: 'none' }}
                />
                <button
                  onClick={() => handleFetch()}
                  disabled={fetchState === 'loading' || !input.trim()}
                  style={{ background: fetchState === 'loading' ? '#2d3748' : '#3182ce', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', fontSize: 13, fontWeight: 600, cursor: fetchState === 'loading' || !input.trim() ? 'not-allowed' : 'pointer', opacity: !input.trim() ? 0.5 : 1, whiteSpace: 'nowrap' }}
                >
                  {fetchState === 'loading' ? 'Fetching…' : 'Analyze Slip'}
                </button>
              </div>
            </div>

            {fetchError && (
              <div style={{ background: '#3a1a1a', border: '1px solid #742a2a', borderRadius: 9, padding: 14, color: '#fed7d7', marginBottom: 18, fontSize: 13 }}>
                <strong>Error:</strong> {fetchError}
              </div>
            )}

            {slip && (
              <>
                {/* Summary bar */}
                <div style={{ background: '#242938', borderRadius: 9, padding: '12px 16px', marginBottom: 18, border: '1px solid #2d3748', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <code style={{ background: '#1a1f2e', color: '#90cdf4', padding: '2px 8px', borderRadius: 4, fontSize: 13 }}>{slip.shareCode}</code>
                  <span style={{ color: '#2d3748' }}>|</span>
                  <span style={{ fontSize: 13, color: '#a0aec0' }}>{slip.selections.length} picks</span>
                  <span style={{ color: '#2d3748' }}>|</span>
                  <span style={{ fontSize: 13, color: '#a0aec0' }}>
                    Full combo: <strong style={{ color: '#ecc94b' }}>{slip.totalOdds}x</strong>
                  </span>
                  {analysis && (
                    <>
                      <span style={{ color: '#2d3748' }}>|</span>
                      <span style={{ fontSize: 12, color: '#718096' }}>{analysis.matchedCount}/{analysis.totalSelections} matched model</span>
                    </>
                  )}
                  {verdictCounts && (
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                      {Object.entries(verdictCounts).filter(([,v]) => v > 0).map(([k, v]) => (
                        <span key={k} style={{ fontSize: 11, fontWeight: 700, background: VERDICT_STYLE[k]?.bg, color: VERDICT_STYLE[k]?.color, padding: '2px 7px', borderRadius: 99 }}>{v} {k}</span>
                      ))}
                    </div>
                  )}
                  {analyzeState === 'error' && (
                    <button onClick={() => runAnalysis(null)} style={{ marginLeft: 'auto', background: '#1a2a3a', color: '#90cdf4', border: '1px solid #2b6cb0', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}>
                      Retry Analysis
                    </button>
                  )}
                </div>

                {/* Change banner */}
                {slip.hasChanges && slip.lastChanges?.length > 0 && (
                  <div style={{ background: '#2d2000', border: '1px solid #744210', borderRadius: 9, padding: '12px 16px', marginBottom: 18 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#ecc94b', marginBottom: 8 }}>
                      ⚠️ Slip updated since last saved {slip.changedAt ? `(${timeAgo(slip.changedAt)})` : ''}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                      {slip.lastChanges.map((c, i) => {
                        const cs = CHANGE_LABEL[c.type] || {}
                        return (
                          <div key={i} style={{ fontSize: 12, color: cs.color, display: 'flex', gap: 8, alignItems: 'center' }}>
                            <span>{cs.icon}</span>
                            <strong>{c.match}</strong>
                            <span style={{ color: '#718096' }}>—</span>
                            <span>{cs.label}{c.from && c.to ? `: ${c.from} → ${c.to}` : c.from ? ` (removed: ${c.from})` : c.to ? ` (added: ${c.to})` : ''}</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Slip table */}
                <details open={slip.selections.length <= 8} style={{ background: '#242938', borderRadius: 9, marginBottom: 24, border: '1px solid #2d3748', overflow: 'hidden' }}>
                  <summary style={{ padding: '12px 16px', cursor: 'pointer', fontSize: 13, color: '#a0aec0', userSelect: 'none', listStyle: 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 11, color: '#4a5568' }}>▼</span>
                    Original slip — {slip.selections.length} picks
                  </summary>
                  <div style={{ padding: '0 16px 12px' }}>
                    {slip.selections.map((s, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 0', borderBottom: i < slip.selections.length - 1 ? '1px solid #1a1f2e' : 'none', flexWrap: 'wrap' }}>
                        <span style={{ width: 20, height: 20, background: '#1a1f2e', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#718096', flexShrink: 0 }}>{i + 1}</span>
                        <div style={{ flex: 1, minWidth: 130 }}>
                          <div style={{ fontSize: 13, color: '#e2e8f0' }}>{s.match}</div>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 2 }}>
                            {s.league && <span style={{ fontSize: 10, color: '#4a5568' }}>{s.league}</span>}
                            {s.eventTime && (
                              <span style={{ fontSize: 10, color: '#718096' }}>
                                {new Date(s.eventTime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                                {' · '}
                                {new Date(s.eventTime).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                              </span>
                            )}
                          </div>
                        </div>
                        <span style={{ fontSize: 10, color: '#a0aec0', background: '#1a1f2e', padding: '1px 6px', borderRadius: 3 }}>{s.market}</span>
                        <span style={{ fontSize: 12, color: '#90cdf4', fontWeight: 600 }}>{s.selection}</span>
                        <span style={{ fontSize: 13, color: '#ecc94b', fontWeight: 700, minWidth: 36, textAlign: 'right' }}>{s.odds}x</span>
                        {s.probability > 0 && <span style={{ fontSize: 10, color: '#4a5568' }}>{(s.probability * 100).toFixed(0)}%</span>}
                      </div>
                    ))}
                  </div>
                </details>

                {/* Analyse button */}
                {analyzeState === 'idle' && (
                  <button
                    onClick={() => runAnalysis(null)}
                    style={{
                      width: '100%', marginBottom: 20, padding: '14px',
                      background: 'linear-gradient(135deg, #2b4c7e, #553c9a)',
                      border: '1px solid #553c9a', borderRadius: 10, color: '#e2e8f0',
                      fontSize: 15, fontWeight: 700, cursor: 'pointer', letterSpacing: '0.02em',
                    }}
                  >
                    🧠 Analyse with Claude
                  </button>
                )}

                {/* Analysis loading */}
                {analyzeState === 'loading' && (
                  <div style={{ background: '#242938', border: '1px solid #2d3748', borderRadius: 12, padding: 28, textAlign: 'center', color: '#a0aec0', marginBottom: 24 }}>
                    <div style={{ fontSize: 26, marginBottom: 8 }}>🧠</div>
                    <div style={{ fontSize: 14 }}>Cross-referencing {slip.selections.length} picks against SoccerStar model…</div>
                    <div style={{ fontSize: 11, color: '#4a5568', marginTop: 4 }}>~15 seconds</div>
                    <div style={{ marginTop: 14, height: 2, background: '#2d3748', borderRadius: 99, overflow: 'hidden' }}>
                      <div style={{ height: '100%', background: 'linear-gradient(90deg,#3182ce,#805ad5)', borderRadius: 99, animation: 'sweep 2s ease-in-out infinite', width: '50%' }} />
                    </div>
                  </div>
                )}

                {analyzeError && (
                  <div style={{ background: '#3a1a1a', border: '1px solid #742a2a', borderRadius: 9, padding: 13, color: '#fed7d7', marginBottom: 18, fontSize: 13 }}>
                    <strong>Analysis error:</strong> {analyzeError}
                  </div>
                )}

                {/* Overview */}
                {analysis?.overview && (
                  <div style={{ background: '#1e2636', border: '1px solid #2b4c7e', borderRadius: 9, padding: '13px 16px', marginBottom: 22, fontSize: 13, color: '#90cdf4', lineHeight: 1.7 }}>
                    {analysis.overview}
                  </div>
                )}

                {/* Pick-by-pick */}
                {analysis?.pickAnalysis?.length > 0 && (
                  <div style={{ marginBottom: 28 }}>
                    <h2 style={{ fontSize: 11, color: '#4a5568', margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Pick-by-Pick Analysis</h2>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                      {analysis.pickAnalysis.map((p, i) => (
                        <PickCard key={i} p={p} i={i} />
                      ))}
                    </div>
                  </div>
                )}

                {/* Strategy cards */}
                {analysis?.strategies?.length > 0 && (
                  <div>
                    <h2 style={{ fontSize: 11, color: '#4a5568', margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Suggested Bet Slips</h2>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
                      {analysis.strategies.map((s, idx) => {
                        const c = RISK_COLORS[s.riskLevel] || RISK_COLORS['Medium Risk']
                        return (
                          <div key={idx} style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 11, padding: 16, display: 'flex', flexDirection: 'column', gap: 11 }}>
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
                              <span style={{ fontSize: 22 }}>{s.emoji}</span>
                              <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0' }}>{s.type}</div>
                                <div style={{ display: 'flex', gap: 4, marginTop: 3, flexWrap: 'wrap' }}>
                                  <span style={{ fontSize: 9, fontWeight: 700, background: c.badge, color: c.text, padding: '2px 6px', borderRadius: 99, textTransform: 'uppercase' }}>{s.riskLevel}</span>
                                  <span style={{ fontSize: 9, fontWeight: 700, background: '#1a2a1a', color: '#68d391', padding: '2px 6px', borderRadius: 99, textTransform: 'uppercase' }}>{s.rewardLevel}</span>
                                </div>
                              </div>
                              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                <div style={{ fontSize: 9, color: '#718096' }}>{s.selections?.length} legs</div>
                                <div style={{ fontSize: 20, fontWeight: 800, color: '#ecc94b', lineHeight: 1.1 }}>{s.combinedOdds}x</div>
                              </div>
                            </div>

                            <p style={{ margin: 0, fontSize: 11, color: '#a0aec0', lineHeight: 1.5, borderLeft: `2px solid ${c.border}`, paddingLeft: 8 }}>{s.rationale}</p>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                              {s.selections?.map((sel, si) => (
                                <div key={si} style={{ background: 'rgba(0,0,0,0.3)', borderRadius: 6, padding: '8px 10px' }}>
                                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7, marginBottom: 3 }}>
                                    <div style={{ flex: 1 }}>
                                      <div style={{ fontSize: 11, color: '#e2e8f0', fontWeight: 600, lineHeight: 1.3 }}>{sel.match}</div>
                                      {sel.league && <div style={{ fontSize: 9, color: '#4a5568' }}>{sel.league}</div>}
                                    </div>
                                    <span style={{ fontSize: 13, fontWeight: 800, color: '#ecc94b', flexShrink: 0 }}>{sel.odds}x</span>
                                  </div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                                    <span style={{ fontSize: 9, color: '#718096', background: 'rgba(255,255,255,0.04)', padding: '1px 4px', borderRadius: 3 }}>{sel.market}</span>
                                    <span style={{ fontSize: 11, color: '#90cdf4', fontWeight: 600 }}>→ {sel.pick}</span>
                                    {sel.modelProb && <span style={{ fontSize: 9, color: '#4a5568' }}>model: {sel.modelProb}</span>}
                                    <span style={{ marginLeft: 'auto', fontSize: 9, fontWeight: 700, color: CONFIDENCE_COLOR[sel.confidence] || '#a0aec0' }}>{sel.confidence}</span>
                                  </div>
                                  {sel.note && <div style={{ marginTop: 2, fontSize: 9, color: '#4a5568', fontStyle: 'italic' }}>{sel.note}</div>}
                                </div>
                              ))}
                            </div>

                            <div style={{ borderTop: `1px solid ${c.border}`, paddingTop: 9, fontSize: 11, color: c.text, fontStyle: 'italic', lineHeight: 1.4 }}>{s.summary}</div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                <p style={{ marginTop: 22, fontSize: 10, color: '#2d3748', textAlign: 'center' }}>⚠️ AI suggestions only. Bet responsibly.</p>
              </>
            )}

            {!slip && fetchState === 'idle' && (
              <div style={{ textAlign: 'center', padding: '60px 20px', color: '#4a5568' }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>⚽</div>
                <div style={{ fontSize: 14 }}>Paste a Sportybet share link above to get started</div>
                {recentSlips.length > 0 && <div style={{ fontSize: 12, marginTop: 8 }}>or pick a recent slip from the sidebar</div>}
              </div>
            )}
          </div>
        </div>
      </div>

      <style>{`@keyframes sweep{0%{width:15%;margin-left:0}50%{width:50%;margin-left:25%}100%{width:15%;margin-left:85%}}`}</style>
    </div>
  )
}
