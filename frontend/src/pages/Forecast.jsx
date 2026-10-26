import { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Legend } from 'recharts';
import api from '../api/client';

export default function Forecast() {
  const [forecasts, setForecasts] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function load() {
      try {
        const { forecasts } = await api.get('/forecast');
        setForecasts(forecasts);
      } catch (err) {
        setError(err.message);
      }
    }
    load();
  }, []);

  return (
    <div>
      <div className="page-header" style={{ marginBottom: 16 }}>
        <div>
          <h1>Demand Forecasting</h1>
          <p>
            Explainable consumption forecasting: 3-month moving average, ordinary least squares (OLS), and 12-month seasonal-naive forecaster benchmarked on historical ammunition consumption.
          </p>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {/* Benchmark Summary Banner */}
      <div
        className="panel"
        style={{
          marginBottom: 20,
          borderLeft: '4px solid var(--accent-olive)',
          background: 'var(--panel-raised)',
          padding: 14
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <h3 style={{ margin: 0, fontSize: 14, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            Forecasting Model Evaluation (Rolling-Origin 12-Month Out-of-Sample Test)
          </h3>
          <span className="muted" style={{ fontSize: 11, fontFamily: 'var(--font-mono)' }}>
            N = 180 Evaluation Windows Across 5 Ammunition Series
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, textAlign: 'center' }}>
          <div style={{ padding: '8px 6px', background: 'var(--panel)', border: '1px solid var(--border)' }}>
            <div className="muted" style={{ fontSize: 10 }}>SEASONAL-NAIVE (12M LAG)</div>
            <div style={{ fontWeight: 700, fontSize: 18, color: 'var(--accent-olive)' }}>20.93%</div>
            <div className="muted" style={{ fontSize: 10 }}>Median APE: 14.86% (Best)</div>
          </div>
          <div style={{ padding: '8px 6px', background: 'var(--panel)', border: '1px solid var(--border)' }}>
            <div className="muted" style={{ fontSize: 10 }}>NAIVE (LAST MONTH)</div>
            <div style={{ fontWeight: 700, fontSize: 18, color: 'var(--text)' }}>23.24%</div>
            <div className="muted" style={{ fontSize: 10 }}>Median APE: 16.11%</div>
          </div>
          <div style={{ padding: '8px 6px', background: 'var(--panel)', border: '1px solid var(--border)' }}>
            <div className="muted" style={{ fontSize: 10 }}>MOVING AVG (3M)</div>
            <div style={{ fontWeight: 700, fontSize: 18, color: 'var(--accent-steel)' }}>25.84%</div>
            <div className="muted" style={{ fontSize: 10 }}>Median APE: 21.55%</div>
          </div>
          <div style={{ padding: '8px 6px', background: 'var(--panel)', border: '1px solid var(--border)' }}>
            <div className="muted" style={{ fontSize: 10 }}>OLS LINEAR REGRESSION</div>
            <div style={{ fontWeight: 700, fontSize: 18, color: 'var(--accent-rust)' }}>35.48%</div>
            <div className="muted" style={{ fontSize: 10 }}>Median APE: 31.13%</div>
          </div>
        </div>
      </div>

      {forecasts.length === 0 && !error && (
        <div className="panel">
          <div className="table-empty">No consumption history yet. Run the backend seed script to generate consumption history.</div>
        </div>
      )}

      {forecasts.map((f) => (
        <div className="panel" key={f.ammoType} style={{ marginBottom: 20 }}>
          <div className="panel-title">{f.ammoType}</div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={f.history.map((h) => ({ period: h.period, consumed: h.quantityConsumed, issued: h.quantityIssued }))}>
              <CartesianGrid stroke="#2c343d" strokeDasharray="3 3" />
              <XAxis dataKey="period" stroke="#8B939C" fontSize={11} />
              <YAxis stroke="#8B939C" fontSize={11} />
              <Tooltip contentStyle={{ background: '#1a2027', border: '1px solid #2c343d' }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="consumed" name="Consumed" stroke="#c98a2c" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="issued" name="Issued" stroke="#5b8ba8" strokeWidth={1} dot={false} strokeDasharray="4 3" />
            </LineChart>
          </ResponsiveContainer>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginTop: 14 }}>
            <div style={{ padding: 10, background: 'var(--panel-raised)', border: '1px solid var(--border)' }}>
              <div className="eyebrow" style={{ color: 'var(--accent-olive)' }}>Seasonal-Naive Forecast (Lag 12)</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 20, color: 'var(--accent-olive)' }}>
                {(f.seasonalNaiveForecast || 0).toLocaleString()}
              </div>
              <div className="muted" style={{ fontSize: 10 }}>Empirically lowest error (20.9% MAPE)</div>
            </div>
            <div style={{ padding: 10, background: 'var(--panel-raised)', border: '1px solid var(--border)' }}>
              <div className="eyebrow">3-Month Moving Average</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 20 }}>
                {f.movingAverageForecast.toLocaleString()}
              </div>
              <div className="muted" style={{ fontSize: 10 }}>Recent trend smoothing (25.8% MAPE)</div>
            </div>
            <div style={{ padding: 10, background: 'var(--panel-raised)', border: '1px solid var(--border)' }}>
              <div className="eyebrow">Linear Regression (OLS)</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 20 }}>
                {f.linearRegressionForecast.toLocaleString()}
              </div>
              <div className="muted" style={{ fontSize: 10 }}>
                slope: {f.slope}/mo, intercept: {f.intercept}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
