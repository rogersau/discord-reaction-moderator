export function upsertAppConfig(
  sql: DurableObjectStorage["sql"],
  body: { key: string; value: string },
): { ok: true } {
  sql.exec(
    "INSERT INTO app_config(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    body.key,
    body.value,
  );

  return { ok: true };
}
