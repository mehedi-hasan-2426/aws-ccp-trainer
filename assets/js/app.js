const INDEX_URL = new URL("questions/index.json", document.baseURI).href;
const PREFS_KEY = "clf-c02-trainer:prefs";
const PROGRESS_KEY = "clf-c02-trainer:progress:v1";

const el = (id) => document.getElementById(id);

const dom = {
  views: Array.from(document.querySelectorAll("[data-view]")),
  setup: el("setup"),
  quiz: el("quiz"),
  result: el("result"),
  form: el("setup-form"),
  domainGrid: el("domain-grid"),
  shuffle: el("shuffle"),
  start: el("start"),
  bankSummary: el("bank-summary"),
  progressFill: el("progress-fill"),
  progressLabel: el("progress-label"),
  scoreLabel: el("score-label"),
  qDomain: el("q-domain"),
  qTopic: el("q-topic"),
  qType: el("q-type"),
  qPrompt: el("q-prompt"),
  qOptions: el("q-options"),
  prev: el("prev"),
  next: el("next"),
  reveal: el("reveal"),
  finish: el("finish"),
  solution: el("solution"),
  verdict: el("verdict"),
  explanation: el("explanation"),
  breakdown: el("breakdown"),
  reference: el("reference"),
  resultScore: el("result-score"),
  resultRows: el("result-rows"),
  reviewWrong: el("review-wrong"),
  restart: el("restart"),
  error: el("error"),
  resumeBanner: el("resume-banner"),
  resumeText: el("resume-text"),
  resumeContinue: el("resume-continue"),
  resumeDiscard: el("resume-discard"),
  exportProgress: el("export-progress"),
  importProgress: el("import-progress"),
};

const state = {
  bank: null,
  loaded: new Map(),
  session: [],
  cursor: 0,
  progress: new Map(),
  mode: "study",
  config: null,
};

function randomInt(bound) {
  const limit = Math.floor(0xffffffff / bound) * bound;
  const buf = new Uint32Array(1);
  let value;
  do {
    crypto.getRandomValues(buf);
    value = buf[0];
  } while (value >= limit);
  return value % bound;
}

function shuffled(list) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// The bank is a static file, but it is still external input to this page.
function safeReference(raw) {
  if (typeof raw !== "string" || !raw) return "";
  let url;
  try {
    url = new URL(raw, document.baseURI);
  } catch (err) {
    return "";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "";
  if (url.username || url.password) return "";
  return url.href;
}

function isQuestion(q) {
  return q
    && typeof q.id === "string"
    && typeof q.prompt === "string"
    && Array.isArray(q.options)
    && q.options.length > 1
    && Array.isArray(q.answer)
    && q.answer.length > 0
    && q.answer.every((k) => q.options.some((o) => o.key === k));
}

function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (err) {
    return null;
  }
}

function savePrefs(prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch (err) {
    /* storage unavailable, session still works */
  }
}

// Everything below stays on this device: only question ids, chosen option
// keys, and session settings are stored, never anything that identifies a person.
function loadProgressSnapshot() {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.spec) || !parsed.spec.length) return null;
    return parsed;
  } catch (err) {
    return null;
  }
}

function saveProgressSnapshot() {
  if (!state.session.length) return;
  try {
    const snapshot = {
      version: 1,
      config: state.config,
      mode: state.mode,
      cursor: state.cursor,
      spec: state.session.map((q) => ({ id: q.id, domain: q.domain, order: q.options.map((o) => o.from) })),
      progress: Array.from(state.progress.entries()).map(([id, entry]) => [
        id,
        { selected: Array.from(entry.selected), revealed: entry.revealed, correct: entry.correct },
      ]),
    };
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(snapshot));
  } catch (err) {
    // Quota errors are the only ones worth a trace; the session still works without persistence.
    if (err && err.name === "QuotaExceededError") console.warn("Could not save progress: storage quota exceeded.");
  }
}

function clearProgressSnapshot() {
  try {
    localStorage.removeItem(PROGRESS_KEY);
  } catch (err) {
    /* ignore */
  }
}

