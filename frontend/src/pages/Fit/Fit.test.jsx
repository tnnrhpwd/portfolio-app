import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useSelector } from 'react-redux';
import '@testing-library/jest-dom';
import Fit from './Fit.jsx';
import { askFitCoach } from '../../services/fitApi';

// The shared page shell (Header → Redux → config/api.js) uses `import.meta`,
// which the Jest transform cannot parse. Nothing here is about the shell, so it
// is stubbed and the assertions stay on Fit's own behaviour.
jest.mock('../../components/Header/Header', () => () => <div data-testid="header" />);
jest.mock('../../components/Footer/Footer', () => () => <div data-testid="footer" />);
jest.mock('../../components/SEO/SEO.jsx', () => () => null);
jest.mock('react-redux', () => ({ useSelector: jest.fn() }));
jest.mock('../../services/fitApi', () => ({ askFitCoach: jest.fn() }));

const GUEST = { user: null };
const USER = { user: { _id: 'u1', nickname: 'Steve', token: 'jwt-token' } };

// The page generates a plan with a `Math.random()` seed, so without this the
// movements in the week change between runs and assertions about specific
// exercises become flaky. Pinning it makes every generated week reproducible.
beforeEach(() => {
  jest.spyOn(Math, 'random').mockReturnValue(0.42);
});

afterEach(() => {
  Math.random.mockRestore();
});

const renderFit = (auth = GUEST) => {
  useSelector.mockImplementation((selector) => selector({ data: auth }));
  return render(
    <MemoryRouter>
      <Fit />
    </MemoryRouter>
  );
};

const sectionByHeading = (name) => screen.getByRole('heading', { name }).closest('section');
const statValue = (section, label) => {
  const tile = Array.from(section.querySelectorAll('.fit-stat')).find((el) => el.textContent.includes(label));
  return tile ? tile.querySelector('.fit-stat-value').textContent : null;
};
const week = () => sectionByHeading(/3 · Your week/i);
const logSheet = () => sectionByHeading(/4 · Log a session/i);
const runningSection = () => sectionByHeading(/5 · Running/i);
const progressSection = () => sectionByHeading(/6 · Progress/i);
const historySection = () => sectionByHeading(/7 · History/i);
const coachSection = () => sectionByHeading(/8 · Ask the coach/i);

/** The section header is a toggle; closed sections render no body at all. */
const openSection = (name) => {
  const section = sectionByHeading(name);
  if (!section.querySelector('.fit-section-body')) {
    fireEvent.click(section.querySelector('.fit-section-toggle'));
  }
  return section;
};

/** Pick a day in the week's day picker, then act on the panel it opens. */
const dayTab = (name) => within(week()).getByRole('button', { name: new RegExp(`^${name} —`, 'i') });
const selectDay = (name) => fireEvent.click(dayTab(name));
const logDay = (name) => {
  selectDay(name);
  fireEvent.click(within(week()).getByRole('button', { name: new RegExp(`^Log ${name}$`, 'i') }));
};

const setInputs = () => ({
  weights: within(logSheet()).getAllByLabelText(/set 1 weight/i),
  ticks: within(logSheet()).getAllByLabelText(/set 1 complete/i),
  allSets: within(logSheet()).getAllByLabelText(/set \d+ complete/i),
});

const storedState = () => {
  const raw = window.localStorage.getItem('fit.state.v2');
  return raw ? JSON.parse(raw) : null;
};

/** Every section heading the current mode renders, for the expand-all check. */
const visibleSections = () => [
  /1 · Your week, your rules/i,
  /3 · Your week/i,
  /4 · Log a session/i,
  /8 · Ask the coach/i,
  /9 · How this plan is built/i,
];

