# Known issues

Live-event failure modes, in an app that only runs on event day — where there is no
chance to hotfix. Verify each still exists before working on it.

## 1. CSV import breaks on commas in titles

`app/actions/admin.ts` — `importPosters` (split at ~:136)

Splits rows on a bare `,`. Meanwhile `lib/csv.ts` writes properly quoted RFC 4180 output,
and its own comment notes that poster titles routinely contain commas. So exporting
posters and re-importing them corrupts every row with a comma in the title — the title is
truncated and `presenters`/`location` shift one column left.

**Fix direction:** add a small quoted-field reader alongside the existing writer in
`lib/csv.ts` so the two round-trip.

## Fixed

- **Partial code rotation locked judges out.** `regenerateAllCodes` rotated codes one
  judge at a time and returned early on the first error, committing new `code_hash`
  values whose plaintext was then discarded. It now generates every code first and
  writes them in a single transaction — all-or-nothing.
- **Per-IP rate limiting could lock out a whole venue.** A hall of judges on shared wifi
  presents one public IP, so ten mistyped codes anywhere in the room throttled everyone.
  `lib/auth/rate-limit.ts` now keys on the peppered hash of the code that was typed, so
  brute force against one code is still capped and nobody else is affected.