// Lets a learner move their progress between browsers or restore it after clearing site data,
// without ever sending it anywhere: the file never leaves their machine unless they share it.
function exportProgress() {
  const raw = localStorage.getItem(PROGRESS_KEY);
  if (!raw) {
    fail("There is no saved progress to export yet.");
    return;
  }
  const blob = new Blob([raw], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "nimbus-progress.json";
  link.click();
  URL.revokeObjectURL(url);
}

async function importProgress(file) {
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch (err) {
    fail("That file is not valid progress JSON.");
    return;
  }

  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.spec) || !parsed.spec.length) {
    fail("That file does not match the expected progress format.");
    return;
  }

  localStorage.setItem(PROGRESS_KEY, JSON.stringify(parsed));
  dom.error.hidden = true;
  dom.resumeBanner.hidden = true;
  offerResume();
}

// Rebuilds the exact same relabelled question the session showed, from the stored option order.
function relabelFromOrder(question, order) {
  const byKey = new Map(question.options.map((o) => [o.key, o]));
  const ordered = order.map((key) => byKey.get(key)).filter(Boolean);
  if (ordered.length !== question.options.length) return relabel(question, false);

  const keys = "abcdefgh";
  const options = ordered.map((option, i) => ({ ...option, key: keys[i], from: option.key }));
  return {
    ...question,
    options,
    answer: options.filter((o) => question.answer.includes(o.from)).map((o) => o.key),
  };
}

async function restoreSession(snapshot) {
  const domains = Array.from(new Set(snapshot.spec.map((s) => s.domain)));
  await loadDomains(domains);

  const session = [];
  for (const spec of snapshot.spec) {
    const pool = state.loaded.get(spec.domain) || [];
    const question = pool.find((q) => q.id === spec.id);
    if (!question) return false;
    session.push(relabelFromOrder(question, spec.order));
  }

  state.session = session;
  state.cursor = Math.min(Math.max(snapshot.cursor, 0), session.length - 1);
  state.mode = snapshot.mode;
  state.config = snapshot.config;
  state.progress = new Map(snapshot.progress.map(([id, entry]) => [
    id,
    { selected: new Set(entry.selected), revealed: Boolean(entry.revealed), correct: Boolean(entry.correct) },
  ]));
  return true;
}

function showView(name) {
  dom.views.forEach((view) => {
    view.hidden = view.id !== name;
  });
  window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
}

function fail(message) {
  dom.error.textContent = message;
  dom.error.hidden = false;
}

function renderDomains() {
  const prefs = loadPrefs();
  const selected = prefs && Array.isArray(prefs.domains) ? prefs.domains : null;

  state.bank.domains.forEach((domain) => {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = "domain";
    input.value = domain.name;
    input.checked = !selected || selected.includes(domain.name);

    const text = document.createElement("span");
    text.textContent = domain.name + " ";

    const count = document.createElement("span");
    count.className = "count";
    count.textContent = "(" + domain.count + " questions \u00b7 " + domain.weight + "% of exam)";
    text.appendChild(count);

    label.append(input, text);
    dom.domainGrid.appendChild(label);
  });

  if (prefs && typeof prefs.shuffle === "boolean") {
    dom.shuffle.checked = prefs.shuffle;
  }
  if (prefs && typeof prefs.mode === "string") {
    const radio = dom.form.querySelector('input[name="mode"][value="' + CSS.escape(prefs.mode) + '"]');
    if (radio) radio.checked = true;
  }

  dom.bankSummary.textContent = state.bank.count + " questions in the bank.";
  dom.start.disabled = false;
  dom.start.textContent = "Start session";
}

function readConfig() {
  const domains = Array.from(dom.form.querySelectorAll('input[name="domain"]:checked')).map((i) => i.value);
  const mode = dom.form.querySelector('input[name="mode"]:checked').value;
  return { domains, mode, shuffle: dom.shuffle.checked };
}

// Options are re-lettered after shuffling so the displayed keys always read A, B, C, D.
function relabel(question, shuffle) {
  const ordered = shuffle ? shuffled(question.options) : question.options.slice();
  const keys = "abcdefgh";
  const options = ordered.map((option, i) => ({ ...option, key: keys[i], from: option.key }));

  return {
    ...question,
    options,
    answer: options.filter((o) => question.answer.includes(o.from)).map((o) => o.key),
  };
}

