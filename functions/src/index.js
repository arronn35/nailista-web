"use strict";

const crypto = require("node:crypto");
const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");
const { onRequest } = require("firebase-functions/v2/https");
const {
  normalizeOptionalString,
  normalizeEmail,
  isValidEmail,
  normalizeSourceForm,
  sanitizeUtm,
  parseClientIp,
  sha256Hex,
} = require("./waitlist");

admin.initializeApp();

const db = admin.firestore();
const REGION = "europe-west1";
const RATE_LIMIT_MAX_PER_MINUTE = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const DEFAULT_ADMIN_LIMIT = 50;
const MAX_ADMIN_LIMIT = 200;
const EMAIL_FILTER_SCAN_LIMIT = 500;

function setCorsHeaders(req, res) {
  const origin = normalizeOptionalString(req.headers.origin, 300) || "*";
  res.set("Access-Control-Allow-Origin", origin);
  res.set("Vary", "Origin");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Admin-Token");
  res.set("Access-Control-Max-Age", "3600");
}

function respond(res, statusCode, status, message) {
  const success = statusCode >= 200 && statusCode < 300;
  return res.status(statusCode).json({ success, status, message });
}

function parseJsonBody(req) {
  if (!req.body) {
    return {};
  }

  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch (_error) {
      return null;
    }
  }

  if (typeof req.body === "object") {
    return req.body;
  }

  return null;
}

function clampLimit(value, defaultValue) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return defaultValue;
  }

  const rounded = Math.floor(parsed);
  return Math.min(MAX_ADMIN_LIMIT, Math.max(1, rounded));
}

function parseDateInput(value) {
  const normalized = normalizeOptionalString(value, 80);
  if (!normalized) {
    return { provided: false, date: null, valid: true };
  }

  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return { provided: true, date: null, valid: false };
  }

  return { provided: true, date, valid: true };
}

function extractAdminToken(req, body) {
  const authHeader = normalizeOptionalString(req.headers.authorization, 1200);
  if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
    return authHeader.slice(7).trim();
  }

  const rawHeaderToken = req.headers["x-admin-token"];
  const headerToken = normalizeOptionalString(
    Array.isArray(rawHeaderToken) ? rawHeaderToken[0] : rawHeaderToken,
    1200,
  );
  if (headerToken) {
    return headerToken;
  }

  return normalizeOptionalString(body && body.token, 1200);
}

function timingSafeEqualString(a, b) {
  const aBuffer = Buffer.from(String(a));
  const bBuffer = Buffer.from(String(b));
  if (aBuffer.length !== bBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(aBuffer, bBuffer);
}

function timestampToIso(value) {
  if (!value || typeof value.toDate !== "function") {
    return null;
  }

  try {
    return value.toDate().toISOString();
  } catch (_error) {
    return null;
  }
}

async function passRateLimit(ipHash) {
  const rateRef = db.collection("waitlist_rate_limits").doc(ipHash);
  const nowMs = Date.now();

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(rateRef);
    let count = 1;
    let windowStartedAtMs = nowMs;

    if (snap.exists) {
      const data = snap.data() || {};
      const previousWindowStart = Number(data.windowStartedAtMs || 0);
      const previousCount = Number(data.count || 0);
      const withinActiveWindow =
        previousWindowStart > 0 && nowMs - previousWindowStart < RATE_LIMIT_WINDOW_MS;

      if (withinActiveWindow) {
        count = previousCount + 1;
        windowStartedAtMs = previousWindowStart;
      }
    }

    tx.set(
      rateRef,
      {
        count,
        windowStartedAtMs,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    return count <= RATE_LIMIT_MAX_PER_MINUTE;
  });
}

async function upsertWaitlistLead({
  email,
  emailKey,
  sourceForm,
  utm,
  referrer,
  userAgent,
  ipHash,
}) {
  const waitlistRef = db.collection("waitlist").doc(emailKey);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(waitlistRef);

    if (!snap.exists) {
      tx.set(waitlistRef, {
        email,
        emailKey,
        sourceForm,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        lastSubmittedAt: admin.firestore.FieldValue.serverTimestamp(),
        submitCount: 1,
        utm: utm || null,
        referrer: referrer || null,
        userAgent: userAgent || null,
        ipHash: ipHash || null,
      });
      return "created";
    }

    tx.update(waitlistRef, {
      sourceForm,
      lastSubmittedAt: admin.firestore.FieldValue.serverTimestamp(),
      submitCount: admin.firestore.FieldValue.increment(1),
      utm: utm || null,
      referrer: referrer || null,
      userAgent: userAgent || null,
      ipHash: ipHash || null,
    });

    return "already_exists";
  });
}

