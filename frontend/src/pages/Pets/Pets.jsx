import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import Header from '../../components/Header/Header';
import Footer from '../../components/Footer/Footer';
import SEO from '../../components/SEO/SEO.jsx';
import useScrollReveal from '../../hooks/useScrollReveal.js';
import * as petsApi from '../../services/petsApi';
import './Pets.css';

// ── Local constants (mirror the backend catalog for instant, offline UI) ────
const CARE_ACTIONS = [
  { key: 'feed', label: 'Feed', emoji: '🍖', hint: 'Feed your pet to fill its hunger' },
  { key: 'play', label: 'Play', emoji: '🎾', hint: 'Play to boost happiness (costs a little energy)' },
  { key: 'walk', label: 'Walk', emoji: '🚶', hint: 'Go for a walk — you never know what you might find' },
  { key: 'groom', label: 'Groom', emoji: '🛁', hint: 'Bathe and groom your pet to restore cleanliness' },
  { key: 'rest', label: 'Rest', emoji: '😴', hint: 'Let your pet sleep to restore energy' },
  { key: 'heal', label: 'Vet', emoji: '💊', hint: 'Visit the vet to restore health' },
];

const TREAT_COST = 5; // mirrors backend TREAT_COST / TRAIN_COST

const TRICK_META = [
  { id: 'sit', label: 'Sit', emoji: '🪑' },
  { id: 'shake', label: 'Shake', emoji: '🤝' },
  { id: 'roll', label: 'Roll Over', emoji: '🌀' },
  { id: 'fetch', label: 'Fetch', emoji: '🎾' },
  { id: 'highfive', label: 'High Five', emoji: '✋' },
];

const ACTION_META = {
  feed: { label: 'Fed', emoji: '🍖' },
  play: { label: 'Played', emoji: '🎾' },
  walk: { label: 'Walked', emoji: '🚶' },
  groom: { label: 'Groomed', emoji: '🛁' },
  rest: { label: 'Rested', emoji: '😴' },
  heal: { label: 'Vet visit', emoji: '💊' },
  treat: { label: 'Treat', emoji: '🍪' },
};

/** Map a care-log action key (e.g. "train:sit") to a display label + emoji. */
function actionMeta(action) {
  if (typeof action === 'string' && action.startsWith('train:')) {
    const id = action.slice('train:'.length);
    const trick = TRICK_META.find((t) => t.id === id);
    return { label: `Trained ${trick ? trick.label : id}`, emoji: trick ? trick.emoji : '🎓' };
  }
  return ACTION_META[action] || { label: action, emoji: '🐾' };
}

const POLL_INTERVAL_MS = 30000; // refresh decayed stats every 30s

const STAT_META = [
  { key: 'hunger', label: 'Fullness', emoji: '🍽️', hint: 'Fullness — how well-fed your pet is. Feed to raise it; it drops over time.' },
  { key: 'happiness', label: 'Happiness', emoji: '😊', hint: 'Happiness — your pet\'s mood. Play and treats raise it; neglect lowers it.' },
  { key: 'energy', label: 'Energy', emoji: '⚡', hint: 'Energy — how rested your pet is. Rest to restore it; activity drains it.' },
  { key: 'cleanliness', label: 'Cleanliness', emoji: '✨', hint: 'Cleanliness — how clean your pet is. Groom to raise it; it drops over time.' },
  { key: 'health', label: 'Health', emoji: '❤️', hint: 'Health — your pet\'s overall wellbeing. Drops when needs are ignored, recovers when they\'re met.' },
  { key: 'bond', label: 'Bond', emoji: '🤝', hint: 'Bond — your friendship level. It grows every time you interact with your pet.' },
];

