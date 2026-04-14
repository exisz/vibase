/**
 * agentbase types — Board, List, Card, Comment, VendorAdapter
 */

export interface Board {
  id: string;
  name: string;
  url?: string;
  closed?: boolean;
}

export interface List {
  id: string;
  name: string;
}

export interface Card {
  id: string;
  name: string;
  desc: string;
  due: string | null;
  labels: string[];
  pos: number;
  listId: string;
  url?: string;
}

export interface Comment {
  id: string;
  text?: string;
}

export interface Label {
  id: string;
  name: string;
  color: string | null;
}

export interface ManagedRecord {
  key: string;
  recordId: string;
  name: string;
  listId: string;
}

export interface ManagedData {
  board?: {
    id: string;
    name: string;
    url: string;
    vendor: string;
  };
  lists?: Record<string, string>;
  records?: ManagedRecord[];
}

export interface AgentbaseConfig {
  vendor: string;
  trello?: {
    board_id: string;
  };
  markdown?: {
    dir: string;
    format?: string;
  };
}

export interface CardCreateOptions {
  listId: string;
  name: string;
  desc?: string;
  due?: string;
  labels?: string[];
  boardId?: string;
}

export interface CardUpdateOptions {
  name?: string;
  desc?: string;
  due?: string;
  listId?: string;
}

/**
 * Vendor adapter interface — each backend implements this
 */
export interface VendorAdapter {
  boards(): Promise<Board[]>;
  lists(boardId: string): Promise<List[]>;
  labels(boardId: string): Promise<Label[]>;
  cards(boardId: string, listId?: string): Promise<Card[]>;
  card(cardId: string): Promise<Card>;
  cardCreate(opts: CardCreateOptions): Promise<Card>;
  cardUpdate(cardId: string, opts: CardUpdateOptions): Promise<Card>;
  cardMove(cardId: string, listId: string): Promise<Card>;
  cardArchive(cardId: string): Promise<Card>;
  cardComment(cardId: string, text: string): Promise<Comment>;
  snapshot(boardId: string): Promise<string>;
}
