import React from 'react'

const styles = {
  wrap: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' },
  label: { fontSize: '0.75rem', color: 'var(--tx-2)', width: '70px', flexShrink: 0 },
  track: { flex: 1, height: '8px', background: 'var(--line-strong)', borderRadius: '4px', overflow: 'hidden' },
  fill: (pct, color) => ({
    height: '100%',
    width: `${Math.min(pct * 100, 100)}%`,
    background: color,
    borderRadius: '4px',
    transition: 'width 0.4s ease'
  }),
  value: { fontSize: '0.75rem', color: 'var(--tx)', width: '40px', textAlign: 'right', flexShrink: 0 }
}

const COLORS = {
  home: 'var(--pos)',
  draw: 'var(--warn)',
  away: 'var(--neg)',
  over: '#76e4f7',
  under: 'var(--accent)',
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
