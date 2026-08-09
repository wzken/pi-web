# ADR 0003: Use Node's built-in SQLite

Status: accepted.

Pi Web requires Node 22.19+ and uses `node:sqlite` with WAL, migrations,
prepared statements, and transactions. This avoids an additional native addon
while keeping a single local database.
