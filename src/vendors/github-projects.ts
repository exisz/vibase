/**
 * GitHub Projects v2 vendor adapter.
 *
 * Maps agentbase concepts to ProjectV2:
 *   Board   = ProjectV2          (referenced by node ID `PVT_xxx` or `<owner>/<number>`)
 *   List    = Status field option (single-select option on the project's "Status" field)
 *   Card    = ProjectV2Item      (DraftIssue by default; can wrap Issue/PR)
 *
 * Auth: GITHUB_TOKEN env var (with `project` scope), or falls back to
 * `gh auth token` if `gh` CLI is installed.
 *
 * GraphQL endpoint: https://api.github.com/graphql
 *
 * Limitations vs. Trello:
 *   - Labels are Issue-only. DraftIssue items have no labels (we no-op + warn).
 *   - Comments are Issue-only. For DraftIssues, we append a "## Comments" section
 *     to the body as a fallback.
 *   - Checklists are parsed from markdown task lists in the body — there is no
 *     programmatic checklist API in v2. checkItem IDs are derived from a stable
 *     hash of (checklistId, position, name) so they survive identical edits.
 *   - cardArchive() calls archiveProjectV2Item — the item is hidden from the
 *     default board view but not deleted. Trello's "closed" semantics differ.
 */

import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import type {
  VendorAdapter,
  Board,
  List,
  Card,
  Label,
  Comment,
  CardCreateOptions,
  CardUpdateOptions,
  Checklist,
  CheckItem,
} from '../types.js';

const GQL_ENDPOINT = 'https://api.github.com/graphql';

// ---------- auth ----------

let _cachedToken: string | null = null;

function getToken(): string {
  if (_cachedToken) return _cachedToken;
  let tok = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!tok) {
    try {
      tok = execSync('gh auth token', { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim();
    } catch {
      // ignore
    }
  }
  if (!tok) {
    console.error(
      'Error: GITHUB_TOKEN env var not set, and `gh auth token` unavailable.\n' +
        'Set GITHUB_TOKEN to a PAT with `project` scope, or run `gh auth login`.'
    );
    process.exit(1);
  }
  _cachedToken = tok;
  return tok;
}

// ---------- GraphQL ----------

interface GqlError {
  message: string;
  type?: string;
  path?: (string | number)[];
}

interface GqlResponse<T> {
  data?: T;
  errors?: GqlError[];
}

async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const token = getToken();
  const resp = await fetch(GQL_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'agentbase-github-projects',
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    console.error(`GitHub GraphQL HTTP ${resp.status}: ${text}`);
    process.exit(1);
  }
  const json = (await resp.json()) as GqlResponse<T>;
  if (json.errors && json.errors.length > 0) {
    const msgs = json.errors.map(e => `[${e.type || 'ERR'}] ${e.message}`).join('\n');
    console.error(`GitHub GraphQL error:\n${msgs}\nQuery: ${query.slice(0, 200)}`);
    process.exit(1);
  }
  if (!json.data) {
    console.error('GitHub GraphQL returned no data');
    process.exit(1);
  }
  return json.data;
}

// ---------- ID resolution ----------

/**
 * Resolve a boardId argument to a ProjectV2 node ID.
 * Accepts:
 *   - PVT_xxx (already a node ID — pass-through)
 *   - <owner>/<number>  e.g. "gotexis/12"
 */
async function resolveProjectId(boardArg: string): Promise<string> {
  if (boardArg.startsWith('PVT_')) return boardArg;
  const m = boardArg.match(/^([^/]+)\/(\d+)$/);
  if (!m) {
    console.error(
      `Invalid GitHub Projects board reference: "${boardArg}". ` +
        `Use a node ID (PVT_xxx) or "<owner>/<projectNumber>".`
    );
    process.exit(1);
  }
  const owner = m[1];
  const number = parseInt(m[2], 10);

  // Try user first, then organization.
  const userQ = `
    query($owner: String!, $number: Int!) {
      user(login: $owner) { projectV2(number: $number) { id } }
    }
  `;
  const userData = await gql<{ user: { projectV2: { id: string } | null } | null }>(userQ, {
    owner,
    number,
  }).catch(() => null);
  if (userData?.user?.projectV2?.id) return userData.user.projectV2.id;

  const orgQ = `
    query($owner: String!, $number: Int!) {
      organization(login: $owner) { projectV2(number: $number) { id } }
    }
  `;
  const orgData = await gql<{ organization: { projectV2: { id: string } | null } | null }>(
    orgQ,
    { owner, number }
  ).catch(() => null);
  if (orgData?.organization?.projectV2?.id) return orgData.organization.projectV2.id;

  console.error(`Could not resolve ProjectV2 for "${boardArg}".`);
  process.exit(1);
}

// ---------- field metadata ----------

interface SingleSelectOption {
  id: string;
  name: string;
}

