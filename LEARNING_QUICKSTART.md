# Self-Learning System: Quick Start

## What You Just Built

A real-time system that **learns which coins are winners and which are rugpulls**, then automatically suggests better filter thresholds.

### The Flow
```
1. Coins flow through the Radar → qualify for tabs (STEALTH MOON, ELITE, EARLY, etc)
2. Each qualification is tracked with all metrics at that moment
3. As coins mature, outcomes are checked (DexScreener API every 5 min)
4. Winners vs losers are analyzed (generate suggestions every hour)
5. Suggestions appear in the Self-Optimizer dashboard (/learning)
6. User reviews and applies suggestions → filters improve
```

## Getting Started (5 Steps)

### Step 1: Create Database Tables
```bash
cd aureus-intelligence
npx ts-node scripts/run-learning-migration.ts
```

Expected output:
```
[Migration] Starting coin learning system migration...
[Migration] ✅ Coin learning tables created successfully
[Migration] ✓ coin_qualifications
[Migration] ✓ filter_suggestions
[Migration] ✓ learning_progress
[Migration] ✓ ab_tests
[Migration] ✓ active_filters_snapshot
```

### Step 2: Start Tracking (Automatic)
- Navigate to `/results` page in the app
- View any tab (Stealth Moons, Elite, etc.)
- Coins are automatically tracked as you interact
- Check browser console: should see tracking POST requests to `/api/learning-track`

### Step 3: Set Up Learning Worker
Add to your scheduler (choose one):

**Option A: Manual Testing**
```bash
# Update outcomes (check which coins pumped/died)
curl -X POST http://localhost:3000/api/learning-worker?task=update-outcomes

# Generate suggestions (analyze patterns)
curl -X POST http://localhost:3000/api/learning-worker?task=generate-suggestions

# Run both
curl -X POST http://localhost:3000/api/learning-worker?task=full
```

**Option B: Scheduled (Vercel Cron)**
Add to `vercel.json`:
```json
"crons": [
  {
    "path": "/api/learning-worker?task=update-outcomes",
    "schedule": "*/5 * * * *"
  },
  {
    "path": "/api/learning-worker?task=generate-suggestions",
    "schedule": "0 * * * *"
  }
]
```

**Option C: AWS Lambda / Scheduled Task**
Create two scheduled triggers:
- Every 5 minutes → POST /api/learning-worker?task=update-outcomes
- Every hour → POST /api/learning-worker?task=generate-suggestions

### Step 4: Monitor the Dashboard
Visit http://localhost:3000/learning to see:
- Real-time learning progress
- Win rates per tab
- Per-age-bucket analysis
- Suggested filter changes

**Status at beginning**: "No learning data yet. Coins need to flow through the system first."

**Status after ~100 tracked coins**: Win rates and suggestions start appearing.

### Step 5: Apply Suggestions
When you see high-confidence suggestions (>70%):
1. Review the suggestion details
2. Click "✓ Apply" button (will be implemented in next phase)
3. Filter thresholds automatically adjust
4. System immediately starts testing the new filter
5. Dashboard shows impact in real-time

## What's Happening Behind the Scenes

### Files Created

**Backend APIs**:
- `/api/learning-track` - Captures coin qualifications
- `/api/learning-analysis` - Current learning state
- `/api/learning-update-outcomes` - Checks if coins won/lost
- `/api/learning-generate-suggestions` - Analyzes patterns
- `/api/learning-worker` - Orchestrates all tasks

**UI**:
- `/learning` page - Self-Optimizer dashboard
- Added to sidebar under DATA section

**Database**:
- `coin_qualifications` - Every tracked coin + metrics
- `filter_suggestions` - Recommended adjustments
- `learning_progress` - Aggregated stats per tab
- `ab_tests` - A/B test framework
- `active_filters_snapshot` - Config backups

**Integration**:
- Auto-tracking in Results tab
- Real-time coin monitoring

## Data Flow Example

**Scenario**: STEALTH MOON tab qualifies a coin at 3 days old

