import postgres from 'postgres';
const globalDb = globalThis as unknown as { namcheSql?: ReturnType<typeof postgres> };
export const sql = globalDb.namcheSql ?? postgres(process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL || '', { ssl: 'require', max: 5, idle_timeout: 20, connect_timeout: 15 });
if (process.env.NODE_ENV !== 'production') globalDb.namcheSql = sql;
export type MenuItem = {id:string;name:string;description:string;category:string;kind:string;price:number|null;price_note:string;image_id:string|null;available:boolean;featured:boolean;sort_order:number};
export async function getMenu(kind = 'food') { return sql<MenuItem[]>`select * from namche.menu_items where kind=${kind} and available=true order by sort_order, name`; }
