// Static plan data for the 12-week V-taper lean build.
// Transcribed from docs/superpowers/specs/plan-source-extract.txt. Data only, no logic.

export const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export const WARMUP_STEPS = [
  '5 min on the bike or incline walk',
  'Back-saver "McGill Big 3": curl-up 3×8s holds, side plank 2×20s per side (bodyweight only), bird-dog 2×6 per side',
  'Ramp-up sets on the first exercise: 50% × 10, 70% × 5, 85% × 2',
];

export const DAYS = {
  mon: {
    key: 'mon',
    label: 'Day 1: Upper Push (Mon)',
    focus: 'Upper chest, side delts, triceps',
    isRestDay: false,
    warmup: WARMUP_STEPS,
    exercises: [
      { id: 'incline-db-press', order: 1, name: 'Incline dumbbell press (30°)', sets: '4', repsLow: '6', repsHigh: '10', rest: '2-3 min', rir: '2', notes: '', incrementType: 'dumbbell', cue: "Bench at 30°, not 45°: that hits upper chest, not front delts. Shoulder blades pinched back and down, feet flat, small natural arch. Don't over-arch your lower back. Lower to the upper chest with elbows at about 45-60° from your torso, then press up and slightly in.", swaps: ['incline-smith-press'] },
      { id: 'seated-shoulder-press', order: 2, name: 'Seated machine shoulder press (back on pad)', sets: '3', repsLow: '8', repsHigh: '12', rest: '2 min', rir: '2', notes: '', incrementType: 'machine' },
      { id: 'single-arm-cable-lateral-raise', order: 3, name: 'Single-arm cable lateral raise', sets: '4', repsLow: '12', repsHigh: '20', rest: '60-90 s', rir: '1-0', notes: '', incrementType: 'cable', cue: 'Cable at wrist height, running behind your body. Stand side-on, lean slightly away. Lead with the elbow, raise to shoulder height. Pinky slightly higher than the thumb is fine; no shrugging. 2 s up, 2-3 s down. Light weight with full control beats heavy swinging every time.' },
      { id: 'low-to-high-cable-fly', order: 4, name: 'Low-to-high cable fly', sets: '3', repsLow: '12', repsHigh: '15', rest: '90 s', rir: '1', notes: '', incrementType: 'cable' },
      { id: 'machine-chest-press', order: 5, name: 'Machine chest press', sets: '2', repsLow: '8', repsHigh: '12', rest: '2 min', rir: '1', notes: '', incrementType: 'machine' },
      { id: 'overhead-cable-triceps-extension', order: 6, name: 'Overhead cable triceps extension', sets: '3', repsLow: '10', repsHigh: '15', rest: '75 s', rir: '1', notes: '', incrementType: 'cable' },
      { id: 'rope-pushdown', order: 7, name: 'Rope pushdown', sets: '2', repsLow: '12', repsHigh: '15', rest: '60 s', rir: '0-1', notes: '', incrementType: 'cable' },
      { id: 'stomach-vacuum', order: 8, name: 'Stomach vacuum', sets: '4', repsLow: '20', repsHigh: '30', rest: '30 s', rir: '—', notes: 'Hold time in seconds', incrementType: 'machine', cue: 'Best done first thing in the morning on an empty stomach. Breathe all the air out, pull the belly button toward the spine and up under the ribs, hold for 20-30 s while taking small breaths.' },
    ],
  },
  tue: {
    key: 'tue',
    label: 'Day 2: Lower A (Tue)',
    focus: 'Quads, calves, core',
    isRestDay: false,
    warmup: WARMUP_STEPS,
    exercises: [
      { id: 'leg-press', order: 1, name: 'Leg press (feet mid-platform, shoulder width)', sets: '4', repsLow: '8', repsHigh: '12', rest: '2-3 min', rir: '2', notes: '', incrementType: 'legpress', cue: "Lower back and hips stay pressed into the seat. Go only as deep as you can without your tailbone lifting. Push through the whole foot. Don't lock the knees at the top." },
      { id: 'hack-squat', order: 2, name: 'Hack squat (back flat on pad)', sets: '3', repsLow: '8', repsHigh: '10', rest: '2-3 min', rir: '2', notes: '', incrementType: 'machine' },
      { id: 'leg-extension', order: 3, name: 'Leg extension', sets: '3', repsLow: '12', repsHigh: '15', rest: '90 s', rir: '0-1', notes: '', incrementType: 'machine' },
      { id: 'seated-leg-curl', order: 4, name: 'Seated leg curl', sets: '3', repsLow: '10', repsHigh: '15', rest: '90 s', rir: '1', notes: '', incrementType: 'machine' },
      { id: 'bulgarian-split-squat', order: 5, name: 'Dumbbell Bulgarian split squat (upright torso)', sets: '2', repsLow: '10', repsHigh: '10', rest: '90 s', rir: '2', notes: 'Per leg', incrementType: 'dumbbell' },
      { id: 'standing-calf-raise', order: 6, name: 'Standing calf raise (2 s pause at bottom)', sets: '4', repsLow: '10', repsHigh: '15', rest: '60 s', rir: '1', notes: '', incrementType: 'machine' },
      { id: 'dead-bug', order: 7, name: 'Dead bug', sets: '3', repsLow: '10', repsHigh: '10', rest: '45 s', rir: '—', notes: 'Per side', incrementType: 'machine' },
      { id: 'pallof-press', order: 8, name: 'Pallof press (anti-rotation)', sets: '3', repsLow: '12', repsHigh: '12', rest: '45 s', rir: '—', notes: 'Per side', incrementType: 'cable' },
    ],
  },
  wed: {
    key: 'wed',
    label: 'Day 3: Pull (Wed)',
    focus: 'Lat width, upper back, rear delts, biceps',
    isRestDay: false,
    warmup: WARMUP_STEPS,
    exercises: [
      { id: 'lat-pulldown', order: 1, name: 'Lat pulldown (shoulder-width or slightly wider)', sets: '4', repsLow: '8', repsHigh: '12', rest: '2 min', rir: '2', notes: '', incrementType: 'cable', cue: 'Thighs locked under the pad, chest up, slight lean back (about 15°). Think "elbows down into your back pockets", not "pull with the hands". Bar to upper chest. Pause 1 s, then control 2-3 s up to a full stretch.' },
      { id: 't-bar-row', order: 2, name: 'Chest-supported T-bar or seal row', sets: '4', repsLow: '8', repsHigh: '10', rest: '2 min', rir: '2', notes: '', incrementType: 'machine', cue: "Chest stays glued to the pad the whole set. That's what takes the load off your lower back. Pull the elbows toward the hips for lats, or out wide for the upper back. Squeeze 1 s.", swaps: ['seal-row'] },
      { id: 'kneeling-single-arm-cable-pulldown', order: 3, name: 'Kneeling single-arm cable pulldown', sets: '3', repsLow: '10', repsHigh: '15', rest: '90 s', rir: '1', notes: 'Per arm', incrementType: 'cable' },
      { id: 'straight-arm-cable-pulldown', order: 4, name: 'Straight-arm cable pulldown', sets: '3', repsLow: '12', repsHigh: '15', rest: '75 s', rir: '1', notes: '', incrementType: 'cable' },
      { id: 'reverse-pec-deck', order: 5, name: 'Reverse pec deck', sets: '3', repsLow: '15', repsHigh: '20', rest: '60 s', rir: '0-1', notes: '', incrementType: 'machine' },
      { id: 'incline-db-curl', order: 6, name: 'Incline dumbbell curl', sets: '3', repsLow: '8', repsHigh: '12', rest: '75 s', rir: '1', notes: '', incrementType: 'dumbbell' },
      { id: 'hammer-curl', order: 7, name: 'Hammer curl', sets: '2', repsLow: '10', repsHigh: '12', rest: '60 s', rir: '1', notes: '', incrementType: 'dumbbell' },
      { id: 'captains-chair-knee-raise', order: 8, name: "Captain's-chair knee raise (tuck pelvis, no swing)", sets: '3', repsLow: '10', repsHigh: '15', rest: '60 s', rir: '1', notes: '', incrementType: 'machine' },
    ],
  },
  thu: {
    key: 'thu',
    label: 'Day 4: Upper V-Taper (Thu)',
    focus: 'Side delts, lats, arms',
    isRestDay: false,
    warmup: WARMUP_STEPS,
    exercises: [
      { id: 'machine-lateral-raise', order: 1, name: 'Machine lateral raise (or seated dumbbell)', sets: '4', repsLow: '10', repsHigh: '15', rest: '75 s', rir: '1', notes: '', incrementType: 'machine' },
      { id: 'incline-smith-press', order: 2, name: 'Incline Smith machine press (30°)', sets: '3', repsLow: '6', repsHigh: '10', rest: '2-3 min', rir: '2', notes: '', incrementType: 'machine', swaps: ['incline-db-press'] },
      { id: 'neutral-grip-pullup', order: 3, name: 'Neutral-grip pull-up (assisted if needed)', sets: '3', repsLow: '6', repsHigh: '10', rest: '2 min', rir: '2', notes: '', incrementType: 'machine' },
      { id: 'seated-cable-row', order: 4, name: 'Seated cable row, wide grip, elbows out', sets: '3', repsLow: '10', repsHigh: '12', rest: '90 s', rir: '1', notes: '', incrementType: 'cable' },
      { id: 'cable-y-raise', order: 5, name: 'Cable Y-raise', sets: '3', repsLow: '12', repsHigh: '15', rest: '60 s', rir: '1', notes: '', incrementType: 'cable' },
      { id: 'face-pull', order: 6, name: 'Face pull', sets: '3', repsLow: '12', repsHigh: '15', rest: '60 s', rir: '1', notes: '', incrementType: 'cable' },
      { id: 'ez-curl-skull-crusher-superset', order: 7, name: 'Superset: EZ-bar curl + EZ-bar skull crusher', sets: '3', repsLow: '10', repsHigh: '12', rest: '90 s', rir: '1', notes: 'Each exercise, 3 sets', incrementType: 'dumbbell' },
      { id: 'close-neutral-grip-lat-pulldown', order: 8, name: 'Close neutral-grip lat pulldown (lateral burnout moved to Day 6)', sets: '2', repsLow: '12', repsHigh: '15', rest: '60 s', rir: '1', notes: '', incrementType: 'cable' },
    ],
  },
  fri: {
    key: 'fri',
    label: 'Day 5: Lower B (Fri)',
    focus: 'Glutes, hamstrings, core',
    isRestDay: false,
    warmup: WARMUP_STEPS,
    exercises: [
      { id: 'hip-thrust', order: 1, name: 'Hip thrust (machine, or barbell with pad)', sets: '4', repsLow: '8', repsHigh: '12', rest: '2 min', rir: '2', notes: '', incrementType: 'hipthrust', cue: "Upper back on the bench edge, chin tucked, ribs down. Drive through the heels and squeeze the glutes at the top. Stop when your body is flat: don't arch the lower back to get higher." },
      { id: 'lying-leg-curl', order: 2, name: 'Lying leg curl', sets: '4', repsLow: '10', repsHigh: '12', rest: '90 s', rir: '1', notes: '', incrementType: 'machine' },
      { id: 'smith-reverse-lunge', order: 3, name: 'Smith machine reverse lunge', sets: '3', repsLow: '8', repsHigh: '12', rest: '90 s', rir: '2', notes: 'Per leg', incrementType: 'machine' },
      { id: 'leg-press-wide', order: 4, name: 'Leg press, high and wide feet', sets: '3', repsLow: '12', repsHigh: '15', rest: '2 min', rir: '1-2', notes: '', incrementType: 'legpress' },
      { id: 'leg-extension-lower-b', order: 5, name: 'Leg extension', sets: '2', repsLow: '15', repsHigh: '20', rest: '60 s', rir: '0-1', notes: '', incrementType: 'machine' },
      { id: 'seated-calf-raise', order: 6, name: 'Seated calf raise', sets: '4', repsLow: '12', repsHigh: '20', rest: '60 s', rir: '1', notes: '', incrementType: 'machine' },
      { id: 'kneeling-cable-crunch', order: 7, name: 'Kneeling cable crunch', sets: '3', repsLow: '10', repsHigh: '15', rest: '60 s', rir: '1', notes: '', incrementType: 'cable' },
      { id: 'front-plank-stomach-vacuum', order: 8, name: 'Front plank (squeeze glutes) + stomach vacuum', sets: '3', repsLow: '30', repsHigh: '45', rest: '45 s', rir: '—', notes: 'Plank holds in seconds, then 3 × 20 s stomach vacuum', incrementType: 'machine' },
    ],
  },
  sat: {
    key: 'sat',
    label: 'Day 6: Arms & Delts (Sat)',
    focus: 'Side and rear delts, biceps, triceps, core, 20 min incline walk',
    isRestDay: false,
    warmup: WARMUP_STEPS,
    exercises: [
      { id: 'cable-lateral-raise-both-arms', order: 1, name: 'Cable lateral raise, both arms (cross-body cables)', sets: '4', repsLow: '12', repsHigh: '20', rest: '60 s', rir: '1', notes: '', incrementType: 'cable' },
      { id: 'seated-db-lateral-raise', order: 2, name: 'Seated dumbbell lateral raise (drop set on the last set)', sets: '3', repsLow: '12', repsHigh: '15', rest: '60 s', rir: '0-1', notes: 'Drop set on the last set', incrementType: 'dumbbell' },
      { id: 'rear-delt-cable-fly', order: 3, name: 'Rear-delt cable fly', sets: '3', repsLow: '15', repsHigh: '20', rest: '60 s', rir: '1', notes: '', incrementType: 'cable' },
      { id: 'bayesian-cable-curl', order: 4, name: 'Bayesian cable curl (facing away from the stack)', sets: '3', repsLow: '10', repsHigh: '15', rest: '60 s', rir: '1', notes: '', incrementType: 'cable' },
      { id: 'assisted-dips', order: 5, name: 'Assisted dips or machine dips (upright torso)', sets: '3', repsLow: '8', repsHigh: '12', rest: '90 s', rir: '1-2', notes: '', incrementType: 'machine' },
      { id: 'preacher-curl', order: 6, name: 'Preacher curl (machine or EZ-bar)', sets: '2', repsLow: '10', repsHigh: '12', rest: '60 s', rir: '1', notes: '', incrementType: 'machine' },
      { id: 'single-arm-cable-pushdown', order: 7, name: 'Single-arm cable pushdown', sets: '2', repsLow: '12', repsHigh: '15', rest: '45 s', rir: '0-1', notes: 'Per arm', incrementType: 'cable' },
      { id: 'reverse-crunch-dead-bug', order: 8, name: 'Reverse crunch (slow, curl the pelvis) + dead bug', sets: '3', repsLow: '12', repsHigh: '12', rest: '45 s', rir: '—', notes: 'Then 3 × 10 per side dead bug', incrementType: 'machine' },
      { id: 'incline-treadmill-walk', order: 9, name: 'Incline treadmill walk (8-10%, 5-5.5 km/h)', sets: '1', repsLow: '20', repsHigh: '20', rest: '—', rir: '—', notes: '20 min, not reps', incrementType: 'machine' },
    ],
  },
  sun: {
    key: 'sun',
    label: 'Rest (Sun)',
    focus: 'Full rest, 8k steps, mobility',
    isRestDay: true,
    warmup: [],
    exercises: [],
    restDayInfo: { steps: '8k steps', mobility: 'Mobility work' },
  },
};

