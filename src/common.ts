import { Duration, ensureInt } from 'lib/utils';

document.addEventListener('DOMContentLoaded', () => {
  const lastLoadValue: number = ensureInt(document.querySelector<HTMLInputElement>('#lastLoad')?.value ?? 0);
  if((Date.now() - lastLoadValue) > Duration.MINUTES(5)) {
    window.location.reload();
  }
});
