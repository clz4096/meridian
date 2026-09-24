/**
 * Princeton Theory of Computation group — the second half of Today's reading
 * (FeedSection): the group itself (home, Theory Lunch, faculty) plus
 * representative papers by its members. Read-only; content in princetonTheory.ts.
 */
import { GROUP_INFO, PRINCETON_THEORY } from '@/features/studytracker/princetonTheory';

export function PrincetonGroup() {
  return (
    <>
      <div class="ptg-sub">Princeton theory of computation</div>
      <p class="hint">{GROUP_INFO.blurb}</p>
      <div class="ptg-info">
        <a class="ptg-home" href={GROUP_INFO.url} target="_blank" rel="noopener noreferrer">theory.cs.princeton.edu ↗</a>
        <div class="ptg-lunch">{GROUP_INFO.lunch}</div>
        <div class="ptg-faculty"><b>Faculty:</b> {GROUP_INFO.faculty}</div>
      </div>

      <div class="ptg-sub">Papers from the group</div>
      <div class="ptg-list">
        {PRINCETON_THEORY.map((p) => (
          <a class="ptg-paper" key={p.url} href={p.url} target="_blank" rel="noopener noreferrer">
            <span class="ptg-paper-title">{p.title}</span>
            <span class="ptg-paper-by">{p.authors} · {p.year}</span>
            <span class="ptg-paper-why">{p.why}</span>
          </a>
        ))}
      </div>
    </>
  );
}
