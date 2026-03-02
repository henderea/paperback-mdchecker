import henderea from 'eslint-config-henderea/ts.mjs';

export default [
  ...henderea,
  {
    ignores: ['build/*', 'public/generated/*']
  }
];
