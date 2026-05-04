import Link from "next/link";
import Navbar from "@/components/Navbar";

const audienceCards = [
  {
    title: "Community",
    lightSrc: "/landing/community-light.png",
    darkSrc: "/landing/community-dark.png",
    alt: "Community audience illustration",
    body: "Support your favourite builders. Stake USDC on undervalued projects.",
    cta: { label: "Hackathons", href: "/hackathons" },
  },
  {
    title: "Builders",
    lightSrc: "/landing/builder-light.png",
    darkSrc: "/landing/builder-dark.png",
    alt: "Builder audience illustration",
    body: "Find market validation for your ideas or increase your project's visibility.",
    cta: { label: "Dev Portal", href: "/devs" },
  },
  {
    title: "Organizers",
    lightSrc: "/landing/organizer-light.png",
    darkSrc: "/landing/organizer-dark.png",
    alt: "Organiser audience illustration",
    body: "Organizing a hackathon? We'd love to work with you. Get in touch here.",
    cta: { label: "Get in touch", href: "https://forms.gle/bppkdxJQWCATqnz99" },
  },
];

function PlaceholderBadge({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        display: "inline-flex",
        width: "fit-content",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "9999px",
        border: "1px solid var(--c-orange-border)",
        background: "var(--c-orange-light)",
        padding: "8px 16px",
        fontSize: "0.82rem",
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        color: "var(--c-orange-text)",
      }}
    >
      {children}
    </span>
  );
}

export default function HomePage() {
  return (
    <div style={{ minHeight: "100vh" }}>
      <div className="ambient-glow">
        <div style={{ position: "absolute", top: "-160px", right: "25%", height: "700px", width: "700px", borderRadius: "9999px", background: "rgba(255,91,20,0.18)", filter: "blur(140px)" }} />
        <div style={{ position: "absolute", bottom: 0, left: 0, height: "500px", width: "500px", borderRadius: "9999px", background: "rgba(255,91,20,0.10)", filter: "blur(120px)" }} />
      </div>

      <Navbar />

      <main style={{ margin: "0 auto", maxWidth: "1200px", padding: "48px 20px 84px" }}>
        <section className="ui-card" style={{ overflow: "hidden" }}>
          <div style={{ borderBottom: "1px solid var(--c-divider)", padding: "clamp(36px, 7vw, 68px) clamp(24px, 7vw, 56px)" }}>
            <div style={{ margin: "0 auto", maxWidth: "700px", textAlign: "center" }}>
              <p style={{ margin: "0 0 16px", fontSize: "0.82rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--c-orange-text)" }}>
                Conviction markets for Hackathons
              </p>
              <h1 style={{ margin: 0, fontSize: "clamp(3.35rem, 12vw, 6.1rem)", fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.04em", lineHeight: 0.95 }}>
                <span style={{ color: "var(--c-text)" }}>HACK</span>
                <span style={{ color: "var(--c-indigo-text)" }}>BET</span>
              </h1>

              <div style={{ marginTop: "36px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "28px" }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "16px", padding: "10px 12px" }}>
                  <PlaceholderBadge>For stakers</PlaceholderBadge>
                  <Link href="/hackathons" className="ui-btn ui-btn-indigo mobile-fill" style={{ width: "100%", maxWidth: "250px", fontWeight: 800, fontSize: "1rem" }}>
                    Browse projects
                  </Link>
                </div>

                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "16px", padding: "10px 12px" }}>
                  <PlaceholderBadge>For builders</PlaceholderBadge>
                  <Link href="/devs" className="ui-btn ui-btn-indigo mobile-fill" style={{ width: "100%", maxWidth: "250px", fontWeight: 800, fontSize: "1rem" }}>
                    Submit projects
                  </Link>
                </div>
              </div>
            </div>
          </div>

          <div style={{ borderBottom: "1px solid var(--c-divider)", padding: "clamp(34px, 7vw, 56px) clamp(24px, 7vw, 56px)" }}>
            <div style={{ margin: "0 auto", maxWidth: "860px" }}>
              <h2 style={{ margin: "0 0 34px", textAlign: "center", fontSize: "1.35rem", fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.025em", color: "var(--c-text)" }}>
                Who we are for
              </h2>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "34px 28px" }}>
                {audienceCards.map((card) => (
                  <div key={card.title} style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
                    <div
                      style={{
                        display: "flex",
                        height: "136px",
                        width: "136px",
                        alignItems: "center",
                        justifyContent: "center",
                        borderRadius: "9999px",
                        background: "transparent",
                        overflow: "hidden",
                      }}
                    >
                      <img
                        src={card.lightSrc}
                        alt={card.alt}
                        className="landing-theme-image landing-theme-image-light"
                        style={{ height: "100%", width: "100%", objectFit: "contain" }}
                        loading="lazy"
                      />
                      <img
                        src={card.darkSrc}
                        alt={card.alt}
                        className="landing-theme-image landing-theme-image-dark"
                        style={{ height: "100%", width: "100%", objectFit: "contain" }}
                        loading="lazy"
                      />
                    </div>
                    <h3 style={{ margin: "20px 0 14px", fontSize: "1.08rem", fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.02em", color: "var(--c-text)" }}>
                      {card.title}
                    </h3>
                    <div
                      style={{
                        width: "100%",
                        maxWidth: "210px",
                        minHeight: "86px",
                        borderRadius: "20px",
                        background: "var(--card-bg-alt)",
                        padding: "16px 18px",
                        fontSize: "0.82rem",
                        color: "var(--c-text)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {card.body}
                    </div>
                    <Link
                      href={card.cta.href}
                      className="ui-btn ui-btn-indigo ui-btn-sm"
                      style={{ marginTop: "16px", fontWeight: 700, minWidth: "140px" }}
                      {...(card.cta.href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                    >
                      {card.cta.label}
                    </Link>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div style={{ padding: "clamp(30px, 6vw, 48px) clamp(24px, 7vw, 56px)", textAlign: "center" }}>
            <h2 style={{ margin: "0 0 22px", fontSize: "1.35rem", fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.025em", color: "var(--c-text)" }}>
              Partners and Sponsors
            </h2>
            <div style={{ margin: "0 auto", maxWidth: "520px", borderRadius: "22px", border: "1px dashed var(--c-orange-border)", background: "var(--card-bg-alt)", padding: "28px 22px", fontSize: "0.94rem", fontWeight: 600, color: "var(--c-text-4)" }}>
              Coming Soon
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
