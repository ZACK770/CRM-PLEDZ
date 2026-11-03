/// <reference types="@cloudflare/vitest-pool-workers" />
import { env, applyD1Migrations, type D1Migration } from "cloudflare:test";
import type { Env } from "../server/core";
declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {
    TEST_MIGRATIONS: D1Migration[];
  }
}
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