interface ProjectFields {
  statusFieldId: string | null;
  statusOptions: SingleSelectOption[];
  fieldsByName: Map<string, { id: string; type: string; options?: SingleSelectOption[] }>;
}

const FIELDS_FRAG = `
  ... on ProjectV2SingleSelectField {
    id
    name
    dataType
    options { id name }
  }
  ... on ProjectV2Field {
    id
    name
    dataType
  }
  ... on ProjectV2IterationField {
    id
    name
    dataType
  }
`;

async function fetchProjectFields(projectId: string): Promise<ProjectFields> {
  const q = `
    query($id: ID!) {
      node(id: $id) {
        ... on ProjectV2 {
          fields(first: 50) {
            nodes {
              ${FIELDS_FRAG}
            }
          }
        }
      }
    }
  `;
  type Field = { id: string; name: string; dataType: string; options?: SingleSelectOption[] };
  const data = await gql<{ node: { fields: { nodes: Field[] } } }>(q, { id: projectId });
  const nodes = data.node?.fields?.nodes || [];
  const fieldsByName = new Map<string, { id: string; type: string; options?: SingleSelectOption[] }>();
  let statusFieldId: string | null = null;
  let statusOptions: SingleSelectOption[] = [];
  for (const f of nodes) {
    if (!f || !f.id || !f.name) continue;
    fieldsByName.set(f.name, { id: f.id, type: f.dataType, options: f.options });
    if (f.name === 'Status' && f.dataType === 'SINGLE_SELECT') {
      statusFieldId = f.id;
      statusOptions = f.options || [];
    }
  }
  return { statusFieldId, statusOptions, fieldsByName };
}

// ---------- card mapping ----------

interface RawItemContent {
  __typename?: string;
  id?: string;
  title?: string;
  body?: string;
  url?: string;
  number?: number;
  closed?: boolean;
  labels?: { nodes: Array<{ name: string }> };
  repository?: { nameWithOwner: string };
}

interface RawFieldValue {
  __typename: string;
  field?: { name?: string; id?: string };
  text?: string;
  date?: string;
  name?: string; // single-select option name
  optionId?: string;
}

interface RawItem {
  id: string;
  isArchived: boolean;
  type: string;
  content: RawItemContent | null;
  fieldValues: { nodes: RawFieldValue[] };
}

const ITEM_FRAG = `
  id
  isArchived
  type
  content {
    __typename
    ... on DraftIssue {
      id
      title
      body
    }
    ... on Issue {
      id
      title
      body
      url
      number
      closed
      labels(first: 30) { nodes { name } }
      repository { nameWithOwner }
    }
    ... on PullRequest {
      id
      title
      body
      url
      number
      closed
      labels(first: 30) { nodes { name } }
      repository { nameWithOwner }
    }
  }
  fieldValues(first: 30) {
    nodes {
      __typename
      ... on ProjectV2ItemFieldTextValue {
        text
        field { ... on ProjectV2FieldCommon { id name } }
      }
      ... on ProjectV2ItemFieldDateValue {
        date
        field { ... on ProjectV2FieldCommon { id name } }
      }
      ... on ProjectV2ItemFieldSingleSelectValue {
        name
        optionId
        field { ... on ProjectV2FieldCommon { id name } }
      }
    }
  }
`;

function findStatusOptionId(item: RawItem): string {
  for (const fv of item.fieldValues.nodes || []) {
    if (
      fv.__typename === 'ProjectV2ItemFieldSingleSelectValue' &&
      fv.field?.name === 'Status' &&
      fv.optionId
    ) {
      return fv.optionId;
    }
  }
  return ''; // no status set → empty list
}

function findDateValue(item: RawItem, fieldName: string): string | null {
  for (const fv of item.fieldValues.nodes || []) {
    if (
      fv.__typename === 'ProjectV2ItemFieldDateValue' &&
      fv.field?.name === fieldName &&
      fv.date
    ) {
      return fv.date;
    }
  }
  return null;
}

function rawItemToCard(item: RawItem, projectNumber?: number, projectOwner?: string): Card {
  const c = item.content || {};
  const labels = (c.labels?.nodes || []).map(n => n.name).filter(Boolean);
  // Project URL — best-effort. ProjectV2Item doesn't expose its own UI URL via GraphQL,
  // so we use the issue URL when available; otherwise leave undefined.
  const url = c.url;
  return {
    id: item.id,
    name: c.title || '(untitled)',
    desc: c.body || '',
    due: findDateValue(item, 'Due') || findDateValue(item, 'Due Date'),
    labels,
    pos: 0,
    listId: findStatusOptionId(item),
    url,
  };
}

// ---------- adapter ----------

export class GithubProjectsAdapter implements VendorAdapter {
  /** Cache: boardArg → resolved ProjectV2 node ID */
  private projectIdCache = new Map<string, string>();
  /** Cache: projectId → field metadata */
  private fieldsCache = new Map<string, ProjectFields>();
  /** Cache: itemId → projectId (for mutations that need projectId) */
  private itemProjectCache = new Map<string, string>();

