# Scheduled jobs (grounded data pipelines)

The world model stays current through two recurring jobs. Both are plain
scripts — run them from crontab, a GitHub Action, or any scheduler.

| Cadence | Job | What it does |
|---|---|---|
| Nightly 02:00 | `python3 scripts/refresh_payer_intel.py` | Re-pulls tracked payers' PA requirements for the case's CPT from the Praxigen coverage API into `data/payer-intel.json` (+ frontend copy). Source-grounded: every row cites its policy sources; missing rows stay visibly empty. |
| Weekly Sun 03:00 | `python3 scripts/refit_from_flywheel.py` | Folds the flywheel log (`backend/logs/tuples.jsonl` — every state→action→outcome the app records) back into `data/world_model_priors.json`, updating the action-value weights the decision engine uses. This is the autonomous-improvement loop: decisions today sharpen tomorrow's rollouts. |
| One-time / on dataset change | `python3 scripts/train_world_model.py` | Fits the initial priors from the 25 Abridge encounters (status distributions, gap frequencies). Honesty note: these are **fitted priors, not a trained model** — the corpus is 25 synthetic encounters. |

Example crontab:

```cron
0 2 * * *  cd ~/praxess && PRAXIGEN_API_BASE=... PRAXIGEN_API_KEY=... python3 scripts/refresh_payer_intel.py >> logs/cron.log 2>&1
0 3 * * 0  cd ~/praxess && python3 scripts/refit_from_flywheel.py >> logs/cron.log 2>&1
```

No credentials are committed; scripts dry-run without them.
