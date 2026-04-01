# Contributing to Beecork

Thanks for your interest in contributing to Beecork! This guide will help you get started.

## Getting Started

1. Fork the repo and clone it locally
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run the test suite to verify everything works:
   ```bash
   npm test
   ```

## Development Workflow

```bash
npm run build        # Compile TypeScript
npm run dev:daemon   # Run daemon in dev mode (tsx, auto-reload)
npm test             # Run vitest tests
npm run lint         # ESLint checks
```

## Project Structure

- `src/` — TypeScript source
- `dist/` — Compiled JS output (do not edit directly)
- `tests/unit/` — Vitest unit tests
- `templates/` — Templates injected during `beecork setup`

## Making Changes

1. Create a branch from `main`:
   ```bash
   git checkout -b my-feature
   ```
2. Make your changes
3. Add or update tests as needed
4. Run lint and tests:
   ```bash
   npm run lint && npm test
   ```
5. Commit with a clear message describing what and why
6. Open a pull request against `main`

## Pull Request Guidelines

- Keep PRs focused — one feature or fix per PR
- Include tests for new functionality
- Make sure CI passes (lint, test, build)
- Update documentation if your change affects user-facing behavior

## Code Style

- TypeScript strict mode
- ESLint with `typescript-eslint` recommended rules
- `eqeqeq` enforced — always use `===`
- Prefix unused variables with `_`
- Use `broadcastNotify()` for notifications — never couple to a specific channel directly

## Reporting Bugs

Open an issue on GitHub with:
- What you expected to happen
- What actually happened
- Steps to reproduce
- Your environment (OS, Node version, Beecork version)

## Security Issues

Do **not** open a public issue for security vulnerabilities. See [SECURITY.md](SECURITY.md) for responsible disclosure instructions.

## Community

- [Discord](https://discord.gg/wEM9avTzb) — Chat, ask questions, get help
- [Twitter/X](https://x.com/BeecorkAI) — Updates and announcements
- [GitHub Discussions](https://github.com/beecork/beecork/discussions) — Feature ideas, longer-form Q&A

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
