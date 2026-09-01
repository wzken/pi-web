# ADR 0001: Sessiond owns workers

Status: accepted.

Pi worker processes are children of the independent session daemon, never the
HTTP process or a browser connection. This is the smallest boundary that makes
browser disconnect and web-server restart survival testable. A sessiond crash
may still interrupt workers in v0.1 and is reported honestly.
