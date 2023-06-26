#!/usr/bin/env node

import * as FITS from '../index.mjs';

const files = process.argv.slice(2);

files.forEach(file => {
  const image = new FITS.File(file);
  image.dump();
});
