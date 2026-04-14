# Contributing to agentbase

Thanks for your interest in contributing! agentbase is a zero-dependency TypeScript CLI, and we'd love your help making it better.

## Development Setup

```bash
# Clone
git clone https://github.com/gotexis/agentbase.git
cd agentbase

# Install dev dependencies
npm install

# Build
npm run build

# Link locally for testing
npm link

# Run
agentbase help
```

## Project Structure

```
src/
├── index.ts                 # CLI entry point + arg parsing
├── types.ts                 # Board, List, Card, VendorAdapter interfaces
├── config.ts                # Config loader (.agentbase/agentbase.yml)
├── managed.ts               # Managed record registry (.agentbase/managed.yaml)
├── yaml.ts                  # Minimal YAML parser/serializer (zero deps)
├── commands/
│   ├── boards.ts            # boards command
│   ├── lists.ts             # lists command
│   ├── labels.ts            # labels command
│   ├── cards.ts             # card CRUD commands
│   ├── upsert.ts            # upsert (the killer feature)
│   ├── managed.ts           # managed records display
│   ├── sync.ts              # sync managed ↔ remote
│   ├── snapshot.ts          # board snapshot export
│   └── migrate.ts           # migration from old formats
└── vendors/
    ├── trello.ts            # Trello REST API adapter
    └── markdown.ts          # Local markdown file adapter
```

## The Golden Rule: Zero Runtime Dependencies

agentbase uses **only Node.js built-ins**. No exceptions. This is the project's core differentiator.

- HTTP? `fetch` (built-in since Node 18)
- YAML? Custom minimal parser in `yaml.ts`
- CLI args? Manual parsing in `index.ts`
- UUID? `crypto.randomUUID()`
- File I/O? `node:fs`

If your contribution adds an `import` from `node_modules` at runtime, it will not be merged.

## Code Style

- **TypeScript strict mode** — all source must pass `tsc --noEmit`
- **Type hints** — explicit types on function signatures
- **No classes where functions suffice** — keep it simple
- **ES2022 target** — use modern syntax
- **Max line length** — 120 characters (soft limit)

## Making Changes

1. **Fork** the repo and create a branch from `main`
2. **Write code** — follow the style guide above
3. **Build** — `npm run build` must succeed
4. **Test** — verify your changes work: `npm test`
5. **Commit** — use clear, descriptive commit messages
6. **Push** and open a **Pull Request**

### Commit Messages

```
feat: add board listing command
fix: handle 401 when token is expired
docs: update configuration examples
refactor: extract vendor adapter interface
```

## Pull Request Guidelines

- Keep PRs focused — one feature or fix per PR
- Update the README if you add a new command or flag
- All CI checks must pass
- Maintainers may request changes — that's normal and healthy

## Adding a New Vendor

1. Create `src/vendors/your-vendor.ts`
2. Implement the `VendorAdapter` interface from `types.ts`
3. Add vendor initialization in `index.ts` `createAdapter()`
4. Update README with configuration docs
5. Add config types if needed

## Reporting Bugs

Use [GitHub Issues](https://github.com/gotexis/agentbase/issues). Include:

- Your Node.js version (`node --version`)
- agentbase version (`agentbase version`)
- Your OS
- Full error output
- Steps to reproduce

## Requesting Features

Use [GitHub Issues](https://github.com/gotexis/agentbase/issues). Explain:

- What problem does this solve?
- How do you currently work around it?
- What would the ideal command look like?

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
