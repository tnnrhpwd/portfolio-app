/**
 * THE PAGE MANIFEST — one entry per route, and the single source of truth for
 * the app's navigation.
 *
 * `App.js` builds its `<Routes>` from this list and `/all` renders it, so the
 * index of every page cannot drift from the routing table: **adding a page is
 * one entry here**, and it appears in the index, with its path and its badge,
 * the moment it is added. There is no second list to remember.
 *
 * Every field:
 *
 *   path      the route, exactly as `<Route path>` wants it (`:param` included)
 *   label     the words a visitor reads — short, title case
 *   group     which panel it lands in on `/all` (see `PAGE_GROUPS` for the order)
 *   access    who can use it — DESCRIPTIVE, for the badge and the grouping;
 *             see the ⚠️ note below
 *   element   the component. `lazy()` for everything except Home, which is on
 *             the critical path and stays eager (App.js's rule, kept here)
 *   aliases   extra paths that render the same page (`/home`, `/Coliseum`)
 *   children  a nested route — the admin console is the only one. `segment` is
 *             the child's path relative to the parent; `''` is the index
 *   dynamic   the path takes a parameter, so `/all` shows it as a template
 *             rather than a link (clicking `/u/:username` would 404)
 *   kind      `'redirect'` — the route forwards; `redirect` holds the target
 *   note      one line of nuance, shown on `/all` only where it earns its place
 *
 * ⚠️ `access` does NOT enforce anything — it documents what the page already
 * does for itself. Every page here gates its own content (a redirect to /login,
 * a `LoginGate`, an admin check) and the backend enforces the real boundary;
 * this field exists so the index can say who each page is for instead of
 * guessing. A wrong value here is a wrong badge, never a hole.
 */

import { lazy } from 'react';

// Eager: the landing page, always needed on first paint. Everything else is a
// lazy chunk (App.js's original split, moved here so the manifest is complete).
import Home from '../pages/Home/Home';

// ── Staff ──
const Admin = lazy(() => import('../pages/Admin/AdminLayout'));
const AdminDashboard = lazy(() => import('../pages/Admin/Dashboard'));
const AdminUsers = lazy(() => import('../pages/Admin/Users'));
const AdminBugs = lazy(() => import('../pages/Admin/Bugs'));
const AdminMap = lazy(() => import('../pages/Admin/VisitorMapPage'));
const AdminReviews = lazy(() => import('../pages/Admin/Reviews'));
const AdminData = lazy(() => import('../pages/Admin/DataExplorer'));
const AdminHomeTitle = lazy(() => import('../pages/Admin/HomeTitle'));
const AdminFunnelTester = lazy(() => import('../pages/Admin/FunnelTester'));
const AdminPageRankings = lazy(() => import('../pages/Admin/PageRankings'));
const AllPages = lazy(() => import('../pages/AllPages/AllPages'));
const DeepStorage = lazy(() => import('../pages/DeepStorage/DeepStorage'));
const Muse = lazy(() => import('../pages/Muse/Muse'));

// ── Site ──
const About = lazy(() => import('../pages/Simple/About/About.jsx'));
const Pricing = lazy(() => import('../pages/Pricing/Pricing.jsx'));
const Privacy = lazy(() => import('../pages/Privacy/Privacy.jsx'));
const Projects = lazy(() => import('../pages/Projects/Projects/Projects.jsx'));
const Support = lazy(() => import('../pages/Support/Support.jsx'));
const Terms = lazy(() => import('../pages/Terms/Terms.jsx'));

// ── Account ──
const ForgotPassword = lazy(() => import('../pages/ForgotPassword/ForgotPassword.jsx'));
const Login = lazy(() => import('../pages/Login/Login.jsx'));
const Profile = lazy(() => import('../pages/Profile/Profile.jsx'));
const Register = lazy(() => import('../pages/Register/Register.jsx'));
const ResetPassword = lazy(() => import('../pages/ResetPassword/ResetPassword.jsx'));
const Settings = lazy(() => import('../pages/Settings/Settings.jsx'));
const UserProfile = lazy(() => import('../pages/UserProfile/UserProfile.jsx'));

