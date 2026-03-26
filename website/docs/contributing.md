---
sidebar_position: 12
title: Contributing
description: How to contribute to OnlyFence — prerequisites, development setup, testing, and pull request guidelines.
---

# Contributing

OnlyFence is open source under GPLv3. Contributions are welcome — whether it's bug fixes, new chain adapters, documentation improvements, or feature proposals.

## Prerequisites

- **Node.js** >= 25.0.0
- **npm** (comes with Node)
- **Git**

## Getting Started

```bash
git clone https://github.com/seallabs/onlyfence.git
cd onlyfence
npm install
npm run build
```

Verify everything works:

```bash
npm run typecheck
npm run lint
npm run format:check
npm test
```

## Development Workflow

### Branch Naming

| Prefix | Purpose |
|--------|---------|
| `feat/` | New feature |
| `fix/` | Bug fix |
| `refactor/` | Code restructuring |
| `docs/` | Documentation only |
| `test/` | Adding or fixing tests |
| `chore/` | Tooling, CI, deps |

### Making Changes

1. Write your code following the conventions below
2. Add or update tests for any new or changed behavior
3. Run the full check suite before committing:

```bash
npm run format       # Auto-fix formatting
npm run lint         # ESLint (strict TypeScript)
npm run typecheck    # tsc --noEmit
npm test             # Vitest
```

The pre-commit hook runs all of these automatically.

### Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add circuit breaker policy check
fix: correct 24h volume rollover calculation
refactor: extract oracle retry logic into shared util
docs: update CLI reference table
test: add spending limit edge case coverage
chore: bump @mysten/sui to 1.46.0
```

## Code Conventions

### TypeScript

- **Strict mode** — `strict: true`, `noUncheckedIndexedAccess`, `noUnusedLocals`
- **No `any`** — ESLint bans all `no-unsafe-*` patterns
- **Explicit return types** on all exported functions
- **Type imports** — use `import type { Foo }`
- **`const` over `let`** — no `var`
- **Strict boolean expressions** — no truthy/falsy coercion

### Architecture

Follow **SOLID** and **DRY** principles:

- **Policy checks** implement the `PolicyCheck` interface and register in the pipeline
- **Chain adapters** implement `ChainAdapter` — one per blockchain
- **Oracle providers** are swappable behind a shared interface
- Code outside `src/chain/` must be **chain-agnostic**

### Error Handling

- **Never silence errors** — all errors must be surfaced
- Use the `Result<T, E>` pattern where it exists
- No `console.log` outside `src/cli/` — use structured logging

## Testing

Tests live in `src/__tests__/` and use [Vitest](https://vitest.dev/).

```bash
npm test              # Run all tests once
npm run test:watch    # Watch mode
```

## Pull Requests

1. One concern per PR — don't mix features with unrelated refactors
2. Keep PRs small when possible
3. Fill out the PR description with what changed and why
4. All CI checks must pass before merge
5. Squash merge is the default strategy

## Security

If you discover a security vulnerability, **do not open a public issue**. See the [Security](./security) page for responsible disclosure instructions.

## License

By contributing, you agree that your contributions will be licensed under the [GNU General Public License v3.0](https://github.com/seallabs/onlyfence/blob/main/LICENSE).
