import { SQL_MIGRATIONS } from "./sql.js";

export async function runMigrations(db, logger) {
  await db.exec(
    "create table if not exists schema_migrations (id integer primary key, name text not null, applied_at text not null)"
  );

  const rows = await db.all("select id from schema_migrations order by id asc");
  const applied = new Set(rows.map((row) => row.id));

  for (const migration of SQL_MIGRATIONS) {
    if (applied.has(migration.id)) continue;
    logger?.info?.(`[DB] Aplicando migration ${migration.id} - ${migration.name}`);
    await db.exec("begin");
    try {
      await db.exec(migration.sql);
      await db.run(
        "insert into schema_migrations (id, name, applied_at) values (?, ?, datetime('now'))",
        migration.id,
        migration.name
      );
      await db.exec("commit");
    } catch (err) {
      await db.exec("rollback");
      logger?.error?.(`[DB] Falha na migration ${migration.id}`, err);
      throw err;
    }
  }
}
