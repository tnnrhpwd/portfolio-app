import {
  DAY_COUNT_OPTIONS,
  DEFAULT_PROFILE,
  EQUIPMENT_OPTIONS,
  EXERCISES,
  GOAL_OPTIONS,
  LOCATIONS,
  buildPlan,
  buildPlanNotes,
  canPerform,
  createRng,
  dayCardioMinutes,
  dayItemCount,
  dayRunItems,
  dayTimedItems,
  equipmentForLocation,
  estimatedMinutes,
  formatPrescription,
  getExercise,
  planLocations,
  resolveEquipment,
  topOfRepRange,
} from './fitProgram';

const GYM_ONLY_KIT = { ...DEFAULT_PROFILE, equipment: ['gym', 'barbell'], level: 'intermediate' };
const FULL_KIT = { ...DEFAULT_PROFILE, equipment: ['gym', 'barbell', 'dumbbells', 'pullup-bar', 'running'] };
const HOME_ONLY = { ...DEFAULT_PROFILE, equipment: ['dumbbells', 'pullup-bar'] };
const BODYWEIGHT_ONLY = { ...DEFAULT_PROFILE, equipment: [] };

const allItems = (plan) => plan.days.flatMap((day) => day.blocks.flatMap((block) => block.items));
const blockItems = (day, type) =>
  day.blocks.filter((block) => block.type === type).flatMap((block) => block.items);
const tagsOf = (items) => items.flatMap((item) => item.tags || []);

/** Run targets normally come from `fitLoads.runAdvice`; buildPlan only needs the shape. */
const RUN_ADVICE = [
  { exerciseId: 'run-easy', name: 'Easy run', minutes: 25, distance: 4.2, distanceUnit: 'km', prescription: '25 min · ≈4.2 km', cue: 'Conversational pace.' },
  { exerciseId: 'run-tempo', name: 'Tempo run', minutes: 25, distance: null, distanceUnit: null, prescription: '25 min', cue: 'Comfortably hard.' },
];

describe('equipment is a set, not a choice', () => {
  it('offers every place someone might train, including the barbell+bench kit', () => {
    const ids = EQUIPMENT_OPTIONS.map((option) => option.id);
    expect(ids).toEqual(expect.arrayContaining(['gym', 'barbell', 'dumbbells', 'pullup-bar', 'bodyweight', 'running']));
    EQUIPMENT_OPTIONS.forEach((option) => {
      expect(option.label).toEqual(expect.stringMatching(/\w/));
      expect(option.hint).toEqual(expect.stringMatching(/\w/));
    });
  });

  it('always includes bodyweight, because you always have a floor', () => {
    expect(resolveEquipment([]).has('bodyweight')).toBe(true);
    expect(resolveEquipment(['dumbbells']).has('bodyweight')).toBe(true);
  });

  it('treats a full gym as including the barbell', () => {
    expect(resolveEquipment(['gym']).has('barbell')).toBe(true);
    expect(resolveEquipment(['dumbbells']).has('barbell')).toBe(false);
    // Ticking the barbell explicitly still works on its own (a home rack).
    expect(canPerform(getExercise('bench'), resolveEquipment(['barbell']))).toBe(true);
  });

  it('ignores unknown ids rather than letting them unlock movements', () => {
    const available = resolveEquipment(['dumbbells', 'spaceship']);
    expect(available.has('dumbbells')).toBe(true);
    expect(available.has('spaceship')).toBe(false);
  });

  it('only unlocks a movement when *every* thing it needs is ticked', () => {
    const dumbbellsOnly = resolveEquipment(['dumbbells']);
    expect(canPerform(getExercise('db-bench'), dumbbellsOnly)).toBe(true);
    expect(canPerform(getExercise('bench'), dumbbellsOnly)).toBe(false);
    expect(canPerform(getExercise('pullup'), dumbbellsOnly)).toBe(false);
    expect(canPerform(getExercise('pushup'), dumbbellsOnly)).toBe(true);
  });
});