describe('Fit — guest mode', () => {
  beforeEach(() => {
    window.localStorage.clear();
    askFitCoach.mockReset();
  });

  afterEach(cleanup);

  it('generates a real week with no interaction and stores nothing', async () => {
    renderFit(GUEST);

    // The recommendation is there immediately — a visitor should not have to
    // fill in a form to see what the product does. The week shows one day at a
    // time, so the tabs are what prove all four days exist.
    const weekSection = week();
    expect(weekSection.querySelectorAll('.fit-daytab')).toHaveLength(4);
    expect(weekSection.querySelectorAll('.fit-day')).toHaveLength(1);
    await waitFor(() => expect(storedState()).toBeNull());
    expect(window.localStorage.length).toBe(0);
  });

  it('says plainly that nothing is saved, and offers the sign-in route', () => {
    renderFit(GUEST);
    const banner = screen.getByText(/browsing as a guest/i);
    expect(banner).toHaveTextContent(/nothing is saved/i);
    expect(screen.getAllByRole('link', { name: /^sign in$/i })[0]).toHaveAttribute('href', '/login');
  });

  it('hides the tracking-only surfaces rather than showing empty ones', () => {
    renderFit(GUEST);
    expect(screen.queryByRole('heading', { name: /your body & starting weights/i })).toBeNull();
    expect(screen.queryByRole('heading', { name: /^5 · Running$/i })).toBeNull();
    expect(screen.queryByRole('heading', { name: /^6 · Progress$/i })).toBeNull();
    expect(screen.queryByRole('heading', { name: /^7 · History$/i })).toBeNull();
  });

  it('gates the coach behind an account, and explains why', () => {
    renderFit(GUEST);
    const coach = openSection(/8 · Ask the coach/i);
    expect(within(coach).getByText(/needs an account to read/i)).toBeInTheDocument();
    expect(within(coach).getByRole('link', { name: /create an account/i })).toHaveAttribute('href', '/register');
    expect(within(coach).queryByRole('button', { name: /get coaching/i })).toBeNull();
  });

  it('collapses every section that is not in use, and lets you expand them again', () => {
    renderFit(GUEST);
    // The setup form and the week are the two things a visitor needs; the
    // rest of the page is a header they can open when they want it.
    expect(sectionByHeading(/1 · Your week, your rules/i).querySelector('.fit-section-body')).not.toBeNull();
    expect(sectionByHeading(/3 · Your week/i).querySelector('.fit-section-body')).not.toBeNull();
    expect(sectionByHeading(/4 · Log a session/i).querySelector('.fit-section-body')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /expand all/i }));
    visibleSections().forEach((name) => {
      expect(sectionByHeading(name).querySelector('.fit-section-body')).not.toBeNull();
    });

    fireEvent.click(screen.getByRole('button', { name: /collapse all/i }));
    expect(sectionByHeading(/3 · Your week/i).querySelector('.fit-section-body')).toBeNull();
  });

  it('offers a section index that opens the section it names', () => {
    renderFit(GUEST);
    fireEvent.click(screen.getByRole('button', { name: /^Log a session$/i }));
    expect(sectionByHeading(/4 · Log a session/i).querySelector('.fit-section-body')).not.toBeNull();
  });

  it('reports no progress numbers because it has kept none', () => {
    renderFit(GUEST);
    expect(screen.queryByRole('heading', { name: /What your data says/i })).toBeNull();
  });
});

describe('Fit — equipment is multi-select', () => {
  beforeEach(() => {
    window.localStorage.clear();
    askFitCoach.mockReset();
  });

  afterEach(cleanup);

  it('lets an athlete pick both the gym and their home kit', () => {
    renderFit(GUEST);
    const gym = screen.getByRole('checkbox', { name: /full gym/i });
    const dumbbells = screen.getByRole('checkbox', { name: /dumbbells at home/i });
    expect(gym).toBeChecked();
    expect(dumbbells).not.toBeChecked();

    fireEvent.click(dumbbells);
    expect(dumbbells).toBeChecked();
    // Ticking more equipment must never untick what was already chosen.
    expect(gym).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /barbell \+ bench/i })).toBeChecked();
  });

  it('can be unticked, and regenerates a week that matches', () => {
    renderFit(GUEST);
    fireEvent.click(screen.getByRole('checkbox', { name: /full gym/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /barbell \+ bench/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /running/i }));

    expect(screen.getByRole('checkbox', { name: /full gym/i })).not.toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: /regenerate my week/i }));
    const weekSection = week();
    // No gym and no barbell left, so every day has moved home.
    expect(weekSection.textContent).toMatch(/at home/i);
    expect(weekSection.textContent).not.toMatch(/at the gym/i);
  });

  it('explains the barbell in plain language for someone who does not know the name', () => {
    renderFit(GUEST);
    expect(screen.getByRole('checkbox', { name: /barbell \+ bench/i })).toHaveAccessibleDescription(
      /the long bar you load with plates/i
    );
  });
});