/** Human-friendly age string from an ISO timestamp. */
function formatAge(bornAt) {
  const ms = Date.now() - new Date(bornAt).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just born';
  if (mins < 60) return `${mins}m old`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h old`;
  const days = Math.floor(hours / 24);
  if (days === 1) return '1 day old';
  return `${days} days old`;
}

function formatLogTime(iso) {
  return new Date(iso).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function statColor(value) {
  if (value >= 60) return 'good';
  if (value >= 30) return 'warn';
  return 'bad';
}

// ── AI artwork + visual reactions ──────────────────────────────────────────
// Artwork is auto-discovered from frontend/src/assets/art/pets/.
// Filename convention:  pet-<species>.<ext>  (one per species) and  room.<ext>
// (the room background). Missing files gracefully fall back to the emoji.
const petArtModules = import.meta.glob('../../assets/art/pets/*.{jpg,jpeg,png,webp}', {
  eager: true,
  import: 'default',
});

const petArt = {};
let roomArt = null;
Object.entries(petArtModules).forEach(([path, url]) => {
  const file = path.split('/').pop().toLowerCase();
  if (file.startsWith('room')) {
    roomArt = url;
  } else {
    const match = file.match(/^pet-([a-z]+)\./);
    if (match) petArt[match[1]] = url;
  }
});

// Floating emoji + particle burst shown when a pet reacts (fed, played, mood
// change, etc.) — each mood has its own signature.
const MOOD_REACTION = {
  ecstatic: { emoji: '🤩', burst: ['💖', '✨', '🌟', '💖', '✨'] },
  happy: { emoji: '😊', burst: ['💖', '✨', '💖'] },
  content: { emoji: '🙂', burst: ['✨'] },
  sleepy: { emoji: '😴', burst: ['💤', '💤'] },
  hungry: { emoji: '😋', burst: ['🍖'] },
  sad: { emoji: '😢', burst: ['💧'] },
  lonely: { emoji: '🥺', burst: ['💧'] },
  messy: { emoji: '😅', burst: ['💧'] },
  dirty: { emoji: '😰', burst: ['💧'] },
  exhausted: { emoji: '😮‍💨', burst: ['💤'] },
  starving: { emoji: '😫', burst: ['🍖'] },
  sick: { emoji: '🤒', burst: ['💊'] },
  critical: { emoji: '🚨', burst: ['🚨'] },
  passed: { emoji: '🌈', burst: ['🌈'] },
};

// Ranked worst → best, so we can tell whether a mood change is an improvement.
const MOOD_RANK = {
  passed: 0, critical: 1, sick: 2, starving: 3, exhausted: 4, lonely: 5,
  dirty: 6, messy: 7, sad: 8, hungry: 9, sleepy: 10, content: 11, happy: 12, ecstatic: 13,
};

// Place the Nth pet along the room floor with a touch of depth variation.
function roomSpot(index, count) {
  const total = Math.max(1, count);
  const t = total === 1 ? 0.5 : index / (total - 1);
  const left = 12 + t * 76;
  const depth = (1 - Math.abs(t - 0.5) * 0.18).toFixed(2);
  const bottom = Math.max(5, 8 + Math.sin(index * 1.9) * 2.5);
  return { left: `${left}%`, bottom: `${bottom}%`, '--depth': depth };
}

// ── Small presentational pieces ──────────────────────────────────────────────

function StatBar({ label, emoji, value, hint }) {
  const val = Number.isFinite(value) ? value : 0;
  const tone = statColor(val);
  return (
    <div className="pets-stat" title={hint}>
      <div className="pets-stat__top">
        <span className="pets-stat__label">
          <span className="pets-stat__emoji" aria-hidden="true">{emoji}</span>
          <span>{label}</span>
        </span>
        <span className="pets-stat__value">{Math.round(val)}</span>
      </div>
      <div
        className={`pets-stat__track pets-stat__track--${tone}`}
        role="progressbar"
        aria-valuenow={Math.round(val)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label}: ${Math.round(val)}%`}
      >
        <div className="pets-stat__fill" style={{ width: `${Math.min(100, Math.max(0, val))}%` }} />
      </div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

