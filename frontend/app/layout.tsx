import type { Metadata } from "next";
import Providers from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "HackBet — Back the builders you believe in",
  description:
    "Back hackathon builders with real USDC. On-chain conviction signals — earn rewards when your picks place.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full">
      <head>
        {/* Prevent flash of wrong theme on load */}
        <script dangerouslySetInnerHTML={{ __html: `(function(){var t=localStorage.getItem('theme')||'dark';if(t==='dark')document.documentElement.classList.add('dark');})();` }} />
      </head>
      <body className="min-h-full bg-gradient-to-br from-indigo-50 via-white to-violet-50 font-sans antialiased dark:bg-[#08080f] dark:bg-none">
        {/* Ambient glow — dark mode only */}
        <div className="pointer-events-none fixed inset-0 -z-10 hidden overflow-hidden dark:block">
          <div className="absolute -top-40 right-1/4 h-[700px] w-[700px] rounded-full bg-indigo-600/20 blur-[140px]" />
          <div className="absolute bottom-0 left-0 h-[500px] w-[500px] rounded-full bg-violet-700/15 blur-[120px]" />
        </div>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
