// Single source of truth for parsing page/limit query params — every list
// endpoint used to inline `(Number(page) - 1) * Number(limit)` itself, with
// no clamping, so a negative/zero/garbage `page` produced a negative Mongo
// `skip` value and crashed with a raw 500 (BSON field 'skip' value must be
// >= 0). Clamping here once fixes it everywhere at once.
export function parsePagination(query = {}, { defaultLimit = 20, maxLimit = 100 } = {}) {
  const page = Math.max(1, Math.trunc(Number(query.page)) || 1);
  const limit = Math.min(maxLimit, Math.max(1, Math.trunc(Number(query.limit)) || defaultLimit));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}