describe('planLocations', () => {
  it('sends the whole week home when there is no gym equipment', () => {
    expect(planLocations({ equipment: ['dumbbells'], daysPerWeek: 4 })).toEqual(['home', 'home', 'home', 'home']);
  });

  it('keeps the whole week at the gym when there is no home kit', () => {
    expect(planLocations({ equipment: ['gym', 'barbell'], daysPerWeek: 5 })).toEqual([
      'gym',
      'gym',
      'gym',
      'gym',
      'gym',
    ]);
  });

  it('splits the rotation when both exist, so busy days can be trained at home', () => {
    const locations = planLocations({ equipment: ['gym', 'dumbbells'], daysPerWeek: 6 });
    expect(locations).toEqual(['gym', 'gym', 'gym', 'home', 'home', 'home']);
  });

  it('strips gym-only kit from a home day but keeps the rest', () => {
    const home = equipmentForLocation(['gym', 'barbell', 'dumbbells', 'running'], 'home');
    expect(home.has('gym')).toBe(false);
    expect(home.has('barbell')).toBe(false);
    expect(home.has('dumbbells')).toBe(true);
    expect(home.has('running')).toBe(true);
  });
});

describe('buildPlan — split shape', () => {
  it.each(DAY_COUNT_OPTIONS)('generates one day per requested session (%i days)', (daysPerWeek) => {
    const plan = buildPlan({ ...FULL_KIT, daysPerWeek }, 7);
    expect(plan.days).toHaveLength(daysPerWeek);
    expect(plan.days.map((day) => day.order)).toEqual(Array.from({ length: daysPerWeek }, (_, i) => i + 1));
    plan.days.forEach((day) => expect(['gym', 'home']).toContain(day.location));
  });

  it('always starts from a Push → Pull → Legs rotation', () => {
    const plan = buildPlan({ ...FULL_KIT, daysPerWeek: 3 }, 1);
    expect(plan.days.map((day) => day.name)).toEqual(['Push', 'Pull', 'Legs']);
  });

  it('runs the rotation twice with A/B variations on a 6-day week', () => {
    const plan = buildPlan({ ...FULL_KIT, daysPerWeek: 6 }, 3);
    expect(plan.days.map((day) => day.name)).toEqual(['Push A', 'Pull A', 'Legs A', 'Push B', 'Pull B', 'Legs B']);
  });

  it('adds a run day rather than inventing a fourth body-part day', () => {
    const plan = buildPlan({ ...FULL_KIT, daysPerWeek: 4 }, 11, { runningAdvice: RUN_ADVICE });
    expect(plan.days.map((day) => day.key)).toEqual(['push', 'pull', 'legs', 'conditioning']);
    expect(plan.days[3].name).toBe('Run');
    const runs = dayRunItems(plan.days[3]);
    expect(runs.length).toBe(RUN_ADVICE.length);
    runs.forEach((run) => {
      expect(run.minutes).toBeGreaterThan(0);
      expect(run.prescription).toEqual(expect.stringMatching(/\d/));
    });
  });

  it('never calls a day a run day without run targets, so the name matches the content', () => {
    // Without advice the conditioning slot stays machine cardio. The name has to
    // follow, or the card says "Run" over a stationary bike.
    const plan = buildPlan({ ...FULL_KIT, daysPerWeek: 4 }, 11);
    expect(plan.days[3].name).toBe('Cardio & Core');
    expect(dayRunItems(plan.days[3])).toEqual([]);
    expect(blockItems(plan.days[3], 'cardio').length).toBeGreaterThan(0);
  });

  it('does not prescribe running to someone who did not tick it', () => {
    const plan = buildPlan({ ...GYM_ONLY_KIT, daysPerWeek: 5 }, 4, { runningAdvice: RUN_ADVICE });
    plan.days.forEach((day) => expect(dayRunItems(day)).toEqual([]));
  });

  it('falls back to machine cardio when there is nowhere to run', () => {
    const plan = buildPlan({ ...GYM_ONLY_KIT, daysPerWeek: 4 }, 11, { runningAdvice: RUN_ADVICE });
    const conditioning = plan.days[3];
    expect(conditioning.name).toBe('Cardio & Core');
    expect(dayRunItems(conditioning)).toEqual([]);
    expect(blockItems(conditioning, 'cardio').length).toBeGreaterThan(0);
  });

  it('gives 5-day weeks an upper-body top-up and a run day', () => {
    const plan = buildPlan({ ...FULL_KIT, daysPerWeek: 5 }, 5);
    expect(plan.days.map((day) => day.key)).toEqual(['push', 'pull', 'legs', 'upper', 'conditioning']);
  });

  it('sets a weekly target one below the request once the week gets long', () => {
    expect(buildPlan({ ...FULL_KIT, daysPerWeek: 3 }, 1).weeklyTarget).toBe(3);
    expect(buildPlan({ ...FULL_KIT, daysPerWeek: 4 }, 1).weeklyTarget).toBe(4);
    expect(buildPlan({ ...FULL_KIT, daysPerWeek: 5 }, 1).weeklyTarget).toBe(4);
    expect(buildPlan({ ...FULL_KIT, daysPerWeek: 6 }, 1).weeklyTarget).toBe(5);
  });
});

