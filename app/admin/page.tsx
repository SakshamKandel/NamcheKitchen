import { session } from '@/lib/auth';
import { sql,MenuItem } from '@/lib/db';
import AdminLogin from '@/components/AdminLogin';
import AdminDashboard from '@/components/AdminDashboard';
export const dynamic='force-dynamic';
export const metadata={title:'Staff Administration',robots:{index:false,follow:false}};
export default async function Admin(){const admin=await session();if(!admin)return <AdminLogin/>;const [items,reservations,images]=await Promise.all([sql<MenuItem[]>`select * from namche.menu_items order by sort_order,name`,sql`select id,name,email,phone,to_char(date,'YYYY-MM-DD') as date,to_char(time,'HH24:MI') as time,guests,notes,status from namche.reservations order by date desc,time desc`,sql`select id from namche.images order by id`]);return <AdminDashboard items={JSON.parse(JSON.stringify(items))} reservations={JSON.parse(JSON.stringify(reservations))} images={images.map(x=>x.id)}/>}
