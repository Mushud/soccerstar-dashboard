import { useState } from 'react'
import { Link } from 'react-router-dom'

const CONF = { High: 'pos', Medium: 'warn', Low: 'neg' }
const VERDICT_TONE = v => (v?.includes('Home') ? 'pos' : v?.includes('Away') ? 'info' : 'warn')

function pct(n) { return n != null ? (n * 100).toFixed(0) + '%' : '—' }

function VerdictPill({ verdict, confidence }) {
  if (!verdict) return null
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <span className={`pill pill-${VERDICT_TONE(verdict)}`} style={{ fontSize: 11.5, padding: '3px 10px' }}>{verdict}</span>
      {confidence && <span className={`pill pill-${CONF[confidence] ?? ''}`}>{confidence}</span>}
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
    <div className="chip-row">
      {markets.map(({ label, val }) => {
        const p = val != null ? Math.round(val * 100) : null
        if (p == null) return null
        return (
          <span key={label} className={`pill${p >= 60 ? ' pill-pos' : ''}`}>{label} {p}%</span>
        )
      })}
    </div>
  )
}

/**
 * Quick visual risk signal from the favourite's probability alone. The full gate — Claude
 * confidence, enrichment checks — only runs in Bet Builder; DC and O1.5 can't be used here
 * because they sit above 0.65 for practically every match.
 */
function computeTier(pred) {
  const b = (pred?.blended?.result1X2 ? pred.blended : null) || pred?.modeB || pred?.modeA
  if (!b?.result1X2) return null
  const r = b.result1X2
  const fav = Math.max(r.home ?? 0, r.draw ?? 0, r.away ?? 0)
  if (fav >= 0.56) return 'low'
  if (fav >= 0.42) return 'medium'
  if (fav >= 0.33) return 'high'
  return null
}

const TIER = {
  low:    { label: '🛡 Low risk',  cls: 'pill-pos' },
  medium: { label: '⚖ Medium',    cls: 'pill-warn' },
  high:   { label: '🔥 High risk', cls: 'pill-neg' },
}