describe('buildPlan — session content', () => {
  const plan = buildPlan({ ...FULL_KIT, daysPerWeek: 4 }, 42);

  it('opens every day with a warm-up and closes the lifting days with accessories', () => {
    plan.days.forEach((day) => {
      expect(day.blocks[0].type).toBe('warmup');
      expect(day.blocks[0].note).toEqual(expect.stringMatching(/\w/));
      if (day.key !== 'conditioning') {
        expect(day.blocks.some((block) => block.type === 'accessory')).toBe(true);
      }
    });
  });

  it('builds the Push day around a horizontal and a vertical press', () => {
    const anchorTags = tagsOf(blockItems(plan.days[0], 'lift'));
    expect(anchorTags).toContain('chest');
    expect(anchorTags).toContain('front-delts');
    expect(tagsOf(blockItems(plan.days[0], 'accessory'))).toContain('triceps');
  });

  it('pairs the Pull day with a hinge and covers the biceps and rear delts', () => {
    const pull = plan.days[1];
    expect(blockItems(pull, 'lift').length).toBe(2);
    const accessoryTags = tagsOf(blockItems(pull, 'accessory'));
    expect(accessoryTags).toContain('biceps');
    expect(accessoryTags).toContain('rear-delts');
  });

  it('covers hamstrings and calves on the Legs day', () => {
    const accessoryTags = tagsOf(blockItems(plan.days[2], 'accessory'));
    expect(accessoryTags).toContain('hamstrings');
    expect(accessoryTags).toContain('calves');
  });

  it('sprinkles core work onto the pull and legs days, not a dedicated ab day', () => {
    const coreDays = plan.days.filter((day) => blockItems(day, 'core').length > 0).map((day) => day.key);
    expect(coreDays).toEqual(expect.arrayContaining(['pull', 'legs']));
  });

  it('never prescribes a movement the ticked equipment cannot support', () => {
    [
      ['gym', 'barbell', 'dumbbells', 'pullup-bar', 'running'],
      ['dumbbells', 'pullup-bar'],
      ['dumbbells'],
      [],
    ].forEach((equipment) => {
      const plan = buildPlan({ ...DEFAULT_PROFILE, equipment, daysPerWeek: 5 }, 9);
      plan.days.forEach((day) => {
        const available = equipmentForLocation(equipment, day.location);
        day.blocks
          .flatMap((block) => block.items)
          .forEach((item) => {
            const exercise = getExercise(item.exerciseId);
            expect(exercise).not.toBeNull();
            expect(canPerform(exercise, available)).toBe(true);
          });
      });
    });
  });

  it('still produces a usable bodyweight-only week', () => {
    const plan = buildPlan({ ...BODYWEIGHT_ONLY, daysPerWeek: 3 }, 4);
    plan.days.forEach((day) => expect(blockItems(day, 'lift').length).toBeGreaterThan(0));
    const used = allItems(plan)
      .filter((item) => item.muscle !== 'cardio')
      .map((item) => getExercise(item.exerciseId));
    used.forEach((exercise) => expect(exercise.needs).toEqual([]));
  });

  it('keeps a home day free of gym-only kit even when the athlete also has a gym', () => {
    const plan = buildPlan({ ...FULL_KIT, daysPerWeek: 6 }, 2);
    const homeDays = plan.days.filter((day) => day.location === 'home');
    expect(homeDays.length).toBeGreaterThan(0);
    homeDays.forEach((day) => {
      const items = day.blocks.flatMap((block) => block.items);
      items.forEach((item) => {
        const exercise = getExercise(item.exerciseId);
        expect(exercise.needs).not.toContain('gym');
        expect(exercise.needs).not.toContain('barbell');
      });
    });
  });
});

