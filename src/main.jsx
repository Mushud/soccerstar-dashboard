import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import MatchDetail from './pages/MatchDetail'
import BetSlipAnalyzer from './pages/BetSlipAnalyzer'
import BetBuilder from './pages/BetBuilder'
import Slips from './pages/Slips'
import Tournaments from './pages/Tournaments'
import Aliases from './pages/Aliases'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/match/:id" element={<MatchDetail />} />
      <Route path="/betslip" element={<BetSlipAnalyzer />} />
      <Route path="/bet-builder" element={<BetBuilder />} />
      <Route path="/slips" element={<Slips />} />
      <Route path="/tournaments" element={<Tournaments />} />
      <Route path="/aliases" element={<Aliases />} />
    </Routes>
  </BrowserRouter>
)
