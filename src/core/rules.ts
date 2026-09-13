import type { Rule, Video } from './types.js';

/**
 * Normalises text before matching. Applied identically to the haystack and the search term,
 * so a rule keyed on one spelling still matches the other.
 *
 * Arabic makes this necessary rather than optional. Real titles from the configured channels
 * show all three problems:
 *   - inconsistent tashkeel: AJ+ writes "المُخبر" on some videos and plain text on others
 *   - interchangeable letter forms: أ إ آ for ا, ى for ي, ة for ه
 *   - invisible bidi controls: beIN SPORTS titles carry U+202B, which breaks a naive includes()
 *
 * Latin text is unaffected beyond lowercasing and whitespace collapsing.
 */
export function normalizeForMatch(text: string): string {
  return (
    text
      .normalize('NFC')
      // Zero-width characters, bidi embedding/override/isolate marks, BOM.
      .replace(/[​-‏‪-‮⁦-⁩﻿]/g, '')
      // Arabic diacritics (tashkeel), superscript alef, and tatweel padding.
      .replace(/[ً-ٰٟـ]/g, '')
      // Alef variants, alef maksura, teh marbuta.
      .replace(/[آأإٱ]/g, 'ا')
      .replace(/ى/g, 'ي')
      .replace(/ة/g, 'ه')
      // Dash variants: titles mix ASCII hyphen with en and em dashes.
      .replace(/[‐-―−]/g, '-')
      // Collapse all whitespace, including non-breaking spaces.
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
  );
}

/** Accept when the title contains ANY of these terms. Normalised, so case and Arabic
 *  diacritics do not matter. */
export function titleContains(...terms: string[]): Rule {
  const needles = terms.map(normalizeForMatch);
  return {
    name: `title contains any of [${terms.join(' | ')}]`,
    test: (v: Video) => {
      const hay = normalizeForMatch(v.title);
      return needles.some((n) => hay.includes(n));
    },
  };
}

/** Accept only when the title contains NONE of these terms. */
export function titleExcludes(...terms: string[]): Rule {
  const needles = terms.map(normalizeForMatch);
  return {
    name: `title excludes [${terms.join(' | ')}]`,
    test: (v: Video) => {
      const hay = normalizeForMatch(v.title);
      return !needles.some((n) => hay.includes(n));
    },
  };
}

/**
 * Raw regex against the untouched title. Deliberately does NOT normalise, so it stays a
 * precise escape hatch. For Arabic prefer titleContains, which does.
 */
export function titleMatches(pattern: RegExp): Rule {
  return { name: `title matches ${pattern}`, test: (v: Video) => pattern.test(v.title) };
}

export function descriptionContains(...terms: string[]): Rule {
  const needles = terms.map(normalizeForMatch);
  return {
    name: `description contains any of [${terms.join(' | ')}]`,
    test: (v: Video) => {
      const hay = normalizeForMatch(v.description);
      return needles.some((n) => hay.includes(n));
    },
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
