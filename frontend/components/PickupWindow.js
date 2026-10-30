'use client';

// Pickup date plus the window the freight is ready: between 08:00 and 17:00, at least 4 hours
// (ready at 08:00 → close no earlier than 12:00). Times are local to the pickup address.

const EARLIEST = 8 * 60;
const LATEST = 17 * 60;
const MIN_WINDOW = 4 * 60;
const STEP = 30;

const toTime = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const toMinutes = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const label = t => {
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

const times = (from, to) => {
  const out = [];
  for (let m = from; m <= to; m += STEP) out.push(toTime(m));
  return out;
};

export const READY_TIMES = times(EARLIEST, LATEST - MIN_WINDOW);
export const closeTimesFor = ready => (ready ? times(toMinutes(ready) + MIN_WINDOW, LATEST) : []);

// showTimes: LTL always (a pickup is part of every LTL shipment); parcels and envelopes only with
// the Pickup option — otherwise the date is just the ship date.
export default function PickupWindow({ date, onDateChange, ready, onReadyChange, close, onCloseChange, showTimes = true }) {
  const closeOptions = closeTimesFor(ready);

  function changeReady(value) {
    onReadyChange(value);
    // Keep the close time only if it still leaves a 4-hour window.
    if (close && !closeTimesFor(value).includes(close)) onCloseChange('');
  }

  return (
    <div className="grid4" style={{ marginBottom: '10px' }}>
      <div className="field"><label>{showTimes ? 'Pickup date' : 'Ship date'}</label><input type="date" value={date} onChange={e => onDateChange(e.target.value)} /></div>
      {showTimes && <>
      <div className="field">
        <label>Ready time</label>
        <select value={ready} onChange={e => changeReady(e.target.value)}>
          <option value="">Select</option>
          {READY_TIMES.map(t => <option key={t} value={t}>{label(t)}</option>)}
        </select>
      </div>
      <div className="field">
        <label>Close time</label>
        <select value={close} onChange={e => onCloseChange(e.target.value)} disabled={!ready}>
          <option value="">{ready ? 'Select' : 'Choose ready time first'}</option>
          {closeOptions.map(t => <option key={t} value={t}>{label(t)}</option>)}
        </select>
      </div>
      <div className="field" style={{ alignSelf: 'end', fontSize: '12px', color: 'var(--text-muted, #6b7280)', paddingBottom: '10px' }}>
        Pickup between 8 AM and 5 PM, at least a 4-hour window.
      </div>
      </>}
    </div>
  );
}
