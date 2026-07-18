// Calculator tab (feat/calculator): scientific calc + grapher via mathjs.
// Self-contained: this file + the #calculator section in index.html + the
// ".calc-*" block in style.css are the whole feature; delete all three to remove.
//
// Evaluation goes through POST /api/calculate (same mathjs path as the Gemma
// `calculate` tool, so results always agree). Graphing uses the VENDORED
// function-plot already loaded by index.html — zero external URLs.

const calcForm = document.getElementById("calc-form");
const calcInput = /** @type {HTMLInputElement} */ (document.getElementById("calc-input"));
const calcHistory = document.getElementById("calc-history");

const graphForm = document.getElementById("graph-form");
const graphFn = /** @type {HTMLInputElement} */ (document.getElementById("graph-fn"));
const graphMin = /** @type {HTMLInputElement} */ (document.getElementById("graph-min"));
const graphMax = /** @type {HTMLInputElement} */ (document.getElementById("graph-max"));
const graphError = document.getElementById("graph-error");
const graphTarget = document.getElementById("graph-target");

// --- Scientific calculator: expression → /api/calculate → history list ------

async function evaluate(expression) {
  const res = await fetch("/api/calculate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expression }),
  });
  const data = await res.json();
  if (!res.ok) return `Error: ${data.error ?? res.statusText}`;
  return String(data.result);
}

function addHistoryEntry(expression, result) {
  const li = document.createElement("li");
  const isError = result.startsWith("Error:");
  li.className = isError ? "calc-entry error" : "calc-entry";

  const exprEl = document.createElement("code");
  exprEl.className = "calc-expr";
  exprEl.textContent = expression;
  const resEl = document.createElement("span");
  resEl.className = "calc-result";
  resEl.textContent = isError ? result : `= ${result}`;
  li.append(exprEl, resEl);

  // Click a past entry to re-load it into the input.
  li.addEventListener("click", () => {
    calcInput.value = expression;
    calcInput.focus();
  });

  calcHistory.prepend(li); // newest first (<ol reversed>)
}

if (calcForm) {
  calcForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const expression = calcInput.value.trim();
    if (!expression) return;
    const button = calcForm.querySelector("button");
    button.disabled = true;
    try {
      const result = await evaluate(expression);
      addHistoryEntry(expression, result);
      if (!result.startsWith("Error:")) calcInput.value = "";
    } catch (err) {
      addHistoryEntry(expression, `Error: ${err}`);
    } finally {
      button.disabled = false;
      calcInput.focus();
    }
  });
}

// --- Grapher: f(x) + optional range → vendored function-plot ---------------

function drawGraph(fn, min, max) {
  graphTarget.hidden = false;
  graphTarget.textContent = "";
  window.functionPlot({
    target: graphTarget,
    width: Math.min(560, graphTarget.parentElement.clientWidth - 20),
    height: 320,
    grid: true,
    xAxis: { domain: [min, max] },
    data: [{ fn, color: "#2563eb" }],
  });
}

if (graphForm) {
  graphForm.addEventListener("submit", (e) => {
    e.preventDefault();
    // Accept "f(x) = ..." / "y = ..." prefixes and Python-style **.
    const fn = graphFn.value
      .trim()
      .replace(/^\s*(?:y|f\s*\(\s*x\s*\))\s*=\s*/i, "")
      .replace(/\*\*/g, "^");
    if (!fn) return;
    const min = graphMin.value === "" ? -10 : Number(graphMin.value);
    const max = graphMax.value === "" ? 10 : Number(graphMax.value);

    graphError.hidden = true;
    if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) {
      graphError.textContent = "Range must be two numbers with min < max.";
      graphError.hidden = false;
      return;
    }
    try {
      drawGraph(fn, min, max);
    } catch (err) {
      graphTarget.hidden = true;
      graphError.textContent = `Could not plot ${fn}: ${err}`;
      graphError.hidden = false;
    }
  });
}
