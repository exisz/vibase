<div align="center">

```
                           _    __ _ _
   __ _  __ _  ___ _ __ | |_ / _(_) | ___
  / _` |/ _` |/ _ \ '_ \| __| |_| | |/ _ \
 | (_| | (_| |  __/ | | | |_|  _| | |  __/
  \__,_|\__, |\___|_| |_|\__|_| |_|_|\___|
        |___/
```

**Agent File — persistent state for AI agents. Zero dependencies.**

[![npm](https://img.shields.io/npm/v/@exisz/agentfile)](https://www.npmjs.com/package/@exisz/agentfile)
[![License](https://img.shields.io/github/license/exisz/agentfile)](LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/exisz/agentfile/ci.yml)](https://github.com/exisz/agentfile/actions)
[![Node](https://img.shields.io/node/v/agentfile)](https://nodejs.org)

[Installation](#installation) · [Quick Start](#quick-start) · [Commands](#commands) · [Configuration](#configuration) · [Managed Records](#managed-records) · [Contributing](CONTRIBUTING.md)

</div>

---

## Why agentfile?

AI agents interacting with Trello (or any board tool) create **duplicate cards constantly** — they can't remember what they already created. Existing CLIs are vendor-locked, dependency-heavy, or abandoned.

**agentfile** is an agent-first database CLI. One interface, multiple backends, zero vendor lock-in. Its killer feature: **managed records** — a local registry that prevents duplicate creation. Agents upsert by key; agentfile handles the rest.

| | agentfile | [trello-cli](https://github.com/mheap/trello-cli) | [taskell](https://github.com/smallhadroncollider/taskell) |
|---|---|---|---|
| **Language** | TypeScript | TypeScript | Haskell |
| **Runtime deps** | **0** | Many | Many |
| **Multi-vendor** | ✅ Trello + Markdown | Trello only | Trello only |
| **Managed records** | ✅ Built-in dedup | ❌ | ❌ |
| **Agent-safe** | ✅ Upsert by key | ❌ | ❌ |
| **Snapshot** | ✅ Vendor-agnostic YAML | ❌ | ❌ |
| **Install** | `npm i -g @exisz/agentfile` | `npm install` | `brew` / stack |

## Installation

```bash
# npm (recommended)
npm install -g agentfile

# npx (no install)
npx agentfile help

# From source
git clone https://github.com/exisz/agentfile.git
cd agentfile
npm install && npm run build && npm link
```

## Quick Start

### 1. Create a config

```bash
mkdir -p .agentfile
cat > .agentfile/agentfile.yml << 'EOF'
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
agentfile boards

# List cards on configured board
agentfile cards

# Create a card
agentfile card:create -l LIST_ID -n "Fix login bug" -d "Users can't log in on mobile"

# The killer feature — upsert by key (never creates duplicates)
agentfile upsert --key "sprint-review" -l LIST_ID -n "Sprint Review" -d "Updated notes..."
# Run again → updates instead of creating a duplicate
agentfile upsert --key "sprint-review" -l LIST_ID -n "Sprint Review v2" -d "Final notes"
```

### Using Markdown backend (no SaaS needed)

```bash
mkdir -p .agentfile
cat > .agentfile/agentfile.yml << 'EOF'
vendor: markdown
markdown:
  dir: ./boards
EOF

# Create board structure
mkdir -p boards/my-project/{todo,in-progress,done}

# Now use the same commands — data lives in local files
agentfile cards -b my-project
agentfile card:create -b my-project -l "my-project/todo" -n "Build feature X"
```

## Commands

### Board Operations

```bash
agentfile boards                              # List all boards
agentfile lists [-b BOARD]                    # List all lists
agentfile labels [-b BOARD]                   # List labels
```

### Card Operations

```bash
agentfile cards [-b BOARD] [-l LIST]          # List cards
agentfile card CARD_ID                        # Show card details
agentfile card:create -l LIST -n "Name" [-d "Desc"] [--due DATE] [--label LABEL]
agentfile card:update CARD_ID [-n "Name"] [-d "Desc"] [--move-to LIST]
agentfile card:move CARD_ID LIST_ID           # Move card to list
agentfile card:archive CARD_ID                # Archive card
agentfile card:comment CARD_ID "text"         # Add comment
```

### Managed Records (the killer feature)

```bash
# Upsert: create if key doesn't exist, update if it does
agentfile upsert --key "fy2025" -l LIST_ID -n "FY2025 Tax" -d "..."

# View all managed records
agentfile managed

# Sync managed.yaml with remote state
agentfile sync
```

### Export & Migration

```bash
agentfile snapshot [-b BOARD] [-o FILE]       # Export board to YAML
agentfile migrate:from-trello-yaml FILE       # Import from old trello.yaml
```

## Configuration

### Config file: `.agentfile/agentfile.yml`

agentfile searches for config in this order:
1. `.agentfile/agentfile.yml` in current directory
2. Walk up parent directories
3. `~/.agentfile/agentfile.yml` (global fallback)

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

## Managed Records

The managed record registry (`.agentfile/managed.yaml`) is what makes agentfile agent-safe.

```yaml
# Auto-maintained by agentfile
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
1. Agent calls `agentfile upsert --key "my-key" -l LIST -n "Name"`
2. agentfile checks `managed.yaml` for key `"my-key"`
3. **Key exists** → UPDATE the remote record
4. **Key missing** → CREATE new record + register in `managed.yaml`

No more duplicate cards. Ever.

## Vendor Adapters

agentfile uses a vendor adapter pattern. Each backend implements the same interface:

| Vendor | Backend | Auth | Status |
|--------|---------|------|--------|
| `trello` | Trello REST API | `TRELLO_KEY` + `TRELLO_TOKEN` | ✅ Stable |
| `markdown` | Local markdown files | None needed | ✅ Stable |

**Want to add a vendor?** Implement the `VendorAdapter` interface. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Migration from `board` CLI

If you're migrating from the old `board` CLI with `trello.yaml` files:

```bash
agentfile migrate:from-trello-yaml ./trello.yaml
```

This reads the old format and writes `.agentfile/managed.yaml` + `.agentfile/agentfile.yml`.

## License

[MIT](LICENSE) © Exis Z
