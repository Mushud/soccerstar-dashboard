import { useState, useEffect, useCallback } from 'react'
import api, { API_BASE } from '../api'
import AppShell from '../components/AppShell'


const RISK_TONE = { 'Low Risk': 'pos', 'Medium Risk': 'warn', 'High Risk': 'neg' }
const CONFIDENCE_TONE = { High: 'pos', Medium: 'warn', Low: 'neg' }
const ALIGNMENT = {
  agree:    { tone: 'pos',  icon: '✅', label: 'Model agrees' },
  disagree: { tone: 'neg',  icon: '❌', label: 'Model disagrees' },
  no_data:  { tone: null,   icon: '—',  label: 'No model data' },
}
const MATCH_REASON_LABEL = {
  no_fixture:    { icon: '🔍', text: 'Not in SoccerStar — run a prediction first', tone: 'tx-3' },
  no_prediction: { icon: '⚙️', text: 'Fixture found but prediction not generated yet', tone: 'warn' },
}
const VERDICT_TONE = { Keep: 'pos', Change: 'warn', Remove: 'neg', Caution: 'info' }
const CHANGE_LABEL = {
  odds_changed:      { icon: '📊', tone: 'warn', label: 'Odds changed' },
  selection_changed: { icon: '🔄', tone: 'neg',  label: 'Pick changed' },
  pick_added:        { icon: '➕', tone: 'pos',  label: 'Pick added' },
  pick_removed:      { icon: '➖', tone: 'neg',  label: 'Pick removed' },
}
const GRADE_TONE = { A: 'pos', B: 'pos', C: 'warn', D: 'warn' }

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

const pct = v => (v != null ? `${(v * 100).toFixed(0)}%` : null)

/** A small labelled figure — used across the model-probability block. */
function Fig({ label, value, tone }) {
  if (value == null) return null
  return (
    <div style={{ textAlign: 'center', minWidth: 34 }}>
      <div className="muted2" style={{ fontSize: 9.5 }}>{label}</div>
      <div className="num" style={{ fontSize: 15, fontWeight: 800, color: tone ? `var(--${tone})` : 'var(--tx-2)' }}>{value}</div>
    </div>
  )
}

