// VERBATIM COPY of CRM lib/rules/util.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// lib/rules/util.js
//
// Small, pure helpers the rules modules share: telling a record from anything
// else, naming where in a rule set a problem sits, and copying or freezing rule
// data without touching the caller's objects.

const OBJECT_TAG = '[object Object]';
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/**
 * A record — not an array, a Date or null.
 *
 * Read off the object's tag rather than its prototype: Jest evaluates each suite
 * in its own realm, where an object built by a Node global has a different
 * Object.prototype and a prototype check would call it "not an object".
 */
export const isPlainObject = (value) => Object.prototype.toString.call(value) === OBJECT_TAG;

/**
 * `record[key]` when the record itself holds that key, else undefined — so a
 * rule naming 'constructor' or 'toString' never reaches Object.prototype.
 */
export const ownValue = (record, key) =>
  isPlainObject(record) && typeof key === 'string' && Object.hasOwn(record, key) ? record[key] : undefined;

/**
 * The path to a child, as a reader would write it: `cutoffs.crmFms.date`,
 * `scoreIn[0]`, `steps["soFms:SO-11_5"].owner`. A key that is not an
 * identifier is quoted: a step key is '<flow>:<code>' (contract.js
 * STEP_KEY_SEPARATOR), so it carries a colon and usually a hyphen.
 */
export function childPath(base, key) {
  if (typeof key === 'number') return `${base}[${key}]`;
  if (!IDENTIFIER.test(key)) return `${base}[${JSON.stringify(key)}]`;
  return base ? `${base}.${key}` : key;
}

/** A relative path (from a nested validator) hung under `base`. */
export function joinPath(base, relative) {
  if (!relative) return base;
  if (!base) return relative;
  return relative.startsWith('[') ? `${base}${relative}` : `${base}.${relative}`;
}

/** One error per field of `value` that `allowed` does not list. */
export function unknownKeyErrors(value, allowed, path) {
  const known = new Set(allowed);
  return Object.keys(value)
    .filter((key) => !known.has(key))
    .map((key) => ({ path: childPath(path, key), message: `"${key}" is not a field here` }));
}

/** A deep copy of plain rule data (records, arrays, primitives). */
export function cloneData(value) {
  if (Array.isArray(value)) return value.map(cloneData);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneData(child)]));
}

/** Freeze rule data all the way down; returns it. */
export function deepFreeze(value) {
  if (Array.isArray(value) || isPlainObject(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}
