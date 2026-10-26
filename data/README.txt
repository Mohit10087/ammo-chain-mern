Ordnance-Chain synthetic data (seed 42). Regenerate: python3 generate.py

DATA
consumption_history.csv  540 rows  month, unit, ammo_type, rounds_consumed (3 units x 5 ammo types x 36 months)
lots.csv                 80 rows   lot_id, ammo_type, quantity, depot, climate_profile, manufacture_date
sensor_readings.csv      14,400    lot_id, date, temperature_c, humidity_pct (daily, 180 days)
transactions.csv         1,580     lifecycle events; is_anomaly / anomaly_kind are labels (80 injected)
lots_ground_truth.csv    hidden truth used only for evaluation (never shown to the detector)

EVALUATION (for report/paper)
forecast_eval*.csv, degradation_eval.csv, degradation_scores.csv, anomaly_eval.csv, fig_*.png

MongoDB import example:
mongoimport --db ordnance --collection consumption --type csv --headerline --file consumption_history.csv

NOTE: all data is synthetic. Results validate the pipeline logic, not real-world accuracy.
