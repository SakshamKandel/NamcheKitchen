import fs from 'node:fs/promises';
import * as net from 'node:net';
import postgres from 'postgres';

net.setDefaultAutoSelectFamily(false);
const databaseUrl = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('Set DATABASE_URL_UNPOOLED or DATABASE_URL before running migrations.');
if (new URL(databaseUrl).hostname.includes('-pooler')) throw new Error('Use a direct database connection for migrations.');
const sql = postgres(databaseUrl, { ssl: 'require', max: 1, connect_timeout: 15 });
try {
  const folder = new URL('./migrations/', import.meta.url);
  for (const name of (await fs.readdir(folder)).filter(name => name.endsWith('.sql')).sort()) {
    const source = await fs.readFile(new URL(name, folder), 'utf8');
    await sql.begin(tx => tx.unsafe(source));
    console.log('Applied ' + name);
  }
} finally {
  await sql.end();
}
