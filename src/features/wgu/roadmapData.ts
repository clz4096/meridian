/**
 * WGU Roadmap — static content model.
 * Transcribed from ~/Brainstorm/meridian-tabs/wgu-roadmap.html. Read-only plan;
 * the only mutable state is a per-course "done" checkbox (see roadmapStore).
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
  eyebrow: 'WGU BS Software Engineering · finish plan',
  title: '13 courses, 37 days.',
  stats: [
    ['Start', 'Sep 17, 2026'],
    ['Target', '~Oct 24, 2026'],
    ['Load', '~4 to 5 hrs/day, 6 days/wk'],
    ['Resources', 'Coursera Plus (all free)'],
  ] as ReadonlyArray<readonly [string, string]>,
};

export const DAY1 = [
  'Start the D282 WGU pre-assessment so the AWS exam voucher is unlocked before Week 3.',
  'Post a D479 peer-reviewer request on WGU Connect so reviewers are ready by Week 6.',
  'Reserve tentative proctored-exam slots: AWS CLF-C02 for end of Week 3, ITIL 4 for mid Week 4.',
];

export const WEEKS: readonly Week[] = [
  {
    n: 'Week 1', dates: 'Sep 17 to 23', theme: 'Two fast knowledge exams',
    courses: [
      {
        code: 'C955', name: 'Applied Probability & Statistics', chip: 'oa', chipLabel: 'OA',
        doText: 'Intro to Statistics (Stanford), modules 1 to 8; practice z-scores, CIs, test stats by calculator; take the WGU pre-assessment.',
        doneText: 'OA passed.',
        links: [{ href: 'https://www.coursera.org/learn/stanford-statistics', label: 'coursera.org/learn/stanford-statistics' }],
      },
      {
        code: 'D386', name: 'Hardware & OS Essentials', chip: 'oa', chipLabel: 'OA',
        doText: 'Intro to Hardware and OS (IBM) + module quizzes; read WGU material for the solution-stack framing; take the pre-assessment.',
        doneText: 'OA passed.',
        links: [{ href: 'https://www.coursera.org/learn/introduction-to-hardware-and-operating-systems', label: 'coursera.org/learn/introduction-to-hardware-and-operating-systems' }],
      },
    ],
  },
  {
    n: 'Week 2', dates: 'Sep 24 to 30', theme: 'Two more knowledge exams',
    admin: 'Admin: schedule the AWS CLF-C02 exam for end of Week 3.',
    courses: [
      {
        code: 'D324', name: 'Business of IT: Project Management', chip: 'oa', chipLabel: 'OA',
        doText: 'CompTIA Project+ (Infosec, free); drill earned-value math and critical path with the Packt PK0-005 spec; take the pre-assessment.',
        doneText: 'OA passed.',
        links: [
          { href: 'https://www.coursera.org/learn/comptia-project', label: 'coursera.org/learn/comptia-project' },
          { href: 'https://www.coursera.org/specializations/packt-comptia-project-pk0005', label: 'Packt PK0-005' },
        ],
      },
      {
        code: 'C963', name: 'American Politics & the US Constitution', chip: 'oa', chipLabel: 'OA',
        doText: 'UPenn constitution course for structure/rights/cases; Jindal module 2 for parties/elections; flashcard the landmark cases.',
        doneText: 'OA passed.',
        links: [
          { href: 'https://www.coursera.org/learn/constitution', label: 'UPenn: Key Constitutional Concepts' },
          { href: 'https://www.coursera.org/learn/american-politics-society-and-history-mooc', label: 'Jindal: American Politics' },
        ],
      },
    ],
  },
  {
    n: 'Week 3', dates: 'Oct 1 to 7', theme: 'Big networking OA + the AWS cert',
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
        code: 'D282', name: 'Cloud Foundations', chip: 'cert', chipLabel: 'AWS CLF-C02',
        doText: 'AWS Cloud Practitioner Essentials; drill the KodeKloud timed mock to 85%+; sit the proctored CLF-C02 with your voucher.',
        doneText: 'AWS CLF-C02 passed.',
        links: [
          { href: 'https://www.coursera.org/learn/aws-cloud-practitioner-essentials/', label: 'AWS: Cloud Practitioner Essentials' },
          { href: 'https://www.coursera.org/learn/aws-cloud-practitioner-clf-c02', label: 'KodeKloud CLF-C02 (mock)' },
        ],
      },
    ],
  },
  {
    n: 'Week 4', dates: 'Oct 8 to 14', theme: 'ITIL cert + the SQL project',
    courses: [
      {
        code: 'D336', name: 'Business of IT: Applications', chip: 'cert', chipLabel: 'ITIL 4',
        doText: "ITIL 4 Foundation Specialization (all 3 courses); drill WGU's PeopleCert practice exam; sit the ITIL 4 exam.",
        doneText: 'ITIL 4 Foundation passed.',
        links: [{ href: 'https://www.coursera.org/specializations/itil-foundation', label: 'Logical Operations: ITIL 4 Foundation Specialization' }],
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
    n: 'Week 5', dates: 'Oct 15 to 21', theme: 'Software projects (execution, not learning)',
    courses: [
      {
        code: 'D284', name: 'Software Engineering', chip: 'pa', chipLabel: 'Project',
        doText: 'Write the BPN1 design document to the rubric: methodology choice, four requirement types, two UML diagrams, architecture, tests. Backfill UML from Alberta OOD if needed.',
        doneText: 'PA submitted.',
        links: [
          { href: 'https://www.coursera.org/learn/introduction-to-software-engineering', label: 'IBM: Intro to Software Engineering' },
          { href: 'https://www.coursera.org/learn/object-oriented-design', label: 'Alberta: Object-Oriented Design' },
        ],
      },
      {
        code: 'D480', name: 'Software Design & Quality Assurance', chip: 'pa', chipLabel: 'Project',
        doText: 'Write the design plan and QA test plan to the scenario; include a requirements-to-test traceability matrix.',
        doneText: 'PA submitted.',
        links: [
          { href: 'https://www.coursera.org/specializations/software-design-architecture', label: 'Alberta: Software Design & Architecture' },
          { href: 'https://www.coursera.org/learn/introduction-software-testing', label: 'Minnesota: Intro to Software Testing' },
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
    n: 'Week 6', dates: 'Oct 22 to 28 (buffer)', theme: 'UX project + the capstone',
    courses: [
      {
        code: 'D479', name: 'User Experience Design', chip: 'pa', chipLabel: 'Project',
        doText: 'Build the WGU project; run guerrilla + peer usability tests; record the three Panopto peer critiques you lined up on Day 1. (Google UX courses 3, 4, 5.)',
        doneText: 'PA submitted.',
        links: [{ href: 'https://www.coursera.org/professional-certificates/google-ux-design', label: 'Google UX Design Certificate' }],
      },
      {
        code: 'D424', name: 'Software Engineering Capstone', chip: 'cap', chipLabel: 'Capstone',
        doText: 'Scope a small full-stack CRUD app. Follow the four tasks: topic approval, proposal, build + unit tests + Panopto, then Docker + cloud deploy + GitLab + Panopto. IBM Full Stack only if you need skill backfill.',
        doneText: 'Capstone submitted. Degree complete.',
        links: [{ href: 'https://www.coursera.org/professional-certificates/ibm-full-stack-cloud-developer', label: 'IBM Full Stack (skills only)' }],
      },
    ],
  },
];

export const WHY_ORDER = [
  ['Exams first,', ' because the two cert exams need proctored slots booked and the D282 voucher unlocked.'],
  ['D479 peer request on Day 1,', ' so reviewers are ready when you reach Week 6.'],
  ['Software projects and the capstone last,', ' because for an experienced engineer they are build-and-document work, not study. If they run fast, you finish early.'],
  ['The only real pacing risks', ' are the two external exam sittings and the D479 peer exchange. Everything else is under your control, so protect those dates and let the rest absorb any slippage.'],
] as ReadonlyArray<readonly [string, string]>;

/** Progress checklist labels (short names), keyed by the same course code. */
export const PROGRESS: ReadonlyArray<readonly [string, string]> = [
  ['C955', 'Probability & Statistics'],
  ['D386', 'Hardware & OS'],
  ['D324', 'Project Management'],
  ['C963', 'American Politics'],
  ['D315', 'Network & Security'],
  ['D282', 'Cloud (AWS CLF-C02)'],
  ['D336', 'Applications (ITIL 4)'],
  ['D326', 'Advanced Data Management'],
  ['D284', 'Software Engineering'],
  ['D480', 'Software Design & QA'],
  ['D279', 'User Interface Design'],
  ['D479', 'User Experience Design'],
  ['D424', 'Capstone'],
];

export const CAVEATS: ReadonlyArray<readonly [string, string]> = [
  ['Coursera prepares, WGU passes.', ' D282 and D336 end in external proctored exams (AWS, PeopleCert); every project course and the capstone is a WGU deliverable you build and submit. Coursera gives the knowledge and skills, not the grade.'],
  ['Gaps to fill from WGU materials:', ' D315 cryptography/PKI and subnetting drills; D326 triggers, pgAgent, and the ETL pattern; D480 the requirements-to-test traceability matrix; C963 landmark-case memorization.'],
  ["Confirm each course's current assessment and cert alignment on your WGU course page", ' before starting it; WGU updates these.'],
  ['This is aggressive.', ' If exams or peer reviews slip, the plan slides toward 45 days. Hold the exam dates and the D479 peer exchange and the rest flexes around them.'],
];

export const FOOTER =
  'Coursera-only, verified 2026-09-17. Source: wgu-remaining-courses-coursera-only-2026-09-17.md · picks confirmed against WGU competencies via live page checks.';

export const TOTAL_COURSES = PROGRESS.length;
