/**
 * Pure logic for resolving the dynamic homepage title from an admin-defined
 * rule set + the current visitor's context. Kept dependency-free (no AWS,
 * no Express) so it can be unit tested directly.
 *
 * Settings shape:
 * {
 *   defaultTitle: string,
 *   rules: [
 *     {
 *       id: string,
 *       enabled: boolean,
 *       priority: number,      // lower number = evaluated first
 *       type: 'nickname' | 'email' | 'country' | 'region' | 'city'
 *           | 'loggedIn' | 'guest' | 'newUser' | 'plan',
 *       match: string,         // case-insensitive "contains" match value.
 *                               // For 'newUser', the max account age in days.
 *                               // Ignored for 'loggedIn' / 'guest'.
 *       title: string,         // title to show when this rule matches
 *     },
 *     ...
 *   ]
 * }
 *
 * Context shape (all optional):
 * {
 *   isLoggedIn: boolean,
 *   nickname: string,
 *   email: string,
 *   plan: string,
 *   accountCreatedAt: string | Date,
 *   country: string,
 *   region: string,
 *   city: string,
 * }
 */

const FALLBACK_TITLE = "It's simple.";

const RULE_TYPES = [
  'nickname',
  'email',
  'country',
  'region',
  'city',
  'loggedIn',
  'guest',
  'newUser',
  'plan',
];

/** Case-insensitive "does haystack contain needle" check, tolerant of missing values. */
function containsMatch(haystack, needle) {
  if (!needle) return false;
  if (!haystack) return false;
  return String(haystack).toLowerCase().includes(String(needle).toLowerCase());
}

function ruleMatches(rule, context = {}) {
  switch (rule.type) {
    case 'nickname':
      return containsMatch(context.nickname, rule.match);
    case 'email':
      return containsMatch(context.email, rule.match);
    case 'country':
      return containsMatch(context.country, rule.match);
    case 'region':
      return containsMatch(context.region, rule.match);
    case 'city':
      return containsMatch(context.city, rule.match);
    case 'plan':
      return containsMatch(context.plan, rule.match);
    case 'loggedIn':
      return !!context.isLoggedIn;
    case 'guest':
      return !context.isLoggedIn;
    case 'newUser': {
      if (!context.accountCreatedAt) return false;
      const maxDays = parseFloat(rule.match);
      if (!Number.isFinite(maxDays) || maxDays <= 0) return false;
      const createdAt = new Date(context.accountCreatedAt);
      if (Number.isNaN(createdAt.getTime())) return false;
      const ageDays = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
      return ageDays >= 0 && ageDays <= maxDays;
    }
    default:
      return false;
  }
}

/**
 * Resolve the title to display for a given visitor context.
 * Rules are evaluated in ascending `priority` order; the first enabled rule
 * whose condition matches wins. Falls back to settings.defaultTitle, and
 * finally to the hard-coded FALLBACK_TITLE if nothing else is available.
 *
 * @returns {{ title: string, matchedRuleId: string|null }}
 */
function resolveHomeTitle(settings, context = {}) {
  const defaultTitle = (settings && settings.defaultTitle) || FALLBACK_TITLE;
  const rules = Array.isArray(settings?.rules) ? settings.rules : [];

  const sorted = [...rules]
    .filter((r) => r && r.enabled !== false && r.title)
    .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));

  for (const rule of sorted) {
    try {
      if (ruleMatches(rule, context)) {
        return { title: rule.title, matchedRuleId: rule.id || null };
      }
    } catch {
      // Skip malformed rules rather than failing the whole request
      continue;
    }
  }

  return { title: defaultTitle, matchedRuleId: null };
}

/**
 * Validate/sanitize a settings object submitted from the admin UI.
 * Throws an Error with a human-readable message on invalid input.
 */
function validateHomeTitleSettings(input) {
  if (!input || typeof input !== 'object') {
    throw new Error('Settings object is required');
  }

  const defaultTitle = typeof input.defaultTitle === 'string' ? input.defaultTitle.trim() : '';
  if (!defaultTitle) {
    throw new Error('defaultTitle is required');
  }
  if (defaultTitle.length > 200) {
    throw new Error('defaultTitle must be 200 characters or fewer');
  }

  const rawRules = Array.isArray(input.rules) ? input.rules : [];
  if (rawRules.length > 100) {
    throw new Error('Too many rules (max 100)');
  }

  const rules = rawRules.map((rule, idx) => {
    if (!rule || typeof rule !== 'object') {
      throw new Error(`Rule at index ${idx} is invalid`);
    }
    if (!RULE_TYPES.includes(rule.type)) {
      throw new Error(`Rule at index ${idx} has an invalid type: ${rule.type}`);
    }
    const title = typeof rule.title === 'string' ? rule.title.trim() : '';
    if (!title) {
      throw new Error(`Rule at index ${idx} is missing a title`);
    }
    if (title.length > 200) {
      throw new Error(`Rule at index ${idx} title must be 200 characters or fewer`);
    }
    const needsMatch = !['loggedIn', 'guest'].includes(rule.type);
    const match = typeof rule.match === 'string' ? rule.match.trim() : '';
    if (needsMatch && !match) {
      throw new Error(`Rule at index ${idx} (${rule.type}) requires a match value`);
    }
    if (match.length > 200) {
      throw new Error(`Rule at index ${idx} match value must be 200 characters or fewer`);
    }

    return {
      id: typeof rule.id === 'string' && rule.id ? rule.id : `rule_${Date.now()}_${idx}`,
      enabled: rule.enabled !== false,
      priority: Number.isFinite(rule.priority) ? rule.priority : idx,
      type: rule.type,
      match,
      title,
    };
  });

  return { defaultTitle, rules };
}

module.exports = {
  FALLBACK_TITLE,
  RULE_TYPES,
  resolveHomeTitle,
  validateHomeTitleSettings,
};
