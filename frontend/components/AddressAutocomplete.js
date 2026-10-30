'use client';
import { useEffect, useRef, useState } from 'react';
import { fetchAPI } from '@/lib/api';
import s from './AddressAutocomplete.module.css';

const statusPromises = {}; // one /status check per endpoint base, shared by every instance on the page
function checkEnabled(base) {
  if (!statusPromises[base]) statusPromises[base] = fetchAPI(`${base}/status`).then(r => !!r.enabled).catch(() => false);
  return statusPromises[base];
}

const newSessionToken = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

// Google-style address search. Picking a suggestion calls onSelect({ street, city, province,
// postalCode, country, formatted }). Renders nothing when no Places API key is configured,
// so the manual fields below it keep working on their own.
//
// Optional:
//   publicAccess — use the rate-limited public endpoints (guest pages, no login)
//   value/onChange — controlled text: typing is kept as free text; picking a suggestion fills it
//                    (a controlled field still renders as a plain input when Places is off)
//   bare — render only the input and suggestion list (the parent supplies the label)
//   id, inputClassName — passed to the input
export default function AddressAutocomplete({ label, placeholder, onSelect, publicAccess = false, value, onChange, bare = false, id, inputClassName }) {
  const base = publicAccess ? '/api/places/public' : '/api/places';
  const controlled = value !== undefined;
  const [enabled, setEnabled] = useState(false);
  const [ownQuery, setOwnQuery] = useState('');
  const query = controlled ? value : ownQuery;
  const setQuery = controlled ? (v => onChange?.(v)) : setOwnQuery;
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const session = useRef(newSessionToken());
  const skipNextSearch = useRef(false);
  const boxRef = useRef(null);

  useEffect(() => { checkEnabled(base).then(setEnabled); }, [base]);

  useEffect(() => {
    if (!enabled) return undefined;
    if (skipNextSearch.current) { skipNextSearch.current = false; return undefined; }
    if (query.trim().length < 3) { setSuggestions([]); return undefined; }
    const t = setTimeout(async () => {
      try {
        const qs = new URLSearchParams({ input: query, sessionToken: session.current });
        const { suggestions: list } = await fetchAPI(`${base}/autocomplete?${qs}`);
        setSuggestions(list || []);
        setActive(-1);
        setOpen(true);
      } catch { setSuggestions([]); }
    }, 250);
    return () => clearTimeout(t);
  }, [query, enabled, base]);

  useEffect(() => {
    const close = e => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  async function choose(sug) {
    setOpen(false);
    setLoading(true);
    try {
      const qs = new URLSearchParams({ sessionToken: session.current });
      const { address } = await fetchAPI(`${base}/details/${sug.placeId}?${qs}`);
      skipNextSearch.current = true;
      setQuery(address.formatted || sug.text);
      onSelect(address);
    } catch {
      // Lookup failed — the user can still type the fields manually.
    } finally {
      setLoading(false);
      session.current = newSessionToken(); // a new billing session for the next address
    }
  }

  function onKeyDown(e) {
    if (!open || !suggestions.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, suggestions.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); choose(suggestions[active]); }
    else if (e.key === 'Escape') setOpen(false);
  }

  if (!enabled) {
    return controlled
      ? <input id={id} className={inputClassName} value={query} placeholder={placeholder} onChange={e => setQuery(e.target.value)} />
      : null;
  }

  return (
    <div className={bare ? s.wrap : `field ${s.wrap}`} ref={boxRef}>
      {!bare && <label>{label}</label>}
      <input
        id={id}
        className={inputClassName}
        value={query}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        onChange={e => setQuery(e.target.value)}
        onFocus={() => suggestions.length && setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {loading && <div className={s.status}>Filling in address…</div>}
      {open && suggestions.length > 0 && (
        <ul className={s.list} role="listbox">
          {suggestions.map((sug, i) => (
            <li
              key={sug.placeId}
              role="option"
              aria-selected={i === active}
              className={`${s.item} ${i === active ? s.active : ''}`}
              onMouseDown={e => { e.preventDefault(); choose(sug); }}
              onMouseEnter={() => setActive(i)}
            >
              <span className={s.main}>{sug.mainText}</span>
              <span className={s.secondary}>{sug.secondaryText}</span>
            </li>
          ))}
          <li className={s.powered}>Powered by Google</li>
        </ul>
      )}
    </div>
  );
}
