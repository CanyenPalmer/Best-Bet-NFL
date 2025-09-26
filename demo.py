import json
from pathlib import Path
from src.service.api import evaluate_batch, refresh_data, get_snapshot

if __name__ == "__main__":
    print("Refreshing data (first run may take a bit)...")
    print(refresh_data())
    print("Snapshot:", get_snapshot(), "\n")

    batch_path = Path("examples/sample_batch.json")
    data = json.loads(batch_path.read_text(encoding="utf-8"))

    print("Evaluating batch...\n")
    result = evaluate_batch(data)

    # Pretty print
    print(json.dumps(result, indent=2))
