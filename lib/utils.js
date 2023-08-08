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

module.exports = { Duration };
