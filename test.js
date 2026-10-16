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
