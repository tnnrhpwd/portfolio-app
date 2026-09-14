import React, { useCallback, useEffect, useRef } from 'react';
import Header from '../../../components/Header/Header';
import Footer from '../../../components/Footer/Footer';
import SEO, { SITE_URL } from '../../../components/SEO/SEO.jsx';
import useScrollReveal from '../../../hooks/useScrollReveal';
import useScrollProgress from '../../../hooks/useScrollProgress';
import useCountUp from '../../../hooks/useCountUp';
import usePointerTilt from '../../../hooks/usePointerTilt';
import { hasFinePointer, prefersReducedMotion } from '../../../hooks/scrollEngine';
import headshot from '../../../assets/1788391647406.jpg';
import artSummary from '../../../assets/art/about-summary-art.png';
import artJourney from '../../../assets/art/about-journey-art.png';
import artFactory from '../../../assets/art/about-factory-art.png';
import artAscent from '../../../assets/art/about-ascent-art.png';
import './resume.css';

const EMAIL = 'Steven.T.Hopwood@gmail.com';
const LINKEDIN = 'https://www.linkedin.com/in/sthopwood/';
const GITHUB = 'https://github.com/tnnrhpwd';

// Starting the timer on '2021-09-12' ensures the years-in-manufacturing number
// stays accurate (computed to one decimal place) without a yearly manual update.
const MANUFACTURING_START_DATE = new Date('2021-09-12');
const yearsInManufacturing = (
  (Date.now() - MANUFACTURING_START_DATE.getTime()) /
  (1000 * 60 * 60 * 24 * 365.25)
).toFixed(1);

// Numbers, not strings, because these count up. The rendered value is rebuilt
// from the parts, so `$239K+` still reads exactly as before once it settles.
// The summary's stat row no longer carries the two money figures: those belong
// to the impact panel below it, where they are drawn rather than restated. Two
// places saying $239K would just be noise.
const ACHIEVEMENTS = [
  { to: 3.44, decimals: 2, label: 'College GPA' },
  { to: Number(yearsInManufacturing), decimals: 1, label: 'Years in manufacturing' },
];

// The impact panel. `share` is derived from the largest bar, so the two are
// directly comparable; the reason is printed under the chart so nobody has to
// guess what the bar lengths mean.
const IMPACT_TOTAL = { to: 250, prefix: '$', suffix: 'K+', label: 'in reported savings across five roles' };

const IMPACT_BARS = [
  { to: 239, prefix: '$', suffix: 'K+', share: 1, label: 'Direct cost savings', note: 'Yanfeng Interiors, Tier-1 OEM launches' },
  { to: 45, prefix: '$', suffix: 'K', share: 45 / 239, label: 'Annual materials savings', note: 'Shaw Industries, and it repeats every year' },
];

const SKILLS = [
  {
    title: 'Software & tools',
    items: ['Microsoft Office', 'Google Workspace', 'GitHub', 'Autodesk Inventor', 'Revit', 'AutoCAD', 'ArchiCAD', 'ProModel', 'VSCode', 'SolidWorks', 'Cognex Vision Suite', 'Splunk', 'MLEAN', 'Microsoft Visio', 'SAP', 'PLM'],
  },
  {
    title: 'Languages, libraries & environments',
    items: ['C# .NET', 'JavaScript', 'HTML', 'CSS', 'Python', 'Visual Basic', 'Java', 'ReactJS', 'NodeJS (ExpressJS)', 'AWS', 'CI/CD'],
  },
  {
    title: 'Process & operations',
    items: ['Lean Manufacturing', 'Six Sigma Green Belt', '5S', 'SMED', 'PFMEA', 'Poke Yoke', 'Takt Time', 'MIFD / VSM', 'CAPEX', 'Direct Labor Efficiency'],
  },
];

const TIMELINE = [
  { period: '2017', title: 'Marshall County High School', detail: 'Graduated and headed toward engineering.' },
  { period: '2017 – 2018', title: 'Tennessee Tech University', detail: 'Started engineering coursework before transferring to UTC.' },
  { period: '2019 – 2021', title: 'University of Tennessee at Chattanooga', detail: 'BS in Engineering Technology Management, Dean\'s List, 3.44 GPA.' },
  { period: '2021 – Now', title: 'Manufacturing & software career', detail: 'Five roles across Tier-1 automotive, lean, and full-stack development.' },
];