function buildSession(config) {
  let pool = config.domains.flatMap((name) => state.loaded.get(name) || []);
  if (config.shuffle || config.mode === "exam") {
    pool = shuffled(pool);
  }
  if (config.mode === "exam") {
    pool = pool.slice(0, state.bank.examQuestionCount);
  }

  state.session = pool.map((question) => relabel(question, config.shuffle));
  state.cursor = 0;
  state.mode = config.mode;
  state.config = config;
  state.progress = new Map();
}

function current() {
  return state.session[state.cursor];
}

function entryFor(question) {
  let entry = state.progress.get(question.id);
  if (!entry) {
    entry = { selected: new Set(), revealed: false, correct: false };
    state.progress.set(question.id, entry);
  }
  return entry;
}

function scored() {
  let correct = 0;
  state.progress.forEach((entry) => {
    if (entry.correct) correct += 1;
  });
  return correct;
}

function answered() {
  let total = 0;
  state.progress.forEach((entry) => {
    if (entry.selected.size) total += 1;
  });
  return total;
}

function evaluate(question, entry) {
  const answer = question.answer;
  return entry.selected.size === answer.length && answer.every((k) => entry.selected.has(k));
}

function typeLabel(question) {
  if (!question.multi) return "Choose one";
  const words = ["", "one", "two", "three", "four"];
  return "Choose " + (words[question.answer.length] || question.answer.length);
}

function renderOptions(question, entry) {
  dom.qOptions.replaceChildren();

  question.options.forEach((option) => {
    const li = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "option";
    button.setAttribute("aria-pressed", String(entry.selected.has(option.key)));
    button.dataset.key = option.key;

    const key = document.createElement("span");
    key.className = "option__key";
    key.textContent = option.key;

    const text = document.createElement("span");
    text.textContent = option.text;

    button.append(key, text);

    if (entry.revealed) {
      button.disabled = true;
      const isAnswer = question.answer.includes(option.key);
      if (isAnswer) {
        button.classList.add("is-correct");
      } else if (entry.selected.has(option.key)) {
        button.classList.add("is-wrong");
      }
    } else {
      button.addEventListener("click", () => toggleOption(option.key));
    }

    li.appendChild(button);
    dom.qOptions.appendChild(li);
  });
}

function renderSolution(question, entry) {
  if (!entry.revealed) {
    dom.solution.hidden = true;
    return;
  }

  const unanswered = entry.selected.size === 0;

  dom.verdict.textContent = entry.correct
    ? "Correct"
    : unanswered
      ? "Answer: " + question.answer.join(", ").toUpperCase()
      : "Not quite \u2014 correct answer: " + question.answer.join(", ").toUpperCase();
  dom.verdict.className = entry.correct ? "ok" : unanswered ? "" : "bad";

  dom.explanation.textContent = question.explanation;

  dom.breakdown.replaceChildren();
  question.options.forEach((option) => {
    if (!option.note) return;
    const li = document.createElement("li");
    li.className = question.answer.includes(option.key) ? "correct" : "incorrect";

    const label = document.createElement("b");
    label.textContent = option.key.toUpperCase() + " \u2014 ";

    li.append(label, document.createTextNode(option.note));
    dom.breakdown.appendChild(li);
  });

  const reference = safeReference(question.reference);
  if (reference) {
    dom.reference.replaceChildren();
    const link = document.createElement("a");
    link.href = reference;
    link.textContent = "AWS documentation";
    link.rel = "noopener noreferrer";
    link.target = "_blank";
    dom.reference.append(document.createTextNode("Read more: "), link);
    dom.reference.hidden = false;
  } else {
    dom.reference.hidden = true;
  }

  dom.solution.hidden = false;
}

function render() {
  const question = current();
  const entry = entryFor(question);

  dom.qDomain.textContent = question.domain;
  dom.qTopic.textContent = question.topic;
  dom.qType.textContent = typeLabel(question);
  dom.qPrompt.textContent = question.prompt;

  renderOptions(question, entry);
  renderSolution(question, entry);

  const total = state.session.length;
  dom.progressFill.style.width = ((state.cursor + 1) / total) * 100 + "%";
  dom.progressLabel.textContent = "Question " + (state.cursor + 1) + " of " + total;
  dom.scoreLabel.textContent = state.mode === "exam"
    ? answered() + " answered"
    : scored() + " correct of " + answered() + " answered";

  dom.prev.disabled = state.cursor === 0;
  dom.next.textContent = state.cursor === total - 1 ? "See result" : "Next";
  dom.reveal.disabled = entry.revealed;
  dom.reveal.textContent = entry.revealed ? "Revealed" : "Reveal solution";

  saveProgressSnapshot();
}