describe('buildPlan — timed holds, goals, and cardio dosing', () => {
  it('gives every timed hold a seconds target for the athlete’s level', () => {
    // Which core movements a seed picks is a shuffle, so assert the property
    // across seeds rather than hoping one particular seed lands a plank.
    let sawAnyHold = false;
    for (let seed = 1; seed <= 12; seed += 1) {
      buildPlan({ ...FULL_KIT, daysPerWeek: 5 }, seed).days.forEach((day) => {
        allItems({ days: [day] })
          .filter((item) => item.holdSeconds)
          .forEach((item) => {
            sawAnyHold = true;
            expect(item.holdSeconds).toBeGreaterThanOrEqual(20);
          });
      });
    }
    expect(sawAnyHold).toBe(true);

    // And the level actually changes the target, deterministically.
    expect(getExercise('plank').hold.beginner).toBeLessThan(getExercise('plank').hold.advanced);
    const plans = ['beginner', 'advanced'].map((level) => buildPlan({ ...FULL_KIT, level, daysPerWeek: 5 }, 3));
    const holdsByLevel = plans.map((plan) =>
      allItems(plan)
        .filter((item) => item.name === 'Plank')
        .map((item) => item.holdSeconds)
    );
    holdsByLevel.forEach((holds) => holds.forEach((seconds) => expect([30, 45, 60]).toContain(seconds)));
  });

  it('prescribes sets × seconds for a hold and never a rep range', () => {
    const plan = buildPlan({ ...FULL_KIT, daysPerWeek: 3 }, 21);
    const hold = allItems(plan).find((item) => item.holdSeconds);
    expect(hold.reps).toBe(1);
    expect(formatPrescription(hold)).toBe(`${hold.sets} × ${hold.holdSeconds}s hold`);
  });

  it('exposes the timed holds per day for the hold timer', () => {
    // Which core movements a seed picks is a shuffle, so assert the property
    // across seeds rather than hoping one particular seed lands a plank.
    let sawAnyHold = false;
    for (let seed = 1; seed <= 12; seed += 1) {
      const plan = buildPlan({ ...FULL_KIT, daysPerWeek: 5 }, seed);
      plan.days.forEach((day) => {
        dayTimedItems(day).forEach((item) => {
          sawAnyHold = true;
          expect(item.holdSeconds).toBeGreaterThan(0);
          expect(item.timed).toBe(true);
        });
      });
    }
    expect(sawAnyHold).toBe(true);
  });

  it('prescribes heavy triples-and-fives for a strength goal', () => {
    const plan = buildPlan({ ...FULL_KIT, goal: 'strength' }, 6);
    const anchors = blockItems(plan.days[0], 'lift');
    const strength = GOAL_OPTIONS.find((goal) => goal.id === 'strength');
    anchors.forEach((item) => {
      expect(item.sets).toBe(strength.anchorSets);
      expect(item.reps).toBe('3–5');
      expect(item.restSeconds).toBeGreaterThanOrEqual(180);
    });
  });

  it('doses more running for a fat-loss goal than for a strength goal', () => {
    const lean = buildPlan({ ...FULL_KIT, goal: 'lean', daysPerWeek: 4 }, 6, { runningAdvice: RUN_ADVICE });
    const strength = buildPlan({ ...FULL_KIT, goal: 'strength', daysPerWeek: 4 }, 6, { runningAdvice: RUN_ADVICE });
    expect(lean.profile.goal).toBe('lean');
    expect(dayRunItems(lean.days[3]).length).toBeGreaterThan(0);
    expect(dayRunItems(strength.days[3]).length).toBeGreaterThan(0);
    expect(lean.notes.join(' ')).toContain('3 easy sessions');
    expect(strength.notes.join(' ')).toContain('2 easy sessions');
  });

  it('gives a beginner fewer sets than an advanced lifter on the same goal', () => {
    const beginner = buildPlan({ ...FULL_KIT, level: 'beginner', daysPerWeek: 3 }, 8);
    const advanced = buildPlan({ ...FULL_KIT, level: 'advanced', daysPerWeek: 3 }, 8);
    const setsOf = (plan) => blockItems(plan.days[0], 'lift').reduce((total, item) => total + item.sets, 0);
    expect(setsOf(beginner)).toBeLessThan(setsOf(advanced));
  });

  it('skips the interval finisher entirely when the goal says no sprint work', () => {
    const plan = buildPlan({ ...FULL_KIT, goal: 'strength', daysPerWeek: 3 }, 6);
    plan.days.forEach((day) => {
      expect(day.blocks.some((block) => block.title.startsWith('Finisher'))).toBe(false);
    });
  });

  it('totals the cardio the plan actually schedules', () => {
    const plan = buildPlan({ ...FULL_KIT, daysPerWeek: 4 }, 13, { runningAdvice: RUN_ADVICE });
    const total = plan.days.reduce((sum, day) => sum + dayCardioMinutes(day), 0);
    expect(total).toBeGreaterThan(0);
    expect(plan.runMinutes).toBe(total);
  });
});

