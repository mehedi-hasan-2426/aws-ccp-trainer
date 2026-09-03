# CLF-C02 Trainer

**Practice the AWS Certified Cloud Practitioner exam in your browser, with an
explanation behind every option.**

987 questions across the four CLF-C02 domains. Answer, reveal, and see not just which
option was right but what each service in the question actually does. Runs as a static
site with no backend, no accounts and no tracking.

[![CI](https://github.com/mehedi-hasan-2426/aws-ccp-trainer/actions/workflows/ci.yml/badge.svg)](https://github.com/mehedi-hasan-2426/aws-ccp-trainer/actions/workflows/ci.yml)
![License](https://img.shields.io/badge/license-MIT-blue)
![Questions](https://img.shields.io/badge/questions-987-ff9900)
![Hugo](https://img.shields.io/badge/Hugo-0.146%2B-ff4088?logo=hugo&logoColor=white)
![Node](https://img.shields.io/badge/Node-20%2B-5FA04E?logo=nodedotjs&logoColor=white)
![Dependencies](https://img.shields.io/badge/runtime%20dependencies-0-brightgreen)

![The trainer with a revealed solution](docs/screenshot.png)

## Quick start

```sh
git clone https://github.com/mehedi-hasan-2426/aws-ccp-trainer.git
cd aws-ccp-trainer
npm run dev
```

```
Web Server is available at http://localhost:1313/
```

Open the URL, pick your domains, and start. No install step and no dependencies to
fetch, because the question bank is committed and there are no runtime packages.

Requires [Hugo extended](https://gohugo.io/installation/) 0.146+ and Node 20+.

## Features

- **987 questions** covering Cloud Concepts, Security and Compliance, Cloud Technology
  and Services, and Billing, Pricing and Support
- **Explanations for every option**, not just the correct one, so a wrong guess still
  teaches you what the distractor actually does
- **Two modes** — study with instant feedback, or a 65-question scored exam simulation
- **Domain filtering** with per-domain accuracy reporting at the end
- **Review incorrect** replays only the questions you missed
- **Keyboard driven** — `A`-`E` or `1`-`5` to answer, arrows to move, `Enter` to reveal
- **21 KB first paint**, with domain files loaded on demand
- **Zero runtime dependencies** and a strict Content Security Policy

## Project structure

```
assets/            css and js, bundled and fingerprinted by Hugo
content/           site pages
docs/              threat model and screenshot
layouts/           Hugo templates
static/questions/  generated question bank, one file per domain plus an index
tools/             import pipeline and security checks
.github/workflows/ CI
```

## How the question bank is built

The bank is generated, not hand-maintained.

```sh
npm run import
```

This fetches [kananinirav/AWS-Certified-Cloud-Practitioner-Notes][upstream] at a pinned
commit, parses the 23 practice exam files, drops duplicates and malformed entries, then
enriches what remains:

- options are matched against a glossary of AWS services and cloud concepts to attach a
  definition
- each question is assigned a domain and topic from the prompt first, so distractors
  cannot skew the classification
- negatively worded questions ("which is NOT...") are explained in reverse
- a definition is written once per question, so three distractors naming the same
  service do not repeat the same sentence
- explanations never cite option letters, because the app re-letters options at runtime

Upstream supplies answer keys but almost no written explanations. That layer is
generated here. To improve one, extend `tools/glossary.mjs` or `tools/descriptors.mjs`
and re-run the import.

## Deploying

```sh
npm run build    # writes ./public
```

`vercel.json` carries the build command and security headers. Any static host works,
but the site runs under a Content Security Policy that allows no inline script or
style, so apply the equivalent headers wherever you deploy it.

## Security

```sh
npm test
```

Nine checks cover upstream pinning, CSP consistency, security headers, bank schema,
URL schemes, dependencies and secrets. Eight mutation tests then confirm each check
actually fails when violated, so the suite cannot rot into a no-op.

Both run in CI alongside CodeQL and secret scanning, with actions pinned by commit SHA.
See [SECURITY.md](SECURITY.md) for reporting and [docs/threat-model.md](docs/threat-model.md)
for the analysis.

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) — the short
version is that `npm test` must pass, and question content is changed by editing the
glossary and re-running the import rather than by editing generated JSON.

## Licence

MIT, see [LICENSE](LICENSE). Question data derives from an MIT-licensed project; see
[NOTICE](NOTICE) for attribution. Upstream describes its sets as exam dumps, so treat
them as revision material rather than a predictor of the real exam.

Not affiliated with, endorsed by or sponsored by Amazon Web Services.

[upstream]: https://github.com/kananinirav/AWS-Certified-Cloud-Practitioner-Notes
