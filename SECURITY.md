# Security Policy

## Supported Versions

This project is under active development on `main` and does not yet follow a
formal release/versioning scheme. Security fixes are applied to `main` only.

| Version | Supported          |
| ------- | ------------------ |
| main    | :white_check_mark: |

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Instead, please report it privately using one of these methods:

1. **Preferred:** Open a [GitHub Security Advisory](../../security/advisories/new)
   for this repository (Security tab → "Report a vulnerability").
2. Alternatively, contact the maintainer directly via the contact information
   on their [GitHub profile](https://github.com/DavidGartenberg).

Please include as much of the following as you can:

- A description of the vulnerability and its potential impact
- Steps to reproduce it (a minimal repro is very helpful)
- The affected file(s)/endpoint(s), if known
- Any suggested mitigation, if you have one

## What to expect

- We'll acknowledge your report as soon as possible.
- We'll investigate and aim to keep you updated on progress.
- Once a fix is available, we'll coordinate on disclosure timing with you if
  the issue is significant.

## Scope notes

This project runs a small local Express server (`server/`) that proxies
public terrain/weather/traffic/airport data sources and serves the built
client. It is intended to be run locally for development/personal use, not
deployed as a public-facing service without additional hardening. If you find
an issue that would matter in a self-hosted deployment context, please still
report it — we'd like to know.
