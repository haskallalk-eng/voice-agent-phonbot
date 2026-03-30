import pg from 'pg';
const pool = new pg.Pool({ connectionString: 'postgresql://postgres:TsBzUNC8yNNLTF2T@db.kmonxrmmkqjvifnaryfi.supabase.co:5432/postgres' });
try {
  const res = await pool.query('SELECT current_database(), current_user');
  console.log('DB OK:', res.rows[0]);
} catch (e) {
  console.error('ERROR:', e.message);
} finally {
  await pool.end();
}
