# @sandsoftwaresolutions/cron-next

[![CI](https://github.com/SandSoftwareSolutions/ss-cron-next/actions/workflows/ci.yml/badge.svg)](https://github.com/SandSoftwareSolutions/ss-cron-next/actions/workflows/ci.yml)

Read cron expressions and find out when they run next. For scheduling jobs on a Pi, showing "next backup" in a dashboard, or testing a schedule before you deploy it. No dependencies.

## Install

```bash
npm install @sandsoftwaresolutions/cron-next
```

## Usage

```js
import { nextRun, nextRuns, matches, describe } from "@sandsoftwaresolutions/cron-next";

nextRun("30 6 * * mon-fri");                      // Date: the next weekday at 06:30 (local time)
nextRuns("*/15 9-17 * * *", 3);                   // the next three runs
nextRun("@daily", new Date(), { utc: true });     // in UTC
matches("0 * * * *", new Date());                 // is it the top of the hour?
describe("*/10 * * * *");                         // "every 10 minutes"
```

## Syntax

Five fields: `minute hour day-of-month month weekday`.

| Field | Values |
| --- | --- |
| minute | 0-59 |
| hour | 0-23 |
| day of month | 1-31 |
| month | 1-12 or `jan`-`dec` |
| weekday | 0-7 (0 and 7 are Sunday) or `sun`-`sat` |

Each field takes `*`, a number, a list (`1,15`), a range (`9-17`), and steps (`*/15`, `10-40/10`, `5/20`). Aliases: `@hourly`, `@daily` (`@midnight`), `@weekly`, `@monthly`, `@yearly` (`@annually`).

## Details that matter

- `nextRun` is the first matching minute **strictly after** `from`. Seconds are ignored.
- **Day and weekday together mean "either"**, as in classic cron: `0 0 13 * fri` is every 13th *and* every Friday. A field that starts with `*` (also `*/2`) counts as not restricted, so `0 0 */2 * fri` means "every second day *and* a Friday".
- **Local time or UTC.** Local is the default. In local time a time that does not exist (the clock jumps forward) does not run, and a time that happens twice (the clock goes back) runs twice. Use `{ utc: true }` for schedules that must not move.
- Impossible dates (`0 0 30 2 *`) give `null` after looking about five years ahead.
- A bad expression throws a `SyntaxError` or `RangeError` that says which field is wrong.

This package finds the times; it does not run anything. Combine it with a `setTimeout` loop, or let the system cron do the running.
