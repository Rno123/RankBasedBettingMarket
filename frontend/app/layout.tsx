import type { Metadata } from "next";
import { Archivo_Black, Inter, JetBrains_Mono } from "next/font/google";
import Providers from "./providers";
import "./globals.css";

const archivoBlack = Archivo_Black({ subsets: ["latin"], weight: "400", variable: "--font-display-archivo" });
const inter        = Inter({ subsets: ["latin"], variable: "--font-ui" });
const jetbrains    = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono-jb" });

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
    <html lang="en" style={{ height: "100%" }} className={`${archivoBlack.variable} ${inter.variable} ${jetbrains.variable}`}>
      <head>
        {/* Prevent flash of wrong theme on load */}
        <script dangerouslySetInnerHTML={{ __html: `(function(){var t=localStorage.getItem('theme')||'dark';if(t==='dark')document.documentElement.classList.add('dark');})();` }} />
      </head>
      <body style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
        <Providers>{children}</Providers>
        <footer style={{ marginTop: "auto", borderTop: "1px solid var(--c-divider)", background: "var(--card-bg)", padding: "20px 16px", textAlign: "center" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "24px", flexWrap: "wrap" }}>
            <a
              href="https://x.com/HackBetter"
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "0.8125rem", fontWeight: 500, color: "var(--c-text-3)", textDecoration: "none", transition: "color 0.15s" }}
            >
              <svg style={{ height: "16px", width: "16px", fill: "currentColor" }} viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
              @HackBetter
            </a>
            <a
              href="https://forms.gle/ZDqZEajPk2zEFsDKA"
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: "inline-flex", alignItems: "center", gap: "6px", padding: "6px 14px", borderRadius: "8px", border: "1px solid var(--c-divider)", background: "var(--card-bg-alt)", fontSize: "0.8125rem", fontWeight: 600, color: "var(--c-text-2)", textDecoration: "none", transition: "background 0.15s" }}
            >
              Contact Us
            </a>
          </div>
        </footer>
      </body>
    </html>
  );
}
