import * as net from 'node:net';
import postgres from 'postgres';

// Neon publishes both IPv4 and IPv6 addresses. Some local Windows/Node
// runtimes select an IPv6 address even when IPv6 routing is unavailable,
// which leaves the connection stuck until the database timeout expires.
// Prefer IPv4 for this server-side Postgres client; Neon remains the sole
// source of menu and reservation data.
if (typeof net.setDefaultAutoSelectFamily === 'function') net.setDefaultAutoSelectFamily(false);
const globalDb = globalThis as unknown as { namcheSql?: ReturnType<typeof postgres> };
const databaseUrl = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL || '';
export const sql = globalDb.namcheSql ?? postgres(databaseUrl, { ssl: 'require', max: 5, idle_timeout: 20, connect_timeout: 15 });
if (process.env.NODE_ENV !== 'production') globalDb.namcheSql = sql;
export type MenuItem = {id:string;name:string;description:string;category:string;kind:string;price:number|null;price_note:string;image_id:string|null;available:boolean;featured:boolean;sort_order:number};
export async function getMenu(kind = 'food') { return sql<MenuItem[]>`select * from namche.menu_items where kind=${kind} and available=true order by sort_order, name`; }
