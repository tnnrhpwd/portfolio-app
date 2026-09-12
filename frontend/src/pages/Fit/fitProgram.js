/**
 * fitProgram.js — the training engine behind /fit.
 *
 * Pure and deterministic: (profile, seed) in, a complete week out. Two things
 * make it more than a random workout generator:
 *
 *   1. **The Push / Pull / Legs spine.** Each day is organised around a
 *      movement *pattern* (horizontal push, vertical pull, hinge…) rather than
 *      a body part, which is what actually drives progress. The rotation
 *      scales from 3 days (one pass) to 6 (two passes, A/B), and extra days
 *      are *added slots* — an upper-body top-up, a run day — never a
 *      reinvention of the split.
 *   2. **Equipment is a set, not a choice.** An athlete can tick "full gym" and
 *      "dumbbells at home" and get a week that trains in the gym on some days
 *      and at home on others (`location` on each day). A movement is available
 *      when *every* item it needs is ticked.
 *
 * Loads (the actual kilos) deliberately are not here — they live in
 * `fitLoads.js`, because they depend on the athlete's body weight and logged
 * working sets, and because re-computing a load should never reshuffle the
 * week's exercise selection.
 */

// ── Equipment ────────────────────────────────────────────────────────────
// Multi-select. `bodyweight` is always available (you always have a floor); it
// is listed anyway so the UI can say so out loud instead of silently adding
// push-ups to a dumbbell-only week.
export const EQUIPMENT_OPTIONS = [
  {
    id: 'gym',
    label: 'Full gym',
    hint: 'Machines, cables, and everything below — including the barbell',
  },
  {
    id: 'barbell',
    label: 'Barbell + bench',
    hint: 'The long bar you load with plates — bench press, squat rack, deadlifts',
  },
  {
    id: 'dumbbells',
    label: 'Dumbbells at home',
    hint: 'A pair of dumbbells and ideally a bench',
  },
  {
    id: 'pullup-bar',
    label: 'Pull-up bar',
    hint: 'A bar to hang from — doorway or wall mounted',
  },
  {
    id: 'bodyweight',
    label: 'Bodyweight only',
    hint: 'Always included — you always have a floor',
  },
  {
    id: 'running',
    label: 'Running / outdoors',
    hint: 'Somewhere to run, plus hills if you have them',
  },
];

export const EQUIPMENT_IDS = EQUIPMENT_OPTIONS.map((option) => option.id);

/** Equipment that only exists in a gym — dropped when a day is marked "home". */
const GYM_ONLY = ['gym', 'barbell'];

/**
 * Bodyweight is implicit (you always have a floor) and a full gym implies a
 * barbell — ticking "Full gym" without a barbell in the rack is not a thing.
 * A `.gym`-only selection therefore still gets the barbell work, which also
 * keeps a legacy `equipment: 'gym'` payload correct after migration.
 */
export function resolveEquipment(selected = []) {
  const set = new Set(['bodyweight']);
  (Array.isArray(selected) ? selected : []).forEach((id) => {
    if (EQUIPMENT_IDS.includes(id)) set.add(id);
  });
  if (set.has('gym')) set.add('barbell');
  return set;
}

/** Can this athlete do this movement with the equipment they ticked? */
export function canPerform(exercise, available) {
  return (exercise.needs || []).every((need) => available.has(need));
}

/** Where a session is meant to happen — shown as a badge on each day card. */
export const LOCATIONS = {
  gym: { id: 'gym', label: 'At the gym' },
  home: { id: 'home', label: 'At home' },
};

// ── Goals & levels ───────────────────────────────────────────────────────
export const GOAL_OPTIONS = [
  {
    id: 'muscle',
    label: 'Build muscle',
    hint: 'Moderate reps, more sets, moderate rest',
    anchorSets: 4,
    anchorReps: '6–8',
    accessorySets: 3,
    accessoryReps: '10–12',
    restAnchor: 150,
    restAccessory: 75,
    finishersPerWeek: 1,
    runsPerWeek: 2,
    easyMinutes: 25,
  },
  {
    id: 'strength',
    label: 'Get stronger',
    hint: 'Heavier sets of 3–5 on the main lifts',
    anchorSets: 5,
    anchorReps: '3–5',
    accessorySets: 3,
    accessoryReps: '8–10',
    restAnchor: 210,
    restAccessory: 90,
    finishersPerWeek: 0,
    runsPerWeek: 2,
    easyMinutes: 30,
  },
  {
    id: 'lean',
    label: 'Lose fat',
    hint: 'Higher reps, shorter rest, more running',
    anchorSets: 3,
    anchorReps: '8–10',
    accessorySets: 3,
    accessoryReps: '12–15',
    restAnchor: 120,
    restAccessory: 60,
    finishersPerWeek: 1,
    runsPerWeek: 3,
    easyMinutes: 30,
  },
  {
    id: 'general',
    label: 'General fitness',
    hint: 'Balanced strength and conditioning',
    anchorSets: 3,
    anchorReps: '8–10',
    accessorySets: 2,
    accessoryReps: '10–15',
    restAnchor: 120,
    restAccessory: 60,
    finishersPerWeek: 1,
    runsPerWeek: 2,
    easyMinutes: 25,
  },
  {
    id: 'endurance',
    label: 'Run further',
    hint: 'Lifting holds the muscle, running is the priority',
    anchorSets: 3,
    anchorReps: '6–8',
    accessorySets: 2,
    accessoryReps: '10–12',
    restAnchor: 150,
    restAccessory: 60,
    finishersPerWeek: 0,
    runsPerWeek: 4,
    easyMinutes: 35,
  },
];

export const LEVEL_OPTIONS = [
  {
    id: 'beginner',
    label: 'Beginner',
    hint: 'New to training, or back after a long break',
    setBias: -1,
    accessoryBias: -1,
    rir: '3–4 reps in reserve',
    jump: 'Add one rep per set each week before you add any weight.',
  },
  {
    id: 'intermediate',
    label: 'Intermediate',
    hint: '6+ months of consistent training',
    setBias: 0,
    accessoryBias: 0,
    rir: '2–3 reps in reserve',
    jump: 'Add 2.5 kg once every set hits the top of the rep range.',
  },
  {
    id: 'advanced',
    label: 'Advanced',
    hint: 'Years of training, chasing PRs',
    setBias: 1,
    accessoryBias: 0,
    rir: '1–2 reps in reserve',
    jump: 'Add 2.5 kg on upper-body lifts and 5 kg on lower-body lifts once you hit the top of the range.',
  },
];

export const DAY_COUNT_OPTIONS = [3, 4, 5, 6];

