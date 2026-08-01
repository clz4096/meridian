/**
 * Knowledge tab view — the last legacy renderer, ported.
 *
 * Pure renderer over a view model, plus a controller using the same
 * delegation + focus-preserving repaint contract as Workout, Meal and Data.
 */
import type { Mastery } from './types.js';
import { esc } from './html.js';
import { BaseViewController, type ViewHost } from './viewHost.js';

export interface KnowledgeItem {
  id: string;
  prompt: string;
  reveal: string;
  mins: number;
  flow: 'flip' | 'full';
  src: { book: string; ref: string; page?: number; title?: string; url?: string };
  tags?: string[];
}
export interface KnowledgeTopic { id: string; name: string; books: string[] }
export interface GymLink { label: string; url: string; key: string; done: boolean }

export interface KnowledgeViewModel {
  topicId: string;
  topics: Array<KnowledgeTopic & { total: number; mastered: number; percent: number }>;
  items: KnowledgeItem[];
  mastery: Record<string, Mastery | 0>;
  dueCount: number;
  timeFilter: string;
  target: string;
  targets: ReadonlyArray<readonly [string, string]>;
  targetCount: number;
  gymMode: boolean;
  gym: { concepts: GymLink[]; practice: GymLink[]; reading: GymLink[] } | null;
  sources: Array<{ title: string; url: string }>;
  revealed: Record<string, boolean>;
  /** Pre-rendered progress-charts block, appended below the question list. */
  charts?: string;
}

export interface KnowledgeActions {
  selectTopic(id: string): void;
  setTimeFilter(value: string): void;
  setTarget(value: string): void;
  studyAllTagged(): void;
  startReview(): void;
  toggleGym(): void;
  toggleGymDone(key: string): void;
  reveal(id: string): void;
  rate(id: string, score: Mastery): void;
  queueForReview(id: string): void;
  gradeWithAI(id: string): void;
  /** Generate an AI answer to the question (Opus), shown in the note area. */
  answerWithAI(id: string): void;
  /** Progress-chart period control (optional — present once charts are wired). */
  setChartPeriod?(period: string): void;
}

export const MASTERY_COLOUR: Record<number, string> = {
  0: '#5C6678', 1: '#D8654F', 2: '#E0A64B', 3: '#E0A64B', 4: '#6BBF73', 5: '#4FB0A5',
};
export const MASTERY_TEXT: Record<number, string> = {
  0: 'new', 1: 'shaky', 2: 'learning', 3: 'learning', 4: 'solid', 5: 'mastered',
};

const TIME_LABEL: Record<string, string> = {
  all: 'All', '5': 'Quick · 5m', '15': 'Standard · 15m', '30': 'Deep · 30m',
};

/** Lead sentence bolded so a reveal is scannable rather than a wall of text. */
export function formatReveal(text: string): string {
  if (!text) return '';
  const m = /^(.*?[.!?])(\s+)([\s\S]*)$/.exec(text);
  if (!m) return `<b>${esc(text)}</b>`;
  return `<b style="color:var(--text)">${esc(m[1])}</b><div style="margin-top:7px">${esc(m[3])}</div>`;
}

function gymRow(l: GymLink): string {
  return (
    `<div class="goalrow"><span class="chk" data-act="gym-done" data-key="${esc(l.key)}" style="width:20px;height:20px">${l.done ? '✓' : ''}</span>` +
    `<span style="flex:1${l.done ? ';opacity:.5;text-decoration:line-through' : ''}">${esc(l.label)}</span>` +
    `<a href="${esc(l.url)}" target="_blank" rel="noopener" style="color:var(--teal)">open ↗</a></div>`
  );
}

function renderTabs(vm: KnowledgeViewModel): string {
  return (
    `<div class="ktabs">` +
    vm.topics
      .map(
        (t) =>
          `<button class="ktab${t.id === vm.topicId ? ' on' : ''}" data-act="topic" data-id="${esc(t.id)}">${esc(t.name)}` +
          (t.total ? `<span class="cnt">${t.mastered}/${t.total}</span>` : `<span class="cnt">soon</span>`) +
          (t.total ? `<span class="tprog"><i style="width:${t.percent}%"></i></span>` : '') +
          `</button>`,
      )
      .join('') +
    `</div>`
  );
}