export const BLOCK_STRUCTURE = [
  { weeks: [1], phase: 'intro', setMultiplier: 1, rirOverride: '3' },
  { weeks: [2, 3, 4, 5], phase: 'build1', setMultiplier: 1 },
  { weeks: [6], phase: 'deload', setMultiplier: 0.5, rirOverride: '3-4' },
  {
    weeks: [7, 8, 9, 10, 11],
    phase: 'build2',
    setMultiplier: 1,
    extraSets: {
      exerciseIds: [
        'single-arm-cable-lateral-raise',
        'machine-lateral-raise',
        'cable-lateral-raise-both-arms',
        'seated-db-lateral-raise',
        'lat-pulldown',
        'close-neutral-grip-lat-pulldown',
        'kneeling-single-arm-cable-pulldown',
      ],
      amount: 1,
    },
    swapPairs: [
      ['incline-db-press', 'incline-smith-press'],
      ['t-bar-row', 'seal-row'],
    ],
    isolationLastSetRIR: 0,
  },
  { weeks: [12], phase: 'deload2', setMultiplier: 0.5 },
];

export const INCREMENT_BY_TYPE = { dumbbell: 2.5, machine: 2.5, legpress: 5, hipthrust: 5, cable: '1 pin' };

export const NUTRITION_PHASES = {
  recomp: { weeks: [1, 2, 3, 4], kcal: 2500, protein: 140, fat: 65, carbs: 340 },
  leanGain: { weeks: [5, 6, 7, 8, 9, 10, 11, 12], kcal: 2850, protein: 140, fat: 75, carbs: 405 },
};

