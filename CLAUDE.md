# CLAUDE.md

Read [AGENTS.md](AGENTS.md) too.

## Commit identity: no personal email

Every commit in this repository, author and committer, uses the owner's GitHub profile identity:

```bash
git config user.name WilsonHJ
git config user.email 39320700+wilsonhj@users.noreply.github.com
```

- Set both before your first commit in a clone or session, and check with `git config user.email`.
- Never commit with a personal email address, and never write one (or any other personal data) into a file, a commit message or a PR.
- Merges done on github.com are fine: GitHub uses the same noreply address.
- CI enforces this (`scripts/check-commit-identity.mjs`) and fails a pull request that contains a commit with any other email. To catch it before pushing, install the local hook: `git config core.hooksPath scripts/hooks`.
- If a commit already went out with the wrong email, stop and tell the owner. Do not force-push to fix it on your own.