/**
 * Source line: section ref + book title, linked to the book. When the book is a
 * direct PDF and the exact page is known, deep-link to it via the `#page=N`
 * viewer anchor; otherwise link to the book URL. No URL → plain text (unchanged).
 */
function qsrcHTML(src: KnowledgeItem['src']): string {
  const label = src.title ? `${src.ref} — ${src.title}` : src.ref;
  if (!src.url) return `<div class="qsrc">${esc(label)}</div>`;
  const href = /\.pdf$/i.test(src.url) && src.page ? `${src.url}#page=${src.page}` : src.url;
  return `<div class="qsrc"><a href="${esc(href)}" target="_blank" rel="noopener">${esc(label)} ↗</a></div>`;
}

function renderCard(it: KnowledgeItem, vm: KnowledgeViewModel): string {
  const m = vm.mastery[it.id] ?? 0;
  const full = it.flow !== 'flip';
  const open = vm.revealed[it.id] === true;
  let c =
    `<div class="qcard" id="qc-${esc(it.id)}"><div class="qtop">` +
    `<span class="qtime">${it.mins} min · ${full ? 'attempt' : 'flip'}</span>` +
    (m
      ? `<span class="masterbadge" style="background:${MASTERY_COLOUR[m]}22;color:${MASTERY_COLOUR[m]}">${MASTERY_TEXT[m]}</span>`
      : '') +
    `</div><div class="qprompt">${esc(it.prompt)}</div>` +
    qsrcHTML(it.src);
  if (full) {
    c += `<textarea class="ans dictxt" id="ans-${esc(it.id)}" style="min-height:80px;margin-top:8px" placeholder="Write your answer here, then reveal to compare — active recall beats just reading."></textarea>`;
  }
  c +=
    `<div class="qactions"><button class="mbtn" data-act="reveal" data-id="${esc(it.id)}">${full ? 'Reveal model answer' : 'Show answer'}</button>` +
    `<button class="mbtn" data-act="ai-answer" data-id="${esc(it.id)}">AI answer</button>` +
    (full ? `<button class="mbtn" data-act="ai-grade" data-id="${esc(it.id)}">AI grade my answer</button>` : '') +
    `</div><div id="ai-${esc(it.id)}" class="note" style="margin-top:6px"></div>` +
    `<div class="reveal${open ? ' on' : ''}" id="rv-${esc(it.id)}">${formatReveal(it.reveal)}` +
    `<div class="mrow" style="margin-top:8px"><button class="mbtn" data-act="queue" data-id="${esc(it.id)}">➕ Add to review queue</button></div>` +
    `<div class="rate" id="rate-${esc(it.id)}"><span style="color:var(--dim);font-size:11px;align-self:center">Rate recall:</span>` +
    [1, 2, 3, 4, 5]
      .map((n) => `<button data-act="rate" data-id="${esc(it.id)}" data-score="${n}">${n} ${MASTERY_TEXT[n]}</button>`)
      .join('') +
    `</div></div></div>`;
  return c;
}