const JOBS = [
  {
    title: 'Advanced Manufacturing Engineer',
    company: 'Yanfeng Interiors',
    location: 'Chattanooga, TN',
    period: 'Aug 2023 – Current',
    bullets: [
      'Drove $239K+ in direct savings plus additional indirect benefits.',
      'Authored technical specs for custom tooling and CAPEX equipment on Tier-1 OEM launches.',
      'Developed Takt Time-compliant machine instructions; authored PFMEA and Poke Yoke matrices.',
      'Quoted and negotiated machine designs to cut costs; managed CAPEX and tooling purchases through installation.',
      'Optimized facilities with AutoCAD and coordinated utilities for homelining readiness.',
    ],
  },
  {
    title: 'Lean Manufacturing Engineer',
    company: 'Faurecia Interior Systems',
    location: 'Spring Hill, TN',
    period: 'Jul 2022 – Aug 2023',
    bullets: [
      'Led quarterly 5S workshops and maintained plant material/information flow (MIFD).',
      'Coordinated SMED workshops to reduce changeover times, batch sizes, and inventory.',
      'Reported and increased Direct Labor Efficiency (DLE) through production scheduling.',
      'Implemented team-owned paperless work instructions for better quality and standardization.',
    ],
  },
  {
    title: 'Industrial Engineer',
    company: 'Aallied Die Casting of Illinois',
    location: 'Franklin Park, IL',
    period: 'Aug – Nov 2021',
    bullets: [
      'Managed facility AutoCAD layouts to optimize production flow, cutting cycle times and labor.',
      'Submitted RFQs, managed POs, and procured tooling materials on schedule.',
      'Automated part inspection with vision cameras, improving quality and lowering labor costs.',
    ],
  },
  {
    title: 'Process Improvement Co-op',
    company: 'Shaw Industries',
    location: 'Dalton, GA',
    period: 'Jan – May 2021',
    bullets: [
      'Reduced seam cut width, saving $45K annually in materials and improving product quality.',
      'Used labor-utilization studies to reduce outside labor costs.',
      'Coordinated 5S improvement of Creeling workspaces and audited inbound yarn weight.',
    ],
  },
  {
    title: 'Production Technician',
    company: 'Marelli',
    location: 'Lewisburg, TN',
    period: 'Jul – Aug 2020',
    bullets: [],
  },
  {
    title: 'Operations Intern',
    company: 'Lewisburg Water & Wastewater',
    location: 'Lewisburg, TN',
    period: 'Jun – Aug 2019 · Dec 2019',
    bullets: [],
  },
];

const OTHER_EXPERIENCE = [
  { title: 'Software Engineer', detail: 'Jan – Jul 2022' },
  { title: 'UTC Technology Symposium Candidate', detail: 'Jan – Apr 2021' },
  { title: 'COVID-19 Contact Tracer', detail: 'May – Jun 2020' },
  { title: 'Political Canvasser', detail: 'May – Jul 2018' },
];

const EDUCATION = [
  { title: 'BS in Engineering Technology Management', org: 'University of Tennessee at Chattanooga', detail: 'Jan 2019 – Aug 2021 · Dean\'s List · 3.44 GPA' },
  { title: 'Engineering Coursework', org: 'Tennessee Technological University', detail: 'Aug 2017 – Dec 2018' },
  { title: 'Marshall County High School', org: '', detail: 'Graduated 2017' },
];

const CERTIFICATIONS = [
  { title: 'Franklin Covey Personal Leadership Development Program', detail: 'June 2025' },
  { title: 'Six Sigma Green Belt', detail: 'May 2023' },
];

/* ── Word-by-word mask reveal ────────────────────────────────────────────────
   Every word rides up from behind its own clipping box, staggered by `--i`.
   The words stay separate text nodes joined by real spaces, so the accessible
   name of a heading is still the heading — nothing needs an aria-label. Two
   drivers share this markup: the hero animates it on load, section headings
   transition it when `RevealBand` adds `is-visible`. */
function MaskedText({ text }) {
  return String(text)
    .split(' ')
    .map((word, index) => (
      <React.Fragment key={`${word}-${index}`}>
        {index > 0 ? ' ' : null}
        <span className="about-mask" style={{ '--i': index }}>
          <span className="about-mask-in">{word}</span>
        </span>
      </React.Fragment>
    ));
}

/* Desktop-only pointer bloom. */
function PointerGlow() {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !hasFinePointer() || prefersReducedMotion()) return undefined;

    let frame = null;
    let x = 0;
    let y = 0;
    const flush = () => {
      frame = null;
      el.style.setProperty('--glow-x', `${x}px`);
      el.style.setProperty('--glow-y', `${y}px`);
    };
    const onMove = (event) => {
      x = event.clientX;
      y = event.clientY;
      el.dataset.pointer = 'on';
      if (frame === null) frame = requestAnimationFrame(flush);
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, []);

  return <div className="about-glow" ref={ref} aria-hidden="true" />;
}

