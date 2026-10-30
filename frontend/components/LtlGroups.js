'use client';
import { estimateFreightClass, FREIGHT_CLASSES } from '@/lib/freightClass';
import s from './PackageGroups.module.css';

// LTL pieces as groups of identical pieces: pieces, L × W × H (in), weight per piece (lb) and a
// freight class per group — calculated from that group's density unless the customer picks one.
export const emptyLtlGroup = () => ({ pieces: '', length: '', width: '', height: '', weight: '', freightClass: 'auto' });

const num = v => parseFloat(v);

export function ltlGroupClass(g) {
  if (g.freightClass && g.freightClass !== 'auto') return { freightClass: g.freightClass, density: null, manual: true };
  const pieces = parseInt(g.pieces) || 0;
  const auto = estimateFreightClass({ weight: num(g.weight) * pieces, pieces, length: g.length, width: g.width, height: g.height });
  return auto ? { ...auto, manual: false } : null;
}

export function ltlGroupComplete(g) {
  return parseInt(g.pieces) > 0 && num(g.length) > 0 && num(g.width) > 0 && num(g.height) > 0 && num(g.weight) > 0;
}

export function ltlTotals(groups) {
  return {
    pieces: groups.reduce((sum, g) => sum + (parseInt(g.pieces) || 0), 0),
    weight: Math.round(groups.reduce((sum, g) => sum + (parseInt(g.pieces) || 0) * (num(g.weight) || 0), 0) * 10) / 10,
  };
}

export default function LtlGroups({ groups, onChange }) {
  const update = (i, field, value) => onChange(groups.map((g, j) => (j === i ? { ...g, [field]: value } : g)));
  const remove = i => onChange(groups.length > 1 ? groups.filter((_, j) => j !== i) : [emptyLtlGroup()]);
  const totals = ltlTotals(groups);

  return (
    <div className={s.wrap}>
      <div className={s.head}>Pieces <span>One row per group of identical pieces (same size and weight)</span></div>
      {groups.map((g, i) => {
        const cls = ltlGroupClass(g);
        const groupWeight = (parseInt(g.pieces) || 0) * (num(g.weight) || 0);
        return (
          <div key={i} className={s.group}>
            <div className={s.groupTop}>
              <span className={s.unitLabel}>Group {i + 1}</span>
              <button type="button" className={s.remove} onClick={() => remove(i)} aria-label="Remove group">×</button>
            </div>
            <div className={s.row6}>
              <div className="field"><label>Pieces *</label><input type="number" min="1" step="1" value={g.pieces} onChange={e => update(i, 'pieces', e.target.value)} /></div>
              <div className="field"><label>L (in) *</label><input type="number" min="0" step="any" value={g.length} onChange={e => update(i, 'length', e.target.value)} /></div>
              <div className="field"><label>W (in) *</label><input type="number" min="0" step="any" value={g.width} onChange={e => update(i, 'width', e.target.value)} /></div>
              <div className="field"><label>H (in) *</label><input type="number" min="0" step="any" value={g.height} onChange={e => update(i, 'height', e.target.value)} /></div>
              <div className="field"><label>Wt / piece (lb) *</label><input type="number" min="0" step="any" value={g.weight} onChange={e => update(i, 'weight', e.target.value)} /></div>
              <div className="field"><label>Freight class</label>
                <select value={g.freightClass} onChange={e => update(i, 'freightClass', e.target.value)}>
                  <option value="auto">{cls && !cls.manual ? `Auto — ${cls.freightClass}` : 'Auto'}</option>
                  {FREIGHT_CLASSES.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
            </div>
            <div className={s.groupFoot}>
              Group weight: <b>{groupWeight ? `${groupWeight.toLocaleString('en-CA')} lb` : '—'}</b>
              {cls?.density != null && <> · Density: <b>{cls.density} lb/ft³</b></>}
            </div>
          </div>
        );
      })}
      <button type="button" className={s.add} onClick={() => onChange([...groups, emptyLtlGroup()])}>+ Add group</button>
      <div className={s.totals}>
        Total pieces: <b>{totals.pieces}</b> · Total weight: <b>{totals.weight.toLocaleString('en-CA')} lb</b>
      </div>
    </div>
  );
}
