import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Outreach Agent — Traininglobe',
  description: 'AI-assisted institutional outreach: research, verify, approve, follow up.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/*
          Apply the saved theme before first paint so a dark-mode user never sees a
          white flash on load.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');if(t)document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`,
          }}
        />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