// ── Simple ──
const Market = lazy(() => import('../pages/Simple/Market/Market.jsx'));
const Net = lazy(() => import('../pages/Simple/Net/Net.jsx'));
const Pay = lazy(() => import('../pages/Simple/Pay/Pay.jsx'));
const Plans = lazy(() => import('../pages/Simple/Plans/Plans.jsx'));
const GoalDetail = lazy(() => import('../pages/Simple/Plans/GoalDetail.jsx'));
const Simple = lazy(() => import('../pages/Simple/Simple/SimplePage.jsx'));
const Talk = lazy(() => import('../pages/Simple/Talk/Talk.jsx'));

// ── Projects, tools and games ──
const Annuities = lazy(() => import('../pages/Projects/Annuities/Annuities'));
const Chess = lazy(() => import('../pages/Chess/Chess'));
const Coliseum = lazy(() => import('../pages/Projects/Coliseum/Coliseum'));
const Ethanol = lazy(() => import('../pages/Projects/Ethanol/Ethanol'));
const Fit = lazy(() => import('../pages/Fit/Fit'));
const Fluid = lazy(() => import('../pages/Projects/Fluid/Fluid'));
const Game2048 = lazy(() => import('../pages/Projects/Game2048/Game2048'));
const Halfway = lazy(() => import('../pages/Projects/Halfway/Halfway'));
const Hype = lazy(() => import('../pages/Hype/Hype'));
const IQTest = lazy(() => import('../pages/Projects/IQTest/IQTest'));
const MicTest = lazy(() => import('../pages/MicTest/MicTest'));
const Music = lazy(() => import('../pages/Music/Music'));
const PassGen = lazy(() => import('../pages/Projects/PassGen/PassGen'));
const Pets = lazy(() => import('../pages/Pets/Pets'));
const Polls = lazy(() => import('../pages/Simple/Polls/Polls.jsx'));
const Rocket = lazy(() => import('../pages/Projects/Rocket/Rocket'));
const Sit = lazy(() => import('../pages/Sit/Sit.jsx'));
const SleepAssist = lazy(() => import('../pages/Projects/SleepAssist/SleepAssist'));
const Sonic = lazy(() => import('../pages/Projects/Sonic/Sonic'));
const Strip = lazy(() => import('../pages/Strip/Strip.jsx'));
const TypeTest = lazy(() => import('../pages/TypeTest/TypeTest'));
const UIMapper = lazy(() => import('../pages/UIMapper/UIMapper'));
const Wordle = lazy(() => import('../pages/Projects/Wordle/Wordle'));
const WordleSolver = lazy(() => import('../pages/Projects/WordleSolver/WordleSolver'));

// ── Quizzes ──
const Quizzes = lazy(() => import('../pages/Projects/Quizzes/Quizzes'));
const QuizAdhd = lazy(() => import('../pages/Projects/Quizzes/pages/AdhdScreening'));
const QuizAttachment = lazy(() => import('../pages/Projects/Quizzes/pages/AttachmentStyle'));
const QuizAutism = lazy(() => import('../pages/Projects/Quizzes/pages/AutismScreening'));
const QuizBigFive = lazy(() => import('../pages/Projects/Quizzes/pages/BigFive'));
const QuizEnneagram = lazy(() => import('../pages/Projects/Quizzes/pages/Enneagram'));
const QuizLoveLanguages = lazy(() => import('../pages/Projects/Quizzes/pages/LoveLanguages'));
const QuizMBTI = lazy(() => import('../pages/Projects/Quizzes/pages/MBTI'));
const QuizThirtySix = lazy(() => import('../pages/Projects/Quizzes/pages/ThirtySixQuestions'));
const QuizValuesAlignment = lazy(() => import('../pages/Projects/Quizzes/pages/ValuesAlignment'));

const NotFound = lazy(() => import('../pages/NotFound/NotFound.jsx'));

/** The badge words, in one place so `/all` and any future consumer agree. */
export const ACCESS_LABELS = Object.freeze({
  public: 'Public',
  member: 'Member',
  staff: 'Staff',
  muse: 'Muse',
});

/** Panel order on `/all`: what a visitor touches first, staff last. */
export const PAGE_GROUPS = Object.freeze([
  'Home & site',
  'Projects & tools',
  'Quizzes',
  'Simple',
  'Account',
  'Staff',
  'Legal',
]);

