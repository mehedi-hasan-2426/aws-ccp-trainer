import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EXCLUDED = new Set([".git", ".cache", "public", "node_modules"]);

const mutations = [
  ["CSP drift between config and headers", "vercel.json",
    (s) => s.replace("frame-ancestors 'none'", "frame-ancestors 'self'")],
  ["unsafe-inline added to CSP", "hugo.toml",
    (s) => s.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")],
  ["upstream pin replaced with a branch", "tools/import.mjs",
    (s) => s.replace(/UPSTREAM_COMMIT = "[0-9a-f]{40}"/, 'UPSTREAM_COMMIT = "master"')],
  ["security header removed", "vercel.json",
    (s) => s.replace(/\{ "key": "X-Frame-Options"[^}]*\},?\s*/, "")],
  ["inline event handler in a template", "layouts/home.html",
    (s) => s.replace('<button class="btn" type="button" id="prev">',
      '<button class="btn" type="button" id="prev" onclick="go()">')],
  ["javascript: url in the bank", "static/questions/cloud-concepts.json",
    (s) => s.replace(/"reference":"https:\/\/[^"]*"/, '"reference":"javascript:alert(1)"')],
  ["governance file deleted", "SECURITY.md", () => ""],
  ["fake AWS key committed", "tools/glossary.mjs",
    // Split so this fixture does not trip the scanner it is exercising.
    (s) => s + '\nconst leaked = "' + "AKIA" + "IOSFODNN7EXAMPLE" + '";\n'],
];

// Mutations run against a throwaway copy, so an interrupted run cannot leave the working
// tree modified and file watchers are never disturbed.
const sandbox = mkdtempSync(join(tmpdir(), "ccp-verify-"));

try {
  cpSync(ROOT, sandbox, {
    recursive: true,
    filter: (src) => src === ROOT || !EXCLUDED.has(src.slice(ROOT.length + 1).split(sep)[0]),
  });

  let detected = 0;

  for (const [label, file, mutate] of mutations) {
    const path = join(sandbox, file);
    const original = readFileSync(path, "utf8");
    const mutated = mutate(original);

    if (mutated === original) {
      console.log("  SKIP    " + label + " (mutation did not apply)");
      continue;
    }

    writeFileSync(path, mutated, "utf8");

    let caught = false;
    try {
      execFileSync("node", [join(sandbox, "tools", "verify.mjs")], { stdio: "pipe" });
    } catch {
      caught = true;
    } finally {
      writeFileSync(path, original, "utf8");
    }

    if (caught) detected += 1;
    console.log((caught ? "  caught  " : "  MISSED  ") + label);
  }

  console.log("");
  console.log(detected + "/" + mutations.length + " violations detected");
  process.exitCode = detected === mutations.length ? 0 : 1;
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}
