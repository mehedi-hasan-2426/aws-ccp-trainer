---
title: "About"
---

## What this is

Nimbus is a practice trainer for the AWS Certified Cloud Practitioner exam (CLF-C02).
Pick the domains you want to drill, answer questions, and reveal a breakdown that
explains the correct option and identifies the services named in each distractor.

Everything runs in the browser. There is no backend, no account and no tracking. Your
domain and session preferences are kept in `localStorage` and never leave the machine.

The source is on [GitHub](https://github.com/mehedi-hasan-2426/aws-ccp-trainer).

## Where the questions come from

Questions and answer keys are imported from
[kananinirav/AWS-Certified-Cloud-Practitioner-Notes](https://github.com/kananinirav/AWS-Certified-Cloud-Practitioner-Notes),
which is published under the MIT licence. That project describes its practice sets as
exam dumps, so treat them as revision material rather than as a predictor of the real
exam.

The upstream data contains questions, options and correct answers, but almost no written
explanations. This project adds that layer: an importer maps every option against a
glossary of AWS services and cloud concepts, then assigns each question to one of the four
CLF-C02 exam domains and generates the explanation text you see when you reveal a solution.

## Regenerating the bank

```
npm run import
```

The importer clones the upstream repository into `.cache/`, parses the markdown exams,
removes duplicates and invalid entries, and writes one file per domain into
`static/questions/` alongside a small `index.json`. The page loads only that index, then
fetches a domain file when a session needs it.

Improving an explanation is normally a matter of adding or refining an entry in
`tools/glossary.mjs` or `tools/descriptors.mjs` and running the import again.

## Disclaimer

This is an independent study project. It is not affiliated with, endorsed by or sponsored
by Amazon Web Services. AWS and related marks belong to Amazon.