function toggleOption(key) {
  const question = current();
  const entry = entryFor(question);

  if (question.multi) {
    if (entry.selected.has(key)) {
      entry.selected.delete(key);
    } else if (entry.selected.size < question.answer.length) {
      entry.selected.add(key);
    }
  } else {
    entry.selected.clear();
    entry.selected.add(key);
  }

  entry.correct = evaluate(question, entry);

  if (state.mode === "study" && !question.multi) {
    reveal();
    return;
  }
  if (state.mode === "study" && question.multi && entry.selected.size === question.answer.length) {
    reveal();
    return;
  }
  render();
}

function reveal() {
  const question = current();
  const entry = entryFor(question);
  entry.correct = evaluate(question, entry);
  entry.revealed = true;
  render();
}

function move(step) {
  const target = state.cursor + step;
  if (target < 0) return;
  if (target >= state.session.length) {
    finish();
    return;
  }
  state.cursor = target;
  render();
}

// Exam mode scores the whole paper; study mode reports only what was attempted.
function graded() {
  if (state.mode === "exam") return state.session;
  return state.session.filter((question) => {
    const entry = state.progress.get(question.id);
    return entry && entry.selected.size > 0;
  });
}

function missedIn(list) {
  return list.filter((question) => {
    const entry = state.progress.get(question.id);
    return !entry || !entry.correct;
  });
}

