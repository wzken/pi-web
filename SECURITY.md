# Security policy

## Supported versions

Until the first stable release, security fixes are applied to the current
`main` branch.

## Reporting a vulnerability

Please do not open a public issue for an undisclosed vulnerability.

Use GitHub private vulnerability reporting when it is available for this
repository. Otherwise contact the repository maintainer privately through the
contact method on their GitHub profile. Include:

- affected version or commit;
- reproduction steps;
- expected impact;
- suggested mitigation, if known.

Do not include real API keys, access keys, cookies, provider credentials,
private workspaces, or production databases. A maintainer should acknowledge a
complete report within seven days and coordinate disclosure after a fix is
available.

Pi Web is not a sandbox. Reports that only demonstrate that a trusted Pi worker
has the permissions of its operating-system user are generally outside the
security boundary; bypasses of authentication, allowed roots, IPC roles, or
browser-origin checks remain in scope.
