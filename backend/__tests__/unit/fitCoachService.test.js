/**
 * Tests for the /fit coach service.
 *
 * The interesting assertions are the safety ones: red flags must short-circuit
 * *before* any model call, and severe pain must never be answered with
 * training advice. The rest pin the payload bounding (a runaway client can't
 * blow up the prompt or the credit estimate) and the tolerant parsing.
 */

const {
  HEALTH_DISCLAIMER,
  SEE_A_PROFESSIONAL_SEVERITY,
  detectRedFlags,
  normalizePayload,
  buildCoachMessages,
  extractJson,
  parseCoachAdvice,
  describePain,
  getCoachAdvice,
} = require('../../services/fitCoachService');

const basePayload = (overrides = {}) => ({
  profile: {
    goal: 'muscle',
    level: 'intermediate',
    daysPerWeek: 4,
    sessionMinutes: 45,
    equipment: ['gym', 'running'],
    units: 'kg',
    heightCm: 180,
    bodyWeight: 82,
    lifts: { bench: { weight: 80, reps: 5 } },
  },
  plan: { days: [{ name: 'Push', focus: 'Chest', items: [{ name: 'Barbell bench press', prescription: '4 × 6–8', load: '72.5 kg' }] }] },
  sessions: [{ date: '2026-09-08', dayName: 'Push', sets: 16, volume: 6200, cardioMinutes: 0, rpe: '8', notes: '' }],
  runs: [{ date: '2026-09-07', distance: 5, unit: 'km', minutes: 31, effort: 5, pain: '' }],
  checkIns: [{ date: '2026-09-09', weight: 82 }],
  pain: { area: 'knee', severity: 3, timing: 'after training', notes: 'Dull ache the next morning.' },
  ...overrides,
});

describe('normalizePayload', () => {
  it('bounds strings and list lengths so a client cannot inflate the prompt', () => {
    const payload = normalizePayload({
      profile: { equipment: Array(50).fill('gym'), lifts: { bench: { weight: 80, reps: 5 } } },
      sessions: Array(500).fill({ notes: 'x'.repeat(5000) }),
      runs: Array(500).fill({ pain: 'y'.repeat(5000) }),
      checkIns: Array(500).fill({ weight: 80 }),
      pain: { notes: 'z'.repeat(5000) },
    });

    expect(payload.profile.equipment).toHaveLength(8);
    expect(payload.sessions).toHaveLength(20);
    expect(payload.runs).toHaveLength(20);
    expect(payload.checkIns).toHaveLength(30);
    expect(payload.sessions[0].notes.length).toBeLessThanOrEqual(800);
    expect(payload.pain.notes.length).toBeLessThanOrEqual(800);
  });

  it('clamps numbers into a physically possible range', () => {
    const payload = normalizePayload({
      profile: { heightCm: 5000, bodyWeight: -4, daysPerWeek: 99, sessionMinutes: 100000 },
      pain: { severity: 400 },
    });
    expect(payload.profile.heightCm).toBe(260);
    // A negative body weight is "unknown", not a clamped 20 kg athlete.
    expect(payload.profile.bodyWeight).toBeNull();
    expect(payload.profile.daysPerWeek).toBe(7);
    expect(payload.profile.sessionMinutes).toBe(180);
    expect(payload.pain.severity).toBe(10);
  });

  it('keeps only the five reference lifts, with a sane default rep count', () => {
    const payload = normalizePayload({
      profile: { lifts: { bench: 80, squat: { weight: 120 }, nonsense: 999, curl: 40 } },
    });
    expect(Object.keys(payload.profile.lifts).sort()).toEqual(['bench', 'squat']);
    expect(payload.profile.lifts.bench).toEqual({ weight: 80, reps: 5 });
    expect(payload.profile.lifts.squat).toEqual({ weight: 120, reps: 5 });
  });

  it('drops check-ins that carry no weight and normalises unknown units', () => {
    const payload = normalizePayload({
      profile: { units: 'stone' },
      runs: [{ unit: 'furlong' }],
      checkIns: [{ date: '2026-09-09' }, { date: '2026-09-10', weight: 80 }],
    });
    expect(payload.checkIns).toHaveLength(1);
    expect(payload.profile.units).toBe('kg');
    expect(payload.runs[0].unit).toBe('km');
  });

  it('survives completely empty input', () => {
    const payload = normalizePayload();
    expect(payload.sessions).toEqual([]);
    expect(payload.profile.lifts).toEqual({});
    expect(detectRedFlags(payload)).toEqual([]);
  });
});

