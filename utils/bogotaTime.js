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

// No time restriction — app day = calendar day in Bogota
export function getAppDayKey() {
  return getBogotaDatetime().dateStr;
}

export function getBogotaMinutes() {
  return getBogotaDatetime().totalMinutes;
}

export function isLateInBogota() {
  return getBogotaDatetime().hour >= 8;
}
