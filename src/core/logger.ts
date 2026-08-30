import { appendFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG } from '../config.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
export type Level = keyof typeof LEVELS;

/**
 * All stamps use CONFIG.logs.timezone rather than the server clock, so log file
 * names and timestamps read correctly no matter what timezone the VPS runs in.
 */
function tzParts(d: Date): Record<string, string> {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: CONFIG.logs.timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  });
  const out: Record<string, string> = {};
  for (const part of fmt.formatToParts(d)) out[part.type] = part.value;
  return out;
}

export function dateStamp(d = new Date()): string {
  const p = tzParts(d);
  return `${p.year}-${p.month}-${p.day}`;
}

export function timeStamp(d = new Date()): string {
  const p = tzParts(d);
  return `${p.hour}:${p.minute}:${p.second}`;
}

/** UTC offset of CONFIG.logs.timezone at that instant, e.g. "+03:00". */
function tzOffset(d: Date): string {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: CONFIG.logs.timezone,
    timeZoneName: 'longOffset',
  });
  const name = fmt.formatToParts(d).find((p) => p.type === 'timeZoneName')?.value ?? '';
  return name.replace('GMT', '') || '+00:00';
}

/**
 * Renders an instant in CONFIG.logs.timezone with its offset, for anything human facing.
 * state.json keeps raw UTC ISO strings; only the logs are localised.
 */
export function fullStamp(value: Date | string | undefined): string {
  if (value === undefined || value === '') return 'never';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return String(value);
  const p = tzParts(d);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second} ${tzOffset(d)}`;
}

/** Log file name stem. 'daily' gives one file per day, 'per-run' one per run. */
export function fileStamp(d = new Date()): string {
  const p = tzParts(d);
  return CONFIG.logs.granularity === 'per-run'
    ? `${p.year}-${p.month}-${p.day}_${p.hour}${p.minute}${p.second}`
    : `${p.year}-${p.month}-${p.day}`;
}

export class Logger {
  private readonly file: string;

  constructor(private readonly scope: string, stamp: string = fileStamp()) {
    const dir = join(CONFIG.logs.dir, scope);
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, `${stamp}.log`);
  }

  /** Writes a line with no level prefix, used for run headers and separators. */
  raw(text: string): void {
    this.append(text);
    if (CONFIG.logs.alsoConsole) console.log(text);
  }

  debug(msg: string): void { this.write('debug', msg); }
  info(msg: string): void { this.write('info', msg); }
  warn(msg: string): void { this.write('warn', msg); }
  error(msg: string): void { this.write('error', msg); }

  private write(level: Level, msg: string): void {
    if (LEVELS[level] < LEVELS[CONFIG.logs.level]) return;
    const line = `${timeStamp()} ${level.toUpperCase().padEnd(5)} ${msg}`;
    this.append(line);
    if (CONFIG.logs.alsoConsole) console.log(`[${this.scope}] ${line}`);
  }

  /** Logging must never be able to kill a run. */
  private append(line: string): void {
    try {
      appendFileSync(this.file, `${line}\n`, 'utf8');
    } catch {
      /* ignore */
    }
  }
}

/**
 * Deletes log files last modified more than CONFIG.logs.retentionDays ago.
 * Runs at the end of every run so the logs directory cannot grow without bound.
 */
export function pruneOldLogs(): number {
  const root = CONFIG.logs.dir;
  if (!existsSync(root)) return 0;

  const cutoff = Date.now() - CONFIG.logs.retentionDays * 86_400_000;
  let removed = 0;

  for (const scope of readdirSync(root, { withFileTypes: true })) {
    if (!scope.isDirectory()) continue;
    const dir = join(root, scope.name);
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.log')) continue;
      const full = join(dir, name);
      try {
        if (statSync(full).mtimeMs < cutoff) {
          rmSync(full);
          removed++;
        }
      } catch {
        /* ignore */
      }
    }
  }
  return removed;
}