describe('detectRedFlags', () => {
  it.each([
    ['chest pain when I run', 'chest pain or pressure'],
    ['I get numbness in my hand', 'numbness or tingling'],
    ['the pain travels down the leg', 'pain radiating down a limb'],
    ['my knee gives way on stairs', 'a joint giving way'],
    ['it wakes me at night', 'pain that wakes you at night'],
    ['I fainted last week', 'fainting or blackouts'],
    ['sharp pain after the car accident', 'pain after a fall or impact'],
    ['I am 14 weeks pregnant', 'pregnancy'],
    ['my doctor said I have a heart condition', 'a diagnosed heart or clotting condition'],
  ])('flags "%s"', (note, expected) => {
    const payload = normalizePayload(basePayload({ pain: { area: 'knee', severity: 2, notes: note } }));
    expect(detectRedFlags(payload)).toContain(expected);
  });

  it('reads flags out of run notes and session notes too, not just the pain field', () => {
    const runPayload = normalizePayload(basePayload({ runs: [{ pain: 'chest tightness on hills' }] }));
    expect(detectRedFlags(runPayload)).toContain('chest pain or pressure');

    const sessionPayload = normalizePayload(basePayload({ sessions: [{ notes: 'tingling in my fingers' }] }));
    expect(detectRedFlags(sessionPayload)).toContain('numbness or tingling');
  });

  it('does not flag ordinary training notes', () => {
    const payload = normalizePayload(
      basePayload({
        pain: { area: 'knee', severity: 2, notes: 'Tired legs, a bit sore after squats.' },
        sessions: [{ notes: 'Felt strong. Sore the next day as expected.' }],
      })
    );
    expect(detectRedFlags(payload)).toEqual([]);
  });
});

describe('buildCoachMessages', () => {
  const messages = buildCoachMessages(normalizePayload(basePayload()));

  it('sends a system prompt that forbids diagnosis and training through pain', () => {
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toMatch(/NOT a doctor/i);
    expect(messages[0].content).toMatch(/never tell anyone to train through sharp pain/i);
    expect(messages[0].content).toMatch(/ONLY a JSON object/i);
  });

  it('includes the athlete data the advice is supposed to be based on', () => {
    const user = messages[1].content;
    expect(messages[1].role).toBe('user');
    expect(user).toContain('Body weight: 82 kg');
    expect(user).toContain('bench 80 kg × 5');
    expect(user).toContain('Barbell bench press');
    expect(user).toContain('5 km in 31 min');
    expect(user).toContain('Severity: 3/10');
  });

  it('says so plainly when a section has no data instead of omitting it', () => {
    const sparse = buildCoachMessages(normalizePayload({ profile: {} }));
    expect(sparse[1].content).toContain('No sessions logged yet.');
    expect(sparse[1].content).toContain('No runs logged yet.');
    expect(sparse[1].content).toContain('No body-weight check-ins yet.');
    expect(sparse[1].content).toContain('Nothing reported.');
  });

  it('appends a free-text question when the athlete asks one', () => {
    const withQuestion = buildCoachMessages(normalizePayload(basePayload({ question: 'Should I deload?' })));
    expect(withQuestion[1].content).toContain('ATHLETE QUESTION');
    expect(withQuestion[1].content).toContain('Should I deload?');
  });

  it('describes pain and non-pain truthfully', () => {
    expect(describePain({ area: 'none', severity: null, timing: '', notes: '' })).toBe('Nothing reported.');
    expect(describePain({ area: 'knee', severity: 3, timing: 'after', notes: 'ache' })).toBe(
      'Area: knee\nSeverity: 3/10\nWhen: after\nNotes: ache'
    );
  });
});

describe('extractJson', () => {
  it('reads a bare object', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('reads an object out of fenced or chatty output', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Sure! Here you go:\n{"a":{"b":2}}\nHope that helps.')).toEqual({ a: { b: 2 } });
  });

  it('is not fooled by braces inside strings', () => {
    expect(extractJson('{"note":"use { and } carefully","n":2}')).toEqual({ note: 'use { and } carefully', n: 2 });
  });

  it('returns null when there is nothing to read', () => {
    expect(extractJson('no json here')).toBeNull();
    expect(extractJson(undefined)).toBeNull();
    expect(extractJson('{"unterminated": true')).toBeNull();
  });
});

