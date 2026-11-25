'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth0 } from '@auth0/auth0-react';
import s from './Topbar.module.css';

function initials(name) {
  if (!name) return '?';
  return name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

export default function Topbar({ title, group, onOpenNav }) {
  const router = useRouter();
  const pathname = usePathname();
  const { logout, user } = useAuth0();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  const userName = user?.name || user?.nickname || 'Account';
  const userEmail = user?.email || '';

  // Close the account menu on outside click or Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = e => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); };
    const onKey = e => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [menuOpen]);

  useEffect(() => { setMenuOpen(false); }, [pathname]);

  function signOut() {
    logout({ logoutParams: { returnTo: window.location.origin } });
  }

  return (
    <header className={s.topbar}>
      <button type="button" className={s.menuBtn} onClick={onOpenNav} aria-label="Open navigation">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
      </button>

      <nav className={s.crumbs} aria-label="Breadcrumb">
        {group && <span className={s.crumbGroup}>{group}</span>}
        {group && <span className={s.crumbSep} aria-hidden="true">/</span>}
        <span className={s.crumbCurrent} aria-current="page">{title}</span>
      </nav>

      <div className={s.right}>
        {pathname !== '/portal/quote' && (
          <button type="button" className="btn-primary btn-sm" onClick={() => router.push('/portal/quote')}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
            New quote
          </button>
        )}

        <div className={s.account} ref={menuRef}>
          <button
            type="button"
            className={s.accountBtn}
            onClick={() => setMenuOpen(o => !o)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <span className={s.avatar} aria-hidden="true">{initials(userName)}</span>
            <span className={s.accountName}>{userName}</span>
            <svg width="10" height="6" viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg>
          </button>

          {menuOpen && (
            <div className={s.menu} role="menu">
              <div className={s.menuHead}>
                <div className={s.menuName}>{userName}</div>
                {userEmail && <div className={s.menuEmail}>{userEmail}</div>}
              </div>
              <Link href="/portal/profile" className={s.menuItem} role="menuitem">Profile</Link>
              <Link href="/portal/billing" className={s.menuItem} role="menuitem">Billing</Link>
              <div className={s.menuSep} />
              <button type="button" className={s.menuItem} role="menuitem" onClick={signOut}>Sign out</button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
