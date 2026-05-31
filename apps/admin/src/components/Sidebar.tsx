import { NavItem } from "@organizer-hub/web-shared/ui";
import { ADMIN_NAV } from "./AdminNav";

export function Sidebar() {
  return (
    <nav className="ad__side" aria-label="Admin navigation">
      {ADMIN_NAV.map((group) => (
        <div key={group.label}>
          <div className="ad__group">{group.label}</div>
          {group.items.map((item) => (
            <NavItem
              key={item.href}
              href={item.href}
              icon={item.icon}
              exact={item.exact ?? item.href === "/"}
            >
              {item.label}
            </NavItem>
          ))}
        </div>
      ))}
    </nav>
  );
}
