export function syncSlot(now) {
  const local = new Date(now.getTime() + 28800000);
  if ([0, 6].includes(local.getUTCDay())) return null;
  const minute = local.getUTCHours() * 60 + local.getUTCMinutes();
  return minute >= 20 * 60 + 30 ? "20:30" : minute >= 18 * 60 + 30 ? "18:30" : null;
}

export function pendingDates(after, through, limit = 10) {
  const cursor = new Date(`${after ?? through}T00:00:00Z`), dates = [];
  if (after) cursor.setUTCDate(cursor.getUTCDate() + 1);
  while (cursor.toISOString().slice(0, 10) <= through && dates.length < limit) {
    if (![0, 6].includes(cursor.getUTCDay())) dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

export function scheduledDates(manifest, through, checkedThrough) {
  const pending = pendingDates(checkedThrough ?? manifest?.asOf, through);
  // Recheck the last two published sessions once a week for late corrections,
  // instead of re-downloading every stock's two-week history every night.
  const recheck = manifest && new Date(`${through}T00:00:00Z`).getUTCDay() === 5
    ? manifest.dates.filter((date) => date < through).slice(-2) : [];
  return [...new Set([...recheck, ...pending])].sort();
}

