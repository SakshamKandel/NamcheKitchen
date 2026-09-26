import PageSections from '@/components/PageSections';
import Link from 'next/link';
import { getMenu } from '@/lib/db';
import MenuExplorer from '@/components/MenuExplorer';
import { PageIntro } from '@/components/Shared';
export const dynamic='force-dynamic';
export const metadata={title:'Drinks & Bar'};
export default async function Drinks(){const drinks=(await getMenu('drink')).filter(item=>!['Himalayan Cocktails','Beers','Wines','Spirits & Digestifs'].includes(item.category));return <><PageIntro label="RAISE A GLASS. STAY A WHILE." title="HIMALAYAN SPIRIT."><p>Traditional teas, bright mocktails, signature cocktails, and a full-service bar.<br/>Join us in the restaurant for our drinks selection.</p></PageIntro><div className="menu-tabs"><Link href="/menu">Food menu</Link><Link href="/drinks" aria-current="page">Drinks & bar</Link></div><div className="beverage-notice">Online beverage orders are limited to juice and canned non-alcoholic drinks. All other beverages are available in the restaurant;</div><MenuExplorer items={drinks} kind="drink"/><PageSections page="drinks"/></>}
