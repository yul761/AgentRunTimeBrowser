# agentability-audit Release Checklist

Use this checklist before publishing `agentability-audit`.

1. Run package checks.

```bash
pnpm --filter agentability-audit typecheck
pnpm --filter agentability-audit test
pnpm --filter agentability-audit build
pnpm --filter agentability-audit pack:dry
```

2. Run the workspace checks.

```bash
pnpm typecheck
pnpm test
pnpm build
```

3. Verify clean install behavior in a temporary project.

```bash
mkdir -p /tmp/agentability-release-smoke
cd /tmp/agentability-release-smoke
npm init -y
npm install /path/to/agentability-audit-0.1.0.tgz playwright
npx playwright install chromium
npx agentability rules
npx agentability audit ./fixture.html --task page --artifact-dir reports
```

4. Review package contents and size.

```bash
cd packages/audit
npm pack --dry-run
```

5. Review scoring and rule changes.

- Update `packages/audit/CHANGELOG.md` for any added, removed, or reweighted rules.
- Note score model changes when `metadata.scoreModelVersion` changes.
- Confirm sample reports still render with `agentability report`.

6. Publish with provenance when npm project settings are ready.

```bash
npm publish --provenance --access public
```