exports.submitWaitlist = onRequest({ region: REGION }, async (req, res) => {
  setCorsHeaders(req, res);

  if (req.method === "OPTIONS") {
    return res.status(204).send("");
  }

  if (req.method !== "POST") {
    res.set("Allow", "POST, OPTIONS");
    return respond(res, 405, "invalid", "Only POST requests are allowed.");
  }

  const body = parseJsonBody(req);
  if (!body || typeof body !== "object") {
    return respond(res, 400, "invalid", "Request body must be valid JSON.");
  }

  const email = normalizeEmail(body.email);
  const sourceForm = normalizeSourceForm(body.sourceForm);
  const utm = sanitizeUtm(body.utm);
  const referrer = normalizeOptionalString(
    body.referrer || req.headers.referer || req.headers.referrer,
    1200,
  );
  const userAgent = normalizeOptionalString(req.headers["user-agent"], 600);

  if (!email || !isValidEmail(email) || !sourceForm) {
    return respond(res, 400, "invalid", "Please provide a valid email and source form.");
  }

  const clientIp = parseClientIp(req);
  const ipHash = clientIp ? sha256Hex(clientIp) : null;
  const emailKey = sha256Hex(email);

  try {
    if (ipHash) {
      const allowed = await passRateLimit(ipHash);
      if (!allowed) {
        return respond(
          res,
          429,
          "rate_limited",
          "Too many requests. Please wait a minute and try again.",
        );
      }
    }

    const status = await upsertWaitlistLead({
      email,
      emailKey,
      sourceForm,
      utm,
      referrer,
      userAgent,
      ipHash,
    });

    if (status === "already_exists") {
      return respond(res, 200, status, "This email is already on the waitlist.");
    }

    return respond(res, 200, status, "You are on the waitlist.");
  } catch (error) {
    logger.error("submitWaitlist failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return respond(res, 500, "invalid", "Unexpected server error.");
  }
});

exports.listWaitlistEntries = onRequest({ region: REGION }, async (req, res) => {
  setCorsHeaders(req, res);

  if (req.method === "OPTIONS") {
    return res.status(204).send("");
  }

  if (req.method !== "POST") {
    res.set("Allow", "POST, OPTIONS");
    return respond(res, 405, "invalid", "Only POST requests are allowed.");
  }

  const body = parseJsonBody(req);
  if (!body || typeof body !== "object") {
    return respond(res, 400, "invalid", "Request body must be valid JSON.");
  }

  const serverToken = normalizeOptionalString(process.env.WAITLIST_ADMIN_TOKEN, 1200);
  if (!serverToken) {
    logger.error("listWaitlistEntries missing WAITLIST_ADMIN_TOKEN environment variable");
    return respond(res, 503, "invalid", "Admin token is not configured on the server.");
  }

  const requestToken = extractAdminToken(req, body);
  if (!requestToken || !timingSafeEqualString(requestToken, serverToken)) {
    return respond(res, 401, "invalid", "Unauthorized admin token.");
  }

  const sourceFormRaw = normalizeOptionalString(body.sourceForm, 20);
  const sourceForm = sourceFormRaw ? normalizeSourceForm(sourceFormRaw) : null;
  if (sourceFormRaw && !sourceForm) {
    return respond(res, 400, "invalid", "sourceForm must be hero, main, or footer.");
  }

  const emailQuery = normalizeOptionalString(body.emailQuery, 320);
  const limit = clampLimit(body.limit, DEFAULT_ADMIN_LIMIT);
  const fromDateInput = parseDateInput(body.fromDate);
  const toDateInput = parseDateInput(body.toDate);

  if (!fromDateInput.valid || !toDateInput.valid) {
    return respond(res, 400, "invalid", "fromDate/toDate must be valid date strings.");
  }

  if (fromDateInput.date && toDateInput.date && fromDateInput.date > toDateInput.date) {
    return respond(res, 400, "invalid", "fromDate cannot be after toDate.");
  }

  try {
    let query = db.collection("waitlist");

    if (sourceForm) {
      query = query.where("sourceForm", "==", sourceForm);
    }
    if (fromDateInput.date) {
      query = query.where("lastSubmittedAt", ">=", admin.firestore.Timestamp.fromDate(fromDateInput.date));
    }
    if (toDateInput.date) {
      query = query.where("lastSubmittedAt", "<=", admin.firestore.Timestamp.fromDate(toDateInput.date));
    }

    query = query.orderBy("lastSubmittedAt", "desc");

    const readLimit = emailQuery
      ? Math.min(EMAIL_FILTER_SCAN_LIMIT, Math.max(limit, limit * 5))
      : limit;

    const snapshot = await query.limit(readLimit).get();
    let entries = snapshot.docs.map((doc) => {
      const data = doc.data() || {};
      return {
        id: doc.id,
        email: data.email || null,
        sourceForm: data.sourceForm || null,
        submitCount: Number(data.submitCount || 0),
        createdAt: timestampToIso(data.createdAt),
        lastSubmittedAt: timestampToIso(data.lastSubmittedAt),
        utm: data.utm || null,
        referrer: data.referrer || null,
        userAgent: data.userAgent || null,
      };
    });

    if (emailQuery) {
      const emailQueryLower = emailQuery.toLowerCase();
      entries = entries.filter((entry) =>
        String(entry.email || "").toLowerCase().includes(emailQueryLower),
      );
    }

    entries = entries.slice(0, limit);

    return res.status(200).json({
      success: true,
      status: "ok",
      message: "Waitlist entries fetched.",
      totalReturned: entries.length,
      filters: {
        sourceForm: sourceForm || null,
        emailQuery: emailQuery || null,
        fromDate: fromDateInput.date ? fromDateInput.date.toISOString() : null,
        toDate: toDateInput.date ? toDateInput.date.toISOString() : null,
        limit,
      },
      entries,
    });
  } catch (error) {
    logger.error("listWaitlistEntries failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return respond(res, 500, "invalid", "Unexpected server error.");
  }
});
