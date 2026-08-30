import type { Rule, Video } from './types.js';

const norm = (s: string) => s.toLowerCase().trim();

/** Accept when the title contains ANY of these terms. Case insensitive. */
export function titleContains(...terms: string[]): Rule {
  return {
    name: `title contains any of [${terms.join(', ')}]`,
    test: (v: Video) => terms.some((t) => norm(v.title).includes(norm(t))),
  };
}

/** Accept only when the title contains NONE of these terms. */
export function titleExcludes(...terms: string[]): Rule {
  return {
    name: `title excludes [${terms.join(', ')}]`,
    test: (v: Video) => !terms.some((t) => norm(v.title).includes(norm(t))),
  };
}

export function titleMatches(pattern: RegExp): Rule {
  return { name: `title matches ${pattern}`, test: (v: Video) => pattern.test(v.title) };
}

export function descriptionContains(...terms: string[]): Rule {
  return {
    name: `description contains any of [${terms.join(', ')}]`,
    test: (v: Video) => terms.some((t) => norm(v.description).includes(norm(t))),
  };
}

export function durationBetween(minMinutes: number, maxMinutes: number): Rule {
  return {
    name: `duration between ${minMinutes}m and ${maxMinutes}m`,
    test: (v: Video) => v.durationSeconds >= minMinutes * 60 && v.durationSeconds <= maxMinutes * 60,
  };
}

/** Rules are AND-combined by default. Wrap in anyOf() for OR. */
export function anyOf(...rules: Rule[]): Rule {
  return {
    name: `any of (${rules.map((r) => r.name).join(' OR ')})`,
    test: (v: Video) => rules.some((r) => r.test(v)),
  };
}

export function not(rule: Rule): Rule {
  return { name: `NOT (${rule.name})`, test: (v: Video) => !rule.test(v) };
}