/* One drawn bar. The value counts up and the bar grows to its share of the
   largest win, both switched on by the band's `is-visible`. */
function ImpactBar({ item, index }) {
  const [ref, value] = useCountUp(item.to, { prefix: item.prefix, suffix: item.suffix });
  return (
    <div className="about-impact-row" ref={ref} style={{ '--share': item.share, '--i': index }}>
      <div className="about-impact-head">
        <span className="about-impact-label">{item.label}</span>
        <span className="about-impact-value">{value}</span>
      </div>
      <span className="about-impact-track">
        <span className="about-impact-bar" />
      </span>
      <p className="about-impact-note">{item.note}</p>
    </div>
  );
}

/* Sits at the foot of the summary band, where the prose has just made a claim
   about savings and the reader is owed the breakdown.
   It carries its OWN reveal rather than borrowing the band's: the band is over
   700px tall, so its `is-visible` fires long before the panel is on screen and
   the bars would be finished before anybody saw them start. */
function ImpactPanel() {
  const [countRef, total] = useCountUp(IMPACT_TOTAL.to, { prefix: IMPACT_TOTAL.prefix, suffix: IMPACT_TOTAL.suffix });
  const [revealRef, visible] = useScrollReveal();
  const setRef = useCallback((el) => { countRef(el); revealRef(el); }, [countRef, revealRef]);
  return (
    <div className={`about-impact about-reveal ${visible ? 'is-visible' : ''}`} ref={setRef}>
      <div className="about-impact-headline">
        <span className="about-impact-total">{total}</span>
        <span className="about-impact-total-label">{IMPACT_TOTAL.label}</span>
      </div>
    </div>
  );
}

function RevealBand({ id, className = '', children }) {
  const [ref, visible] = useScrollReveal();
  return (
    <section ref={ref} id={id} className={`about-band ${className} about-reveal ${visible ? 'is-visible' : ''}`}>
      <div className="about-wrap">{children}</div>
    </section>
  );
}

function SectionHead({ eyebrow, title, lead }) {
  return (
    <div className="about-section-head">
      {eyebrow && <p className="about-eyebrow">{eyebrow}</p>}
      <h2 className="about-heading">
        <MaskedText text={title} />
      </h2>
      {lead && <p className="about-lead">{lead}</p>}
    </div>
  );
}

/* A stat that counts up the first time it is properly on screen. */
function StatCard({ stat }) {
  const [ref, value] = useCountUp(stat.to, {
    decimals: stat.decimals || 0,
    prefix: stat.prefix || '',
    suffix: stat.suffix || '',
  });
  return (
    <div className="about-stat" ref={ref}>
      <span className="about-stat-value">{value}</span>
      <span className="about-stat-label">{stat.label}</span>
    </div>
  );
}

/* One timeline stop. Each tracks itself, so its marker grows and its card
   slides in as it enters — the band's own reveal deliberately does not stagger
   these.

   ⚠️ The window is deliberately EARLY: 0.02 → 0.32 of the stop's travel, which
   completes it about 70% of the way down the viewport. It was 0.24 → 0.6, which
   only finished the slide-in once the stop had climbed to the middle of the
   screen — and because the band's top edge enters the viewport long before its
   contents have travelled anywhere, that left the first stops of the timeline
   sitting invisible inside an otherwise fully revealed band.

   Keep this ahead of the band's own `useScrollReveal` (which fires 150px before
   the band enters), never behind it: the band leads, its contents follow. */
function TimelineItem({ item }) {
  const ref = useScrollProgress({ property: '--item-p', start: 0.02, end: 0.32 });
  return (
    <li className="about-timeline-item" ref={ref}>
      <span className="about-timeline-marker" aria-hidden="true" />
      <div className="about-timeline-card">
        <span className="about-timeline-period">{item.period}</span>
        <h3 className="about-timeline-title">{item.title}</h3>
        <p className="about-timeline-detail">{item.detail}</p>
      </div>
    </li>
  );
}

/* Illustration that drifts inside its own frame as the frame crosses the
   viewport, and leans toward the pointer. The image is taller than the frame,
   which clips it. */
function MediaBlock({ src, sticky = false }) {
  const progressRef = useScrollProgress({ property: '--media-p', start: 0.15, end: 0.85 });
  const tiltRef = usePointerTilt();
  // Both hooks hand back a stable callback ref, so they compose into one — an
  // element can only hold a single ref.
  const setRef = useCallback((el) => { progressRef(el); tiltRef(el); }, [progressRef, tiltRef]);
  return (
    <div ref={setRef} className={`about-media-block${sticky ? ' about-media-block--sticky' : ''}`}>
      <img className="about-media-img" src={src} alt="" loading="lazy" aria-hidden="true" />
    </div>
  );
}