export function renderKnowledgeHTML(vm: KnowledgeViewModel): string {
  let h = renderTabs(vm);

  if (vm.dueCount > 0 && vm.topicId !== '__review__' && !vm.gymMode) {
    h +=
      `<div class="panel" style="border-color:var(--protein)"><div class="mrow" style="justify-content:space-between">` +
      `<p class="panel-t" style="margin:0;color:var(--protein)">Due for review · ${vm.dueCount}</p>` +
      `<button class="mbtn" data-act="review">Start review</button></div>` +
      `<div class="note">Interleaved recall across all topics — the highest-value thing you can do today.</div></div>`;
  }

  if (vm.topicId !== '__review__' && vm.topicId !== '__target__') {
    h +=
      `<div class="mrow" style="margin-top:10px;gap:8px">` +
      `<button class="mbtn${vm.gymMode ? ' primary' : ''}" data-act="gym">🎧 ${vm.gymMode ? '← Back to questions' : 'Gym session'}</button>` +
      `<span class="note" style="align-self:center">${vm.gymMode ? 'Videos + readings for the gym' : 'Recall practice'}</span></div>`;
  }

  if (vm.gymMode && vm.gym) {
    h +=
      `<div class="panel"><p class="panel-t">Understand — what these ideas actually are</p>` +
      vm.gym.concepts.map(gymRow).join('') +
      `</div>`;
    if (vm.gym.practice.length) {
      h +=
        `<div class="panel"><p class="panel-t">Apply — worked problems &amp; implementation</p>` +
        vm.gym.practice.map(gymRow).join('') +
        `</div>`;
    }
    h +=
      `<div class="panel"><p class="panel-t">Read — sections for this topic</p>` +
      vm.gym.reading.map(gymRow).join('') +
      `</div>`;
    return h;
  }

  if (vm.sources.length) {
    h +=
      `<div class="klink"><b>Sources:</b> ` +
      vm.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>`).join(' · ') +
      `</div>`;
  }

  if (!vm.items.length) {
    h += `<div class="stub">This topic is scaffolded — questions land here next. Tap “Gym session” above for videos and readings while it fills in.</div>`;
    return h;
  }

  h +=
    `<div class="panel" style="margin-top:10px"><p class="panel-t">Studying for</p>` +
    `<div class="timebar" style="flex-wrap:wrap">` +
    vm.targets
      .map(([id, label]) => `<button class="${id === vm.target ? 'on' : ''}" data-act="target" data-id="${esc(id)}">${esc(label)}</button>`)
      .join('') +
    `</div>` +
    (vm.target !== 'all'
      ? `<div class="note" style="margin-top:6px">${vm.targetCount} questions tagged ${esc(vm.target)} across all topics · ` +
        `<button class="mbtn" data-act="study-tagged" style="padding:3px 8px;font-size:11px">Study them all</button></div>`
      : '') +
    `</div>`;

  h +=
    `<div class="timebar" style="margin-top:10px">` +
    ['all', '5', '15', '30']
      .map((t) => `<button class="${t === vm.timeFilter ? 'on' : ''}" data-act="time" data-id="${t}">${TIME_LABEL[t]}</button>`)
      .join('') +
    `</div>`;

  h += vm.items.map((it) => renderCard(it, vm)).join('');
  return h + (vm.charts ?? '');
}

export class KnowledgeViewController extends BaseViewController {
  constructor(host: ViewHost, private readonly actions: KnowledgeActions) {
    super(host);
  }

  protected onAction(act: string, ds: Record<string, string>): void {
    const id = ds.id ?? '';
    switch (act) {
      case 'topic': this.actions.selectTopic(id); break;
      case 'time': this.actions.setTimeFilter(id); break;
      case 'target': this.actions.setTarget(id); break;
      case 'study-tagged': this.actions.studyAllTagged(); break;
      case 'review': this.actions.startReview(); break;
      case 'gym': this.actions.toggleGym(); break;
      case 'gym-done': this.actions.toggleGymDone(ds.key ?? ''); break;
      case 'reveal': this.actions.reveal(id); break;
      case 'rate': this.actions.rate(id, (Number(ds.score) || 1) as Mastery); break;
      case 'queue': this.actions.queueForReview(id); break;
      case 'ai-grade': this.actions.gradeWithAI(id); break;
      case 'ai-answer': this.actions.answerWithAI(id); break;
      case 'chart-period': this.actions.setChartPeriod?.(ds.period ?? 'week'); break;
      default: break;
    }
  }

  repaint(vm: KnowledgeViewModel): boolean {
    return this.paint(renderKnowledgeHTML(vm));
  }
}
