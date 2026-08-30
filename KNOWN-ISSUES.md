# Known issues

Unfixed defects found during a full read of the codebase on 2026-08-13. All three are
live-event failure modes, in an app that only runs on event day — where there is no
chance to hotfix. Verify each still exists before working on it.

## 1. Partial code rotation locks judges out

`app/actions/admin.ts` — `regenerateAllCodes` (loop at ~:240)

Rotates codes one judge at a time and returns early on the first error. Judges processed
before the failure already have new `code_hash` values committed, and their plaintext has
been discarded — the return value is the only copy. Those judges are locked out with no
recoverable code, at exactly the moment cards are being printed.

**Fix direction:** generate all codes first, write them in a single transaction (or an RPC
that takes the whole batch), and only then return the cards. All-or-nothing.

## 2. CSV import breaks on commas in titles

`app/actions/admin.ts` — `importPosters` (split at ~:136)

Splits rows on a bare `,`. Meanwhile `lib/csv.ts` writes properly quoted RFC 4180 output,
and its own comment notes that poster titles routinely contain commas. So exporting
posters and re-importing them corrupts every row with a comma in the title — the title is
truncated and `presenters`/`location` shift one column left.

**Fix direction:** add a small quoted-field reader alongside the existing writer in
`lib/csv.ts` so the two round-trip.

## 3. Per-IP rate limiting can lock out a whole venue

`lib/auth/rate-limit.ts` — `MAX_FAILURES = 10` per `WINDOW_MINUTES = 15`, keyed on IP

A hall of judges on shared venue wifi presents a single public IP. Ten mistyped codes
across the entire room — plausible when people are reading 8-character codes off printed
cards — throttles everyone for 15 minutes.

Note the fail-open on infrastructure error (`isRateLimited` returns `false`) does **not**
cover this case; the limiter is working as designed here, the key is just too coarse.

**Fix direction:** key on the submitted code (or code prefix) rather than IP, or keep IP
but raise the ceiling substantially and add a per-code limit underneath it.
