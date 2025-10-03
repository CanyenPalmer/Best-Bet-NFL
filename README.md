# Best-Bet-NFL

[![Deploy with Vercel](https://vercelbadge.vercel.app/api/canyenpalmer/Best-Bet-NFL)](https://best-bet-nfl.vercel.app)
![GitHub last commit](https://img.shields.io/github/last-commit/CanyenPalmer/Best-Bet-NFL)
![GitHub repo size](https://img.shields.io/github/repo-size/CanyenPalmer/Best-Bet-NFL)
![Top language](https://img.shields.io/github/languages/top/CanyenPalmer/Best-Bet-NFL)
![Language count](https://img.shields.io/github/languages/count/CanyenPalmer/Best-Bet-NFL)

---

**Project Spotlight: NFL Betting Odds Engine & Interactive Analytics Platform**

**Best-Bet NFL** is a **Python-powered analytics engine** + **Next.js gamified frontend** that evaluates sportsbook slips in real time.  

Users paste in bets, and the system outputs:  
- **True win probability** (model-based, not biased sportsbook lines).  
- **Payout if win** (based on stake × odds).  
- **Expected Value (EV)** to quantify bet quality.  
- **Debug analytics** explaining *how the probability was computed*.  

All delivered inside a **retro, Pokémon-inspired menu interface**, making betting insights **fun, immersive, and data-driven**.

---

## Features

### ✅ Supported Markets
- **Player Props**  
  - QB: passing yards, passing TDs, attempts, completions  
  - RB: rushing yards, rushing TDs, longest rush  
  - WR/TE: receiving yards, receiving TDs, receptions, longest reception  
  - K: field goals made  
- **Team Markets**: moneyline, spreads, totals, team totals  
- **Parlays**: any mix of legs  
- **Batch Runs**: evaluate multiple singles + parlays at once  

### ✅ Probability Modeling
- Uses **last 30 career games per player**:  
  - `<4 games`: substitute league averages  
  - `4–29 games`: use available history  
  - `≥30 games`: rolling last 30  
  - Missing stats → ignored (robust to gaps)  

### ✅ Gamified UI
- Retro **Pokémon-style menus** for navigation.  
- Dialogue boxes & pixel-art overlays for slips and outcomes.  
- HUD-based odds reveal, mimicking old-school RPG feel.  

### ✅ Real-Time Data
- In-app **refresh** pulls the latest weekly stats.  
- Models update dynamically with current season trends.  

---

## Analytical Foundation

- **Probability Estimation**  
  - Simulates outcomes based on historical distributions of yards, TDs, attempts, etc.  
  - Returns **0.01% precision probabilities**.  

- **Expected Value (EV)**  
  - EV = (Probability × Payout) − (1 − Probability) × Stake.  
  - Lets users see if bets are **mathematically +EV or −EV**.  

- **Variance-Aware**  
  - Factors in usage shifts (injuries, new roles, game scripts).  
  - Simulates *true volatility* instead of static averages.  

---

## Tech Stack

**Frontend & UX**  
- **Next.js 14 & React** → Modular, production-grade frontend.  
- **Tailwind CSS + Framer Motion** → Retro animations, HUD transitions.  
- **Custom Pixel-Art Assets** → Football fields, avatars, menus.  

**Backend & Analytics**  
- **Python (Pandas, NumPy, SciPy)** → Probability modeling & stats.  
- **Custom Odds Engine** → Handles singles, parlays, and batch slips.  
- **Node.js/Express API** → Links Python engine to the frontend.  

**Deployment & Infrastructure**  
- **Vercel** → Live frontend with continuous deployment.  
- **GitHub Actions** → Automated testing/build pipeline.  
- **Scalable Config System** → Player data & odds models easy to maintain.  

---

## Quickstart

Clone and install locally:

```bash
git clone https://github.com/CanyenPalmer/Best-Bet-NFL.git
cd Best-Bet-NFL
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# (Optional) Refresh to latest data (you’ll wire this to a UI button)
python -c "from src.service.api import refresh_data; print(refresh_data())"

# Run the demo (evaluates singles + a parlay from examples/sample_batch.json)
python demo.py


