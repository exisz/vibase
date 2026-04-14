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

[![npm](https://img.shields.io/npm/v/agentbase)](https://www.npmjs.com/package/agentbase)
[![License](https://img.shields.io/github/license/gotexis/agentbase)](LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/gotexis/agentbase/ci.yml)](https://github.com/gotexis/agentbase/actions)
[![Node](https://img.shields.io/node/v/agentbase)](https://nodejs.org)

[Installation](#installation) · [Quick Start](#quick-start) · [Commands](#commands) · [Configuration](#configuration) · [Managed Records](#managed-records) · [Contributing](CONTRIBUTING.md)

</div>

---

## Why agentbase?

AI agents interacting with Trello (or any board tool) create **duplicate cards constantly** — they can't remember what they already created. Existing CLIs are vendor-locked, dependency-heavy, or abandoned.

**agentbase** is an agent-first database CLI. One interface, multiple backends, zero vendor lock-in. Its killer feature: **managed records** — a local registry that prevents duplicate creation. Agents upsert by key; agentbase handles the rest.

| | agentbase | [trello-cli](https://github.com/mheap/trello-cli) | [taskell](https://github.com/smallhadroncollider/taskell) |
|---|---|---|---|
| **Language** | TypeScript | TypeScript | Haskell |
| **Runtime deps** | **0** | Many | Many |
| **Multi-vendor** | ✅ Trello + Markdown | Trello only | Trello only |
| **Managed records** | ✅ Built-in dedup | ❌ | ❌ |
| **Agent-safe** | ✅ Upsert by key | ❌ | ❌ |
| **Snapshot** | ✅ Vendor-agnostic YAML | ❌ | ❌ |
| **Install** | `npm i -g agentbase` | `npm install` | `brew` / stack |

## Installation

```bash
# npm (recommended)
npm install -g agentbase

# npx (no install)
npx agentbase help

# From source
git clone https://github.com/gotexis/agentbase.git
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

**Want to add a vendor?** Implement the `VendorAdapter` interface. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Migration from `board` CLI

If you're migrating from the old `board` CLI with `trello.yaml` files:

```bash
agentbase migrate:from-trello-yaml ./trello.yaml
```

This reads the old format and writes `.agentbase/managed.yaml` + `.agentbase/agentbase.yml`.

## License

[MIT](LICENSE) © Exis Z
