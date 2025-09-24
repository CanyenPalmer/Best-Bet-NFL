import json
from pathlib import Path
from src.service.api import evaluate_batch, refresh_data, get_snapshot

print("Refreshing data (first run may take a bit)...")
print(refresh_data())  # pulls weekly stats and builds rolling μ/σ
print("Snapshot:", get_snapshot())
print()

batch_path = Path("examples/sample_batch.json")
data = json.loads(batch_path.read_text(encoding="utf-8"))

print("Evaluating batch...\n")
result = evaluate_batch(data)

print("=== Singles ===")
for s in result["singles"]:
    print(f"- {s['label']}: {s['probability_pct']}  |  Payout if win ${s['payout_if_win']:.2f}")
    print(f"  Summary: {s['summary']}")
    print()

print("=== Parlays ===")
for p in result["parlays"]:
    print(f"- Stake: ${p['stake']:.2f}")
    for i, leg in enumerate(p["legs"], 1):
        print(f"  Leg {i}: {leg['label']}  -> {leg['probability_pct']}  (odds {leg['odds']})")
    print(f"  Parlay Probability (independent): {p['parlay_probability_independent_pct']}")
    print(f"  Combined decimal odds: {p['combined_decimal_odds']}")
    print(f"  Payout if win: ${p['payout_if_win']:.2f}")
    print(f"  EV: ${p['expected_value']:.2f}")
    print(f"  Note: {p['correlation_note']}")
    print()
