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
    const step = stepText === undefined ? 1 : Number(stepText);
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
  return { minute, hour, day, month, weekday, dayRestricted: parts[2] !== "*" && !parts[2].startsWith("*/"), weekdayRestricted: parts[4] !== "*" && !parts[4].startsWith("*/") };
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
 * The first matching minute strictly after `from`. Local time by default, `{ utc: true }` for UTC. Looks at most about five
 * years ahead (so "30 Feb" gives null). In local time, a time that does not exist because of the clock change does not run, and
 * a time that exists twice runs twice.
 */
export function nextRun(expression, from = new Date(), { utc = false } = {}) {
  const cron = typeof expression === "string" ? parseCron(expression) : expression;
  const d = new Date(from.getTime());
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  const limit = from.getTime() + 5 * 366 * 86_400_000;
  const set = {
    date: (n) => (utc ? d.setUTCDate(n) : d.setDate(n)),
    hours: (h, m) => (utc ? d.setUTCHours(h, m, 0, 0) : d.setHours(h, m, 0, 0)),
    minutes: (m) => (utc ? d.setUTCMinutes(m, 0, 0) : d.setMinutes(m, 0, 0))
  };
  while (d.getTime() < limit) {
    const p = get(d, utc);
    if (!dayMatches(cron, p)) {
      set.date(p.day + 1);
      set.hours(0, 0);
      continue;
    }
    if (!cron.hour.has(p.hour)) {
      set.hours(p.hour + 1, 0);
      continue;
    }
    if (!cron.minute.has(p.minute)) {
      set.minutes(p.minute + 1);
      continue;
    }
    return new Date(d.getTime());
  }
  return null;
}

/** The next `count` runs after `from`. */
export function nextRuns(expression, count, from = new Date(), options) {
  const cron = typeof expression === "string" ? parseCron(expression) : expression;
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
  const known = {
    "* * * * *": "every minute", "0 * * * *": "every hour", "0 0 * * *": "every day at 00:00", "0 0 * * 0": "every Sunday at 00:00",
    "0 0 1 * *": "on the 1st of every month at 00:00", "0 0 1 1 *": "every year on 1 January at 00:00"
  };
  if (known[text]) return known[text];
  const m = /^(\d+) (\d+) \* \* \*$/.exec(text);
  if (m) return `every day at ${m[2].padStart(2, "0")}:${m[1].padStart(2, "0")}`;
  const every = /^\*\/(\d+) \* \* \* \*$/.exec(text);
  if (every) return `every ${every[1]} minutes`;
  return text;
}
