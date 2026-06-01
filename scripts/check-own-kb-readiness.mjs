import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const migrationsDir = path.join(root, 'supabase', 'migrations');

const ownKbTables = [
  'kb_sources',
  'kb_source_versions',
  'kb_documents',
  'kb_chunks',
  'kb_embeddings',
  'kb_ingestion_jobs',
  'kb_retrieval_events',
  'kb_retrieval_citations',
  'kb_eval_runs',
  'kb_eval_results',
  'voice_rag_turn_metrics',
  'kb_shadow_runs',
  'kb_shadow_results',
];

const requiredValidatedConstraints = [
  ['kb_sources', 'kb_sources_current_version_scope_fk'],
  ['kb_documents', 'kb_documents_source_scope_fk'],
  ['kb_documents', 'kb_documents_source_version_scope_fk'],
  ['kb_chunks', 'kb_chunks_document_lineage_scope_fk'],
  ['kb_embeddings', 'kb_embeddings_chunk_scope_fk'],
  ['kb_retrieval_citations', 'kb_retrieval_citations_event_scope_fk'],
  ['kb_retrieval_citations', 'kb_retrieval_citations_chunk_lineage_scope_fk'],
  ['kb_eval_runs', 'kb_eval_runs_scope_required_chk'],
  ['kb_eval_results', 'kb_eval_results_run_scope_fk'],
];

function readMigrations() {
  if (!fs.existsSync(migrationsDir)) {
    throw new Error('supabase/migrations is missing');
  }
  const files = fs.readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();
  return files.map((file) => ({
    file,
    sql: fs.readFileSync(path.join(migrationsDir, file), 'utf8'),
  }));
}

function normalize(sql) {
  return sql.toLowerCase().replace(/\s+/g, ' ');
}

function hasColumn(sql, table, column) {
  const createTable = new RegExp(`create\\s+table\\s+if\\s+not\\s+exists\\s+public\\.${table}\\s*\\(([\\s\\S]*?)\\);`, 'i').exec(sql)?.[1] ?? '';
  const alterColumn = new RegExp(`alter\\s+table\\s+public\\.${table}\\s+add\\s+column\\s+if\\s+not\\s+exists\\s+${column}\\b`, 'i');
  return new RegExp(`\\b${column}\\b`, 'i').test(createTable) || alterColumn.test(sql);
}

function hasScopeIndex(sql, table) {
  return new RegExp(`create\\s+(?:unique\\s+)?index\\s+if\\s+not\\s+exists\\s+[a-z0-9_]+\\s+on\\s+public\\.${table}\\s*\\([^;]*\\borg_id\\b[^;]*\\btenant_id\\b`, 'i').test(sql);
}

function check() {
  const migrations = readMigrations();
  const combined = migrations.map((item) => `-- ${item.file}\n${item.sql}`).join('\n\n');
  const compact = normalize(combined);
  const failures = [];

  for (const table of ownKbTables) {
    if (!compact.includes(`table if not exists public.${table}`) && !compact.includes(`table public.${table}`)) {
      failures.push(`MISSING_TABLE:${table}`);
    }
    if (!hasColumn(combined, table, 'org_id')) {
      failures.push(`MISSING_ORG_ID:${table}`);
    }
    if (!hasColumn(combined, table, 'tenant_id')) {
      failures.push(`MISSING_TENANT_ID:${table}`);
    }
    if (!compact.includes(`alter table public.${table} enable row level security`)) {
      failures.push(`MISSING_RLS_ENABLE:${table}`);
    }
    if (!compact.includes(`revoke all on table public.${table} from anon, authenticated`)) {
      failures.push(`MISSING_ANON_AUTH_REVOKE:${table}`);
    }
    if (!hasScopeIndex(combined, table)) {
      failures.push(`MISSING_SCOPE_INDEX:${table}`);
    }
  }

  for (const [table, constraint] of requiredValidatedConstraints) {
    if (!compact.includes(`conname = '${constraint}'`)) {
      failures.push(`MISSING_SCOPE_CONSTRAINT:${constraint}`);
    }
    if (!compact.includes(`alter table public.${table} validate constraint ${constraint}`)) {
      failures.push(`MISSING_VALIDATE_CONSTRAINT:${constraint}`);
    }
  }

  const directGrants = combined.match(/grant\s+[^;]*\s+on\s+(?:table\s+)?public\.kb_[^;]*\s+to\s+(?:anon|authenticated)\b/gi) ?? [];
  for (const grant of directGrants) {
    failures.push(`PUBLIC_KB_GRANT:${grant.replace(/\s+/g, ' ').trim()}`);
  }

  const viewMatches = [...combined.matchAll(/create\s+(?:or\s+replace\s+)?view\s+public\.([a-z0-9_]+)[\s\S]*?;/gi)];
  for (const [, viewName] of viewMatches) {
    const body = viewMatches.find((match) => match[1] === viewName)?.[0] ?? '';
    if (/\bkb_[a-z0-9_]+\b/i.test(body) && !/security_invoker\s*=\s*true/i.test(body)) {
      failures.push(`PRIVATE_KB_VIEW_WITHOUT_SECURITY_INVOKER:${viewName}`);
    }
  }

  const securityDefinerMatches = combined.match(/create\s+(?:or\s+replace\s+)?function[\s\S]*?security\s+definer[\s\S]*?;/gi) ?? [];
  for (const fn of securityDefinerMatches) {
    if (/\bkb_[a-z0-9_]+\b/i.test(fn)) {
      failures.push(`SECURITY_DEFINER_TOUCHES_KB:${fn.slice(0, 160).replace(/\s+/g, ' ').trim()}`);
    }
  }

  const rpcMatches = combined.match(/create\s+(?:or\s+replace\s+)?function[\s\S]*?;/gi) ?? [];
  for (const fn of rpcMatches) {
    if (/\bkb_[a-z0-9_]+\b/i.test(fn) && (!/\borg_id\b/i.test(fn) || !/\btenant_id\b/i.test(fn))) {
      failures.push(`KB_FUNCTION_WITHOUT_EXPLICIT_SCOPE:${fn.slice(0, 160).replace(/\s+/g, ' ').trim()}`);
    }
  }

  return failures;
}

const failures = check();
if (failures.length) {
  console.error('Own-KB readiness static check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Own-KB readiness static check passed.');
