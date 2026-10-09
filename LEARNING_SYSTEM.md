# Self-Learning Filter Optimization System

> **Superseded (2026-10-09).** Coins are now tracked and graded **on the server**, not by the browser, and age buckets
> are in hours. See [docs/CLOUD_SCAN_AND_LEARNING.md](docs/CLOUD_SCAN_AND_LEARNING.md). The text below describes the
> original browser-driven design (`trackCoinQualification` in `apps/web/lib/learning-integration.ts` is not called by anything).


## Overview

The Self-Optimizer is a real-time learning system that continuously:
1. **Tracks** coins as they qualify for different tabs
2. **Analyzes** winner vs. loser patterns per tab and age bucket
3. **Suggests** filter adjustments based on empirical data
4. **Learns** separately for each qualification tab (Quick Flip, Stealth Moon, Elite, Early)

## Architecture

### Core Components

#### 1. **Coin Qualification Tracking** (`/api/learning-track`)
Automatically captures when coins qualify for tabs:
- Mint, symbol, timestamp
- All metrics at qualification time (buy_ratio, holder distribution, volume velocity, etc.)
- Tab name (identifies which filter path qualified it)
- Outcome status (pending → winner/loser/rugpull/dead)

#### 2. **Outcome Updates** (`/api/learning-update-outcomes`)
Periodically checks DexScreener for current coin status:
- Updates price, mcap, volume data
- Determines outcome: winner (2x+), mega_winner (5x+), loser, rugpull, dead
- Calculates return multiplier

#### 3. **Suggestion Generation** (`/api/learning-generate-suggestions`)
Analyzes historical data to generate filter improvements:
- Per-tab, per-age-bucket analysis
- Compares winner metrics vs. loser metrics
- Identifies optimal thresholds for each metric
- Confidence scoring based on sample size

#### 4. **Learning Worker** (`/api/learning-worker`)
Orchestrates all learning tasks:
- `?task=update-outcomes` - Run every 5 minutes
- `?task=generate-suggestions` - Run every hour
- `?task=full` - Run both

#### 5. **Learning Dashboard** (`/learning`)
Real-time visualization:
- Per-tab win rates
- Age-bucket breakdowns
- Pending suggestions with confidence scores
- Improvement estimates (current vs. with suggestion)

## Database Schema

### Tables

#### `coin_qualifications`
Tracks every coin that qualified for a tab:
- `mint`, `symbol`, `tab_name`
- Qualification timestamp and age at qualification
- All metrics captured at qualification time
- Current price, peak price, return multiplier
- Outcome status and timing

Key indexes:
- `(tab_name, age_days_at_qualification)`
- `(tab_name, outcome_status)`
- `(mint)`

#### `filter_suggestions`
Stores generated filter improvement suggestions:
- Tab name, age bucket range
- Metric name, current vs. suggested threshold
- Confidence score, win rate comparisons
- Sample size, status (pending_review/applied/rejected)

#### `learning_progress`
Aggregated per-tab performance metrics:
- Win counts, lose counts, rugpull/dead counts
- Current win rate, average return multiplier
- Last analysis timestamp

#### `ab_tests`
A/B testing framework:
- Control vs. treatment filter configurations
- Outcome metrics and win rate comparison
- Test status and dates

#### `active_filters_snapshot`
Backup of filter configs when coins qualified:
- Enables retroactive analysis of why coins qualified
- Timestamps for forensics

## Integration Points

### 1. Auto-Tracking
Coins are automatically tracked when they appear in tabs:
- **File**: `/app/command-center-tabs/page.tsx`
- **Mechanism**: `useEffect` hook monitors filtered coins per tab
- **Call**: `trackCoinQualification(coin, tab_name)`

### 2. Periodic Learning Tasks
Set up cron jobs or scheduled tasks to call:

```bash
# Every 5 minutes
curl -X POST http://localhost:3000/api/learning-worker?task=update-outcomes

# Every hour
curl -X POST http://localhost:3000/api/learning-worker?task=generate-suggestions

# Or run both
curl -X POST http://localhost:3000/api/learning-worker?task=full
```

### 3. Filter Application
When suggestions are approved, they should be applied to the actual filter logic:
- **Files**: `/api/early-coins/route.ts`, `/api/*/route.ts`
- **Mechanism**: Read suggestions from `filter_suggestions` table with `status='applied'`
- **Implementation**: Pending - create filter synthesis layer

## Age-Based Learning

Different coin age ranges have different characteristics:

| Age Bucket | Characteristics | Learning Focus |
|-----------|-----------------|-----------------|
| **0-1 day** | Ultra-early, high volatility, unpredictable | Buy pressure, danger indicators |
| **1-3 days** | Early momentum building, whale detection | Volume velocity, holder distribution |
| **3-8 days** | Stealth accumulation window, sweet spot | Price stability, quiet accumulation patterns |
| **8-30 days** | Established coins, mature patterns | Fundamental metrics, stability indicators |
| **30d+** | Dead or thriving, clear winners | Long-term sustainability signals |

