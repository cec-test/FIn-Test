const { getOrCreateProcessIdentifier, attachProcessIdentifier } = require('./identifier-utils');

module.exports = (req, res) => {
  // Generate or extract process identifier for tracking
  const processId = getOrCreateProcessIdentifier(req);
  attachProcessIdentifier(res, processId);
  
  console.log(`[Process: ${processId}] Health check request`);
  
  res.json({ 
    status: 'OK', 
    message: 'Backend server is running',
    processId: processId,
    timestamp: new Date().toISOString(),
    envCheck: {
      hasOpenAIKey: !!process.env.OPENAI_API_KEY,
      keyLength: process.env.OPENAI_API_KEY ? process.env.OPENAI_API_KEY.length : 0,
      envKeys: Object.keys(process.env).filter(key => key.includes('OPENAI'))
    }
  });
};