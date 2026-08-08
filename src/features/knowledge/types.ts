/**
 * Knowledge feature — view-facing types shared by the store, actions and the
 * KnowledgeView component. The ViewModel mirrors the shape `app.ts` derived
 * inline (topics + items + gym), consumed by `KnowledgeTab.tsx`.
 */
import type { Mastery } from '@/core/types';

export interface KnowledgeItem {
  id: string;
  prompt: string;
  reveal: string;
  mins: number;
  flow: 'flip' | 'full';
  src: { book: string; ref: string; page?: number; title?: string; url?: string };
  tags?: string[];
}

export interface KnowledgeTopic {
  id: string;
  name: string;
  books: string[];
}

export interface GymLink {
  label: string;
  url: string;
  key: string;
  done: boolean;
}

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
}

export interface KnowledgeActions {
  selectTopic(id: string): void;
  setTimeFilter(value: string): void;
  setTarget(value: string): void;
  studyAllTagged(): void;
  /** Launch the focused review — a capped Ascent session over `topicId`'s due deck. */
  startReview(topicId: string): void;
  /** Start "Today's path" — the FSRS growth queue (due reviews + new questions). */
  startToday(): void;
  /** Exit an Ascent session: a topic review → its topic screen; Today's path → the Rail. */
  exitSession(): void;
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
  /** Open the secondary Progress (charts/trends) view from the gallery. */
  openProgress(): void;
  /** Show the card gallery — the Progress view's back-to-gallery action. */
  browseTopics(): void;
  /** Return from a topic's questions to the card gallery. */
  backToTopics(): void;
}
