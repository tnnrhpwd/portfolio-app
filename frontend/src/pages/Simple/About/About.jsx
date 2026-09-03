import React from 'react';
import Header from '../../../components/Header/Header';
import Footer from '../../../components/Footer/Footer';
import SEO, { SITE_URL } from '../../../components/SEO/SEO.jsx';
import useScrollReveal from '../../../hooks/useScrollReveal';
import headshot from '../../../assets/1788391647406.jpg';
import artSummary from '../../../assets/art/about-summary-art.png';
import artJourney from '../../../assets/art/about-journey-art.png';
import artFactory from '../../../assets/art/about-factory-art.png';
import artAscent from '../../../assets/art/about-ascent-art.png';
import './resume.css';

const EMAIL = 'Steven.T.Hopwood@gmail.com';
const LINKEDIN = 'https://www.linkedin.com/in/sthopwood/';
const GITHUB = 'https://github.com/tnnrhpwd';

const ACHIEVEMENTS = [
  { value: '$239K+', label: 'Direct cost savings' },
  { value: '$45K', label: 'Annual materials savings' },
  { value: '3.44', label: 'College GPA' },
  { value: '5+', label: 'Years in manufacturing' },
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
  { period: '2019 – 2021', title: 'University of Tennessee at Chattanooga', detail: 'BS in Engineering Technology Management — Dean\'s List, 3.44 GPA.' },
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
      <h2 className="about-heading">{title}</h2>
      {lead && <p className="about-lead">{lead}</p>}
    </div>
  );
}

function About() {
  return (
    <>
      <SEO
        title="About"
        description="Steven Tanner Hopwood — Advanced Manufacturing Engineer and full-stack developer. Resume, experience, skills, and the journey from high school to now."
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
      <div className="about">
        <Header />
        <div className="about-floating" aria-hidden="true">
          <div className="about-circle about-circle-1" />
          <div className="about-circle about-circle-2" />
          <div className="about-circle about-circle-3" />
        </div>

        {/* Hero */}
        <section className="about-hero">
          <div className="about-wrap about-hero-grid">
            <div className="about-hero-copy">
              <p className="about-eyebrow">About me</p>
              <h1 className="about-title">Steven Tanner Hopwood</h1>
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
        </section>

        {/* Professional summary */}
        <RevealBand id="summary" className="about-band--surface">
          <div className="about-media-row">
            <div className="about-media-block">
              <img className="about-media-img" src={artSummary} alt="" loading="lazy" aria-hidden="true" />
            </div>
            <div className="about-media-copy">
              <SectionHead eyebrow="Professional summary" title="Driving change, one process at a time." />
              <p className="about-summary-text">
                Highly accomplished engineer with a proven track record of driving organizational change, cost reduction ($250K+ in savings), and project completion within manufacturing environments. Adept at leading cross-functional teams, managing uncertainty, and implementing lean methodologies to optimize processes and exceed business objectives.
              </p>
              <div className="about-stats">
                {ACHIEVEMENTS.map((a) => (
                  <div className="about-stat" key={a.label}>
                    <span className="about-stat-value">{a.value}</span>
                    <span className="about-stat-label">{a.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </RevealBand>

        {/* Journey / timeline */}
        <RevealBand id="journey" className="about-band--tint">
          <div className="about-media-row is-flipped">
            <div className="about-media-copy">
              <SectionHead eyebrow="My journey" title="High school to now" lead="The path that got me here — one milestone at a time." />
              <ol className="about-timeline">
                {TIMELINE.map((item) => (
                  <li className="about-timeline-item" key={item.title}>
                    <span className="about-timeline-marker" aria-hidden="true" />
                    <div className="about-timeline-card">
                      <span className="about-timeline-period">{item.period}</span>
                      <h3 className="about-timeline-title">{item.title}</h3>
                      <p className="about-timeline-detail">{item.detail}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
            <div className="about-media-block about-media-block--sticky">
              <img className="about-media-img" src={artJourney} alt="" loading="lazy" aria-hidden="true" />
            </div>
          </div>
        </RevealBand>

        {/* Experience */}
        <RevealBand id="experience" className="about-band--surface">
          <div className="about-media-banner">
            <img className="about-media-banner-img" src={artFactory} alt="" loading="lazy" aria-hidden="true" />
          </div>
          <SectionHead eyebrow="Experience" title="Where I've made a difference" />
          <div className="about-jobs">
            {JOBS.map((job) => (
              <article className="about-job" key={`${job.company}-${job.title}`}>
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
            {EDUCATION.map((item) => (
              <div className="about-edu-card" key={item.title}>
                <h3 className="about-edu-title">{item.title}</h3>
                {item.org && <p className="about-edu-org">{item.org}</p>}
                <p className="about-edu-detail">{item.detail}</p>
              </div>
            ))}
            {CERTIFICATIONS.map((item) => (
              <div className="about-edu-card" key={item.title}>
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
            {SKILLS.map((group) => (
              <div className="about-skill-group" key={group.title}>
                <h3 className="about-skill-title">{group.title}</h3>
                <div className="about-skill-tags">
                  {group.items.map((skill) => <span className="about-skill-tag" key={skill}>{skill}</span>)}
                </div>
              </div>
            ))}
          </div>
        </RevealBand>

        {/* Contact */}
        <RevealBand id="contact" className="about-band--cta">
          <div className="about-media-banner">
            <img className="about-media-banner-img" src={artAscent} alt="" loading="lazy" aria-hidden="true" />
          </div>
          <SectionHead eyebrow="Get in touch" title="Let's build something." lead="Questions, opportunities, or ideas — I'd love to hear from you." />
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