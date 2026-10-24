import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {title: 'BrandForge AI | Brand compliance', description: 'Check brand content against approved guidelines with BrandDNA and BrandTwin.'};
export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) {return <html lang="en"><body>{children}</body></html>;}