  private async resolveBoardId(boardArg: string): Promise<string> {
    if (this.projectIdCache.has(boardArg)) return this.projectIdCache.get(boardArg)!;
    const id = await resolveProjectId(boardArg);
    this.projectIdCache.set(boardArg, id);
    return id;
  }

  private async getFields(projectId: string): Promise<ProjectFields> {
    if (this.fieldsCache.has(projectId)) return this.fieldsCache.get(projectId)!;
    const fields = await fetchProjectFields(projectId);
    this.fieldsCache.set(projectId, fields);
    return fields;
  }

  private async itemProject(itemId: string): Promise<string> {
    if (this.itemProjectCache.has(itemId)) return this.itemProjectCache.get(itemId)!;
    const q = `
      query($id: ID!) {
        node(id: $id) {
          ... on ProjectV2Item {
            project { id }
          }
        }
      }
    `;
    const data = await gql<{ node: { project: { id: string } } | null }>(q, { id: itemId });
    const pid = data.node?.project?.id;
    if (!pid) {
      console.error(`Could not resolve project for item ${itemId}`);
      process.exit(1);
    }
    this.itemProjectCache.set(itemId, pid);
    return pid;
  }

  // ---- VendorAdapter implementation ----

  async boards(): Promise<Board[]> {
    const q = `
      query {
        viewer {
          login
          projectsV2(first: 50) {
            nodes { id title number url closed }
          }
        }
      }
    `;
    type R = {
      viewer: {
        login: string;
        projectsV2: {
          nodes: Array<{ id: string; title: string; number: number; url: string; closed: boolean }>;
        };
      };
    };
    const data = await gql<R>(q);
    return (data.viewer.projectsV2.nodes || []).map(p => ({
      id: p.id,
      name: p.title,
      url: p.url,
      closed: p.closed,
    }));
  }

  async lists(boardId: string): Promise<List[]> {
    const projectId = await this.resolveBoardId(boardId);
    const fields = await this.getFields(projectId);
    if (!fields.statusFieldId) {
      console.error(
        `Project ${boardId} has no "Status" single-select field. ` +
          `GitHub Projects requires a Status field to act as agentbase "lists".`
      );
      return [];
    }
    return fields.statusOptions.map(o => ({ id: o.id, name: o.name }));
  }

  async labels(boardId: string): Promise<Label[]> {
    // Project labels = labels on the linked repository(ies). For v2, there's no
    // single canonical "project labels" set. We aggregate distinct labels from
    // current items' linked Issues/PRs.
    const projectId = await this.resolveBoardId(boardId);
    const cards = await this.cards(boardId);
    const seen = new Map<string, Label>();
    for (const c of cards) {
      for (const name of c.labels) {
        if (!seen.has(name)) seen.set(name, { id: name, name, color: null });
      }
    }
    void projectId;
    return Array.from(seen.values());
  }

  async cards(boardId: string, listId?: string): Promise<Card[]> {
    const projectId = await this.resolveBoardId(boardId);
    const all: RawItem[] = [];
    let after: string | null = null;
    // Paginate up to 10 pages × 100 = 1000 items (GitHub limit-friendly).
    for (let i = 0; i < 10; i++) {
      const q = `
        query($id: ID!, $after: String) {
          node(id: $id) {
            ... on ProjectV2 {
              items(first: 100, after: $after) {
                pageInfo { hasNextPage endCursor }
                nodes { ${ITEM_FRAG} }
              }
            }
          }
        }
      `;
      type R = {
        node: {
          items: {
            pageInfo: { hasNextPage: boolean; endCursor: string | null };
            nodes: RawItem[];
          };
        };
      };
      const data: R = await gql<R>(q, { id: projectId, after });
      const items = data.node?.items;
      if (!items) break;
      for (const n of items.nodes) {
        if (!n.isArchived) all.push(n);
        this.itemProjectCache.set(n.id, projectId);
      }
      if (!items.pageInfo.hasNextPage) break;
      after = items.pageInfo.endCursor;
    }

    const cards = all.map(it => rawItemToCard(it));
    if (listId) return cards.filter(c => c.listId === listId);
    return cards;
  }

  async card(cardId: string): Promise<Card> {
    const q = `
      query($id: ID!) {
        node(id: $id) {
          ... on ProjectV2Item {
            ${ITEM_FRAG}
            project { id }
          }
        }
      }
    `;
    type R = { node: (RawItem & { project: { id: string } }) | null };
    const data = await gql<R>(q, { id: cardId });
    if (!data.node) {
      console.error(`Item ${cardId} not found`);
      process.exit(1);
    }
    this.itemProjectCache.set(cardId, data.node.project.id);
    return rawItemToCard(data.node);
  }

