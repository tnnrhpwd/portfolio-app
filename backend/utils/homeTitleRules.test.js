const { resolveHomeTitle, validateHomeTitleSettings } = require('./homeTitleRules');

describe('resolveHomeTitle', () => {
  it('returns the default title when there are no rules', () => {
    const result = resolveHomeTitle({ defaultTitle: 'Hello.', rules: [] }, {});
    expect(result).toEqual({ title: 'Hello.', matchedRuleId: null });
  });

  it('falls back to the hard-coded title when settings are missing entirely', () => {
    const result = resolveHomeTitle(null, {});
    expect(result.title).toBe("It's simple.");
  });

  it('matches a nickname rule case-insensitively', () => {
    const settings = {
      defaultTitle: 'Default.',
      rules: [
        { id: 'r1', enabled: true, priority: 1, type: 'nickname', match: 'tanner', title: 'Hey Tanner!' },
      ],
    };
    const result = resolveHomeTitle(settings, { isLoggedIn: true, nickname: 'Tannerhpwd' });
    expect(result).toEqual({ title: 'Hey Tanner!', matchedRuleId: 'r1' });
  });

  it('matches IP country rules', () => {
    const settings = {
      defaultTitle: 'Default.',
      rules: [
        { id: 'r1', enabled: true, priority: 1, type: 'country', match: 'CA', title: 'Welcome, Canada!' },
      ],
    };
    const result = resolveHomeTitle(settings, { country: 'CA' });
    expect(result.title).toBe('Welcome, Canada!');
  });

  it('respects priority order — lower priority number wins first', () => {
    const settings = {
      defaultTitle: 'Default.',
      rules: [
        { id: 'low', enabled: true, priority: 5, type: 'guest', match: '', title: 'Low priority' },
        { id: 'high', enabled: true, priority: 1, type: 'guest', match: '', title: 'High priority' },
      ],
    };
    const result = resolveHomeTitle(settings, { isLoggedIn: false });
    expect(result.title).toBe('High priority');
  });

  it('skips disabled rules', () => {
    const settings = {
      defaultTitle: 'Default.',
      rules: [
        { id: 'r1', enabled: false, priority: 1, type: 'guest', match: '', title: 'Should be skipped' },
      ],
    };
    const result = resolveHomeTitle(settings, { isLoggedIn: false });
    expect(result.title).toBe('Default.');
  });

  it('matches loggedIn vs guest rules correctly', () => {
    const settings = {
      defaultTitle: 'Default.',
      rules: [
        { id: 'in', enabled: true, priority: 1, type: 'loggedIn', match: '', title: 'Welcome back!' },
        { id: 'out', enabled: true, priority: 2, type: 'guest', match: '', title: 'Welcome, guest!' },
      ],
    };
    expect(resolveHomeTitle(settings, { isLoggedIn: true }).title).toBe('Welcome back!');
    expect(resolveHomeTitle(settings, { isLoggedIn: false }).title).toBe('Welcome, guest!');
  });

  it('matches newUser rules based on account age', () => {
    const settings = {
      defaultTitle: 'Default.',
      rules: [
        { id: 'new', enabled: true, priority: 1, type: 'newUser', match: '7', title: 'Welcome new user!' },
      ],
    };
    const recentDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    expect(resolveHomeTitle(settings, { accountCreatedAt: recentDate }).title).toBe('Welcome new user!');
    expect(resolveHomeTitle(settings, { accountCreatedAt: oldDate }).title).toBe('Default.');
  });

  it('ignores malformed rules without throwing', () => {
    const settings = { defaultTitle: 'Default.', rules: [{ id: 'bad' }] };
    expect(() => resolveHomeTitle(settings, {})).not.toThrow();
    expect(resolveHomeTitle(settings, {}).title).toBe('Default.');
  });
});

describe('validateHomeTitleSettings', () => {
  it('throws when defaultTitle is missing', () => {
    expect(() => validateHomeTitleSettings({ rules: [] })).toThrow('defaultTitle is required');
  });

  it('throws on an invalid rule type', () => {
    expect(() => validateHomeTitleSettings({
      defaultTitle: 'X',
      rules: [{ type: 'bogus', title: 'y', match: 'z' }],
    })).toThrow(/invalid type/);
  });

  it('throws when a rule needing a match value is missing one', () => {
    expect(() => validateHomeTitleSettings({
      defaultTitle: 'X',
      rules: [{ type: 'nickname', title: 'y', match: '' }],
    })).toThrow(/requires a match value/);
  });

  it('does not require a match value for loggedIn/guest rules', () => {
    const result = validateHomeTitleSettings({
      defaultTitle: 'X',
      rules: [{ type: 'guest', title: 'Hi guest' }],
    });
    expect(result.rules[0].match).toBe('');
  });

  it('normalizes valid settings, assigning ids and defaults', () => {
    const result = validateHomeTitleSettings({
      defaultTitle: '  Hello there.  ',
      rules: [{ type: 'nickname', match: 'tanner', title: 'Hi!' }],
    });
    expect(result.defaultTitle).toBe('Hello there.');
    expect(result.rules[0].id).toBeTruthy();
    expect(result.rules[0].enabled).toBe(true);
  });
});
