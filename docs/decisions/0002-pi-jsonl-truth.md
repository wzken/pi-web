# ADR 0002: Pi JSONL is message truth

Status: accepted.

Pi Web stores mappings and aggregates in SQLite but does not mirror all
messages or tool calls. Session snapshots are rebuilt from Pi JSONL and merged
with live state. This avoids divergence from Pi branching, compaction, model
changes, and future entry types.
