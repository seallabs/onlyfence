# Contributing to OnlyFence

Thanks for your interest in contributing to OnlyFence! This guide covers everything you need to get started.

## Prerequisites

- **Node.js** >= 24.0.0
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

| Prefix     | Purpose                |
| ---------- | ---------------------- |
| `feat/`    | New feature            |
| `fix/`     | Bug fix                |
| `refactor/`| Code restructuring     |
| `docs/`    | Documentation only     |
| `test/`    | Adding or fixing tests |
| `chore/`   | Tooling, CI, deps      |

```bash
git checkout -b feat/my-feature main
```

### Making Changes

1. Write your code following the conventions below.
2. Add or update tests for any new or changed behavior.
3. Run the full check suite before committing:

```bash
npm run format       # Auto-fix formatting
npm run lint         # ESLint (strict TypeScript)
npm run typecheck    # tsc --noEmit
npm test             # Vitest
```

The pre-commit hook runs all of these automatically, so your commit will be rejected if any check fails.

### Committing

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

- **Strict mode** — `tsconfig.json` enforces `strict: true`, `noUncheckedIndexedAccess`, `noUnusedLocals`.
- **No `any`** — the ESLint config bans all `no-unsafe-*` patterns. Use proper types or generics.
- **Explicit return types** — required on all exported functions and module boundaries.
- **Type imports** — use `import type { Foo }` or `import { type Foo }` (enforced by ESLint).
- **`const` over `let`** — prefer `const`. No `var`.
- **Strict boolean expressions** — no truthy/falsy coercion. Use explicit checks.

### Architecture

Follow **SOLID** and **DRY** principles. The codebase is designed for extensibility:

- **Policy checks** implement the `PolicyCheck` interface and register in the pipeline.
- **Chain adapters** implement `ChainAdapter` — one per blockchain.
- **Oracle providers** are swappable behind a shared interface.

When adding new functionality, implement against an interface and register it. Do not modify existing checks or adapters to add unrelated behavior.

### Error Handling

- **Never silence errors.** All errors must be surfaced — either handled explicitly or propagated.
- Use the `Result<T, E>` pattern where it exists in the codebase.
- No `console.log` outside `src/cli/` — use the structured logger (`pino`).

### File Organization

```
src/
├── cli/          # Command parser and subcommands
├── tui/          # Terminal UI (React/Ink)
├── policy/       # Policy engine, check interface, registry
├── core/         # Transaction pipeline, action types
├── chain/        # Chain adapters (Sui, future EVM/Solana)
├── oracle/       # Price oracle providers
├── wallet/       # BIP-39, key derivation, encrypted keystores
├── db/           # SQLite database, trade log, migrations
├── config/       # TOML config loading and validation
├── logger/       # Structured logging with sensitive data filtering
├── telemetry/    # Sentry integration
├── types/        # Core type definitions
├── utils/        # Shared utilities
└── __tests__/    # All test files
```

Place new files in the appropriate directory. If a new directory is needed, discuss it in the PR.

## Testing

We use [Vitest](https://vitest.dev/). Tests live in `src/__tests__/`.

```bash
npm test              # Run all tests once
npm run test:watch    # Watch mode
```

- Every new feature or bug fix should include tests.
- Test file names should match the module they test: `foo.ts` -> `foo.test.ts`.
- Use descriptive test names: `it('rejects trade when 24h volume exceeds limit')`.

## Pull Requests

1. **One concern per PR.** Don't mix a feature with an unrelated refactor.
2. **Keep PRs small** when possible. Smaller diffs get faster, better reviews.
3. **Fill out the PR description** — explain what changed and why. Include a test plan.
4. **All CI checks must pass** before merge.
5. **Squash merge** is the default merge strategy.

### PR Title Format

Follow the same Conventional Commits format:

```
feat: add token denylist policy check
fix: handle zero-balance edge case in swap quote
```

## Security

If you discover a security vulnerability, **do not open a public issue**. See [SECURITY.md](SECURITY.md) for responsible disclosure instructions.

## License

By contributing, you agree that your contributions will be licensed under the [GNU General Public License v3.0](LICENSE).