describe('parseCoachAdvice', () => {
  it('coerces a good reply into the response contract', () => {
    const advice = parseCoachAdvice(
      JSON.stringify({
        summary: 'Add a little load to the press.',
        loadAdjustments: [{ exercise: 'Barbell bench press', suggestion: 'Go 75 kg for 4 × 6.' }],
        running: 'Keep the easy runs easy.',
        recovery: ['Sleep 8 hours', 42, ''],
        watchOuts: ['Left knee'],
        seeAProfessional: false,
        seeAProfessionalReason: '',
      })
    );

    expect(advice.summary).toBe('Add a little load to the press.');
    expect(advice.loadAdjustments).toEqual([
      { exercise: 'Barbell bench press', suggestion: 'Go 75 kg for 4 × 6.' },
    ]);
    expect(advice.recovery).toEqual(['Sleep 8 hours']);
    expect(advice.watchOuts).toEqual(['Left knee']);
    expect(advice.seeAProfessional).toBe(false);
  });

  it('caps the number of items a model can return', () => {
    const advice = parseCoachAdvice(
      JSON.stringify({
        summary: 'x',
        loadAdjustments: Array(50).fill({ exercise: 'a', suggestion: 'b' }),
        recovery: Array(50).fill('c'),
        watchOuts: Array(50).fill('d'),
      })
    );
    expect(advice.loadAdjustments).toHaveLength(6);
    expect(advice.recovery).toHaveLength(5);
    expect(advice.watchOuts).toHaveLength(5);
  });

  it('drops malformed adjustments but keeps the rest of the advice', () => {
    const advice = parseCoachAdvice(
      JSON.stringify({ summary: 'ok', loadAdjustments: [{ exercise: 'squat' }, { suggestion: 'go lighter' }, 'nope'] })
    );
    expect(advice.loadAdjustments).toEqual([]);
    expect(advice.summary).toBe('ok');
  });

  it('turns prose into a usable summary rather than an error', () => {
    const advice = parseCoachAdvice('  Your pressing volume is high; back off a set next week.  ');
    expect(advice.summary).toBe('Your pressing volume is high; back off a set next week.');
    expect(advice.loadAdjustments).toEqual([]);
  });

  it('returns null for a reply with nothing usable in it', () => {
    expect(parseCoachAdvice('')).toBeNull();
    expect(parseCoachAdvice('{}')).toBeNull();
    expect(parseCoachAdvice(undefined)).toBeNull();
  });
});

describe('getCoachAdvice', () => {
  it('calls the model and returns parsed advice with usage', async () => {
    const complete = jest.fn().mockResolvedValue({
      choices: [{ message: { content: '{"summary":"Back off one set on pressing.","watchOuts":["Left knee"]}' } }],
      usage: { prompt_tokens: 900, completion_tokens: 120 },
      provider: 'bedrock',
    });

    const result = await getCoachAdvice(basePayload(), { complete });

    expect(complete).toHaveBeenCalledTimes(1);
    expect(result.screened).toBe(false);
    expect(result.provider).toBe('bedrock');
    expect(result.advice.summary).toBe('Back off one set on pressing.');
    expect(result.usage).toEqual({ prompt_tokens: 900, completion_tokens: 120 });
  });

  it('never calls the model when a red flag is reported', async () => {
    const complete = jest.fn();
    const result = await getCoachAdvice(
      basePayload({ pain: { area: 'chest', severity: 4, notes: 'Chest pain and shortness of breath on the last run.' } }),
      { complete }
    );

    expect(complete).not.toHaveBeenCalled();
    expect(result.screened).toBe(true);
    expect(result.provider).toBe('screened');
    expect(result.advice.seeAProfessional).toBe(true);
    expect(result.advice.seeAProfessionalReason).toMatch(/chest pain or pressure/i);
    expect(result.advice.seeAProfessionalReason).toMatch(/breathlessness/i);
    expect(result.advice.summary).toMatch(/health professional/i);
    expect(result.advice.loadAdjustments).toEqual([]);
  });

  it(`never calls the model at or above ${SEE_A_PROFESSIONAL_SEVERITY}/10 pain`, async () => {
    const complete = jest.fn();
    const result = await getCoachAdvice(
      basePayload({ pain: { area: 'lower back', severity: SEE_A_PROFESSIONAL_SEVERITY, notes: 'Sharp.' } }),
      { complete }
    );

    expect(complete).not.toHaveBeenCalled();
    expect(result.screened).toBe(true);
    expect(result.advice.seeAProfessionalReason).toContain('7/10');
  });

  it('still gives advice for ordinary soreness', async () => {
    const complete = jest.fn().mockResolvedValue({
      choices: [{ message: { content: '{"summary":"Swap to a leg curl for a week."}' } }],
      usage: { prompt_tokens: 10, completion_tokens: 10 },
    });
    const result = await getCoachAdvice(basePayload({ pain: { area: 'knee', severity: 4, notes: 'Sore after squats.' } }), {
      complete,
    });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(result.screened).toBe(false);
  });

  it('throws rather than inventing advice when the model returns nothing usable', async () => {
    const complete = jest.fn().mockResolvedValue({ choices: [{ message: { content: '   ' } }] });
    await expect(getCoachAdvice(basePayload(), { complete })).rejects.toThrow(/no usable advice/i);
  });

  it('exposes a disclaimer that tells the athlete this is not medical advice', () => {
    expect(HEALTH_DISCLAIMER).toMatch(/not medical advice/i);
    expect(HEALTH_DISCLAIMER).toMatch(/health professional/i);
  });
});
