import { useState } from 'react'
import { Link } from 'react-router-dom'

const CONF_COLOR = { High: '#68d391', Medium: '#f6e05e', Low: '#fc8181' }
const VERDICT_COLOR = (v) =>
  v?.includes('Home') ? '#68d391' : v?.includes('Away') ? '#63b3ed' : '#f6e05e'

function pct(n) { return n != null ? (n * 100).toFixed(0) + '%' : '—' }

function VerdictPill({ verdict, confidence }) {
  if (!verdict) return null
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '5px',
      background: '#2d3748', borderRadius: '20px', padding: '3px 10px'
    }}>
      <span style={{ fontSize: '0.78rem', fontWeight: 700, color: VERDICT_COLOR(verdict) }}>{verdict}</span>
      {confidence && (
        <span style={{
          fontSize: '0.6rem', fontWeight: 700, color: CONF_COLOR[confidence] ?? '#a0aec0',
          background: '#1a1f2e', borderRadius: '10px', padding: '1px 6px'
        }}>{confidence}</span>
      )}
    </span>
  )
}

function OUStrip({ ou }) {
  if (!ou) return null
  const markets = [
    { label: 'O1.5', val: ou.over15 },
    { label: 'O2.5', val: ou.over25 },
    { label: 'O3.5', val: ou.over35 },
  ]
  return (
    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
      {markets.map(({ label, val }) => {
        const p = val != null ? Math.round(val * 100) : null
        if (p == null) return null
        const hot = p >= 60
        return (
          <span key={label} style={{
            fontSize: '0.68rem', fontWeight: 600, padding: '2px 7px', borderRadius: '4px',
            background: hot ? '#1c4532' : '#2d3748',
            color: hot ? '#68d391' : '#718096'
          }}>{label} {p}%</span>
        )
      })}
    </div>
  )
}

