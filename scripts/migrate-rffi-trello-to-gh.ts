#!/usr/bin/env -S npx tsx
/**
 * migrate-rffi-trello-to-gh.ts
 *
 * One-shot migration: Trello board "Insurance Claim 9071566 (RFFI)" →
 * GitHub Projects v2 "RFFI Insurance Claim 9071566".
 *
 * Source: Trello board id 69e8c9a7513c41482cfc2151 (alias `rffi`)
 * Target: GH Project PVT_kwHOAkzs9M4BWuvM (exisz/13)
 *
 * Model translation (correspondence-versioned):
 *   - Library cards = canonical items → DraftIssues in GH project (1:1)
 *   - Round-list cards = references → NOT migrated as separate items;
 *     instead, build "Asked in rounds" + "Round status" from them and
 *     persist on the canonical item.
 *   - Submission log lines (regex-parsed from card desc) → structured
 *     fields (Last sent date / ref / Last acknowledged date) +
 *     a "## Submission Log" markdown table appended to body.
 *   - Trello labels (P0/Geography flag) → Priority field + body note.
 *
 * Usage:
 *   npx tsx scripts/migrate-rffi-trello-to-gh.ts            # dry-run (default)
 *   npx tsx scripts/migrate-rffi-trello-to-gh.ts --apply    # actually write
 *   npx tsx scripts/migrate-rffi-trello-to-gh.ts --apply --only "Police report"
 *
 * Auth:
 *   TRELLO_KEY, TRELLO_TOKEN — Trello REST
 *   GITHUB_TOKEN or `gh auth token` — GitHub GraphQL (project scope)
 */

import { execSync } from 'node:child_process';

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

const TRELLO_BOARD_ID = '69e8c9a7513c41482cfc2151';
const GH_PROJECT_ID = 'PVT_kwHOAkzs9M4BWuvM'; // exisz/13
const GH_PROJECT_URL = 'https://github.com/users/exisz/projects/13';

const LIBRARY_LIST_ID = '69e9354b9d6fac7f2e1c01a7';
const ROUND_LISTS: Record<string, string> = {
  '69e9354cd5984bc7266e7f5b': 'Original',
  '69e9354cbb1c2db4c14a42e2': 'RFFI #1',
  '69e9354d33ac5a9021715fdc': 'RFFI #2',
  '69e9354d8a42400a01d31155': 'RFFI #3',
};
const CLOSED_OUT_LIST_ID = '69e9354e4b2a8a43d317eff1';

// ─────────────────────────────────────────────────────────────────────────────
// CLI args
// ─────────────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const ONLY = (() => {
  const i = args.indexOf('--only');
  return i >= 0 ? args[i + 1] : null;
})();
const VERBOSE = args.includes('-v') || args.includes('--verbose');

console.log(`\n${'─'.repeat(72)}`);
console.log(` RFFI Trello → GH Projects migration`);
console.log(` Mode: ${APPLY ? 'APPLY (writes)' : 'DRY-RUN (read-only)'}`);
if (ONLY) console.log(` Filter: only cards matching "${ONLY}"`);
console.log(`${'─'.repeat(72)}\n`);

// ─────────────────────────────────────────────────────────────────────────────
// Trello client
// ─────────────────────────────────────────────────────────────────────────────

const TRELLO_KEY = process.env.TRELLO_KEY!;
const TRELLO_TOKEN = process.env.TRELLO_TOKEN!;
if (!TRELLO_KEY || !TRELLO_TOKEN) {
  console.error('TRELLO_KEY / TRELLO_TOKEN env required');
  process.exit(1);
}

interface TrelloCard {
  id: string;
  name: string;
  desc: string;
  due: string | null;
  labels: { id: string; name: string; color: string | null }[];
  pos: number;
  idList: string;
  shortLink: string;
  url: string;
  closed: boolean;
}

