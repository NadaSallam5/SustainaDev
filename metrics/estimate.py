from codecarbon import EmissionsTracker
import json, sys
delta = float(sys.argv[1]) if len(sys.argv)>1 else 10.0
tracker = EmissionsTracker(save_to_file=False)
tracker.start()
for _ in range(2_000_000):
    pass
em = tracker.stop() or 0.0
kwh_saved = max(delta * 0.00001, 0)
print(json.dumps({"emissions_kg": em, "estimated_kwh_saved": kwh_saved, "estimated_cost_saved_usd": kwh_saved * 0.15}))
