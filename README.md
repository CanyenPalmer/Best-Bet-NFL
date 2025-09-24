# Best-Bet-NFL

A Python engine + service to evaluate NFL bets from any sportsbook slip the user pastes in.

**What users see**
- **Probability (primary):** model-based likelihood (no $ weighting) — shown as a percentage rounded to **0.01%**
- **Payout if win:** computed only from odds × stake
- **EV:** secondary metric
- **Debug analytics:** how the probability was computed

**What it supports**
- **Player props** (QB / RB / WR / **TE** / K):
  - QB: passing yards, **passing TDs**, attempts, completions
  - RB: rushing yards, **rushing TDs**, longest rush
  - WR/TE: receiving yards, **receiving TDs**, receptions, longest reception
  - K: field goals made
- **Team markets:** moneyline, spreads, totals, team totals
- **Parlays:** any mix of legs
- **Batch:** multiple singles + multiple parlays in one run
- **Refresh data** in-app (pulls latest weekly stats)

**Player history window**
- Uses **last 30 career games** per player:
  - `< 4 games`: use league averages until they have 4
  - `4–29 games`: use the games available
  - `≥ 30 games`: use last 30
  - Missing stats in any game are **ignored**

---

## Quickstart

```bash
git clone https://github.com/<your-username>/Best-Bet-NFL.git
cd Best-Bet-NFL
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# (Optional) Refresh to latest data (you’ll wire this to a UI button)
python -c "from src.service.api import refresh_data; print(refresh_data())"

# Run the demo (evaluates singles + a parlay from examples/sample_batch.json)
python demo.py


