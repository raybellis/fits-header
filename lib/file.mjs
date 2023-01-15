/*
 * file level handling
 */

import * as fs from 'node:fs';

import HDU from './hdu.mjs';
import { blockSize, headerSize } from './constants.mjs';

export default class File {

  #fd;
  #blockCount;
  #hdus;

  constructor(path) {

    const fd = this.#fd = fs.openSync(path, 'r');
    const stat = fs.fstatSync(fd);

    if (stat.size === 0) {
      throw Error(`FITS file "${path}" is empty`);
    }

    if (stat.size % blockSize !== 0) {
      throw Error(`FITS file "${path}" does not contain full blocks`);
    }

    this.#blockCount = Math.floor(stat.size / blockSize);

    this.#hdus = [];
    const iter = this.blocks;
    while (!iter.done) {
      this.#hdus.push(new HDU(iter));
    }
  }

  /*
   * return a buffer containing the nth block of the file
   */
  block(n) {
    if (Number.isInteger(n)) {
      if (n < 0 || n >= this.#blockCount) {
        throw RangeError();
      }
      const buf = Buffer.alloc(blockSize);
      const pos = n * blockSize;
      const count = fs.readSync(this.#fd, buf, 0, blockSize, pos);
      if (count === blockSize) {
        return buf;
      } else if (count === 0) {
        return undefined;
      } else {
        throw Error("FITS short buffer read");
      }
    } else {
      throw TypeError();
    }
  }

  /*
   * an iterator that returns blocks of the file
   *
   * the iterator is augmented with a .done property
   * that allows the iterator's state to be tested
   * without calling next()
   */
  #block_iterator(start = 0, end = this.#blockCount) {
    let n = start;
    let self = this;

    return {

      get position() {
        return n;
      },

      get done() {
        return n >= end;
      },

      next() {
        if (this.done) {
          return { value: undefined, done: true };
        } else {
          return { value: self.block(n++), done: false };
        }
      },

      skip(c) {

        if (!Number.isInteger(c)) {
          throw TypeError();
        }

        if (c < 0 || n + c > end) {
          throw RangeError();
        }

        n += c;
      },

      range_iterator(start, end) {
        return self.#block_iterator(start, end);
      },

      [Symbol.iterator]() {
        return this;
      }
    }
  }

  get blocks() {
    return this.#block_iterator(0, this.#blockCount);
  }

  get hdus() {
    return this.#hdus.values();
  }

  get primary_hdu() {
    return this.#hdus[0];
  }

  get modified() {
    return this.#hdus.some(hdu => hdu.modified);
  }

  write(path) {
    const fd = fs.openSync(path, 'w');
    for (const hdu of this.hdus) {

      // write the raw headers
      // TODO: handle continuation headers...
      let hwn = 0;
      for (const header of hdu.headers()) {
        fs.writeSync(fd, header.toString());
        hwn += headerSize;
      }

      // pad the header block
      while (hwn % blockSize !== 0) {
        fs.writeSync(fd, ' '.repeat(headerSize));
        hwn += headerSize;
      }

      // copy the data blocks
      for (const block of hdu.blocks) {
        fs.writeSync(fd, block, 0, blockSize);
      }
    }
    fs.closeSync(fd);
  }

  dump() {
    for (const hdu of this.hdus) {
      console.log('---');
      hdu.dump();
    }
  }

};
