import React from 'react'

const styles = {
  wrap: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' },
  label: { fontSize: '0.75rem', color: '#a0aec0', width: '70px', flexShrink: 0 },
  track: { flex: 1, height: '8px', background: '#2d3748', borderRadius: '4px', overflow: 'hidden' },
  fill: (pct, color) => ({
    height: '100%',
    width: `${Math.min(pct * 100, 100)}%`,
    background: color,
    borderRadius: '4px',
    transition: 'width 0.4s ease'
  }),
  value: { fontSize: '0.75rem', color: '#e2e8f0', width: '40px', textAlign: 'right', flexShrink: 0 }
}

const COLORS = {
  home: '#68d391',
  draw: '#f6ad55',
  away: '#fc8181',
  over: '#76e4f7',
  under: '#9f7aea',
  dc: '#fbb6ce'
}

export default function ProbabilityBar({ label, value, colorKey = 'home' }) {
  const pct = typeof value === 'number' ? value : 0
  return (
    <div style={styles.wrap}>
      <span style={styles.label}>{label}</span>
      <div style={styles.track}>
        <div style={styles.fill(pct, COLORS[colorKey] || COLORS.home)} />
      </div>
      <span style={styles.value}>{(pct * 100).toFixed(1)}%</span>
    </div>
  )
}
