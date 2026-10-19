const FIELDS = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day", min: 1, max: 31 },
  { name: "month", min: 1, max: 12, names: ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], offset: 1 },
  { name: "weekday", min: 0, max: 7, names: ["sun", "mon", "tue", "wed", "thu", "fri", "sat"], offset: 0 }
];
const ALIASES = {
  "@yearly": "0 0 1 1 *", "@annually": "0 0 1 1 *", "@monthly": "0 0 1 * *", "@weekly": "0 0 * * 0", "@daily": "0 0 * * *", "@midnight": "0 0 * * *", "@hourly": "0 * * * *"
};

function value(field, text) {
  const lower = text.toLowerCase();
  const byName = field.names?.indexOf(lower);
  if (byName !== undefined && byName >= 0) return byName + field.offset;
  if (!/^\d+$/.test(text)) throw new SyntaxError(`cron: "${text}" is not a valid ${field.name}`);
  return Number(text);
}

function parseField(field, text) {
  const allowed = new Set();
  for (const part of text.split(",")) {
    if (part === "") throw new SyntaxError(`cron: empty item in the ${field.name} field`);
    const [range, stepText, extra] = part.split("/");
    if (extra !== undefined) throw new SyntaxError(`cron: "${part}" has two steps`);
    const step = stepText === undefined ? 1 : /^\d+$/.test(stepText) ? Number(stepText) : NaN;
    if (!Number.isInteger(step) || step < 1) throw new SyntaxError(`cron: step "${stepText}" in the ${field.name} field must be a whole number of at least 1`);
    let from;
    let to;
    if (range === "*") {
      from = field.min;
      to = field.name === "weekday" ? 6 : field.max;
    } else if (range.includes("-")) {
      const [a, b, more] = range.split("-");
      if (more !== undefined) throw new SyntaxError(`cron: "${range}" is not a range`);
      from = value(field, a);
      to = value(field, b);
    } else {
      from = value(field, range);
      to = stepText === undefined ? from : field.max;
    }
    if (from < field.min || to > field.max || from > to) throw new RangeError(`cron: "${part}" is outside ${field.min}-${field.max} for the ${field.name} field`);
    for (let v = from; v <= to; v += step) allowed.add(field.name === "weekday" && v === 7 ? 0 : v);
  }
  return allowed;
}

/**
 * Parses a 5-field cron expression (minute hour day month weekday) with lists, ranges, steps, month and weekday names, and
 * the aliases @hourly @daily @weekly @monthly @yearly. As in classic cron, when both day-of-month and weekday are restricted
 * a time matches if either of them matches.
 */
export function parseCron(expression) {
  if (typeof expression !== "string") throw new TypeError("cron: the expression must be a string");
  const text = ALIASES[expression.trim().toLowerCase()] ?? expression.trim();
  const parts = text.split(/\s+/);
  if (parts.length !== 5) throw new SyntaxError(`cron: expected 5 fields (minute hour day month weekday), got ${parts.length}`);
  const [minute, hour, day, month, weekday] = FIELDS.map((f, i) => parseField(f, parts[i]));
  return { minute, hour, day, month, weekday, dayRestricted: !parts[2].startsWith("*"), weekdayRestricted: !parts[4].startsWith("*") };
}

const get = (date, utc) => ({
  minute: utc ? date.getUTCMinutes() : date.getMinutes(),
  hour: utc ? date.getUTCHours() : date.getHours(),
  day: utc ? date.getUTCDate() : date.getDate(),
  month: (utc ? date.getUTCMonth() : date.getMonth()) + 1,
  weekday: utc ? date.getUTCDay() : date.getDay()
});

function dayMatches(cron, p) {
  if (!cron.month.has(p.month)) return false;
  const dom = cron.day.has(p.day);
  const dow = cron.weekday.has(p.weekday);
  if (cron.dayRestricted && cron.weekdayRestricted) return dom || dow;
  return dom && dow;
}

/** Whether `date` (to the minute) matches the expression. */
export function matches(expression, date = new Date(), { utc = false } = {}) {
  const cron = typeof expression === "string" ? parseCron(expression) : expression;
  const p = get(date, utc);
  return dayMatches(cron, p) && cron.hour.has(p.hour) && cron.minute.has(p.minute);
}

/**
 * The first matching minute strictly after `from`. Local time by default, `{ utc: true }` for UTC. Looks at most nine
 * years ahead (so "30 Feb" gives null, and 29 February is still found across a skipped leap year). In local time, a time that does not exist because of the clock change does not run, and
 * a time that exists twice runs twice.
 */
export function nextRun(expression, from = new Date(), { utc = false } = {}) {
  const cron = typeof expression === "string" ? parseCron(expression) : expression;
  // All stepping is plain arithmetic on the timestamp. The local-time setters (setMinutes, setHours, setDate) pick the first of
  // two equal wall-clock times, which can move the cursor back across a clock change.
  let t = Math.floor(from.getTime() / 60_000) * 60_000 + 60_000;
  const limit = from.getTime() + 9 * 366 * 86_400_000;
  while (t < limit) {
    const p = get(new Date(t), utc);
    if (!dayMatches(cron, p)) {
      // Towards the next midnight. In local time a clock change can make the real distance an hour shorter or longer, so stay
      // two hours short and look again; that can never skip a matching minute.
      const left = (24 - p.hour) * 60 - p.minute;
      t += (utc ? left : Math.max(60, left - 120)) * 60_000;
      continue;
    }
    if (!cron.hour.has(p.hour)) {
      t += (60 - p.minute) * 60_000;
      continue;
    }
    if (!cron.minute.has(p.minute)) {
      t += 60_000;
      continue;
    }
    return new Date(t);
  }
  return null;
}

/** The next `count` runs after `from`. */
export function nextRuns(expression, count, from = new Date(), options) {
  const cron = typeof expression === "string" ? parseCron(expression) : expression;
  if (!Number.isInteger(count) || count < 0) throw new RangeError("cron: count must be a whole number of at least 0");
  const out = [];
  let at = from;
  while (out.length < count) {
    const next = nextRun(cron, at, options);
    if (!next) break;
    out.push(next);
    at = next;
  }
  return out;
}

/** A short English description for the common cases, or the expression itself. */
export function describe(expression) {
  const text = (ALIASES[expression.trim().toLowerCase()] ?? expression.trim());
  try {
    parseCron(text);
  } catch {
    return text;
  }
  const known = {
    "* * * * *": "every minute", "0 * * * *": "every hour", "0 0 * * *": "every day at 00:00", "0 0 * * 0": "every Sunday at 00:00",
    "0 0 1 * *": "on the 1st of every month at 00:00", "0 0 1 1 *": "every year on 1 January at 00:00"
  };
  if (known[text]) return known[text];
  const m = /^(\d+) (\d+) \* \* \*$/.exec(text);
  if (m) return `every day at ${m[2].padStart(2, "0")}:${m[1].padStart(2, "0")}`;
  const every = /^\*\/(\d+) \* \* \* \*$/.exec(text);
  if (every && 60 % Number(every[1]) === 0) return Number(every[1]) === 1 ? "every minute" : `every ${every[1]} minutes`;
  return text;
}
