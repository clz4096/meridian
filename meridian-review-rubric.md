# Meridian — Whole-Project Design Review Rubric

**How to use:** open `claude` in the Meridian repo, enter **plan mode** (`Shift+Tab` → read-only), and paste: *"Review this whole project against `review-rubric.md`. Report findings only — do not edit. Follow the output format in section 0."* This is a review-only pass. No source edits; propose, don't apply.

Lens: John Ousterhout, *A Philosophy of Software Design* (APoSD), plus general TypeScript quality and the standards in my global `~/.claude/CLAUDE.md`. APoSD is **heuristics, not rules** — every finding needs a rationale tied to complexity, not a mechanical rule-match.

---

## 0. Procedure & output format

Walk the project module by module (start at the typed core `meridian-ts/`, then adapters, view controllers, then legacy). For each finding, report:

| Field | Content |
|---|---|
| **Location** | file + symbol / line range |
| **Principle** | which rubric item (e.g. "shallow module", "info leakage", "pass-through method") |
| **Problem** | what's wrong, concretely |
| **Why it adds complexity** | change amplification / cognitive load / unknown-unknowns — the APoSD cost |
| **Direction** | suggested fix *shape* (not a diff) |
| **Severity** | High / Med / Low (see §4) |

End with a **cross-cutting themes** summary (the 3–5 systemic issues that recur) and a **prioritized top-10**. Optionally write the full report to `docs/review-findings.md` (a new file is fine — that's not a source edit). Do not touch `mergeStores.ts` / `SyncEngine.ts` / tombstone / revision-counter logic even to "improve" it — flag only.

---

## 1. APoSD lens

**Complexity symptoms (frame every finding against these):**
- **Change amplification** — does a plausible change (add a tracker, add a field, change a storage tier) require edits in many places?
- **Cognitive load** — how much must you hold in your head to work on this module safely?
- **Unknown unknowns** — are there non-obvious things you must know to make a change correctly (hidden invariants, ordering requirements)?

**Deep vs shallow modules:**
- Is the interface simple relative to the functionality it hides? Flag **shallow modules** (interface nearly as complex as the implementation — low benefit-to-cost).
- Flag **classitis** — many tiny classes/functions/files that each do little, forcing callers to assemble behavior.
- Flag boilerplate that could be pulled into a deeper module.

**Information hiding vs leakage:**
- Does each module encapsulate one design decision (a storage mechanism, a merge policy, a platform API)?
- Flag **leakage** — the same knowledge (a storage-key name, a serialization format, a Pantry detail) appearing in multiple modules.
- Flag **temporal decomposition** — module boundaries that mirror execution order (load → merge → save) instead of hiding information.

**Layers & abstraction:**
- **Pass-through methods** — a method that mostly forwards to another with the same signature, adding no abstraction. Flag them.
- **Pass-through variables** — a value threaded through many layers that don't use it. Flag them.
- Different layer should have a **different abstraction**; flag adjacent layers that expose the same one.

**Pull complexity downward:**
- Does the module absorb complexity so its callers don't have to? Flag config/options/edge-cases pushed onto callers that could have sane defaults or be handled internally.

**Define errors out of existence:**
- Are special cases and exceptions minimized *by design* rather than handled ad hoc at every call site?
- Can the types make illegal states unrepresentable (see §3, `types.ts`)?
- Flag repeated null/undefined/edge-case handling that a better interface would eliminate.

**Comments & names (design, not decoration):**
- Interface comments complete enough to *use* a module without reading its implementation? Flag missing ones.
- Do comments capture the non-obvious — invariants, units, ranges, "why"? Flag comments that merely restate code.
- Names precise, consistent, unambiguous? Flag vague/overloaded names.

**Consistency & strategic debt:**
- Are similar things done similarly across the codebase? Flag divergence.
- Flag tactical cruft — quick hacks, TODOs, workarounds — that accumulates complexity ("tactical tornado" residue).

---

## 2. TypeScript quality layer

- No `any` leaking across module boundaries; no implicit `any`; prefer `unknown` + narrowing at edges.
- Discriminated unions handled **exhaustively** (a `never` default in switches).
- Domain invariants encoded in types where possible rather than checked at runtime.
- Public APIs typed precisely (no over-wide return types that force callers to narrow).
- Errors are typed/modeled, not stringly-typed.
- Docs/comments follow the global standards (Google Developer Docs / DigitalOcean / Apple style).

---

## 3. Meridian-specific probes

Tie the abstract lens to the actual architecture:

- **`SyncEngine.ts` — is it a *deep* module?** It should hide conflict resolution, network flakiness, and tier coordination behind a simple interface. Flag if callers must know about Pantry, IndexedDB, or retry/ordering details to use it.
- **Browser adapters — clean information hiding?** IndexedDB / localStorage specifics should live *only* here behind a stable storage interface. Flag any storage-tier knowledge (key names, quota handling, serialization) that has leaked into view controllers or the core.
- **View controllers — pass-through?** Flag controllers that merely forward to selectors/core without adding a real UI-layer abstraction.
- **`mergeStores.ts` — invariants clear and hidden?** The merge policy (union-by-id, tombstones, LWW-for-scalars, revision counter) should be expressed once, clearly, behind a clean interface — not re-implemented or special-cased at call sites. **Review/report only; do not edit.**
- **`types.ts` — illegal states unrepresentable?** Can a record exist without its revision counter? Can a tombstone and live value coexist ambiguously? Flag types that permit states the merge logic then has to defend against.
- **Three-tier storage — layered or leaky?** IndexedDB → localStorage → Pantry should present a consistent abstraction. Flag places where a caller reaches around the abstraction to a specific tier.
- **Strangler-fig boundary — clean seam?** Flag new/typed code that reaches into the legacy untyped layer, and legacy code that should have migrated behind the `meridian-ts/` interface.

---

## 4. Severity

- **High** — change amplification across modules; correctness risk (especially anything touching sync/merge/persistence); information leakage across layers; types that permit illegal states the merge logic must defend against.
- **Medium** — shallow modules / classitis; pass-through methods & variables; missing or inadequate interface comments; special-case handling that a better interface would remove.
- **Low** — naming, local inconsistency, comment polish, cosmetic.

Prioritize High findings that sit on the storage/merge path — that's where complexity is most expensive in an offline-first, multi-device app.

---

## 5. Guardrails for this pass

- **Report only. No source edits.** Writing `docs/review-findings.md` is fine; changing code is not.
- Do not modify merge/sync/tombstone/revision-counter logic even to demonstrate a fix — describe the direction instead.
- No secrets in any output (no Pantry basket ID, no keys).
- Judgment over dogma: if a "small module" or a "special case" is genuinely the right call, say so and don't flag it.
