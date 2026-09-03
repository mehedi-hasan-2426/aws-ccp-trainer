import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DOMAINS, FALLBACK_TOPICS, GLOSSARY } from "./glossary.mjs";
import { DESCRIPTORS } from "./descriptors.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = join(ROOT, ".cache", "upstream");
const SOURCE = join(CACHE, "practice-exam");
const OUTPUT = join(ROOT, "static", "questions");
const UPSTREAM = "https://github.com/kananinirav/AWS-Certified-Cloud-Practitioner-Notes.git";

// Pinned so upstream changes cannot silently alter what this site publishes.
const UPSTREAM_COMMIT = "29b92fa5e53b160745a2d7bb04675cd9efaaa6fe";

const QUESTION_START = /^(\d+)\.\s+(.*)$/;
const OPTION_LINE = /^\s*[-*]\s+([A-Ea-e])[.)]\s+(.*)$/;
const DETAILS_OPEN = /<details/i;
const DETAILS_CLOSE = /<\/details>/i;
const ANSWER_LINE = /correct\s+answer\s*[:\-]\s*(.*)$/i;
const EXPLANATION_LINE = /^\s*explanation\s*[:\-]\s*(.*)$/i;
const BARE_URL = /^<?(https?:\/\/[^\s>]+)>?$/;

function matcher(token) {
  const normalised = token.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return {
    length: normalised.length,
    re: new RegExp(" " + normalised.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?:e?s)? "),
  };
}

const ranked = GLOSSARY.flatMap((entry) =>
  entry.match.map((token) => ({ ...matcher(token), entry }))
).sort((a, b) => b.length - a.length);

const byName = new Map(GLOSSARY.map((entry) => [entry.name, entry]));

const described = DESCRIPTORS.flatMap((descriptor) => {
  const entry = byName.get(descriptor.name);
  if (!entry) throw new Error("descriptor references unknown glossary entry: " + descriptor.name);
  return descriptor.phrases.map((phrase) => ({ ...matcher(phrase), entry }));
}).sort((a, b) => b.length - a.length);

