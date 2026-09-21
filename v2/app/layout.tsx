import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Rabotec Fleet Compliance',
  description: 'Vehicle roadworthy and insurance tracking for Abore Pit and Esaase Pit.',
};

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
