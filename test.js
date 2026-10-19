import assert from "node:assert/strict";
import { test } from "node:test";

import { describe as describeCron, matches, nextRun, nextRuns, parseCron } from "./src/index.js";

const utc = { utc: true };
const at = (s) => new Date(s);
const iso = (d) => d?.toISOString();

test("simple schedules", () => {
  assert.equal(iso(nextRun("*/15 * * * *", at("2026-10-17T10:07:30Z"), utc)), "2026-10-17T10:15:00.000Z");
  assert.equal(iso(nextRun("0 9 * * *", at("2026-10-17T09:00:00Z"), utc)), "2026-10-18T09:00:00.000Z"); // strictly after
  assert.equal(iso(nextRun("30 23 31 12 *", at("2026-01-01T00:00:00Z"), utc)), "2026-12-31T23:30:00.000Z");
  assert.equal(iso(nextRun("@hourly", at("2026-10-17T10:00:00Z"), utc)), "2026-10-17T11:00:00.000Z");
  assert.equal(iso(nextRun("@daily", at("2026-10-17T10:00:00Z"), utc)), "2026-10-18T00:00:00.000Z");
});

test("weekdays and names; 7 means Sunday", () => {
  assert.equal(iso(nextRun("0 9 * * mon-fri", at("2026-10-17T10:00:00Z"), utc)), "2026-10-19T09:00:00.000Z"); // 17 Oct 2026 is a Saturday
  assert.equal(iso(nextRun("0 9 * * 7", at("2026-10-17T10:00:00Z"), utc)), "2026-10-18T09:00:00.000Z");
  assert.equal(iso(nextRun("0 0 1 jan,jul *", at("2026-10-17T00:00:00Z"), utc)), "2027-01-01T00:00:00.000Z");
});

test("day of month and weekday together mean either", () => {
  const runs = nextRuns("0 0 13 * fri", 4, at("2026-10-01T00:00:00Z"), utc).map(iso);
  assert.deepEqual(runs, ["2026-10-02T00:00:00.000Z", "2026-10-09T00:00:00.000Z", "2026-10-13T00:00:00.000Z", "2026-10-16T00:00:00.000Z"]);
  const both = nextRuns("0 0 */2 * fri", 2, at("2026-10-01T00:00:00Z"), utc);
  assert.equal(both.length, 2);
});

test("steps with ranges and from-value", () => {
  assert.deepEqual([...parseCron("10-40/10 * * * *").minute], [10, 20, 30, 40]);
  assert.deepEqual([...parseCron("5/20 * * * *").minute], [5, 25, 45]);
  assert.deepEqual([...parseCron("0 8,12,18 * * *").hour], [8, 12, 18]);
});

test("february 29 and impossible dates", () => {
  assert.equal(iso(nextRun("0 0 29 2 *", at("2026-10-17T00:00:00Z"), utc)), "2028-02-29T00:00:00.000Z");
  assert.equal(nextRun("0 0 30 2 *", at("2026-10-17T00:00:00Z"), utc), null);
});

test("matches", () => {
  assert.equal(matches("*/5 * * * *", at("2026-10-17T10:05:59Z"), utc), true);
  assert.equal(matches("*/5 * * * *", at("2026-10-17T10:06:00Z"), utc), false);
});

test("nextRuns returns in order and never repeats", () => {
  const runs = nextRuns("*/30 9-10 * * *", 5, at("2026-10-17T00:00:00Z"), utc).map(iso);
  assert.deepEqual(runs, ["2026-10-17T09:00:00.000Z", "2026-10-17T09:30:00.000Z", "2026-10-17T10:00:00.000Z", "2026-10-17T10:30:00.000Z", "2026-10-18T09:00:00.000Z"]);
});

test("local time works too", () => {
  const next = nextRun("30 6 * * *", new Date(2026, 9, 17, 7, 0));
  assert.deepEqual([next.getMonth(), next.getDate(), next.getHours(), next.getMinutes()], [9, 18, 6, 30]);
});

test("bad expressions are refused with a clear message", () => {
  assert.throws(() => parseCron("* * * *"), /expected 5 fields/);
  assert.throws(() => parseCron("60 * * * *"), /outside 0-59/);
  assert.throws(() => parseCron("* 24 * * *"), RangeError);
  assert.throws(() => parseCron("*/0 * * * *"), /step/);
  assert.throws(() => parseCron("a * * * *"), SyntaxError);
  assert.throws(() => parseCron("5-1 * * * *"), RangeError);
  assert.throws(() => parseCron("1,,2 * * * *"), SyntaxError);
  assert.throws(() => parseCron(5), TypeError);
});

test("describe", () => {
  assert.equal(describeCron("*/10 * * * *"), "every 10 minutes");
  assert.equal(describeCron("30 6 * * *"), "every day at 06:30");
  assert.equal(describeCron("@daily"), "every day at 00:00");
  assert.equal(describeCron("1 2 3 4 5"), "1 2 3 4 5");
});

// ---- review additions: time zones, clock changes, brute-force reference ----

