import type postgres from 'postgres';
import { z } from 'zod';
import { sql } from '@/lib/db';
import { sameOrigin, session } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const noStore = { 'Cache-Control': 'no-store' };
const categoryName = z.string().trim().min(2, 'Use at least 2 characters for the category.').max(80, 'Category names must be 80 characters or fewer.').regex(/^[^\u0000-\u001f\u007f]+$/, 'Use a single line of text for the category.');
const categorySchema = z.object({ kind: z.enum(['food', 'drink']), name: categoryName });
const renameSchema = categorySchema.extend({ newName: categoryName });
const removeSchema = categorySchema.extend({ replacement: categoryName.optional() });
type Category = { kind: 'food' | 'drink'; name: string; item_count: number };
type CategorySql = postgres.Sql | postgres.TransactionSql;

async function findCategory(db: CategorySql, kind: string, name: string) {
  const [category] = await db<Category[]>`
    select c.kind, min(c.name) as name,
      (select count(*)::int from namche.menu_items i where i.kind=${kind} and lower(i.category)=lower(${name})) as item_count
    from (select kind,name from namche.menu_categories union select kind,category as name from namche.menu_items) c
    where c.kind=${kind} and lower(c.name)=lower(${name}) group by c.kind`;
  return category;
}

export async function GET() {
  try {
    if (!await session()) return Response.json({ error: 'Please sign in.' }, { status: 401, headers: noStore });
    const categories = await sql<Category[]>`
      with categories as (
        select kind,name from namche.menu_categories union select kind,category as name from namche.menu_items
      ), item_counts as (
        select kind,lower(category) as category_key,count(*)::int as item_count from namche.menu_items group by kind,lower(category)
      )
      select c.kind,min(c.name) as name,coalesce(i.item_count,0)::int as item_count
      from categories c left join item_counts i on i.kind=c.kind and i.category_key=lower(c.name)
      group by c.kind,lower(c.name),i.item_count order by c.kind,lower(c.name)`;
    return Response.json({ categories }, { headers: noStore });
  } catch {
    return Response.json({ error: 'Unable to load menu categories. Please try again.' }, { status: 503, headers: noStore });
  }
}

async function changeCategory(request: Request, action: 'add' | 'rename' | 'remove') {
  try {
    if (!sameOrigin(request)) return Response.json({ error: 'Invalid request origin.' }, { status: 403 });
    if (!await session()) return Response.json({ error: 'Please sign in.' }, { status: 401 });
    const raw = await request.text();
    if (raw.length > 2000) return Response.json({ error: 'Request is too large.' }, { status: 413 });
    let input: unknown;
    try { input = JSON.parse(raw); } catch { return Response.json({ error: 'Send a valid request.' }, { status: 400 }); }
    const schema = action === 'rename' ? renameSchema : action === 'remove' ? removeSchema : categorySchema;
    const parsed = schema.safeParse(input);
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });
    const data = parsed.data as z.infer<typeof categorySchema> & { newName?: string; replacement?: string };
    const { kind, name } = data;
    return await sql.begin(async tx => {
      // Also blocks concurrent menu item writes while categories and their items move together.
      await tx`lock table namche.menu_categories,namche.menu_items in share row exclusive mode`;
      const current = await findCategory(tx, kind, name);
      if (action === 'add') {
        if (current) return Response.json({ error: 'This category already exists.' }, { status: 409 });
        await tx`insert into namche.menu_categories(kind,name) values(${kind},${name})`;
        return Response.json({ ok: true, kind, name });
      }
      if (!current) return Response.json({ error: 'This category no longer exists.' }, { status: 404 });
      if (action === 'rename' && data.newName) {
        const newName = data.newName;
        const [duplicate] = await tx`
          select name from (select kind,name from namche.menu_categories union select kind,category as name from namche.menu_items) c
          where kind=${kind} and lower(name)=lower(${newName}) and lower(name)<>lower(${name}) limit 1`;
        if (duplicate) return Response.json({ error: 'A category with this name already exists.' }, { status: 409 });
        await tx`update namche.menu_items set category=${newName},updated_at=now() where kind=${kind} and lower(category)=lower(${name})`;
        await tx`delete from namche.menu_categories where kind=${kind} and lower(name)=lower(${name})`;
        await tx`insert into namche.menu_categories(kind,name) values(${kind},${newName})`;
        return Response.json({ ok: true, kind, name: newName });
      }
      const replacement = data.replacement;
      if (current.item_count > 0) {
        if (!replacement) return Response.json({ error: 'Choose another category to keep the items in this category.' }, { status: 400 });
        const target = await findCategory(tx, kind, replacement);
        if (!target) return Response.json({ error: 'The replacement category no longer exists.' }, { status: 404 });
        const [sameCategory] = await tx`select lower(${name})=lower(${replacement}) as same_category`;
        if (sameCategory.same_category) return Response.json({ error: 'Choose a different replacement category.' }, { status: 400 });
        await tx`insert into namche.menu_categories(kind,name) values(${kind},${target.name}) on conflict do nothing`;
        await tx`update namche.menu_items set category=${target.name},updated_at=now() where kind=${kind} and lower(category)=lower(${name})`;
      }
      await tx`delete from namche.menu_categories where kind=${kind} and lower(name)=lower(${name})`;
      return Response.json({ ok: true, movedItems: current.item_count });
    });
  } catch {
    return Response.json({ error: 'Unable to update menu categories. Please try again.' }, { status: 503 });
  }
}

export async function POST(request: Request) { return changeCategory(request, 'add'); }
export async function PATCH(request: Request) { return changeCategory(request, 'rename'); }
export async function DELETE(request: Request) { return changeCategory(request, 'remove'); }