export const SESSION_LENGTH_OPTIONS = [
  { id: 30, label: '30 min', accessories: 2 },
  { id: 45, label: '45 min', accessories: 3 },
  { id: 60, label: '60 min', accessories: 3 },
  { id: 75, label: '75 min', accessories: 4 },
];

export const DEFAULT_PROFILE = {
  goal: 'muscle',
  level: 'intermediate',
  daysPerWeek: 4,
  sessionMinutes: 45,
  equipment: ['gym', 'barbell', 'running'],
  heightCm: '',
  bodyWeight: '',
  lifts: {},
};

// ── Movement library ─────────────────────────────────────────────────────
// needs   equipment ids the movement requires (empty = floor only)
// load    how to derive a starting weight: { ref, factor, step } — see fitLoads
// hold    seconds to aim for per experience level (timed movements)
// tags    muscles worked, used to guarantee a session is balanced
export const EXERCISES = [
  // ── Push: anchors ──
  { id: 'bench', name: 'Barbell bench press', slot: 'push', tier: 'anchor', needs: ['barbell'], load: { ref: 'bench', factor: 1, step: 'barbell' }, tags: ['chest', 'triceps'], cue: 'Shoulder blades pinned, bar to sternum.' },
  { id: 'incline-bench', name: 'Incline barbell press', slot: 'push', tier: 'anchor', needs: ['barbell'], load: { ref: 'bench', factor: 0.85, step: 'barbell' }, tags: ['chest', 'front-delts'], cue: '30–45° bench, bar over the collarbone.' },
  { id: 'ohp', name: 'Standing overhead press', slot: 'push', tier: 'anchor', needs: ['barbell'], load: { ref: 'ohp', factor: 1, step: 'barbell' }, tags: ['front-delts', 'triceps'], cue: 'Brace hard, no lower-back lean.' },
  { id: 'db-bench', name: 'Dumbbell bench press', slot: 'push', tier: 'anchor', needs: ['dumbbells'], load: { ref: 'bench', factor: 0.85, step: 'dumbbell', perHand: true }, tags: ['chest', 'triceps'], cue: 'Elbows ~45° from your ribs.' },
  { id: 'db-incline', name: 'Incline dumbbell press', slot: 'push', tier: 'anchor', needs: ['dumbbells'], load: { ref: 'bench', factor: 0.7, step: 'dumbbell', perHand: true }, tags: ['chest', 'front-delts'], cue: 'Press up and slightly together.' },
  { id: 'db-ohp', name: 'Seated dumbbell press', slot: 'push', tier: 'anchor', needs: ['dumbbells'], load: { ref: 'ohp', factor: 0.8, step: 'dumbbell', perHand: true }, tags: ['front-delts', 'triceps'], cue: 'Wrists stacked over elbows.' },
  { id: 'pushup', name: 'Push-up', slot: 'push', tier: 'anchor', needs: [], bodyweight: true, tags: ['chest', 'triceps'], cue: 'Body in one line, full lockout.', bwNote: 'Hands on a bench to make it easier, feet raised to make it harder.' },
  { id: 'deficit-pushup', name: 'Feet-elevated push-up', slot: 'push', tier: 'anchor', needs: [], bodyweight: true, tags: ['chest', 'front-delts'], cue: 'Feet on a chair to shift load upward.', bwNote: 'Raise the feet a little at a time — a step up is a real jump in difficulty.' },
  { id: 'dip', name: 'Parallel bar dip', slot: 'push', tier: 'anchor', needs: ['gym'], bodyweight: true, tags: ['chest', 'triceps'], cue: 'Slight forward lean, stop when the shoulders drop below the elbows.', bwNote: 'Use the assisted machine or a band until you own 8 clean reps.' },

  // ── Push: accessories ──
  { id: 'lateral-raise', name: 'Dumbbell lateral raise', slot: 'push', tier: 'accessory', needs: ['dumbbells'], load: { ref: 'ohp', factor: 0.16, step: 'dumbbell', perHand: true }, tags: ['side-delts'], cue: 'Lead with the elbow, stop at shoulder height.' },
  { id: 'cable-fly', name: 'Cable chest fly', slot: 'push', tier: 'accessory', needs: ['gym'], load: { ref: 'bench', factor: 0.22, step: 'machine' }, tags: ['chest'], cue: 'Stack setting per side. Squeeze, then let the arms travel back slowly.', unilateral: true },
  { id: 'db-fly', name: 'Dumbbell fly', slot: 'push', tier: 'accessory', needs: ['dumbbells'], load: { ref: 'bench', factor: 0.3, step: 'dumbbell', perHand: true }, tags: ['chest'], cue: 'Soft elbows, wide arc, no pressing.' },
  { id: 'machine-press', name: 'Machine chest press', slot: 'push', tier: 'accessory', needs: ['gym'], load: { ref: 'bench', factor: 0.85, step: 'machine' }, tags: ['chest'], cue: 'Handles at nipple height.' },
  { id: 'rope-pushdown', name: 'Rope triceps pushdown', slot: 'push', tier: 'accessory', needs: ['gym'], load: { ref: 'bench', factor: 0.35, step: 'machine' }, tags: ['triceps'], cue: 'Elbows glued to your sides, spread the rope.' },
  { id: 'oh-triceps', name: 'Overhead dumbbell extension', slot: 'push', tier: 'accessory', needs: ['dumbbells'], load: { ref: 'ohp', factor: 0.35, step: 'dumbbell' }, tags: ['triceps'], cue: 'Stretch long at the bottom.' },
  { id: 'bench-dip', name: 'Bench dip', slot: 'push', tier: 'accessory', needs: [], bodyweight: true, tags: ['triceps'], cue: 'Hips close to the bench, elbows back.', bwNote: 'Bend the knees to make it easier, straighten the legs to make it harder.' },
  { id: 'diamond-pushup', name: 'Diamond push-up', slot: 'push', tier: 'accessory', needs: [], bodyweight: true, tags: ['triceps', 'chest'], cue: 'Hands together under the sternum.', bwNote: 'Do it on an incline (hands on a bench) if your elbows complain.' },
  { id: 'arnold-press', name: 'Arnold press', slot: 'push', tier: 'accessory', needs: ['dumbbells'], load: { ref: 'ohp', factor: 0.8, step: 'dumbbell', perHand: true }, tags: ['front-delts', 'side-delts'], cue: 'Rotate smoothly, no jerking.' },

  // ── Pull: anchors ──
  { id: 'deadlift', name: 'Conventional deadlift', slot: 'pull', tier: 'anchor', needs: ['barbell'], load: { ref: 'deadlift', factor: 1, step: 'barbell' }, tags: ['back', 'hamstrings', 'glutes'], cue: 'Bar over mid-foot, chest up, push the floor away.' },
  { id: 'bb-row', name: 'Barbell row', slot: 'pull', tier: 'anchor', needs: ['barbell'], load: { ref: 'row', factor: 1, step: 'barbell' }, tags: ['back', 'biceps'], cue: 'Torso ~45°, bar to the belly button.' },
  { id: 'pullup', name: 'Pull-up', slot: 'pull', tier: 'anchor', needs: ['pullup-bar'], bodyweight: true, tags: ['back', 'biceps'], cue: 'Full hang, chin over the bar.', bwNote: 'Cannot do 5 clean reps? Use a band, or do 5 slow negatives.' },
  { id: 'chinup', name: 'Chin-up', slot: 'pull', tier: 'anchor', needs: ['pullup-bar'], bodyweight: true, tags: ['back', 'biceps'], cue: 'Palms toward you, elbows down and back.', bwNote: 'Chin-ups are usually easier than pull-ups — start here.' },
  { id: 'lat-pulldown', name: 'Lat pulldown', slot: 'pull', tier: 'anchor', needs: ['gym'], load: { ref: 'row', factor: 0.85, step: 'machine' }, tags: ['back', 'biceps'], cue: 'Pull the bar to your collarbone, not your chin.' },
  { id: 'db-row', name: 'One-arm dumbbell row', slot: 'pull', tier: 'anchor', needs: ['dumbbells'], load: { ref: 'row', factor: 0.45, step: 'dumbbell', perHand: true }, tags: ['back', 'biceps'], cue: 'Flat back, drive the elbow past your ribs.' },
  { id: 'inverted-row', name: 'Inverted row', slot: 'pull', tier: 'anchor', needs: ['pullup-bar'], bodyweight: true, tags: ['back', 'biceps'], cue: 'Body straight, chest to the bar.', bwNote: 'A higher bar makes it easier; feet on a box makes it harder.' },
  { id: 'table-row', name: 'Table row', slot: 'pull', tier: 'anchor', needs: [], bodyweight: true, tags: ['back', 'biceps'], cue: 'Lie under a sturdy table, grip the edge, pull your chest up to it.', bwNote: 'Any solid edge works — a table, a counter, a low wall. Bend the knees to make it easier.' },
  { id: 'chest-supported-row', name: 'Chest-supported row', slot: 'pull', tier: 'anchor', needs: ['dumbbells'], load: { ref: 'row', factor: 0.4, step: 'dumbbell', perHand: true }, tags: ['back', 'rear-delts'], cue: 'Chest stays on the pad — no momentum.' },

  // ── Pull: accessories ──
  { id: 'face-pull', name: 'Face pull', slot: 'pull', tier: 'accessory', needs: ['gym'], load: { ref: 'row', factor: 0.3, step: 'machine' }, tags: ['rear-delts'], cue: 'Pull to the forehead, thumbs back.' },
  { id: 'rear-delt-fly', name: 'Dumbbell rear-delt fly', slot: 'pull', tier: 'accessory', needs: ['dumbbells'], load: { ref: 'row', factor: 0.14, step: 'dumbbell', perHand: true }, tags: ['rear-delts'], cue: 'Light weight, lead with the pinky.' },
  { id: 'cable-row', name: 'Seated cable row', slot: 'pull', tier: 'accessory', needs: ['gym'], load: { ref: 'row', factor: 0.8, step: 'machine' }, tags: ['back'], cue: 'Chest tall, no rocking.' },
  { id: 'straight-arm', name: 'Straight-arm pulldown', slot: 'pull', tier: 'accessory', needs: ['gym'], load: { ref: 'row', factor: 0.35, step: 'machine' }, tags: ['back'], cue: 'Arms straight, feel the lats stretch.' },
  { id: 'band-pullapart', name: 'Band pull-apart', slot: 'pull', tier: 'accessory', needs: [], bodyweight: true, tags: ['rear-delts'], cue: 'Arms straight, squeeze the shoulder blades.', bwNote: 'Any band works, and light is correct — this is for shoulder health.' },
  { id: 'bb-curl', name: 'Barbell curl', slot: 'pull', tier: 'accessory', needs: ['barbell'], load: { ref: 'row', factor: 0.28, step: 'barbell' }, tags: ['biceps'], cue: 'Elbows pinned, no swinging.' },
  { id: 'db-curl', name: 'Dumbbell curl', slot: 'pull', tier: 'accessory', needs: ['dumbbells'], load: { ref: 'row', factor: 0.24, step: 'dumbbell', perHand: true }, tags: ['biceps'], cue: 'Supinate as you lift.' },
  { id: 'hammer-curl', name: 'Hammer curl', slot: 'pull', tier: 'accessory', needs: ['dumbbells'], load: { ref: 'row', factor: 0.26, step: 'dumbbell', perHand: true }, tags: ['biceps'], cue: 'Neutral grip, control the lowering.' },
  { id: 'shrug', name: 'Barbell shrug', slot: 'pull', tier: 'accessory', needs: ['barbell'], load: { ref: 'deadlift', factor: 0.55, step: 'barbell' }, tags: ['traps'], cue: 'Straight up, no rolling.' },

  // ── Legs: anchors ──
  { id: 'squat', name: 'Back squat', slot: 'legs', tier: 'anchor', needs: ['barbell'], load: { ref: 'squat', factor: 1, step: 'barbell' }, tags: ['quads', 'glutes'], cue: 'Brace, sit between your hips, knees track over toes.' },
  { id: 'front-squat', name: 'Front squat', slot: 'legs', tier: 'anchor', needs: ['barbell'], load: { ref: 'squat', factor: 0.8, step: 'barbell' }, tags: ['quads'], cue: 'Elbows high, torso upright.' },
  { id: 'rdl', name: 'Romanian deadlift', slot: 'legs', tier: 'anchor', needs: ['barbell'], load: { ref: 'deadlift', factor: 0.7, step: 'barbell' }, tags: ['hamstrings', 'glutes'], cue: 'Hips back, bar grazing the legs, stop at mid-shin.' },
  { id: 'db-rdl', name: 'Dumbbell Romanian deadlift', slot: 'legs', tier: 'anchor', needs: ['dumbbells'], load: { ref: 'deadlift', factor: 0.45, step: 'dumbbell', perHand: true }, tags: ['hamstrings', 'glutes'], cue: 'Push the hips back, keep the ribs down.' },
  { id: 'leg-press', name: 'Leg press', slot: 'legs', tier: 'anchor', needs: ['gym'], load: { ref: 'squat', factor: 1.3, step: 'machine' }, tags: ['quads', 'glutes'], cue: 'Feet shoulder width, never lock out hard.' },
  { id: 'split-squat', name: 'Bulgarian split squat', slot: 'legs', tier: 'anchor', needs: ['dumbbells'], load: { ref: 'squat', factor: 0.28, step: 'dumbbell', perHand: true }, tags: ['quads', 'glutes'], cue: 'Front shin vertical, drop straight down.', unilateral: true },
  { id: 'goblet-squat', name: 'Goblet squat', slot: 'legs', tier: 'anchor', needs: ['dumbbells'], load: { ref: 'squat', factor: 0.3, step: 'dumbbell' }, tags: ['quads', 'glutes'], cue: 'Elbows inside the knees at the bottom.' },
  { id: 'bw-squat', name: 'Bodyweight squat', slot: 'legs', tier: 'anchor', needs: [], bodyweight: true, tags: ['quads', 'glutes'], cue: 'Slow down, full depth.', bwNote: 'Too easy? Pause for two seconds at the bottom of every rep.' },
  { id: 'lunge', name: 'Walking lunge', slot: 'legs', tier: 'anchor', needs: [], bodyweight: true, tags: ['quads', 'glutes'], cue: 'Long stride, knee to the floor.', unilateral: true, bwNote: 'Hold dumbbells once bodyweight lunges feel easy.' },
  { id: 'hip-thrust', name: 'Hip thrust', slot: 'legs', tier: 'anchor', needs: ['barbell'], load: { ref: 'squat', factor: 0.7, step: 'barbell' }, tags: ['glutes'], cue: 'Chin tucked, squeeze at the top.' },

  // ── Legs: accessories ──
  { id: 'leg-curl', name: 'Leg curl', slot: 'legs', tier: 'accessory', needs: ['gym'], load: { ref: 'squat', factor: 0.45, step: 'machine' }, tags: ['hamstrings'], cue: 'Control the return — that is where the growth is.' },
  { id: 'nordic', name: 'Nordic hamstring curl', slot: 'legs', tier: 'accessory', needs: [], bodyweight: true, tags: ['hamstrings'], cue: 'Lower as slowly as you can control.', bwNote: 'Anchor your heels under something solid, or use a leg-curl machine.' },
  { id: 'db-ham-curl', name: 'Dumbbell hamstring curl', slot: 'legs', tier: 'accessory', needs: ['dumbbells'], load: { ref: 'squat', factor: 0.25, step: 'dumbbell' }, tags: ['hamstrings'], cue: 'Hips high, squeeze hard.' },
  { id: 'leg-extension', name: 'Leg extension', slot: 'legs', tier: 'accessory', needs: ['gym'], load: { ref: 'squat', factor: 0.55, step: 'machine' }, tags: ['quads'], cue: 'Pause a beat at the top.' },
  { id: 'step-up', name: 'Dumbbell step-up', slot: 'legs', tier: 'accessory', needs: ['dumbbells'], load: { ref: 'squat', factor: 0.3, step: 'dumbbell', perHand: true }, tags: ['quads', 'glutes'], cue: 'Drive through the whole foot.', unilateral: true },
  { id: 'calf-raise', name: 'Standing calf raise', slot: 'legs', tier: 'accessory', needs: ['dumbbells'], load: { ref: 'squat', factor: 0.6, step: 'dumbbell' }, tags: ['calves'], cue: 'Full stretch at the bottom, pause at the top.' },
  { id: 'seated-calf', name: 'Seated calf raise', slot: 'legs', tier: 'accessory', needs: ['gym'], load: { ref: 'squat', factor: 0.45, step: 'machine' }, tags: ['calves'], cue: 'Knees bent hits the soleus — go slow.' },
  { id: 'bw-calf', name: 'Single-leg calf raise', slot: 'legs', tier: 'accessory', needs: [], bodyweight: true, tags: ['calves'], cue: 'Hold a wall, go all the way up.', unilateral: true, bwNote: 'Do the slow version: 2 s up, 2 s hold, 3 s down.' },
  { id: 'hip-abduction', name: 'Hip abduction', slot: 'legs', tier: 'accessory', needs: ['gym'], load: { ref: 'squat', factor: 0.4, step: 'machine' }, tags: ['glutes'], cue: 'Lean forward slightly, control the return.' },

  // ── Core (timed holds carry a seconds target per level) ──
  { id: 'plank', name: 'Plank', slot: 'core', tier: 'accessory', needs: [], bodyweight: true, timed: true, hold: { beginner: 30, intermediate: 45, advanced: 60 }, tags: ['core'], cue: 'Ribs down, glutes tight — quality over time.', bwNote: 'End the set when your hips drop, not when the clock says so.' },
  { id: 'side-plank', name: 'Side plank', slot: 'core', tier: 'accessory', needs: [], bodyweight: true, timed: true, hold: { beginner: 20, intermediate: 30, advanced: 40 }, tags: ['core'], cue: 'Stack the hips, push the floor away.', unilateral: true, bwNote: 'Bend the knees to shorten the lever if 20 s is too much.' },
  { id: 'hollow-hold', name: 'Hollow body hold', slot: 'core', tier: 'accessory', needs: [], bodyweight: true, timed: true, hold: { beginner: 20, intermediate: 30, advanced: 45 }, tags: ['core'], cue: 'Lower back glued down, arms by the ears.', bwNote: 'Tuck the knees in to make it easier.' },
  { id: 'wall-sit', name: 'Wall sit', slot: 'core', tier: 'accessory', needs: [], bodyweight: true, timed: true, hold: { beginner: 30, intermediate: 45, advanced: 75 }, tags: ['core', 'quads'], cue: 'Thighs parallel, back flat on the wall.', bwNote: 'Shallower knees make it easier; a real wall sit is a 90° knee angle.' },
  { id: 'dead-hang', name: 'Dead hang', slot: 'core', tier: 'accessory', needs: ['pullup-bar'], bodyweight: true, timed: true, hold: { beginner: 20, intermediate: 30, advanced: 45 }, tags: ['core', 'back'], cue: 'Relax the shoulders, keep breathing.', bwNote: 'Grip is usually the limiter, and it improves fast.' },
  { id: 'dead-bug', name: 'Dead bug', slot: 'core', tier: 'accessory', needs: [], bodyweight: true, tags: ['core'], cue: 'Low back stays flat on the floor.', bwNote: 'Move one limb at a time if your back arches.' },
  { id: 'hanging-knee-raise', name: 'Hanging knee raise', slot: 'core', tier: 'accessory', needs: ['pullup-bar'], bodyweight: true, tags: ['core'], cue: 'Curl the pelvis, no swinging.', bwNote: 'Do it on the floor instead if you cannot stop the swing.' },
  { id: 'cable-crunch', name: 'Cable crunch', slot: 'core', tier: 'accessory', needs: ['gym'], load: { ref: 'squat', factor: 0.3, step: 'machine' }, tags: ['core'], cue: 'Round the spine — this is not a hip hinge.' },
  { id: 'ab-rollout', name: 'Ab wheel rollout', slot: 'core', tier: 'accessory', needs: ['dumbbells'], bodyweight: true, tags: ['core'], cue: 'Ribs down, go only as far as you can control.', bwNote: 'Start on your knees and stop before your back arches.' },
  { id: 'pallof-press', name: 'Pallof press', slot: 'core', tier: 'accessory', needs: ['gym'], load: { ref: 'row', factor: 0.25, step: 'machine' }, tags: ['core'], cue: 'Resist the rotation, breathe out as you press.' },

  // ── Cardio: machines ──
  { id: 'zone2-bike', name: 'Stationary bike', slot: 'cardio', tier: 'steady', needs: ['gym'], timed: true, tags: ['zone2'], cue: 'Steady effort, cadence 80–90 rpm.' },
  { id: 'zone2-incline-walk', name: 'Incline treadmill walk', slot: 'cardio', tier: 'steady', needs: ['gym'], timed: true, tags: ['zone2'], cue: 'Brisk enough that you can talk but not sing.' },
  { id: 'zone2-row', name: 'Steady row', slot: 'cardio', tier: 'steady', needs: ['gym'], timed: true, tags: ['zone2'], cue: 'Long strokes, at a pace you could hold for an hour.' },
  { id: 'intervals-bike', name: 'Bike intervals', slot: 'cardio', tier: 'interval', needs: ['gym'], timed: true, tags: ['intervals'], cue: '30 s hard / 90 s easy × 8.' },
  { id: 'intervals-row', name: 'Rowing intervals', slot: 'cardio', tier: 'interval', needs: ['gym'], timed: true, tags: ['intervals'], cue: '250 m hard / 250 m easy × 6.' },

  // ── Cardio: no equipment needed, so a home week is never left without a
  // conditioning option just because there is no treadmill in the house. ──
  { id: 'stair-climbs', name: 'Stair climbs', slot: 'cardio', tier: 'steady', needs: [], timed: true, tags: ['zone2'], cue: 'Any staircase, kept moving for the whole block. Walk down, climb up.' },
  { id: 'brisk-walk', name: 'Brisk walk', slot: 'cardio', tier: 'steady', needs: [], timed: true, tags: ['zone2'], cue: 'Add hills when it starts feeling easy.' },
  { id: 'bw-circuit', name: 'Bodyweight circuit', slot: 'cardio', tier: 'interval', needs: [], timed: true, tags: ['intervals'], cue: '40 s each of squats, push-ups, lunges and planks, 60 s rest, 3 rounds.' },
  { id: 'shadow-boxing', name: 'Shadow boxing rounds', slot: 'cardio', tier: 'interval', needs: [], timed: true, tags: ['intervals'], cue: '3 min rounds with 1 min rest — hands up, keep moving.' },

  // ── Cardio: running / outdoors ──
  { id: 'run-easy', name: 'Easy run', slot: 'run', tier: 'steady', needs: ['running'], timed: true, tags: ['zone2', 'run'], cue: 'Conversational pace — you should be able to speak in full sentences.' },
  { id: 'run-long', name: 'Long easy run', slot: 'run', tier: 'steady', needs: ['running'], timed: true, tags: ['zone2', 'run'], cue: 'Slow and long. If you are breathing hard, you are going too fast.' },
  { id: 'run-walk', name: 'Run / walk', slot: 'run', tier: 'steady', needs: ['running'], timed: true, tags: ['zone2', 'run'], cue: '4 min running, 1 min walking, repeat — the walking is part of the training.' },
  { id: 'run-intervals', name: 'Interval run', slot: 'run', tier: 'interval', needs: ['running'], timed: true, tags: ['intervals', 'run'], cue: '1 min hard / 2 min easy × 6, or 8 × 30 s on / 90 s off.' },
  { id: 'run-hills', name: 'Hill repeats', slot: 'run', tier: 'interval', needs: ['running'], timed: true, tags: ['intervals', 'run'], cue: '8–10 s all-out uphill, walk back down. Stop when the effort drops.' },
  { id: 'run-tempo', name: 'Tempo run', slot: 'run', tier: 'interval', needs: ['running'], timed: true, tags: ['intervals', 'run'], cue: '"Comfortably hard" — an effort you could hold for about an hour, not a sprint.' },
  { id: 'walk-brisk', name: 'Brisk walk', slot: 'run', tier: 'steady', needs: ['running'], timed: true, tags: ['zone2'], cue: 'Add hills when it starts feeling easy.' },
];

