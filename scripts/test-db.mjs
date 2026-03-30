import pg from 'pg';
const pool = new pg.Pool({ connectionString: 'postgresql://postgres:TsBzUNC8yNNLTF2T@db.kmonxrmmkqjvifnaryfi.supabase.co:5432/postgres' });
try {
  const res = await pool.query('SELECT current_database(), current_user');
  console.log('DB OK:', res.rows[0]);
  // Try creating orgs table
  await pool.query(`
    create table if not exists orgs (
      id uuid primary key default gen_random_uuid(),
      created_at timestamptz not null default now(),
      name text not null,
      plan text not null default 'free',
      is_active boolean not null default true
    );
  `);
  console.log('orgs table: OK');
} catch (e) {
  console.error('ERROR:', e.message);
} finally {
  await pool.end();
}
