---
name: agentbase
description: "Agent Database — persistent state for AI agents. Multi-vendor board CLI (Trello, Markdown). Zero dependencies."
---

# agentbase — Agent Database CLI Skill

Use `agentbase` CLI for board/card operations. Zero-dependency Node.js CLI supporting Trello and local Markdown backends.

## Setup

```bash
npm install -g agentbase
```

## Configuration

Place `.agentbase/agentbase.yml` in your project root (or `~/.agentbase/`).

### Trello Vendor
```yaml
vendor: trello
trello:
  board_id: "your-board-id"
```

Environment variables required:
```bash
export TRELLO_KEY="your-trello-api-key"
export TRELLO_TOKEN="your-trello-api-token"
```

### Markdown Vendor
```yaml
vendor: markdown
markdown:
  dir: "./boards"    # relative to config location
```

Directory structure:
```
boards/
  board-name/
    list-name/
      card-slug.md   # YAML front matter + description body
```

## Common Patterns

### Listing
```bash
agentbase boards                       # List boards
agentbase lists                        # List all lists on configured board
agentbase lists -b BOARD_ID            # List lists on specific board
agentbase labels                       # List labels
agentbase cards                        # List all cards
agentbase cards -l LIST_ID             # Cards in a specific list
agentbase card CARD_ID                 # Show card details
```

### Creating & Updating
```bash
agentbase card:create -l LIST_ID -n "Card Name" -d "Description" --due 2025-01-01 --label bug
agentbase card:update CARD_ID -n "New Name" -d "New desc" --due 2025-02-01
agentbase card:move CARD_ID LIST_ID    # Move card to list
agentbase card:archive CARD_ID         # Archive card
agentbase card:comment CARD_ID "Comment text"
```

### Upsert (Killer Feature)
```bash
agentbase upsert --key "unique-key" -l LIST_ID -n "Card Name" -d "Description"
```

If the key exists in `.agentbase/managed.yaml` → **UPDATE** the existing card.
If the key doesn't exist → **CREATE** a new card and register it.

This prevents agents from creating duplicate cards on every run.

### Managed Records
```bash
agentbase managed                      # Show all managed records (key → card mapping)
agentbase sync                         # Sync managed.yaml with remote state
```

### Snapshots
```bash
agentbase snapshot                     # Export board to board-snapshot.yaml
agentbase snapshot -o ./my-snapshot.yaml
```

### Migration from Legacy
```bash
agentbase migrate:from-trello-yaml ./trello.yaml
```

Imports records from old `trello.yaml` format into `.agentbase/managed.yaml` and creates a basic config.

## Key Files

| File | Purpose |
|------|---------|
| `.agentbase/agentbase.yml` | Config (vendor, board_id, etc.) |
| `.agentbase/managed.yaml` | Dedup registry (key → remote card ID) |

## Key Features

- **Zero runtime dependencies** — pure Node.js built-ins only
- **Upsert dedup** — prevents duplicate cards across agent runs
- **Multi-vendor** — Trello API + local Markdown files
- **Config walk** — searches current dir → parent dirs → `~/.agentbase/`
- **Snapshot export** — dump entire board to YAML for version control

## Vendor Comparison

| Feature | Trello | Markdown |
|---------|--------|----------|
| Remote API | ✅ | ❌ (local files) |
| Collaboration | ✅ | Via git |
| Offline | ❌ | ✅ |
| Labels | ✅ (color) | ✅ (name only) |
| Comments | ✅ | ✅ (appended to file) |

## ⚠️ Deprecation Notice

- `board` CLI is **deprecated**. Use `agentbase` instead.
- Per-workspace `trello.yaml` files should be migrated: `agentbase migrate:from-trello-yaml ./trello.yaml`
