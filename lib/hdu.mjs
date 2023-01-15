/*
 * HDU handling
 */

import Header from './header.mjs';
import { headerSize, blockSize } from './constants.mjs';

export default class HDU {

  // private variables
  #iter;
  #headers = [];
  #size = 0;
  #start;
  #end;

  #read_headers(iter) {
    while (true) {
      let next = iter.next();
      let buf = next.value;
      for (let j = 0; j < blockSize; j += headerSize) {
        const header = Header.from_buffer(buf.subarray(j, j + headerSize));
        this.#headers.push(header);
        if (header.keyword === 'END') {
          return;
        }
      }
    }
  }

  constructor(iter) {

    this.#iter = iter;

    this.#read_headers(iter);
    this.#start = iter.position;
    this.#end = this.#start;

    // read any data blocks
    const naxis = this.header('NAXIS');
    const bpp = this.header('BITPIX');

    if (naxis.value > 0) {
      this.#size = Math.abs(bpp.value / 8);
      for (let i = 1; i <= naxis.value; ++i) {
        this.#size *= this.header('NAXIS' + i).value;
      }

      // calculate block count
      const count = Math.ceil(this.#size / blockSize);
      this.#end = this.#start + count;

      // skip this many data blocks
      iter.skip(count);
    }
  }

  get modified() {
    return this.#headers.some(h => h.modified);
  }

  header(keyword) {
    return this.#headers.find(header => header.keyword === keyword);
  }

  headers(keyword) {
    if (typeof keyword === "string") {
      keyword = keyword.toUpperCase().trim();
      return this.#headers.filter(header => header.keyword === keyword).values();
    } else if (typeof keyword === "undefined") {
      return this.#headers.values();
    } else {
      throw new TypeError();
    }
  }

  get blocks() {
    return this.#iter.range_iterator(this.#start, this.#end);
  }

  dump() {
    for (let header of this.#headers) {
      console.log(header);
    }
  }
};
