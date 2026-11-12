/**
 * SOQL safety helpers: validate identifiers / record IDs and escape string literals
 * before interpolating them into SOQL strings.
 */

const SF_ID_RE = /^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$/;
// Optional namespace prefix (ns__), base name, optional suffix (__c, __r, __mdt, __e, __x, __b, __pc).
const SF_API_NAME_RE = /^(?:[A-Za-z][A-Za-z0-9]*__)?[A-Za-z][A-Za-z0-9_]*?(?:__(?:c|r|mdt|e|x|b|pc))?$/;

export function isValidSalesforceId(id) {
  return typeof id === 'string' && SF_ID_RE.test(id);
}

export function isValidApiName(name) {
  return typeof name === 'string' && name.length <= 255 && SF_API_NAME_RE.test(name) && !name.includes('___');
}

export function assertSalesforceId(id) {
  if (!isValidSalesforceId(id)) throw new Error(`Invalid Salesforce record Id: ${String(id).slice(0, 40)}`);
  return id;
}

export function assertApiName(name) {
  if (!isValidApiName(name)) throw new Error(`Invalid Salesforce API name: ${String(name).slice(0, 80)}`);
  return name;
}

/** Escapes backslashes and single quotes for use inside a SOQL string literal. */
export function escapeSoqlString(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/** Validates each Id and returns a comma-separated list of quoted Ids. */
export function formatIdList(ids) {
  return ids.map(id => `'${assertSalesforceId(id)}'`).join(',');
}

/** Quotes and escapes arbitrary string values for an IN (...) clause. */
export function formatStringList(values) {
  return values.map(v => `'${escapeSoqlString(v)}'`).join(',');
}
