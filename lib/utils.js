class Durations {
  get SECOND() { return 1000; }
  get MINUTE() { return this.SECONDS(60); }
  get HOUR() { return this.MINUTES(60); }
  get DAY() { return this.HOURS(24); }
  get WEEK() { return this.DAYS(7); }
  SECONDS(num) { return this.SECONDS * num; }
  MINUTES(num) { return this.MINUTES * num; }
  HOURS(num) { return this.HOURS * num; }
  DAYS(num) { return this.DAYS * num; }
  WEEKS(num) { return this.WEEKS * num; }
}

const Duration = new Durations();

module.exports = { Duration };
