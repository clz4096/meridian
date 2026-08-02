/**
 * Knowledge tab view — the last legacy renderer, ported.
 *
 * Pure renderer over a view model, plus a controller using the same
 * delegation + focus-preserving repaint contract as Workout, Meal and Data.
 */
import type { Mastery } from '@/core/types';
import { esc } from '@/ui/html';
import { BaseViewController, type ViewHost } from '@/ui/viewHost';

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
  /** Pre-rendered progress-charts block (+ the collapse toggle), shown above the questions. */
  charts?: string;
  /** Whether the questions/study section below the charts is expanded. */
  logOpen?: boolean;
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
  /** Progress-chart controls (optional — present once charts are wired). */
  setChartPeriod?(period: string): void;
  setChartScale?(scale: string): void;
  /** Expand/collapse the questions/study section below the charts. */
  toggleLog?(): void;
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

/** Topic becomes a heading + tucked picker: the current topic leads, tapping it opens the list. */
function renderTopicHead(vm: KnowledgeViewModel): string {
  const cur = vm.topics.find((t) => t.id === vm.topicId);
  const title = cur
    ? cur.name
    : vm.topicId === '__review__'
      ? 'Due for review'
      : vm.topicId === '__target__'
        ? 'Studying by target'
        : 'Questions';
  const prog = cur ? `${cur.mastered} / ${cur.total} mastered` : '';
  return (
    `<div class="khead">` +
    `<details class="ktopic-d"><summary class="ktopic">${esc(title)} <span class="kchev">▾</span></summary>` +
    `<div class="ktopic-list">` +
    vm.topics
      .map(
        (t) =>
          `<button class="klist-item${t.id === vm.topicId ? ' on' : ''}" data-act="topic" data-id="${esc(t.id)}">` +
          `<span class="kli-name">${esc(t.name)}</span>` +
          (t.total
            ? `<span class="kli-cnt">${t.mastered}/${t.total}</span>`
            : `<span class="kli-cnt soon">soon</span>`) +
          `</button>`,
      )
      .join('') +
    `</div></details>` +
    `<div class="kprog">${prog}</div>` +
    `</div>`
  );
}

/** Length, target and sources collapse into one tucked Filters disclosure. */
function renderFilters(vm: KnowledgeViewModel): string {
  const isReal = vm.topicId !== '__review__' && vm.topicId !== '__target__';
  const lenSummary = vm.timeFilter === 'all' ? 'All lengths' : TIME_LABEL[vm.timeFilter];
  const targetSummary = !isReal || vm.target === 'all' ? 'everything' : vm.target;

  let b =
    `<div class="fgrp"><div class="fgrp-l">Question length</div><div class="timebar">` +
    ['all', '5', '15', '30']
      .map((t) => `<button class="${t === vm.timeFilter ? 'on' : ''}" data-act="time" data-id="${t}">${TIME_LABEL[t]}</button>`)
      .join('') +
    `</div></div>`;
  if (isReal) {
    b +=
      `<div class="fgrp"><div class="fgrp-l">Studying for</div><div class="timebar" style="flex-wrap:wrap">` +
      vm.targets
        .map(([id, label]) => `<button class="${id === vm.target ? 'on' : ''}" data-act="target" data-id="${esc(id)}">${esc(label)}</button>`)
        .join('') +
      `</div>` +
      (vm.target !== 'all'
        ? `<div class="note" style="margin-top:6px">${vm.targetCount} questions tagged ${esc(vm.target)} · ` +
          `<button class="mbtn" data-act="study-tagged" style="padding:3px 8px;font-size:11px">Study them all</button></div>`
        : '') +
      `</div>`;
  }
  if (vm.sources.length) {
    b +=
      `<div class="fgrp"><div class="fgrp-l">Sources</div><div class="klink">` +
      vm.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>`).join(' · ') +
      `</div></div>`;
  }
  return (
    `<details class="kfilters"><summary><span class="fgear">⚙</span>` +
    `<span class="fsum">${esc(lenSummary)} · studying ${esc(targetSummary)}</span><span class="fcta">Filters</span></summary>` +
    `<div class="kfilters-b">${b}</div></details>`
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
    c += `<textarea class="ans dictxt" id="ans-${esc(it.id)}" style="min-height:80px;margin-top:10px" placeholder="Write your answer here, then reveal to compare — active recall beats just reading."></textarea>`;
  }
  c +=
    `<div class="qactions"><button class="mbtn primary" data-act="reveal" data-id="${esc(it.id)}">${full ? 'Reveal model answer' : 'Show answer'}</button>` +
    `<button class="mbtn" data-act="ai-answer" data-id="${esc(it.id)}">✦ AI answer</button>` +
    (full ? `<button class="mbtn" data-act="ai-grade" data-id="${esc(it.id)}">✦ AI grade</button>` : '') +
    `</div><div id="ai-${esc(it.id)}" class="note" style="margin-top:6px"></div>` +
    `<div class="reveal${open ? ' on' : ''}" id="rv-${esc(it.id)}">${formatReveal(it.reveal)}` +
    `<button class="qmeta-add" data-act="queue" data-id="${esc(it.id)}">+ Add to review queue</button>` +
    `<div class="rate" id="rate-${esc(it.id)}"><span class="rl">Recall</span>` +
    [1, 2, 3, 4, 5]
      .map((n) => `<button data-act="rate" data-id="${esc(it.id)}" data-score="${n}"><span class="rn">${n}</span>${MASTERY_TEXT[n]}</button>`)
      .join('') +
    `</div></div></div>`;
  return c;
}

/**
 * Screens nest: Progress (charts) → Questions → Gym. The single top-left back
 * button always walks up exactly one level, matching the OS/swipe back.
 */
export function renderKnowledgeHTML(vm: KnowledgeViewModel): string {
  if (!vm.logOpen) return vm.charts ?? '';
  const back = vm.gymMode
    ? '<button class="backbtn" data-act="gym">‹ Questions</button>'
    : '<button class="backbtn" data-act="toggle-log">‹ Progress</button>';
  return back + renderKnowledgeBody(vm);
}

function renderKnowledgeBody(vm: KnowledgeViewModel): string {
  const isReal = vm.topicId !== '__review__' && vm.topicId !== '__target__';
  let h = renderTopicHead(vm);

  if (vm.dueCount > 0 && vm.topicId !== '__review__' && !vm.gymMode) {
    h +=
      `<div class="kdue"><div class="kdue-t"><b>${vm.dueCount} due for review</b>` +
      `<small>Interleaved recall — the highest-value thing today.</small></div>` +
      `<button class="kdue-b" data-act="review">Start review</button></div>`;
  }

  // The enter affordance only; exiting gym is the top-left back button (one level up).
  if (isReal && !vm.gymMode) {
    h +=
      `<div class="kgymrow"><button class="mbtn" data-act="gym">🎧 Gym session</button>` +
      `<span class="note">Videos + readings — recall practice</span></div>`;
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

  if (!vm.items.length) {
    h += `<div class="stub">This topic is scaffolded — questions land here next. Tap “Gym session” above for videos and readings while it fills in.</div>`;
    return h;
  }

  h += renderFilters(vm);
  h += vm.items.map((it) => renderCard(it, vm)).join('');
  return h;
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
      case 'chart-scale': this.actions.setChartScale?.(ds.scale ?? 'lin'); break;
      case 'toggle-log': this.actions.toggleLog?.(); break;
      default: break;
    }
  }

  repaint(vm: KnowledgeViewModel): boolean {
    return this.paint(renderKnowledgeHTML(vm));
  }
}
