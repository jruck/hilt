# Performance Baselines

Captured: 2025-01-07

## Before Optimizations (Webpack)

| Metric | Value |
|--------|-------|
| Next.js "Ready" | 1042ms |
| First page load | ~3 seconds |
| HMR update | ~500ms (estimated) |

## After Optimizations (Turbopack)

| Metric | Value | Improvement |
|--------|-------|-------------|
| Next.js "Ready" | 585ms | 1.8x faster |
| First page load | 2.19 seconds | 1.4x faster |
| Total startup (both servers) | 2.19 seconds | - |
| Lock file | Working | New feature |
| Plan polling | Removed | Reduced network |

## Validation Results

### Startup Test
- [x] `npm run dev:all` to ready: **2.19 seconds** (Target: <3s) ✓

### Lock File Test
- [x] Lock file created: `~/.hilt-server.lock` with PID ✓
- [x] Duplicate server blocked with message ✓
- [x] Clean shutdown removes lock file ✓

### API Test
- [x] Sessions API responds: 36 sessions loaded ✓
- [x] WebSocket server responds on port 3001 ✓

### Features Validated
- [x] App loads with correct title
- [x] Sessions display correctly
- [x] Turbopack hot reload working
- [x] WebSocket connection established

## Network Improvements

### Before
- Plan polling: Every 3 seconds per open session
- Estimated: 9+ requests/minute with 3 sessions open

### After
- Plan polling: Removed (WebSocket events only)
- Initial fetch only on session open
- Estimated: 0 polling requests (only SWR at 5s intervals)

## Remaining Items (Not Yet Implemented)

- [ ] SWR polling consolidation (multiple hooks → single endpoint)
- [ ] React.memo on heavy components
- [ ] Virtual list for large session counts
