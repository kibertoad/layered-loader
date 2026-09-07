# Changesets

This folder holds the [changesets](https://changesets.dev) that drive releases.

Every pull request that changes something a consumer of `layered-loader` or
`@layered-loader/sqs` can observe needs a changeset. Add one with:

```bash
pnpm changeset
```

Pick the affected packages, pick `patch` / `minor` / `major`, and describe the change in the
terms a consumer would use — the text lands verbatim in `CHANGELOG.md` and in the GitHub
release notes. Commit the generated file in `.changeset/` alongside your change.

Changes that no consumer can observe (CI, benchmarks, tests, internal refactors that leave the
published output identical) need no changeset, and release nothing when merged.

See `CLAUDE.md` for how the release pipeline consumes these files.