function Pets() {
  const { user } = useSelector((state) => state.data);
  const token = user?.token || null;

  const [pets, setPets] = useState([]);
  const [species, setSpecies] = useState([]);
  const [maxPets, setMaxPets] = useState(3);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyAction, setBusyAction] = useState(null);
  const [selectedPetId, setSelectedPetId] = useState(null);
  const [reaction, setReaction] = useState(null);
  const reactionTimer = useRef(null);
  const [detailRef, detailVisible] = useScrollReveal();

  const selectPet = useCallback(
    (petId) => {
      setSelectedPetId(petId);
      if (detailRef.current) {
        detailRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    },
    [detailRef]
  );

  // Adoption form state
  const [showAdopt, setShowAdopt] = useState(false);
  const [adoptSpecies, setAdoptSpecies] = useState('');
  const [adoptName, setAdoptName] = useState('');
  const [adopting, setAdopting] = useState(false);

  const loadPets = useCallback(async () => {
    if (!token) return;
    try {
      const data = await petsApi.fetchPets(token);
      setPets(data.pets || []);
      setSpecies(data.species || []);
      setMaxPets(data.maxPets || 3);
      setError(null);
    } catch (err) {
      setError(err.message || 'Failed to load pets');
    } finally {
      setLoading(false);
    }
  }, [token]);

  // Initial load (re-runs whenever the auth token changes, e.g. re-login)
  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    loadPets();
  }, [token, loadPets]);

  // Poll for decayed stats
  useEffect(() => {
    if (!token) return undefined;
    const id = setInterval(loadPets, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [token, loadPets]);

  // Clear any in-flight reaction animation on unmount.
  useEffect(
    () => () => {
      if (reactionTimer.current) clearTimeout(reactionTimer.current);
    },
    []
  );

  const livingPets = useMemo(() => pets.filter((p) => p.alive), [pets]);
  const selectedPet = useMemo(
    () => pets.find((p) => p._id === selectedPetId) || pets[0] || null,
    [pets, selectedPetId]
  );

  const handleAdopt = useCallback(async (e) => {
    e.preventDefault();
    if (!adoptSpecies || !adoptName.trim()) {
      toast.warn('Choose a species and give your pet a name.');
      return;
    }
    setAdopting(true);
    try {
      await petsApi.adoptPet(token, { name: adoptName.trim(), species: adoptSpecies });
      toast.success(`${adoptName.trim()} joined your family! 🎉`);
      setAdoptName('');
      setAdoptSpecies('');
      setShowAdopt(false);
      await loadPets();
    } catch (err) {
      toast.error(err.message || 'Failed to adopt pet');
    } finally {
      setAdopting(false);
    }
  }, [adoptSpecies, adoptName, token, loadPets]);

  const handleAction = useCallback(
    async (pet, action, extra = {}) => {
      const prevMood = pet.mood;
      setBusyAction(action);
      try {
        const updated = await petsApi.petAction(token, pet._id, action, extra);
        setPets((prev) => prev.map((p) => (p._id === updated._id ? updated : p)));

        // Visual reaction — show exactly how the pet is feeling right now.
        const improved = (MOOD_RANK[updated.mood] || 0) > (MOOD_RANK[prevMood] || 0);
        const react = MOOD_REACTION[updated.mood] || { emoji: '🐾', burst: ['✨'] };
        const burst = improved ? ['💖', ...react.burst] : react.burst;
        const nonce = Date.now();
        setReaction({ petId: updated._id, emoji: react.emoji, burst, nonce, improved });
        if (reactionTimer.current) clearTimeout(reactionTimer.current);
        reactionTimer.current = setTimeout(
          () => setReaction((r) => (r && r.nonce === nonce ? null : r)),
          1600
        );

        if (updated.walkEvent) {
          toast.info(
            `${pet.emoji} ${pet.name} ${updated.walkEvent.label}` +
              (updated.walkEvent.treats ? ` (+${updated.walkEvent.treats} treats)` : ''),
            { autoClose: 4500 }
          );
        }
        if (updated.newlyCompleted?.length) {
          toast.success('🎯 Daily challenge complete!');
        }
        if (action === 'train' && extra.trickId) {
          const trick = updated.tricks?.find((t) => t.id === extra.trickId);
          if (trick?.mastered) toast.success(`${pet.name} mastered “${trick.label}”! 🎓`);
        }
      } catch (err) {
        toast.error(err.message || 'Action failed');
      } finally {
        setBusyAction(null);
      }
    },
    [token]
  );

  const handleRelease = useCallback(
    async (pet) => {
      const confirmed = window.confirm(
        `Release ${pet.name}? This can't be undone.`
      );
      if (!confirmed) return;
      try {
        await petsApi.releasePet(token, pet._id);
        toast.success(`${pet.name} was released.`);
        setPets((prev) => prev.filter((p) => p._id !== pet._id));
      } catch (err) {
        toast.error(err.message || 'Failed to release pet');
      }
    },
    [token]
  );

  // ── Not signed in ─────────────────────────────────────────────────────────
  if (!token) {
    return (
      <>
        <Header />
        <main className="pets-page">
          <section className="pets-empty">
            <div className="pets-empty__emoji" aria-hidden="true">🐾</div>
            <h1>Your Pets</h1>
            <p>
              Adopt a virtual pet and keep it happy, fed, and alive. Your pets are
              saved to your account, so they'll be waiting for you every time you
              come back.
            </p>
            <div className="pets-empty__actions">
              <Link className="pets-btn pets-btn--primary" to="/login">Log in</Link>
              <Link className="pets-btn pets-btn--ghost" to="/register">Create an account</Link>
            </div>
          </section>
        </main>
        <Footer />
      </>
    );
  }

  if (loading) {
    return (
      <>
        <Header />
        <main className="pets-page">
          <div className="pets-loading" role="status" aria-label="Loading pets">
            <div className="pets-loading__spinner" />
            <p>Fetching your pets…</p>
          </div>
        </main>
        <Footer />
      </>
    );
  }

  if (error) {
    return (
      <>
        <Header />
        <main className="pets-page">
          <section className="pets-empty">
            <div className="pets-empty__emoji" aria-hidden="true">😿</div>
            <h1>Couldn't load your pets</h1>
            <p>{error}</p>
            <button type="button" className="pets-btn pets-btn--primary" onClick={loadPets}>
              Try again
            </button>
          </section>
        </main>
        <Footer />
      </>
    );
  }

  // ── No pets yet — adoption screen ──────────────────────────────────────────
  if (pets.length === 0 && !showAdopt) {
    return (
      <>
        <Header />
        <main className="pets-page">
          <section className="pets-empty">
            <div className="pets-empty__emoji" aria-hidden="true">🏠</div>
            <h1>Welcome to the Pet House</h1>
            <p>
              Pick a companion, give it a name, and check in each day to feed,
              play, and keep it healthy. Neglected pets get sad, then sick — so
              don't forget to visit!
            </p>
            <button
              type="button"
              className="pets-btn pets-btn--primary"
              onClick={() => setShowAdopt(true)}
              title="Choose a species and name to adopt a pet"
            >
              🐾 Adopt a pet
            </button>
          </section>
        </main>
        <Footer />
      </>
    );
  }

  // ── Adoption form ──────────────────────────────────────────────────────────
  if (showAdopt) {
    return (
      <>
        <Header />
        <main className="pets-page">
          <section className="pets-adopt">
            <h1>Adopt a new friend</h1>
            <form onSubmit={handleAdopt} className="pets-adopt__form">
              <fieldset className="pets-adopt__species">
                <legend>Choose a species</legend>
                <div className="pets-adopt__grid">
                  {species.map((s) => (
                    <button
                      key={s.key}
                      type="button"
                      className={`pets-species-card ${adoptSpecies === s.key ? 'is-selected' : ''}`}
                      onClick={() => setAdoptSpecies(s.key)}
                      aria-pressed={adoptSpecies === s.key}
                      title={`Adopt a ${s.label}`}
                    >
                      <span className="pets-species-card__emoji" aria-hidden="true">{s.emoji}</span>
                      <span className="pets-species-card__label">{s.label}</span>
                    </button>
                  ))}
                </div>
              </fieldset>

              <label className="pets-adopt__name">
                <span>Name your pet</span>
                <input
                  type="text"
                  maxLength={24}
                  placeholder="e.g. Biscuit"
                  value={adoptName}
                  onChange={(e) => setAdoptName(e.target.value)}
                  autoFocus
                />
              </label>

              <div className="pets-adopt__actions">
                <button
                  type="button"
                  className="pets-btn pets-btn--ghost"
                  onClick={() => setShowAdopt(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="pets-btn pets-btn--primary"
                  disabled={adopting || !adoptSpecies || !adoptName.trim()}
                >
                  {adopting ? 'Adopting…' : 'Adopt'}
                </button>
              </div>
            </form>
          </section>
        </main>
        <Footer />
      </>
    );
  }

  const canAdoptMore = livingPets.length < maxPets;

  // ── Main pets view ─────────────────────────────────────────────────────────
  return (
    <>
      <SEO
        title="The Pet House"
        description="Adopt a virtual pet, keep it fed and happy, and watch its mood change in real time."
        path="/pets"
      />
      <Header />
      <main className="pets-page">
        <header className="pets-hero">
          <p className="pets-eyebrow">Virtual Pets</p>
          <h1 className="pets-title">The Pet House</h1>
          <p className="pets-subtitle">
            {livingPets.length} of {maxPets} living companions · stats update in real time.
            Feed, play, and care for them — they'll show you exactly how they feel.
          </p>
          {canAdoptMore && (
            <button
              type="button"
              className="pets-btn pets-btn--primary"
              onClick={() => setShowAdopt(true)}
              title="Adopt another pet into your family"
            >
              🐾 Adopt another
            </button>
          )}
        </header>

        <section className="pets-room" aria-label={`${pets.length} pets in their room`}>
          {roomArt ? (
            <img className="pets-room__bg" src={roomArt} alt="" aria-hidden="true" />
          ) : null}
          <div className="pets-room__floor" aria-hidden="true" />
          {pets.map((pet, i) => {
            const spot = roomSpot(i, pets.length);
            const image = petArt[pet.species];
            const isSelected = selectedPet?._id === pet._id;
            const isReacting = reaction?.petId === pet._id;
            return (
              <button
                key={pet._id}
                type="button"
                className={`pets-room-pet is-${pet.mood}${isSelected ? ' is-active' : ''}${pet.alive ? '' : ' is-passed'}`}
                style={{
                  left: spot.left,
                  bottom: spot.bottom,
                  '--depth': spot['--depth'],
                  zIndex: isSelected ? 4 : 2,
                }}
                onClick={() => selectPet(pet._id)}
                aria-pressed={isSelected}
                title={`${pet.name} — ${pet.moodMeta?.label || ''}`}
              >
                <span className="pets-room-pet__body">
                  {image ? (
                    <img className="pets-room-pet__img" src={image} alt={pet.name} loading="lazy" />
                  ) : (
                    <span className="pets-room-pet__emoji" aria-hidden="true">{pet.emoji}</span>
                  )}
                  {isReacting && (
                    <span
                      key={reaction.nonce}
                      className={`pets-room-pet__reaction${reaction.improved ? ' is-improved' : ''}`}
                      aria-hidden="true"
                    >
                      <span className="pets-room-pet__reaction-mood">{reaction.emoji}</span>
                      {reaction.burst.map((b, bi) => (
                        <span key={bi} className="pets-room-pet__burst" style={{ '--bi': bi }}>
                          {b}
                        </span>
                      ))}
                    </span>
                  )}
                </span>
                <span className="pets-room-pet__badge">
                  <span className="pets-room-pet__name">
                    {pet.name}
                    {pet.alive ? '' : ' 🌈'}
                  </span>
                  <span className="pets-room-pet__mood">
                    {pet.moodMeta?.emoji} {pet.moodMeta?.label}
                  </span>
                </span>
              </button>
            );
          })}
        </section>

        <div className="pets-detail-wrap">

          {/* Selected pet detail */}
          {selectedPet && (
            <section
              ref={detailRef}
              className={`pets-detail pets-reveal ${detailVisible ? 'is-visible' : ''}`}
              aria-live="polite"
            >
              <div className="pets-detail__hero">
                <div className={`pets-detail__avatar is-${selectedPet.mood} ${!selectedPet.alive ? 'is-passed' : ''}`}>
                  {petArt[selectedPet.species] ? (
                    <img src={petArt[selectedPet.species]} alt={selectedPet.name} />
                  ) : (
                    <span aria-hidden="true">{selectedPet.emoji}</span>
                  )}
                </div>
                <div className="pets-detail__id">
                  <h2>{selectedPet.name}</h2>
                  <p className="pets-detail__mood">
                    {selectedPet.moodMeta?.emoji} {selectedPet.moodMeta?.label}
                  </p>
                  <p className="pets-detail__meta">
                    {[selectedPet.speciesLabel, selectedPet.stageLabel, formatAge(selectedPet.bornAt)]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                <div className="pets-detail__level">
                  <span className="pets-detail__level-num">Lv {selectedPet.level}</span>
                  <div className="pets-detail__xp" role="progressbar"
                    aria-valuenow={selectedPet.xpIntoLevel}
                    aria-valuemin={0}
                    aria-valuemax={selectedPet.xpForLevel}
                    aria-label={`Level progress ${selectedPet.xpIntoLevel} of ${selectedPet.xpForLevel}`}
                  >
                    <div
                      className="pets-detail__xp-fill"
                      style={{ width: `${(selectedPet.xpIntoLevel / selectedPet.xpForLevel) * 100}%` }}
                    />
                  </div>
                  <span
                    className="pets-detail__treats"
                    title="Treats are your in-game currency. Earn +2 every time you Feed, Play, Walk, Groom, or Rest your pet — plus more from walks and daily challenges. Spend them on snacks and training."
                    aria-label={`${selectedPet.treats || 0} treats. Earn more by feeding, playing, walking, grooming, or resting your pet.`}
                  >
                    🍪 {selectedPet.treats || 0}
                  </span>
                </div>
              </div>

              {selectedPet.alive ? (
                <>
                  <div className="pets-detail__stats">
                    {STAT_META.map((s) => (
                      <StatBar
                        key={s.key}
                        label={s.label}
                        emoji={s.emoji}
                        value={selectedPet.stats[s.key]}
                        hint={s.hint}
                      />
                    ))}
                  </div>

                  <div className="pets-detail__actions">
                    {CARE_ACTIONS.map((a) => (
                      <button
                        key={a.key}
                        type="button"
                        className="pets-action-btn"
                        onClick={() => handleAction(selectedPet, a.key)}
                        disabled={busyAction !== null}
                        title={a.hint}
                        aria-label={a.hint}
                      >
                        <span className="pets-action-btn__emoji" aria-hidden="true">{a.emoji}</span>
                        <span>{a.label}</span>
                      </button>
                    ))}
                    <button
                      type="button"
                      className="pets-action-btn"
                      onClick={() => handleAction(selectedPet, 'treat')}
                      disabled={busyAction !== null || (selectedPet.treats || 0) < TREAT_COST}
                      title={`Give a treat snack (−${TREAT_COST} treats) to boost happiness and bond`}
                      aria-label={`Give a treat snack for ${TREAT_COST} treats`}
                    >
                      <span className="pets-action-btn__emoji" aria-hidden="true">🍪</span>
                      <span>Treat (−{TREAT_COST})</span>
                    </button>
                  </div>

                  <div className="pets-panel">
                    <h3 className="pets-panel__title">Tricks</h3>
                    <div className="pets-tricks">
                      {(selectedPet.tricks || []).map((t) => (
                        <div key={t.id} className={`pets-trick ${t.mastered ? 'is-mastered' : ''}`}>
                          <span className="pets-trick__emoji" aria-hidden="true">{t.emoji}</span>
                          <div className="pets-trick__body">
                            <div className="pets-trick__top">
                              <span className="pets-trick__label">{t.label}</span>
                              <span className="pets-trick__status">{t.mastered ? 'Mastered' : `${t.progress}%`}</span>
                            </div>
                            <div
                              className="pets-trick__track"
                              role="progressbar"
                              aria-valuenow={t.progress}
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-label={`${t.label} progress ${t.progress}%`}
                            >
                              <div className="pets-trick__fill" style={{ width: `${t.progress}%` }} />
                            </div>
                          </div>
                          <button
                            type="button"
                            className="pets-btn pets-btn--ghost pets-trick__train"
                            onClick={() => handleAction(selectedPet, 'train', { trickId: t.id })}
                            disabled={busyAction !== null || t.mastered || (selectedPet.treats || 0) < TREAT_COST}
                            title={t.mastered ? `${t.label} mastered` : `Practice ${t.label} (−${TREAT_COST} treats)`}
                            aria-label={t.mastered ? `${t.label} mastered` : `Practice ${t.label}`}
                          >
                            {t.mastered ? '✓' : 'Train'}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="pets-panel">
                    <h3 className="pets-panel__title">Daily challenges</h3>
                    <div className="pets-challenges">
                      {(selectedPet.challenges || []).map((c) => (
                        <div key={c.id} className={`pets-challenge ${c.completed ? 'is-completed' : ''}`}>
                          <div className="pets-challenge__top">
                            <span className="pets-challenge__label">{c.label}</span>
                            <span className="pets-challenge__reward">+{c.reward.treats} 🍪</span>
                          </div>
                          <div
                            className="pets-challenge__track"
                            role="progressbar"
                            aria-valuenow={c.progress}
                            aria-valuemin={0}
                            aria-valuemax={c.target}
                            aria-label={`${c.label}: ${c.progress} of ${c.target}`}
                          >
                            <div className="pets-challenge__fill" style={{ width: `${(c.progress / c.target) * 100}%` }} />
                          </div>
                          <span className="pets-challenge__count">
                            {c.completed ? '✓ Done' : `${c.progress}/${c.target}`}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {selectedPet.mood === 'sick' || selectedPet.mood === 'critical' ? (
                    <div className="pets-banner pets-banner--warn" role="status">
                      {selectedPet.emoji} {selectedPet.name} isn't feeling well — try the Vet!
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="pets-banner pets-banner--passed" role="status">
                  <span aria-hidden="true">🌈</span>
                  <div>
                    <strong>{selectedPet.name} has passed away.</strong>
                    <p>
                      You cared for them for {formatAge(selectedPet.bornAt)}. You can revive
                      them ({selectedPet.reviveCount} of 3 lives used) or release them.
                    </p>
                    <div className="pets-detail__actions">
                      <button
                        type="button"
                        className="pets-action-btn"
                        onClick={() => handleAction(selectedPet, 'revive')}
                        disabled={busyAction !== null || selectedPet.reviveCount >= 3}
                        title="Bring your pet back to life (uses one of 3 lives)"
                        aria-label="Revive this pet"
                      >
                        <span className="pets-action-btn__emoji" aria-hidden="true">💖</span>
                        <span>Revive</span>
                      </button>
                      <button
                        type="button"
                        className="pets-action-btn pets-action-btn--danger"
                        onClick={() => handleRelease(selectedPet)}
                        title="Permanently release this pet — this cannot be undone"
                        aria-label="Release this pet"
                      >
                        <span className="pets-action-btn__emoji" aria-hidden="true">🕊️</span>
                        <span>Release</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {selectedPet.careLog?.length > 0 && (
                <div className="pets-carelog">
                  <h3>Recent care</h3>
                  <ul>
                    {selectedPet.careLog.slice(0, 8).map((entry, i) => {
                      const meta = actionMeta(entry.action);
                      return (
                        <li key={i}>
                          <span className="pets-carelog__icon" aria-hidden="true">{meta.emoji}</span>
                          <span className="pets-carelog__action">{meta.label}</span>
                          <span className="pets-carelog__time">{formatLogTime(entry.at)}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </section>
          )}
        </div>
      </main>
      <Footer />
    </>
  );
}

export default Pets;