  async cardCreate(opts: CardCreateOptions): Promise<Card> {
    if (!opts.boardId) {
      console.error('cardCreate requires boardId for github-projects vendor');
      process.exit(1);
    }
    const projectId = await this.resolveBoardId(opts.boardId);

    // Default: create a DraftIssue. To link an existing Issue, callers can
    // pass `desc` starting with "ISSUE_NODE_ID:<id>" — convention TBD; for
    // now we always create DraftIssues.
    const m = `
      mutation($projectId: ID!, $title: String!, $body: String) {
        addProjectV2DraftIssue(input: { projectId: $projectId, title: $title, body: $body }) {
          projectItem { ${ITEM_FRAG} }
        }
      }
    `;
    type R = { addProjectV2DraftIssue: { projectItem: RawItem } };
    const data = await gql<R>(m, {
      projectId,
      title: opts.name,
      body: opts.desc || '',
    });
    const item = data.addProjectV2DraftIssue.projectItem;
    this.itemProjectCache.set(item.id, projectId);

    // Set Status if listId provided
    if (opts.listId) {
      await this.setStatus(projectId, item.id, opts.listId);
    }

    // Set Due date if provided AND a Due field exists
    if (opts.due) {
      await this.setDateField(projectId, item.id, opts.due);
    }

    if (opts.labels && opts.labels.length > 0) {
      console.error(
        `[github-projects] cardCreate: labels ignored for DraftIssue items ` +
          `(labels are Issue-only). Convert to Issue to add labels.`
      );
    }

    // Re-fetch to capture updated field values
    return this.card(item.id);
  }

  async cardUpdate(cardId: string, opts: CardUpdateOptions): Promise<Card> {
    const projectId = await this.itemProject(cardId);
    // Discover content type
    const card = await this.card(cardId);
    const contentTypeQ = `
      query($id: ID!) {
        node(id: $id) {
          ... on ProjectV2Item {
            content {
              __typename
              ... on DraftIssue { id }
              ... on Issue { id }
              ... on PullRequest { id }
            }
          }
        }
      }
    `;
    const ct = await gql<{ node: { content: { __typename: string; id: string } } }>(contentTypeQ, {
      id: cardId,
    });
    const contentType = ct.node.content?.__typename;
    const contentId = ct.node.content?.id;

    if (opts.name !== undefined || opts.desc !== undefined) {
      if (contentType === 'DraftIssue') {
        const m = `
          mutation($id: ID!, $title: String, $body: String) {
            updateProjectV2DraftIssue(input: { draftIssueId: $id, title: $title, body: $body }) {
              draftIssue { id }
            }
          }
        `;
        await gql(m, {
          id: contentId,
          title: opts.name ?? card.name,
          body: opts.desc ?? card.desc,
        });
      } else if (contentType === 'Issue') {
        const m = `
          mutation($id: ID!, $title: String, $body: String) {
            updateIssue(input: { id: $id, title: $title, body: $body }) {
              issue { id }
            }
          }
        `;
        await gql(m, {
          id: contentId,
          title: opts.name ?? card.name,
          body: opts.desc ?? card.desc,
        });
      } else {
        console.error(`[github-projects] cardUpdate: cannot edit content of type ${contentType}`);
      }
    }

    if (opts.listId) {
      await this.setStatus(projectId, cardId, opts.listId);
    }

    if (opts.due) {
      await this.setDateField(projectId, cardId, opts.due);
    }

    return this.card(cardId);
  }

  async cardMove(cardId: string, listId: string): Promise<Card> {
    const projectId = await this.itemProject(cardId);
    await this.setStatus(projectId, cardId, listId);
    return this.card(cardId);
  }

  async cardArchive(cardId: string): Promise<Card> {
    const projectId = await this.itemProject(cardId);
    const m = `
      mutation($projectId: ID!, $itemId: ID!) {
        archiveProjectV2Item(input: { projectId: $projectId, itemId: $itemId }) {
          item { id }
        }
      }
    `;
    await gql(m, { projectId, itemId: cardId });
    // Return a synthetic card (item is archived, fetching it still works).
    return this.card(cardId).catch(() => ({
      id: cardId,
      name: '(archived)',
      desc: '',
      due: null,
      labels: [],
      pos: 0,
      listId: '',
    }));
  }

