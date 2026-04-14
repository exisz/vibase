/**
 * Card commands — list, show, create, update, move, archive, comment
 */

import type { VendorAdapter } from '../types.js';

export async function cmdCards(adapter: VendorAdapter, boardId: string, listId?: string): Promise<void> {
  const cards = await adapter.cards(boardId, listId);
  const out = cards.map(c => ({
    id: c.id,
    name: c.name,
    desc: c.desc,
    due: c.due,
    labels: c.labels,
    pos: c.pos,
    listId: c.listId,
    url: c.url,
  }));
  console.log(JSON.stringify(out, null, 2));
}

export async function cmdCard(adapter: VendorAdapter, cardId: string): Promise<void> {
  const card = await adapter.card(cardId);
  console.log(JSON.stringify(card, null, 2));
}

export async function cmdCardCreate(
  adapter: VendorAdapter,
  listId: string,
  name: string,
  opts: { desc?: string; due?: string; labels?: string[]; boardId?: string }
): Promise<void> {
  const card = await adapter.cardCreate({
    listId,
    name,
    desc: opts.desc,
    due: opts.due,
    labels: opts.labels,
    boardId: opts.boardId,
  });
  console.log(JSON.stringify({ id: card.id, name: card.name, url: card.url }, null, 2));
}

export async function cmdCardUpdate(
  adapter: VendorAdapter,
  cardId: string,
  opts: { name?: string; desc?: string; due?: string; moveTo?: string }
): Promise<void> {
  const card = await adapter.cardUpdate(cardId, {
    name: opts.name,
    desc: opts.desc,
    due: opts.due,
    listId: opts.moveTo,
  });
  console.log(JSON.stringify({ id: card.id, name: card.name, listId: card.listId }, null, 2));
}

export async function cmdCardMove(adapter: VendorAdapter, cardId: string, listId: string): Promise<void> {
  const card = await adapter.cardMove(cardId, listId);
  console.log(JSON.stringify({ id: card.id, name: card.name, listId: card.listId }, null, 2));
}

export async function cmdCardArchive(adapter: VendorAdapter, cardId: string): Promise<void> {
  const card = await adapter.cardArchive(cardId);
  console.log(JSON.stringify({ id: card.id, name: card.name, archived: true }, null, 2));
}

export async function cmdCardComment(adapter: VendorAdapter, cardId: string, text: string): Promise<void> {
  const comment = await adapter.cardComment(cardId, text);
  console.log(JSON.stringify({ id: comment.id }, null, 2));
}
