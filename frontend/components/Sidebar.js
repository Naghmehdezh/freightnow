'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth0 } from '@auth0/auth0-react';
import useRole from '@/lib/useRole';
import s from './Sidebar.module.css';

const NAV_ITEMS = [
  { section: 'Main' },
  { href: '/portal/quote', label: 'Get a quote', icon: 'search' },
  { href: '/portal', label: 'Dashboard', icon: 'dashboard' },
  { href: '/portal/shipments', label: 'My shipments', icon: 'truck' },
  { href: '/portal/spot-rates', label: 'Spot-rate requests', icon: 'tag' },
  { href: '/portal/track', label: 'Track shipment', icon: 'pin' },
  { href: '/portal/claims', label: 'Claims', icon: 'file' },
  { section: 'Account' },
  { href: '/portal/profile', label: 'Profile', icon: 'user' },
  { href: '/portal/billing', label: 'Billing', icon: 'card' },
  { href: '/', label: 'Back to website', icon: 'home' },
];

// Shown only to IFF staff / admins — the pages themselves are also role-guarded server-side.
const ADMIN_ITEMS = [
  { section: 'IFF Admin' },
  { href: '/portal/admin/spot-rates', label: 'Spot rates', icon: 'tag', roles: ['iff_staff', 'iff_admin'] },
  { href: '/portal/admin/guest-quotes', label: 'Guest requests', icon: 'user', roles: ['iff_staff', 'iff_admin'] },
  { href: '/portal/admin/pricing', label: 'Pricing', icon: 'chart', roles: ['iff_admin'] },
];

const ICONS = {
  search: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>,
  dashboard: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>,
  truck: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="1" y="3" width="15" height="13" rx="1"/><path d="M16 8h4l3 5v3h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>,
  pin: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>,
  file: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>,
  user: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
  card: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>,
  tag: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>,
  chart: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
  home: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
  logout: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>,
};

export default function Sidebar() {
  const pathname = usePathname();
  const { logout, user: auth0User } = useAuth0();
  const { role } = useRole();
  const adminItems = ADMIN_ITEMS.filter(i => !i.roles || i.roles.includes(role));
  const navItems = adminItems.some(i => i.href) ? [...NAV_ITEMS, ...adminItems] : NAV_ITEMS;

  function handleSignOut() {
    logout({ logoutParams: { returnTo: window.location.origin } });
  }

  function getInitials(name) {
    if (!name) return '?';
    return name.split(' ').map(w => w[0]).join('').toUpperCase();
  }

  const userName = auth0User?.name || auth0User?.nickname || 'User';
  const userEmail = auth0User?.email || '';

  return (
    <aside className={s.sidebar}>
      <div className={s.logo}>
        <Link href="/">
          <img src="/logo-white.svg" alt="IFF" />
        </Link>
      </div>

      <div className={s.user}>
        <div className={s.avatar}>{getInitials(userName)}</div>
        <div className={s.name}>{userName}</div>
        <div className={s.email}>{userEmail}</div>
      </div>

      <nav className={s.nav}>
        {navItems.map((item, i) => {
          if (item.section) {
            return <div key={i} className={s.section}>{item.section}</div>;
          }
          const isActive = item.href === '/portal'
            ? pathname === '/portal'
            : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`${s.item} ${isActive ? s.active : ''}`}
            >
              {ICONS[item.icon]}
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className={s.bottom}>
        <button onClick={handleSignOut} className={s.item} style={{ border: 'none', background: 'none', width: '100%' }}>
          {ICONS.logout}
          <span>Sign out</span>
        </button>
      </div>
    </aside>
  );
}
