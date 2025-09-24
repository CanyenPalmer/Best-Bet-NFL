# Best-Bet-NFL

A Python service that evaluates NFL bets (props, spreads, totals, moneylines, team totals, parlays).

**What it returns**
- **Probability** (model-based, not odds-weighted)
- **Payout if win** (odds × stake)
- **Expected value** (secondary)
- **Percent-focused summary** (rounded to 0.01%)

**What it supports**
- Player props (QB/RB/WR/K common lines)
- Moneyline, spreads, totals, team totals
- Parlays
- Batch processing: multiple singles + multiple parlays in one run

> NOTE: The engine ships with *stubbed math* so you can run and test right away. Swap in your model/ETL later by replacing `src/engine/nfl_bet_engine.py`.

---

## Quickstart

```bash
git clone https://github.com/<your-username>/Best-Bet-NFL.git
cd Best-Bet-NFL
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# Run the demo (evaluates singles + parlays from examples/sample_batch.json)
python demo.py
