# Scheduler

Pi Web schedules are SQLite records, never system crontab or systemd timers.
The scheduler accepts standard five-field expressions with an IANA timezone.
The normal minimum interval is five minutes, timeout defaults to one hour and
is capped at 24 hours, and overlap policy defaults to `skip`.

Each trigger creates a new Pi Web session and therefore a new Pi session. If a
prior run is active, the occurrence is recorded as `skipped_overlap`. Timeout
first sends RPC `abort`, then closes the worker after a grace period. Missed
occurrences are not replayed after downtime.

The `pi_web_schedule` extension supports create, list, get, update, enable,
disable, delete, and run-now. It receives a session-bound short token and can
only call the scheduler interface. The daemon revalidates every expression,
timezone, path, timeout, policy, model identifier, job limit, and prompt
regardless of whether the caller is the web UI or model tool.