export const ADD_ONS = [
  { id: 'banana-peanut-butter', label: '1 banana + 1 tbsp peanut butter', kcal: 250 },
  { id: 'roti-curd', label: '1 extra roti + 1 cup curd (200 g)', kcal: 250 },
  { id: 'rice-ghee', label: '75 g extra cooked rice + 10 g ghee', kcal: 250 },
  { id: 'milk-almonds', label: '300 ml full-fat milk + 15 g almonds', kcal: 250 },
];

export const PRE_TRAINING_BANANA = { label: '1 extra banana before training', kcal: 100 };

export const MEAL_PLAN = {
  mon: {
    meals: [
      { id: 'breakfast', name: 'Breakfast', items: 'Whey oats: 60 g oats cooked in 250 ml milk, 1 scoop whey stirred in after cooking, 1 sliced banana', kcal: 600, protein: 41 },
      { id: 'lunch', name: 'Lunch', items: '200 g rice, 1 katori dal, chicken curry (150 g breast, 2 tsp oil), 100 g curd, salad', kcal: 800, protein: 54 },
      { id: 'pre-workout', name: 'Pre-workout', items: '2 slices brown bread + 1 tbsp peanut butter + 1 banana', kcal: 340, protein: 11 },
      { id: 'dinner', name: 'Dinner (post-workout)', items: '3 rotis, paneer bhurji (100 g paneer, 1 tsp oil), 1 katori mixed-veg sabzi', kcal: 760, protein: 33 },
    ],
    dayTotalKcal: 2500,
    dayTotalProtein: 139,
  },
  tue: {
    meals: [
      { id: 'breakfast', name: 'Breakfast', items: 'Omelette of 3 whole eggs + 3 whites with onion and tomato (1 tsp oil), 2 slices brown bread, 1 apple', kcal: 530, protein: 35 },
      { id: 'lunch', name: 'Lunch', items: '200 g rice, soya chunk curry (50 g dry chunks, 2 tsp oil), 1 roti, 200 g curd raita, salad', kcal: 790, protein: 42 },
      { id: 'pre-workout', name: 'Pre-workout', items: '150 g hung curd + 1 tsp honey + 30 g oats or muesli', kcal: 295, protein: 16 },
      { id: 'dinner', name: 'Dinner (post-workout)', items: 'Tawa fish (150 g surmai or rohu, 1 tsp oil), 3 rotis with 1 tsp ghee, 1 katori dal, 1 katori sabzi', kcal: 870, protein: 57 },
    ],
    dayTotalKcal: 2485,
    dayTotalProtein: 150,
  },
  wed: {
    meals: [
      { id: 'breakfast', name: 'Breakfast', items: '2 besan chillas (60 g besan, 1 tsp oil) stuffed with 50 g paneer, mint chutney, 250 ml milk, 1 banana', kcal: 655, protein: 31 },
      { id: 'lunch', name: 'Lunch', items: '3 rotis, 100 g rice, chicken curry (150 g breast, 2 tsp oil), 100 g curd, salad', kcal: 850, protein: 52 },
      { id: 'pre-workout', name: 'Pre-workout', items: '1 scoop whey in water, 1 apple, 15 g almonds', kcal: 290, protein: 27 },
      { id: 'dinner', name: 'Dinner (post-workout)', items: '1 katori rajma, 200 g rice, 1 tsp ghee, 1 katori sabzi, 100 g curd, salad', kcal: 695, protein: 24 },
    ],
    dayTotalKcal: 2490,
    dayTotalProtein: 134,
  },
  thu: {
    meals: [
      { id: 'breakfast', name: 'Breakfast', items: 'Poha (60 g dry poha, 15 g peanuts, peas, 1 tsp oil), 3 boiled eggs', kcal: 570, protein: 27 },
      { id: 'lunch', name: 'Lunch', items: 'Home chicken biryani (200 g rice, 150 g breast, 2 tsp oil or ghee), 200 g curd raita, salad', kcal: 680, protein: 46 },
      { id: 'pre-workout', name: 'Pre-workout', items: '1 scoop whey in 250 ml milk, 1 banana', kcal: 370, protein: 33 },
      { id: 'dinner', name: 'Dinner (post-workout)', items: '3 rotis with 1 tsp ghee, 1 katori dal, paneer tikka (75 g paneer), 1 katori sabzi', kcal: 875, protein: 41 },
    ],
    dayTotalKcal: 2495,
    dayTotalProtein: 147,
  },
  fri: {
    meals: [
      { id: 'breakfast', name: 'Breakfast', items: 'Overnight oats: 60 g oats, 200 g curd, 1 scoop whey, 1 tbsp chia seeds, 100 g papaya (make it the night before)', kcal: 570, protein: 41 },
      { id: 'lunch', name: 'Lunch', items: '200 g rice, fish curry (150 g fish, 2 tsp oil), 1 katori dal, 1 katori sabzi, salad', kcal: 800, protein: 50 },
      { id: 'pre-workout', name: 'Pre-workout', items: 'Paneer sandwich (2 slices brown bread, 50 g paneer, veggies), 1 banana', kcal: 385, protein: 16 },
      { id: 'dinner', name: 'Dinner (post-workout)', items: 'Egg curry (3 eggs, onion-tomato gravy, 2 tsp oil), 3 rotis, 1 katori sabzi', kcal: 750, protein: 33 },
    ],
    dayTotalKcal: 2505,
    dayTotalProtein: 140,
  },
  sat: {
    meals: [
      { id: 'breakfast', name: 'Breakfast', items: '3 idlis, 1 katori sambar, 1 tbsp coconut chutney, 2 boiled eggs, 1 scoop whey in water', kcal: 620, protein: 48 },
      { id: 'lunch', name: 'Lunch', items: 'Chicken tikka (150 g breast, 1 tsp oil), 2 rotis, 100 g rice, 1 katori dal, salad', kcal: 805, protein: 57 },
      { id: 'pre-workout', name: 'Pre-workout', items: '1 banana, 3 dates, 250 ml milk', kcal: 310, protein: 9 },
      { id: 'dinner', name: 'Dinner (post-workout)', items: 'Moong dal khichdi (60 g rice + 40 g moong dal, raw, 1 tsp ghee), 1 roti, 200 g curd, 1 katori sabzi', kcal: 725, protein: 28 },
    ],
    dayTotalKcal: 2460,
    dayTotalProtein: 142,
  },
  sun: {
    meals: [
      { id: 'breakfast', name: 'Breakfast', items: '2 paneer parathas (80 g atta, 60 g paneer, 2 tsp ghee total), 200 g curd', kcal: 610, protein: 26 },
      { id: 'lunch', name: 'Lunch', items: '200 g rice, chicken curry (150 g breast, 2 tsp oil), 1 katori dal, salad', kcal: 740, protein: 51 },
      { id: 'evening-snack', name: 'Evening snack', items: '1 scoop whey in water, 1 apple, 15 g almonds', kcal: 290, protein: 27 },
      { id: 'dinner', name: 'Dinner (eat out)', items: 'Half tandoori chicken + 2 tandoori rotis (no butter) + salad. Or any meal you like, capped at ~800 kcal.', kcal: 760, protein: 53 },
    ],
    dayTotalKcal: 2400,
    dayTotalProtein: 157,
  },
};

