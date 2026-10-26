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
      <div className="page-header">
        <div>
          <h1>Demand Forecast</h1>
          <p>Simple, explainable models only - a 3-month moving average and an ordinary least-squares linear regression over 12 months of issue/consumption history. No black-box ML.</p>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {forecasts.length === 0 && !error && (
        <div className="panel">
          <div className="table-empty">No consumption history yet. Run the backend seed script to generate 12 months of synthetic data.</div>
        </div>
      )}

      {forecasts.map((f) => (
        <div className="panel" key={f.ammoType}>
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

          <div className="grid-2" style={{ marginTop: 12 }}>
            <div>
              <div className="eyebrow">Next-period forecast (3-mo moving average)</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22 }}>{f.movingAverageForecast.toLocaleString()}</div>
            </div>
            <div>
              <div className="eyebrow">Next-period forecast (linear regression)</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22 }}>{f.linearRegressionForecast.toLocaleString()}</div>
              <div className="muted" style={{ fontSize: 11 }}>
                slope {f.slope}/mo, intercept {f.intercept}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
