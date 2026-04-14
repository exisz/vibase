/**
 * Trello vendor adapter — port from the Python `board` CLI.
 * Uses Node.js native fetch (>=18). Auth via TRELLO_KEY + TRELLO_TOKEN env vars.
 */

import type { VendorAdapter, Board, List, Card, Label, Comment, CardCreateOptions, CardUpdateOptions } from '../types.js';

const BASE = 'https://api.trello.com/1';

function getCreds(): { key: string; token: string } {
  const key = process.env.TRELLO_KEY;
  const token = process.env.TRELLO_TOKEN;
  if (!key || !token) {
    console.error('Error: TRELLO_KEY and TRELLO_TOKEN environment variables required.');
    process.exit(1);
  }
  return { key, token };
}

async function api(method: string, path: string, params?: Record<string, string>, body?: Record<string, string>): Promise<unknown> {
  const { key, token } = getCreds();
  const p = new URLSearchParams({ key, token });
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      p.set(k, v);
    }
  }

  let url: string;
  let fetchBody: string | undefined;
  const headers: Record<string, string> = {};

  if (method === 'GET') {
    url = `${BASE}${path}?${p.toString()}`;
  } else if (method === 'POST' || method === 'PUT') {
    url = `${BASE}${path}`;
    if (body) {
      for (const [k, v] of Object.entries(body)) {
        p.set(k, v);
      }
    }
    fetchBody = p.toString();
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  } else {
    // DELETE
    url = `${BASE}${path}?${p.toString()}`;
  }

  const resp = await fetch(url, {
    method,
    headers,
    body: fetchBody,
  });

  if (!resp.ok) {
    const text = await resp.text();
    console.error(`HTTP ${resp.status}: ${text}`);
    process.exit(1);
  }

  return resp.json();
}