export default function PredictionCard({ fixture, prediction, onPredict, computing, flushTop, dense = false }) {
  // Two levels, because there are two useful amounts of detail. `expanded` opens the card body
  // (the model/Claude columns) — only meaningful in dense mode, where the body starts hidden.
  // `deep` opens the blend breakdown, double chance, half-time and full analysis under it.
  const [expanded, setExpanded] = useState(false)
  const [deep, setDeep] = useState(false)

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

  const tier = computeTier(prediction)

  return (
    <div
      className={`card pc card-hover${dense ? ' dense' : ''}`}
      style={flushTop ? { borderRadius: '0 0 var(--r-lg) var(--r-lg)', marginBottom: 0 } : undefined}
    >

      {/* ── Header ── */}
      <div className="pc-head">
        <div style={{ minWidth: 0 }}>
          <div className="pc-teams">
            {fixture.homeTeamName}
            <span className="muted2" style={{ fontWeight: 400 }}>vs</span>
            {fixture.awayTeamName}
            {tier && (
              <span className={`pill ${TIER[tier].cls}`} title={`Model probability qualifies as ${tier} risk in Bet Builder`}>
                {TIER[tier].label}
              </span>
            )}
          </div>
          <div className="pc-meta">{fixture.league} · {date}</div>
        </div>
        <div className="toolbar" style={{ gap: 8 }}>
          {onPredict && (
            <button className={`btn btn-sm${prediction ? '' : ' btn-pos'}`} onClick={onPredict} disabled={computing}>
              {computing ? <><span className="spin" /> Computing</> : prediction ? 'Re-run' : 'Predict'}
            </button>
          )}
          <Link to={`/match/${fixture._id}`} className="btn btn-sm btn-ghost" style={{ color: 'var(--accent-2)' }}>
            Details →
          </Link>
        </div>
      </div>

      {/* ── Prediction panel ── */}
      {activeData ? (
        <>
          {/* Dense summary: the pick, its probability, the goals markets and Claude's verdict on
              one line. Everything below is the same card as before, revealed by "More". */}
          {dense && !expanded && (
            <div className="pc-strip">
              <VerdictPill verdict={modelVerdict} />
              <span className="num" style={{ fontSize: 12.5, fontWeight: 700 }}>{pct(modelProb)}</span>
              <div className="bar">
                <span className="who">{modelVerdict === 'Away Win' ? fixture.awayTeamName : modelVerdict === 'Draw' ? 'Draw' : fixture.homeTeamName}</span>
                <div className="meter">
                  <i className={modelVerdict === 'Away Win' ? 'info' : modelVerdict === 'Draw' ? 'warn' : 'pos'} style={{ width: pct(modelProb) }} />
                </div>
              </div>
              <OUStrip ou={activeData.overUnder} />
              {claude?.verdict && (
                <span className={`pill pill-${CONF[claude.confidence] ?? ''}`} title={claude.bestBet || undefined}>
                  AI: {claude.verdict}
                </span>
              )}
              <button className="btn btn-sm btn-ghost" style={{ marginLeft: 'auto' }} onClick={() => setExpanded(true)}>
                More ▼
              </button>
            </div>
          )}

          {(!dense || expanded) && (
          <div className="pc-split">

            {/* Model column */}
            <div>
              <div className="eyebrow" style={{ marginBottom: 8, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                {isBlended ? 'Blended model' : `Model · Mode ${prediction.activeMode}`}
                {isBlended && blended.bookmaker && (
                  <span style={{ color: 'var(--accent-2)', letterSpacing: 0, textTransform: 'none' }}>+ {blended.bookmaker}</span>
                )}
              </div>
              <VerdictPill verdict={modelVerdict} />
              {modelProb != null && (
                <div className="muted num" style={{ fontSize: 12, marginTop: 5 }}>{pct(modelProb)} probability</div>
              )}
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 5 }}>
                {[
                  { label: fixture.homeTeamName, val: activeData.result1X2.home, key: 'home', tone: 'pos' },
                  { label: 'Draw',               val: activeData.result1X2.draw, key: 'draw', tone: 'warn' },
                  { label: fixture.awayTeamName, val: activeData.result1X2.away, key: 'away', tone: 'info' },
                ].map(({ label, val, key, tone }) => {
                  const isTop = (
                    (key === 'home' && modelVerdict === 'Home Win') ||
                    (key === 'draw' && modelVerdict === 'Draw') ||
                    (key === 'away' && modelVerdict === 'Away Win')
                  )
                  return (
                    <div key={key} className={`pc-row${isTop ? ' top' : ''}`}>
                      <span className="name">{label}</span>
                      <div className="meter"><i className={isTop ? tone : ''} style={{ width: pct(val) }} /></div>
                      <span className="val">{pct(val)}</span>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Claude column */}
            <div>
              <div className="eyebrow" style={{ marginBottom: 8 }}>Claude AI</div>
              {claude ? (
                <>
                  <VerdictPill verdict={claude.verdict} confidence={claude.confidence} />
                  {claude.predictedScore && (
                    <div style={{ fontSize: 14, fontWeight: 700, marginTop: 7 }} className="num">
                      {claude.predictedScore}
                      {claude.htPredictedScore && (
                        <span className="muted" style={{ fontSize: 11.5, fontWeight: 400, marginLeft: 7 }}>
                          (HT {claude.htPredictedScore})
                        </span>
                      )}
                    </div>
                  )}
                  {claude.bestBet && (
                    <div style={{ fontSize: 12, color: 'var(--info)', marginTop: 6, lineHeight: 1.4 }}>
                      Best bet: {claude.bestBet}
                    </div>
                  )}
                  {claude.oddsAlignment && claude.oddsAlignment !== 'N/A' && (
                    <div style={{ marginTop: 5, fontSize: 11.5, color: claude.oddsAlignment === 'Agree' ? 'var(--pos)' : 'var(--warn)' }}>
                      Odds: {claude.oddsAlignment} {claude.oddsAlignment === 'Disagree' ? '⚠' : '✓'}
                    </div>
                  )}
                  {news && (
                    <div style={{ marginTop: 5, fontSize: 11.5, color: news.agreesWithModel ? 'var(--pos)' : 'var(--neg)' }}>
                      {news.agreesWithModel ? '↑ News confirms' : '↓ News conflicts'} · {news.mediaSentiment}
                    </div>
                  )}
                </>
              ) : (
                <div className="muted2" style={{ fontSize: 12.5, marginTop: 4 }}>
                  {prediction ? 'No Claude analysis — re-run with API key' : '—'}
                </div>
              )}
            </div>
          </div>

          )}

          {/* O/U strip + expand toggle */}
          {(!dense || expanded) && (
          <div className="pc-foot">
            <OUStrip ou={activeData.overUnder} />
            <div className="toolbar" style={{ gap: 4 }}>
              <button className="btn btn-sm btn-ghost" onClick={() => setDeep(d => !d)}>
                {deep ? 'Less ▲' : 'More ▼'}
              </button>
              {dense && (
                <button className="btn btn-sm btn-ghost" onClick={() => { setExpanded(false); setDeep(false) }}>
                  Collapse
                </button>
              )}
            </div>
          </div>
          )}

          {/* Expanded: blended breakdown + double chance + HT + analysis */}
          {deep && (
            <div style={{ borderTop: '1px solid var(--line-soft)', padding: '14px 16px', background: 'var(--bg-soft)' }}>

              {isBlended && blended.result1X2 && (
                <div style={{ marginBottom: 18 }}>
                  <div className="eyebrow" style={{ marginBottom: 8 }}>
                    Blend breakdown
                    {blended.weights && (
                      <span className="muted2" style={{ marginLeft: 8, letterSpacing: 0, textTransform: 'none' }}>
                        Poisson {Math.round((blended.weights.poisson ?? 0) * 100)}% · ELO {Math.round((blended.weights.elo ?? 0) * 100)}% · Odds {Math.round((blended.weights.odds ?? 0) * 100)}%
                      </span>
                    )}
                  </div>
                  <div className="tbl-wrap">
                    <table className="tbl">
                      <thead>
                        <tr>
                          {['', 'Poisson', 'ELO', blended.oddsProbs ? 'Odds' : null, blended.rawOdds ? 'Raw' : null, 'Blended']
                            .filter(Boolean)
                            .map(h => <th key={h} className={h ? 'r' : ''} style={{ textAlign: h ? 'right' : 'left' }}>{h}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {[['Home', 'home'], ['Draw', 'draw'], ['Away', 'away']].map(([label, key]) => (
                          <tr key={key}>
                            <td style={{ color: 'var(--tx)' }}>{label}</td>
                            <td className="r" style={{ color: 'var(--info)' }}>{pct(blended.poissonProbs?.[key])}</td>
                            <td className="r" style={{ color: 'var(--warn)' }}>{pct(blended.eloProbs?.[key])}</td>
                            {blended.oddsProbs && <td className="r" style={{ color: 'var(--accent-2)' }}>{pct(blended.oddsProbs?.[key])}</td>}
                            {blended.rawOdds && <td className="r muted">{blended.rawOdds?.[key]?.toFixed(2) ?? '—'}</td>}
                            <td className="r" style={{ color: 'var(--pos)', fontWeight: 700 }}>{pct(blended.result1X2?.[key])}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 20 }}>
                {activeData.doubleChance && (
                  <div>
                    <div className="eyebrow" style={{ marginBottom: 8 }}>Double chance</div>
                    {[
                      { label: '1X', val: activeData.doubleChance.homeOrDraw },
                      { label: 'X2', val: activeData.doubleChance.awayOrDraw },
                      { label: '12', val: activeData.doubleChance.homeOrAway },
                    ].map(({ label, val }) => (
                      <div key={label} className="pc-row" style={{ marginBottom: 5 }}>
                        <span className="name" style={{ width: 26 }}>{label}</span>
                        <div className="meter"><i className={val >= 0.6 ? 'warn' : ''} style={{ width: pct(val) }} /></div>
                        <span className="val">{pct(val)}</span>
                      </div>
                    ))}
                  </div>
                )}
                {activeData.halfTime?.result1X2 && (
                  <div>
                    <div className="eyebrow" style={{ marginBottom: 8 }}>Half-time</div>
                    {[
                      { label: 'Home', val: activeData.halfTime.result1X2.home },
                      { label: 'Draw', val: activeData.halfTime.result1X2.draw },
                      { label: 'Away', val: activeData.halfTime.result1X2.away },
                    ].map(({ label, val }) => (
                      <div key={label} className="pc-row" style={{ marginBottom: 5 }}>
                        <span className="name" style={{ width: 42 }}>{label}</span>
                        <div className="meter"><i style={{ width: pct(val) }} /></div>
                        <span className="val">{pct(val)}</span>
                      </div>
                    ))}
                    <div className="chip-row" style={{ marginTop: 8 }}>
                      <span className="pill">HT O0.5 {pct(activeData.halfTime.overUnder?.over05)}</span>
                      <span className="pill">HT O1.5 {pct(activeData.halfTime.overUnder?.over15)}</span>
                    </div>
                  </div>
                )}
                {claude?.analysis && (
                  <div style={{ gridColumn: '1 / -1' }}>
                    <div className="eyebrow" style={{ marginBottom: 8 }}>Analysis</div>
                    <p style={{ fontSize: 12.5, color: 'var(--tx-2)', lineHeight: 1.6 }}>{claude.analysis}</p>
                    {claude.oddsAlignmentNote && (
                      <p style={{ fontSize: 12, color: 'var(--accent-2)', marginTop: 6 }}>{claude.oddsAlignmentNote}</p>
                    )}
                    {claude.riskFactor && (
                      <p style={{ fontSize: 12, color: 'var(--neg)', marginTop: 6 }}>Risk: {claude.riskFactor}</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      ) : (
        <div style={{ padding: '13px 16px', borderTop: '1px solid var(--line-soft)' }}>
          <p className="muted2" style={{ fontSize: 12.5 }}>No prediction yet.</p>
        </div>
      )}
    </div>
  )
}
