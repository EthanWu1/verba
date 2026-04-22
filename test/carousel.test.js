'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const carousel = require('../public/lib/carousel.js');

test('carousel module exports required API', () => {
  ['createState','pushItem','updateItem','removeItem','setActive','clearAll',
   'serialize','deserialize','hydrate','SOFT_CAP_ITEMS','SOFT_CAP_BYTES']
    .forEach(name => assert.ok(name in carousel, `missing export: ${name}`));
});
