/*
 * header handling classes
 */

import { keySize, valueSize, headerSize } from './constants.mjs';

const inspect = Symbol.for('nodejs.util.inspect.custom');

const QUOTE = "'";
const SLASH = '/';
const ENC = 'ASCII';

export default class Header {

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

class RawHeader extends Header {

  #modified = false;
  #buffer;
  #keyword;

  _write(data, offset, length) {
    this.#modified = true;
    length = Math.min(headerSize, offset + length);
    return this.#buffer.write(data, offset, length, ENC);
  }

  substring(start, end) {
    return this.#buffer.subarray(start, end).toString(ENC);
  }

  get modified() {
    return this.#modified;
  }

  get has_value() {
    return this.substring(keySize, keySize + 2) === '= ';
  }

  get keyword() {
    return this.substring(0, keySize).trimEnd();
  }

  get buffer() {
    return Buffer.from(this.#buffer);
  }

  #set_keyword(arg) {
    const s = arg.substring(0, keySize).toUpperCase().padEnd(keySize, ' ');
    this._write(s, 0, keySize);
  }

  toString() {
    return this.substring(0, headerSize);
  }

  [inspect]() {
    return this.toString();
  }

  constructor(arg) {
    super();
    if (arg instanceof Buffer) {
      this.#buffer = Buffer.from(arg);
    } else if (typeof arg === 'string') {
      this.#buffer = Buffer.alloc(headerSize).fill(' ');
      this.#set_keyword(arg);
    } else {
      throw TypeError();
    }
  }
}

class CommentHeader extends RawHeader {

  get text() {
    return this.substring(keySize, headerSize);
  }

  set text(arg) {
    const maxlen = headerSize - keySize;
    const s = arg.substring(0, maxlen).padEnd(maxlen, ' ');
    this._write(s, keySize, maxlen);
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

  valueOf() {
    return this.#value;
  }

  #update_svalue() {
    let arg = this.#value;
    if (typeof arg === 'boolean') {
      this.#svalue = (arg ? 'T' : 'F').padStart(valueSize, ' ');
    } else if (typeof arg === 'number') {
      this.#svalue = arg.toString().padStart(valueSize, ' ');
    } else if (typeof arg === 'string') {
      arg = arg.replace(/'/g, "''");
      this.#svalue = (QUOTE + arg.padEnd(8, ' ') + QUOTE).padEnd(valueSize, ' ');
    } else {
      throw new TypeError();
    }
    this.#dirty = true;
  }

  set value(arg) {
    this.#value = arg;
    this.#update_svalue();
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
    this.#update_svalue();
    let s = '= ' + this.#svalue;

    if ((typeof this.#units === 'string') || (typeof this.#comment === 'string')) {
      s += ' / ';
    }

    if (typeof this.#units === 'string') {
      s += '[' + this.#units + '] ';
    }

    if (typeof this.#comment === 'string') {
      s += this.#comment;
    }

    const maxlen = headerSize - keySize;
    s = s.padEnd(maxlen, ' ').substring(0, maxlen);
    this._write(s, keySize, maxlen);
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
    const data = this.substring(10, headerSize);

    let inside = false;
    let offset = 0;
    while (offset < data.length) {
      const ch = data[offset];
      if (ch === QUOTE) {
        inside = !inside;
      } else if (ch === SLASH) {
        if (!inside) break;
      }
      ++offset;
    }

    const value = data.substring(0, offset).trimEnd();
    if (inside || !value.startsWith(QUOTE) || !value.endsWith(QUOTE)) {
      throw `string value parser error`;
    }

    const comment = data.substring(offset);
    this.#value = value.substring(1, value.length - 1).replace(/''/g, QUOTE).trimEnd();
    this.#parse_comment(comment);
  }

  #parse() {
    let content = this.substring(keySize + 2, headerSize);

    if (content.trimStart().startsWith(QUOTE)) {
      this.#parse_string();
    } else {
      let value = content.substring(0, valueSize).trimStart();
      if (value === 'T') {
        this.#value = true;
      } else if (value === 'F') {
        this.#value = false;
      } else {
        this.#value = Number(value);
      }

      let comment = this.substring(30, headerSize);
      this.#parse_comment(comment);
    }
  }

  constructor(arg, value = undefined, units = undefined, comment = undefined) {
    super(arg);

    if (arg instanceof Buffer) {
      this.#parse();
    } else if (typeof arg === 'string') {
      this.value = value;
      this.units = units;
      this.comment = comment;
    }
  };
};
