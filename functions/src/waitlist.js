"use strict";

const crypto = require("node:crypto");

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;
const ALLOWED_SOURCE_FORMS = new Set(["hero", "main", "footer"]);
const UTM_KEYS = ["source", "medium", "campaign", "term", "content"];

function normalizeOptionalString(value, maxLength) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.slice(0, maxLength);
}

function normalizeEmail(rawEmail) {
  if (typeof rawEmail !== "string") {
    return "";
  }

  return rawEmail.trim().toLowerCase();
}

function isValidEmail(email) {
  return EMAIL_REGEX.test(email);
}

function normalizeSourceForm(rawSource) {
  if (typeof rawSource !== "string") {
    return null;
  }

  const source = rawSource.trim().toLowerCase();
  return ALLOWED_SOURCE_FORMS.has(source) ? source : null;
}

function sanitizeUtm(rawUtm) {
  if (!rawUtm || typeof rawUtm !== "object" || Array.isArray(rawUtm)) {
    return null;
  }

  const utm = {};

  for (const key of UTM_KEYS) {
    const value = normalizeOptionalString(rawUtm[key], 150);
    if (value) {
      utm[key] = value;
    }
  }

  return Object.keys(utm).length > 0 ? utm : null;
}

function parseClientIp(req) {
  if (!req || typeof req !== "object") {
    return null;
  }

  const forwardedFor = req.headers && req.headers["x-forwarded-for"];
  if (typeof forwardedFor === "string" && forwardedFor.trim()) {
    return forwardedFor.split(",")[0].trim();
  }

  if (Array.isArray(forwardedFor) && forwardedFor.length > 0) {
    return String(forwardedFor[0]).trim();
  }

  const requestIp = typeof req.ip === "string" ? req.ip.trim() : "";
  return requestIp || null;
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

module.exports = {
  normalizeOptionalString,
  normalizeEmail,
  isValidEmail,
  normalizeSourceForm,
  sanitizeUtm,
  parseClientIp,
  sha256Hex,
};
