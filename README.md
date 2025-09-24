# Best-Bet-NFL

A Python service that evaluates NFL bets (props, spreads, totals, moneylines, team totals, parlays).  
Users enter their bet details (copied from a sportsbook), and this app returns:

- **Probability** (model-based, not odds-weighted)  
- **Payout if win** (odds × stake)  
- **Expected value** (secondary metric)  
- **Debug info** (how the probability was computed)

### Features
- Supports player props, team props, spreads, totals, moneylines, and parlays
- Lets users evaluate **multiple bets at once**
- Outputs percentage likelihoods (rounded to 0.01%) as the primary focus

### Quickstart
```bash
git clone https://github.com/<your-username>/Best-Bet-NFL.git
cd Best-Bet-NFL
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
