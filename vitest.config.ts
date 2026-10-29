import {
  defineWorkersConfig,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers/config";
export default defineWorkersConfig(async () => ({
  test: {
    setupFiles: ["./tests/setup.ts"],
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            BOOTSTRAP_TOKEN:
              "test-only-bootstrap-token-at-least-twenty-characters",
            BREVO_WEBHOOK_TOKEN: "test-only-webhook-token",
            TEST_MIGRATIONS: await readD1Migrations("./migrations"),
          },
        },
      },
    },
  },
}));
