// feat/quiz: quiz card rendered inline in the chat stream.
// All quiz JS lives in this one file; the only hooks elsewhere are one script
// tag in index.html, a marked CSS block in style.css, and app.js delegating the
// "quiz" SSE event to window.msQuiz.render. Zero external URLs.

// feat/missed: a problem the student needed 3+ tries on becomes a flashcard in the
// shared "Missed questions" deck (pure logic in missed.js; store via msFlashcards).
import { qualifies, buildCard, addMissedCard } from "/missed.js";

/**
 * @typedef {{ question: string, type: "numeric"|"expression" }} QuizProblemView
 * @typedef {{ id: number, title: string, problems: QuizProblemView[] }} QuizView
 */

(() => {
  function renderMath(el) {
    if (window.renderMathInElement) {
      window.renderMathInElement(el, {
        delimiters: [
          { left: "$$", right: "$$", display: true },
          { left: "$", right: "$", display: false },
          { left: "\\[", right: "\\]", display: true },
          { left: "\\(", right: "\\)", display: false },
        ],
        throwOnError: false,
      });
    }
  }

  /** POST one answer; returns the grading JSON or throws. */
  async function checkAnswer(quizId, index, answer) {
    const res = await fetch("/api/quiz/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quizId, index, answer }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
    return /** @type {{ pass: boolean, attempts: number, normalized: string, expected?: string }} */ (data);
  }

  /**
   * If the student needed 3+ attempts on this problem, add it to the shared
   * "Missed questions" flashcard deck and show a one-line muted note (once).
   * DOM-free decision + dedupe live in missed.js; the store is flashcards.js's.
   * @param {HTMLElement} li  the <li> for this problem
   * @param {{ question: string }} problem
   * @param {{ pass: boolean, attempts: number, expected?: string }} result
   */
  function maybeAddMissed(li, problem, result) {
    if (!qualifies(result)) return;
    const fc = window.msFlashcards;
    if (!fc?.loadDecks || !fc?.persistDecks) return;
    const card = buildCard(problem.question, result.expected);
    const { decks, added } = addMissedCard(fc.loadDecks(), card);
    if (!added) return; // already in the deck (deduped) — nothing to write or say
    fc.persistDecks(decks);
    if (li.querySelector(".quiz-missed-note")) return;
    const note = document.createElement("p");
    note.className = "quiz-missed-note muted";
    note.textContent = "Added to your Missed questions deck →";
    li.appendChild(note);
  }

  /**
   * Render one quiz card under the given assistant bubble.
   * @param {HTMLElement} bubble
   * @param {QuizView} quiz
   */
  function render(bubble, quiz) {
    const card = document.createElement("section");
    card.className = "quiz-card";
    card.setAttribute("aria-label", `Quiz: ${quiz.title}`);

    const head = document.createElement("h3");
    head.className = "quiz-title";
    head.textContent = quiz.title;
    card.appendChild(head);

    const score = document.createElement("p");
    score.className = "quiz-score";
    const solved = quiz.problems.map(() => false);
    const updateScore = () => {
      const n = solved.filter(Boolean).length;
      score.textContent = `${n}/${quiz.problems.length} verified ✓`;
      score.classList.toggle("all-done", n === quiz.problems.length);
    };
    updateScore();
    card.appendChild(score);

    const list = document.createElement("ol");
    list.className = "quiz-problems";
    quiz.problems.forEach((problem, index) => {
      const li = document.createElement("li");
      li.className = "quiz-problem";

      const q = document.createElement("div");
      q.className = "quiz-question";
      q.textContent = problem.question;
      renderMath(q);
      li.appendChild(q);

      const row = document.createElement("form");
      row.className = "quiz-answer-row";
      const input = document.createElement("input");
      input.type = "text";
      input.autocomplete = "off";
      input.spellcheck = false;
      input.className = "quiz-input";
      input.placeholder = problem.type === "numeric" ? "your answer, e.g. 3 or -1, 2" : "your answer, e.g. 2x+1";
      input.setAttribute("aria-label", `Answer to question ${index + 1}`);
      const btn = document.createElement("button");
      btn.type = "submit";
      btn.className = "quiz-check";
      btn.textContent = "Check";
      row.append(input, btn);
      li.appendChild(row);

      const result = document.createElement("div");
      result.className = "quiz-result";
      li.appendChild(result);

      row.addEventListener("submit", async (e) => {
        e.preventDefault();
        const answer = input.value.trim();
        if (!answer || btn.disabled) return;
        btn.disabled = true;
        const label = btn.textContent;
        btn.innerHTML = '<span class="spinner"></span>';
        try {
          const r = await checkAnswer(quiz.id, index, answer);
          if (r.pass) {
            solved[index] = true;
            input.disabled = true;
            result.className = "quiz-result ok";
            result.textContent = `✓ correct — ${r.normalized} verified`;
            updateScore();
          } else {
            result.className = "quiz-result bad";
            result.textContent = r.expected !== undefined
              ? `✗ not quite — the answer was ${r.expected}`
              : `✗ ${r.normalized} — try again (attempt ${r.attempts})`;
          }
          renderMath(result);
          maybeAddMissed(li, problem, r);
        } catch (err) {
          result.className = "quiz-result bad";
          result.textContent = `Could not check: ${err instanceof Error ? err.message : err}`;
        } finally {
          btn.innerHTML = "";
          btn.textContent = label;
          btn.disabled = solved[index];
        }
      });

      list.appendChild(li);
    });
    card.appendChild(list);

    const foot = document.createElement("p");
    foot.className = "quiz-foot muted";
    foot.textContent =
      "Questions and key by Gemma from your course — grading is deterministic (mathjs), never the model.";
    card.appendChild(foot);

    bubble.appendChild(card);
    card.scrollIntoView({ block: "nearest" });
  }

  window.msQuiz = { render };
})();
