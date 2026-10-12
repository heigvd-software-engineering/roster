import { type AnyColumn, type SQL, sql } from "drizzle-orm";

/**
 * `column IN (values)` for a list whose length follows the data: ids of the
 * members, groups or classes some earlier query returned.
 *
 * Drizzle's `inArray` binds one parameter per value, and D1 refuses a
 * statement with more than 100 bound parameters ("too many SQL variables", a
 * 500). That limit is reached by ordinary data: two 60-student classes on the
 * hub, or one class of 100. Here the whole list travels as ONE parameter, a
 * JSON array that SQLite unpacks with `json_each`, so the statement costs the
 * same however long the list is, and it stays one query with its ORDER BY
 * intact.
 *
 * `inArray` remains right for a fixed list written in the code (a set of
 * states). An empty list matches nothing.
 *
 * JSON strings unpack as TEXT and JSON numbers as INTEGER, so pass values in
 * the column's own type (`String(id)` for the text `githubId` columns).
 */
export function inList(
  column: AnyColumn,
  values: readonly (string | number)[],
): SQL {
  return sql`${column} in (select value from json_each(${JSON.stringify(values)}))`;
}
