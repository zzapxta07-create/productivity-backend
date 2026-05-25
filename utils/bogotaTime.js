// All time calculations use America/Bogota (UTC-5, no DST)

export function getBogotaDatetime() {
  const now = new Date();
  // Create a Date with Bogota's local time values in JS local format
  const bogota = new Date(now.toLocaleString('en-US', { timeZone: 'America/Bogota' }));
  const y = bogota.getFullYear();
  const m = String(bogota.getMonth() + 1).padStart(2, '0');
  const d = String(bogota.getDate()).padStart(2, '0');
  return {
    dateStr: `${y}-${m}-${d}`,
    hour: bogota.getHours(),
    minute: bogota.getMinutes(),
    totalMinutes: bogota.getHours() * 60 + bogota.getMinutes(),
  };
}

// App day starts at 07:00 Bogota — before that it's still the previous day
export function getAppDayKey() {
  const { dateStr, hour } = getBogotaDatetime();
  if (hour < 7) {
    const d = new Date(dateStr + 'T12:00:00');
    d.setDate(d.getDate() - 1);
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const da = String(d.getDate()).padStart(2, '0');
    return `${y}-${mo}-${da}`;
  }
  return dateStr;
}

export function getBogotaMinutes() {
  return getBogotaDatetime().totalMinutes;
}

export function isLateInBogota() {
  return getBogotaDatetime().hour >= 8;
}