export default function PredictionCard({ fixture, prediction, onPredict, computing }) {
  const [expanded, setExpanded] = useState(false)

  const blended    = prediction?.blended ?? null
  const activeData = prediction
    ? (blended || (prediction.activeMode === 'B' ? prediction.modeB : prediction.modeA))
    : null
  const isBlended = !!blended
  const claude = prediction?.claudeAnalysis ?? null
  const news   = prediction?.newsAnalysis ?? null

  const date = new Date(fixture.date).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
  })

  // Model top pick
  let modelVerdict = null, modelProb = null
  if (activeData?.result1X2) {
    const { home, draw, away } = activeData.result1X2
    if (home >= draw && home >= away) { modelVerdict = 'Home Win'; modelProb = home }
    else if (away >= draw)            { modelVerdict = 'Away Win'; modelProb = away }
    else                               { modelVerdict = 'Draw';     modelProb = draw }
  }

  // Approximate risk tier based on best calibrated probability across all markets.
  // Full gate (Claude confidence, enrichment checks) only runs in Bet Builder —
  // this is a quick visual signal based on probability thresholds alone.
  function computeTier(pred) {
    // Use match favouriteness (top 1X2 prob) to determine tier — same logic as the backend.
    // DC/O1.5 can't be used here because they're always ≥ 0.65 for every match.
    const b = (pred?.blended?.result1X2 ? pred.blended : null) || pred?.modeB || pred?.modeA
    if (!b?.result1X2) return null
    const r = b.result1X2
    const fav = Math.max(r.home ?? 0, r.draw ?? 0, r.away ?? 0)
    if (fav >= 0.56) return 'low'
    if (fav >= 0.42) return 'medium'
    if (fav >= 0.33) return 'high'
    return null
  }
  const tier = computeTier(prediction)

  const TIER_STYLE = {
    low:    { label: '🛡 LOW',  color: '#68d391', bg: '#0f2a1a', border: '#276749' },
    medium: { label: '⚖ MED',  color: '#ecc94b', bg: '#2a2510', border: '#744210' },
    high:   { label: '🔥 HIGH', color: '#fc8181', bg: '#2a0f0f', border: '#742a2a' },
  }

  const borderColor = claude
    ? (CONF_COLOR[claude.confidence] ?? '#2d3748')
    : '#2d3748'

  return (
    <div style={{
      background: '#1a1f2e', border: `1px solid ${claude ? borderColor + '55' : '#2d3748'}`,
      borderRadius: '12px', marginBottom: '0.75rem', overflow: 'hidden'
    }}>

      {/* ── Header ── */}
      <div style={{ padding: '0.875rem 1.25rem 0.6rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: '0.92rem', fontWeight: 700, color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {fixture.homeTeamName} <span style={{ color: '#4a5568' }}>vs</span> {fixture.awayTeamName}
              {tier && (
                <span title={`Model probability qualifies as ${tier.toUpperCase()} risk in Bet Builder`} style={{
                  fontSize: '0.6rem', fontWeight: 800, padding: '2px 6px', borderRadius: 4,
                  background: TIER_STYLE[tier].bg, color: TIER_STYLE[tier].color,
                  border: `1px solid ${TIER_STYLE[tier].border}`
                }}>
                  {TIER_STYLE[tier].label}
                </span>
              )}
            </div>
            <div style={{ fontSize: '0.7rem', color: '#718096', marginTop: '2px' }}>{fixture.league} · {date}</div>
          </div>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            {onPredict && (
              <button onClick={onPredict} disabled={computing} style={{
                background: computing ? '#2d3748' : prediction ? '#2d3748' : '#276749',
                color: computing ? '#718096' : '#a0aec0',
                border: 'none', borderRadius: '6px', padding: '4px 10px',
                cursor: computing ? 'default' : 'pointer', fontSize: '0.72rem', fontWeight: 600
              }}>
                {computing ? 'Computing…' : prediction ? 'Re-run' : 'Predict'}
              </button>
            )}
            <Link to={`/match/${fixture._id}`} style={{ fontSize: '0.72rem', color: '#68d391', textDecoration: 'none' }}>
              Details →
            </Link>
          </div>
        </div>
      </div>

      {/* ── Prediction panel ── */}
      {activeData ? (
        <>
          <div style={{ display: 'flex', gap: '0', borderTop: '1px solid #2d3748' }}>

            {/* Model column */}
            <div style={{ flex: 1, padding: '0.75rem 1.25rem', borderRight: '1px solid #2d3748', minWidth: 0 }}>
              <div style={{ fontSize: '0.6rem', color: '#718096', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px', display: 'flex', gap: '6px', alignItems: 'center' }}>
                {isBlended ? 'Blended' : `Model · Mode ${prediction.activeMode}`}
                {isBlended && blended.bookmaker && (
                  <span style={{ color: '#553c9a', fontSize: '0.58rem' }}>+ {blended.bookmaker}</span>
                )}
              </div>
              <VerdictPill verdict={modelVerdict} />
              {modelProb != null && (
                <div style={{ fontSize: '0.72rem', color: '#718096', marginTop: '4px' }}>{pct(modelProb)} probability</div>
              )}
              <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                {[
                  { label: fixture.homeTeamName, val: activeData.result1X2.home, key: 'home' },
                  { label: 'Draw',               val: activeData.result1X2.draw, key: 'draw' },
                  { label: fixture.awayTeamName, val: activeData.result1X2.away, key: 'away' },
                ].map(({ label, val, key }) => {
                  const barColor = key === 'home' ? '#276749' : key === 'away' ? '#2b6cb0' : '#744210'
                  const isTop = (
                    (key === 'home' && modelVerdict === 'Home Win') ||
                    (key === 'draw' && modelVerdict === 'Draw') ||
                    (key === 'away' && modelVerdict === 'Away Win')
                  )
                  return (
                    <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontSize: '0.65rem', color: isTop ? '#e2e8f0' : '#718096', width: '90px', flexShrink: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {label}
                      </span>
                      <div style={{ flex: 1, height: '5px', background: '#2d3748', borderRadius: '3px', overflow: 'hidden' }}>
                        <div style={{ width: pct(val), height: '100%', background: isTop ? barColor : '#4a5568', borderRadius: '3px', transition: 'width 0.4s' }} />
                      </div>
                      <span style={{ fontSize: '0.65rem', color: isTop ? '#e2e8f0' : '#718096', width: '32px', textAlign: 'right' }}>{pct(val)}</span>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Claude column */}
            <div style={{ flex: 1, padding: '0.75rem 1.25rem', minWidth: 0 }}>
              <div style={{ fontSize: '0.6rem', color: '#718096', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>
                Claude AI
              </div>
              {claude ? (
                <>
                  <VerdictPill verdict={claude.verdict} confidence={claude.confidence} />
                  {claude.predictedScore && (
                    <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#e2e8f0', marginTop: '5px' }}>
                      {claude.predictedScore}
                      {claude.htPredictedScore && (
                        <span style={{ fontSize: '0.65rem', fontWeight: 400, color: '#718096', marginLeft: '6px' }}>
                          (HT {claude.htPredictedScore})
                        </span>
                      )}
                    </div>
                  )}
                  {claude.bestBet && (
                    <div style={{ fontSize: '0.7rem', color: '#bee3f8', marginTop: '5px', lineHeight: 1.3 }}>
                      Best bet: {claude.bestBet}
                    </div>
                  )}
                  {claude.oddsAlignment && claude.oddsAlignment !== 'N/A' && (
                    <div style={{ marginTop: '4px', fontSize: '0.65rem', color: claude.oddsAlignment === 'Agree' ? '#68d391' : '#f6e05e' }}>
                      Odds: {claude.oddsAlignment} {claude.oddsAlignment === 'Disagree' ? '⚠' : '✓'}
                    </div>
                  )}
                  {news && (
                    <div style={{ marginTop: '4px', fontSize: '0.68rem', color: news.agreesWithModel ? '#68d391' : '#fc8181' }}>
                      {news.agreesWithModel ? '↑ News confirms' : '↓ News conflicts'} · {news.mediaSentiment}
                    </div>
                  )}
                </>
              ) : (
                <div style={{ fontSize: '0.75rem', color: '#4a5568', marginTop: '4px' }}>
                  {prediction ? 'No Claude analysis — re-run with API key' : '—'}
                </div>
              )}
            </div>
          </div>

          {/* O/U strip + expand toggle */}
          <div style={{
            borderTop: '1px solid #2d3748', padding: '0.5rem 1.25rem',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap'
          }}>
            <OUStrip ou={activeData.overUnder} />
            <button onClick={() => setExpanded(e => !e)} style={{
              background: 'none', border: 'none', color: '#4a5568',
              fontSize: '0.68rem', cursor: 'pointer', padding: 0
            }}>
              {expanded ? 'Hide ▲' : 'More ▼'}
            </button>
          </div>

          {/* Expanded: blended breakdown + double chance + HT + analysis */}
          {expanded && (
            <div style={{ borderTop: '1px solid #2d3748', padding: '0.75rem 1.25rem' }}>

              {/* Blended component comparison */}
              {isBlended && blended.result1X2 && (
                <div style={{ marginBottom: '1rem' }}>
                  <div style={{ fontSize: '0.6rem', color: '#718096', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: '6px' }}>
                    Blend breakdown
                    {blended.weights && (
                      <span style={{ marginLeft: 6, color: '#4a5568' }}>
                        Poisson {Math.round((blended.weights.poisson ?? 0) * 100)}% · ELO {Math.round((blended.weights.elo ?? 0) * 100)}% · Odds {Math.round((blended.weights.odds ?? 0) * 100)}%
                      </span>
                    )}
                  </div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ fontSize: '0.68rem', borderCollapse: 'collapse', width: '100%' }}>
                      <thead>
                        <tr>
                          {['', 'Poisson', 'ELO', blended.oddsProbs ? 'Odds' : null, blended.rawOdds ? 'Raw' : null, 'Blended'].filter(Boolean).map(h => (
                            <th key={h} style={{ color: h === 'Blended' ? '#68d391' : h === 'Odds' ? '#d6bcfa' : h === 'ELO' ? '#fbd38d' : '#718096', fontWeight: 600, padding: '3px 8px', textAlign: h === '' ? 'left' : 'right', borderBottom: '1px solid #2d3748' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {[['Home', 'home'], ['Draw', 'draw'], ['Away', 'away']].map(([label, key]) => (
                          <tr key={key}>
                            <td style={{ padding: '4px 8px', color: '#a0aec0' }}>{label}</td>
                            <td style={{ padding: '4px 8px', textAlign: 'right', color: '#bee3f8' }}>{pct(blended.poissonProbs?.[key])}</td>
                            <td style={{ padding: '4px 8px', textAlign: 'right', color: '#fbd38d' }}>{pct(blended.eloProbs?.[key])}</td>
                            {blended.oddsProbs && <td style={{ padding: '4px 8px', textAlign: 'right', color: '#d6bcfa' }}>{pct(blended.oddsProbs?.[key])}</td>}
                            {blended.rawOdds && <td style={{ padding: '4px 8px', textAlign: 'right', color: '#718096' }}>{blended.rawOdds?.[key]?.toFixed(2) ?? '—'}</td>}
                            <td style={{ padding: '4px 8px', textAlign: 'right', color: '#68d391', fontWeight: 700 }}>{pct(blended.result1X2?.[key])}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
                {activeData.doubleChance && (
                  <div>
                    <div style={{ fontSize: '0.6rem', color: '#718096', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: '5px' }}>Double Chance</div>
                    {[
                      { label: '1X', val: activeData.doubleChance.homeOrDraw },
                      { label: 'X2', val: activeData.doubleChance.awayOrDraw },
                      { label: '12', val: activeData.doubleChance.homeOrAway },
                    ].map(({ label, val }) => (
                      <div key={label} style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '3px' }}>
                        <span style={{ fontSize: '0.65rem', color: '#718096', width: '20px' }}>{label}</span>
                        <div style={{ width: '80px', height: '5px', background: '#2d3748', borderRadius: '3px', overflow: 'hidden' }}>
                          <div style={{ width: pct(val), height: '100%', background: val >= 0.6 ? '#744210' : '#4a5568', borderRadius: '3px' }} />
                        </div>
                        <span style={{ fontSize: '0.65rem', color: '#a0aec0' }}>{pct(val)}</span>
                      </div>
                    ))}
                  </div>
                )}
                {activeData.halfTime?.result1X2 && (
                  <div>
                    <div style={{ fontSize: '0.6rem', color: '#718096', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: '5px' }}>Half-Time</div>
                    {[
                      { label: 'HT Home', val: activeData.halfTime.result1X2.home },
                      { label: 'HT Draw', val: activeData.halfTime.result1X2.draw },
                      { label: 'HT Away', val: activeData.halfTime.result1X2.away },
                    ].map(({ label, val }) => (
                      <div key={label} style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '3px' }}>
                        <span style={{ fontSize: '0.65rem', color: '#718096', width: '50px' }}>{label}</span>
                        <div style={{ width: '80px', height: '5px', background: '#2d3748', borderRadius: '3px', overflow: 'hidden' }}>
                          <div style={{ width: pct(val), height: '100%', background: '#4a5568', borderRadius: '3px' }} />
                        </div>
                        <span style={{ fontSize: '0.65rem', color: '#a0aec0' }}>{pct(val)}</span>
                      </div>
                    ))}
                    <div style={{ display: 'flex', gap: '6px', marginTop: '5px' }}>
                      <span style={{ fontSize: '0.65rem', color: '#718096' }}>HT O0.5 {pct(activeData.halfTime.overUnder?.over05)}</span>
                      <span style={{ fontSize: '0.65rem', color: '#718096' }}>O1.5 {pct(activeData.halfTime.overUnder?.over15)}</span>
                    </div>
                  </div>
                )}
                {claude?.analysis && (
                  <div style={{ flex: 1, minWidth: '200px' }}>
                    <div style={{ fontSize: '0.6rem', color: '#718096', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: '5px' }}>Analysis</div>
                    <p style={{ fontSize: '0.72rem', color: '#a0aec0', lineHeight: 1.5, margin: 0 }}>{claude.analysis}</p>
                    {claude.oddsAlignmentNote && (
                      <p style={{ fontSize: '0.65rem', color: '#d6bcfa', marginTop: '4px', marginBottom: 0 }}>{claude.oddsAlignmentNote}</p>
                    )}
                    {claude.riskFactor && (
                      <p style={{ fontSize: '0.68rem', color: '#fc8181', marginTop: '4px', marginBottom: 0 }}>
                        Risk: {claude.riskFactor}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      ) : (
        <div style={{ padding: '1rem 1.25rem', borderTop: '1px solid #2d3748' }}>
          <p style={{ color: '#4a5568', fontSize: '0.82rem', margin: 0 }}>No prediction yet.</p>
        </div>
      )}
    </div>
  )
}
