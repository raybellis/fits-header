/*
 * FITS file handler, specification at:
 * https://fits.gsfc.nasa.gov/standard40/fits_standard40aa-le.pdf
 */

const fs = require('fs');
const inspect = Symbol.for('nodejs.util.inspect.custom');

const QUOTE = String.fromCharCode(39);  // '

const keysize = 8;
const valuesize = 20;
const headersize = 80;
const blocksize = 2880;
const enc = 'ASCII';

class RawHeader {

  #modified = false;
  #buffer;
  #keyword;

  _write(data, offset, length) {
    this.#modified = true;
    length = Math.min(headersize, offset + length);
    return this.#buffer.write(data, offset, length, enc);
  }

  substring(start, end) {
    return this.#buffer.subarray(start, end).toString(enc);
  }

  get modified() {
    return this.#modified;
  }

  get has_value() {
    return this.substring(keysize, keysize + 2) === '= ';
  }

  get keyword() {
    return this.substring(0, keysize).trimEnd();
  }

  get buffer() {
    return Buffer.from(this.#buffer);
  }

  #set_keyword(arg) {
    const s = arg.substring(0, keysize).toUpperCase().padEnd(keysize, ' ');
    this._write(s, 0, keysize);
  }

  toString() {
    return this.substring(0, headersize);
  }

  [inspect]() {
    return this.toString();
  }

  constructor(arg) {
    if (arg instanceof Buffer) {
      this.#buffer = Buffer.from(arg);
    } else if (arg instanceof String) {
      this.#buffer = Buffer.alloc(blocksize).fill(' ');
      this.#set_keyword(arg);
    } else {
      throw TypeError();
    }
  }
}

class CommentHeader extends RawHeader {

  get text() {
    return this.substring(keysize, headersize);
  }

  set text(arg) {
    const maxlen = headersize - keysize;
    const s = arg.substring(0, maxlen).padEnd(maxlen, ' ');
    this._write(s, keysize, maxlen);
  }

  constructor(arg, text) {
    super(arg);
    if (typeof arg === 'string') {
      this.text = text;
    }
  }
}

class ValueHeader extends RawHeader {

  #value;    // value as a JS primitive
  #svalue;   // value as a padded string
  #units;    // optional units specifier
  #comment;  // optional text comment

  #dirty = false;

  get value() {
    return this.#value;
  }

  #set_svalue() {
    let arg = this.#value;
    if (typeof arg === 'boolean') {
      this.#svalue = (arg ? 'T' : 'F').padStart(valuesize, ' ');
    } else if (typeof arg === 'number') {
      this.#svalue = arg.toString().padStart(valuesize, ' ');
    } else if (typeof arg === 'string') {
      arg = arg.replace(/[']/g, "''");
      this.#svalue = (QUOTE + arg.padEnd(8, ' ') + QUOTE).padEnd(valuesize, ' ');
    } else {
      throw new TypeError();
    }
    this.#dirty = true;
  }

  set value(arg) {
    this.#value = arg;
    this.#set_svalue();
  }

  get units() {
    return this.#units;
  }

  set units(arg) {
    if (typeof arg === "string" || typeof arg === "undefined") {
      this.#units = arg;
      this.#dirty = true;
    } else {
      throw new TypeError();
    }
  }

  get comment() {
    return this.#comment;
  }

  set comment(arg) {
    if (typeof arg === "string" || typeof arg === "undefined") {
      this.#comment = arg;
      this.#dirty = true;
    } else {
      throw new TypeError();
    }
  }

  get modified() {
    return this.#dirty || super.modified;
  }

  #update() {
    let s = this.#svalue;

    if ((typeof this.#units === 'string') || (typeof this.#comment === 'string')) {
      s += ' / ';
    }

    if (typeof this.#units === 'string') {
      s += '[' + this.#units + '] ';
    }

    if (typeof this.#comment === 'string') {
      s += this.#comment;
    }

    const maxlen = headersize - (keysize + 2);
    s = s.padEnd(maxlen, ' ').substring(0, maxlen);
    this._write(s, keysize + 2, maxlen);
    this.#dirty = false;
  }

  toString() {
    if (this.#dirty) {
      this.#update();
    }
    return super.toString();
  }

  #parse_comment(s) {
    this.#units = undefined;
    this.#comment = undefined;

    s = s.trim();                      // strip white space
    if (s.startsWith('/')) {           // comment found
      s = s.substring(1).trimStart();  // strip marker and leading white space
      if (s.startsWith('[')) {         // look for units marker
        let i = s.indexOf(']', 1);
        if (i > 1) {
          this.#units = s.substring(1, i);
          this.#comment = s.substring(i + 1).trimStart();
        } else {
          throw 'Malformed units field in comment';
        }
      } else {
        this.#comment = s.trimStart();
      }
    }
  }

