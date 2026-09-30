/**
 * WGU Roadmap — static content model.
 * The owner's 4 enrolled courses, week by week (narrowed 2026-09-30; the earlier
 * 13-course plan is archived in data/archive/wgu-plan-2026-09.json). Read-only plan;
 * the only mutable state is a per-course "done" checkbox (see roadmapStore).
 * Each course is listed once, in the week it is due; the week before names it as
 * underway in its theme and admin line, so a course never has two checkboxes.
 * Both the week-card checkbox and the Progress checklist bind to the same course
 * code, so ticking a course anywhere reflects everywhere.
 */
export type Chip = 'oa' | 'cert' | 'pa' | 'cap';

export interface CourseLink {
  href: string;
  label: string;
}
export interface Course {
  code: string;
  name: string;
  chip: Chip;
  chipLabel: string;
  doText: string;
  doneText: string;
  links: CourseLink[];
}
export interface Week {
  n: string;
  dates: string;
  /** First day of the week, YYYY-MM-DD local date. Logic reads this, never `dates`. */
  start: string;
  /** Last day of the week, inclusive, YYYY-MM-DD local date. */
  end: string;
  theme: string;
  courses: Course[];
  admin?: string;
}

export const CHIP_LABEL: Record<Chip, string> = {
  oa: 'OA exam',
  cert: 'External cert exam',
  pa: 'Project (PA)',
  cap: 'Capstone',
};

export const HEADER = {
  eyebrow: 'WGU BS Software Engineering · term plan',
  title: '4 courses in a 4-week plan',
  stats: [
    ['Start', 'Sep 28, 2026'],
    ['Target', '~Oct 25, 2026'],
    ['Now', 'C955 + D326'],
    ['Resources', 'Coursera Plus (all free)'],
  ] as ReadonlyArray<readonly [string, string]>,
};

export const DAY1 = [
  'Take the C955 pre-assessment, then book the proctored OA for Week 2.',
  'Confirm the D326 rubric on the course page and get a local Postgres with the lab dataset running.',
  'In Week 3, take the D315 pre-assessment and open the D279 rubric so both start on day one.',
];

