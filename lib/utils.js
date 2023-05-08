class Durations {
  get SECOND() { return 1000; }
  get MINUTE() { return this.SECOND * 60; }
  get HOUR() { return this.MINUTE * 60; }
  get DAY() { return this.HOUR * 24; }
  get WEEK() { return this.DAY * 7; }
}

const Duration = new Durations();

module.exports = { Duration };
