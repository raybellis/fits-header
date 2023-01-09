/*
 * file level handling
 */

import * as fs from 'node:fs';

import HDU from './hdu.mjs';
import { blockSize } from './constants.mjs';

export default class File {

  #fd;
  #blocks;

  constructor(path, flags, mode) {

    const fd = this.#fd = fs.openSync(path, flags, mode);
    const stat = fs.fstatSync(fd);

    if (stat.size === 0) {
      throw Error(`FITS file "${path}" is empty`);
    }

    if (stat.size % blockSize !== 0) {
      throw Error(`FITS file "${path}" does not contain full blocks`);
    }

    this.#blocks = Math.floor(stat.size / blockSize);
  }

  /*
   * return a buffer containing the nth block of the file
   */
  block(n) {
    if (Number.isInteger(n)) {
      if (n < 0 || n >= this.#blocks) {
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
  get #block_iterator() {
    let n = 0;
    let self = this;

    return {

      get done() {
        return n >= self.#blocks;
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

        if (c < 0 || n + c > self.#blocks) {
          throw RangeError();
        }

        n += c;
      },

      [Symbol.iterator]() {
        return this;
      }
    }
  }

  get blocks() {
    return this.#block_iterator;
  }

  * #hdu_iterator() {
    let iter = this.#block_iterator;
    while (!iter.done) {
      yield new HDU(iter);
    }
  }

  get hdus() {
    return this.#hdu_iterator();
  }
};
