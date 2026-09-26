import type { Metadata } from 'next';
import { Oswald, DM_Sans } from 'next/font/google';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import CookieControls from '@/components/CookieControls';
import Motion from '@/components/Motion';
import './globals.css';

const display=Oswald({subsets:['latin'],variable:'--font-display',weight:['400','500','600']});
const body=DM_Sans({subsets:['latin'],variable:'--font-body'});
export const metadata:Metadata={title:{default:'Namche Kitchen | The Taste of Nepal · Ottawa',template:'%s | Namche Kitchen'},description:'Authentic Nepali flavours, lovingly prepared and warmly served at 1230 Wellington St. W, Ottawa. Explore our menu, order online, or request a table.'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body className={`${display.variable} ${body.variable}`}><a href="#main" className="skip-link">Skip to content</a><Header/><main id="main">{children}</main><Footer/><Motion/><CookieControls/></body></html>}
