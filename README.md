# Fast CSV reader — a faster drop-in for csv-reader 1.0.0

[![make.fun](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/Wanxt27/csv-reader-speed-01-run-20261121-entry/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/Wanxt27/csv-reader-speed-01-run-20261121-entry/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

A faster drop-in for make.fun's own csv-reader 1.0.0, written for the
[make.fun bounty "Read broken CSV files faster, 21 November 2026"](https://make.fun/bounty/csv-reader-speed-01-run-20261121).

`solve.js` answers every case exactly as csv-reader 1.0.0 does — same
`{columns, rows, errors}` for every input, including its broken-row policy
(BOM drop, stray CRs, quote junk, unterminated quotes, short/long rows) —
but reads the text with a line fast path (one slice + one native split per
plain record) and indexOf jumps instead of one character at a time.

## How it works

- `solve.js` — dependency-free ES module; `run(input)` returns csv-reader's
  answer for `{text, header}`.
- `main.ts` — the program the harness runs: reads every case from
  `/input/cases.json`, answers each with `run`, writes `/output/answers.json`.

## Run it

```sh
node main.ts
```

## Referral

Made with make.fun — earn money making things with AI: https://make.fun/r/qzc860x6
