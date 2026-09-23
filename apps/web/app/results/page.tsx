'use client';
import { useEffect, useState } from 'react';

interface QualifiedToken {
  symbol: string;
  mint: string;
  multiplier: number;
  currentMcap: number;
}

export default function ResultsPage() {
  const [winners, setWinners] = useState<QualifiedToken[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchResults = async () => {
      try {
        const res = await fetch('/api/board', { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();

          const allCoins = Object.values(data.sections || {}).flatMap((section: any) => {
            return Array.isArray(section) ? section : [];
          });

          const qualified = allCoins
            .filter(c => c.v2StructuralStatus === 'STRUCTURALLY_QUALIFIED')
            .map(c => ({
              symbol: c.symbol || '?',
              mint: c.mint,
              multiplier: c.marketCapFirstSeen ? (c.marketCapUsd || 1) / c.marketCapFirstSeen : 1,
              currentMcap: c.marketCapUsd || 0,
            }))
            .filter(c => c.multiplier >= 2.0)
            .sort((a, b) => b.multiplier - a.multiplier);

          setWinners(qualified);
        }
      } catch (err) {
        console.error('Fetch error:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchResults();
  }, []);

  const stats = {
    x5plus: winners.filter(t => t.multiplier >= 5).length,
    x10plus: winners.filter(t => t.multiplier >= 10).length,
    avg: winners.length > 0 ? (winners.reduce((sum, t) => sum + t.multiplier, 0) / winners.length).toFixed(2) : '0',
    max: winners.length > 0 ? winners[0].multiplier.toFixed(2) : '0',
  };

  if (loading) {
    return <div style={{ padding: '40px', textAlign: 'center' }}>Loading...</div>;
  }

  return (
    <div style={{ padding: '32px' }}>
      <h1>🏆 Generational Wealth Winners</h1>
      <p>Coins that actually delivered returns (2x or more)</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '40px' }}>
        <div>
          <div>Winners</div>
          <div style={{ fontSize: '28px', fontWeight: 700, color: '#2585FF' }}>{winners.length}</div>
        </div>
        <div>
          <div>5x+</div>
          <div style={{ fontSize: '28px', fontWeight: 700, color: '#20E5A3' }}>{stats.x5plus}</div>
        </div>
        <div>
          <div>10x+</div>
          <div style={{ fontSize: '28px', fontWeight: 700, color: '#FFB52F' }}>{stats.x10plus}</div>
        </div>
        <div>
          <div>Avg</div>
          <div style={{ fontSize: '28px', fontWeight: 700, color: '#866CFF' }}>{stats.avg}x</div>
        </div>
      </div>
      {winners.length > 0 ? (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #20E5A3' }}>
              <th style={{ padding: '12px', textAlign: 'left' }}>Token</th>
              <th style={{ padding: '12px', textAlign: 'left' }}>Discovery MCap</th>
              <th style={{ padding: '12px', textAlign: 'right' }}>Current MCap</th>
              <th style={{ padding: '12px', textAlign: 'right' }}>Multiplier</th>
              <th style={{ padding: '12px' }}>View</th>
            </tr>
          </thead>
          <tbody>
            {winners.map((t, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: '12px', fontWeight: 600 }}>{t.symbol}</td>
                <td style={{ padding: '12px' }}>${(t.currentMcap / t.multiplier / 1000).toFixed(0)}k</td>
                <td style={{ padding: '12px' }}>${(t.currentMcap / 1000).toFixed(0)}k</td>
                <td style={{ padding: '12px', textAlign: 'right', fontWeight: 700, color: t.multiplier >= 10 ? '#20E5A3' : t.multiplier >= 5 ? '#FFB52F' : '#FFA500' }}>
                  {t.multiplier.toFixed(2)}x
                </td>
                <td style={{ padding: '12px' }}>
                  <a href={`https://dexscreener.com/solana/${t.mint}`} target="_blank" rel="noopener noreferrer" style={{ color: '#2585FF' }}>Chart</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div style={{ textAlign: 'center', padding: '40px', color: '#8a8a8e' }}>
          No 2x+ winners in current dataset
        </div>
      )}
    </div>
  );
}
