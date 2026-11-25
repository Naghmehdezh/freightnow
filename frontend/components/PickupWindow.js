'use client';

// Pickup date plus the window the freight is ready: between 08:00 and 17:00, at least 3 hours
// (ready at 08:00 → close no earlier than 11:00). Times are local to the pickup address.

const EARLIEST = 8 * 60;
const LATEST = 17 * 60;
const MIN_WINDOW = 3 * 60;
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
// pickupToggle ({ checked, onChange }): envelopes and parcels — a "Request a pickup" switch next to the
// date, tied to the Pickup option, so the ready/close times are easy to find.
export default function PickupWindow({ date, onDateChange, ready, onReadyChange, close, onCloseChange, showTimes = true, pickupToggle }) {
  const closeOptions = closeTimesFor(ready);

  function changeReady(value) {
    onReadyChange(value);
    // Keep the close time only if it still leaves a 3-hour window.
    if (close && !closeTimesFor(value).includes(close)) onCloseChange('');
  }

  return (
    <div className="grid4" style={{ marginBottom: '10px' }}>
      <div className="field"><label>{showTimes ? 'Pickup date' : 'Ship date'}</label><input type="date" value={date} onChange={e => onDateChange(e.target.value)} /></div>
      {pickupToggle && (
        <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'end', height: 'var(--h-md)', cursor: 'pointer', fontSize: 'var(--fs-base)', color: 'var(--ink)' }}>
          <input type="checkbox" checked={pickupToggle.checked} onChange={pickupToggle.onChange} />
          Request a pickup
        </label>
      )}
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
      <div className="field" style={{ alignSelf: 'end', fontSize: 'var(--fs-xs)', color: 'var(--mute)', paddingBottom: '10px' }}>
        Pickup between 8 AM and 5 PM, at least a 3-hour window.
      </div>
      </>}
    </div>
  );
}