async function trello<T>(path: string): Promise<T> {
  const sep = path.includes('?') ? '&' : '?';
  const url = `https://api.trello.com/1${path}${sep}key=${TRELLO_KEY}&token=${TRELLO_TOKEN}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Trello ${resp.status}: ${await resp.text()}`);
  }
  return (await resp.json()) as T;
}

async function fetchAllCards(): Promise<TrelloCard[]> {
  return trello<TrelloCard[]>(
    `/boards/${TRELLO_BOARD_ID}/cards?fields=id,name,desc,due,labels,pos,idList,shortLink,url,closed`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// GitHub GraphQL
// ─────────────────────────────────────────────────────────────────────────────

let _ghToken: string | null = null;
function ghToken(): string {
  if (_ghToken) return _ghToken;
  let tok = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!tok) {
    try {
      tok = execSync('gh auth token', { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim();
    } catch {
      /* ignore */
    }
  }
  if (!tok) throw new Error('No GITHUB_TOKEN / gh auth token');
  _ghToken = tok;
  return tok;
}

async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const resp = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ghToken()}`,
      'Content-Type': 'application/json',
      'User-Agent': 'rffi-migration',
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!resp.ok) {
    throw new Error(`GH HTTP ${resp.status}: ${await resp.text()}`);
  }
  const json = (await resp.json()) as { data?: T; errors?: { message: string }[] };
  if (json.errors) {
    throw new Error(`GH GraphQL: ${json.errors.map(e => e.message).join(' | ')}`);
  }
  if (!json.data) throw new Error('GH returned no data');
  return json.data;
}

// ─────────────────────────────────────────────────────────────────────────────
// Submission log parser
// ─────────────────────────────────────────────────────────────────────────────

interface ParsedLog {
  lastSentDate: string | null; // ISO YYYY-MM-DD
  lastSentRef: string | null;
  lastAckDate: string | null;
  rawLines: string[]; // lines we matched as log-relevant
  unparsed: boolean; // true if we suspect important info we couldn't structure
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

function parseDate(s: string): string | null {
  // accept "16 Apr 2026", "1 May 2025", "29 Oct 2022"
  const m = s.match(/(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+(\d{4})/i);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const mo = MONTHS[m[2].toLowerCase().slice(0, 3)];
  const year = parseInt(m[3], 10);
  if (mo == null) return null;
  const dt = new Date(Date.UTC(year, mo, day));
  return dt.toISOString().slice(0, 10);
}

function parseSubmissionLog(desc: string): ParsedLog {
  const out: ParsedLog = {
    lastSentDate: null,
    lastSentRef: null,
    lastAckDate: null,
    rawLines: [],
    unparsed: false,
  };
  if (!desc) return out;

  // Split into sentences/lines and look for "Sent X" / "Acknowledged X" / "Submitted X"
  const sentRe = /(?:^|\.|\n)\s*(?:Sent|Submitted|Re-sent|Resent|Updated)\b[^.\n]*?(\d{1,2}\s+\w+\s+\d{4})([^.\n]*)/gi;
  const ackRe = /(?:Acknowledged|Acceptance|Confirmed|Accepted)\b[^.\n]*?(\d{1,2}\s+\w+\s+\d{4})/gi;
  const refRe = /\b(?:Gmail thread|msg|message id|ref(?:erence)?)\b[^,.\n]*?([0-9a-f]{6,})/gi;

  let m: RegExpExecArray | null;
  let latestSent: { date: string; ref: string | null } | null = null;
  while ((m = sentRe.exec(desc)) != null) {
    const d = parseDate(m[1]);
    if (!d) continue;
    const tail = (m[2] || '').trim();
    const refM = tail.match(/([0-9a-f]{14,}(?:\s*\+\s*[0-9a-f]{14,})?)/i);
    const ref = refM ? refM[1].trim() : null;
    if (!latestSent || d > latestSent.date) latestSent = { date: d, ref };
    out.rawLines.push(m[0].trim());
  }
  if (latestSent) {
    out.lastSentDate = latestSent.date;
    out.lastSentRef = latestSent.ref;
  }

  let latestAck: string | null = null;
  while ((m = ackRe.exec(desc)) != null) {
    const d = parseDate(m[1]);
    if (!d) continue;
    if (!latestAck || d > latestAck) latestAck = d;
    out.rawLines.push(m[0].trim());
  }
  out.lastAckDate = latestAck;

  // Fallback ref if not found inline with Sent line
  if (!out.lastSentRef) {
    const r = refRe.exec(desc);
    if (r) out.lastSentRef = r[1];
  }

  // Heuristic: if desc contains "Sent" or "Submitted" or "Acknowledged" but we
  // pulled nothing, flag unparsed.
  const looksLogLike = /\b(Sent|Submitted|Acknowledged)\b/.test(desc);
  if (looksLogLike && out.rawLines.length === 0) out.unparsed = true;

  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Card classification
// ─────────────────────────────────────────────────────────────────────────────

interface CanonicalCard {
  trello: TrelloCard;
  parsedLog: ParsedLog;
  askedInRounds: string[]; // ["Original", "RFFI #2", ...]
  roundStatuses: { round: string; status: string }[]; // from round-list ref cards' "Round status:" header
  isClosedOut: boolean;
  priority: string | null; // "P0" / "P1" / "P2" / null
  isMeta: boolean; // DATA MODEL card
}

function shortLinkFromUrl(url: string): string | null {
  const m = url.match(/trello\.com\/c\/([A-Za-z0-9]+)/);
  return m ? m[1] : null;
}

function classifyPriority(labels: TrelloCard['labels']): string | null {
  for (const l of labels) {
    if (/^P[012]\b/i.test(l.name)) return l.name.split(/[\s—-]/)[0].toUpperCase();
  }
  return null;
}

function buildCanonicalSet(allCards: TrelloCard[]): {
  canon: Map<string, CanonicalCard>;
  refs: TrelloCard[];
  unmatchedRefs: TrelloCard[];
} {
  const libraryCards = allCards.filter(c => c.idList === LIBRARY_LIST_ID && !c.closed);
  const closedOutCards = allCards.filter(c => c.idList === CLOSED_OUT_LIST_ID && !c.closed);

  // Treat closed-out list cards as canonical too (rare edge case)
  const canon = new Map<string, CanonicalCard>();
  for (const c of [...libraryCards, ...closedOutCards]) {
    canon.set(c.shortLink, {
      trello: c,
      parsedLog: parseSubmissionLog(c.desc),
      askedInRounds: [],
      roundStatuses: [],
      isClosedOut: c.idList === CLOSED_OUT_LIST_ID,
      priority: classifyPriority(c.labels),
      isMeta: /^🧬\s*DATA MODEL/.test(c.name),
    });
  }

  const refCards: TrelloCard[] = [];
  const unmatched: TrelloCard[] = [];

  for (const [listId, roundName] of Object.entries(ROUND_LISTS)) {
    const cards = allCards.filter(c => c.idList === listId && !c.closed);
    for (const ref of cards) {
      refCards.push(ref);
      // Find canonical via "Canonical card: https://trello.com/c/XXX"
      const canonShort = (() => {
        const m = ref.desc.match(/Canonical card:\s*https?:\/\/trello\.com\/c\/([A-Za-z0-9]+)/i);
        if (m) return m[1];
        // Fallback: any trello.com/c/ short link in desc
        const m2 = ref.desc.match(/trello\.com\/c\/([A-Za-z0-9]+)/);
        return m2 ? m2[1] : null;
      })();
      if (!canonShort) {
        unmatched.push(ref);
        continue;
      }
      const target = canon.get(canonShort);
      if (!target) {
        unmatched.push(ref);
        continue;
      }
      if (!target.askedInRounds.includes(roundName)) {
        target.askedInRounds.push(roundName);
      }
      // Extract round status: "**Round status:** submitted"
      const sm = ref.desc.match(/Round status:\*?\*?\s*([^\n]+)/i);
      if (sm) {
        target.roundStatuses.push({ round: roundName, status: sm[1].trim() });
      }
    }
  }

  return { canon, refs: refCards, unmatchedRefs: unmatched };
}

// ─────────────────────────────────────────────────────────────────────────────
// Status mapping
// ─────────────────────────────────────────────────────────────────────────────

function determineStatus(card: CanonicalCard): string {
  if (card.isMeta) return 'Meta';
  if (card.isClosedOut) return 'Closed Out';

  // Use latest round status (highest-numbered round) as authority
  const roundOrder = ['Original', 'RFFI #1', 'RFFI #2', 'RFFI #3'];
  const sorted = [...card.roundStatuses].sort(
    (a, b) => roundOrder.indexOf(a.round) - roundOrder.indexOf(b.round)
  );
  const latest = sorted[sorted.length - 1];
  if (latest) {
    const s = latest.status.toLowerCase();
    if (s.includes('submitted')) return card.parsedLog.lastAckDate ? 'Acknowledged' : 'Submitted';
    if (s.includes('pending') || s.includes('no-receipt') || s.includes('no receipt')) return 'Active';
  }
  // Cards in Library only (never in any round)
  if (card.askedInRounds.length === 0) return 'On Hold';
  return 'Active';
}

function determineAcceptance(card: CanonicalCard): string {
  if (card.isMeta) return 'N/A';
  if (card.parsedLog.lastAckDate) return 'Accepted';
  if (card.parsedLog.lastSentDate) return 'Pending';
  return 'Pending';
}

// ─────────────────────────────────────────────────────────────────────────────
// GH project schema setup
// ─────────────────────────────────────────────────────────────────────────────

interface ProjectField {
  id: string;
  name: string;
  dataType: string;
  options?: { id: string; name: string }[];
}

async function fetchFields(): Promise<ProjectField[]> {
  const data = await gql<{
    node: { fields: { nodes: ProjectField[] } };
  }>(
    `query($id: ID!) {
      node(id: $id) {
        ... on ProjectV2 {
          fields(first: 50) {
            nodes {
              ... on ProjectV2Field { id name dataType }
              ... on ProjectV2SingleSelectField { id name dataType options { id name } }
              ... on ProjectV2IterationField { id name dataType }
            }
          }
        }
      }
    }`,
    { id: GH_PROJECT_ID }
  );
  return data.node.fields.nodes.filter((f: ProjectField) => f && f.id);
}

interface SchemaSpec {
  statusOptions: string[]; // exact desired set
  customFields: { name: string; dataType: 'TEXT' | 'DATE' | 'SINGLE_SELECT'; options?: string[] }[];
}

const SCHEMA: SchemaSpec = {
  statusOptions: ['Active', 'Submitted', 'Acknowledged', 'On Hold', 'Closed Out', 'Meta'],
  customFields: [
    { name: 'Asked in rounds', dataType: 'TEXT' },
    { name: 'Last sent date', dataType: 'DATE' },
    { name: 'Last sent ref', dataType: 'TEXT' },
    { name: 'Last acknowledged date', dataType: 'DATE' },
    {
      name: 'Acceptance',
      dataType: 'SINGLE_SELECT',
      options: ['Pending', 'Accepted', 'Rejected', 'Partial', 'N/A'],
    },
    {
      name: 'Priority',
      dataType: 'SINGLE_SELECT',
      options: ['P0', 'P1', 'P2', 'None'],
    },
    { name: 'Round status (latest)', dataType: 'TEXT' },
  ],
};

async function ensureSchema(): Promise<Map<string, ProjectField>> {
  const fields = await fetchFields();
  const byName = new Map(fields.map(f => [f.name, f]));

  // Status: ensure all desired options exist (we add missing; we keep extras like Todo/InProgress/Done if present — but try to remove default ones first by replacing whole option set)
  const statusField = byName.get('Status')!;
  const haveOpts = new Set((statusField.options || []).map(o => o.name));
  const needAdd = SCHEMA.statusOptions.filter(o => !haveOpts.has(o));
  const removeDefaults = (statusField.options || []).filter(
    o => ['Todo', 'In Progress', 'Done'].includes(o.name)
  );

  if (APPLY && (needAdd.length > 0 || removeDefaults.length > 0)) {
    // Use updateProjectV2Field to fully replace the option list with a clean set.
    const desiredOptions = SCHEMA.statusOptions.map(name => {
      const existing = (statusField.options || []).find(o => o.name === name);
      return existing
        ? { name, color: 'GRAY' as const, description: '' }
        : { name, color: 'GRAY' as const, description: '' };
    });
    console.log(`  → Replacing Status field options with: ${SCHEMA.statusOptions.join(', ')}`);
    await gql(
      `mutation($f: ID!, $opts: [ProjectV2SingleSelectFieldOptionInput!]!) {
        updateProjectV2Field(input: { fieldId: $f, singleSelectOptions: $opts }) {
          projectV2Field { ... on ProjectV2SingleSelectField { id options { id name } } }
        }
      }`,
      { f: statusField.id, opts: desiredOptions }
    );
  } else if (needAdd.length > 0) {
    console.log(`  [dry-run] Would replace Status options. Need to add: ${needAdd.join(', ')}, would drop defaults: ${removeDefaults.map(o => o.name).join(', ')}`);
  }

  // Custom fields
  for (const cf of SCHEMA.customFields) {
    if (byName.has(cf.name)) {
      if (VERBOSE) console.log(`  ✓ Field "${cf.name}" already exists`);
      continue;
    }
    if (APPLY) {
      console.log(`  → Creating field "${cf.name}" (${cf.dataType})`);
      const cmd = [
        'gh', 'project', 'field-create', '13',
        '--owner', 'exisz',
        '--name', JSON.stringify(cf.name),
        '--data-type', cf.dataType,
      ];
      if (cf.options) {
        cmd.push('--single-select-options', cf.options.map(o => `"${o}"`).join(','));
      }
      // Use execSync for simplicity
      const sh = `gh project field-create 13 --owner exisz --name ${JSON.stringify(cf.name)} --data-type ${cf.dataType}` +
        (cf.options ? ` --single-select-options ${JSON.stringify(cf.options.join(','))}` : '');
      execSync(sh, { stdio: 'inherit' });
    } else {
      console.log(`  [dry-run] Would create field "${cf.name}" (${cf.dataType}${cf.options ? ': ' + cf.options.join('|') : ''})`);
    }
  }

  // Refetch
  return new Map((await fetchFields()).map(f => [f.name, f]));
}

// ─────────────────────────────────────────────────────────────────────────────
// Build card body
// ─────────────────────────────────────────────────────────────────────────────

function buildBody(card: CanonicalCard): string {
  const sections: string[] = [];

  // Submission log table
  if (card.parsedLog.rawLines.length > 0 || card.parsedLog.lastSentDate) {
    sections.push('## Submission Log');
    sections.push('');
    sections.push('| Date | Ref | Outcome |');
    sections.push('|------|-----|---------|');
    if (card.parsedLog.lastSentDate) {
      sections.push(
        `| ${card.parsedLog.lastSentDate} | ${card.parsedLog.lastSentRef || '—'} | Sent${card.parsedLog.lastAckDate ? `; Acknowledged ${card.parsedLog.lastAckDate}` : ''} |`
      );
    }
    if (card.parsedLog.unparsed) {
      sections.push('');
      sections.push('> ⚠️ Some submission-log lines could not be auto-structured. See "## Original notes" below.');
    }
    sections.push('');
  }

  // Per-round status
  if (card.roundStatuses.length > 0) {
    sections.push('## Per-round status');
    sections.push('');
    for (const rs of card.roundStatuses) {
      sections.push(`- **${rs.round}**: ${rs.status}`);
    }
    sections.push('');
  }

  // Asked in rounds (also a structured field, but mirror in body for readability)
  if (card.askedInRounds.length > 0) {
    sections.push(`**Asked in rounds:** ${card.askedInRounds.join(', ')}`);
    sections.push('');
  }

  // Original Trello reference
  sections.push(`---`);
  sections.push(`_Migrated from Trello card [${card.trello.shortLink}](${card.trello.url}) on ${new Date().toISOString().slice(0, 10)}._`);
  sections.push('');

  // Original notes (preserve EVERYTHING)
  sections.push('## Original notes');
  sections.push('');
  sections.push(card.trello.desc || '_(no description)_');

  return sections.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// GH item operations
// ─────────────────────────────────────────────────────────────────────────────

async function createDraftItem(title: string, body: string): Promise<string> {
  const data = await gql<{
    addProjectV2DraftIssue: { projectItem: { id: string } };
  }>(
    `mutation($p: ID!, $t: String!, $b: String) {
      addProjectV2DraftIssue(input: { projectId: $p, title: $t, body: $b }) {
        projectItem { id }
      }
    }`,
    { p: GH_PROJECT_ID, t: title, b: body }
  );
  return data.addProjectV2DraftIssue.projectItem.id;
}

async function setSingleSelect(itemId: string, fieldId: string, optionId: string): Promise<void> {
  await gql(
    `mutation($p: ID!, $i: ID!, $f: ID!, $o: String!) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $p, itemId: $i, fieldId: $f, value: { singleSelectOptionId: $o }
      }) { projectV2Item { id } }
    }`,
    { p: GH_PROJECT_ID, i: itemId, f: fieldId, o: optionId }
  );
}

async function setText(itemId: string, fieldId: string, text: string): Promise<void> {
  await gql(
    `mutation($p: ID!, $i: ID!, $f: ID!, $t: String!) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $p, itemId: $i, fieldId: $f, value: { text: $t }
      }) { projectV2Item { id } }
    }`,
    { p: GH_PROJECT_ID, i: itemId, f: fieldId, t: text }
  );
}

async function setDate(itemId: string, fieldId: string, isoDate: string): Promise<void> {
  await gql(
    `mutation($p: ID!, $i: ID!, $f: ID!, $d: Date!) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $p, itemId: $i, fieldId: $f, value: { date: $d }
      }) { projectV2Item { id } }
    }`,
    { p: GH_PROJECT_ID, i: itemId, f: fieldId, d: isoDate }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('▸ Fetching Trello board…');
  const allCards = await fetchAllCards();
  console.log(`  ${allCards.length} total cards on Trello board\n`);

  console.log('▸ Classifying canonical vs ref cards…');
  const { canon, refs, unmatchedRefs } = buildCanonicalSet(allCards);
  console.log(`  Canonical (Library + Closed Out): ${canon.size}`);
  console.log(`  Round-list reference cards: ${refs.length}`);
  console.log(`  Unmatched ref cards: ${unmatchedRefs.length}`);
  if (unmatchedRefs.length > 0) {
    for (const r of unmatchedRefs) {
      console.log(`    ⚠️  ${r.name} (${r.url}) — no canonical link found`);
    }
  }
  console.log();

  console.log('▸ Ensuring GH project schema…');
  const fieldByName = await ensureSchema();
  console.log(`  Project fields: ${[...fieldByName.keys()].join(', ')}\n`);

  // Build migration plan
  const plan: { card: CanonicalCard; status: string; acceptance: string }[] = [];
  for (const c of canon.values()) {
    if (ONLY && !c.trello.name.toLowerCase().includes(ONLY.toLowerCase())) continue;
    plan.push({
      card: c,
      status: determineStatus(c),
      acceptance: determineAcceptance(c),
    });
  }

  console.log(`▸ Migration plan (${plan.length} cards):\n`);
  let parsedCount = 0, unparsedCount = 0;
  for (const p of plan) {
    const c = p.card;
    if (c.parsedLog.rawLines.length > 0) parsedCount++;
    if (c.parsedLog.unparsed) unparsedCount++;
    console.log(
      `  [${p.status.padEnd(13)}] ${c.trello.name}` +
      (c.askedInRounds.length ? ` · rounds: ${c.askedInRounds.join(',')}` : '') +
      (c.parsedLog.lastSentDate ? ` · sent ${c.parsedLog.lastSentDate}` : '') +
      (c.parsedLog.lastAckDate ? ` · ack ${c.parsedLog.lastAckDate}` : '') +
      (c.priority ? ` · ${c.priority}` : '') +
      (c.parsedLog.unparsed ? ' ⚠️ UNPARSED LOG' : '')
    );
  }
  console.log(
    `\n  Submission logs parsed: ${parsedCount}/${plan.length}` +
    (unparsedCount > 0 ? ` · UNPARSED FLAGGED: ${unparsedCount}` : '')
  );

  if (!APPLY) {
    console.log(`\n${'─'.repeat(72)}`);
    console.log(' DRY-RUN complete. Re-run with --apply to write to GH Projects.');
    console.log(`${'─'.repeat(72)}\n`);
    return;
  }

  // APPLY: Create items
  console.log(`\n▸ Creating ${plan.length} items in GH project…\n`);
  const statusField = fieldByName.get('Status')!;
  const askedField = fieldByName.get('Asked in rounds')!;
  const sentDateField = fieldByName.get('Last sent date')!;
  const sentRefField = fieldByName.get('Last sent ref')!;
  const ackDateField = fieldByName.get('Last acknowledged date')!;
  const acceptField = fieldByName.get('Acceptance')!;
  const priorityField = fieldByName.get('Priority')!;
  const roundStatusField = fieldByName.get('Round status (latest)')!;

  const findOpt = (f: ProjectField, name: string) => {
    const o = (f.options || []).find(o => o.name === name);
    if (!o) throw new Error(`Option "${name}" not found on field "${f.name}"`);
    return o.id;
  };

  let created = 0, failed: string[] = [];
  for (const p of plan) {
    const c = p.card;
    const title = c.trello.name;
    try {
      const body = buildBody(c);
      const itemId = await createDraftItem(title, body);

      // Status
      await setSingleSelect(itemId, statusField.id, findOpt(statusField, p.status));

      // Asked in rounds
      if (c.askedInRounds.length > 0) {
        await setText(itemId, askedField.id, c.askedInRounds.join(', '));
      }

      // Submission log fields
      if (c.parsedLog.lastSentDate) {
        await setDate(itemId, sentDateField.id, c.parsedLog.lastSentDate);
      }
      if (c.parsedLog.lastSentRef) {
        await setText(itemId, sentRefField.id, c.parsedLog.lastSentRef);
      }
      if (c.parsedLog.lastAckDate) {
        await setDate(itemId, ackDateField.id, c.parsedLog.lastAckDate);
      }

      // Acceptance + Priority
      await setSingleSelect(itemId, acceptField.id, findOpt(acceptField, p.acceptance));
      if (c.priority) {
        await setSingleSelect(itemId, priorityField.id, findOpt(priorityField, c.priority));
      } else {
        await setSingleSelect(itemId, priorityField.id, findOpt(priorityField, 'None'));
      }

      // Latest round status
      const latest = c.roundStatuses[c.roundStatuses.length - 1];
      if (latest) {
        await setText(itemId, roundStatusField.id, `${latest.round}: ${latest.status}`);
      }

      created++;
      console.log(`  ✓ [${p.status}] ${title}`);
    } catch (e) {
      const msg = (e as Error).message;
      failed.push(`${title}: ${msg}`);
      console.log(`  ✗ ${title} — ${msg}`);
    }
  }

  // Add a fresh README card
  console.log(`\n▸ Creating README card…`);
  try {
    const readmeBody = `# 📖 RFFI board — How to use this GH Project

