# supabase/

Supabase project configuration, migrations, and edge functions.

## Structure

```
supabase/
  migrations/         ← SQL migrations (Session 1c)
  functions/          ← Edge Functions for ingest handlers and shaping jobs
  seed.sql            ← local dev seed data (Session 4)
  config.toml         ← local Supabase CLI config
```

Migrations and the database schema are implemented in Session 1c.
Edge functions for ingest are implemented in Session 5b.