The system learns **separately** for each bucket because thresholds that work for 3-day-old coins don't apply to 1-hour-old coins.

## Metrics Tracked

### Per-Coin
- `buy_ratio` - Buy transactions / total transactions (0-1.0)
- `holder_top10_pct` - Top 10% holder concentration (%)
- `volume_velocity` - Current volume / baseline volume (ratio)
- `price_velocity` - Current price / launch price (ratio)
- `danger_score` - Rugpull risk indicator (0-100)
- `market_cap_usd` - Current market cap
- `liquidity_usd` - Available liquidity

### Derived
- `return_multiplier` - Peak price / entry price
- `days_to_peak` - How long until peak
- `win_rate_by_tab` - % winners per tab
- `confidence_score` - Suggestion confidence (0-100)

## Setup Instructions

### 1. Create Database Tables
```bash
npx ts-node scripts/run-learning-migration.ts
```

### 2. Enable Auto-Tracking
Already integrated in command-center-tabs, but verify:
- Check network tab when loading Results page
- Should see POST requests to `/api/learning-track`
- Each coin in a tab should create one tracking record

### 3. Set Up Learning Worker
Add to your backend scheduler (Vercel Cron, AWS Lambda, etc.):

```typescript
// example: runs every 5 minutes
POST /api/learning-worker?task=update-outcomes

// example: runs every hour  
POST /api/learning-worker?task=generate-suggestions
```

### 4. Monitor Progress
Visit `/learning` dashboard to see:
- Coins tracked per tab
- Win rates emerging
- Suggestions being generated
- Filter recommendations

## Understanding the Suggestions

Example suggestion:
```json
{
  "tab_name": "stealth_moon",
  "age_bucket": "3-8d",
  "metric": "buy_ratio",
  "current_threshold": 0.60,
  "suggested_threshold": 0.68,
  "direction": "increase",
  "confidence": 82,
  "win_rate_without": 45,
  "win_rate_with": 67,
  "sample_size": 23
}
```

**Interpretation**: For stealth moon tab, coins aged 3-8 days, if we increase the buy_ratio threshold from 0.60 to 0.68:
- Current filter catches some winners at 45% win rate
- Stricter filter would catch better winners at 67% win rate
- Based on 23 qualifying coins
- 82% confidence in this pattern

## Next Steps

1. **Migration**: Run the migration script to create tables
2. **Monitor**: Check `/learning` dashboard daily
3. **Apply**: Review suggestions and apply high-confidence ones
4. **Iterate**: System continuously improves as more data flows through

## Real-Time Learning Workflow

```
Coins Flow Through Radar
    ↓
Auto-Track by Tab
    ↓
Coins Mature Over Time
    ↓
Update Outcomes (every 5 min)
    ↓
Generate Suggestions (every hour)
    ↓
Human Reviews Dashboard
    ↓
Apply Approved Suggestions
    ↓
Better Filters for Next Round
```

## API Reference

### POST /api/learning-track
Track a coin qualification.
```json
{
  "mint": "...",
  "symbol": "...",
  "tab_name": "stealth_moon",
  "age_minutes_at_qualification": 120,
  "score_at_qualification": 95,
  "buy_ratio_at_qualification": 0.65,
  "holder_top10_at_qualification": 3.2,
  "volume_velocity_at_qualification": 1.8,
  "price_velocity_at_qualification": 1.2,
  "mcap_usd_at_qualification": 150000,
  "liquidity_usd_at_qualification": 5000,
  "danger_score_at_qualification": 22
}
```

### POST /api/learning-update-outcomes
Update outcomes for pending coins (returns first 20 updates).

### POST /api/learning-generate-suggestions
Analyze data and generate filter suggestions.

### GET /api/learning-analysis
Get current learning analysis and all active suggestions.

### POST /api/learning-worker?task=...
Orchestrator for all learning tasks.

## Troubleshooting

**Q: "No learning data yet"**
- A: Coins take time to show outcomes. Wait for 5+ cycles of update-outcomes task.

**Q: Suggestions not appearing**
- A: Need minimum 10 coins per age bucket to analyze. Run learning-update-outcomes multiple times.

**Q: Low confidence scores**
- A: Small sample size. More coins need to flow through the system.

**Q: Win rate shows 0% in some buckets**
- A: Not enough non-pending coins in that age bucket yet. Patient.

## Performance Notes

- Outcome updates query ~500 pending coins at a time
- Suggestion generation analyzes per-tab, per-age-bucket
- Expected to complete in <30 seconds for typical datasets
- Designed to run every 5-60 minutes without issues

## Future Enhancements

1. **Dynamic Learning**: Adjust filters automatically based on confidence thresholds
2. **Weighted Learning**: Weight recent outcomes more heavily
3. **Correlation Analysis**: Find metric interactions that matter
4. **Multi-Chain Learning**: Per-blockchain metrics and patterns
5. **Advanced ML**: Neural networks to predict outcomes
