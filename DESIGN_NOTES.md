# Design Notes

## Activity feed write behavior

Activity records are written in the same database transaction as the original task/comment change. I chose rollback-on-activity-failure because this feed is an audit trail, not a best-effort notification; allowing the business change without its audit record would make permission and history investigations unreliable. The tradeoff is that a temporary activity-write failure blocks the user action, but that is preferable here to silently losing compliance-relevant history.