describe('Fit — signed in: customised weights', () => {
  beforeEach(() => {
    window.localStorage.clear();
    askFitCoach.mockReset();
  });

  afterEach(cleanup);

  it('turns the plan into real numbers once it knows your body weight', async () => {
    renderFit(USER);
    fireEvent.change(screen.getByLabelText(/^body weight \(/i), { target: { value: '82' } });

    await waitFor(() => {
      const weightLines = week().querySelectorAll('.fit-move-load');
      expect(weightLines.length).toBeGreaterThan(0);
    });

    const text = week().textContent;
    expect(text).toMatch(/of body weight/);
    expect(text).toMatch(/\d+(\.\d+)? kg/);
  });

  it('prefers a working set you typed over the body-weight estimate', async () => {
    renderFit(USER);
    fireEvent.change(screen.getByLabelText(/body weight in kg/i), { target: { value: '82' } });
    fireEvent.change(screen.getByLabelText(/bench press weight in kg/i), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText(/bench press reps/i), { target: { value: '5' } });

    await waitFor(() => expect(week().textContent).toMatch(/your bench press ·/));
    expect(week().textContent).toMatch(/117 kg est\. 1RM/);
  });

  it('says what it needs before it can prescribe anything', () => {
    renderFit(USER);
    const body = sectionByHeading(/your body & starting weights/i);
    expect(within(body).getByText(/add your body weight/i)).toBeInTheDocument();
  });

  it('recalculates the prescribed weights when the body weight changes', async () => {
    renderFit(USER);
    const readWeights = () =>
      Array.from(week().querySelectorAll('.fit-move-load'))
        .map((el) => el.textContent)
        .join('|');

    fireEvent.change(screen.getByLabelText(/^body weight \(/i), { target: { value: '60' } });
    await waitFor(() => expect(readWeights()).toMatch(/kg/));
    const lighter = readWeights();

    fireEvent.change(screen.getByLabelText(/^body weight \(/i), { target: { value: '110' } });
    await waitFor(() => expect(readWeights()).not.toBe(lighter));
  });

  it('records a body-weight check-in and starts using it', async () => {
    renderFit(USER);
    fireEvent.change(screen.getByLabelText(/today's body weight in kg/i), { target: { value: '81.5' } });
    fireEvent.click(screen.getByRole('button', { name: /^log$/i }));

    await waitFor(() => expect(storedState().checkIns).toHaveLength(1));
    expect(screen.getByRole('status')).toHaveTextContent(/Check-in saved — 81.5 kg/);
    expect(sectionByHeading(/your body & starting weights/i).textContent).toMatch(/Last check-in 81.5 kg/);
  });

  it('refuses a check-in with no weight', () => {
    renderFit(USER);
    fireEvent.click(screen.getByRole('button', { name: /^log$/i }));
    expect(screen.getByRole('status')).toHaveTextContent(/Enter a body weight first/i);
  });
});

describe('Fit — signed in: tracking a session', () => {
  beforeEach(() => {
    window.localStorage.clear();
    askFitCoach.mockReset();
  });

  afterEach(cleanup);

  it('opens a sheet pre-filled with the prescribed weight', () => {
    renderFit(USER);
    fireEvent.change(screen.getByLabelText(/^body weight \(/i), { target: { value: '82' } });
    // Legs is the day guaranteed to hold a loaded anchor (a squat and a hinge),
    // whatever the seed shuffles elsewhere.
    logDay('Legs');

    expect(within(logSheet()).getAllByText(/Prescribed/).length).toBeGreaterThan(0);
    // The prescribed number lands in the weight column, so the athlete only has
    // to tick sets rather than do arithmetic. The hinge is always loaded on a
    // gym Legs day, whatever else the seed shuffles.
    const hingeWeight = within(logSheet()).getByLabelText(/Romanian deadlift set 1 weight/i);
    expect(Number(hingeWeight.value)).toBeGreaterThan(0);
  });

  it('offers a hold timer and a rest timer where the plan prescribes seconds', () => {
    renderFit(USER);
    logDay('Pull');
    expect(within(logSheet()).getAllByRole('button', { name: /^Rest \d+s$/i }).length).toBeGreaterThan(0);
  });

  it('refuses to save a session with nothing ticked', () => {
    renderFit(USER);
    logDay('Push');
    fireEvent.click(screen.getByRole('button', { name: /save session/i }));

    expect(screen.getByRole('status')).toHaveTextContent(/tick at least one set/i);
    expect(storedState().sessions).toHaveLength(0);
  });

  it('saves a session, counts only ticked sets, and moves the rotation on', async () => {
    renderFit(USER);
    fireEvent.change(screen.getByLabelText(/^body weight \(/i), { target: { value: '82' } });
    logDay('Push');

    const { weights, ticks } = setInputs();
    fireEvent.change(weights[0], { target: { value: '60' } });
    fireEvent.click(ticks[0]);
    expect(within(logSheet()).getByText(/1 set ticked/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /save session/i }));

    expect(screen.getByRole('status')).toHaveTextContent(/Saved Push — 1 set/);
    await waitFor(() => expect(storedState().sessions).toHaveLength(1));

    // The week follows the rotation to the next day, so "what is next" is
    // answered without re-reading the list.
    expect(within(week()).getByRole('button', { name: /^Pull —/i })).toHaveAttribute('aria-pressed', 'true');

    const progress = openSection(/6 · Progress/i);
    expect(statValue(progress, 'sessions logged')).toBe('1');
    expect(statValue(progress, 'sessions this week')).toBe('1/4');

    const history = openSection(/7 · History/i);
    expect(within(history).getByText('Push')).toBeInTheDocument();
  });

  it('ticks a whole session at once for logging after the fact', () => {
    renderFit(USER);
    logDay('Push');
    fireEvent.click(screen.getByRole('button', { name: /tick everything/i }));

    const { allSets } = setInputs();
    expect(allSets.length).toBeGreaterThan(0);
    allSets.forEach((box) => expect(box.checked).toBe(true));
  });

  it('requires a second click before deleting history', async () => {
    renderFit(USER);
    logDay('Push');
    fireEvent.click(screen.getByRole('button', { name: /tick everything/i }));
    fireEvent.click(screen.getByRole('button', { name: /save session/i }));
    await waitFor(() => expect(storedState().sessions).toHaveLength(1));

    const history = openSection(/7 · History/i);
    fireEvent.click(within(history).getByRole('button', { name: 'Delete' }));
    expect(within(history).getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    fireEvent.click(within(history).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(storedState().sessions).toHaveLength(0));
    expect(screen.queryByRole('heading', { name: /7 · History/i })).toBeNull();
  });
});

describe('Fit — signed in: running', () => {
  beforeEach(() => {
    window.localStorage.clear();
    askFitCoach.mockReset();
  });

  afterEach(cleanup);

  it('logs a run with distance, time, and effort', async () => {
    renderFit(USER);
    const running = openSection(/5 · Running/i);
    fireEvent.change(within(running).getByLabelText(/^Distance/i), { target: { value: '5' } });
    fireEvent.change(within(running).getByLabelText(/^Time \(minutes\)$/i), { target: { value: '30' } });
    fireEvent.change(within(running).getByLabelText(/^Effort/i), { target: { value: '5' } });
    fireEvent.click(within(running).getByRole('button', { name: /log run/i }));

    await waitFor(() => expect(storedState().runs).toHaveLength(1));
    expect(storedState().runs[0]).toEqual(
      expect.objectContaining({ distance: 5, minutes: 30, effort: 5, unit: 'km' })
    );
    expect(runningSection().textContent).toMatch(/5 km across 1 run/);
  });

  it('needs a duration before it will store a run', () => {
    renderFit(USER);
    const running = openSection(/5 · Running/i);
    fireEvent.change(within(running).getByLabelText(/^Distance/i), { target: { value: '5' } });
    fireEvent.click(within(running).getByRole('button', { name: /log run/i }));
    expect(screen.getByRole('status')).toHaveTextContent(/needs a duration/i);
    expect(storedState().runs).toHaveLength(0);
  });

  it('paces the prescribed runs off the athlete’s own logged pace', async () => {
    renderFit(USER);
    const running = openSection(/5 · Running/i);
    fireEvent.change(within(running).getByLabelText(/^Distance/i), { target: { value: '5' } });
    fireEvent.change(within(running).getByLabelText(/^Time \(minutes\)$/i), { target: { value: '30' } });
    fireEvent.click(within(running).getByRole('button', { name: /log run/i }));
    await waitFor(() => expect(storedState().runs).toHaveLength(1));

    // Regenerate from the setup section, which is still open at this point.
    fireEvent.click(screen.getByRole('button', { name: /regenerate my week/i }));
    openSection(/3 · Your week/i);
    // 6:00 /km → a 25 min easy run is ≈4.2 km. The run day is the last tab.
    selectDay('Run');
    await waitFor(() => expect(week().textContent).toMatch(/≈4\.2 km/));
    expect(week().textContent).toMatch(/slower than 6:00 \/km/);
  });

  it('counts a run as a training day in the weekly progress', async () => {
    renderFit(USER);
    const running = openSection(/5 · Running/i);
    fireEvent.change(within(running).getByLabelText(/^Time \(minutes\)$/i), { target: { value: '30' } });
    fireEvent.click(within(running).getByRole('button', { name: /log run/i }));
    await waitFor(() => expect(storedState().runs).toHaveLength(1));

    const progress = openSection(/6 · Progress/i);
    expect(statValue(progress, 'sessions this week')).toBe('1/4');
    expect(statValue(progress, 'runs logged')).toBe('1');
  });
});

describe('Fit — signed in: coaching', () => {
  beforeEach(() => {
    window.localStorage.clear();
    askFitCoach.mockReset();
  });

  afterEach(cleanup);

  const advice = {
    summary: 'Back the pressing volume off one set and keep the easy runs easy.',
    loadAdjustments: [{ exercise: 'Barbell bench press', suggestion: 'Stay at 72.5 kg for 4 × 8.' }],
    running: 'Hold 25 min easy twice this week before adding distance.',
    recovery: ['Sleep 8 hours'],
    watchOuts: ['Left knee going down stairs'],
    seeAProfessional: false,
    seeAProfessionalReason: '',
  };

  it('sends the logged training and renders the advice with its disclaimer', async () => {
    askFitCoach.mockResolvedValue({ advice, disclaimer: 'Not medical advice.', provider: 'bedrock', screened: false });
    renderFit(USER);
    const coach = openSection(/8 · Ask the coach/i);
    fireEvent.change(within(coach).getByLabelText(/^Severity/i), { target: { value: '3' } });
    fireEvent.change(within(coach).getByLabelText(/your question/i), { target: { value: 'Should I deload?' } });

    fireEvent.click(within(coach).getByRole('button', { name: /get coaching/i }));

    await waitFor(() => expect(askFitCoach).toHaveBeenCalledTimes(1));
    const [token, payload] = askFitCoach.mock.calls[0];
    expect(token).toBe('jwt-token');
    expect(payload.pain.severity).toBe(3);
    expect(payload.question).toBe('Should I deload?');
    expect(payload.profile.units).toBe('kg');

    expect(await within(coach).findByText(/Back the pressing volume off one set/)).toBeInTheDocument();
    expect(within(coach).getByText('Barbell bench press')).toBeInTheDocument();
    expect(within(coach).getByText(/Not medical advice/)).toBeInTheDocument();
  });

  it('gives the athlete the coaching instead of a stack trace when the endpoint fails', async () => {
    askFitCoach.mockRejectedValue(Object.assign(new Error('The coach is unavailable right now.'), { status: 502 }));
    renderFit(USER);
    const coach = openSection(/8 · Ask the coach/i);
    fireEvent.click(within(coach).getByRole('button', { name: /get coaching/i }));

    expect(await within(coach).findByRole('alert')).toHaveTextContent(/unavailable right now/i);
  });

  it('surfaces the upgrade path when the AI credits run out', async () => {
    askFitCoach.mockRejectedValue(
      Object.assign(new Error('Monthly AI usage limit reached for your plan.'), {
        status: 402,
        planRequired: true,
        creditsRemaining: 0.02,
        upgradeUrl: '/pricing',
      })
    );
    renderFit(USER);
    const coach = openSection(/8 · Ask the coach/i);
    fireEvent.click(within(coach).getByRole('button', { name: /get coaching/i }));

    const alert = await within(coach).findByRole('alert');
    expect(alert).toHaveTextContent(/Monthly AI usage limit/);
    expect(within(alert).getByRole('link', { name: /see plans/i })).toHaveAttribute('href', '/pricing');
  });

  it('shows a red-flag answer as a plain warning', async () => {
    askFitCoach.mockResolvedValue({
      advice: { ...advice, summary: 'See a health professional first.', seeAProfessional: true, seeAProfessionalReason: 'You mentioned chest pain or pressure.' },
      disclaimer: 'Not medical advice.',
      provider: 'screened',
      screened: true,
    });
    renderFit(USER);
    const coach = openSection(/8 · Ask the coach/i);
    fireEvent.click(within(coach).getByRole('button', { name: /get coaching/i }));

    expect(await within(coach).findByText(/You mentioned chest pain or pressure/)).toBeInTheDocument();
    expect(within(coach).getByText(/have a health professional look at this/i)).toBeInTheDocument();
  });
});

describe('Fit — signed in: recommendations and reset', () => {
  beforeEach(() => {
    window.localStorage.clear();
    askFitCoach.mockReset();
  });

  afterEach(cleanup);

  it('marks the days and session length its own history suggests', async () => {
    const sessions = Array.from({ length: 6 }, (_, index) => ({
      id: `s${index}`,
      date: `2026-09-0${index + 1}`,
      dayId: 'd1',
      dayName: 'Push',
      unit: 'kg',
      durationMin: 44,
      blocks: [],
    }));
    window.localStorage.setItem('fit.state.v2', JSON.stringify({ profile: {}, sessions }));

    renderFit(USER);
    await waitFor(() => expect(screen.getByText(/Recommended from your own training/i)).toBeInTheDocument());
    // The recommended options are marked so the suggestion is visible, not silent.
    expect(screen.getAllByText('★').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: /use recommended/i }));
    expect(screen.getByRole('status')).toHaveTextContent(/Applied the settings your logged history suggests/i);
  });

  it('clears everything only after an explicit confirmation, and does not silently rebuild', async () => {
    renderFit(USER);
    await waitFor(() => expect(storedState()).not.toBeNull());

    fireEvent.click(screen.getByRole('button', { name: /clear my plan and history/i }));
    expect(screen.getByText(/delete your week, every logged session/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /yes, clear everything/i }));

    expect(screen.getByRole('status')).toHaveTextContent(/Everything cleared/i);
    await waitFor(() => expect(storedState().sessions).toEqual([]));
    // The athlete asked for an empty slate, so the week does not come back on
    // its own — it waits for an explicit "Build my week".
    expect(screen.queryByRole('heading', { name: /3 · Your week/i })).toBeNull();
    const setup = sectionByHeading(/1 · Your week, your rules/i);
    expect(within(setup).getByRole('button', { name: /build my week/i })).toBeInTheDocument();
  });

  it('persists a signed-in athlete’s week so it survives a reload', async () => {
    renderFit(USER);
    await waitFor(() => expect(storedState()?.plan?.days?.length).toBeGreaterThan(0));
    expect(storedState().profile.equipment).toEqual(expect.any(Array));
  });});