  async cardComment(cardId: string, text: string): Promise<Comment> {
    const ct = await gql<{
      node: { content: { __typename: string; id: string } };
    }>(
      `query($id: ID!) {
        node(id: $id) {
          ... on ProjectV2Item {
            content {
              __typename
              ... on DraftIssue { id }
              ... on Issue { id }
              ... on PullRequest { id }
            }
          }
        }
      }`,
      { id: cardId }
    );
    const ctype = ct.node.content?.__typename;
    const contentId = ct.node.content?.id;

    if (ctype === 'Issue' || ctype === 'PullRequest') {
      const m = `
        mutation($id: ID!, $body: String!) {
          addComment(input: { subjectId: $id, body: $body }) {
            commentEdge { node { id } }
          }
        }
      `;
      const data = await gql<{ addComment: { commentEdge: { node: { id: string } } } }>(m, {
        id: contentId,
        body: text,
      });
      return { id: data.addComment.commentEdge.node.id };
    }

    // DraftIssue fallback: append to body under a "## Comments" section.
    console.error(
      `[github-projects] cardComment: DraftIssue has no comments API; appending to body.`
    );
    const card = await this.card(cardId);
    const stamp = new Date().toISOString();
    const newBody = appendComment(card.desc, text, stamp);
    await this.cardUpdate(cardId, { desc: newBody });
    return { id: `draft-comment-${stamp}` };
  }

  async snapshot(boardId: string): Promise<string> {
    const projectId = await this.resolveBoardId(boardId);
    const projQ = `query($id: ID!) { node(id: $id) { ... on ProjectV2 { title number url } } }`;
    const proj = await gql<{ node: { title: string; number: number; url: string } }>(projQ, {
      id: projectId,
    });
    const lists = await this.lists(boardId);
    const allCards = await this.cards(boardId);
    const cardsByList = new Map<string, Card[]>();
    for (const c of allCards) {
      const arr = cardsByList.get(c.listId) || [];
      arr.push(c);
      cardsByList.set(c.listId, arr);
    }

    // Fetch checklists per card (parsed from body markdown)
    const checklistsByCard = new Map<string, Checklist[]>();
    for (const c of allCards) {
      const cls = parseChecklistsFromBody(c.id, c.desc);
      if (cls.length > 0) checklistsByCard.set(c.id, cls);
    }

    const now = new Date().toISOString();
    const lines: string[] = [
      `# Board: ${proj.node.title}`,
      `# ID: ${projectId}`,
      `# URL: ${proj.node.url}`,
      `# Updated: ${now}`,
      '',
      'lists:',
    ];
    for (const lst of lists) {
      lines.push(`  - id: "${lst.id}"`);
      lines.push(`    name: "${escapeYaml(lst.name)}"`);
      const listCards = cardsByList.get(lst.id) || [];
      if (listCards.length > 0) {
        lines.push('    cards:');
        for (const c of listCards) {
          lines.push(`      - id: "${c.id}"`);
          lines.push(`        name: "${escapeYaml(c.name)}"`);
          if (c.desc && c.desc.includes('\n')) {
            lines.push('        desc: |');
            for (const dl of c.desc.split('\n')) lines.push(`          ${dl}`);
          } else {
            lines.push(`        desc: "${escapeYaml(c.desc || '')}"`);
          }
          lines.push(`        due: ${JSON.stringify(c.due)}`);
          lines.push(`        labels: ${JSON.stringify(c.labels)}`);
          const cls = checklistsByCard.get(c.id);
          if (cls && cls.length > 0) {
            lines.push('        checklists:');
            for (const cl of cls) {
              lines.push(`          - id: "${cl.id}"`);
              lines.push(`            name: "${escapeYaml(cl.name)}"`);
              if (cl.items.length > 0) {
                lines.push('            items:');
                for (const ci of cl.items) {
                  lines.push(`              - id: "${ci.id}"`);
                  lines.push(`                name: "${escapeYaml(ci.name)}"`);
                  lines.push(`                state: ${ci.state}`);
                }
              } else {
                lines.push('            items: []');
              }
            }
          }
        }
      } else {
        lines.push('    cards: []');
      }
    }
    return lines.join('\n') + '\n';
  }

  // ---- checklists (markdown task lists in body) ----

  async checklists(cardId: string): Promise<Checklist[]> {
    const card = await this.card(cardId);
    return parseChecklistsFromBody(cardId, card.desc);
  }

  async checklistCreate(cardId: string, name: string): Promise<Checklist> {
    const card = await this.card(cardId);
    const newBody = appendChecklistSection(card.desc, name);
    await this.cardUpdate(cardId, { desc: newBody });
    return {
      id: makeChecklistId(cardId, name),
      name,
      cardId,
      items: [],
    };
  }

  async checklistDelete(checklistId: string): Promise<void> {
    const { cardId, name } = parseChecklistId(checklistId);
    const card = await this.card(cardId);
    const newBody = removeChecklistSection(card.desc, name);
    await this.cardUpdate(cardId, { desc: newBody });
  }

  async checkItemAdd(checklistId: string, name: string, checked?: boolean): Promise<CheckItem> {
    const { cardId, name: clName } = parseChecklistId(checklistId);
    const card = await this.card(cardId);
    const { newBody, position } = addItemToChecklistSection(card.desc, clName, name, !!checked);
    await this.cardUpdate(cardId, { desc: newBody });
    return {
      id: makeItemId(checklistId, position, name),
      name,
      state: checked ? 'complete' : 'incomplete',
      pos: position,
    };
  }

