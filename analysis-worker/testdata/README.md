# Analysis Test Data

This fixture is for local validation of the analysis worker's generated
features and pattern mining.

## Files

- `customers.csv`: customer master table with `won_flag` as the binary target.
- `activities.csv`: customer-linked event log with activity type, event time,
  reaction hours, and sales team.
- `sales.csv`: customer-linked transaction table with sale date, amount, product
  category, and discount rate.
- `dataset.json`: Fabric-like dataset metadata.
- `mapping.json`: semantic mapping with customer joins, target, features, and
  event-time roles.
- `payload.json`: analysis worker payload using autopilot generated features.
- `run_fixture_analysis.py`: local runner that patches `fetch_table_rows` to
  read the CSV files and writes `analysis-result.json`.

## Expected Signals

The generated data intentionally contains several discoverable signals:

- Manufacturing customers with 20 or fewer employees are more likely to win
  when `Email -> Visit` happens within 3 days.
- `Email` reactions below roughly 24 hours are correlated with wins.
- `Visit -> Proposal` within 7 days is correlated with wins.
- Recent sales amount also has a moderate positive signal.

## Run

```powershell
node scripts\generate-analysis-test-data.js
python analysis-worker\testdata\run_fixture_analysis.py
```

The runner writes:

```text
analysis-worker\testdata\analysis-result.json
```
