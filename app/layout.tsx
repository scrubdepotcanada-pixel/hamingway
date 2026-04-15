import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Hemingway — Content Agent',
  description: 'Automated content agent for The Web Guys portfolio.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
