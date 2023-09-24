import './unknown-titles.scss';

import $ from 'jquery';

import { Duration, ensureInt } from 'lib/utils';

$(function() {
  const lastLoadValue: number = ensureInt($('#lastLoad').val());
  if((Date.now() - lastLoadValue) > Duration.MINUTES(5)) {
    window.location.reload();
  }
});