const BY_ID = EXERCISES.reduce((acc, ex) => {
  acc[ex.id] = ex;
  return acc;
}, {});

export function getExercise(id) {
  return BY_ID[id] || null;
}

// ── Split templates ──────────────────────────────────────────────────────
const ROTATION_DAYS = {
  push: {
    key: 'push',
    name: 'Push',
    focus: 'Chest · Shoulders · Triceps',
    warmup: '5 min easy cardio, 2 × 15 band pull-aparts, then 2 ramp-up sets of the first lift.',
    core: 0,
    finisher: false,
  },
  pull: {
    key: 'pull',
    name: 'Pull',
    focus: 'Back · Rear delts · Biceps',
    warmup: '5 min easy cardio, 2 × 15 band pull-aparts, then 2 ramp-up sets of the first lift.',
    core: 1,
    finisher: false,
  },
  legs: {
    key: 'legs',
    name: 'Legs',
    focus: 'Quads · Hamstrings · Glutes · Calves',
    warmup: '5 min bike, 10 bodyweight squats, 10 hip hinges, then 2 ramp-up sets of the first lift.',
    core: 1,
    finisher: true,
  },
  upper: {
    key: 'upper',
    name: 'Upper',
    focus: 'One push, one pull, arms and shoulders',
    warmup: '5 min easy cardio, arm circles, 2 × 15 band pull-aparts, then 2 ramp-up sets.',
    core: 0,
    finisher: false,
  },
  conditioning: {
    key: 'conditioning',
    name: 'Cardio & Core',
    focus: 'Easy base work plus a short hard block',
    warmup: '3 min easy to warm up, then build into the target effort.',
    core: 1,
    finisher: false,
  },
  run: {
    key: 'conditioning',
    name: 'Run',
    focus: 'Easy base running plus a short hard block',
    warmup: '5 min brisk walk, then 2 min of easy jogging before the first effort.',
    core: 1,
    finisher: false,
  },
};

