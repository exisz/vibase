<div align="center">

```
                        _   _
   __ _  __ _  ___ _ __ | |_| |__   __ _ ___  ___
  / _` |/ _` |/ _ \ '_ \| __| '_ \ / _` / __|/ _ \
 | (_| | (_| |  __/ | | | |_| |_) | (_| \__ \  __/
  \__,_|\__, |\___|_| |_|\__|_.__/ \__,_|___/\___|
        |___/
```

**Agent Database — persistent state for AI agents. Zero dependencies.**

[![npm](https://img.shields.io/npm/v/@exisz/agentbase)](https://www.npmjs.com/package/@exisz/agentbase)
[![License](https://img.shields.io/github/license/exisz/agentbase)](LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/exisz/agentbase/ci.yml)](https://github.com/exisz/agentbase/actions)
[![Node](https://img.shields.io/node/v/@exisz/agentbase)](https://nodejs.org)

[Installation](#installation) · [Quick Start](#quick-start) · [Commands](#commands) · [Configuration](#configuration) · [Managed Records](#managed-records) · [Contributing](CONTRIBUTING.md)

</div>

---

## Why agentbase?

AI agents interacting with Trello (or any board tool) create **duplicate cards constantly** — they can't remember what they already created. Existing CLIs are vendor-locked, dependency-heavy, or abandoned.

**agentbase** is a database CLI for AI agents. One interface, multiple backends, zero vendor lock-in. Its killer feature: **managed records** — a local registry that prevents duplicate creation. Agents upsert by key; agentbase handles the rest.

| | agentbase | [trello-cli](https://github.com/mheap/trello-cli) | [taskell](https://github.com/smallhadroncollider/taskell) |
|---|---|---|---|
| **Language** | TypeScript | TypeScript | Haskell |
| **Runtime deps** | **0** | Many | Many |
| **Multi-vendor** | ✅ Trello + GitHub Projects + Markdown | Trello only | Trello only |
| **Managed records** | ✅ Built-in dedup | ❌ | ❌ |
| **Agent-safe** | ✅ Upsert by key | ❌ | ❌ |
| **Snapshot** | ✅ Vendor-agnostic YAML | ❌ | ❌ |
| **Install** | `npm i -g @exisz/agentbase` | `npm install` | `brew` / stack |

## Installation

```bash
# npm (recommended)
npm install -g @exisz/agentbase

# npx (no install)
npx @exisz/agentbase help

# From source
git clone https://github.com/exisz/agentbase.git
cd agentbase
npm install && npm run build && npm link
```

## Quick Start

### 1. Create a config

```bash
mkdir -p .agentbase
cat > .agentbase/agentbase.yml << 'EOF'
vendor: trello
trello:
  board_id: "your-board-id"
EOF
```

### 2. Set credentials

```bash
export TRELLO_KEY="your-trello-api-key"
export TRELLO_TOKEN="your-trello-token"
```

### 3. Use it

```bash
# List your boards
agentbase boards

# List cards on configured board
agentbase cards

# Create a card
agentbase card:create -l LIST_ID -n "Fix login bug" -d "Users can't log in on mobile"

# The killer feature — upsert by key (never creates duplicates)
agentbase upsert --key "sprint-review" -l LIST_ID -n "Sprint Review" -d "Updated notes..."
# Run again → updates instead of creating a duplicate
agentbase upsert --key "sprint-review" -l LIST_ID -n "Sprint Review v2" -d "Final notes"
```

### Using Markdown backend (no SaaS needed)

```bash
mkdir -p .agentbase
cat > .agentbase/agentbase.yml << 'EOF'
vendor: markdown
markdown:
  dir: ./boards
EOF

# Create board structure
mkdir -p boards/my-project/{todo,in-progress,done}

# Now use the same commands — data lives in local files
agentbase cards -b my-project
agentbase card:create -b my-project -l "my-project/todo" -n "Build feature X"
```

## Commands

### Board Operations

```bash
agentbase boards                              # List all boards
agentbase lists [-b BOARD]                    # List all lists
agentbase labels [-b BOARD]                   # List labels
```

### Card Operations

```bash
agentbase cards [-b BOARD] [-l LIST]          # List cards
agentbase card CARD_ID                        # Show card details
agentbase card:create -l LIST -n "Name" [-d "Desc"] [--due DATE] [--label LABEL]
agentbase card:update CARD_ID [-n "Name"] [-d "Desc"] [--move-to LIST]
agentbase card:move CARD_ID LIST_ID           # Move card to list
agentbase card:archive CARD_ID                # Archive card
agentbase card:comment CARD_ID "text"         # Add comment
```

### Managed Records (the killer feature)

```bash
# Upsert: create if key doesn't exist, update if it does
agentbase upsert --key "fy2025" -l LIST_ID -n "FY2025 Tax" -d "..."

# View all managed records
agentbase managed

# Sync managed.yaml with remote state
agentbase sync
```

### Export & Migration

```bash
agentbase snapshot [-b BOARD] [-o FILE]       # Export board to YAML
agentbase migrate:from-trello-yaml FILE       # Import from old trello.yaml
```

### Data Model Templates (plugins)

agentbase boards declare their **data model** via a pinned `🧬 DATA MODEL: <id>` card.
Templates are pluggable — built-in (`status-pipeline`, `correspondence-versioned`),
user-local (`~/.agentbase/templates/*.yaml`), or npm packages prefixed `agentbase-template-*`.

```bash
agentbase template ls                         # list installed templates
agentbase template info <ID|PATH>             # template details + schema check
agentbase template scaffold <ID> [-o FILE]    # starter YAML for a new template

agentbase model show     [-b BOARD]           # explain board's data model
agentbase model validate [-b BOARD]           # check board against template rules
agentbase model declare  [-b BOARD] -t <ID>   # add the model card to a board
```

Boards without a declaration are assumed `status-pipeline@0` for backward compat.
Authoring a new template? See the convention `board-template-plugins`.

## Configuration

### Config file: `.agentbase/agentbase.yml`

agentbase searches for config in this order:
1. `.agentbase/agentbase.yml` in current directory
2. Walk up parent directories
3. `~/.agentbase/agentbase.yml` (global fallback)

#### Trello vendor

```yaml
vendor: trello
trello:
  board_id: "your-board-id"
```

**Environment variables:**
- `TRELLO_KEY` — Trello API key ([get one here](https://trello.com/power-ups/admin))
- `TRELLO_TOKEN` — Trello API token

#### Markdown vendor

```yaml
vendor: markdown
markdown:
  dir: ./boards    # Directory for board files
```

No API keys needed. Data stored as local markdown files with YAML front matter.

#### GitHub Projects v2 vendor

```yaml
vendor: github-projects
github_projects:
  # Either project_id (node ID) or project_ref ("<owner>/<number>")
  project_id: "PVT_kwHOAkzs9M4BWuDO"
  # Optional: list multiple boards with aliases
  boards:
    - id: "PVT_kwHOAkzs9M4BWuDO"
      name: "reddit-tracking"
      alias: "reddit"
    - id: "gotexis/12"          # owner/number form is auto-resolved
      name: "backlog"
      alias: "backlog"
```

**Auth.** Set `GITHUB_TOKEN` (or `GH_TOKEN`) to a Personal Access Token with the
`project` scope. A fine-grained token needs **"Projects" → Read & Write**;
a classic token needs `repo`, `read:org`, and `project`. If neither env var
is set, agentbase falls back to `gh auth token`.

**Find your project's node ID:**

```bash
gh project list --owner @me            # your user projects
gh project list --owner <org>          # org projects
# the 4th column (PVT_xxx) is the node ID
```

**Concept mapping**

| agentbase  | GitHub Projects v2                            |
|------------|-----------------------------------------------|
| Board      | `ProjectV2`                                   |
| List       | Option of the `Status` single-select field    |
| Card       | `ProjectV2Item` (DraftIssue by default)       |
| `card.due` | `Due` Date field if present, else body footer |
| Comments   | Issue comments (Issue-backed items only)      |
| Checklists | Markdown `- [ ] / - [x]` task lists in body   |

**Limitations**

- **Labels** are Issue-only. DraftIssue items ignore the `--label` flag (with a
  stderr warning). Convert a Draft to a real Issue via the GitHub UI to gain
  labels.
- **Comments** on DraftIssue items are appended to the body under a
  `## Comments` heading instead of using the comments API.
- **Checklists** are stored as markdown task lists under `## Checklist: <name>`
  headings inside the item body. Item IDs are derived from a stable
  `(checklist, position, name)` hash so they survive re-reads. There is no
  programmatic checklist API in v2, so this is the canonical workaround.
- **Archive** uses `archiveProjectV2Item` — the item is hidden from the default
  view but retained.
- **Rate limit**: GitHub allows 5,000 GraphQL points/hour for authenticated
  requests. Each `cards`/`snapshot` call paginates 100 items at a time.

**Required field.** Your project must have a `Status` single-select field —
this is the default for new GitHub Projects. agentbase treats its options as
lists.

## Managed Records

The managed record registry (`.agentbase/managed.yaml`) is what makes agentbase agent-safe.

```yaml
# Auto-maintained by agentbase
board:
  id: "69bdfa32041cfc3a4bc2c7ad"
  name: "My Board"
  url: "https://trello.com/b/..."
  vendor: trello

lists:
  backlog: "list-id-1"
  todo: "list-id-2"
  done: "list-id-3"

records:
  - key: fy2024-2025
    recordId: "card-id-123"
    name: "FY2024-2025 Tax Prep"
    listId: "list-id-2"
```

**How it works:**
1. Agent calls `agentbase upsert --key "my-key" -l LIST -n "Name"`
2. agentbase checks `managed.yaml` for key `"my-key"`
3. **Key exists** → UPDATE the remote record
4. **Key missing** → CREATE new record + register in `managed.yaml`

No more duplicate cards. Ever.

## Vendor Adapters

agentbase uses a vendor adapter pattern. Each backend implements the same interface:

| Vendor | Backend | Auth | Status |
|--------|---------|------|--------|
| `trello` | Trello REST API | `TRELLO_KEY` + `TRELLO_TOKEN` | ✅ Stable |
| `markdown` | Local markdown files | None needed | ✅ Stable |
| `github-projects` | GitHub Projects v2 GraphQL | `GITHUB_TOKEN` w/ `project` scope (or `gh auth`) | ✅ Stable |

### Mixing vendors in one config

You can talk to multiple vendor backends from a single config by setting a
per-board `vendor:` override. The top-level `vendor:` becomes the default; any
board with its own `vendor:` is routed to the matching adapter on demand.

```yaml
vendor: trello                     # default for boards without a vendor: line
trello:
  boards:
    - id: <trello-board-id>
      name: My Trello Board
      alias: tb
      vendor: trello
github_projects:
  boards:
    - id: PVT_xxx                  # ProjectV2 node ID, or owner/number
      name: My GH Project
      alias: ghp
      vendor: github-projects
```

```bash
agentbase lists -b tb       # uses Trello adapter
agentbase lists -b ghp      # uses GitHub Projects adapter — same config
```

**Want to add a vendor?** Implement the `VendorAdapter` interface. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Migration from `board` CLI

If you're migrating from the old `board` CLI with `trello.yaml` files:

```bash
agentbase migrate:from-trello-yaml ./trello.yaml
```

This reads the old format and writes `.agentbase/managed.yaml` + `.agentbase/agentbase.yml`.

## One-shot migration scripts

For cross-vendor migrations (e.g. Trello → GitHub Projects v2), the
`scripts/` directory contains reference one-shots:

- [`scripts/migrate-rffi-trello-to-gh.ts`](scripts/migrate-rffi-trello-to-gh.ts)
  — migrates a **correspondence-versioned** Trello board (Library cards as
  canonical + per-round reference cards linking back) to a GH Project where
  the round axis lives in custom fields rather than lists. Runs dry-run by
  default; pass `--apply` to write. Use it as a template for similar
  vendor-to-vendor migrations:

  ```bash
  npx tsx scripts/migrate-rffi-trello-to-gh.ts            # dry-run
  npx tsx scripts/migrate-rffi-trello-to-gh.ts --apply    # write
  ```

  Patterns it demonstrates:
  - Submission-log regex parsing → structured DATE/TEXT fields
  - Multi-list → multi-value text field (`Asked in rounds`)
  - Per-round status flags preserved both as a structured field and as a
    Markdown table at the bottom of the body under `## Original notes` so
    nothing is lost on round-trip.

## License

[MIT](LICENSE) © Exis Z