function finish() {
  clearProgressSnapshot();

  const reviewed = graded();
  const total = reviewed.length;
  const correct = reviewed.filter((question) => {
    const entry = state.progress.get(question.id);
    return entry && entry.correct;
  }).length;

  dom.resultScore.replaceChildren();

  if (!total) {
    dom.resultScore.textContent = "No questions answered yet.";
  } else {
    const percent = Math.round((correct / total) * 100);
    const scaled = 100 + Math.round((correct / total) * 900);
    dom.resultScore.append(document.createTextNode(correct + " / " + total + " correct (" + percent + "%)"));

    const note = document.createElement("small");
    note.textContent = "Scaled to the AWS 100\u20131000 range that is roughly " + scaled
      + ". The real exam passes at " + state.bank.passingScore + ".";
    dom.resultScore.appendChild(note);
  }

  const buckets = new Map();
  reviewed.forEach((question) => {
    const bucket = buckets.get(question.domain) || { asked: 0, correct: 0 };
    bucket.asked += 1;
    const entry = state.progress.get(question.id);
    if (entry && entry.correct) bucket.correct += 1;
    buckets.set(question.domain, bucket);
  });

  dom.resultRows.replaceChildren();
  Array.from(buckets.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .forEach(([domain, bucket]) => {
      const row = document.createElement("tr");
      const rate = Math.round((bucket.correct / bucket.asked) * 100) + "%";
      [domain, String(bucket.correct), String(bucket.asked), rate].forEach((value, i) => {
        const cell = document.createElement(i === 0 ? "th" : "td");
        if (i === 0) cell.scope = "row";
        cell.textContent = value;
        row.appendChild(cell);
      });
      dom.resultRows.appendChild(row);
    });

  const missed = missedIn(reviewed);
  dom.reviewWrong.disabled = missed.length === 0;
  dom.reviewWrong.textContent = missed.length
    ? "Review " + missed.length + " incorrect"
    : "Nothing to review";

  showView("result");
}

function reviewWrong() {
  const missed = missedIn(graded());
  if (!missed.length) return;

  state.session = missed;
  state.cursor = 0;
  state.mode = "study";
  missed.forEach((question) => {
    const entry = entryFor(question);
    entry.revealed = true;
    entry.correct = evaluate(question, entry);
  });

  showView("quiz");
  render();
}

function onKeydown(event) {
  if (dom.quiz.hidden || event.metaKey || event.ctrlKey || event.altKey) return;

  const question = current();
  const index = "abcdefgh".indexOf(event.key.toLowerCase());
  const digit = Number.parseInt(event.key, 10) - 1;
  const pick = index >= 0 ? index : digit;

  if (Number.isInteger(pick) && pick >= 0 && pick < question.options.length) {
    event.preventDefault();
    toggleOption(question.options[pick].key);
    return;
  }

  if (event.key === "ArrowRight") move(1);
  if (event.key === "ArrowLeft") move(-1);
  if (event.key === "Enter" && !dom.reveal.disabled) reveal();
}

async function fetchJson(url) {
  const response = await fetch(url, { credentials: "omit", cache: "no-cache" });
  if (!response.ok) throw new Error("HTTP " + response.status);
  return response.json();
}

async function loadDomains(names) {
  const pending = names.filter((name) => !state.loaded.has(name));

  await Promise.all(pending.map(async (name) => {
    const meta = state.bank.domains.find((domain) => domain.name === name);
    if (!meta) throw new Error("unknown domain " + name);

    const payload = await fetchJson(new URL("questions/" + meta.file, document.baseURI).href);
    if (!payload || !Array.isArray(payload.questions)) throw new Error("malformed " + meta.file);

    const questions = payload.questions
      .filter(isQuestion)
      .map((question) => ({ ...question, domain: name }));

    state.loaded.set(name, questions);
  }));
}

function describeResume(snapshot) {
  const total = snapshot.spec.length;
  const answeredCount = snapshot.progress.filter(([, entry]) => entry.selected.length > 0).length;
  const modeLabel = snapshot.mode === "exam" ? "Exam simulation" : "Study session";
  return modeLabel + " in progress \u2014 question " + (snapshot.cursor + 1) + " of " + total
    + ", " + answeredCount + " answered.";
}

function offerResume() {
  const snapshot = loadProgressSnapshot();
  if (!snapshot) return;

  dom.resumeText.textContent = describeResume(snapshot);
  dom.resumeBanner.hidden = false;

  dom.resumeContinue.addEventListener("click", async () => {
    dom.resumeContinue.disabled = true;
    const ok = await restoreSession(snapshot).catch(() => false);
    dom.resumeBanner.hidden = true;

    if (!ok) {
      clearProgressSnapshot();
      fail("Saved progress no longer matches the question bank. Start a new session.");
      return;
    }

    showView("quiz");
    render();
  }, { once: true });

  dom.resumeDiscard.addEventListener("click", () => {
    clearProgressSnapshot();
    dom.resumeBanner.hidden = true;
  }, { once: true });
}

async function onSubmit(event) {
  event.preventDefault();
  const config = readConfig();

  if (!config.domains.length) {
    fail("Select at least one domain to start a session.");
    return;
  }

  dom.error.hidden = true;
  dom.start.disabled = true;
  dom.start.textContent = "Loading questions\u2026";

  try {
    await loadDomains(config.domains);
  } catch (err) {
    fail("Could not load the questions for that selection.");
    return;
  } finally {
    dom.start.disabled = false;
    dom.start.textContent = "Start session";
  }

  savePrefs(config);
  buildSession(config);

  if (!state.session.length) {
    fail("No questions matched that selection.");
    return;
  }

  showView("quiz");
  render();
}

async function init() {
  let payload;
  try {
    payload = await fetchJson(INDEX_URL);
  } catch (err) {
    fail("Could not load the question bank. Run 'npm run import', then 'npm run dev'.");
    return;
  }

  if (!payload || !Array.isArray(payload.domains) || !payload.domains.length) {
    fail("The question bank index is malformed.");
    return;
  }

  state.bank = payload;
  renderDomains();
  offerResume();

  dom.exportProgress.addEventListener("click", exportProgress);
  dom.importProgress.addEventListener("change", () => {
    const file = dom.importProgress.files[0];
    dom.importProgress.value = "";
    if (file) importProgress(file);
  });

  dom.form.addEventListener("submit", onSubmit);
  dom.prev.addEventListener("click", () => move(-1));
  dom.next.addEventListener("click", () => move(1));
  dom.reveal.addEventListener("click", reveal);
  dom.finish.addEventListener("click", finish);
  dom.reviewWrong.addEventListener("click", reviewWrong);
  dom.restart.addEventListener("click", () => showView("setup"));
  document.addEventListener("keydown", onKeydown);
}

init();
