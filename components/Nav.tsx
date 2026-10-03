"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

/** Active state follows the route. It used to be hardcoded to Action Board, so every
 *  page highlighted a link the reader was not on. */
const links: Array<[string, string]> = [
  ["/today", "Vandaag"],
  ["/action-board", "Overzicht"],
  ["/discover", "Discover"],
  ["/alerts", "Alerts"],
  ["/validation", "Validation"],
  ["/system", "System"],
];

export function Nav() {
  const path = usePathname() ?? "";
  return (
    <nav className="nav">
      <div className="nav-inner">
        <Link href="/today" className="brand">
          Aureus<small>Intelligence · private alpha</small>
        </Link>
        {links.map(([href, label]) => {
          const active = path === href || path.startsWith(`${href}/`);
          return (
            <Link key={href} href={href} className={`link${active ? " active" : ""}`} aria-current={active ? "page" : undefined}>
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
