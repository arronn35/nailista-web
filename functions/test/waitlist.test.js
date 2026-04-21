"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeOptionalString,
  normalizeEmail,
  isValidEmail,
  normalizeSourceForm,
  sanitizeUtm,
  parseClientIp,
  sha256Hex,
} = require("../src/waitlist");

test("normalizeEmail trims and lowercases", () => {
  assert.equal(normalizeEmail("  TEST@Example.COM "), "test@example.com");
});

test("isValidEmail validates expected email formats", () => {
  assert.equal(isValidEmail("user@example.com"), true);
  assert.equal(isValidEmail("user.example.com"), false);
});

test("normalizeSourceForm only allows known form sources", () => {
  assert.equal(normalizeSourceForm("hero"), "hero");
  assert.equal(normalizeSourceForm("MAIN"), "main");
  assert.equal(normalizeSourceForm("landing"), null);
});

test("sanitizeUtm keeps only allowed keys with trimmed values", () => {
  const utm = sanitizeUtm({
    source: " instagram ",
    medium: "social",
    campaign: "spring_launch",
    unknown: "ignored",
  });

  assert.deepEqual(utm, {
    source: "instagram",
    medium: "social",
    campaign: "spring_launch",
  });
});

test("parseClientIp prefers x-forwarded-for", () => {
  const ip = parseClientIp({
    headers: { "x-forwarded-for": "198.51.100.9, 10.0.0.1" },
    ip: "10.0.0.1",
  });

  assert.equal(ip, "198.51.100.9");
});

test("sha256Hex returns deterministic hash output", () => {
  assert.equal(
    sha256Hex("test@example.com"),
    "973dfe463ec85785f5f95af5ba3906eedb2d931c24e69824a89ea65dba4e813b",
  );
});

test("normalizeOptionalString returns null for invalid values", () => {
  assert.equal(normalizeOptionalString("", 10), null);
  assert.equal(normalizeOptionalString(null, 10), null);
});