export const PAGES = [
  // ── Home & site ────────────────────────────────────────────────────────────
  {
    path: '/',
    label: 'Home',
    group: 'Home & site',
    access: 'public',
    element: Home,
    aliases: ['/home'],
  },
  { path: '/about', label: 'About', group: 'Home & site', access: 'public', element: About },
  { path: '/projects', label: 'Projects', group: 'Home & site', access: 'public', element: Projects },
  { path: '/pricing', label: 'Pricing', group: 'Home & site', access: 'public', element: Pricing },
  { path: '/support', label: 'Support', group: 'Home & site', access: 'public', element: Support },
  {
    path: '/contact',
    label: 'Contact',
    group: 'Home & site',
    access: 'public',
    redirect: '/support?tab=contact',
    note: 'Forwards to Support, contact tab',
  },

  // ── Projects, tools and games ──────────────────────────────────────────────
  { path: '/annuities', label: 'Annuities', group: 'Projects & tools', access: 'public', element: Annuities },
  { path: '/chess', label: 'Chess', group: 'Projects & tools', access: 'public', element: Chess },
  { path: '/coliseum', label: 'Coliseum', group: 'Projects & tools', access: 'public', element: Coliseum, aliases: ['/Coliseum'] },
  { path: '/ethanol', label: 'Ethanol', group: 'Projects & tools', access: 'public', element: Ethanol },
  { path: '/fit', label: 'Fit', group: 'Projects & tools', access: 'public', element: Fit },
  { path: '/fluid', label: 'Fluid', group: 'Projects & tools', access: 'public', element: Fluid },
  { path: '/2048', label: '2048', group: 'Projects & tools', access: 'public', element: Game2048 },
  { path: '/halfway', label: 'Halfway', group: 'Projects & tools', access: 'public', element: Halfway },
  { path: '/hype', label: 'Hype', group: 'Projects & tools', access: 'public', element: Hype },
  { path: '/iq', label: 'IQ test', group: 'Projects & tools', access: 'public', element: IQTest },
  { path: '/mic-test', label: 'Mic test', group: 'Projects & tools', access: 'public', element: MicTest },
  { path: '/music', label: 'Music', group: 'Projects & tools', access: 'public', element: Music },
  { path: '/passgen', label: 'PassGen', group: 'Projects & tools', access: 'public', element: PassGen },
  { path: '/pets', label: 'Pets', group: 'Projects & tools', access: 'public', element: Pets },
  { path: '/polls', label: 'Polls', group: 'Projects & tools', access: 'public', element: Polls },
  { path: '/rocket', label: 'Rocket', group: 'Projects & tools', access: 'public', element: Rocket, aliases: ['/Rocket'] },
  { path: '/sit', label: 'Sit', group: 'Projects & tools', access: 'public', element: Sit },
  { path: '/sleepassist', label: 'Sleep Assist', group: 'Projects & tools', access: 'public', element: SleepAssist },
  { path: '/sonic', label: 'Sonic', group: 'Projects & tools', access: 'public', element: Sonic },
  { path: '/strip', label: 'Strip', group: 'Projects & tools', access: 'public', element: Strip },
  { path: '/type', label: 'Type test', group: 'Projects & tools', access: 'public', element: TypeTest },
  { path: '/uimapper', label: 'UI Mapper', group: 'Projects & tools', access: 'public', element: UIMapper },
  { path: '/wordle', label: 'Wordle', group: 'Projects & tools', access: 'public', element: Wordle },
  { path: '/wordlesolver', label: 'Wordle Solver', group: 'Projects & tools', access: 'public', element: WordleSolver },

  // ── Quizzes ────────────────────────────────────────────────────────────────
  { path: '/quizzes', label: 'Quizzes hub', group: 'Quizzes', access: 'public', element: Quizzes },
  { path: '/mbti', label: 'MBTI', group: 'Quizzes', access: 'public', element: QuizMBTI },
  { path: '/big-five', label: 'Big Five', group: 'Quizzes', access: 'public', element: QuizBigFive },
  { path: '/enneagram', label: 'Enneagram', group: 'Quizzes', access: 'public', element: QuizEnneagram },
  { path: '/autism-screening', label: 'Autism screening', group: 'Quizzes', access: 'public', element: QuizAutism },
  { path: '/adhd-screening', label: 'ADHD screening', group: 'Quizzes', access: 'public', element: QuizAdhd },
  { path: '/attachment-style', label: 'Attachment style', group: 'Quizzes', access: 'public', element: QuizAttachment },
  { path: '/love-languages', label: 'Love languages', group: 'Quizzes', access: 'public', element: QuizLoveLanguages },
  { path: '/values-alignment', label: 'Values alignment', group: 'Quizzes', access: 'public', element: QuizValuesAlignment },
  { path: '/36-questions', label: '36 Questions', group: 'Quizzes', access: 'public', element: QuizThirtySix },

  // ── Simple — the agent product's rooms, all behind a sign-in ───────────────
  { path: '/simple', label: 'Control', group: 'Simple', access: 'member', element: Simple },
  { path: '/net', label: 'Chat', group: 'Simple', access: 'member', element: Net },
  { path: '/talk', label: 'Talk', group: 'Simple', access: 'member', element: Talk },
  { path: '/plans', label: 'Goals', group: 'Simple', access: 'member', element: Plans },
  {
    path: '/plans/goal/:id',
    label: 'Goal detail',
    group: 'Simple',
    access: 'member',
    element: GoalDetail,
    dynamic: true,
  },
  { path: '/market', label: 'Market', group: 'Simple', access: 'member', element: Market },
  { path: '/pay', label: 'Checkout', group: 'Simple', access: 'member', element: Pay },

  // ── Account ────────────────────────────────────────────────────────────────
  { path: '/login', label: 'Log in', group: 'Account', access: 'public', element: Login },
  { path: '/register', label: 'Create account', group: 'Account', access: 'public', element: Register },
  { path: '/forgot-password', label: 'Forgot password', group: 'Account', access: 'public', element: ForgotPassword },
  { path: '/reset-password', label: 'Reset password', group: 'Account', access: 'public', element: ResetPassword },
  {
    path: '/u/:username',
    label: 'Member page',
    group: 'Account',
    access: 'public',
    element: UserProfile,
    dynamic: true,
    note: 'One per member, at /u/&lt;username&gt;',
  },
  { path: '/profile', label: 'Profile', group: 'Account', access: 'member', element: Profile },
  { path: '/settings', label: 'Settings', group: 'Account', access: 'member', element: Settings },

  // ── Staff ──────────────────────────────────────────────────────────────────
  {
    path: '/admin',
    label: 'Admin',
    group: 'Staff',
    access: 'staff',
    element: Admin,
    note: 'A Special account gets the four read-only views only',
    children: [
      { segment: '', label: 'Dashboard', element: AdminDashboard },
      { segment: 'users', label: 'Users', element: AdminUsers },
      { segment: 'bugs', label: 'Bug reports', element: AdminBugs },
      { segment: 'map', label: 'Visitor map', element: AdminMap },
      { segment: 'reviews', label: 'Reviews', element: AdminReviews },
      { segment: 'data', label: 'Data explorer', element: AdminData },
      { segment: 'home-title', label: 'Home title', element: AdminHomeTitle },
      { segment: 'funnel-tester', label: 'Funnel tester', element: AdminFunnelTester },
      { segment: 'rankings', label: 'Page rankings', element: AdminPageRankings },
    ],
  },
  {
    path: '/all',
    label: 'All pages',
    group: 'Staff',
    access: 'staff',
    element: AllPages,
    note: 'This page — an index of everything above',
  },
  {
    path: '/deepstorage',
    label: 'Deep Storage',
    group: 'Staff',
    access: 'staff',
    element: DeepStorage,
    note: 'Admin account only',
  },
  {
    path: '/muse',
    label: 'Muse',
    group: 'Staff',
    access: 'muse',
    element: Muse,
    note: 'Admin, or the nickname the constants gate for',
  },

  // ── Legal ──────────────────────────────────────────────────────────────────
  { path: '/privacy', label: 'Privacy Policy', group: 'Legal', access: 'public', element: Privacy },
  { path: '/terms', label: 'Terms of Service', group: 'Legal', access: 'public', element: Terms },
];

/** The catch-all, kept beside the manifest so the wildcard is not forgotten. */
export const NOT_FOUND = { path: '*', element: NotFound };

/**
 * Every addressable PAGE, flattened out of the nested entries — the admin
 * console's children become nine rows instead of a parent row that duplicates
 * its own index route. `/all` renders this; App.js does not, because it needs
 * the nesting to build its `<Route>` tree.
 */
export function flattenPages(pages = PAGES) {
  return pages.flatMap((page) =>
    page.children?.length
      ? page.children.map((child) => ({
        ...child,
        path: child.segment ? `${page.path}/${child.segment}` : page.path,
        group: page.group,
        access: page.access,
        note: child.note || page.note,
      }))
      : [page],
  );
}
