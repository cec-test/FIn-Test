/**
 * Billing Communication Process Identifier Utility
 * 
 * Generates and manages unique identifiers for billing and communication processes
 * Format: bc-{uuid}
 * Example: bc-58d6bab3-5f1f-4ad6-9148-e801c233b223
 */

const crypto = require('crypto');

/**
 * Generates a unique billing communication process identifier
 * @returns {string} Identifier in format bc-{uuid}
 */
function generateProcessIdentifier() {
  const uuid = crypto.randomUUID();
  return `bc-${uuid}`;
}

/**
 * Validates a billing communication process identifier
 * @param {string} identifier - The identifier to validate
 * @returns {boolean} True if valid, false otherwise
 */
function validateProcessIdentifier(identifier) {
  if (!identifier || typeof identifier !== 'string') {
    return false;
  }
  
  // Format: bc-{uuid} (lowercase prefix, case-insensitive UUID)
  // Must start with lowercase "bc-"
  if (!identifier.startsWith('bc-')) {
    return false;
  }
  
  // Validate full format with case-insensitive UUID
  const pattern = /^bc-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return pattern.test(identifier);
}

/**
 * Extracts process identifier from request headers or generates a new one
 * @param {object} req - Express request object
 * @returns {string} Process identifier
 */
function getOrCreateProcessIdentifier(req) {
  const existingId = req.headers['x-process-id'] || req.query.processId;
  
  if (existingId && validateProcessIdentifier(existingId)) {
    return existingId;
  }
  
  return generateProcessIdentifier();
}

/**
 * Attaches process identifier to response headers
 * @param {object} res - Express response object
 * @param {string} processId - Process identifier
 */
function attachProcessIdentifier(res, processId) {
  res.setHeader('X-Process-Id', processId);
  res.setHeader('X-Billing-Communication-Id', processId);
}

/**
 * Middleware to automatically add process identifiers to all requests
 */
function processIdentifierMiddleware(req, res, next) {
  const processId = getOrCreateProcessIdentifier(req);
  req.processId = processId;
  attachProcessIdentifier(res, processId);
  
  // Log the process identifier for tracking
  console.log(`[${new Date().toISOString()}] Process ID: ${processId} - ${req.method} ${req.path}`);
  
  next();
}

module.exports = {
  generateProcessIdentifier,
  validateProcessIdentifier,
  getOrCreateProcessIdentifier,
  attachProcessIdentifier,
  processIdentifierMiddleware
};