describe('buildPlan — determinism and notes', () => {
  it('is reproducible from a seed, so the plan on screen is the plan under test', () => {
    const a = buildPlan(FULL_KIT, 1234);
    const b = buildPlan(FULL_KIT, 1234);
    expect({ ...a, generatedAt: null }).toEqual({ ...b, generatedAt: null });
  });

  it('gives a different week for a different seed', () => {
    const ids = (plan) => allItems(plan).map((item) => item.exerciseId);
    expect(ids(buildPlan(FULL_KIT, 1))).not.toEqual(ids(buildPlan(FULL_KIT, 2)));
  });

  it('createRng repeats itself exactly and only for the same seed', () => {
    const first = createRng(99);
    const second = createRng(99);
    const a = [first(), first(), first()];
    expect([second(), second(), second()]).toEqual(a);
    expect([createRng(100)(), createRng(100)(), createRng(100)()]).not.toEqual(a);
  });

  it('explains where the starting weights came from', () => {
    const bodyweightPlan = buildPlan(FULL_KIT, 5);
    expect(bodyweightPlan.weightsFrom).toBeNull();
    expect(bodyweightPlan.notes.join(' ')).toMatch(/Deload every 6–8 weeks/);

    const computed = { ...bodyweightPlan, weightsFrom: 'bodyweight', runMinutes: 0 };
    expect(buildPlanNotes(computed).join(' ')).toMatch(/estimated from your body weight/i);
    expect(buildPlanNotes({ ...computed, weightsFrom: 'entered' }).join(' ')).toMatch(/working sets you entered/i);
  });

  it('says so when no equipment at all was ticked', () => {
    const plan = buildPlan(BODYWEIGHT_ONLY, 1);
    expect(plan.notes.join(' ')).toMatch(/bodyweight only/i);
  });
});

