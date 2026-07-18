// Two game engines. Both render into a container and call
// onDone(score) when the run ends. app.js handles navigation and points.

// ---------- Meteor Run: timed multiple choice ----------

function startQuiz(container, genKey, onDone) {
  const TOTAL_Q = 8;
  const Q_TIME = 12000; // ms per question
  let qIndex = 0;
  let score = 0;
  let combo = 0;
  let timerId = null;

  container.innerHTML =
    '<div class="game-head">' +
    "  <h2>Meteor Run</h2>" +
    '  <span class="game-score" id="gScore">0 pts</span>' +
    "</div>" +
    '<div class="timer-track"><div class="timer-fill" id="gTimer"></div></div>' +
    '<div class="question-box">' +
    '  <div class="q-text" id="gQ"></div>' +
    '  <div class="q-sub" id="gSub"></div>' +
    "</div>" +
    '<div class="answers" id="gAnswers"></div>';

  const elScore = container.querySelector("#gScore");
  const elTimer = container.querySelector("#gTimer");
  const elQ = container.querySelector("#gQ");
  const elSub = container.querySelector("#gSub");
  const elAnswers = container.querySelector("#gAnswers");

  function nextQuestion() {
    if (qIndex >= TOTAL_Q) return finish();
    qIndex++;
    const p = makeProblem(genKey);
    elQ.textContent = p.q;
    elSub.textContent = p.sub + "  ·  " + qIndex + " of " + TOTAL_Q;
    elAnswers.innerHTML = "";

    const options = shuffle([p.answer, ...p.wrong]);
    const started = Date.now();

    options.forEach((opt) => {
      const b = document.createElement("button");
      b.className = "answer-btn";
      b.textContent = opt;
      b.onclick = () => resolve(opt === p.answer, b, started);
      elAnswers.appendChild(b);
    });

    clearInterval(timerId);
    timerId = setInterval(() => {
      const left = Q_TIME - (Date.now() - started);
      elTimer.style.width = Math.max(0, (left / Q_TIME) * 100) + "%";
      elTimer.classList.toggle("low", left < Q_TIME * 0.3);
      if (left <= 0) resolve(false, null, started);
    }, 100);

    function resolve(correct, btn, startedAt) {
      clearInterval(timerId);
      elAnswers.querySelectorAll("button").forEach((x) => {
        x.disabled = true;
        if (x.textContent === p.answer) x.classList.add("right");
      });
      if (btn && !correct) btn.classList.add("wrong");
      if (correct) {
        combo++;
        const timeBonus = Math.round(
          Math.max(0, (Q_TIME - (Date.now() - startedAt)) / Q_TIME) * 50
        );
        score += 100 + timeBonus + combo * 10;
      } else {
        combo = 0;
      }
      elScore.textContent = score + " pts";
      setTimeout(nextQuestion, 750);
    }
  }

  function finish() {
    clearInterval(timerId);
    onDone(score);
  }

  nextQuestion();
  return () => clearInterval(timerId); // cleanup for navigation mid-game
}

// ---------- Orbit Match: flip cards, pair problem with answer ----------

function startMatch(container, genKey, onDone) {
  const pairs = makePairs(genKey, 6);
  const PAIRS = pairs.length;
  const started = Date.now();
  let flipped = null; // currently face-up card
  let matched = 0;
  let locked = false;

  const cards = shuffle(
    pairs.flatMap(([q, a], i) => [
      { text: q, pair: i },
      { text: a, pair: i },
    ])
  );

  container.innerHTML =
    '<div class="game-head">' +
    "  <h2>Orbit Match</h2>" +
    '  <span class="game-score" id="gClock">0:00</span>' +
    "</div>" +
    '<p class="q-sub" style="margin-top:10px">Pair each problem with its answer. Faster runs score higher.</p>' +
    '<div class="match-grid" id="gGrid"></div>';

  const elGrid = container.querySelector("#gGrid");
  const elClock = container.querySelector("#gClock");

  const clockId = setInterval(() => {
    const s = Math.floor((Date.now() - started) / 1000);
    elClock.textContent = Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  }, 500);

  cards.forEach((card) => {
    const b = document.createElement("button");
    b.className = "match-card";
    b.textContent = card.text;
    b.onclick = () => flip(b, card);
    elGrid.appendChild(b);
  });

  function flip(btn, card) {
    if (locked || btn.classList.contains("matched") || btn === (flipped && flipped.btn)) return;
    btn.classList.add("flipped");
    if (!flipped) {
      flipped = { btn, card };
      return;
    }
    if (flipped.card.pair === card.pair) {
      btn.classList.add("matched");
      flipped.btn.classList.add("matched");
      btn.classList.remove("flipped");
      flipped.btn.classList.remove("flipped");
      flipped = null;
      matched++;
      if (matched === PAIRS) finish();
    } else {
      locked = true;
      const prev = flipped;
      flipped = null;
      setTimeout(() => {
        btn.classList.remove("flipped");
        prev.btn.classList.remove("flipped");
        locked = false;
      }, 700);
    }
  }

  function finish() {
    clearInterval(clockId);
    const secs = (Date.now() - started) / 1000;
    // 900 base, drains with time, never below 200 for finishing
    const score = Math.max(200, Math.round(900 - secs * 8));
    setTimeout(() => onDone(score), 500);
  }

  return () => clearInterval(clockId);
}
