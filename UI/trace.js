// Orbit trace UI — ports math-sync's "What Gemma did" drawer so the tool-use
// evidence surfaces in Orbit's chat. DOM only; the trace data comes from the
// backend's `trace` SSE event and GET /api/traces. Zero external URLs.
//
// Exposes:
//   window.orbitTrace.attachDrawer(el, trace)  — drawer under an assistant message
//   window.orbitTrace.loadTraceList(el)        — fill a container from GET /api/traces

/**
 * @typedef {{ name:string, args:string, result:string, durationMs:number }} TraceToolCall
 * @typedef {{ round:number, modelMs:number, evalCount?:number, tokensPerSec?:number, toolCalls:TraceToolCall[] }} TraceRound
 * @typedef {{ id:string, startedAt:string, model:string, systemPromptChars:number, userInput:string,
 *             rounds:TraceRound[], verdicts:("correct"|"incorrect")[], totalMs:number,
 *             totalTokens?:number, tokensPerSec?:number, outcome:string, error?:string }} TurnTrace
 */

(() => {
  const secs = (ms) => `${(ms / 1000).toFixed(1)}s`;
  const tps = (n) => (n === undefined ? null : `${n.toFixed(1)} tok/s`);

  /** One-line rollup for the <summary>. */
  function summaryText(trace) {
    const toolCount = trace.rounds.reduce((n, r) => n + r.toolCalls.length, 0);
    const parts = [
      `${toolCount} tool call${toolCount === 1 ? "" : "s"}`,
      `${trace.rounds.length} round${trace.rounds.length === 1 ? "" : "s"}`,
      secs(trace.totalMs),
    ];
    const speed = tps(trace.tokensPerSec);
    if (speed) parts.push(speed);
    if (trace.verdicts.length) {
      parts.push(trace.verdicts.every((v) => v === "correct") ? "✓ checked" : "✗ check failed");
    }
    return parts.join(" · ");
  }

  /** The drawer body: rounds → tool calls, then a meta footer. Semantic dl/ol. */
  function buildBody(trace) {
    const body = document.createElement("div");
    body.className = "trace-body";

    for (const round of trace.rounds) {
      const h = document.createElement("h3");
      const tok =
        round.evalCount !== undefined
          ? ` (${round.evalCount} tok${round.tokensPerSec !== undefined ? `, ${tps(round.tokensPerSec)}` : ""})`
          : "";
      h.textContent = `Round ${round.round} — model ${secs(round.modelMs)}${tok}`;
      body.appendChild(h);

      if (round.toolCalls.length) {
        const ol = document.createElement("ol");
        ol.className = "trace-calls";
        for (const call of round.toolCalls) {
          const li = document.createElement("li");
          const head = document.createElement("code");
          head.textContent = `${call.name}(${call.args})`;
          const arrow = document.createElement("span");
          arrow.className = "trace-arrow";
          arrow.textContent = ` → ${call.durationMs}ms`;
          const result = document.createElement("div");
          result.className = "trace-result";
          result.textContent = call.result;
          li.append(head, arrow, result);
          ol.appendChild(li);
        }
        body.appendChild(ol);
      }
    }

    const meta = document.createElement("p");
    meta.className = "trace-meta";
    const bits = [
      trace.model,
      `system prompt ${trace.systemPromptChars} chars`,
      `outcome: ${trace.outcome}`,
    ];
    if (trace.totalTokens !== undefined) bits.splice(2, 0, `${trace.totalTokens} tokens`);
    if (trace.error) bits.push(`error: ${trace.error}`);
    meta.textContent = bits.join(" · ");
    body.appendChild(meta);
    return body;
  }

  /** Build a collapsible drawer for one turn trace. */
  function buildDrawer(trace, label) {
    const details = document.createElement("details");
    details.className = "trace-drawer";
    const summary = document.createElement("summary");
    summary.textContent = `${label} · ${summaryText(trace)}`;
    details.append(summary, buildBody(trace));
    return details;
  }

  /** Attach the "What Gemma did" drawer under an assistant message element. */
  function attachDrawer(el, trace) {
    if (!trace || !Array.isArray(trace.rounds)) return;
    el.appendChild(buildDrawer(trace, "What Gemma did"));
  }

  /** Fill a container element with recent turns from GET /api/traces. */
  async function loadTraceList(listBox) {
    if (!listBox) return;
    listBox.textContent = "loading traces…";
    try {
      const res = await fetch("/api/traces");
      const data = /** @type {{ traces: TurnTrace[] }} */ (await res.json());
      listBox.textContent = "";
      if (!data.traces.length) {
        listBox.textContent = "No traces yet this session — ask Gemma a question.";
        return;
      }
      for (const trace of data.traces) {
        const q = trace.userInput.length > 90 ? `${trace.userInput.slice(0, 90)}…` : trace.userInput;
        const item = buildDrawer(trace, `“${q}”`);
        const when = document.createElement("time");
        when.className = "trace-when muted";
        when.dateTime = trace.startedAt;
        when.textContent = new Date(trace.startedAt).toLocaleTimeString();
        item.querySelector("summary")?.appendChild(when);
        listBox.appendChild(item);
      }
    } catch (e) {
      listBox.textContent = `Could not load traces: ${e}`;
    }
  }

  window.orbitTrace = { attachDrawer, loadTraceList };
})();
