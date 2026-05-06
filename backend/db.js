// Postgres connection pool. All credentials come from environment variables —
// see `.env.example` for the full list. dotenv is loaded by server.js before
// this file is required, so process.env is already populated.
require("dotenv").config(); // safe to call twice; idempotent

const { Pool } = require("pg");

// Two ways to configure: either DATABASE_URL (one connection string,
// e.g. for Heroku / Render / Supabase) OR the individual PG* fields.
// We prefer DATABASE_URL when set.
const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
    })
  : new Pool({
      user:     process.env.PGUSER     || "postgres",
      host:     process.env.PGHOST     || "localhost",
      database: process.env.PGDATABASE || "TimeBridge",
      password: process.env.PGPASSWORD || "",
      port:     Number(process.env.PGPORT) || 5432,
    });

module.exports = pool;
