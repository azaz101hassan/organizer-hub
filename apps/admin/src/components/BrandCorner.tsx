import Link from "next/link";

export function BrandCorner() {
  return (
    <div className="ad__brand">
      <Link href="/" className="brand" style={{ textDecoration: "none" }}>
        <span
          className="brand__mark"
          aria-hidden="true"
          style={{ fontSize: 22, lineHeight: 1 }}
        >
          OH
        </span>
        <span className="brand__name">OrganizerHub</span>
      </Link>
      <span className="ad__brand-tag">Admin</span>
    </div>
  );
}
