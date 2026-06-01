import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const migrationsDir = path.join(root, 'supabase', 'migrations');

if (!fs.existsSync(migrationsDir)) {
  console.error('supabase/migrations is missing');
  process.exit(1);
}

const files = fs.readdirSync(migrationsDir)
  .filter((file) => file.endsWith('.sql'))
  .sort();

if (!files.length) {
  console.error('No Supabase migration files found');
  process.exit(1);
}

const seen = new Set();
for (const file of files) {
  const match = /^(\d{14})_[a-z0-9_]+\.sql$/.exec(file);
  if (!match) {
    console.error(`Invalid migration filename: ${file}`);
    process.exit(1);
  }
  const version = match[1];
  if (seen.has(version)) {
    console.error(`Duplicate migration version: ${version}`);
    process.exit(1);
  }
  seen.add(version);

  const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8').trim();
  if (!sql) {
    console.error(`Empty migration file: ${file}`);
    process.exit(1);
  }
}

console.log(`Supabase migration check passed (${files.length} file${files.length === 1 ? '' : 's'}).`);
