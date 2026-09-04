import test from "node:test";
import assert from "node:assert/strict";
import { isObsClient } from "./browserEnv";

test("isObsClient: detecta OBS via window.obsstudio", () => {
  const originalWindow = (globalThis as unknown as { window?: unknown }).window;
  try {
    (globalThis as unknown as { window: unknown }).window = {
      obsstudio: {},
    };
    assert.equal(isObsClient(), true);
  } finally {
    if (originalWindow === undefined) {
      delete (globalThis as unknown as { window?: unknown }).window;
    } else {
      (globalThis as unknown as { window: unknown }).window = originalWindow;
    }
  }
});

test("isObsClient: detecta OBS via User-Agent", () => {
  const originalWindow = (globalThis as unknown as { window?: unknown }).window;
  try {
    (globalThis as unknown as { window: unknown }).window = {
      navigator: {
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 OBS/30.0.2",
      },
    };
    assert.equal(isObsClient(), true);
  } finally {
    if (originalWindow === undefined) {
      delete (globalThis as unknown as { window?: unknown }).window;
    } else {
      (globalThis as unknown as { window: unknown }).window = originalWindow;
    }
  }
});

test("isObsClient: detecta OBS via rota /obs", () => {
  const originalWindow = (globalThis as unknown as { window?: unknown }).window;
  try {
    (globalThis as unknown as { window: unknown }).window = {
      location: {
        pathname: "/obs/minha-sala/screen/user-1",
        search: "",
      },
    };
    assert.equal(isObsClient(), true);
  } finally {
    if (originalWindow === undefined) {
      delete (globalThis as unknown as { window?: unknown }).window;
    } else {
      (globalThis as unknown as { window: unknown }).window = originalWindow;
    }
  }
});

