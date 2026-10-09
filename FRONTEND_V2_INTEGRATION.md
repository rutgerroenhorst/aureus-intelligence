# Aureus V2 Frontend Integration Roadmap

## Overview
V2 verification gates backend is production-ready with Phase 1 conservative model. Frontend needs to display:
- V2 verification status (STRUCTURALLY_QUALIFIED / INSUFFICIENT_DATA / FATAL_REJECT)
- Confidence percentage
- Current blockers (which phase 2 capability is blocking progress)

## Architecture

### Status Values
- **STRUCTURALLY_QUALIFIED** (green badge ✓ SQ): Passed Phase 1 gates, ready for Phase 2 deep analysis
- **INSUFFICIENT_DATA** (yellow badge ⚠): Missing critical structural data (deployer funding risk, etc)
- **FATAL_REJECT** (red badge ✗): Positive evidence of unacceptable risk

### Display Locations

#### 1. RADAR (/today) — Decision Surface
- **Status**: Add V2 status badge next to MCap in row
- **Badge color**: Green for SQ, yellow for INSUFFICIENT_DATA, red for FATAL_REJECT
- **Hover text**: Show confidence % and first missing field if INSUFFICIENT_DATA
- **Filtering**: Optional "Only show STRUCTURALLY_QUALIFIED" toggle

#### 2. STREAM (/discover) — Live Inbound
- **List view**: Compact rows with V2 status badge
- **Status badge**: Small colored indicator (green/yellow/red)
- **Confidence**: Show percentage in badge
- **Quick-risk**: Combine with existing risk indicator

#### 3. FORENSICS (/candidate/:id) — Detail View
- **Top panel**: V2 verification status + confidence
- **Gate breakdown**: Show all 5 gate results:
  - GATE-01: Freeze authority status
  - GATE-02: Creator rug history
  - GATE-03: Deployer concentration
  - GATE-04: Holder concentration  
  - GATE-05: Liquidity check
- **Missing fields**: List required data still needed
- **Next phase**: Show which Phase 2 capabilities would unlock deeper analysis

#### 4. SIGNALS (/alerts) — Event Feed
- **V2 gate changes**: Trigger alert when status changes
- **New SQ candidates**: "New candidate ready for analysis"
- **Data gaps resolved**: "Deployer data now available for XYZ"

#### 5. OPS (/system) — Infrastructure
- **V2 stats**: Total evaluated, status distribution, avg confidence
- **Latest evaluations**: Last 10 V2 results with timestamps
- **Data quality**: Deployer data availability, creator blacklist status

#### 6. WATCHLIST (/watchlist) — Saved Items
- **V2 status column**: Show verification status alongside entry readiness
- **Sort by**: Add option to sort by V2 status or confidence

## Database Integration

### Query Changes Needed

In `candidateView.ts`, add to Row interface:
```typescript
v2_status: string | null;           // FATAL_REJECT | INSUFFICIENT_DATA | STRUCTURALLY_QUALIFIED
v2_confidence: number | null;       // 0-100%
v2_failed_gates: string[] | null;   // List of failed gate IDs
v2_missing_fields: string[] | null; // List of missing critical fields
v2_computed_at: string | null;      // When V2 was last evaluated
```

Join to `intelligence_v2_scores` table:
```sql
LEFT JOIN intelligence_v2_scores ivs ON c.id = ivs.candidate_id::uuid
  AND ivs.computed_at = (
    SELECT MAX(computed_at) FROM intelligence_v2_scores 
    WHERE candidate_id = c.id
  )
```

### Add to CandidateDecisionView:
```typescript
v2Status: string | null;
v2Confidence: number | null;
v2FailedGates: string[];
v2MissingFields: string[];
v2BlockerHint: string; // "needs deployer funding risk" etc
```

## Phase 2 Readiness

Phase 1 V2 is complete. Phase 2 capabilities (when implemented):
- Entity clustering (wallet forensics)
- Organic flow analysis (real buyers vs wash trading)
- Trend/narrative analysis (pre-mint vs post-token)
- Smart money wallet tracking
- Bundle contamination detection

When Phase 2 comes online:
1. V2 gates will have access to these features
2. Status can progress from STRUCTURALLY_QUALIFIED → VERIFIED
3. Confidence will increase as more verification data becomes available
4. Frontend "blocked by" message changes from "needs Phase 2: XYZ" to "analyzing XYZ..."

## Styling Reference

### Badge Styles
```css
.v2-badge {
  display: inline-block;
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 11px;
  font-weight: 600;
  margin: 0 4px;
}

.v2-badge.v2-structurally_qualified {
  background: #10b981;
  color: white;
}

.v2-badge.v2-insufficient_data {
  background: #f59e0b;
  color: white;
}

.v2-badge.v2-fatal_reject {
  background: #ef4444;
  color: white;
}
```

## Implementation Priority

1. **Week 1**: Integrate V2 data into RADAR (/today) — most-viewed screen
2. **Week 2**: Add to candidate detail view (/candidate/:id) for deep inspection
3. **Week 3**: Stream, Signals, OPS, Watchlist updates
4. **Week 4**: Polish, edge cases, Phase 2 readiness

## Testing

### Manual
- [ ] View candidate with STRUCTURALLY_QUALIFIED status
- [ ] View candidate with INSUFFICIENT_DATA status
- [ ] View candidate with FATAL_REJECT status
- [ ] Check confidence % accuracy
- [ ] Hover tooltips show missing fields

### Automated
- Add E2E tests for V2 status display
- Regression: existing entry-ready logic unchanged
- Verify gate data loads without query errors

## Notes

- **Max status enforced**: Frontend should never show VERIFIED for Phase 1 candidates
- **Snapshot model**: Multiple V2 evaluations per candidate; use latest computed_at
- **Shadow mode**: V2 runs parallel to legacy; both are shown, neither blocks the other
- **Confidence semantics**: Current value is "data quality"; Phase 2 will separate into structural/verification/opportunity coverage

---

**Status**: Backend gate PASSED. Frontend integration ready to begin.
