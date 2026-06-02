import { Display, Eyebrow, Icon, Lede, Poster } from "@organizer-hub/web-shared/ui";

export const metadata = {
  title: "Sign in — OrganizerHub",
};

function safeNext(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;
  if (!raw.startsWith("/")) return null;
  if (raw.startsWith("//")) return null;
  return raw;
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  const continueHref = next
    ? `/auth/login/authorize?next=${encodeURIComponent(next)}`
    : "/auth/login/authorize";
  return (
    <div
      className="scene"
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
        minHeight: "100vh",
      }}
    >
      {/* Left: branded poster panel */}
      <Poster mood="midnight" label="O" monoSize={420} style={{ height: "100vh" }}>
        <div
          style={{
            position: "absolute",
            zIndex: 2,
            inset: 0,
            padding: 48,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
          }}
        >
          <div className="brand">
            <span
              className="brand__mark"
              aria-hidden="true"
              style={{ background: "rgba(255,255,255,.15)", color: "#fff" }}
            >
              O
            </span>
            <span className="brand__name" style={{ color: "#fff" }}>
              OrganizerHub
            </span>
          </div>
          <div>
            <Display
              as="h2"
              style={{ color: "#fff", fontSize: 38, maxWidth: 360, lineHeight: 1.08 }}
            >
              One pane of glass for event organizers.
            </Display>
            <Lede
              style={{
                color: "rgba(255,255,255,.72)",
                marginTop: 16,
                maxWidth: 340,
                fontSize: 16,
              }}
            >
              Manage your societies, claim your seats, and track your evenings.
            </Lede>
          </div>
        </div>
      </Poster>

      {/* Right: sign-in form */}
      <div
        style={{
          display: "grid",
          placeItems: "center",
          padding: 40,
          background: "var(--bg)",
        }}
      >
        <div style={{ width: "100%", maxWidth: 380 }}>
          <Eyebrow>Welcome back</Eyebrow>
          <Display as="h1" size="md" style={{ margin: "12px 0 6px" }}>
            Sign in
          </Display>
          <p
            className="muted"
            style={{ fontSize: 14, marginBottom: 32, lineHeight: 1.5 }}
          >
            You&apos;ll be redirected to the authentication provider to verify
            your identity.
          </p>
          <a
            href={continueHref}
            className="btn btn--primary btn--lg btn--block"
            aria-label="Sign in to OrganizerHub"
          >
            Continue <Icon name="arrowR" size={16} />
          </a>
          <p
            className="faint"
            style={{ fontSize: 12, marginTop: 20, textAlign: "center" }}
          >
            New here?{" "}
            <a href="/membership" className="link" style={{ fontSize: 12 }}>
              View membership options
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