const SPLITS = {
  3: [ROTATION_DAYS.push, ROTATION_DAYS.pull, ROTATION_DAYS.legs],
  4: [ROTATION_DAYS.push, ROTATION_DAYS.pull, ROTATION_DAYS.legs, ROTATION_DAYS.conditioning],
  5: [ROTATION_DAYS.push, ROTATION_DAYS.pull, ROTATION_DAYS.legs, ROTATION_DAYS.upper, ROTATION_DAYS.conditioning],
  6: [
    { ...ROTATION_DAYS.push, variant: 'A' },
    { ...ROTATION_DAYS.pull, variant: 'A' },
    { ...ROTATION_DAYS.legs, variant: 'A' },
    { ...ROTATION_DAYS.push, variant: 'B' },
    { ...ROTATION_DAYS.pull, variant: 'B' },
    { ...ROTATION_DAYS.legs, variant: 'B' },
  ],
};

/**
 * Where each day of the week happens.
 *
 * With gym *and* home equipment ticked, the rotation is deliberately split: the
 * first pass trains at the gym with the heavy kit, then the later days come
 * home, so a busy week can still be trained from the living room. With no gym
 * equipment ticked, every day is a home day.
 */
export function planLocations({ equipment = [], daysPerWeek = 4 } = {}) {
  const available = resolveEquipment(equipment);
  const hasGym = available.has('gym') || available.has('barbell');
  const hasHome = ['dumbbells', 'pullup-bar', 'running'].some((id) => available.has(id));

  if (!hasGym) return Array.from({ length: daysPerWeek }, () => 'home');
  if (!hasHome) return Array.from({ length: daysPerWeek }, () => 'gym');

  // Three gym sessions is the rotation; anything after that comes home.
  const homeFrom = 3;
  return Array.from({ length: daysPerWeek }, (_, index) => (index >= homeFrom ? 'home' : 'gym'));
}

