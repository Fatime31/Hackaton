import { Link } from "react-router-dom";

export default function Brand() {
  return (
    <Link to="/" className="brand">
      <svg className="reel" viewBox="0 0 32 32" fill="none">
        <circle cx="16" cy="16" r="14" stroke="var(--accent-lamp)" strokeWidth="1.6" />
        <circle cx="16" cy="16" r="3" fill="var(--accent-lamp)" />
        <circle cx="16" cy="7" r="2.3" stroke="var(--accent-lamp)" strokeWidth="1.4" />
        <circle cx="24.5" cy="20.5" r="2.3" stroke="var(--accent-lamp)" strokeWidth="1.4" />
        <circle cx="7.5" cy="20.5" r="2.3" stroke="var(--accent-lamp)" strokeWidth="1.4" />
      </svg>
      <div className="brand-text">
        <b>Watch Together</b>
        <span>Salle de projection virtuelle</span>
      </div>
    </Link>
  );
}
