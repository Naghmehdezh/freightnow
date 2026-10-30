'use client';
import s from './PackageGroups.module.css';

// Groups of identical pieces for air / ocean LCL spot rates, e.g. 2 pieces of 20 × 30 × 40 cm,
// then "Add package group" for the remaining pieces. Volume weight (kg) per piece is
// L×W×H / 6000 in cm, or L×W×H / 366 in inches.
export const emptyGroup = () => ({ pieces: '', length: '', width: '', height: '', unit: 'cm' });

export function groupVolumeKg(g) {
  const n = parseInt(g.pieces), l = parseFloat(g.length), w = parseFloat(g.width), h = parseFloat(g.height);
  if (!(n > 0 && l > 0 && w > 0 && h > 0)) return null;
  return Math.round(((l * w * h) / (g.unit === 'in' ? 366 : 6000)) * n * 100) / 100;
}

export function groupTotals(groups, totalWeightKg) {
  const pieces = groups.reduce((sum, g) => sum + (parseInt(g.pieces) || 0), 0);
  const volume = Math.round(groups.reduce((sum, g) => sum + (groupVolumeKg(g) || 0), 0) * 100) / 100;
  const actual = parseFloat(totalWeightKg) || 0;
  return { pieces, volume, actual, chargeable: Math.max(actual, volume) };
}

export default function PackageGroups({ groups, onChange, totalWeightKg }) {
  const update = (i, field, value) => onChange(groups.map((g, j) => (j === i ? { ...g, [field]: value } : g)));
  const remove = i => onChange(groups.length > 1 ? groups.filter((_, j) => j !== i) : [emptyGroup()]);
  const totals = groupTotals(groups, totalWeightKg);
  const fmt = n => n.toLocaleString('en-CA', { maximumFractionDigits: 2 });

  return (
    <div className={s.wrap}>
      <div className={s.head}>Package groups <span>Enter the pieces and dimensions — totals update automatically</span></div>
      {groups.map((g, i) => {
        const vol = groupVolumeKg(g);
        return (
          <div key={i} className={s.group}>
            <div className={s.groupTop}>
              <span className={s.unitLabel}>Dims:</span>
              {['cm', 'in'].map(u => (
                <button key={u} type="button" className={`${s.unitBtn} ${g.unit === u ? s.unitActive : ''}`} onClick={() => update(i, 'unit', u)}>{u.toUpperCase()}</button>
              ))}
              <button type="button" className={s.remove} onClick={() => remove(i)} aria-label="Remove package group">×</button>
            </div>
            <div className={s.row}>
              <div className="field"><label>Pieces</label><input type="number" min="1" value={g.pieces} onChange={e => update(i, 'pieces', e.target.value)} /></div>
              <div className="field"><label>L ({g.unit})</label><input type="number" min="0" step="any" value={g.length} onChange={e => update(i, 'length', e.target.value)} /></div>
              <div className="field"><label>W ({g.unit})</label><input type="number" min="0" step="any" value={g.width} onChange={e => update(i, 'width', e.target.value)} /></div>
              <div className="field"><label>H ({g.unit})</label><input type="number" min="0" step="any" value={g.height} onChange={e => update(i, 'height', e.target.value)} /></div>
            </div>
            <div className={s.groupFoot}>
              Pcs: <b>{parseInt(g.pieces) || '—'}</b> · Volume weight: <b>{vol != null ? `${fmt(vol)} kg` : '—'}</b>
            </div>
          </div>
        );
      })}
      <button type="button" className={s.add} onClick={() => onChange([...groups, emptyGroup()])}>+ Add package group</button>
      <div className={s.totals}>
        Total pieces: <b>{totals.pieces}</b> · Actual weight: <b>{fmt(totals.actual)} kg</b> · Volume weight: <b>{fmt(totals.volume)} kg</b> · Chargeable weight: <b>{fmt(totals.chargeable)} kg</b>
      </div>
    </div>
  );
}