function git(args) {
  return execFileSync("git", ["-C", CACHE, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();
}

function sync() {
  if (!existsSync(join(CACHE, ".git"))) {
    mkdirSync(CACHE, { recursive: true });
    git(["init", "--quiet"]);
    git(["remote", "add", "origin", UPSTREAM]);
  }

  git(["fetch", "--depth", "1", "--quiet", "origin", UPSTREAM_COMMIT]);
  git(["checkout", "--quiet", "--force", UPSTREAM_COMMIT]);

  const head = git(["rev-parse", "HEAD"]);
  if (head !== UPSTREAM_COMMIT) {
    throw new Error("upstream integrity check failed: expected " + UPSTREAM_COMMIT + ", got " + head);
  }
  return head;
}

function parseAnswerKeys(raw) {
  const segment = raw.trim().replace(/[.*_`]/g, "").trim();
  if (/^[A-E]([\s,]+[A-E])*$/i.test(segment)) {
    return [...new Set(segment.toUpperCase().replace(/[^A-E]/g, ""))].map((c) => c.toLowerCase());
  }
  if (/^[A-E]{2,4}$/i.test(segment)) {
    return [...new Set(segment.toUpperCase())].map((c) => c.toLowerCase());
  }
  const first = segment.match(/[A-E]/);
  return first ? [first[0].toLowerCase()] : [];
}

function parseExam(text, examNumber) {
  const lines = text.split(/\r?\n/);
  const questions = [];
  let active = null;
  let inDetails = false;

  const commit = () => {
    if (active && active.options.length >= 2 && active.answer.length) {
      questions.push(active);
    }
    active = null;
  };

  for (const line of lines) {
    if (DETAILS_OPEN.test(line)) {
      inDetails = true;
      continue;
    }
    if (DETAILS_CLOSE.test(line)) {
      inDetails = false;
      continue;
    }

    if (inDetails) {
      if (!active) continue;
      const answer = line.match(ANSWER_LINE);
      if (answer) {
        active.answer = parseAnswerKeys(answer[1]);
        continue;
      }
      const explanation = line.match(EXPLANATION_LINE);
      if (explanation) {
        active.sourceNote.push(explanation[1].trim());
        continue;
      }
      const trimmed = line.trim();
      if (trimmed && !/^<|^\|/.test(trimmed)) active.sourceNote.push(trimmed);
      continue;
    }

    const option = line.match(OPTION_LINE);
    if (option && active) {
      active.options.push({ key: option[1].toLowerCase(), text: option[2].trim() });
      continue;
    }

    const start = line.match(QUESTION_START);
    if (start) {
      commit();
      active = {
        exam: examNumber,
        prompt: start[2].trim(),
        options: [],
        answer: [],
        sourceNote: [],
      };
      continue;
    }

    if (active && !active.options.length && line.trim() && !/^#|^-{3,}|^\s*$/.test(line)) {
      active.prompt += " " + line.trim();
    }
  }

  commit();
  return questions;
}

function lookup(index, text) {
  const haystack = " " + text.toLowerCase().replace(/[^a-z0-9]+/g, " ") + " ";
  for (const { re, entry } of index) {
    if (re.test(haystack)) return entry;
  }
  return null;
}

function findEntry(text) {
  return lookup(ranked, text);
}

function findAny(text) {
  return lookup(ranked, text) || lookup(described, text);
}

const NEGATIVE = /\b(not|except|never|neither)\b/i;

function matchRule(text) {
  const corpus = text.toLowerCase();
  for (const rule of FALLBACK_TOPICS) {
    if (rule.match.some((token) => corpus.includes(token))) {
      return { domain: rule.domain, topic: rule.topic };
    }
  }
  return null;
}

// Distractors routinely name unrelated services, so they are ranked last. Negatively
// worded prompts skip the answer entirely, since there the answer is the odd one out.
function classify(question, correctEntries) {
  const negative = NEGATIVE.test(question.prompt);

  if (correctEntries.length && !negative) {
    return { domain: correctEntries[0].domain, topic: correctEntries[0].topic };
  }

  const promptEntry = findEntry(question.prompt);
  if (promptEntry) return { domain: promptEntry.domain, topic: promptEntry.topic };

  if (correctEntries.length) {
    return { domain: correctEntries[0].domain, topic: correctEntries[0].topic };
  }

  return matchRule(question.prompt)
    || matchRule(question.options.map((o) => o.text).join(" "))
    || { domain: "Cloud Concepts", topic: "General knowledge" };
}

// Upstream markdown is untrusted, so schemes are allowlisted rather than filtered.
function safeReference(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return "";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "";
  if (url.username || url.password) return "";
  return url.href;
}

const OPTION_KEY = /^[a-h]$/;

function isValid(question) {
  const keys = question.options.map((o) => o.key);
  return typeof question.prompt === "string"
    && question.prompt.length > 0 && question.prompt.length <= 2000
    && question.options.length >= 2 && question.options.length <= 8
    && question.options.every((o) =>
      OPTION_KEY.test(o.key)
      && typeof o.text === "string" && o.text.length > 0 && o.text.length <= 800
      && typeof o.note === "string" && o.note.length <= 1000)
    && new Set(keys).size === keys.length
    && question.answer.length >= 1 && question.answer.length <= 4
    && question.answer.every((key) => keys.includes(key))
    && typeof question.explanation === "string" && question.explanation.length <= 4000
    && (question.reference === "" || safeReference(question.reference) === question.reference);
}

function describe(entry) {
  const text = entry.name + " \u2014 " + entry.blurb + ".";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// No option letters: the app re-letters options at runtime, so a baked-in key would lie.
function buildExplanation(question, correct, correctEntries, topic, subject) {
  const parts = [];
  const labels = correct.map((o) => o.text.replace(/\.$/, "")).join("; ");

  if (NEGATIVE.test(question.prompt)) {
    parts.push("The answer is " + labels + ".");
    parts.push("Read the wording carefully, because this question asks for the option that does "
      + "not belong. Every other option is a true statement.");
    if (subject) parts.push(describe(subject));
  } else if (correctEntries.length) {
    parts.push("Correct answer: " + labels + ".");
    parts.push(correctEntries.map(describe).join(" "));
  } else {
    parts.push("Correct answer: " + labels + ".");
  }

  const note = question.sourceNote
    .filter((line) => line && !BARE_URL.test(line))
    .join(" ")
    .trim();
  if (note) parts.push(note);

  parts.push("This item belongs to the " + topic.domain + " domain, under " + topic.topic + ".");
  return parts.join(" ");
}

function enrich(question) {
  const negative = NEGATIVE.test(question.prompt);
  const correct = question.options.filter((o) => question.answer.includes(o.key));
  const correctEntries = [];
  for (const option of correct) {
    const entry = findAny(option.text);
    if (entry && !correctEntries.includes(entry)) correctEntries.push(entry);
  }

  // When the options only describe an outcome, the service under test is named in the prompt.
  const subject = findEntry(question.prompt);
  if (!correctEntries.length && subject && !negative) {
    correctEntries.push(subject);
  }

  const topic = classify(question, correctEntries);

  // A definition is written once per question. Several distractors often resolve to the
  // same service, and repeating the same sentence three times teaches nothing.
  const described = new Set();
  const notes = new Map();

  for (const option of correct) {
    const entry = findAny(option.text);
    if (entry && !described.has(entry)) {
      described.add(entry);
      notes.set(option.key, "Correct. " + describe(entry));
    } else {
      notes.set(option.key, "Correct.");
    }
  }

  for (const option of question.options) {
    if (question.answer.includes(option.key)) continue;
    const entry = findAny(option.text);
    if (negative && entry && entry === subject) {
      notes.set(option.key, "True of " + entry.name + ", so it is not the option this question is asking for.");
    } else if (entry && !described.has(entry)) {
      described.add(entry);
      notes.set(option.key, describe(entry));
    } else {
      notes.set(option.key, "");
    }
  }

  const options = question.options.map((option) => ({
    key: option.key,
    text: option.text,
    note: notes.get(option.key) || "",
  }));

  const reference = question.sourceNote
    .map((line) => line.match(BARE_URL))
    .filter(Boolean)
    .map((match) => safeReference(match[1]))
    .find((url) => url !== "");

  return {
    domain: topic.domain,
    topic: topic.topic,
    prompt: question.prompt,
    options,
    answer: [...question.answer].sort(),
    multi: question.answer.length > 1,
    explanation: buildExplanation(question, correct, correctEntries, topic, subject),
    reference: reference || "",
    source: "practice-exam-" + question.exam,
  };
}

function normalise(prompt) {
  return prompt.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function slug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function write(file, data) {
  const body = JSON.stringify(data) + "\n";
  writeFileSync(join(OUTPUT, file), body, "utf8");
  return Buffer.byteLength(body);
}

function main() {
  const commit = sync();

  const files = readdirSync(SOURCE)
    .filter((name) => /^practice-exam-\d+\.md$/.test(name))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));

  const seen = new Set();
  const parsed = [];
  let dropped = 0;
  let rejected = 0;

  for (const file of files) {
    const examNumber = Number(file.match(/\d+/)[0]);
    const raw = readFileSync(join(SOURCE, file), "utf8");
    for (const question of parseExam(raw, examNumber)) {
      const valid = question.answer.every((key) => question.options.some((o) => o.key === key));
      if (!valid) {
        dropped += 1;
        continue;
      }
      const fingerprint = normalise(question.prompt);
      if (seen.has(fingerprint)) {
        dropped += 1;
        continue;
      }
      seen.add(fingerprint);
      parsed.push(question);
    }
  }

  const questions = parsed
    .map(enrich)
    .filter((question) => {
      if (isValid(question)) return true;
      rejected += 1;
      return false;
    })
    .map((q, i) => ({ id: "q" + String(i + 1).padStart(4, "0"), ...q }));

  rmSync(OUTPUT, { recursive: true, force: true });
  rmSync(OUTPUT + ".json", { force: true });
  mkdirSync(OUTPUT, { recursive: true });

  const manifest = DOMAINS.map((domain) => {
    const file = slug(domain.name) + ".json";
    // The domain is stated once per file and reattached on load rather than on every question.
    const members = questions
      .filter((question) => question.domain === domain.name)
      .map(({ domain: _domain, ...rest }) => rest);
    const bytes = write(file, { domain: domain.name, count: members.length, questions: members });
    return { ...domain, count: members.length, file, bytes };
  });

  const indexBytes = write("index.json", {
    schema: 1,
    exam: "CLF-C02",
    passingScore: 700,
    examQuestionCount: 65,
    generated: new Date().toISOString().slice(0, 10),
    attribution: {
      source: "kananinirav/AWS-Certified-Cloud-Practitioner-Notes",
      url: "https://github.com/kananinirav/AWS-Certified-Cloud-Practitioner-Notes",
      license: "MIT",
      commit,
    },
    count: questions.length,
    domains: manifest.map(({ bytes: _bytes, ...rest }) => rest),
  });

  const kb = (bytes) => (bytes / 1024).toFixed(0).padStart(5) + " KB";
  const unmapped = questions.filter((q) => q.topic === "General knowledge").length;

  console.log("upstream       " + commit);
  console.log("files          " + files.length);
  console.log("imported       " + questions.length);
  console.log("skipped        " + dropped);
  console.log("rejected       " + rejected);
  console.log("unclassified   " + unmapped);
  console.log("");
  console.log("  index.json".padEnd(38) + kb(indexBytes));
  for (const domain of manifest) {
    console.log(("  " + domain.file).padEnd(38) + kb(domain.bytes) + "  " + domain.count + " questions");
  }
  console.log("");
  console.log("written to     " + OUTPUT);
}

main();
