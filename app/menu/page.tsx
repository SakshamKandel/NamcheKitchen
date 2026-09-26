import PageSections from '@/components/PageSections';
import Link from 'next/link';
import { getMenu } from '@/lib/db';
import MenuExplorer from '@/components/MenuExplorer';
import { PageIntro } from '@/components/Shared';
export const dynamic='force-dynamic';
export const metadata={title:'Our Menu'};
export default async function MenuPage(){return <><PageIntro label="MADE WITH CARE. MEANT TO BE SHARED." title="A TASTE OF NEPAL."><p>From street-food favourites to slow-simmered comforts.<br/>Find something familiar—or your new favourite.</p></PageIntro><div className="menu-tabs"><Link href="/menu" aria-current="page">Food menu</Link><Link href="/drinks">Drinks & bar</Link><a href="https://online.namchekitchen.ca/">Order online ↗</a></div><MenuExplorer items={await getMenu()}/><PageSections page="menu"/></>}
