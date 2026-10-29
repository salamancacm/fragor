# Security policy

## Supported versions

Fragor is pre-1.0: only the latest commit on `main` (and the version published at
<https://salamancacm.github.io/fragor/>) receives fixes.

## Reporting a vulnerability

Please do **not** open a public issue for a security problem. Report it privately with
[GitHub's private vulnerability reporting](https://github.com/salamancacm/fragor/security/advisories/new)
and include what you found, how to reproduce it, and the impact you expect.

This is a personal project maintained in spare time: expect an acknowledgement within about a week, and a fix or an
explanation after that. Reports are credited unless you prefer otherwise.

## Scope

- The engine, CLI, importers and web app in this repository.
- Fragor runs entirely on your machine or in your browser and sends no data anywhere; a report showing otherwise is in
  scope. So are inputs (scenario JSON, trace files) that crash, hang or exhaust the memory of the tools.

Out of scope: vulnerabilities in the example Quarkus demo that come from its dependencies alone (report those
upstream), and findings that need an already compromised machine.
