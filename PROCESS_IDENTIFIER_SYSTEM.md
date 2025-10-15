# Billing Communication Process Identifier System

## Overview

This system implements unique process identifiers for all API requests to enable:
- **Billing tracking**: Track API usage for billing purposes
- **Request tracing**: Trace requests through the system for debugging
- **Audit trails**: Maintain a complete audit log of all API communications
- **Error correlation**: Link errors to specific requests

## Identifier Format

Process identifiers follow the format: `bc-{uuid}`

Example: `bc-58d6bab3-5f1f-4ad6-9148-e801c233b223`

- Prefix: `bc-` (billing-communication)
- UUID: RFC 4122 compliant UUID v4

## Implementation

### Automatic Generation

All API endpoints automatically generate a unique process identifier for each request. The identifier is:

1. **Generated** on the server side when a request arrives
2. **Attached** to response headers (`X-Process-Id` and `X-Billing-Communication-Id`)
3. **Returned** in the JSON response body
4. **Logged** in server logs for tracking

### Client-Provided Identifiers

Clients can optionally provide their own process identifier in one of two ways:

1. **Request Header**: `X-Process-Id: bc-{uuid}`
2. **Query Parameter**: `?processId=bc-{uuid}`

If a valid identifier is provided, it will be used. Otherwise, a new one is generated.

## API Endpoints

All endpoints support process identifiers:

### Health Check
```bash
GET /api/health
```

**Response:**
```json
{
  "status": "OK",
  "message": "Backend server is running",
  "processId": "bc-58d6bab3-5f1f-4ad6-9148-e801c233b223",
  "timestamp": "2025-10-15T20:35:00.000Z",
  "envCheck": {
    "hasOpenAIKey": true,
    "keyLength": 51,
    "envKeys": ["OPENAI_API_KEY"]
  }
}
```

### Chat Endpoint
```bash
POST /api/chat
Content-Type: application/json

{
  "message": "What is the revenue for December 2025?",
  "financialData": { ... }
}
```

**Response:**
```json
{
  "success": true,
  "response": "The revenue for December 2025 is $125,000.",
  "processId": "bc-12345678-1234-1234-1234-123456789abc"
}
```

### Balance Sheet Classification
```bash
POST /api/classify-balance-sheet
Content-Type: application/json

{
  "lineItems": ["Cash", "Accounts Receivable", "Inventory"]
}
```

**Response:**
```json
{
  "success": true,
  "classifications": [...],
  "processId": "bc-87654321-4321-4321-4321-cba987654321",
  "metadata": {
    "totalItems": 3,
    "highConfidence": 3,
    "mediumConfidence": 0,
    "lowConfidence": 0
  }
}
```

## Response Headers

All API responses include these headers:

- `X-Process-Id`: The process identifier
- `X-Billing-Communication-Id`: Same as X-Process-Id (for compatibility)

## Server Logs

All log entries include the process identifier for easy tracking:

```
[2025-10-15T20:35:00.000Z] Process ID: bc-58d6bab3-5f1f-4ad6-9148-e801c233b223 - POST /api/chat
[Process: bc-58d6bab3-5f1f-4ad6-9148-e801c233b223] Chat request received
[Process: bc-58d6bab3-5f1f-4ad6-9148-e801c233b223] OpenAI API response received
[Process: bc-58d6bab3-5f1f-4ad6-9148-e801c233b223] Chat request successful
```

## Error Responses

Error responses also include the process identifier:

```json
{
  "success": false,
  "error": "Message is required",
  "processId": "bc-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
}
```

## Usage Examples

### JavaScript/Fetch
```javascript
// Let the server generate an identifier
const response = await fetch('http://localhost:3001/api/health');
const data = await response.json();
console.log('Process ID:', data.processId);
console.log('Header:', response.headers.get('X-Process-Id'));

// Or provide your own identifier
const processId = 'bc-' + crypto.randomUUID();
const response = await fetch('http://localhost:3001/api/chat', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Process-Id': processId
  },
  body: JSON.stringify({
    message: 'What is the revenue?',
    financialData: {}
  })
});
```

### cURL
```bash
# Server-generated identifier
curl http://localhost:3001/api/health

# Client-provided identifier
curl -H "X-Process-Id: bc-12345678-1234-1234-1234-123456789abc" \
     -H "Content-Type: application/json" \
     -d '{"message":"What is the revenue?","financialData":{}}' \
     http://localhost:3001/api/chat
```

## Benefits

### For Developers
- **Debugging**: Easily trace a request through logs
- **Error Tracking**: Correlate errors with specific requests
- **Testing**: Reproducible test scenarios

### For Operations
- **Monitoring**: Track request volume and patterns
- **Performance**: Identify slow requests
- **Auditing**: Complete audit trail of all API calls

### For Business
- **Billing**: Accurate usage tracking for billing
- **Analytics**: Understand API usage patterns
- **Compliance**: Meet regulatory requirements for audit trails

## Technical Details

### Implementation Files

- `api/identifier-utils.js`: Core utility functions
- `server.js`: Middleware integration for Express server
- `api/chat.js`: Vercel serverless function with identifiers
- `api/classify-balance-sheet.js`: Balance sheet classification with identifiers
- `api/health.js`: Health check with identifiers

### Validation

Process identifiers are validated using the pattern:
```javascript
/^bc-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
```

Invalid identifiers are rejected and a new one is generated.

## Node.js Version Requirements

This system uses `crypto.randomUUID()` which requires Node.js >= 14.17.0 or >= 16.0.0.

Make sure your environment meets this requirement.
