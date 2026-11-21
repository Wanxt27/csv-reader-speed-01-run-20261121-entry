// Fast drop-in for csv-reader 1.0.0 (make.fun's own CSV reader).
//
// Returns exactly csv-reader's answer {columns, rows, errors} for an input
// {text, header}, following its written broken-row policy:
//
//   - a U+FEFF at the very start of the text is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is no record;
//   - outside a quoted field a CR not followed by LF is dropped (stray_cr);
//   - a field that opens with a quote runs to the next quote that is not doubled,
//     "" inside it is one quote, each CRLF or lone CR inside it reads as LF;
//     what follows its closing quote, up to the next comma or line break, is
//     appended as it stands (quote_junk, when the field ends); a quote that
//     never closes is a literal character and the text after it is read again
//     as unquoted (unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields stay
//     strings, never trimmed or converted;
//   - columns is the first record when header is true, else null; rows holds
//     the records after it (every record when header is false), each padded
//     with "" (short_row, with fields: its field count) or cut (long_row, with
//     extra: the cut fields) to the first record's width;
//   - each error is {code, line, row}, in the order met; line is the 1-based
//     line its record starts on (every LF, CRLF and lone CR inside a quoted
//     field counted), row its record's index in rows (null for the header).
//
// Speed: the text is read once, left to right, one record at a time. A
// record whose first line holds no quote is one slice + one native split.
// A record whose first line holds quotes is scanned in place on the text,
// field by field, with indexOf jumps and one slice per field. Only a quoted
// field that runs over a line break falls back to the character-level
// parser below, which is the plain reading of the policy and runs rarely.

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const n = text.length;
  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (n > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes.
  let recordLine = 1;
  let recordRow = null;

  // Set once a quote search runs to the end of the text and finds none:
  // no record after this one can hold a quote either.
  let noMoreQuotes = false;

  // Normalizes an already-sliced piece of a quoted field: every CRLF and
  // lone CR reads as LF, counting each line break it holds into `line`.
  // Only used when the piece holds a CR or LF at all.
  function normalizeQuoted(s) {
    const t = s.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
    let breaks = 0;
    for (let i = 0; i < t.length; i++) if (t.charCodeAt(i) === 10) breaks++;
    line += breaks;
    return t;
  }

  // A slice [a, b) of a quoted field, read as the field holds it, with every
  // CRLF and lone CR as LF. The clean case is inlined at the call sites;
  // this helper serves only the slow parser's multi-line fields.
  function quotedSlice(a, b) {
    const s = text.slice(a, b);
    if (s.indexOf('\r') === -1 && s.indexOf('\n') === -1) return s;
    return normalizeQuoted(s);
  }

  // Reads unquoted characters onto `value` up to the next comma or line break:
  // a CR not followed by LF is dropped (stray_cr). Returns the field, how it
  // ended, and how many characters were kept.
  function readUnquoted(value) {
    let added = 0;
    while (pos < n) {
      const comma = text.indexOf(',', pos);
      const lf = text.indexOf('\n', pos);
      const cr = text.indexOf('\r', pos);
      let d = -1;
      let kind = COMMA;
      if (comma !== -1) { d = comma; kind = COMMA; }
      if (lf !== -1 && (d === -1 || lf < d)) { d = lf; kind = LINE_BREAK; }
      if (cr !== -1 && (d === -1 || cr < d)) { d = cr; kind = 2; }
      if (d === -1) {
        value += text.slice(pos);
        added += n - pos;
        pos = n;
        return { value, ended: END, added };
      }
      if (kind === COMMA) {
        value += text.slice(pos, d);
        added += d - pos;
        pos = d + 1;
        return { value, ended: COMMA, added };
      }
      if (kind === LINE_BREAK) {
        value += text.slice(pos, d);
        added += d - pos;
        pos = d + 1;
        line += 1;
        return { value, ended: LINE_BREAK, added };
      }
      // A CR: a line break when followed by LF, else a dropped stray CR.
      if (text.charCodeAt(d + 1) === 10) {
        value += text.slice(pos, d);
        added += d - pos;
        pos = d + 2;
        line += 1;
        return { value, ended: LINE_BREAK, added };
      }
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      value += text.slice(pos, d);
      added += d - pos;
      pos = d + 1;
    }
    return { value, ended: END, added };
  }

  // Reads a quoted field whose opening quote is at pos; used only when the
  // field runs over a line break, which the in-line scan below cannot hold.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    pos += 1;
    let value = '';
    let segStart = pos;
    while (true) {
      const q = text.indexOf('"', pos);
      if (q === -1) {
        // The quote never closes: it is a literal character, and the text
        // after it is read again as an unquoted field.
        pos = open + 1;
        line = openLine;
        noMoreQuotes = true;
        errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
        return readUnquoted('"');
      }
      if (text.charCodeAt(q + 1) === 34) {
        // A doubled quote is one quote inside the field.
        value += quotedSlice(segStart, q) + '"';
        pos = q + 2;
        segStart = pos;
        continue;
      }
      value += quotedSlice(segStart, q);
      pos = q + 1;
      if (pos >= n) return { value, ended: END, added: 0 };
      const c = text.charCodeAt(pos);
      if (c === 44) {
        pos += 1;
        return { value, ended: COMMA, added: 0 };
      }
      if (c === 10) {
        pos += 1;
        line += 1;
        return { value, ended: LINE_BREAK, added: 0 };
      }
      if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
        return { value, ended: LINE_BREAK, added: 0 };
      }
      // What follows the closing quote is appended as it stands, up to the
      // next comma or line break.
      const junk = readUnquoted(value);
      if (junk.added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
      return junk;
    }
  }

  // Parses one record field by field from pos; used only when a quoted field
  // runs over a line break.
  function readRecordSlow() {
    const fields = [];
    let field;
    let quoted = false;
    do {
      quoted = text.charCodeAt(pos) === 34;
      field = quoted ? readQuoted() : readUnquoted('');
      fields.push(field.value);
    } while (field.ended === COMMA);
    return { fields, quoted };
  }

  // Finishes one record's fields: header, padding/cutting, and the row.
  // Returns false when the fields are no record at all.
  function finishRecord(fields, quoted) {
    if (fields.length === 1 && fields[0] === '' && !quoted) return false;
    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      return true;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
    return true;
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const recordStartPos = pos;
    const recordStartLine = line;

    const nl = text.indexOf('\n', pos);
    const lineEnd = nl === -1 ? n : nl;
    // The record's first line, without the CR of a CRLF line break; a lone
    // CR at the end of the text stays content, not a line break.
    let contentEnd = lineEnd;
    if (nl !== -1 && contentEnd > pos && text.charCodeAt(contentEnd - 1) === 13) contentEnd -= 1;

    const q = noMoreQuotes ? -1 : text.indexOf('"', pos);
    if (q === -1) noMoreQuotes = true;

    if (q === -1 || q >= lineEnd) {
      // The fast path: no quote on the record's first line, so the whole
      // record is on this line and every field is unquoted.
      let chunk = text.slice(pos, contentEnd);
      let fields;
      if (chunk.indexOf('\r') === -1) {
        fields = chunk.split(',');
      } else {
        // Every CR left in the line is a lone one: dropped, one stray_cr each.
        let crs = 0;
        for (let i = 0; i < chunk.length; i++) if (chunk.charCodeAt(i) === 13) crs++;
        for (let i = 0; i < crs; i++) errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        fields = chunk.replaceAll('\r', '').split(',');
      }
      pos = nl === -1 ? n : nl + 1;
      line += 1;
      finishRecord(fields, false);
      continue;
    }

    // The in-line scan: the record's first line holds a quote, but every
    // quoted field may still close on this line. Errors go to a scratch
    // list until the scan proves the record ends on this line; a quoted
    // field that runs past it restarts the record with the slow parser.
    const recErrors = [];
    const fields = [];
    let i = pos;
    let done = true;
    let lastQuoted = false;
    while (true) {
      if (text.charCodeAt(i) === 34) {
        // A quoted field.
        lastQuoted = true;
        let value = '';
        let j = i + 1;
        let segStart = j;
        let closed = false;
        while (true) {
          const qq = text.indexOf('"', j);
          if (qq === -1 || qq >= contentEnd) break; // runs past this line
          if (text.charCodeAt(qq + 1) === 34) {
            let seg = text.slice(segStart, qq);
            if (seg.indexOf('\r') !== -1 || seg.indexOf('\n') !== -1) seg = normalizeQuoted(seg);
            value += seg + '"';
            j = qq + 2;
            segStart = j;
            continue;
          }
          let seg = text.slice(segStart, qq);
          if (seg.indexOf('\r') !== -1 || seg.indexOf('\n') !== -1) seg = normalizeQuoted(seg);
          value += seg;
          closed = true;
          j = qq + 1;
          break;
        }
        if (!closed) { done = false; break; }
        if (j >= contentEnd) {
          fields.push(value);
          break;
        }
        const c = text.charCodeAt(j);
        if (c === 44) {
          fields.push(value);
          i = j + 1;
          continue;
        }
        // Junk after the closing quote, appended as it stands.
        let junkEnd = text.indexOf(',', j);
        if (junkEnd === -1 || junkEnd >= contentEnd) junkEnd = contentEnd;
        let junk = text.slice(j, junkEnd);
        if (junk.indexOf('\r') !== -1) {
          let crs = 0;
          for (let k = 0; k < junk.length; k++) if (junk.charCodeAt(k) === 13) crs++;
          for (let k = 0; k < crs; k++) recErrors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
          junk = junk.replaceAll('\r', '');
        }
        if (junk.length > 0) recErrors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
        fields.push(value + junk);
        if (junkEnd >= contentEnd) break;
        i = junkEnd + 1;
        continue;
      }
      // An unquoted field: up to the next comma or the end of the line.
      lastQuoted = false;
      let comma = text.indexOf(',', i);
      if (comma === -1 || comma >= contentEnd) comma = contentEnd;
      let value = text.slice(i, comma);
      if (value.indexOf('\r') !== -1) {
        let crs = 0;
        for (let k = 0; k < value.length; k++) if (value.charCodeAt(k) === 13) crs++;
        for (let k = 0; k < crs; k++) recErrors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        value = value.replaceAll('\r', '');
      }
      fields.push(value);
      if (comma >= contentEnd) break;
      i = comma + 1;
    }

    if (!done) {
      // A quoted field runs over the line break: parse the whole record
      // again, slowly, from its start. The scratch errors are dropped and
      // the line is rewound; the slow parser records the real ones.
      // `pos` still holds the record's start: the scan only moved `i`.
      pos = recordStartPos;
      line = recordStartLine;
      const slow = readRecordSlow();
      finishRecord(slow.fields, slow.quoted);
      continue;
    }

    // The record ended on this line.
    for (let e = 0; e < recErrors.length; e++) errors.push(recErrors[e]);
    pos = nl === -1 ? n : nl + 1;
    line += 1;
    finishRecord(fields, lastQuoted);
  }

  return { columns: header ? (columns ?? []) : null, rows, errors };
}
