// Pickup window the customer chooses with the pickup date: between 08:00 and 17:00, at least
// 4 hours long (ready at 08:00 → close no earlier than 12:00). Times are "HH:MM", local to the
// pickup address.

const EARLIEST = '08:00';
const LATEST = '17:00';
const MIN_HOURS = 4;

const minutes = t => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};

// Returns an error message, or null when the window is valid.
function pickupWindowError(ready, close) {
  if (!ready || !close) return 'Choose both a ready time and a close time for the pickup';
  if (minutes(ready) < minutes(EARLIEST) || minutes(close) > minutes(LATEST)) {
    return `Pickup times must be between ${EARLIEST} and ${LATEST}`;
  }
  if (minutes(close) - minutes(ready) < MIN_HOURS * 60) {
    return `The pickup window must be at least ${MIN_HOURS} hours (close time ${MIN_HOURS} hours or more after the ready time)`;
  }
  return null;
}

// The window for a rate request or booking — the customer's choice, else the full day.
function pickupWindow(src = {}) {
  return { ready: src.pickupReadyTime || EARLIEST, close: src.pickupCloseTime || LATEST };
}

module.exports = { pickupWindow, pickupWindowError, EARLIEST, LATEST, MIN_HOURS };
