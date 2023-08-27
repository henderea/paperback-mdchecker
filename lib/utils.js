class Durations {
  get SECOND() { return 1000; }
  get MINUTE() { return this.SECONDS(60); }
  get HOUR() { return this.MINUTES(60); }
  get DAY() { return this.HOURS(24); }
  get WEEK() { return this.DAYS(7); }
  SECONDS(num) { return this.SECOND * num; }
  MINUTES(num) { return this.MINUTE * num; }
  HOURS(num) { return this.HOUR * num; }
  DAYS(num) { return this.DAY * num; }
  WEEKS(num) { return this.WEEK * num; }
}

const Duration = new Durations();

function formatDate(date) {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'US/Eastern', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', month: 'short', weekday: 'short' }).format(date);
}


function formatDuration(d) {
  const h = Math.floor(d / (60 * 60 * 1000));
  const m = Math.floor((d / (60 * 1000)) % 60);
  const s = Math.floor((d / 1000) % 60);
  const ms = d % 1000;
  const parts = [];
  if(h > 0) { parts.push(`${h} h`); }
  if(m > 0) { parts.push(`${m} m`); }
  if(s > 0) { parts.push(`${s} s`); }
  if(ms > 0) { parts.push(`${ms} ms`); }
  return parts.join(' ');
}

module.exports = { Duration, formatDate, formatDuration };