export const PROTEIN_SWAPS = [
  { grams: 150, food: 'chicken breast' },
  { grams: 150, food: 'fish' },
  { count: 5, food: 'whole eggs' },
  { grams: 130, food: 'paneer' },
  { grams: 60, food: 'soya chunks' },
];

export const SUPPLEMENTS = [
  { name: 'Whey protein', dose: '1 scoop (≈25 g protein)', why: 'Makes 140 g protein easy' },
  { name: 'Creatine monohydrate', dose: '3-5 g daily, any time', why: 'Strength and muscle fullness; the most-researched supplement' },
  { name: 'Vitamin D3', dose: "Only if a blood test shows you're low", why: 'Very common deficiency in India' },
  { name: 'Omega-3 fish oil', dose: '1-2 g EPA+DHA', why: 'Useful on days without fish' },
];

export const GROCERY_LIST = [
  { category: 'Protein', item: 'Chicken breast, boneless', quantity: '800 g' },
  { category: 'Protein', item: 'Fish (surmai, rohu or basa)', quantity: '300 g' },
  { category: 'Protein', item: 'Eggs', quantity: '15' },
  { category: 'Protein', item: 'Paneer (low-fat if available)', quantity: '400 g' },
  { category: 'Protein', item: 'Soya chunks', quantity: '100 g pack (lasts 2 weeks)' },
  { category: 'Protein', item: 'Whey protein', quantity: '≈ 6 scoops (1 kg tub lasts about 5 weeks)' },
  { category: 'Dairy', item: 'Toned milk', quantity: '1.5 L' },
  { category: 'Dairy', item: 'Curd (dahi)', quantity: '2 kg (includes 300 g to hang for Tuesday)' },
  { category: 'Grains', item: 'Rice (raw)', quantity: '750 g' },
  { category: 'Grains', item: 'Whole-wheat atta', quantity: '1 kg' },
  { category: 'Grains', item: 'Rolled oats', quantity: '500 g pack (lasts 3 weeks)' },
  { category: 'Grains', item: 'Poha', quantity: '100 g' },
  { category: 'Grains', item: 'Besan', quantity: '100 g' },
  { category: 'Grains', item: 'Brown bread', quantity: '1 loaf' },
  { category: 'Grains', item: 'Idli batter', quantity: '300 g' },
  { category: 'Pulses', item: 'Toor, moong or masoor dal (mix)', quantity: '400 g' },
  { category: 'Pulses', item: 'Rajma', quantity: '100 g' },
  { category: 'Fruit', item: 'Bananas', quantity: '8 (12 from week 5)' },
  { category: 'Fruit', item: 'Apples', quantity: '3' },
  { category: 'Fruit', item: 'Papaya', quantity: '1 small' },
  { category: 'Fruit', item: 'Dates', quantity: '6' },
  { category: 'Vegetables', item: 'Onions', quantity: '1 kg' },
  { category: 'Vegetables', item: 'Tomatoes', quantity: '1 kg' },
  { category: 'Vegetables', item: 'Mixed sabzi veg (bhindi, beans, cauliflower, palak, capsicum, lauki)', quantity: '2.5 kg' },
  { category: 'Vegetables', item: 'Salad veg (cucumber, carrot, beetroot)', quantity: '1 kg' },
  { category: 'Vegetables', item: 'Green peas (frozen ok)', quantity: '200 g' },
  { category: 'Vegetables', item: 'Ginger, garlic, green chillies, lemons, coriander, mint', quantity: 'as needed' },
  { category: 'Fats and nuts', item: 'Cooking oil (mustard, groundnut or rice bran)', quantity: '150 ml' },
  { category: 'Fats and nuts', item: 'Ghee', quantity: '50 g' },
  { category: 'Fats and nuts', item: 'Peanut butter (unsweetened)', quantity: '1 jar (lasts 3-4 weeks)' },
  { category: 'Fats and nuts', item: 'Almonds', quantity: '50 g' },
  { category: 'Fats and nuts', item: 'Raw peanuts', quantity: '50 g' },
  { category: 'Fats and nuts', item: 'Chia seeds', quantity: '50 g' },
  { category: 'Other', item: 'Honey', quantity: 'small jar' },
  { category: 'Other', item: 'Creatine monohydrate', quantity: '250 g tub (lasts about 2 months)' },
];

export const SUNDAY_PREP_STEPS = [
  'Marinate 300 g chicken for Monday and Thursday',
  'Boil 6 eggs',
  'Hang the curd for Tuesday',
  'Chop onions and tomatoes for 3 days',
  'Portion the oats into 60 g bags',
];

export const CHECKIN_TARGETS = {
  recomp: { weightPerWeekKg: [-0.2, 0], waistPer4WeeksCm: [-2, -0.5] },
  leanGain: { weightPerWeekKg: [0.2, 0.3], waistPer4WeeksCm: [0, 0.5] },
};

export const LOWER_BACK_TWINGE_SWAPS = {
  'hack-squat': 'leg-press',
  'hip-thrust': 'glute-bridge-machine',
  't-bar-row': 'machine-row',
};
