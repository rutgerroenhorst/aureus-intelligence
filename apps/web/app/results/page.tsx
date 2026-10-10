'use client';
import { useState } from 'react';
import { usePolling } from '@/lib/usePolling';
import { ExitCheck } from './ExitCheck';

interface ResultsCoin {
  symbol: string;
  mint: string;
  detector: string;
  entryScore: number;
  entryMcap: number;
  currentMcap: number;
  multiplier: number;
  detectionAge: number;
  status: string;
}

interface MyTrade {
  id: string;
  symbol: string;
  mint: string;
  tab?: string | null;
  source?: string;
  enteredAt: string;
  entryMcap: number;
  currentMcap: number;
  multiplier: number;
  peakMultiple?: number;
  lowMultiple?: number;
  sizeUsd?: number | null;
  note?: string | null;
  status: 'active' | 'exited';
  exitMcap?: number;
  exitedAt?: string;
}

export default function ResultsPage() {
  const [systemWins, setSystemWins] = useState<ResultsCoin[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [detectorBreakdown, setDetectorBreakdown] = useState<any>(null);
  const [myTrades, setMyTrades] = useState<MyTrade[]>([]);
  const [tradeStats, setTradeStats] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'system' | 'trades'>('system');
  const [loading, setLoading] = useState(true);

  // Every 15 s while in use. Pauses while the screen is hidden and backs off when untouched: a plain setInterval here
  // was 11,500 requests a day (350k a month, a third of Vercel's free 1M) from one forgotten tab.
  usePolling(async () => {
    try {
      const sysRes = await fetch('/api/results-detailed', { cache: 'no-store' });
      const tradesRes = await fetch('/api/my-trades', { cache: 'no-store' });

      if (sysRes && sysRes.ok) {
        const data = await sysRes.json();
        setSystemWins(data.systemWins || []);
        setStats(data.stats);
        setDetectorBreakdown(data.detectorBreakdown);
      }

      if (tradesRes && tradesRes.ok) {
        const data = await tradesRes.json();
        setMyTrades(data.myTrades || []);
        setTradeStats(data.stats);
      }
    } catch (err) {
      console.error('Fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, 15_000);

  if (loading) {
    return <div style={{ padding: '40px', textAlign: 'center' }}>Loading...</div>;
  }

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto' }}>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '32px' }}>
        <button
          onClick={() => setActiveTab('system')}
          style={{
            padding: '8px 16px',
            background: activeTab === 'system' ? '#34c759' : '#1a1a1f',
            color: activeTab === 'system' ? '#000' : '#8a8a8e',
            border: `1px solid ${activeTab === 'system' ? '#34c759' : '#2a2a2f'}`,
            borderRadius: '6px',
            cursor: 'pointer',
            fontWeight: 700,
          }}
        >
          🤖 System Performance
        </button>
        <button
          onClick={() => setActiveTab('trades')}
          style={{
            padding: '8px 16px',
            background: activeTab === 'trades' ? '#34c759' : '#1a1a1f',
            color: activeTab === 'trades' ? '#000' : '#8a8a8e',
            border: `1px solid ${activeTab === 'trades' ? '#34c759' : '#2a2a2f'}`,
            borderRadius: '6px',
            cursor: 'pointer',
            fontWeight: 700,
          }}
        >
          💰 My Trades
        </button>
      </div>

      {activeTab === 'system' && (
        <div>
          <h2 style={{ marginBottom: '24px', color: '#34c759' }}>System Win Rate Analysis</h2>

          {/* Stats Grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '16px',
              marginBottom: '32px',
            }}
          >
            <StatBox label="Total Winners" value={stats?.winners || 0} color="#34c759" />
            <StatBox label="5x+ Coins" value={stats?.x5plus || 0} color="#20E5A3" />
            <StatBox label="10x+ Coins" value={stats?.x10plus || 0} color="#FFB52F" />
            <StatBox label="Avg Multiplier" value={`${stats?.avgMultiplier || 0}x`} color="#866CFF" />
          </div>

          {/* Detector Breakdown */}
          <div
            style={{
              background: '#0f1116',
              border: '1px solid #2a2a2f',
              borderRadius: '8px',
              padding: '16px',
              marginBottom: '32px',
            }}
          >
            <h3 style={{ marginBottom: '6px', fontSize: '14px' }}>Which tab listed the winners</h3>
            <p style={{ margin: '0 0 14px', fontSize: '11px', color: '#8a8a8e', lineHeight: 1.5 }}>
              Only coins that reached 2x are listed here, with no losers, so this is NOT a win rate (the Learning page has win rates
              per tab). A coin counts for every tab that listed it. Tab tracking started on 2026-10-09; earlier winners show "Not tracked".
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '12px' }}>
              {detectorBreakdown && (
                <>
                  <DetectorCard name="CATE" count={detectorBreakdown.CATE} color="#FF3B30" />
                  <DetectorCard name="Elite" count={detectorBreakdown.Elite} color="#34c759" />
                  <DetectorCard name="Buy Signals" count={detectorBreakdown['Buy Signal']} color="#007AFF" />
                  <DetectorCard name="Momentum" count={detectorBreakdown['Ultra Momentum']} color="#FF9500" />
                  <DetectorCard name="Incubation" count={detectorBreakdown['Incubation'] ?? 0} color="#30b0c0" />
                  <DetectorCard name="Not tracked" count={detectorBreakdown['Not tracked'] ?? 0} color="#8a8a8e" />
                </>
              )}
            </div>
          </div>

          {/* Winners Table */}
          <div
            style={{
              background: '#0f1116',
              border: '1px solid #2a2a2f',
              borderRadius: '8px',
              overflow: 'auto',
            }}
          >
            <table
              style={{
                width: '100%',
                fontSize: '12px',
                borderCollapse: 'collapse',
              }}
            >
              <thead>
                <tr style={{ borderBottom: '1px solid #2a2a2f' }}>
                  <th style={{ padding: '12px', textAlign: 'left', color: '#8a8a8e' }}>Coin</th>
                  <th style={{ padding: '12px', textAlign: 'left', color: '#8a8a8e' }}>Detector</th>
                  <th style={{ padding: '12px', textAlign: 'left', color: '#8a8a8e' }}>Score</th>
                  <th style={{ padding: '12px', textAlign: 'left', color: '#8a8a8e' }}>Entry MCap</th>
                  <th style={{ padding: '12px', textAlign: 'left', color: '#8a8a8e' }}>Current MCap</th>
                  <th style={{ padding: '12px', textAlign: 'left', color: '#8a8a8e' }}>Return</th>
                  <th style={{ padding: '12px', textAlign: 'left', color: '#8a8a8e' }}>Age</th>
                </tr>
              </thead>
              <tbody>
                {systemWins.map((coin, i) => (
                  <tr
                    key={i}
                    style={{
                      borderBottom: '1px solid #1a1a1f',
                      background: i % 2 === 0 ? '#0f1116' : '#141419',
                    }}
                  >
                    <td style={{ padding: '12px', color: '#fff', fontWeight: 600 }}>
                      {coin.symbol}
                    </td>
                    <td style={{ padding: '12px', color: '#8a8a8e' }}>{coin.detector}</td>
                    <td style={{ padding: '12px', color: '#fff' }}>{coin.entryScore}</td>
                    <td style={{ padding: '12px', color: '#8a8a8e' }}>
                      ${Math.round(coin.entryMcap / 1000)}k
                    </td>
                    <td style={{ padding: '12px', color: '#8a8a8e' }}>
                      ${Math.round(coin.currentMcap / 1000)}k
                    </td>
                    <td
                      style={{
                        padding: '12px',
                        color: coin.multiplier >= 10 ? '#FFB52F' : '#34c759',
                        fontWeight: 700,
                      }}
                    >
                      {coin.multiplier.toFixed(2)}x
                    </td>
                    <td style={{ padding: '12px', color: '#8a8a8e' }}>{coin.detectionAge}m</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'trades' && (
        <div>
          <h2 style={{ marginBottom: '24px', color: '#34c759' }}>Your Personal Trades</h2>

          {tradeStats && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                gap: '12px',
                marginBottom: '24px',
              }}
            >
              <StatBox
                label="Active Positions"
                value={tradeStats.active}
                color="#007AFF"
              />
              <StatBox label="Exited" value={tradeStats.exited} color="#8a8a8e" />
              <StatBox label="Winners" value={tradeStats.winners} color="#34c759" />
              <StatBox label="Reached 2x at some point" value={tradeStats.touched2x ?? 0} color="#FFB52F" />
              <StatBox label="Gain given back" value={tradeStats.gaveBack ?? 0} color="#FF3B30" />
              <StatBox
                label="Avg Profit"
                value={`${tradeStats.avgProfit}x`}
                color="#FFB52F"
              />
            </div>
          )}

          <ExitCheck trades={myTrades} />

          {myTrades.length === 0 ? (
            <div
              style={{
                background: '#0f1116',
                border: '1px solid #2a2a2f',
                borderRadius: '8px',
                padding: '40px',
                textAlign: 'center',
              }}
            >
              <p style={{ color: '#8a8a8e' }}>
                No trades yet. Press "✔ Enter" on any coin in the Radar: the tab you used, your entry and its highest and lowest point afterwards are saved here.
                (Market caps are checked while Aureus is open, so a spike between two checks is not seen.)
              </p>
            </div>
          ) : (
            <div
              style={{
                background: '#0f1116',
                border: '1px solid #2a2a2f',
                borderRadius: '8px',
                overflow: 'auto',
              }}
            >
              <table
                style={{
                  width: '100%',
                  fontSize: '12px',
                  borderCollapse: 'collapse',
                }}
              >
                <thead>
                  <tr style={{ borderBottom: '1px solid #2a2a2f' }}>
                    <th style={{ padding: '12px', textAlign: 'left', color: '#8a8a8e' }}>
                      Coin
                    </th>
                    <th style={{ padding: '12px', textAlign: 'left', color: '#8a8a8e' }}>
                      Entry Time
                    </th>
                    <th style={{ padding: '12px', textAlign: 'left', color: '#8a8a8e' }}>
                      Tab
                    </th>
                    <th style={{ padding: '12px', textAlign: 'left', color: '#8a8a8e' }}>
                      Entry MCap
                    </th>
                    <th style={{ padding: '12px', textAlign: 'left', color: '#8a8a8e' }}>
                      Current MCap
                    </th>
                    <th style={{ padding: '12px', textAlign: 'left', color: '#8a8a8e' }}>
                      Peak
                    </th>
                    <th style={{ padding: '12px', textAlign: 'left', color: '#8a8a8e' }}>
                      P&L
                    </th>
                    <th style={{ padding: '12px', textAlign: 'left', color: '#8a8a8e' }}>
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {myTrades.map((trade, i) => {
                    const hours = Math.floor(
                      (Date.now() - new Date(trade.enteredAt).getTime()) / 3600000
                    );
                    const pnlColor =
                      trade.multiplier >= 2
                        ? '#34c759'
                        : trade.multiplier >= 1
                          ? '#8a8a8e'
                          : '#FF3B30';

                    return (
                      <tr
                        key={i}
                        style={{
                          borderBottom: '1px solid #1a1a1f',
                          background: i % 2 === 0 ? '#0f1116' : '#141419',
                        }}
                      >
                        <td style={{ padding: '12px', color: '#fff', fontWeight: 600 }}>
                          {trade.symbol}
                        </td>
                        <td style={{ padding: '12px', color: '#8a8a8e' }}>
                          {hours}h ago
                        </td>
                        <td style={{ padding: '12px', color: '#8a8a8e' }} title={trade.note || undefined}>
                          {trade.tab ? trade.tab.replace(/_/g, ' ') : '—'}
                        </td>
                        <td style={{ padding: '12px', color: '#8a8a8e' }}>
                          ${Math.round(trade.entryMcap / 1000)}k
                        </td>
                        <td style={{ padding: '12px', color: '#8a8a8e' }}>
                          ${Math.round(trade.currentMcap / 1000)}k
                        </td>
                        <td
                          style={{ padding: '12px', color: (trade.peakMultiple ?? 1) >= 2 ? '#FFB52F' : '#8a8a8e', fontWeight: 600 }}
                          title="Highest market cap seen since entry, as a multiple of the entry"
                        >
                          {(trade.peakMultiple ?? 1).toFixed(2)}x
                        </td>
                        <td style={{ padding: '12px', color: pnlColor, fontWeight: 700 }}>
                          {trade.multiplier.toFixed(2)}x
                          {trade.status === 'active' && (trade.peakMultiple ?? 1) >= 2 && trade.multiplier < 1 && (
                            <span style={{ marginLeft: 6, fontSize: 10, color: '#FF3B30' }}>gave back</span>
                          )}
                        </td>
                        <td style={{ padding: '12px', color: '#8a8a8e' }}>
                          {trade.status === 'active' ? '🔵 Active' : '⚪ Exited'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      </div>
  );
}

function StatBox({ label, value, color }: { label: string; value: any; color: string }) {
  return (
    <div
      style={{
        background: '#0f1116',
        border: `1px solid ${color}33`,
        borderRadius: '8px',
        padding: '16px',
      }}
    >
      <div style={{ fontSize: '11px', color: '#8a8a8e', marginBottom: '8px' }}>{label}</div>
      <div style={{ fontSize: '24px', fontWeight: 700, color }}>
        {value}
      </div>
    </div>
  );
}

function DetectorCard({ name, count, color }: { name: string; count: number; color: string }) {
  return (
    <div
      style={{
        background: '#1a1a1f',
        border: `1px solid ${color}33`,
        borderRadius: '6px',
        padding: '12px',
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: '11px', color: '#8a8a8e', marginBottom: '4px' }}>{name}</div>
      <div style={{ fontSize: '18px', fontWeight: 700, color }}>
        {count} {count === 1 ? 'win' : 'wins'}
      </div>
    </div>
  );
}