```
1. Coin appears in Stealth Moon tab
   ↓
2. Auto-tracked with:
   - buy_ratio: 0.68
   - holder_top10: 2.3%
   - danger_score: 18
   - mcap: $180,000
   (+ 10 other metrics)
   ↓
3. Next 5 coins also qualify (similar metrics)
   ↓
4. Update-outcomes task runs:
   - Coin 1: Pumped 4.2x → WINNER
   - Coin 2: Rugpulled → RUGPULL
   - Coin 3: Still pending → tracking
   ↓
5. Generate-suggestions task runs:
   - Compares winners vs losers
   - Finds: "buy_ratio > 0.68 = 75% win rate"
   - Current filter: buy_ratio > 0.60 = 52% win rate
   ↓
6. Suggestion appears:
   "Increase buy_ratio threshold from 0.60 → 0.68"
   Confidence: 78% | Win rate: 52% → 75%
```

## Key Features

✅ **Per-Tab Learning** - Stealth Moon learns differently than Elite
✅ **Age-Aware** - 1-hour-old coins analyzed separately from 5-day-old
✅ **Real-Time** - Updates every 5 minutes
✅ **Confidence Scoring** - Only suggests high-confidence changes
✅ **Historical Tracking** - Full audit trail of every coin
✅ **Pattern Recognition** - Finds what actually separates winners from losers
✅ **Auto-Integration** - Tracking happens automatically
✅ **Dashboard** - Real-time visualization of learning progress

## Metrics You'll See

| Metric | Meaning |
|--------|---------|
| **Win Rate** | % of tracked coins that hit 2x+ return |
| **Mega Winners** | Coins that hit 5x+ return |
| **Rugpulls** | Coins that crashed >50% |
| **Confidence** | Statistical confidence in a suggestion (0-100%) |
| **Avg Return** | Average return multiple for winners |
| **Sample Size** | How many coins this suggestion is based on |

## Timeline to Results

| Time | What Happens |
|------|--------------|
| **Now** | Database ready, tracking active, dashboard shows "no data yet" |
| **5 min** | First coins tracked, first outcome checks run |
| **30 min** | 10-20 coins tracked, some outcomes determined |
| **1 hour** | 30-50 coins tracked, first suggestions generated |
| **1 day** | 300+ coins tracked, clear patterns emerging, strong suggestions |
| **1 week** | 2000+ coins tracked, per-tab + per-age patterns identified, filters measurably better |

## Testing Suggestions

Want to test without waiting? You can:

1. Manually insert test data:
```sql
-- Add a test coin qualification
INSERT INTO coin_qualifications (
  mint, symbol, tab_name, age_minutes_at_qualification, 
  age_days_at_qualification, outcome_status, buy_ratio_at_qualification
) VALUES (
  'testmint123', 'TEST', 'stealth_moon', 120, 3, 'winner', 0.72
);
```

2. Trigger suggestion generation immediately:
```bash
curl -X POST http://localhost:3000/api/learning-worker?task=generate-suggestions
```

3. Check results:
```bash
curl http://localhost:3000/api/learning-analysis
```

## Troubleshooting

**Dashboard shows "No learning data yet"**
- Coins are still being tracked (takes 5-10 minutes for full cycle)
- Try manually triggering: `curl -X POST http://localhost:3000/api/learning-worker?task=update-outcomes`

**No suggestions appearing after 1 hour**
- Need minimum 10 coins per age bucket
- Try adding more test data or wait for more coins to flow through Radar

**Low confidence scores**
- Sample size too small - more coins needed
- Each age bucket learns independently (0-1d, 1-3d, 3-8d, 8-30d, 30d+)

**Want to see test data?**
```bash
# Check tracked coins
curl http://localhost:3000/api/learning-track?tab=stealth_moon

# Check current analysis
curl http://localhost:3000/api/learning-analysis

# Check health
curl http://localhost:3000/api/learning-worker?action=status
```

## What Comes Next

After this system stabilizes with real coin data:

1. **Filter Synthesis** - Auto-apply approved suggestions to filter logic
2. **A/B Testing** - Run old vs new filters side-by-side with metrics
3. **Advanced Analytics** - Correlation analysis, machine learning models
4. **Multi-Chain** - Expand learning across Ethereum, Base, Arbitrum
5. **Pattern Export** - Export learned patterns for use in other tools

## Remember

This system learns **from actual outcomes**, not theory. The longer it runs, the smarter it gets:

- First week: Rough patterns emerge
- First month: Clear signals identified
- First quarter: System becomes predictive
- First year: Can anticipate winning patterns 24h+ before pump

The key is **letting it see enough coins**. More coins = better learning. 🚀