function MediaBanner({ src }) {
  const progressRef = useScrollProgress({ property: '--banner-p', start: 0.1, end: 0.9 });
  const tiltRef = usePointerTilt();
  const setRef = useCallback((el) => { progressRef(el); tiltRef(el); }, [progressRef, tiltRef]);
  return (
    <div className="about-media-banner" ref={setRef}>
      <img className="about-media-banner-img" src={src} alt="" loading="lazy" aria-hidden="true" />
    </div>
  );
}

/* The hero hands off to the page as you leave it: the copy lifts and fades, the
   portrait sinks and shrinks, and the scroll cue is gone within the first fifth
   of the travel. `.about-hero` also carries the timeline's stacked `.about-jobs`
   deck further down — see the note on `overflow-x` in resume.css. */
function Hero() {
  const ref = useScrollProgress({ property: '--hero-p', mode: 'top', end: 0.5 });
  return (
    <section className="about-hero" ref={ref}>
      <div className="about-wrap about-hero-grid">
        <div className="about-hero-copy">
          <p className="about-eyebrow">About me</p>
          <h1 className="about-title">
            <MaskedText text="Steven Tanner Hopwood" />
          </h1>
          <p className="about-subtitle">Advanced Manufacturing Engineer · Full-Stack Developer</p>
          <div className="about-chips">
            <a className="about-chip" href={`mailto:${EMAIL}`}>{EMAIL}</a>
            <span className="about-chip">Chattanooga, TN</span>
          </div>
          <div className="about-actions">
            <a className="about-btn" href={LINKEDIN} target="_blank" rel="noopener noreferrer">LinkedIn <span aria-hidden="true">→</span></a>
            <a className="about-btn about-btn-outline" href={GITHUB} target="_blank" rel="noopener noreferrer">GitHub <span aria-hidden="true">→</span></a>
          </div>
        </div>
        <div className="about-hero-media">
          <div className="about-portrait">
            <img className="about-portrait-img" src={headshot} alt="Portrait of Steven Tanner Hopwood" />
          </div>
        </div>
      </div>
      <div className="about-scroll-cue" aria-hidden="true">
        <span className="about-scroll-cue-rail">
          <span className="about-scroll-cue-dot" />
        </span>
        <span className="about-scroll-cue-text">Scroll</span>
      </div>
    </section>
  );
}

