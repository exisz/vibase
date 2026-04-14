/**
 * Markdown vendor adapter — local file-based board database.
 *
 * Structure:
 *   <dir>/
 *     <board-name>/
 *       <list-name>/
 *         <card-slug>.md   (YAML front matter + description body)
 *
 * Front matter:
 *   ---
 *   id: <generated>
 *   name: Card Title
 *   due: null
 *   labels: [bug, urgent]
 *   pos: 100
 *   ---
 *   Description body here...
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync, renameSync, statSync } from 'node:fs';
import { join, basename, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseYaml, toYaml } from '../yaml.js';
import type { VendorAdapter, Board, List, Card, Label, Comment, CardCreateOptions, CardUpdateOptions } from '../types.js';

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'untitled';
}

function parseFrontMatter(content: string): { meta: Record<string, unknown>; body: string } {
  const lines = content.split('\n');
  if (lines[0]?.trim() !== '---') {
    return { meta: {}, body: content };
  }

  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      endIdx = i;
      break;
    }
  }

  if (endIdx === -1) {
    return { meta: {}, body: content };
  }

  const yamlStr = lines.slice(1, endIdx).join('\n');
  const meta = parseYaml(yamlStr);
  const body = lines.slice(endIdx + 1).join('\n').trim();
  return { meta, body };
}

function writeFrontMatter(meta: Record<string, unknown>, body: string): string {
  const yaml = toYaml(meta);
  return `---\n${yaml}\n---\n${body}\n`;
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function listDirs(parent: string): string[] {
  if (!existsSync(parent)) return [];
  return readdirSync(parent)
    .filter(f => {
      try {
        return statSync(join(parent, f)).isDirectory();
      } catch {
        return false;
      }
    })
    .filter(f => !f.startsWith('.'));
}

function listMdFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(f => f.endsWith('.md'));
}

export class MarkdownAdapter implements VendorAdapter {
  private baseDir: string;

  constructor(dir: string) {
    this.baseDir = dir;
  }

  async boards(): Promise<Board[]> {
    const dirs = listDirs(this.baseDir);
    return dirs.map(d => ({
      id: d,
      name: d,
      url: join(this.baseDir, d),
    }));
  }

  async lists(boardId: string): Promise<List[]> {
    const boardDir = join(this.baseDir, boardId);
    const dirs = listDirs(boardDir);
    return dirs.map(d => ({
      id: `${boardId}/${d}`,
      name: d,
    }));
  }

  async labels(_boardId: string): Promise<Label[]> {
    // Collect all unique labels from cards
    const cards = await this.cards(_boardId);
    const labelSet = new Set<string>();
    for (const c of cards) {
      for (const l of c.labels) labelSet.add(l);
    }
    return Array.from(labelSet).map(name => ({
      id: name,
      name,
      color: null,
    }));
  }

  async cards(boardId: string, listId?: string): Promise<Card[]> {
    const boardDir = join(this.baseDir, boardId);
    const result: Card[] = [];

    const listDirNames = listId
      ? [listId.includes('/') ? listId.split('/').pop()! : listId]
      : listDirs(boardDir);

    for (const listName of listDirNames) {
      const listDir = join(boardDir, listName);
      const actualListId = listId || `${boardId}/${listName}`;
      for (const file of listMdFiles(listDir)) {
        const content = readFileSync(join(listDir, file), 'utf-8');
        const { meta, body } = parseFrontMatter(content);
        result.push({
          id: meta.id as string || file.replace('.md', ''),
          name: meta.name as string || file.replace('.md', ''),
          desc: body,
          due: meta.due as string | null || null,
          labels: (meta.labels as string[]) || [],
          pos: meta.pos as number || 0,
          listId: actualListId,
        });
      }
    }

    return result.sort((a, b) => a.pos - b.pos);
  }

  async card(cardId: string): Promise<Card> {
    // Search all lists for the card
    const boards = await this.boards();
    for (const board of boards) {
      const lists = await this.lists(board.id);
      for (const list of lists) {
        const listDir = join(this.baseDir, board.id, list.name);
        for (const file of listMdFiles(listDir)) {
          const content = readFileSync(join(listDir, file), 'utf-8');
          const { meta, body } = parseFrontMatter(content);
          const id = meta.id as string || file.replace('.md', '');
          if (id === cardId) {
            return {
              id,
              name: meta.name as string || file.replace('.md', ''),
              desc: body,
              due: meta.due as string | null || null,
              labels: (meta.labels as string[]) || [],
              pos: meta.pos as number || 0,
              listId: list.id,
            };
          }
        }
      }
    }
    console.error(`Card not found: ${cardId}`);
    process.exit(1);
  }

  async cardCreate(opts: CardCreateOptions): Promise<Card> {
    // listId format: boardId/listName
    const parts = opts.listId.split('/');
    const boardId = parts[0];
    const listName = parts.slice(1).join('/');
    const listDir = join(this.baseDir, boardId, listName);
    ensureDir(listDir);

    const id = randomUUID().slice(0, 8);
    const slug = slugify(opts.name);
    const filename = `${slug}.md`;

    // Calculate pos
    const existingCards = listMdFiles(listDir).length;
    const pos = (existingCards + 1) * 100;

    const meta: Record<string, unknown> = {
      id,
      name: opts.name,
      due: opts.due || null,
      labels: opts.labels || [],
      pos,
    };

    const content = writeFrontMatter(meta, opts.desc || '');
    writeFileSync(join(listDir, filename), content, 'utf-8');

    return {
      id,
      name: opts.name,
      desc: opts.desc || '',
      due: opts.due || null,
      labels: opts.labels || [],
      pos,
      listId: opts.listId,
    };
  }

  async cardUpdate(cardId: string, opts: CardUpdateOptions): Promise<Card> {
    const card = await this.card(cardId);
    const parts = card.listId.split('/');
    const boardId = parts[0];
    const listName = parts.slice(1).join('/');
    const listDir = join(this.baseDir, boardId, listName);

    // Find the file
    let targetFile = '';
    for (const file of listMdFiles(listDir)) {
      const content = readFileSync(join(listDir, file), 'utf-8');
      const { meta } = parseFrontMatter(content);
      if ((meta.id as string) === cardId) {
        targetFile = file;
        break;
      }
    }

    if (!targetFile) {
      console.error(`Card file not found: ${cardId}`);
      process.exit(1);
    }

    const filePath = join(listDir, targetFile);
    const content = readFileSync(filePath, 'utf-8');
    const { meta, body } = parseFrontMatter(content);

    if (opts.name) meta.name = opts.name;
    if (opts.desc !== undefined) {
      const newContent = writeFrontMatter(meta as Record<string, unknown>, opts.desc);
      writeFileSync(filePath, newContent, 'utf-8');
    } else {
      const newContent = writeFrontMatter(meta as Record<string, unknown>, body);
      writeFileSync(filePath, newContent, 'utf-8');
    }
    if (opts.due) meta.due = opts.due;

    // Handle move
    if (opts.listId && opts.listId !== card.listId) {
      const newParts = opts.listId.split('/');
      const newListName = newParts.slice(1).join('/');
      const newListDir = join(this.baseDir, boardId, newListName);
      ensureDir(newListDir);
      renameSync(filePath, join(newListDir, targetFile));
    }

    return {
      ...card,
      name: (opts.name || card.name),
      desc: (opts.desc !== undefined ? opts.desc : card.desc),
      due: (opts.due || card.due),
      listId: (opts.listId || card.listId),
    };
  }

  async cardMove(cardId: string, listId: string): Promise<Card> {
    return this.cardUpdate(cardId, { listId });
  }

  async cardArchive(cardId: string): Promise<Card> {
    const card = await this.card(cardId);
    const parts = card.listId.split('/');
    const boardId = parts[0];
    const listName = parts.slice(1).join('/');
    const listDir = join(this.baseDir, boardId, listName);

    // Find and delete the file
    for (const file of listMdFiles(listDir)) {
      const content = readFileSync(join(listDir, file), 'utf-8');
      const { meta } = parseFrontMatter(content);
      if ((meta.id as string) === cardId) {
        // Move to .archive subdirectory
        const archiveDir = join(listDir, '.archive');
        ensureDir(archiveDir);
        renameSync(join(listDir, file), join(archiveDir, file));
        break;
      }
    }

    return card;
  }

  async cardComment(cardId: string, text: string): Promise<Comment> {
    const card = await this.card(cardId);
    const parts = card.listId.split('/');
    const boardId = parts[0];
    const listName = parts.slice(1).join('/');
    const listDir = join(this.baseDir, boardId, listName);

    // Find the file and append comment
    for (const file of listMdFiles(listDir)) {
      const content = readFileSync(join(listDir, file), 'utf-8');
      const { meta } = parseFrontMatter(content);
      if ((meta.id as string) === cardId) {
        const timestamp = new Date().toISOString();
        const comment = `\n\n---\n**Comment** (${timestamp}):\n${text}`;
        writeFileSync(join(listDir, file), content + comment, 'utf-8');
        break;
      }
    }

    return { id: randomUUID().slice(0, 8), text };
  }

  async snapshot(boardId: string): Promise<string> {
    const lists = await this.lists(boardId);
    const now = new Date().toISOString();
    const lines: string[] = [
      `# Board: ${boardId}`,
      `# Vendor: markdown`,
      `# Updated: ${now}`,
      '',
      'lists:',
    ];

    for (const lst of lists) {
      lines.push(`  - id: "${lst.id}"`);
      lines.push(`    name: "${lst.name}"`);
      const cards = await this.cards(boardId, lst.id);
      if (cards.length > 0) {
        lines.push('    cards:');
        for (const c of cards) {
          lines.push(`      - id: "${c.id}"`);
          lines.push(`        name: "${c.name.replace(/"/g, '\\"')}"`);
          if (c.desc && c.desc.includes('\n')) {
            lines.push('        desc: |');
            for (const dl of c.desc.split('\n')) {
              lines.push(`          ${dl}`);
            }
          } else {
            lines.push(`        desc: "${(c.desc || '').replace(/"/g, '\\"')}"`);
          }
          lines.push(`        due: ${JSON.stringify(c.due)}`);
          lines.push(`        labels: ${JSON.stringify(c.labels)}`);
          lines.push(`        pos: ${c.pos}`);
        }
      } else {
        lines.push('    cards: []');
      }
    }

    return lines.join('\n') + '\n';
  }
}
