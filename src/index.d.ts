export interface ParsedCron {
  minute: Set<number>;
  hour: Set<number>;
  day: Set<number>;
  month: Set<number>;
  weekday: Set<number>;
  dayRestricted: boolean;
  weekdayRestricted: boolean;
}
export interface CronOptions {
  /** Use UTC instead of local time. */
  utc?: boolean;
}
export function parseCron(expression: string): ParsedCron;
export function matches(expression: string | ParsedCron, date?: Date, options?: CronOptions): boolean;
export function nextRun(expression: string | ParsedCron, from?: Date, options?: CronOptions): Date | null;
export function nextRuns(expression: string | ParsedCron, count: number, from?: Date, options?: CronOptions): Date[];
export function describe(expression: string): string;