/** The equipment pool a day is allowed to draw from. */
export function equipmentForLocation(selected, location) {
  const available = resolveEquipment(selected);
  if (location !== 'home') return available;
  const home = new Set(available);
  GYM_ONLY.forEach((id) => home.delete(id));
  return home;
}

// ── Seeded randomness ────────────────────────────────────────────────────
// mulberry32: tiny, fast, and — crucially — reproducible from a seed, so the
// plan the athlete is looking at is the plan the tests assert on.
export function createRng(seed) {
  let a = seed >>> 0 || 1;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(list, rng) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

function take(pool, count, rng, used) {
  const chosen = [];
  for (const ex of shuffled(pool, rng)) {
    if (chosen.length >= count) break;
    if (!used.has(ex.id)) {
      chosen.push(ex);
      used.add(ex.id);
    }
  }
  if (chosen.length < count) {
    for (const ex of shuffled(pool, rng)) {
      if (chosen.length >= count) break;
      if (!chosen.some((c) => c.id === ex.id)) chosen.push(ex);
    }
  }
  return chosen;
}

/**
 * Pick `count` movements, giving each required tag one dedicated slot first.
 * This is why a generated Push day always contains a triceps movement and a
 * Legs day always contains a calf movement, however the shuffle lands.
 */
function takeWithTags(pool, count, rng, used, requiredTags = []) {
  const chosen = [];
  for (const tag of requiredTags) {
    if (chosen.length >= count) break;
    const fresh = pool.filter((ex) => ex.tags.includes(tag) && !used.has(ex.id) && !chosen.some((c) => c.id === ex.id));
    const fallback = pool.filter((ex) => ex.tags.includes(tag) && !chosen.some((c) => c.id === ex.id));
    const match = shuffled(fresh, rng)[0] || shuffled(fallback, rng)[0];
    if (match) {
      chosen.push(match);
      used.add(match.id);
    }
  }
  const rest = pool.filter((ex) => !chosen.some((c) => c.id === ex.id));
  return chosen.concat(take(rest, Math.max(0, count - chosen.length), rng, used));
}

// ── Prescription ─────────────────────────────────────────────────────────
export function formatPrescription(item) {
  if (!item) return '';
  if (item.prescription) return item.prescription;
  if (item.holdSeconds) return `${item.sets} × ${item.holdSeconds}s hold`;
  return `${item.sets} × ${item.reps}`;
}

/** Turn "6–8" into 8 so a fresh log sheet can be pre-filled sensibly. */
export function topOfRepRange(reps) {
  if (typeof reps === 'number') return reps;
  const matches = String(reps || '').match(/\d+/g);
  if (!matches || matches.length === 0) return 10;
  return Number(matches[matches.length - 1]) || 10;
}

export function estimatedMinutes(items, warmupMinutes = 8) {
  const total = items.reduce((sum, item) => {
    const workMinutes = item.holdSeconds
      ? ((Number(item.sets) || 0) * (item.holdSeconds + 45)) / 60
      : (Number(item.sets) || 0) * 0.5;
    const restMinutes = Math.max(0, (Number(item.sets) || 0) - 1) * ((Number(item.restSeconds) || 60) / 60);
    const timed = item.timed && item.minutes && !item.holdSeconds ? Number(item.minutes) : 0;
    return sum + Math.max(timed, workMinutes + restMinutes);
  }, 0);
  return Math.round(warmupMinutes + total);
}

function repScheme(goal, level, tier) {
  if (tier === 'anchor') {
    return {
      sets: Math.max(2, goal.anchorSets + level.setBias),
      reps: goal.anchorReps,
      restSeconds: goal.restAnchor,
    };
  }
  return {
    sets: Math.max(2, goal.accessorySets + level.accessoryBias),
    reps: goal.accessoryReps,
    restSeconds: goal.restAccessory,
  };
}

function accessoryCount(profile) {
  const option = SESSION_LENGTH_OPTIONS.find((o) => o.id === Number(profile.sessionMinutes));
  return option ? option.accessories : 3;
}

function poolFor(available, slot, tier) {
  return EXERCISES.filter((ex) => ex.slot === slot && ex.tier === tier && canPerform(ex, available));
}

function toLiftItem(goal, level, exercise) {
  const scheme = repScheme(goal, level, exercise.tier);
  const timed = Boolean(exercise.timed);
  return {
    exerciseId: exercise.id,
    name: exercise.name,
    muscle: exercise.tags[0],
    tags: exercise.tags,
    tier: exercise.tier,
    unilateral: Boolean(exercise.unilateral),
    timed,
    bodyweight: Boolean(exercise.bodyweight),
    holdSeconds: exercise.hold ? exercise.hold[level.id] || null : null,
    bwNote: exercise.bwNote || null,
    cue: exercise.cue,
    sets: timed ? 3 : scheme.sets,
    reps: timed ? 1 : scheme.reps,
    restSeconds: timed ? 45 : scheme.restSeconds,
  };
}

function toCardioItem(exercise, minutes, prescription) {
  return {
    exerciseId: exercise.id,
    name: exercise.name,
    muscle: 'cardio',
    tags: exercise.tags,
    tier: 'cardio',
    timed: true,
    minutes,
    prescription,
    cue: exercise.cue,
  };
}

// Each lifting day declares what it must contain. `anchorTags` is the
// non-negotiable stimulus (a horizontal *and* vertical press, a hinge *and* a
// pull…); `accessoryTags` covers the muscles the anchors leave behind.
const LIFT_CONFIG = {
  push: { anchorTags: ['chest', 'front-delts'], accessoryTags: ['triceps', 'side-delts'], accessorySlots: ['push'] },
  pull: { anchorTags: ['biceps', 'hamstrings'], accessoryTags: ['biceps', 'rear-delts'], accessorySlots: ['pull'] },
  legs: { anchorTags: ['quads', 'hamstrings'], accessoryTags: ['hamstrings', 'calves'], accessorySlots: ['legs'] },
  upper: { anchorTags: ['chest', 'back'], accessoryTags: ['biceps', 'triceps'], accessorySlots: ['push', 'pull'] },
};

function buildLiftDay(spec, profile, goal, level, available, rng, used) {
  const config = LIFT_CONFIG[spec.key] || LIFT_CONFIG.push;
  const blocks = [];

  // 1 · The anchors. Beginners train one, everyone else trains the pair.
  const anchorSlots = config.accessorySlots.includes(spec.key)
    ? config.accessorySlots
    : config.accessorySlots.concat([spec.key]);
  const anchors = anchorSlots.flatMap((slot) => poolFor(available, slot, 'anchor'));
  const anchorCount = level.id === 'beginner' ? 1 : 2;
  const anchorsPicked = takeWithTags(anchors, anchorCount, rng, used, config.anchorTags);

  blocks.push({ type: 'warmup', title: 'Warm-up', note: spec.warmup, items: [] });
  blocks.push({
    type: 'lift',
    title: 'Main lifts',
    note: 'Starting weights are rounded down to something you can actually load. Beat the top of the rep range on every set, then add.',
    items: anchorsPicked.map((ex) => toLiftItem(goal, level, ex)),
  });

  // 2 · Accessories, with tag coverage so the session stays balanced.
  const accessoryPool = config.accessorySlots.flatMap((slot) => poolFor(available, slot, 'accessory'));
  const count = Math.max(2, accessoryCount(profile) - (level.id === 'beginner' ? 1 : 0));
  const accessories = takeWithTags(accessoryPool, count, rng, used, config.accessoryTags);
  if (accessories.length) {
    blocks.push({
      type: 'accessory',
      title: 'Accessories',
      note: 'Keep 1–2 reps in the tank.',
      items: accessories.map((ex) => toLiftItem(goal, level, ex)),
    });
  }

  // 3 · Core — sprinkled onto Pull and Legs rather than bolted on as a sixth
  // "ab day".
  if (spec.core > 0) {
    const core = take(poolFor(available, 'core', 'accessory'), spec.core, rng, used);
    if (core.length) {
      blocks.push({
        type: 'core',
        title: 'Core',
        note: 'Two sets short of failure. Stop the set when the position breaks, not when the clock does.',
        items: core.map((ex) => toLiftItem(goal, level, ex)),
      });
    }
  }

  // 4 · The finisher, last so it cannot blunt the heavy sets, and only on leg
  // day so it never lands the day before squats.
  if (spec.finisher && goal.finishersPerWeek > 0) {
    const cardioPool = available.has('running')
      ? poolFor(available, 'run', 'interval')
      : poolFor(available, 'cardio', 'interval');
    const cardio = take(cardioPool, 1, rng, used)[0];
    if (cardio) {
      blocks.push({
        type: 'cardio',
        title: 'Finisher (optional)',
        note: 'Short and hard. Skip it on a day you feel beaten up — the lifting is the priority.',
        items: [toCardioItem(cardio, 12, '12 min intervals')],
      });
    }
  }

  return blocks;
}

function buildConditioningDay(spec, profile, goal, level, available, rng, used, runningAdvice) {
  const blocks = [{ type: 'warmup', title: 'Warm-up', note: spec.warmup, items: [] }];

  // Running wins the conditioning slot when there is somewhere to run: it is
  // the one modality a cable stack cannot replace.
  if (available.has('running') && runningAdvice.length) {
    blocks.push({
      type: 'cardio',
      title: 'Running',
      note: 'Targets assume an easy effort — one you can hold a conversation through. Walk whenever it is not.',
      items: runningAdvice.map((run) => ({
        exerciseId: run.exerciseId,
        name: run.name,
        muscle: 'run',
        tags: ['run'],
        tier: 'cardio',
        timed: true,
        minutes: run.minutes,
        distance: run.distance,
        distanceUnit: run.distanceUnit,
        prescription: run.prescription,
        cue: run.cue,
        logAsRun: true,
      })),
    });
  } else {
    const steady = take(poolFor(available, 'cardio', 'steady'), 1, rng, used)[0];
    const interval = take(poolFor(available, 'cardio', 'interval'), 1, rng, used)[0];
    const items = [];
    if (steady) items.push(toCardioItem(steady, goal.easyMinutes, `${goal.easyMinutes} min easy — conversational`));
    if (interval) items.push(toCardioItem(interval, 12, '12 min intervals'));
    blocks.push({
      type: 'cardio',
      title: 'Cardio',
      note: 'Long and easy first, short and hard second. If you only have time for one, do the easy one.',
      items,
    });
  }

  const core = take(poolFor(available, 'core', 'accessory'), 2, rng, used);
  if (core.length) {
    blocks.push({
      type: 'core',
      title: 'Core',
      note: 'Superset these back-to-back if you are short on time.',
      items: core.map((ex) => toLiftItem(goal, level, ex)),
    });
  }
  return blocks;
}

export function dayItemCount(day) {
  if (!day) return 0;
  return day.blocks.reduce((sum, block) => sum + block.items.length, 0);
}

export function dayCardioMinutes(day) {
  if (!day) return 0;
  return day.blocks.reduce(
    (sum, block) => sum + block.items.reduce((s, item) => (item.timed && item.minutes ? s + item.minutes : s), 0),
    0
  );
}

/** Every timed hold in a day — what the hold timer on the log sheet offers. */
export function dayTimedItems(day) {
  if (!day) return [];
  return day.blocks.flatMap((block) => block.items).filter((item) => item.holdSeconds);
}

/** The run a conditioning day prescribes, if it prescribes one. */
export function dayRunItems(day) {
  if (!day) return [];
  return day.blocks.flatMap((block) => block.items).filter((item) => item.logAsRun);
}

function coachingNotes(profile, goal, level, plan) {
  const notes = [
    `Progressive overload: ${level.jump}`,
    `Effort: take each working set to ${level.rir}. If a set ends with plenty left, add reps before you add weight.`,
    `Cardio is dosed for "${goal.label.toLowerCase()}": ${goal.runsPerWeek} easy session${goal.runsPerWeek === 1 ? '' : 's'} a week` +
      (goal.finishersPerWeek > 0
        ? `, plus ${goal.finishersPerWeek} short interval finisher after training.`
        : ' and no hard sprint work, so nothing steals recovery from the bar.'),
    'Order matters: heaviest, most technical movement first, isolation work last. Warm up, then go.',
    'Deload every 6–8 weeks: drop the sets by about 40% and keep the same weights. You will come back stronger.',
    'Push/pull balance: for every set of pressing, do at least one set of pulling. It keeps shoulders healthy and posture honest.',
    'Timed holds (planks, wall sits, hangs) are quality reps — end the set the moment your position breaks, not when the clock says so.',
    'Sleep 7–9 hours and eat roughly 1.6 g of protein per kg of bodyweight. That is the part that actually makes the training work.',
  ];
  if (profile.level === 'beginner') {
    notes.push('Start lighter than you think. Weeks 1–2 are for learning the movement patterns, not for setting records.');
  }
  if (plan.runMinutes > 0) {
    notes.push(
      `This week prescribes about ${plan.runMinutes} min of running. Never grow weekly distance by more than about 10%, and keep most of it genuinely easy.`
    );
  }
  if (!profile.equipment || profile.equipment.length === 0) {
    notes.push('No equipment ticked, so this week is bodyweight only — you can still make real progress on it.');
  }
  if (plan.weightsFrom === 'bodyweight') {
    notes.push(
      'The starting weights are estimated from your body weight. Once you log a session, they are replaced by what you actually lifted.'
    );
  } else if (plan.weightsFrom === 'entered') {
    notes.push('The starting weights come from the working sets you entered — they will drift up as you log more.');
  }
  return notes;
}

function splitForDays(daysPerWeek) {
  return SPLITS[DAY_COUNT_OPTIONS.includes(daysPerWeek) ? daysPerWeek : DEFAULT_PROFILE.daysPerWeek];
}

/**
 * Recompute a plan's coaching notes.
 *
 * Exported because notes depend on `weightsFrom`, which is only known once
 * `fitLoads.applyLoads` has run — and because re-deriving weights must not
 * force the week to be regenerated.
 */
export function buildPlanNotes(plan) {
  const profile = plan?.profile || DEFAULT_PROFILE;
  const goal = GOAL_OPTIONS.find((g) => g.id === plan?.goal) || GOAL_OPTIONS[0];
  const level = LEVEL_OPTIONS.find((l) => l.id === plan?.level) || LEVEL_OPTIONS[1];
  return coachingNotes(profile, goal, level, plan || {});
}

/**
 * Build a full weekly plan.
 *
 * @param {object} [profile] — shape of DEFAULT_PROFILE; missing fields default
 * @param {number} [seed] — omit for a fresh week on every call
 * @param {object} [options]
 * @param {Array} [options.runningAdvice] — run targets from `fitLoads.runAdvice`.
 *   Passed in rather than imported so this module stays free of the storage
 *   layer, and required for a running-equipped athlete to get a *run* day at
 *   all: without targets the conditioning slot stays machine cardio, which is
 *   why the day is only named "Run" when they are present.
 */
export function buildPlan(profile = DEFAULT_PROFILE, seed = Math.floor(Math.random() * 2 ** 31), options = {}) {
  const safeProfile = { ...DEFAULT_PROFILE, ...profile };
  const goal = GOAL_OPTIONS.find((g) => g.id === safeProfile.goal) || GOAL_OPTIONS[0];
  const level = LEVEL_OPTIONS.find((l) => l.id === safeProfile.level) || LEVEL_OPTIONS[1];
  const daysPerWeek = DAY_COUNT_OPTIONS.includes(Number(safeProfile.daysPerWeek))
    ? Number(safeProfile.daysPerWeek)
    : DEFAULT_PROFILE.daysPerWeek;

  const rng = createRng(seed);
  const used = new Set();
  const equipment = Array.isArray(safeProfile.equipment) ? safeProfile.equipment : [];
  const locations = planLocations({ equipment, daysPerWeek });
  const runningAdvice = equipment.includes('running') ? options.runningAdvice || [] : [];

  const days = splitForDays(daysPerWeek).map((spec, index) => {
    const runCapable = equipment.includes('running') && runningAdvice.length > 0;
    let location = locations[index];
    // A cardio day built on machines needs the gym. Sending it home because the
    // rotation put it there would leave the athlete with a warm-up and nothing
    // else — so it only stays home when it can actually be a run.
    if (spec.key === 'conditioning' && !runCapable && equipment.includes('gym')) {
      location = 'gym';
    }
    const available = equipmentForLocation(equipment, location);
    // Only call it a run day when run targets were supplied *and* there is
    // somewhere to run — otherwise the day would be named "Run" while
    // prescribing a stationary bike.
    const isRunDay = spec.key === 'conditioning' && runCapable && available.has('running');
    const daySpec = isRunDay ? ROTATION_DAYS.run : spec;

    const blocks =
      daySpec.key === 'conditioning'
        ? buildConditioningDay(daySpec, safeProfile, goal, level, available, rng, used, runningAdvice)
        : buildLiftDay(daySpec, safeProfile, goal, level, available, rng, used);

    const day = {
      id: `d${index + 1}`,
      order: index + 1,
      key: daySpec.key,
      variant: spec.variant || null,
      name: spec.variant ? `${daySpec.name} ${spec.variant}` : daySpec.name,
      focus: daySpec.focus,
      location,
      blocks,
    };
    day.itemCount = dayItemCount(day);
    day.estimatedMinutes = estimatedMinutes(day.blocks.flatMap((b) => b.items));
    return day;
  });

  const plan = {
    seed,
    generatedAt: new Date().toISOString(),
    profile: safeProfile,
    goal: goal.id,
    level: level.id,
    days,
    weeklyTarget: Math.max(3, daysPerWeek - (daysPerWeek >= 5 ? 1 : 0)),
    runMinutes: days.reduce((sum, day) => sum + dayCardioMinutes(day), 0),
    weightsFrom: null,
    notes: [],
  };
  plan.notes = buildPlanNotes(plan);
  return plan;
}