  #parse_string() {
    const data = this.substring(10, headersize);

    let inside = false;
    let offset = 0;
    while (offset < data.length) {
      const ch = data[offset];
      if (ch === QUOTE) {
        inside = !inside;
      } else if (ch === '/') {
        if (!inside) break;
      }
      ++offset;
    }

    const value = data.substring(0, offset).trimEnd();
    if (inside || !value.startsWith(QUOTE) || !value.endsWith(QUOTE)) {
      throw `string value parser error`;
    }

    const comment = data.substring(offset);
    this.#value = value.substring(1, value.length - 1).trimEnd();
    this.#set_svalue();
    this.#parse_comment(comment);
  }

  #parse() {
    let content = this.substring(keysize + 2, headersize);

    if (content.trimStart().startsWith(QUOTE)) {
      this.#parse_string();
    } else {
      let value = content.substring(0, valuesize).trimStart();
      if (value === 'T') {
        this.#value = true;
      } else if (value === 'F') {
        this.#value = false;
      } else {
        this.#value = Number(value);
      }

      let comment = this.substring(30, headersize);
      this.#parse_comment(comment);
    }
  }

  constructor(arg, value = undefined, units = undefined, comment = undefined) {
    super(arg);

    if (arg instanceof Buffer) {
      this.#parse();
    } else if (arg instanceof String) {
      this.value = value;
      this.units = units;
      this.comment = comment;
    }
  };
};

class Header {

  static from_buffer(buffer) {
    let raw = new RawHeader(buffer);
    let keyword = raw.keyword;

    if (keyword === 'COMMENT' || keyword === 'HISTORY') {
      return new CommentHeader(buffer);
    } else if (raw.has_value) {
      return new ValueHeader(buffer);
    } else {
      return raw;
    }
  }

  static comment(text) {
    return new CommentHeader('COMMENT', text)
  }

  static history(text) {
    return new CommentHeader('HISTORY', text)
  }

  static value(keyword, value, units, comment) {
    return new ValueHeader(keyword, value, units, comment);
  }
}

class File {

  // private variables
  #fd;
  #headers = [];

  #read_headers() {
    for (let buf of this) {
      for (let j = 0; j < blocksize; j += headersize) {
        const header = Header.from_buffer(buf.subarray(j, j + headersize));
        this.#headers.push(header);
        if (header.keyword === 'END') {
          return;
        }
      }
    }
  }

  constructor(path, flags, mode) {
    const fd = this.#fd = fs.openSync(path, flags, mode);
    const stat = fs.fstatSync(fd);

    if (stat.size === 0) {
      throw `FITS file "${path}" is empty`;
    }

    if (stat.size % blocksize !== 0) {
      throw `FITS file "${path}" does not contain full blocks`;
    }

    this.#read_headers();
  }

  //
  // the iterator for this class returns any remaining
  // chunks of data left in the file after the header
  // was read.
  //
  // NB: this will only work once
  //
  *[Symbol.iterator]() {
    const buf = Buffer.alloc(blocksize);
    while (true) {
      const n = fs.readSync(this.#fd, buf);
      if (n === 0) {
        return;
      } else if (n !== buf.length) {
        throw('FITS short buffer read');
      } else {
        yield buf;
      }
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

  dumpHeaders() {
    for (let header of this.#headers) {
      console.log(header);
    }
  }
};

module.exports = { File, Header };
