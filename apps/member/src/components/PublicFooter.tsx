import Link from "next/link";

export function PublicFooter() {
  return (
    <footer
      className="container container--wide"
      style={{
        padding: "44px 28px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 16,
      }}
    >
      <Link href="/" className="brand">
        <span className="brand__mark" aria-hidden="true">
          O
        </span>
        <span className="brand__name">OrganizerHub</span>
      </Link>
      <p className="faint" style={{ fontSize: 13 }}>
        One pane of glass for event organizers.
      </p>
    </footer>
  );
}