export const WEEKS: readonly Week[] = [
  {
    n: 'Week 1', dates: 'Sep 28 to Oct 4', start: '2026-09-28', end: '2026-10-04', theme: 'In progress: statistics OA + the SQL project',
    admin: 'Underway: C955 (study for the OA) and D326 (build the PA). Both are due in Week 2, where their checkboxes are.',
    courses: [],
  },
  {
    n: 'Week 2', dates: 'Oct 5 to 11', start: '2026-10-05', end: '2026-10-11', theme: 'Finish: statistics OA passed, SQL project submitted',
    courses: [
      {
        code: 'C955', name: 'Applied Probability & Statistics', chip: 'oa', chipLabel: 'OA',
        doText: 'Intro to Statistics (Stanford), modules 1 to 8; practice z-scores, CIs, test stats by calculator; take the WGU pre-assessment.',
        doneText: 'OA passed.',
        links: [{ href: 'https://www.coursera.org/learn/stanford-statistics', label: 'coursera.org/learn/stanford-statistics' }],
      },
      {
        code: 'D326', name: 'Advanced Data Management', chip: 'pa', chipLabel: 'Project',
        doText: 'Intermediate PostgreSQL for stored procedures; build the transformation function, trigger, and ETL-refresh procedure against a local Postgres per the rubric; write the report; record the Panopto. (Triggers, pgAgent, and the ETL pattern you build yourself.)',
        doneText: 'PA submitted.',
        links: [{ href: 'https://www.coursera.org/specializations/postgresql-for-everybody', label: 'UMich: PostgreSQL for Everybody' }],
      },
    ],
  },
  {
    n: 'Week 3', dates: 'Oct 12 to 18', start: '2026-10-12', end: '2026-10-18', theme: 'Start: networking OA + the UI project',
    admin: 'Underway: D315 (study for the OA) and D279 (build the Figma project). Both are due in Week 4, where their checkboxes are.',
    courses: [],
  },
  {
    n: 'Week 4', dates: 'Oct 19 to 25', start: '2026-10-19', end: '2026-10-25', theme: 'Finish: networking OA passed, UI project submitted',
    courses: [
      {
        code: 'D315', name: 'Network & Security Foundations', chip: 'oa', chipLabel: 'OA',
        doText: 'Microsoft Networking & Cloud for networking + cloud; IBM Cybersecurity Architecture for CIA/AAA/firewalls/VPN; self-study crypto + PKI; drill subnetting and ports on the pre-assessment.',
        doneText: 'OA passed.',
        links: [
          { href: 'https://www.coursera.org/learn/introduction-to-networking-and-cloud-computing/', label: 'Microsoft: Networking & Cloud Computing' },
          { href: 'https://www.coursera.org/learn/cybersecurity-architecture', label: 'IBM: Cybersecurity Architecture' },
        ],
      },
      {
        code: 'D279', name: 'User Interface Design', chip: 'pa', chipLabel: 'Project',
        doText: 'Build the WGU Figma project to the rubric; annotate accessibility and design rationale. (Google UX courses 3 and 5.)',
        doneText: 'PA submitted.',
        links: [{ href: 'https://www.coursera.org/professional-certificates/google-ux-design', label: 'Google UX Design Certificate' }],
      },
    ],
  },
  {
    n: 'Week 5', dates: 'Oct 26 to Nov 1 (buffer)', start: '2026-10-26', end: '2026-11-01', theme: 'Buffer',
    admin: 'Buffer for an OA retake or a PA returned for revision. If nothing slipped, the term plan is done.',
    courses: [],
  },
];

export const WHY_ORDER = [
  ['C955 and D326 first,', ' because they are already underway; finishing them by Oct 11 clears half the plan.'],
  ['One exam and one project at a time,', ' so OA study (memory work) and PA building (build-and-document work) alternate instead of competing for the same hours.'],
  ['D315 and D279 next,', ' paired the same way: the networking OA with the Figma UI project.'],
  ['Week 5 is buffer,', ' for an OA retake or a PA sent back for revision. Protect the OA dates and let the projects flex.'],
] as ReadonlyArray<readonly [string, string]>;

/** Progress checklist labels (short names), keyed by the same course code. */
export const PROGRESS: ReadonlyArray<readonly [string, string]> = [
  ['C955', 'Probability & Statistics'],
  ['D326', 'Advanced Data Management'],
  ['D315', 'Network & Security'],
  ['D279', 'User Interface Design'],
];

export const CAVEATS: ReadonlyArray<readonly [string, string]> = [
  ['Coursera prepares, WGU passes.', ' C955 and D315 end in WGU proctored OAs; D326 and D279 are WGU projects you build and submit. Coursera gives the knowledge and skills, not the grade.'],
  ['Gaps to fill from WGU materials:', ' D315 cryptography/PKI and subnetting drills; D326 triggers, pgAgent, and the ETL pattern.'],
  ["Confirm each course's current assessment on your WGU course page", ' before starting it; WGU updates these.'],
  ['Six days a week, never on the Sabbath.', ' The dates assume six study days per week. If an OA or a PA revision slips, Week 5 absorbs it.'],
];

export const FOOTER =
  'Narrowed 2026-09-30 to the 4 enrolled courses; the 13-course plan is archived in data/archive/wgu-plan-2026-09.json. Coursera picks verified 2026-09-17 against WGU competencies.';

export const TOTAL_COURSES = PROGRESS.length;

/**
 * The plan's target finish ('~Oct 25, 2026' in HEADER), as a YYYY-MM-DD local date.
 * Days-left captions count to this, so edit it together with the HEADER text.
 */
export const TERM_END = '2026-10-25';