function inZone(zone, fn) {
  const before = process.env.TZ;
  process.env.TZ = zone;
  try {
    return fn();
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
}

function brute(expression, from, { utc = false, minutes = 60 * 24 * 3 } = {}) {
  const cron = parseCron(expression);
  let t = Math.floor(from.getTime() / 60_000) * 60_000 + 60_000;
  for (let i = 0; i < minutes; i++, t += 60_000) if (matches(cron, new Date(t), { utc })) return new Date(t);
  return null;
}

test("never returns a time at or before `from`, also in UTC mode while the local clock goes back", () => {
  inZone("Europe/Amsterdam", () => {
    // 25 Oct 2026 01:47Z is the second 02:47 in Amsterdam (the clock went back at 01:00Z)
    const from = at("2026-10-25T01:47:13Z");
    assert.equal(iso(nextRun("*/15 * * * *", from, utc)), "2026-10-25T02:00:00.000Z");
    assert.equal(iso(nextRun("*/15 * * * *", from)), "2026-10-25T02:00:00.000Z");
  });
});

test("Amsterdam: a time in the repeated hour runs twice, in the skipped hour not at all", () => {
  inZone("Europe/Amsterdam", () => {
    // 2026-10-25: 02:30 happens at 00:30Z and again at 01:30Z
    const runs = nextRuns("30 2 * * *", 3, at("2026-10-24T12:00:00Z")).map(iso);
    assert.deepEqual(runs, ["2026-10-25T00:30:00.000Z", "2026-10-25T01:30:00.000Z", "2026-10-26T01:30:00.000Z"]);
    // 2026-03-29: 02:30 does not exist, the next run is the day after
    const spring = nextRuns("30 2 * * *", 2, at("2026-03-28T12:00:00Z")).map(iso);
    assert.deepEqual(spring, ["2026-03-30T00:30:00.000Z", "2026-03-31T00:30:00.000Z"]);
  });
});

test("local time agrees with a minute-by-minute reference around the clock changes", () => {
  const expressions = ["30 2 * * *", "0 3 * * *", "59 1 * * *", "*/15 * * * *", "0 * * * *", "0 0 * * *", "45 23 * * *", "0 2 * * *"];
  const zones = {
    "Europe/Amsterdam": ["2026-03-28T00:00:00Z", "2026-10-24T00:00:00Z"],
    "America/New_York": ["2026-03-07T00:00:00Z", "2026-10-31T00:00:00Z"],
    "Asia/Kolkata": ["2026-03-28T00:00:00Z"],
    UTC: ["2026-03-28T00:00:00Z"]
  };
  for (const [zone, starts] of Object.entries(zones)) {
    inZone(zone, () => {
      for (const start of starts) {
        for (const expression of expressions) {
          for (let minute = 0; minute < 60 * 60; minute += 37) {
            const from = new Date(new Date(start).getTime() + minute * 60_000 + 13_000);
            assert.equal(iso(nextRun(expression, from)), iso(brute(expression, from)), `${zone} ${expression} after ${from.toISOString()}`);
            assert.equal(iso(nextRun(expression, from, utc)), iso(brute(expression, from, { utc: true })), `${zone} utc ${expression} after ${from.toISOString()}`);
          }
        }
      }
    });
  }
});

test("a field that starts with * is not restricted, also as a list", () => {
  const cron = parseCron("0 0 *,5 * mon");
  assert.equal(cron.dayRestricted, false);
  // so it behaves like "0 0 * * mon": only Mondays
  assert.equal(iso(nextRun("0 0 *,5 * mon", at("2026-10-19T00:00:00Z"), utc)), "2026-10-26T00:00:00.000Z");
});

test("steps must be plain whole numbers", () => {
  assert.throws(() => parseCron("*/1e1 * * * *"), SyntaxError);
  assert.throws(() => parseCron("*/0x10 * * * *"), SyntaxError);
  assert.throws(() => parseCron("*/+5 * * * *"), SyntaxError);
  assert.throws(() => parseCron("*/ * * * *"), SyntaxError);
});

test("describe does not claim an interval that the schedule does not keep", () => {
  assert.equal(describeCron("*/7 * * * *"), "*/7 * * * *");
  assert.equal(describeCron("*/1 * * * *"), "every minute");
  assert.equal(describeCron("*/90 * * * *"), "*/90 * * * *");
  assert.equal(describeCron("0 24 * * *"), "0 24 * * *");
  assert.equal(describeCron("99 1 * * *"), "99 1 * * *");
});

test("nextRuns checks the count", () => {
  assert.deepEqual(nextRuns("* * * * *", 0, at("2026-10-17T00:00:00Z"), utc), []);
  assert.throws(() => nextRuns("* * * * *", Infinity, at("2026-10-17T00:00:00Z"), utc), RangeError);
  assert.throws(() => nextRuns("* * * * *", -1, at("2026-10-17T00:00:00Z"), utc), RangeError);
  assert.throws(() => nextRuns("* * * * *", 1.5, at("2026-10-17T00:00:00Z"), utc), RangeError);
});

test("29 February is found even when the next one is eight years away", () => {
  assert.equal(iso(nextRun("0 0 29 2 *", at("2096-03-01T00:00:00Z"), utc)), "2104-02-29T00:00:00.000Z");
});

test("invalid dates give no run", () => {
  assert.equal(nextRun("* * * * *", new Date(NaN), utc), null);
  assert.equal(matches("* * * * *", new Date(NaN), utc), false);
});