This project replaces the original Trello board for the RFFI insurance claim
correspondence with Cover-More. It uses GH Projects v2 features rather than
list-as-round abstraction.

## Model

Each item = one canonical deliverable (receipt, statement, narrative answer).
The "round" axis lives in **fields**, not lists.

### Key fields

| Field | Meaning |
|-------|---------|
| **Status** | Current state: \`Active\`, \`Submitted\`, \`Acknowledged\`, \`On Hold\`, \`Closed Out\`, \`Meta\` |
| **Asked in rounds** | Comma-separated list of rounds this item was requested in: \`Original, RFFI #2, RFFI #3\` |
| **Round status (latest)** | Per-round status flag from the latest round (e.g. \`RFFI #2: pending-no-receipt\`) |
| **Last sent date** | Date item was most recently submitted |
| **Last sent ref** | Gmail thread ID / letter ref for that send |
| **Last acknowledged date** | Date Ashley confirmed receipt |
| **Acceptance** | \`Pending\` / \`Accepted\` / \`Rejected\` / \`Partial\` / \`N/A\` |
| **Priority** | \`P0\` / \`P1\` / \`P2\` / \`None\` |

## Workflow

1. **New deliverable arrives** → create new item, set Status = \`Active\`, set initial round in "Asked in rounds"
2. **You submit** → update Status = \`Submitted\`, set "Last sent date" + "Last sent ref", append a row to the body's "## Submission Log" table
3. **Insurer acknowledges** → set Status = \`Acknowledged\`, set "Last acknowledged date", set Acceptance = \`Accepted\`
4. **New round arrives asking for it again** → append round to "Asked in rounds" (no duplicate item), update Round status
5. **Insurer drops the ask** → leave field history intact, move Status = \`Closed Out\` if permanently done

## Useful views

- **Group by Status** → see Active vs Submitted vs Acknowledged at a glance
- **Filter "Asked in rounds" contains "RFFI #3"** → next-round prep checklist
- **Sort by Last sent date** → recency view
- **Filter Acceptance = Pending AND Status = Submitted** → awaiting Cover-More response

## CLI access

\`\`\`bash
agentbase lists -b rffi-gh
agentbase cards -b rffi-gh
\`\`\`

(Requires \`vendor: github-projects\` in \`.agentbase/agentbase.yml\`.)

## History

- Migrated from Trello board \`Insurance Claim 9071566 (RFFI)\` (id 69e8c9a7513c41482cfc2151) on ${new Date().toISOString().slice(0, 10)}.
- Original Trello board kept as backup until manually archived.
- Migration script: \`/Users/c/repos/nebula/agentbase/scripts/migrate-rffi-trello-to-gh.ts\`
`;
    const readmeId = await createDraftItem('📖 README — How to use this board', readmeBody);
    await setSingleSelect(readmeId, statusField.id, findOpt(statusField, 'Meta'));
    console.log(`  ✓ README created`);
  } catch (e) {
    console.log(`  ✗ README failed: ${(e as Error).message}`);
  }

  console.log(`\n${'─'.repeat(72)}`);
  console.log(` MIGRATION COMPLETE`);
  console.log(` Created: ${created}/${plan.length}`);
  console.log(` Failed: ${failed.length}`);
  if (failed.length > 0) {
    for (const f of failed) console.log(`   - ${f}`);
  }
  console.log(` Project URL: ${GH_PROJECT_URL}`);
  console.log(`${'─'.repeat(72)}\n`);
}

main().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