describe('exercise library', () => {
  it('has unique ids so a generated week can be keyed and logged reliably', () => {
    const ids = EXERCISES.map((exercise) => exercise.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every movement a slot, a tier, tags, a cue, and needs it can satisfy', () => {
    const validNeeds = ['gym', 'barbell', 'dumbbells', 'pullup-bar', 'running'];
    EXERCISES.forEach((exercise) => {
      expect(['push', 'pull', 'legs', 'core', 'cardio', 'run']).toContain(exercise.slot);
      expect(['anchor', 'accessory', 'steady', 'interval']).toContain(exercise.tier);
      expect(exercise.tags.length).toBeGreaterThan(0);
      expect(exercise.cue).toEqual(expect.stringMatching(/\w/));
      exercise.needs.forEach((need) => expect(validNeeds).toContain(need));
      // A movement is either weighted (with a reference lift) or bodyweight.
      if (exercise.load) {
        expect(['bench', 'squat', 'deadlift', 'ohp', 'row']).toContain(exercise.load.ref);
        expect(exercise.load.factor).toBeGreaterThan(0);
      } else {
        expect(exercise.bodyweight || exercise.timed).toBe(true);
      }
    });
  });

  it('gives every bodyweight movement a regression or progression note', () => {
    EXERCISES.filter((exercise) => exercise.bodyweight).forEach((exercise) => {
      expect(exercise.bwNote).toEqual(expect.stringMatching(/\w/));
    });
  });

  it('defines a seconds target for every timed hold, for every level', () => {
    EXERCISES.filter((exercise) => exercise.timed && exercise.hold).forEach((exercise) => {
      ['beginner', 'intermediate', 'advanced'].forEach((level) => {
        expect(exercise.hold[level]).toBeGreaterThan(0);
      });
      expect(exercise.hold.advanced).toBeGreaterThanOrEqual(exercise.hold.beginner);
    });
  });
});

describe('prescription helpers', () => {
  it('formats sets × reps, holds, and explicit prescriptions', () => {
    expect(formatPrescription({ sets: 4, reps: '6–8' })).toBe('4 × 6–8');
    expect(formatPrescription({ sets: 3, holdSeconds: 45 })).toBe('3 × 45s hold');
    expect(formatPrescription({ sets: 3, prescription: '25 min easy' })).toBe('25 min easy');
    expect(formatPrescription(null)).toBe('');
  });

  it('reads the top of a rep range so a log sheet can be pre-filled', () => {
    expect(topOfRepRange('6–8')).toBe(8);
    expect(topOfRepRange('12-15')).toBe(15);
    expect(topOfRepRange(10)).toBe(10);
    expect(topOfRepRange('')).toBe(10);
  });

  it('estimates session length from sets, rest, holds, and timed blocks', () => {
    expect(estimatedMinutes([{ sets: 4, restSeconds: 150 }])).toBeGreaterThan(8);
    expect(estimatedMinutes([{ sets: 0, restSeconds: 0, timed: true, minutes: 30 }])).toBe(38);
    // A hold costs its seconds plus the rest, not a nominal half-minute a set.
    const withHold = estimatedMinutes([{ sets: 3, holdSeconds: 60, restSeconds: 45 }]);
    expect(withHold).toBeGreaterThan(estimatedMinutes([{ sets: 3, restSeconds: 45 }]));
  });

  it('counts a day’s movements', () => {
    const plan = buildPlan(FULL_KIT, 3);
    expect(dayItemCount(plan.days[0])).toBe(dayItemCount(plan.days[0]));
    expect(dayItemCount(plan.days[0])).toBeGreaterThan(0);
    expect(dayItemCount(null)).toBe(0);
  });

  it('names its locations', () => {
    expect(LOCATIONS.gym.label).toBe('At the gym');
    expect(LOCATIONS.home.label).toBe('At home');
  });
});