function escapeYaml(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export class TrelloAdapter implements VendorAdapter {
  async boards(): Promise<Board[]> {
    const data = await api('GET', '/members/me/boards', { fields: 'id,name,url,closed' }) as Array<Record<string, unknown>>;
    return data.map(b => ({
      id: b.id as string,
      name: b.name as string,
      url: b.url as string,
      closed: b.closed as boolean,
    }));
  }

  async lists(boardId: string): Promise<List[]> {
    const data = await api('GET', `/boards/${boardId}/lists`, { fields: 'id,name' }) as Array<Record<string, unknown>>;
    return data.map(l => ({
      id: l.id as string,
      name: l.name as string,
    }));
  }

  async labels(boardId: string): Promise<Label[]> {
    const data = await api('GET', `/boards/${boardId}/labels`) as Array<Record<string, unknown>>;
    return data.map(l => ({
      id: l.id as string,
      name: (l.name as string) || '',
      color: l.color as string | null,
    }));
  }

  async cards(boardId: string, listId?: string): Promise<Card[]> {
    const params = { fields: 'id,name,desc,due,labels,pos,idList,shortUrl' };
    let data: Array<Record<string, unknown>>;
    if (listId) {
      data = await api('GET', `/lists/${listId}/cards`, params) as Array<Record<string, unknown>>;
    } else {
      data = await api('GET', `/boards/${boardId}/cards`, params) as Array<Record<string, unknown>>;
    }
    return data.map(c => ({
      id: c.id as string,
      name: c.name as string,
      desc: (c.desc as string) || '',
      due: c.due as string | null,
      labels: ((c.labels as Array<Record<string, unknown>>) || [])
        .map(l => l.name as string)
        .filter(Boolean),
      pos: c.pos as number,
      listId: c.idList as string,
      url: c.shortUrl as string,
    }));
  }

  async card(cardId: string): Promise<Card> {
    const c = await api('GET', `/cards/${cardId}`, { fields: 'id,name,desc,due,labels,pos,idList,idBoard,shortUrl' }) as Record<string, unknown>;
    return {
      id: c.id as string,
      name: c.name as string,
      desc: (c.desc as string) || '',
      due: c.due as string | null,
      labels: ((c.labels as Array<Record<string, unknown>>) || [])
        .map(l => l.name as string)
        .filter(Boolean),
      pos: c.pos as number,
      listId: c.idList as string,
      url: c.shortUrl as string,
    };
  }

  async cardCreate(opts: CardCreateOptions): Promise<Card> {
    const body: Record<string, string> = {
      idList: opts.listId,
      name: opts.name,
    };
    if (opts.desc) body.desc = opts.desc;
    if (opts.due) body.due = opts.due;
    if (opts.labels && opts.labels.length > 0 && opts.boardId) {
      // Resolve label names to IDs
      const boardLabels = await this.labels(opts.boardId);
      const labelMap = new Map(boardLabels.map(l => [l.name.toLowerCase(), l.id]));
      const ids = opts.labels
        .map(n => labelMap.get(n.toLowerCase()))
        .filter(Boolean) as string[];
      if (ids.length > 0) body.idLabels = ids.join(',');
    }
    const data = await api('POST', '/cards', undefined, body) as Record<string, unknown>;
    return {
      id: data.id as string,
      name: data.name as string,
      desc: (data.desc as string) || '',
      due: data.due as string | null,
      labels: [],
      pos: data.pos as number,
      listId: data.idList as string,
      url: data.shortUrl as string,
    };
  }

  async cardUpdate(cardId: string, opts: CardUpdateOptions): Promise<Card> {
    const body: Record<string, string> = {};
    if (opts.name) body.name = opts.name;
    if (opts.desc !== undefined) body.desc = opts.desc;
    if (opts.due) body.due = opts.due;
    if (opts.listId) body.idList = opts.listId;
    if (Object.keys(body).length === 0) {
      console.error('Nothing to update');
      process.exit(1);
    }
    const data = await api('PUT', `/cards/${cardId}`, undefined, body) as Record<string, unknown>;
    return {
      id: data.id as string,
      name: data.name as string,
      desc: (data.desc as string) || '',
      due: data.due as string | null,
      labels: [],
      pos: data.pos as number,
      listId: data.idList as string,
    };
  }

  async cardMove(cardId: string, listId: string): Promise<Card> {
    return this.cardUpdate(cardId, { listId });
  }

  async cardArchive(cardId: string): Promise<Card> {
    const data = await api('PUT', `/cards/${cardId}`, undefined, { closed: 'true' }) as Record<string, unknown>;
    return {
      id: data.id as string,
      name: data.name as string,
      desc: '',
      due: null,
      labels: [],
      pos: 0,
      listId: data.idList as string,
    };
  }

  async cardComment(cardId: string, text: string): Promise<Comment> {
    const data = await api('POST', `/cards/${cardId}/actions/comments`, undefined, { text }) as Record<string, unknown>;
    return { id: data.id as string };
  }

  async snapshot(boardId: string): Promise<string> {
    const board = await api('GET', `/boards/${boardId}`, { fields: 'name' }) as Record<string, unknown>;
    const lists = await this.lists(boardId);
    const allCards = await this.cards(boardId);

    const cardsByList = new Map<string, Card[]>();
    for (const c of allCards) {
      const list = cardsByList.get(c.listId) || [];
      list.push(c);
      cardsByList.set(c.listId, list);
    }

    const now = new Date().toISOString();
    const lines: string[] = [
      `# Board: ${board.name as string}`,
      `# ID: ${boardId}`,
      `# Updated: ${now}`,
      '',
      'lists:',
    ];

    for (const lst of lists) {
      lines.push(`  - id: "${lst.id}"`);
      lines.push(`    name: "${escapeYaml(lst.name)}"`);
      const listCards = (cardsByList.get(lst.id) || []).sort((a, b) => a.pos - b.pos);
      if (listCards.length > 0) {
        lines.push('    cards:');
        for (const c of listCards) {
          lines.push(`      - id: "${c.id}"`);
          lines.push(`        name: "${escapeYaml(c.name)}"`);
          if (c.desc && c.desc.includes('\n')) {
            lines.push('        desc: |');
            for (const dl of c.desc.split('\n')) {
              lines.push(`          ${dl}`);
            }
          } else {
            lines.push(`        desc: "${escapeYaml(c.desc || '')}"`);
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
