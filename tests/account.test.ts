import { env } from "cloudflare:test";
import { expect, it } from "vitest";
import { app } from "../server/index";
import { passwordHash } from "../server/auth";
import { hash } from "../server/core";

it("changes a password, invalidates other sessions, and keeps the current session", async () => {
  const password = "Original-password-123!",
    newPassword = "Changed-password-123!";
  await env.DB.prepare(
    "INSERT INTO users(id,name,email,password) VALUES(?,?,?,?)",
  )
    .bind("u", "owner", "owner@example.test", await passwordHash(password))
    .run();
  for (const token of ["current", "other"])
    await env.DB.prepare(
      "INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)",
    )
      .bind(await hash(token), "u", Math.floor(Date.now() / 1000) + 3600)
      .run();
  const change = await app.request(
    "https://crm.test/api/auth/password",
    {
      method: "PUT",
      headers: {
        Origin: "https://crm.test",
        Cookie: "crm_session=current",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        current_password: password,
        password: newPassword,
      }),
    },
    env,
  );
  expect(change.status).toBe(200);
  expect(
    (await env.DB.prepare("SELECT COUNT(*) n FROM sessions").first<{
      n: number;
    }>())!.n,
  ).toBe(1);
  const u = await env.DB.prepare("SELECT password FROM users WHERE id=?")
    .bind("u")
    .first<{ password: string }>();
  expect(u!.password).toBe(
    await passwordHash(newPassword, u!.password.split(":")[0]),
  );
});
