'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import useRole from '@/lib/useRole';
import s from './Sidebar.module.css';

// Grouped by what people do: ship things, manage the account, and (IFF only) run operations.
const GROUPS = [
  {
    items: [
      { href: '/portal', label: 'Dashboard', icon: 'dashboard' },
    ],
  },
  {
    label: 'Shipping',
    items: [
      { href: '/portal/quote', label: 'Get a quote', icon: 'quote' },
      { href: '/portal/shipments', label: 'Shipments', icon: 'truck' },
      { href: '/portal/spot-rates', label: 'Spot-rate requests', icon: 'request' },
      { href: '/portal/track', label: 'Track a shipment', icon: 'pin' },
      { href: '/portal/claims', label: 'Claims', icon: 'claim' },
    ],
  },
  {
    label: 'Account',
    items: [
      { href: '/portal/billing', label: 'Billing', icon: 'card' },
      { href: '/portal/profile', label: 'Profile', icon: 'user' },
    ],
  },
  {
    // Shown only to IFF staff / admins; the pages themselves are also role-guarded server-side.
    label: 'IFF operations',
    roles: ['iff_staff', 'iff_admin'],
    items: [
      { href: '/portal/admin/spot-rates', label: 'Spot rates', icon: 'request' },
      { href: '/portal/admin/guest-quotes', label: 'Guest requests', icon: 'inbox' },
      { href: '/portal/admin/adjustments', label: 'Adjustments', icon: 'scale' },
      { href: '/portal/admin/accounts', label: 'Accounts', icon: 'building' },
      { href: '/portal/admin/pricing', label: 'Pricing', icon: 'chart', roles: ['iff_admin'] },
    ],
  },
];

const P = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };
const ICONS = {
  dashboard: <svg {...P}><path d="M4 4h7v9H4zM13 4h7v5h-7zM13 11h7v9h-7zM4 15h7v5H4z"/></svg>,
  quote: <svg {...P}><path d="M4 7h16M4 12h10M4 17h7"/><path d="M17 14l3 3-3 3"/></svg>,
  truck: <svg {...P}><path d="M2 6h12v10H2zM14 9h4l3 4v3h-7z"/><circle cx="6" cy="18" r="1.8"/><circle cx="17" cy="18" r="1.8"/></svg>,
  request: <svg {...P}><path d="M5 3h10l4 4v14H5z"/><path d="M15 3v4h4M9 12h6M9 16h4"/></svg>,
  pin: <svg {...P}><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>,
  claim: <svg {...P}><path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z"/><path d="M12 8v5M12 16v.5"/></svg>,
  card: <svg {...P}><rect x="3" y="5" width="18" height="14" rx="1.5"/><path d="M3 10h18M7 15h4"/></svg>,
  user: <svg {...P}><circle cx="12" cy="8" r="4"/><path d="M4 21c1.2-4 4.2-6 8-6s6.8 2 8 6"/></svg>,
  inbox: <svg {...P}><path d="M3 13l3-8h12l3 8v6H3z"/><path d="M3 13h5l1 3h6l1-3h5"/></svg>,
  scale: <svg {...P}><path d="M12 4v16M5 20h14M6 8h12"/><path d="M6 8l-3 6a3 3 0 0 0 6 0zM18 8l-3 6a3 3 0 0 0 6 0z"/></svg>,
  building: <svg {...P}><path d="M4 21V5l8-2v18M12 9h8v12M8 8v.5M8 12v.5M8 16v.5M16 13v.5M16 17v.5M2 21h20"/></svg>,
  chart: <svg {...P}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>,
  site: <svg {...P}><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/></svg>,
  collapse: <svg {...P}><rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M9 4v16M15 10l-2 2 2 2"/></svg>,
  expand: <svg {...P}><rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M9 4v16M13 10l2 2-2 2"/></svg>,
};

function isActive(pathname, href) {
  return href === '/portal' ? pathname === '/portal' : pathname.startsWith(href);
}

export default function Sidebar({ collapsed = false, onToggleCollapse, open = false, onClose }) {
  const pathname = usePathname();
  const { role } = useRole();

  const groups = GROUPS
    .filter(g => !g.roles || g.roles.includes(role))
    .map(g => ({ ...g, items: g.items.filter(i => !i.roles || i.roles.includes(role)) }))
    .filter(g => g.items.length);

  const cls = [s.sidebar, collapsed ? s.collapsed : '', open ? s.open : ''].join(' ');

  return (
    <>
      <div className={`${s.scrim} ${open ? s.scrimOn : ''}`} onClick={onClose} aria-hidden="true" />
      <aside className={cls} aria-label="Main navigation">
        <div className={s.brand}>
          <Link href="/portal" className={s.brandLink} onClick={onClose}>
            <img src="/logo-white.svg" alt="IFF Cargo" className={s.logo} />
          </Link>
        </div>

        <nav className={s.nav}>
          {groups.map((g, gi) => (
            <div key={gi} className={s.group}>
              {g.label && <div className={s.groupLabel}>{g.label}</div>}
              {g.items.map(item => {
                const active = isActive(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`${s.item} ${active ? s.active : ''}`}
                    aria-current={active ? 'page' : undefined}
                    title={collapsed ? item.label : undefined}
                    onClick={onClose}
                  >
                    {ICONS[item.icon]}
                    <span className={s.label}>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className={s.footer}>
          <Link href="/" className={s.item} title={collapsed ? 'IFF Cargo website' : undefined}>
            {ICONS.site}
            <span className={s.label}>IFF Cargo website</span>
          </Link>
          <button
            type="button"
            className={`${s.item} ${s.collapseBtn}`}
            onClick={onToggleCollapse}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : undefined}
          >
            {collapsed ? ICONS.expand : ICONS.collapse}
            <span className={s.label}>Collapse</span>
          </button>
        </div>
      </aside>
    </>
  );
}
