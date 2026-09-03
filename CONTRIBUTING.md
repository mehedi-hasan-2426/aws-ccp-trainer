# Contributing

Thanks for taking a look. This is a small project, so the process is light.

## Getting set up

```sh
npm run dev      # http://localhost:1313
npm test         # security checks and mutation tests
npm run build    # production build into ./public
```

You need Hugo extended 0.146+ and Node 20+. There is nothing to `npm install`, since the
project has no runtime or build dependencies.

## Changing question content

Do not edit anything in `static/questions/`. Those files are generated and any change
there will be overwritten by the next import, and CI will fail the build as stale.

Explanations come from two files:

- `tools/glossary.mjs` — definitions of AWS services and cloud concepts
- `tools/descriptors.mjs` — phrases that map an option's wording back to a service when
  the option describes it instead of naming it

Add or refine an entry, then run `npm run import` and commit the regenerated bank
alongside your change.

Keep glossary definitions to one or two sentences, written so they read correctly after
an em dash, for example "Amazon EC2 — resizable virtual machines where you...".

## Updating the upstream question source

`UPSTREAM_COMMIT` in `tools/import.mjs` is pinned deliberately. Advancing it is a
reviewable change: bump the SHA, run `npm run import`, and include the resulting diff so
the new content can be inspected. Do not point it at a branch.

## Branching and commits

`main` is the only long-lived branch and is always deployable. Work on a short-lived
branch off `main` and open a pull request; do not commit directly to `main`.

```sh
git switch -c fix/artifact-explanation
```

Prefix branches with `fix/`, `feat/`, `docs/`, `content/` or `chore/`.

Write commit subjects in the imperative mood, under about 50 characters, describing the
change rather than the file touched:

```
Correct the answer key for the S3 durability question
Add Trusted Advisor descriptors so distractors resolve
```

Not `fixed stuff` or `update import.mjs`. Keep commits atomic, one logical change each,
so history stays readable and a bad change is easy to revert.

## Code style

Match what is already there. A few things that are deliberate:

- no runtime dependencies, and no build tooling beyond Hugo and the Node standard library
- comments explain why something is done, not what the next line does
- untrusted text is rendered with `textContent`, never `innerHTML`
- no inline script, style or event handlers, since the CSP forbids them

## Pull requests

- `npm test` must pass
- describe what you changed and why
- one logical change per pull request

If you are fixing a wrong answer key, please link the AWS documentation that supports
the correction.

## Reporting security issues

Do not open a public issue. See [SECURITY.md](SECURITY.md).
