"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs/promises");

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", (error) => error ? reject(error) : resolve()));
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForHealth(baseUrl, child) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("DropRadar test server exited before becoming healthy.");
    try {
      const response = await fetch(baseUrl + "/api/health");
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("DropRadar test server did not become healthy in time.");
}

async function request(baseUrl, route, options = {}) {
  return fetch(baseUrl + route, {
    ...options,
    headers: { ...(options.headers || {}), Origin: baseUrl }
  });
}

test("account sessions isolate watchlists and allow the same URL for different users", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "dropradar-auth-"));
  const port = await freePort();
  const baseUrl = "http://127.0.0.1:" + port;
  const child = spawn(process.execPath, ["server.js"], {
    cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, PORT: String(port), DB_PATH: path.join(directory, "test.sqlite"), NODE_ENV: "test" },
    stdio: "ignore"
  });

  try {
    await waitForHealth(baseUrl, child);

    async function signup(email) {
      const response = await request(baseUrl, "/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: "a-long-test-password" })
      });
      assert.equal(response.status, 201);
      const cookie = response.headers.get("set-cookie");
      assert.ok(cookie);
      return cookie.split(";")[0];
    }

    const cookieA = await signup("first@example.test");
    const url = "https://www.flipkart.com/shared-item/p/itm123";
    const firstSave = await request(baseUrl, "/api/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieA },
      body: JSON.stringify({ title: "Shared item", url, targetPrice: "1000" })
    });
    assert.equal(firstSave.status, 201);

    const cookieB = await signup("second@example.test");
    const secondInitialList = await request(baseUrl, "/api/watchlist", {
      headers: { Cookie: cookieB }
    });
    assert.equal(secondInitialList.status, 200);
    assert.deepEqual((await secondInitialList.json()).items, []);

    const secondSave = await request(baseUrl, "/api/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieB },
      body: JSON.stringify({ title: "Shared item", url, targetPrice: "" })
    });
    assert.equal(secondSave.status, 201);

    const firstList = await request(baseUrl, "/api/watchlist", { headers: { Cookie: cookieA } });
    const secondList = await request(baseUrl, "/api/watchlist", { headers: { Cookie: cookieB } });
    assert.equal((await firstList.json()).items.length, 1);
    assert.equal((await secondList.json()).items.length, 1);

    const logout = await request(baseUrl, "/api/auth/logout", {
      method: "POST",
      headers: { Cookie: cookieA }
    });
    assert.equal(logout.status, 200);
    const afterLogout = await request(baseUrl, "/api/watchlist", { headers: { Cookie: cookieA } });
    assert.equal(afterLogout.status, 401);
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      if (child.exitCode !== null) return resolve();
      child.once("exit", resolve);
      setTimeout(resolve, 3000);
    });
    await fs.rm(directory, { recursive: true, force: true });
  }
});