function About() {
  // Two page-level tracks: the decorative colour field's rotation and the
  // ambient blobs' drift. The timeline carries its own fill further down.
  const pageRef = useScrollProgress({ property: '--about-pgp', mode: 'page' });
  const floatingRef = useScrollProgress({ property: '--float-p', mode: 'page' });
  const timelineRef = useScrollProgress({ property: '--tl-p', start: 0.3, end: 0.85 });

  return (
    <>
      <SEO
        title="About"
        description="Steven Tanner Hopwood, Advanced Manufacturing Engineer and full-stack developer. Resume, experience, skills, and the journey from high school to now."
        path="/about"
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'Person',
          name: 'Steven Tanner Hopwood',
          alternateName: ['Steven Hopwood', 'STHopwood', 'sthopwood'],
          url: `${SITE_URL}/about`,
          image: `${SITE_URL}/STHlogo192.png`,
          email: EMAIL,
          jobTitle: 'Advanced Manufacturing Engineer',
          worksFor: {
            '@type': 'Organization',
            name: 'Yanfeng Interiors',
          },
          alumniOf: [
            { '@type': 'CollegeOrUniversity', name: 'University of Tennessee at Chattanooga' },
            { '@type': 'CollegeOrUniversity', name: 'Tennessee Technological University' },
            { '@type': 'HighSchool', name: 'Marshall County High School' },
          ],
          sameAs: [LINKEDIN, GITHUB],
          knowsAbout: SKILLS.flatMap((group) => group.items),
        }}
      />
      <div className="about" ref={pageRef}>
        <PointerGlow />
        <Header />
        <div className="about-floating" ref={floatingRef} aria-hidden="true">
          <div className="about-circle about-circle-1" />
          <div className="about-circle about-circle-2" />
          <div className="about-circle about-circle-3" />
          <div className="about-circle about-circle-4" />
        </div>

        <Hero />

        {/* Professional summary */}
        <RevealBand id="summary" className="about-band--surface">
          <div className="about-media-row">
            <MediaBlock src={artSummary} />
            <div className="about-media-copy">
              <SectionHead eyebrow="Professional summary" title="Driving change, one process at a time." />
              <p className="about-summary-text">
                Highly accomplished engineer with a proven track record of driving organizational change, cost reduction ($250K+ in savings), and project completion within manufacturing environments. Adept at leading cross-functional teams, managing uncertainty, and implementing lean methodologies to optimize processes and exceed business objectives.
              </p>
              <div className="about-stats">
                {ACHIEVEMENTS.map((stat) => <StatCard stat={stat} key={stat.label} />)}
              </div>
            </div>
          </div>
          <ImpactPanel />
        </RevealBand>

        {/* Journey / timeline */}
        <RevealBand id="journey" className="about-band--tint">
          <div className="about-media-row is-flipped">
            <div className="about-media-copy">
              <SectionHead eyebrow="My journey" title="High school to now" lead="The path that got me here, one milestone at a time." />
              <ol className="about-timeline" ref={timelineRef}>
                {TIMELINE.map((item) => <TimelineItem item={item} key={item.title} />)}
              </ol>
            </div>
            <MediaBlock src={artJourney} sticky />
          </div>
        </RevealBand>

        {/* Experience */}
        <RevealBand id="experience" className="about-band--surface">
          <MediaBanner src={artFactory} />
          <SectionHead eyebrow="Experience" title="Where I've made a difference" />
          <div className="about-jobs">
            {JOBS.map((job, index) => (
              <article className="about-job" key={`${job.company}-${job.title}`} style={{ '--i': index }}>
                <header className="about-job-head">
                  <div className="about-job-identity">
                    <h3 className="about-job-title">{job.title}</h3>
                    <p className="about-job-company">{job.company} · {job.location}</p>
                  </div>
                  <span className="about-job-period">{job.period}</span>
                </header>
                {job.bullets.length > 0 && (
                  <ul className="about-job-bullets">
                    {job.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}
                  </ul>
                )}
              </article>
            ))}
          </div>
          <div className="about-other">
            <h3 className="about-other-heading">Also</h3>
            <div className="about-other-grid">
              {OTHER_EXPERIENCE.map((item) => (
                <div className="about-other-card" key={item.title}>
                  <h3 className="about-other-title">{item.title}</h3>
                  <p className="about-other-detail">{item.detail}</p>
                </div>
              ))}
            </div>
          </div>
        </RevealBand>

        {/* Education & certifications */}
        <RevealBand id="education" className="about-band--tint">
          <SectionHead eyebrow="Education & certifications" title="Always learning" />
          <div className="about-edu-grid">
            {EDUCATION.map((item, index) => (
              <div className="about-edu-card" key={item.title} style={{ '--i': index }}>
                <h3 className="about-edu-title">{item.title}</h3>
                {item.org && <p className="about-edu-org">{item.org}</p>}
                <p className="about-edu-detail">{item.detail}</p>
              </div>
            ))}
            {CERTIFICATIONS.map((item, index) => (
              <div className="about-edu-card" key={item.title} style={{ '--i': EDUCATION.length + index }}>
                <h3 className="about-edu-title">{item.title}</h3>
                <p className="about-edu-detail">{item.detail}</p>
              </div>
            ))}
          </div>
        </RevealBand>

        {/* Skills */}
        <RevealBand id="skills" className="about-band--surface">
          <SectionHead eyebrow="Skills" title="What I work with" />
          <div className="about-skill-groups">
            {SKILLS.map((group, groupIndex) => (
              <div className="about-skill-group" key={group.title}>
                <h3 className="about-skill-title">{group.title}</h3>
                <div className="about-skill-tags">
                  {group.items.map((skill, index) => (
                    <span
                      className="about-skill-tag"
                      key={skill}
                      style={{ '--i': index + groupIndex * 3 }}
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </RevealBand>

        {/* Contact */}
        <RevealBand id="contact" className="about-band--cta">
          <MediaBanner src={artAscent} />
          <SectionHead eyebrow="Get in touch" title="Let's build something." lead="Questions, opportunities, or ideas. I would love to hear from you." />
          <div className="about-cta-actions">
            <a className="about-btn about-btn-inv" href={`mailto:${EMAIL}`}>Email me <span aria-hidden="true">→</span></a>
            <a className="about-btn about-btn-ghost" href={LINKEDIN} target="_blank" rel="noopener noreferrer">Connect on LinkedIn</a>
          </div>
        </RevealBand>

        <Footer />
      </div>
    </>
  );
}

export default About;