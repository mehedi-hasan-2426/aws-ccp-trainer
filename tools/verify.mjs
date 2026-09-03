import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BANK = join(ROOT, "static", "questions");

const checks = [];

function check(name, fn) {
  try {
    const detail = fn();
    checks.push({ name, ok: true, detail: detail || "" });
  } catch (err) {
    checks.push({ name, ok: false, detail: err.message });
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function read(...parts) {
  return readFileSync(join(ROOT, ...parts), "utf8");
}

check("required governance files exist", () => {
  const required = ["LICENSE", "NOTICE", "SECURITY.md", "CONTRIBUTING.md", "docs/threat-model.md"];
  for (const file of required) {
    const path = join(ROOT, file);
    assert(existsSync(path), "missing " + file);
    assert(readFileSync(path, "utf8").trim().length > 200, file + " is empty or a stub");
  }
  return required.length + " files";
});

check("baseURL is absolute", () => {
  const base = read("hugo.toml").match(/^baseURL\s*=\s*"([^"]+)"/m);
  assert(base, "no baseURL in hugo.toml");
  assert(/^https:\/\/[^/]+\//.test(base[1]),
    "baseURL must be an absolute https URL or canonical links and the sitemap break");
  return base[1];
});

check("upstream source is pinned to a commit", () => {
  const source = read("tools", "import.mjs");
  const pin = source.match(/UPSTREAM_COMMIT\s*=\s*"([0-9a-f]{40})"/);
  assert(pin, "UPSTREAM_COMMIT is not a full 40 character commit SHA");
  assert(!/\bclone\b[^\n]*--branch|checkout[^\n]*(main|master)\b/.test(source),
    "importer must not track a moving branch");
  return pin[1];
});

check("content security policy is consistent", () => {
  const hugo = read("hugo.toml").match(/^csp\s*=\s*"([^"]+)"/m);
  assert(hugo, "no csp defined in hugo.toml");

  const vercel = JSON.parse(read("vercel.json"));
  const headers = vercel.headers.flatMap((rule) => rule.headers);
  const deployed = headers.find((h) => h.key === "Content-Security-Policy");
  assert(deployed, "no Content-Security-Policy header in vercel.json");
  assert(deployed.value === hugo[1] + "; frame-ancestors 'none'",
    "vercel.json CSP has drifted from hugo.toml");

  assert(/default-src 'none'/.test(hugo[1]), "CSP must default to 'none'");
  assert(!/unsafe-inline|unsafe-eval/.test(hugo[1]), "CSP must not allow unsafe-inline or unsafe-eval");
  return hugo[1].slice(0, 40) + "...";
});

check("security headers are present", () => {
  const vercel = JSON.parse(read("vercel.json"));
  const keys = new Set(vercel.headers.flatMap((rule) => rule.headers).map((h) => h.key));
  for (const required of [
    "Content-Security-Policy",
    "X-Content-Type-Options",
    "X-Frame-Options",
    "Referrer-Policy",
    "Strict-Transport-Security",
    "Permissions-Policy",
  ]) {
    assert(keys.has(required), "missing header " + required);
  }
  return keys.size + " headers";
});

check("no inline script or style in templates", () => {
  const dir = join(ROOT, "layouts");
  const walk = (path) => readdirSync(path, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(path, entry.name)) : [join(path, entry.name)]);

  for (const file of walk(dir)) {
    const body = readFileSync(file, "utf8");
    assert(!/<script(?![^>]*\bsrc=)/i.test(body), "inline <script> in " + file);
    assert(!/<style[\s>]/i.test(body), "inline <style> in " + file);
    assert(!/\son[a-z]+\s*=\s*"/i.test(body), "inline event handler in " + file);
  }
  return "clean";
});

check("generated bank passes schema validation", () => {
  const files = readdirSync(BANK).filter((name) => name.endsWith(".json") && name !== "index.json");
  assert(files.length > 0, "no domain files generated");

  let total = 0;
  for (const file of files) {
    const payload = JSON.parse(readFileSync(join(BANK, file), "utf8"));
    assert(Array.isArray(payload.questions), file + " has no questions array");

    for (const q of payload.questions) {
      const keys = q.options.map((o) => o.key);
      assert(/^q\d{4}$/.test(q.id), "bad id in " + file + ": " + q.id);
      assert(typeof q.prompt === "string" && q.prompt.length > 0 && q.prompt.length <= 2000,
        "bad prompt for " + q.id);
      assert(keys.length >= 2 && keys.length <= 8, "bad option count for " + q.id);
      assert(keys.every((k) => /^[a-h]$/.test(k)), "bad option key for " + q.id);
      assert(new Set(keys).size === keys.length, "duplicate option key for " + q.id);
      assert(q.answer.length >= 1 && q.answer.length <= 4, "bad answer count for " + q.id);
      assert(q.answer.every((k) => keys.includes(k)), "answer not in options for " + q.id);
      total += 1;
    }
  }
  return total + " questions";
});

check("every reference url is http or https", () => {
  const files = readdirSync(BANK).filter((name) => name.endsWith(".json"));
  let refs = 0;

  for (const file of files) {
    const payload = JSON.parse(readFileSync(join(BANK, file), "utf8"));
    for (const q of payload.questions || []) {
      if (!q.reference) continue;
      const url = new URL(q.reference);
      assert(url.protocol === "https:" || url.protocol === "http:",
        "unsafe scheme in " + q.id + ": " + url.protocol);
      assert(!url.username && !url.password, "credentials embedded in url for " + q.id);
      refs += 1;
    }
  }
  return refs + " references";
});

check("no runtime dependencies", () => {
  const pkg = JSON.parse(read("package.json"));
  assert(!pkg.dependencies || Object.keys(pkg.dependencies).length === 0,
    "runtime dependencies introduce supply chain risk that is not currently reviewed");
  return "zero third-party packages";
});

check("no committed secrets", () => {
  const patterns = [
    /AKIA[0-9A-Z]{16}/,
    /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /gh[pousr]_[A-Za-z0-9]{20,}/,
    /xox[baprs]-[A-Za-z0-9-]{10,}/,
  ];
  const roots = ["tools", "assets", "layouts", "content"];
  const walk = (path) => readdirSync(path, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(path, entry.name)) : [join(path, entry.name)]);

  for (const dir of roots) {
    for (const file of walk(join(ROOT, dir))) {
      const body = readFileSync(file, "utf8");
      for (const pattern of patterns) {
        assert(!pattern.test(body), "possible secret in " + file);
      }
    }
  }
  return "clean";
});

let failed = 0;
for (const result of checks) {
  if (!result.ok) failed += 1;
  console.log((result.ok ? "  pass  " : "  FAIL  ") + result.name.padEnd(42) + result.detail);
}

console.log("");
console.log(checks.length - failed + "/" + checks.length + " checks passed");

if (failed) process.exit(1);