  async checkItemUpdate(
    cardId: string,
    checkItemId: string,
    opts: { name?: string; state?: 'complete' | 'incomplete' }
  ): Promise<CheckItem> {
    const card = await this.card(cardId);
    const { newBody, item } = updateItemInBody(card.desc, checkItemId, opts);
    if (!item) {
      console.error(`Checklist item ${checkItemId} not found in card ${cardId}`);
      process.exit(1);
    }
    await this.cardUpdate(cardId, { desc: newBody });
    return item;
  }

  async checkItemDelete(checklistId: string, checkItemId: string): Promise<void> {
    const { cardId } = parseChecklistId(checklistId);
    const card = await this.card(cardId);
    const newBody = deleteItemFromBody(card.desc, checkItemId);
    await this.cardUpdate(cardId, { desc: newBody });
  }

  // ---- private mutation helpers ----

  private async setStatus(projectId: string, itemId: string, optionId: string): Promise<void> {
    const fields = await this.getFields(projectId);
    if (!fields.statusFieldId) {
      console.error(`Project has no Status field; cannot set list.`);
      process.exit(1);
    }
    // Validate option exists
    const opt = fields.statusOptions.find(o => o.id === optionId || o.name === optionId);
    if (!opt) {
      console.error(
        `Status option "${optionId}" not found. Available: ${fields.statusOptions
          .map(o => `${o.name}=${o.id}`)
          .join(', ')}`
      );
      process.exit(1);
    }
    const m = `
      mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
        updateProjectV2ItemFieldValue(input: {
          projectId: $projectId,
          itemId: $itemId,
          fieldId: $fieldId,
          value: { singleSelectOptionId: $optionId }
        }) { projectV2Item { id } }
      }
    `;
    await gql(m, {
      projectId,
      itemId,
      fieldId: fields.statusFieldId,
      optionId: opt.id,
    });
  }

  private async setDateField(projectId: string, itemId: string, isoDate: string): Promise<void> {
    const fields = await this.getFields(projectId);
    const dueField = fields.fieldsByName.get('Due') || fields.fieldsByName.get('Due Date');
    if (!dueField) {
      console.error(
        `[github-projects] No "Due" date field on project; due=${isoDate} stored in body footer instead.`
      );
      // fall back: append "Due: <date>" to body
      const card = await this.card(itemId);
      const footer = `\n\n_Due: ${isoDate}_`;
      const newBody = card.desc.includes('_Due:') ? card.desc : card.desc + footer;
      const ct = await gql<{ node: { content: { __typename: string; id: string } } }>(
        `query($id: ID!) { node(id: $id) { ... on ProjectV2Item { content { __typename ... on DraftIssue { id } ... on Issue { id } } } } }`,
        { id: itemId }
      );
      if (ct.node.content?.__typename === 'DraftIssue') {
        await gql(
          `mutation($id: ID!, $body: String!) {
            updateProjectV2DraftIssue(input: { draftIssueId: $id, body: $body }) { draftIssue { id } }
          }`,
          { id: ct.node.content.id, body: newBody }
        );
      }
      return;
    }
    // Date format: YYYY-MM-DD
    const date = isoDate.length >= 10 ? isoDate.slice(0, 10) : isoDate;
    const m = `
      mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $date: Date!) {
        updateProjectV2ItemFieldValue(input: {
          projectId: $projectId,
          itemId: $itemId,
          fieldId: $fieldId,
          value: { date: $date }
        }) { projectV2Item { id } }
      }
    `;
    await gql(m, { projectId, itemId, fieldId: dueField.id, date });
  }
}

// ---------- helpers ----------

