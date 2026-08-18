# AI-48 Observability Signals

## Phase 1: Configuration Verified
- Sentry DSN: staging-only
- Environment: staging (enforced)
- Build: passes CI workflow
- Better Stack: tokens configured in .env.local

## Phase 1 Testing (Week 1)
Once deployed to staging:
1. Trigger test error in Sentry
2. Verify event captured (https://aispanda.sentry.io/)
3. Measure MATTD (baseline)
4. Test Better Stack telemetry endpoint
5. Record observability signal quality

## Acceptance: Week 3 Decision
- MATTD < 15 min? Scale to Phase 2.
- False positives < 20%? Scale.
- Cost $0? Scale.
