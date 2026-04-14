---
name: agentfile
description: "Agent File — persistent state for AI agents. Multi-vendor board CLI (Trello, Markdown). Zero dependencies."
---

# agentfile — Agent File CLI Skill

Use `agentfile` CLI for board/card operations. Zero-dependency Node.js CLI supporting Trello and local Markdown backends.

## Setup

```bash
npm install -g agentfile
```

## Configuration

Place `.agentfile/agentfile.yml` in your project root (or `~/.agentfile/`).

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
agentfile boards                       # List boards
agentfile lists                        # List all lists on configured board
agentfile lists -b BOARD_ID            # List lists on specific board
agentfile labels                       # List labels
agentfile cards                        # List all cards
agentfile cards -l LIST_ID             # Cards in a specific list
agentfile card CARD_ID                 # Show card details
```

### Creating & Updating
```bash
agentfile card:create -l LIST_ID -n "Card Name" -d "Description" --due 2025-01-01 --label bug
agentfile card:update CARD_ID -n "New Name" -d "New desc" --due 2025-02-01
agentfile card:move CARD_ID LIST_ID    # Move card to list
agentfile card:archive CARD_ID         # Archive card
agentfile card:comment CARD_ID "Comment text"
```

### Upsert (Killer Feature)
```bash
agentfile upsert --key "unique-key" -l LIST_ID -n "Card Name" -d "Description"
```

If the key exists in `.agentfile/managed.yaml` → **UPDATE** the existing card.
If the key doesn't exist → **CREATE** a new card and register it.

This prevents agents from creating duplicate cards on every run.

### Managed Records
```bash
agentfile managed                      # Show all managed records (key → card mapping)
agentfile sync                         # Sync managed.yaml with remote state
```

### Snapshots
```bash
agentfile snapshot                     # Export board to board-snapshot.yaml
agentfile snapshot -o ./my-snapshot.yaml
```

### Migration from Legacy
```bash
agentfile migrate:from-trello-yaml ./trello.yaml
```

Imports records from old `trello.yaml` format into `.agentfile/managed.yaml` and creates a basic config.

## Key Files

| File | Purpose |
|------|---------|
| `.agentfile/agentfile.yml` | Config (vendor, board_id, etc.) |
| `.agentfile/managed.yaml` | Dedup registry (key → remote card ID) |

## Key Features

- **Zero runtime dependencies** — pure Node.js built-ins only
- **Upsert dedup** — prevents duplicate cards across agent runs
- **Multi-vendor** — Trello API + local Markdown files
- **Config walk** — searches current dir → parent dirs → `~/.agentfile/`
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

- `board` CLI is **deprecated**. Use `agentfile` instead.
- `agentbase` CLI is **deprecated**. Use `agentfile` instead.
- Per-workspace `trello.yaml` files should be migrated: `agentfile migrate:from-trello-yaml ./trello.yaml`