function escapeYaml(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function appendComment(body: string, text: string, stamp: string): string {
  const header = '## Comments';
  const entry = `\n- _${stamp}_ — ${text}`;
  if (body.includes(header)) return body + entry;
  return (body || '') + `\n\n${header}${entry}`;
}

// ---- Markdown task-list parser/mutator ----
//
// Convention:
//   ## Checklist: <Name>
//   - [ ] Item one
//   - [x] Item two
//
// Items belong to the most recent "## Checklist:" heading above them.

function makeChecklistId(cardId: string, name: string): string {
  // Format: gh:<itemNodeId>::<base64name>
  return `gh:${cardId}::${Buffer.from(name).toString('base64')}`;
}

function parseChecklistId(id: string): { cardId: string; name: string } {
  const m = id.match(/^gh:([^:]+)::(.+)$/);
  if (!m) {
    console.error(`Invalid github-projects checklist ID: ${id}`);
    process.exit(1);
  }
  return { cardId: m[1], name: Buffer.from(m[2], 'base64').toString('utf-8') };
}

function makeItemId(checklistId: string, pos: number, name: string): string {
  const hash = createHash('sha1')
    .update(`${checklistId}\n${pos}\n${name}`)
    .digest('hex')
    .slice(0, 12);
  return `ghi:${hash}`;
}

function parseChecklistsFromBody(cardId: string, body: string): Checklist[] {
  const lines = body.split('\n');
  const out: Checklist[] = [];
  let cur: Checklist | null = null;
  let pos = 0;
  for (const line of lines) {
    const headMatch = line.match(/^##\s+Checklist:\s*(.+?)\s*$/);
    if (headMatch) {
      const name = headMatch[1].trim();
      cur = {
        id: makeChecklistId(cardId, name),
        name,
        cardId,
        items: [],
      };
      out.push(cur);
      pos = 0;
      continue;
    }
    const itemMatch = line.match(/^[-*]\s+\[([ xX])\]\s+(.+?)\s*$/);
    if (itemMatch && cur) {
      const checked = itemMatch[1].toLowerCase() === 'x';
      const text = itemMatch[2];
      cur.items.push({
        id: makeItemId(cur.id, pos, text),
        name: text,
        state: checked ? 'complete' : 'incomplete',
        pos,
      });
      pos++;
    }
  }
  return out;
}

function appendChecklistSection(body: string, name: string): string {
  const section = `\n\n## Checklist: ${name}\n`;
  return (body || '') + section;
}

function removeChecklistSection(body: string, name: string): string {
  const lines = body.split('\n');
  const out: string[] = [];
  let skip = false;
  for (const line of lines) {
    const headMatch = line.match(/^##\s+Checklist:\s*(.+?)\s*$/);
    if (headMatch) {
      if (headMatch[1].trim() === name) {
        skip = true;
        continue;
      } else {
        skip = false;
      }
    } else if (line.startsWith('## ') && skip) {
      // entered a new section → stop skipping
      skip = false;
    }
    if (!skip) out.push(line);
  }
  return out.join('\n');
}

function addItemToChecklistSection(
  body: string,
  checklistName: string,
  itemName: string,
  checked: boolean
): { newBody: string; position: number } {
  const lines = body.split('\n');
  const out: string[] = [];
  let inSection = false;
  let lastItemIdx = -1;
  let position = 0;
  let countInSection = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headMatch = line.match(/^##\s+Checklist:\s*(.+?)\s*$/);
    if (headMatch) {
      if (inSection) {
        // leaving previous matching section → insert before next heading
      }
      inSection = headMatch[1].trim() === checklistName;
      if (inSection) lastItemIdx = i;
      out.push(line);
      continue;
    }
    if (inSection && /^[-*]\s+\[[ xX]\]/.test(line)) {
      lastItemIdx = i;
      countInSection++;
    }
    if (inSection && line.startsWith('## ') && !headMatch) {
      // exited the section before adding
      const insertion = `- [${checked ? 'x' : ' '}] ${itemName}`;
      out.push(insertion);
      inSection = false;
      position = countInSection;
    }
    out.push(line);
  }
  if (inSection) {
    // section ran to end of body
    const insertion = `- [${checked ? 'x' : ' '}] ${itemName}`;
    out.push(insertion);
    position = countInSection;
  }
  void lastItemIdx;
  return { newBody: out.join('\n'), position };
}

function updateItemInBody(
  body: string,
  itemId: string,
  opts: { name?: string; state?: 'complete' | 'incomplete' }
): { newBody: string; item: CheckItem | null } {
  const lines = body.split('\n');
  let curChecklistName = '';
  let cardIdGuess = ''; // not needed — itemId carries hash
  let pos = 0;
  let resultItem: CheckItem | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headMatch = line.match(/^##\s+Checklist:\s*(.+?)\s*$/);
    if (headMatch) {
      curChecklistName = headMatch[1].trim();
      pos = 0;
      continue;
    }
    const itemMatch = line.match(/^([-*])\s+\[([ xX])\]\s+(.+?)\s*$/);
    if (itemMatch && curChecklistName) {
      const bullet = itemMatch[1];
      const checked = itemMatch[2].toLowerCase() === 'x';
      const text = itemMatch[3];
      // Reconstruct candidate ID
      // We need cardId here to recompute, but checklistId is gh:<cardId>::<b64name>.
      // Since we don't have cardId in this function, accept any cardId by checking
      // hash prefix only. itemId = ghi:<hash12>; recompute hash with all candidate
      // checklist IDs by re-hashing with name guesses won't work without cardId.
      //
      // Trick: encode the hash search by trying every checklistId prefix we can
      // see in the calling adapter. Caller (checkItemUpdate) always has cardId,
      // so we shift the algorithm: caller can compute the expected hash for each
      // (checklistName, pos, text) using a closure. But we want self-contained
      // helper. Simplest: include cardId via the itemId scheme is not done here,
      // so we accept name+pos+checklistName uniqueness.
      void cardIdGuess;
      void bullet;
      const hash = createHash('sha1')
        .update(`__pending__\n${pos}\n${text}`)
        .digest('hex')
        .slice(0, 12);
      void hash;
      // Actually simplest: the comparator we use below. We'll handle it in the
      // wrapper that knows cardId.
      pos++;
      void checked;
    }
  }
  // The above sketch shows the issue — re-implement with cardId-aware match below.
  return _updateItemInBodyWithMatch(body, itemId, opts) as { newBody: string; item: CheckItem | null };
}

/**
 * Replacement implementation that walks the body and matches items by recomputing
 * the hash for each candidate. Requires the itemId hash to match.
 */
function _updateItemInBodyWithMatch(
  body: string,
  itemId: string,
  opts: { name?: string; state?: 'complete' | 'incomplete' }
): { newBody: string; item: CheckItem | null } {
  // Caller passes itemId = ghi:<hash>. We need to find a line whose hash matches.
  // Hash inputs were `${checklistId}\n${pos}\n${name}` and checklistId =
  // `gh:${cardId}::${b64(checklistName)}`. We don't know cardId here, so this
  // function is called by adapter methods that pass cardId via `_currentCardId`
  // (set on a module-level WeakMap below).
  const cardId = _currentCardId;
  if (!cardId) {
    return { newBody: body, item: null };
  }
  const lines = body.split('\n');
  let curChecklistName = '';
  let curChecklistId = '';
  let pos = 0;
  let foundItem: CheckItem | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headMatch = line.match(/^##\s+Checklist:\s*(.+?)\s*$/);
    if (headMatch) {
      curChecklistName = headMatch[1].trim();
      curChecklistId = makeChecklistId(cardId, curChecklistName);
      pos = 0;
      continue;
    }
    const itemMatch = line.match(/^([-*])\s+\[([ xX])\]\s+(.+?)\s*$/);
    if (itemMatch && curChecklistName) {
      const bullet = itemMatch[1];
      const checked = itemMatch[2].toLowerCase() === 'x';
      const text = itemMatch[3];
      const candidateId = makeItemId(curChecklistId, pos, text);
      if (candidateId === itemId) {
        const newName = opts.name ?? text;
        const newChecked = opts.state ? opts.state === 'complete' : checked;
        lines[i] = `${bullet} [${newChecked ? 'x' : ' '}] ${newName}`;
        foundItem = {
          id: makeItemId(curChecklistId, pos, newName),
          name: newName,
          state: newChecked ? 'complete' : 'incomplete',
          pos,
        };
        // continue counting positions in case future items share name
      }
      pos++;
    }
  }
  return { newBody: lines.join('\n'), item: foundItem };
}

function deleteItemFromBody(body: string, itemId: string): string {
  const cardId = _currentCardId;
  if (!cardId) return body;
  const lines = body.split('\n');
  let curChecklistName = '';
  let curChecklistId = '';
  let pos = 0;
  const out: string[] = [];
  for (const line of lines) {
    const headMatch = line.match(/^##\s+Checklist:\s*(.+?)\s*$/);
    if (headMatch) {
      curChecklistName = headMatch[1].trim();
      curChecklistId = makeChecklistId(cardId, curChecklistName);
      pos = 0;
      out.push(line);
      continue;
    }
    const itemMatch = line.match(/^[-*]\s+\[([ xX])\]\s+(.+?)\s*$/);
    if (itemMatch && curChecklistName) {
      const text = itemMatch[2];
      const candidateId = makeItemId(curChecklistId, pos, text);
      pos++;
      if (candidateId === itemId) continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

// Module-scoped current card context for the body-mutation helpers.
// Set by the adapter before calling helpers that need to recompute checklist IDs.
let _currentCardId: string | null = null;

/**
 * Patch the GithubProjectsAdapter prototype to set/clear _currentCardId around
 * checklist operations. This keeps the helpers pure-ish while letting them
 * compute the correct checklist hash without threading cardId through every arg.
 */
const origCheckItemUpdate = GithubProjectsAdapter.prototype.checkItemUpdate;
GithubProjectsAdapter.prototype.checkItemUpdate = async function (
  this: GithubProjectsAdapter,
  cardId: string,
  checkItemId: string,
  opts: { name?: string; state?: 'complete' | 'incomplete' }
) {
  _currentCardId = cardId;
  try {
    return await origCheckItemUpdate.call(this, cardId, checkItemId, opts);
  } finally {
    _currentCardId = null;
  }
};

const origCheckItemDelete = GithubProjectsAdapter.prototype.checkItemDelete;
GithubProjectsAdapter.prototype.checkItemDelete = async function (
  this: GithubProjectsAdapter,
  checklistId: string,
  checkItemId: string
) {
  const { cardId } = parseChecklistId(checklistId);
  _currentCardId = cardId;
  try {
    return await origCheckItemDelete.call(this, checklistId, checkItemId);
  } finally {
    _currentCardId = null;
  }
};