function PickCard({ p, i, onPredictionGenerated }) {
  const [open, setOpen] = useState(false)
  const [generating, setGenerating] = useState(false)
  const al = ALIGNMENT[p.modelAlignment] || ALIGNMENT.no_data
  const vTone = VERDICT_TONE[p.verdict] || 'info'
  const md = p.modelDetail

  async function generatePrediction() {
    if (!p.fixtureId) return
    setGenerating(true)
    try {
      await api.post(`/api/betbuilder/rerun`, { fixtureIds: [p.fixtureId] })
      onPredictionGenerated?.()
    } catch (e) {
      console.error('Prediction generation failed', e)
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="card" style={{
      overflow: 'hidden',
      borderColor: al.tone ? `var(--${al.tone}-dim)` : 'var(--line)',
      background: al.tone ? `var(--${al.tone}-soft)` : 'var(--surface)',
    }}>
      {/* Header row — always visible */}
      <div onClick={() => md && setOpen(o => !o)} style={{ padding: '12px 14px', cursor: md ? 'pointer' : 'default' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
          <span style={{
            width: 21, height: 21, background: 'var(--bg)', borderRadius: '50%', flexShrink: 0,
            display: 'grid', placeItems: 'center', fontSize: 10, color: 'var(--tx-3)', fontWeight: 700,
          }}>{i + 1}</span>
          <div style={{ flex: 1, minWidth: 140 }}>
            <span style={{ fontSize: 13, fontWeight: 650 }}>{p.match}</span>
            <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>
              {p.slipPick} <span style={{ color: 'var(--warn)' }}>@ {p.slipOdds}x</span>
              {p.modelProb && <span className="muted2"> · model: {p.modelProb}</span>}
            </span>
          </div>
          <span className={`pill${al.tone ? ` pill-${al.tone}` : ''}`}>{al.icon} {al.label}</span>
          <span className={`pill pill-${vTone}`}>{p.verdict}</span>
          {p.pickRating != null && (() => {
            const r = p.pickRating
            const tone = r >= 8 ? 'pos' : r >= 6 ? 'warn' : r >= 4 ? 'warn' : 'neg'
            return <span className={`pill pill-${tone}`} title={`Pick strength: ${r}/10`}>{r}/10</span>
          })()}
          {md && <span className="muted2" style={{ fontSize: 10 }}>{open ? '▲' : '▼'} detail</span>}
        </div>

        <div style={{ paddingLeft: 29, fontSize: 12, color: 'var(--tx-2)', display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
          {p.suggestedMarket && p.verdict === 'Change' && (
            <span className="pill pill-warn">→ {p.suggestedMarket}</span>
          )}
          <span>{p.suggestion}</span>
          {p.reason && <span className="muted2">— {p.reason}</span>}
        </div>

        {p.matchReason && MATCH_REASON_LABEL[p.matchReason] && (
          <div style={{ paddingLeft: 29, marginTop: 5, fontSize: 11.5, color: `var(--${MATCH_REASON_LABEL[p.matchReason].tone})`, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {MATCH_REASON_LABEL[p.matchReason].icon} {MATCH_REASON_LABEL[p.matchReason].text}
            {p.matchReason === 'no_prediction' && p.fixtureId && (
              <button className="btn btn-sm btn-pos" disabled={generating}
                onClick={e => { e.stopPropagation(); generatePrediction() }}>
                {generating ? <><span className="spin" /> Generating…</> : '⚙️ Generate now'}
              </button>
            )}
          </div>
        )}
        {p.dbMatch && p.dbMatch !== p.match && (
          <div className="muted2" style={{ paddingLeft: 29, marginTop: 3, fontSize: 10 }}>matched as: {p.dbMatch}</div>
        )}
      </div>

      {/* Expanded detail panel */}
      {open && md && (
        <div style={{
          borderTop: `1px solid ${al.tone ? `var(--${al.tone}-dim)` : 'var(--line)'}`,
          background: 'rgba(0,0,0,0.28)', padding: '14px 16px',
          display: 'flex', flexDirection: 'column', gap: 14,
        }}>

          {/* Pick reasoning — always shown, this is WHY the verdict was given */}
          {p.reason && (
            <div style={{
              borderRadius: 'var(--r)', padding: '10px 13px',
              background: `var(--${vTone}-soft)`, border: `1px solid var(--${vTone}-dim)`,
            }}>
              <div className="eyebrow" style={{ marginBottom: 5 }}>
                {p.verdict === 'Change' ? '↻ Why change this pick' : p.verdict === 'Remove' ? '✕ Why remove this pick' : '✓ Why keep this pick'}
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--tx)', lineHeight: 1.6 }}>{p.reason}</div>
              {p.suggestion && p.suggestion !== p.reason && (
                <div style={{ marginTop: 7, fontSize: 11.5, color: 'var(--warn)', fontWeight: 600 }}>Suggestion: {p.suggestion}</div>
              )}
            </div>
          )}

          {/* Model probability breakdown */}
          {(md.blended?.result1X2 || md.poisson?.result1X2) && (() => {
            const r1x2 = md.blended?.result1X2 || md.poisson?.result1X2
            const ou   = md.blended?.overUnder  || md.poisson?.overUnder
            const btts = md.blended?.bothTeamsToScore ?? md.poisson?.bothTeamsToScore
            const tone = v => (v >= 0.5 ? 'pos' : v >= 0.35 ? 'warn' : 'neg')
            return (
              <div style={{ background: 'var(--surface)', borderRadius: 'var(--r)', padding: '12px 14px' }}>
                <div className="eyebrow" style={{ marginBottom: 10 }}>Model probabilities</div>
                <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                  {r1x2 && (
                    <div>
                      <div className="muted2" style={{ fontSize: 9.5, marginBottom: 4 }}>1X2</div>
                      <div style={{ display: 'flex', gap: 10 }}>
                        {[['H', r1x2.home], ['D', r1x2.draw], ['A', r1x2.away]].map(([lbl, v]) =>
                          v != null && <Fig key={lbl} label={lbl} value={pct(v)} tone={tone(v)} />)}
                      </div>
                    </div>
                  )}
                  {ou && (
                    <div>
                      <div className="muted2" style={{ fontSize: 9.5, marginBottom: 4 }}>Over/Under</div>
                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        <Fig label="O1.5" value={pct(ou.over15)} />
                        <Fig label="O2.5" value={pct(ou.over25)} />
                        <Fig label="O3.5" value={pct(ou.over35)} />
                      </div>
                    </div>
                  )}
                  {btts != null && (
                    <div>
                      <div className="muted2" style={{ fontSize: 9.5, marginBottom: 4 }}>BTTS</div>
                      <Fig label="Yes" value={pct(btts)} />
                    </div>
                  )}
                </div>

                {md.matchedProb != null && (
                  <div className="muted2" style={{ marginTop: 10, fontSize: 10.5 }}>
                    Model prob for your pick:{' '}
                    <span style={{ color: `var(--${tone(md.matchedProb)})`, fontWeight: 700 }}>{pct(md.matchedProb)}</span>
                    {md.confidence != null && <span style={{ marginLeft: 8 }}>Engine confidence: <span className="muted">{md.confidence}</span></span>}
                  </div>
                )}

                {/* Model vs the price actually offered. impliedProb is 1/odds, so it INCLUDES
                    the bookmaker's margin — the real hurdle, not the de-vigged fair figure. */}
                {md.edge != null && (() => {
                  const V = {
                    'value':             { label: 'Value',          tone: 'pos' },
                    'slight-value':      { label: 'Slight value',   tone: 'pos' },
                    'fair':              { label: 'Fair price',     tone: null },
                    'slight-overpriced': { label: 'Slightly short', tone: 'warn' },
                    'overpriced':        { label: 'Overpriced',     tone: 'neg' },
                  }[md.edgeVerdict] || { label: md.edgeVerdict, tone: null }
                  return (
                    <div style={{
                      marginTop: 10, padding: '8px 11px', borderRadius: 'var(--r)',
                      background: V.tone ? `var(--${V.tone}-soft)` : 'var(--surface-2)',
                      border: `1px solid ${V.tone ? `var(--${V.tone}-dim)` : 'var(--line)'}`,
                      display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', fontSize: 10.5,
                    }}>
                      <span className="eyebrow" style={{ color: V.tone ? `var(--${V.tone})` : 'var(--tx-2)' }}>{V.label}</span>
                      <span className="muted">model <strong style={{ color: 'var(--tx)' }}>{pct(md.matchedProb)}</strong></span>
                      <span className="muted">book implies <strong style={{ color: 'var(--tx)' }}>{pct(md.impliedProb)}</strong></span>
                      <span style={{ color: V.tone ? `var(--${V.tone})` : 'var(--tx-2)', fontWeight: 700 }}>
                        {md.edge >= 0 ? '+' : ''}{(md.edge * 100).toFixed(1)}pp edge
                      </span>
                      <span className="muted2">break-even {md.matchedProb > 0 ? (1 / md.matchedProb).toFixed(2) : '—'}</span>
                    </div>
                  )
                })()}
              </div>
            )
          })()}

          {/* Claude deep analysis */}
          {(md.claudeVerdict || md.predictedScore || md.analysis || md.keyFactors?.length > 0) && (
            <>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {md.predictedScore && (
                  <div style={{ background: 'var(--surface)', borderRadius: 'var(--r-sm)', padding: '7px 13px', textAlign: 'center' }}>
                    <div className="eyebrow">Predicted score</div>
                    <div className="num" style={{ fontSize: 19, fontWeight: 800, color: 'var(--warn)' }}>{md.predictedScore}</div>
                  </div>
                )}
                {md.htPredictedScore && (
                  <div style={{ background: 'var(--surface)', borderRadius: 'var(--r-sm)', padding: '7px 13px', textAlign: 'center' }}>
                    <div className="eyebrow">HT score</div>
                    <div className="num" style={{ fontSize: 19, fontWeight: 800, color: 'var(--info)' }}>{md.htPredictedScore}</div>
                  </div>
                )}
                {md.claudeVerdict && (
                  <div style={{ background: 'var(--surface)', borderRadius: 'var(--r-sm)', padding: '7px 13px' }}>
                    <div className="eyebrow">AI verdict</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--pos)' }}>
                      {md.claudeVerdict} <span className="muted2" style={{ fontWeight: 400 }}>({md.claudeConfidence})</span>
                    </div>
                  </div>
                )}
                {md.riskFactor && (
                  <div style={{ background: 'var(--surface)', borderRadius: 'var(--r-sm)', padding: '7px 13px' }}>
                    <div className="eyebrow">Risk</div>
                    <div style={{ fontSize: 12, color: 'var(--neg)' }}>{md.riskFactor}</div>
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {(md.updatedBestBet || md.claudeBestBet) && (
                  <div style={{ flex: 1, minWidth: 150, background: 'var(--pos-soft)', border: '1px solid var(--pos-dim)', borderRadius: 'var(--r-sm)', padding: '9px 12px' }}>
                    <div className="eyebrow" style={{ marginBottom: 3 }}>Best bet</div>
                    <div style={{ fontSize: 12, color: 'var(--pos)', fontWeight: 600 }}>{md.updatedBestBet || md.claudeBestBet}</div>
                  </div>
                )}
                {md.claudeValueBet && (
                  <div style={{ flex: 1, minWidth: 150, background: 'var(--info-soft)', border: '1px solid var(--info-dim)', borderRadius: 'var(--r-sm)', padding: '9px 12px' }}>
                    <div className="eyebrow" style={{ marginBottom: 3 }}>Value bet</div>
                    <div style={{ fontSize: 12, color: 'var(--info)', fontWeight: 600 }}>{md.claudeValueBet}</div>
                  </div>
                )}
              </div>

              {md.analysis && (
                <div style={{ fontSize: 12.5, color: 'var(--tx-2)', lineHeight: 1.7, borderLeft: '2px solid var(--line-strong)', paddingLeft: 12 }}>
                  {md.analysis}
                </div>
              )}

              {md.keyFactors?.length > 0 && (
                <div>
                  <div className="eyebrow" style={{ marginBottom: 6 }}>Key factors</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {md.keyFactors.map((f, fi) => (
                      <div key={fi} style={{ fontSize: 11.5, color: 'var(--tx-2)', display: 'flex', gap: 7 }}>
                        <span className="muted2" style={{ flexShrink: 0 }}>•</span>{f}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {md.formEdge && (
                  <div style={{ flex: 1, minWidth: 170, background: 'var(--surface)', borderRadius: 'var(--r-sm)', padding: '9px 11px' }}>
                    <div className="eyebrow" style={{ marginBottom: 3 }}>Form edge</div>
                    <div style={{ fontSize: 11.5, color: 'var(--tx-2)' }}>{md.formEdge}</div>
                  </div>
                )}
                {md.injuryImpact && (
                  <div style={{ flex: 1, minWidth: 170, background: 'var(--surface)', borderRadius: 'var(--r-sm)', padding: '9px 11px' }}>
                    <div className="eyebrow" style={{ marginBottom: 3 }}>Injury impact</div>
                    <div style={{ fontSize: 11.5, color: 'var(--tx-2)' }}>{md.injuryImpact}</div>
                  </div>
                )}
              </div>

              {md.modelAgreement && (
                <div className="muted" style={{ fontSize: 11.5, fontStyle: 'italic' }}>Models: {md.modelAgreement}</div>
              )}
            </>
          )}

          {/* News section */}
          {(md.newsVerdict || md.newsAnalysis) && (
            <div style={{
              background: md.agreesWithModel ? 'var(--pos-soft)' : 'var(--neg-soft)',
              border: `1px solid ${md.agreesWithModel ? 'var(--pos-dim)' : 'var(--neg-dim)'}`,
              borderRadius: 'var(--r-sm)', padding: '11px 13px',
            }}>
              <div className="eyebrow" style={{ marginBottom: 5 }}>
                📰 News {md.agreesWithModel ? '— agrees with model' : '— ⚠️ disagrees with model'}
                {md.confidenceShift && <span style={{ marginLeft: 8, color: 'var(--warn)' }}>({md.confidenceShift})</span>}
              </div>
              {md.newsVerdict && (
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 5, color: md.agreesWithModel ? 'var(--pos)' : 'var(--neg)' }}>
                  {md.newsVerdict}
                </div>
              )}
              {md.newsAnalysis && <div style={{ fontSize: 11.5, color: 'var(--tx-2)', lineHeight: 1.6 }}>{md.newsAnalysis}</div>}
              {md.keyHeadlines?.length > 0 && (
                <div style={{ marginTop: 7, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {md.keyHeadlines.map((h, hi) => <div key={hi} className="muted" style={{ fontSize: 10.5 }}>› {h}</div>)}
                </div>
              )}
              {md.updatedBestBet && md.updatedBestBet !== md.claudeBestBet && (
                <div style={{ marginTop: 7, fontSize: 11.5, color: 'var(--warn)' }}>Updated best bet: <strong>{md.updatedBestBet}</strong></div>
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
  const [analyzeProgress, setAnalyzeProgress] = useState(null)
  const [recentSlips, setRecentSlips]   = useState([])

  const loadRecent = useCallback(async () => {
    try {
      const { data } = await api.get(`/api/betslip/recent`)
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
      const { data } = await api.get(`/api/betslip/fetch`, { params: { input: val } })
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
      const { data: saved } = await api.get(`/api/betslip/saved/${shareCode}`)
      const slipData = { shareCode: saved.shareCode, selections: saved.selections, totalOdds: saved.totalOdds, hasChanges: saved.hasChanges, lastChanges: saved.lastChanges, changedAt: saved.changedAt }
      setSlip(slipData)
      setFetchState('done')
      if (saved.overview) {
        setAnalysis({ overview: saved.overview, slipScore: saved.slipScore, slipGrade: saved.slipGrade, slipVerdict: saved.slipVerdict, pickAnalysis: saved.pickAnalysis, strategies: saved.strategies, matchedCount: saved.matchedCount, totalSelections: saved.totalSelections })
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
      // SSE, not JSON: a 39-leg slip takes ~200s server-side and nginx closes idle
      // connections at 60s, so the single-response version only ever worked for small slips.
      const res = await fetch(`${API_BASE}/api/betslip/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selections: s.selections, shareCode: s.shareCode }),
      })
      if (!res.ok || !res.body) throw new Error(`Analysis failed (${res.status})`)

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
          if (evt.type === 'progress') setAnalyzeProgress(evt.message)
          else if (evt.type === 'done') result = evt.result
          else if (evt.type === 'error') throw new Error(evt.error)
        }
      }
      if (!result) throw new Error('Analysis ended without a result')

      setAnalysis(result)
      setAnalyzeState('done')
      setAnalyzeProgress(null)
      loadRecent()
    } catch (err) {
      setAnalyzeError(err.response?.data?.error || err.message)
      setAnalyzeProgress(null)
      setAnalyzeState('error')
    }
  }

  const verdictCounts = analysis?.pickAnalysis
    ? { Keep: 0, Change: 0, Remove: 0, Caution: 0, ...Object.fromEntries(Object.entries(analysis.pickAnalysis.reduce((a, p) => { a[p.verdict] = (a[p.verdict] || 0) + 1; return a }, {}))) }
    : null

  const grade = analysis?.slipGrade
  const gradeTone = grade ? (GRADE_TONE[grade] || 'neg') : null

  return (
    <AppShell
      title="Bet Slip Analyzer"
      subtitle="Cross-check a Sportybet slip against the model"
      actions={
        slip && analyzeState !== 'loading' ? (
          <button className="btn btn-sm btn-accent" onClick={() => runAnalysis(null)}>
            {analyzeState === 'done' ? 'Re-analyse' : '🧠 Analyse'}
          </button>
        ) : null
      }
    >
      <div className="slip-layout">
        <div style={{ minWidth: 0 }}>

          {/* Input */}
          <div className="card card-pad" style={{ marginBottom: 18 }}>
            <p className="muted" style={{ fontSize: 13, marginBottom: 12, lineHeight: 1.5 }}>
              Paste a Sportybet share link or code — we'll fetch the slip, cross-check each pick against
              our model, and suggest changes.
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input
                className="field"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleFetch()}
                placeholder="https://www.sportybet.com/?shareCode=B6REM6  or  B6REM6"
                style={{ flex: '1 1 240px' }}
              />
              <button className="btn btn-primary btn-lg" onClick={() => handleFetch()} disabled={fetchState === 'loading' || !input.trim()}>
                {fetchState === 'loading' ? <><span className="spin" /> Fetching…</> : 'Fetch slip'}
              </button>
            </div>
          </div>

          {fetchError && (
            <div className="card card-pad" style={{ borderColor: 'var(--neg-dim)', background: 'var(--neg-soft)', color: 'var(--neg)', marginBottom: 18, fontSize: 13 }}>
              <strong>Error:</strong> {fetchError}
            </div>
          )}

          {slip && (
            <>
              {/* Slip stat strip */}
              <div className="stat-grid" style={{ marginBottom: 16 }}>
                <div className="stat">
                  <div className="stat-label">Share code</div>
                  <div className="stat-value mono" style={{ fontSize: 20, color: 'var(--info)' }}>{slip.shareCode}</div>
                  <div className="stat-foot">{slip.selections.length} picks</div>
                </div>
                <div className="stat">
                  <div className="stat-label">Full combo</div>
                  <div className="stat-value num" style={{ color: 'var(--warn)' }}>{slip.totalOdds}x</div>
                  <div className="stat-foot">Every leg must land</div>
                </div>
                <div className="stat">
                  <div className="stat-label">Matched to model</div>
                  <div className="stat-value">
                    {analysis ? <>{analysis.matchedCount}<small>/{analysis.totalSelections}</small></> : '—'}
                  </div>
                  <div className="stat-foot">{analysis ? 'Legs the model can price' : 'Run the analysis'}</div>
                </div>
                <div className="stat" style={gradeTone ? { borderColor: `var(--${gradeTone}-dim)`, background: `var(--${gradeTone}-soft)` } : undefined}>
                  <div className="stat-label">Slip rating</div>
                  <div className="stat-value" style={{ color: gradeTone ? `var(--${gradeTone})` : undefined }}>
                    {grade || '—'}
                    {analysis?.slipScore != null && <small>{analysis.slipScore}/10</small>}
                  </div>
                  <div className="stat-foot" style={{ lineHeight: 1.4 }}>{analysis?.slipVerdict || 'Not analysed yet'}</div>
                </div>
              </div>

              {(verdictCounts || analyzeState === 'error') && (
                <div className="card card-pad toolbar" style={{ padding: '11px 16px', marginBottom: 16 }}>
                  {verdictCounts && Object.entries(verdictCounts).filter(([, v]) => v > 0).map(([k, v]) => (
                    <span key={k} className={`pill pill-${VERDICT_TONE[k] || 'info'}`}>{v} {k}</span>
                  ))}
                  {analyzeState === 'error' && (
                    <button className="btn btn-sm btn-info" onClick={() => runAnalysis(null)}>Retry analysis</button>
                  )}
                </div>
              )}

              {/* Change banner */}
              {slip.hasChanges && slip.lastChanges?.length > 0 && (
                <div className="card card-pad" style={{ borderColor: 'var(--warn-dim)', background: 'var(--warn-soft)', marginBottom: 18 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--warn)', marginBottom: 9 }}>
                    ⚠️ Slip updated since last saved {slip.changedAt ? `(${timeAgo(slip.changedAt)})` : ''}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {slip.lastChanges.map((c, i) => {
                      const cs = CHANGE_LABEL[c.type] || {}
                      return (
                        <div key={i} style={{ fontSize: 12, color: cs.tone ? `var(--${cs.tone})` : 'var(--tx-2)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                          <span>{cs.icon}</span>
                          <strong>{c.match}</strong>
                          <span className="muted2">—</span>
                          <span>{cs.label}{c.from && c.to ? `: ${c.from} → ${c.to}` : c.from ? ` (removed: ${c.from})` : c.to ? ` (added: ${c.to})` : ''}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Original slip */}
              <details open={slip.selections.length <= 8} className="card" style={{ marginBottom: 18, overflow: 'hidden' }}>
                <summary style={{ padding: '13px 16px', cursor: 'pointer', fontSize: 13, color: 'var(--tx-2)', userSelect: 'none', listStyle: 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="muted2" style={{ fontSize: 11 }}>▼</span>
                  Original slip — {slip.selections.length} picks
                </summary>
                <div style={{ padding: '0 16px 12px' }}>
                  {slip.selections.map((s, i) => (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', gap: 9, padding: '10px 0', flexWrap: 'wrap',
                      borderBottom: i < slip.selections.length - 1 ? '1px solid var(--line-soft)' : 'none',
                    }}>
                      <span style={{ width: 21, height: 21, background: 'var(--bg)', borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: 10, color: 'var(--tx-3)', flexShrink: 0 }}>{i + 1}</span>
                      <div style={{ flex: 1, minWidth: 140 }}>
                        <div style={{ fontSize: 13 }}>{s.match}</div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 2 }}>
                          {s.league && <span className="muted2" style={{ fontSize: 10 }}>{s.league}</span>}
                          {s.eventTime && (
                            <span className="muted" style={{ fontSize: 10 }}>
                              {new Date(s.eventTime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                              {' · '}
                              {new Date(s.eventTime).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                            </span>
                          )}
                        </div>
                      </div>
                      <span className="pill">{s.market}</span>
                      <span style={{ fontSize: 12, color: 'var(--info)', fontWeight: 600 }}>{s.selection}</span>
                      <span className="num" style={{ fontSize: 13, color: 'var(--warn)', fontWeight: 700, minWidth: 40, textAlign: 'right' }}>{s.odds}x</span>
                      {s.probability > 0 && <span className="muted2 num" style={{ fontSize: 10 }}>{(s.probability * 100).toFixed(0)}%</span>}
                    </div>
                  ))}
                </div>
              </details>

              {/* Analyse button */}
              {analyzeState === 'idle' && (
                <button className="btn btn-primary btn-lg btn-block" style={{ marginBottom: 20, padding: 14, fontSize: 15 }} onClick={() => runAnalysis(null)}>
                  🧠 Analyse with Claude
                </button>
              )}

              {/* Analysis loading */}
              {analyzeState === 'loading' && (
                <div className="card card-pad" style={{ padding: 30, textAlign: 'center', marginBottom: 22 }}>
                  <div style={{ fontSize: 28, marginBottom: 10 }}>🧠</div>
                  <div style={{ fontSize: 14 }}>Cross-referencing {slip.selections.length} picks against the SoccerStar model…</div>
                  <div className="muted2" style={{ fontSize: 11.5, marginTop: 5 }}>{analyzeProgress || '~15 seconds'}</div>
                  <div className="meter" style={{ marginTop: 16, height: 3 }}>
                    <i style={{ background: 'linear-gradient(90deg, var(--info), var(--accent))', animation: 'sweep 2s ease-in-out infinite', width: '50%' }} />
                  </div>
                </div>
              )}

              {analyzeError && (
                <div className="card card-pad" style={{ borderColor: 'var(--neg-dim)', background: 'var(--neg-soft)', color: 'var(--neg)', marginBottom: 18, fontSize: 13 }}>
                  <strong>Analysis error:</strong> {analyzeError}
                </div>
              )}

              {/* Overview */}
              {analysis?.overview && (
                <div className="hero card-pad" style={{ marginBottom: 22, fontSize: 13, color: 'var(--tx)', lineHeight: 1.7 }}>
                  {analysis.overview}
                </div>
              )}

              {/* Pick-by-pick */}
              {analysis?.pickAnalysis?.length > 0 && (
                <div style={{ marginBottom: 26 }}>
                  <div className="eyebrow" style={{ marginBottom: 11 }}>Pick-by-pick analysis</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {analysis.pickAnalysis.map((p, i) => (
                      <PickCard key={i} p={p} i={i} onPredictionGenerated={() => slip && runAnalysis(slip)} />
                    ))}
                  </div>
                </div>
              )}

              {/* Strategy cards */}
              {analysis?.strategies?.length > 0 && (
                <div>
                  <div className="eyebrow" style={{ marginBottom: 12 }}>Suggested bet slips</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
                    {analysis.strategies.map((s, idx) => {
                      const tone = RISK_TONE[s.riskLevel] || 'warn'
                      return (
                        <div key={idx} className="card" style={{
                          borderColor: `var(--${tone}-dim)`, background: `var(--${tone}-soft)`,
                          padding: 16, display: 'flex', flexDirection: 'column', gap: 12,
                        }}>
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                            <span style={{ fontSize: 22 }}>{s.emoji}</span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 14, fontWeight: 700 }}>{s.type}</div>
                              <div className="chip-row" style={{ marginTop: 4 }}>
                                <span className={`pill pill-${tone}`}>{s.riskLevel}</span>
                                <span className="pill pill-pos">{s.rewardLevel}</span>
                              </div>
                            </div>
                            <div style={{ textAlign: 'right', flexShrink: 0 }}>
                              <div className="muted" style={{ fontSize: 9.5 }}>{s.selections?.length} legs</div>
                              <div className="num" style={{ fontSize: 20, fontWeight: 800, color: 'var(--warn)', lineHeight: 1.15 }}>{s.combinedOdds}x</div>
                            </div>
                          </div>

                          <p style={{ fontSize: 11.5, color: 'var(--tx-2)', lineHeight: 1.55, borderLeft: `2px solid var(--${tone}-dim)`, paddingLeft: 9 }}>{s.rationale}</p>

                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {s.selections?.map((sel, si) => (
                              <div key={si} style={{ background: 'rgba(0,0,0,0.3)', borderRadius: 'var(--r-sm)', padding: '9px 11px' }}>
                                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}>
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 11.5, fontWeight: 600, lineHeight: 1.35 }}>{sel.match}</div>
                                    {sel.league && <div className="muted2" style={{ fontSize: 9.5 }}>{sel.league}</div>}
                                  </div>
                                  <span className="num" style={{ fontSize: 13, fontWeight: 800, color: 'var(--warn)', flexShrink: 0 }}>{sel.odds}x</span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                                  <span className="pill" style={{ fontSize: 9.5 }}>{sel.market}</span>
                                  <span style={{ fontSize: 11.5, color: 'var(--info)', fontWeight: 600 }}>→ {sel.pick}</span>
                                  {sel.modelProb && <span className="muted2" style={{ fontSize: 9.5 }}>model: {sel.modelProb}</span>}
                                  <span style={{ marginLeft: 'auto', fontSize: 9.5, fontWeight: 700, color: `var(--${CONFIDENCE_TONE[sel.confidence] || 'tx-2'})` }}>{sel.confidence}</span>
                                </div>
                                {sel.note && <div className="muted2" style={{ marginTop: 3, fontSize: 9.5, fontStyle: 'italic' }}>{sel.note}</div>}
                              </div>
                            ))}
                          </div>

                          <div style={{ borderTop: `1px solid var(--${tone}-dim)`, paddingTop: 10, fontSize: 11.5, color: `var(--${tone})`, fontStyle: 'italic', lineHeight: 1.45 }}>{s.summary}</div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              <p className="muted2" style={{ marginTop: 22, fontSize: 10.5, textAlign: 'center' }}>⚠️ AI suggestions only. Bet responsibly.</p>
            </>
          )}

          {!slip && fetchState === 'idle' && (
            <div className="card empty">
              <div className="empty-ico">🧾</div>
              <div className="empty-title">Paste a Sportybet share link to get started</div>
              <div className="empty-sub">
                {recentSlips.length > 0 ? 'Or reopen one of your recent slips.' : 'Your analysed slips are saved and listed here.'}
              </div>
            </div>
          )}
        </div>

        {/* History rail — a sticky column on wide screens, a swipe strip on narrow ones */}
        <aside className="card slip-history">
          <div className="card-head" style={{ padding: '11px 14px' }}>
            <span className="eyebrow">Recent slips</span>
            <span className="muted2" style={{ marginLeft: 'auto', fontSize: 10.5 }}>{recentSlips.length}</span>
          </div>
          {recentSlips.length === 0 ? (
            <div className="muted2" style={{ padding: '14px', fontSize: 12 }}>No saved slips yet.</div>
          ) : (
            <div className="slip-history-list">
              {recentSlips.map(s => (
                <button
                  key={s.shareCode}
                  onClick={() => loadSaved(s.shareCode)}
                  className={`slip-history-item${slip?.shareCode === s.shareCode ? ' on' : ''}`}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <code className="mono" style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--info)' }}>{s.shareCode}</code>
                    {s.hasChanges && <span className="pill pill-neg">CHANGED</span>}
                  </div>
                  <div className="muted" style={{ fontSize: 11 }}>
                    {s.totalSelections || s.selections?.length || 0} picks · {s.totalOdds}x
                  </div>
                  <div className="muted2" style={{ fontSize: 10, marginTop: 2 }}>
                    {s.analysedAt ? `Analysed ${timeAgo(s.analysedAt)}` : `Fetched ${timeAgo(s.lastFetchedAt)}`}
                  </div>
                </button>
              ))}
            </div>
          )}
        </aside>
      </div>
    </AppShell>
  )
}
