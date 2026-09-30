# CST track spec (Computer Science path), added 2026-09-30 at the owner's request

The owner asked for Computer Science Tripos material, and the foundational studying it needs (DECISIONS C11). The facts come from a research pass on Cambridge's own pages (2026-09-30). The CS data agent verifies every URL again by fetching it.

## What Cambridge says (sources)
- **Entry:**
  - A-level Maths is required, and Further Maths too if the school offers it. The CST FAQ calls Further Maths "highly recommended".
  - Every applicant sits the **TMUA**: 2 papers of 75 minutes, 20 multiple-choice questions each, no calculator.
  - Some colleges also use the CSAT.
  - Pages:
    - https://www.undergraduate.study.cam.ac.uk/courses/computer-science
    - https://www.undergraduate.study.cam.ac.uk/apply/how/maths-admission-test
    - https://esat-tmua.ac.uk/about-the-tests/tmua-test/
- **No programming expected on arrival:** "We do not expect any of our students to be able to program … when they first arrive" (CST FAQ, https://www.cst.cam.ac.uk/admissions/undergraduate/faqs). FoCS starts from zero, in OCaml.
- **Required pre-arrival work** (freshers hub https://www.cst.cam.ac.uk/freshers):
  - every exercise in the **NST Mathematics Workbook** (https://www.maths.cam.ac.uk/undergradnst/files/misc/nstworkbook.pdf), which is also online at https://isaacphysics.org/pages/nstia_workbook,
  - the **Python mini-course** to the end of Collections (https://www.cl.cam.ac.uk/teaching/2425/SciComp/tutorial/public/py.html).
  - Optional: the Computer Fundamentals pages, a UNIX command-line tutorial, and Wing's *Computational Thinking*.
- **Part IA exams:** CST Papers 1, 2 and 3, plus **NST Part IA Mathematics**, run by DAMTP (Course A or the faster Course B; same exam). Part IA has zero weight in the degree class but must be passed. Sources: https://www.cl.cam.ac.uk/teaching/exams/exam-structure.pdf and https://www.cst.cam.ac.uk/teaching/exams/marking-and-classing.
  - **Paper 1:** Foundations of Computer Science, Object-Oriented Programming, Introduction to Probability, Algorithms 1, Algorithms 2.
  - **Paper 2:** Digital Electronics, Operating Systems, Software and Security Engineering, Discrete Mathematics (2 questions).
  - **Paper 3:** Databases, Introduction to Graphics, Interaction Design, Machine Learning and Real-world Data (2 questions).
- **Terms (2026-27)** (https://www.cl.cam.ac.uk/teaching/2627/part1a.html):
  - **Michaelmas:** Databases, Digital Electronics, Discrete Mathematics, FoCS (OCaml), Hardware Practical Classes, Introduction to Graphics, OOP (Java), OCaml Practical Classes.
  - **Lent:** Algorithms 1, Algorithms 2, Discrete Mathematics (continued), Machine Learning and Real-world Data, Operating Systems.
  - **Easter:** Interaction Design, Introduction to Probability, Software and Security Engineering.
- **Stated prerequisites:**
  - Algorithms 2 needs Algorithms 1.
  - Introduction to Probability needs Discrete Mathematics.
  - Operating Systems needs Digital Electronics.
  - Discrete Mathematics gates every later theory course.
- **Materials:** the 2026-27 course pages are mostly empty, so use the 2025-26 materials pages (already in `cs.json`), and past papers by topic at https://www.cl.cam.ac.uk/teaching/exams/pastpapers/t-<Course>.html.

## The track (cs.json gains `phases` + `items`, same shape and loop as step.json)
| Phase | Work | Pace | Gate (self-assessed; Pass gate = +200 XP) |
|---|---|---|---|
| CS-0 Foundations: proof | TMUA Logic and Proof notes; Hammack, *Book of Proof* (free), chapters on logic, proof methods, sets, induction | 1 chapter/week | Solve 3 Discrete Maths past-paper questions unaided, each at least 14/20 |
| CS-0 Foundations: maths | TMUA content specification, then 2 timed TMUA past papers as a diagnostic; the NST Maths Workbook in full | Workbook: 1 chapter/week | Timed TMUA paper: at least 14 of 20 on each paper; workbook done |
| CS-0 Foundations: functional programming | Cornell CS3110 *OCaml Programming* (free): recursion, datatypes, higher-order functions, laziness. Then the FoCS 2025-26 notes | 2 chapters/week | 3 FoCS past-paper questions unaided, each at least 14/20 |
| CS-0 Pre-arrival checklist | The Python mini-course to Collections (required); Computer Fundamentals pages and the UNIX tutorial (optional) | alongside | Checklist done |
| CS-IA Part IA | Courses in Paper order, following the stated prerequisites. Each course: lecture notes, supervision exercises (from the materials), and past-paper questions by topic, run through the loop (cold attempt, write-up, supervision, redo). NST Part IA Mathematics runs alongside, with the example sheets in `courses.json` / DAMTP | 2 courses at a time, 1 supervision each per week | Per paper: a timed past paper with 3 of 5 questions at least 14/20 |
| CS-IB Part IB | Course list and links as now; locked until the CS-IA gate | | |

**Order inside CS-IA (suggested, respecting prerequisites):**
1. FoCS + Discrete Mathematics
2. Algorithms 1 + OOP
3. Digital Electronics + Algorithms 2
4. Operating Systems + Introduction to Probability
5. Databases + Software and Security Engineering
6. Introduction to Graphics + Machine Learning and Real-world Data
7. Interaction Design

The practical classes (Hardware, OCaml ticks) are listed but not examined as papers. Label the order "suggested".

**Supervisor prompt for CS items:** swap "STEP supervisor" for "{course} supervisor (Computer Science Tripos), supervision work {n}". Code questions may be answered in OCaml, Java, C++ or Python.

**Links to exclude:** unofficial CSAT mirrors (for example openclimb.io); link only official Cambridge / UAT / Pearson VUE pages. No pirated books; name the text instead (for example CLRS, Harris & Harris).

**Owner context:** they are an experienced C++ systems engineer. The CST FAQ says FoCS "aims to correct" imperative habits, so the functional phase matters even for a strong programmer. Programming basics aren't needed; the maths is the real gap.
