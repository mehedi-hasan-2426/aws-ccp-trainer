# Security Policy

## Reporting a vulnerability

Report suspected vulnerabilities through GitHub's private vulnerability reporting
(Security tab, "Report a vulnerability") rather than a public issue. Please include
reproduction steps, affected files or URLs, and the impact you believe it has.

Expect an acknowledgement within 5 working days. Fixes are released as a new commit to
`main` and, where the site is deployed, a redeploy.

## Scope

In scope:

- the static site in `layouts/`, `assets/` and `content/`
- the import and verification tooling in `tools/`
- the generated question bank in `static/questions/`
- deployment configuration in `vercel.json`

Out of scope:

- the upstream question source, which is a separate project with its own maintainers
- exam content accuracy, which is a correctness issue rather than a security issue
- findings that require a compromised browser, extension or operating system

## Security properties

This is a static site. It has no backend, no database, no user accounts, no cookies and
no server-side processing of user input. There is nothing to authenticate to and no
personal data is collected or transmitted. The only client-side storage is a
`localStorage` key holding domain and session preferences.

Controls in place:

- strict Content Security Policy with `default-src 'none'` and no `unsafe-inline`
- Subresource Integrity on every generated script and stylesheet
- all untrusted text rendered through `textContent`, never `innerHTML`
- reference URLs allowlisted by scheme at import time and again in the browser
- upstream question data pinned to a specific commit and verified after checkout
- no runtime third-party packages

## Verification

```sh
npm run verify
```

This runs the automated security checks described in
[docs/threat-model.md](docs/threat-model.md) and fails the build on any violation. It
runs on every push and pull request.
