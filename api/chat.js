const axios = require('axios');

// OpenAI API configuration
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ 
      success: false, 
      error: 'Method not allowed' 
    });
  }

  try {
    console.log('Request method:', req.method);
    console.log('Request body:', req.body);
    console.log('Request headers:', req.headers);
    
    // Check if API key is available
    console.log('Environment variables available:', Object.keys(process.env));
    console.log('OPENAI_API_KEY exists:', !!process.env.OPENAI_API_KEY);
    console.log('OPENAI_API_KEY length:', process.env.OPENAI_API_KEY ? process.env.OPENAI_API_KEY.length : 'undefined');
    
    if (!OPENAI_API_KEY) {
      console.error('OpenAI API key not found in environment variables');
      return res.status(500).json({
        success: false,
        error: 'OpenAI API key not configured',
        debug: {
          envKeys: Object.keys(process.env).filter(key => key.includes('OPENAI')),
          hasKey: !!process.env.OPENAI_API_KEY
        }
      });
    }
    
    const { message, financialData } = req.body;
    
    if (!message) {
      console.log('No message provided');
      return res.status(400).json({ 
        success: false, 
        error: 'Message is required' 
      });
    }
    
    console.log('Message received:', message);
    console.log('Financial data length:', financialData ? JSON.stringify(financialData).length : 'undefined');
    console.log('Financial data type:', typeof financialData);
    console.log('Financial data keys:', financialData ? Object.keys(financialData) : 'undefined');
    
    // Check if financial data is too large
    const dataString = JSON.stringify(financialData);
    if (dataString.length > 50000) {
      console.log('Financial data is very large:', dataString.length, 'characters');
      console.log('Truncating for debugging...');
    }
    
    console.log('Financial data sample:', dataString.substring(0, 2000) + '...');

    // Smart data filtering based on question content
    let dataToSend = financialData;
    
    // Analyze question to determine which statement types are relevant
    const questionLower = message.toLowerCase();
    const relevantStatements = {};
    
    // Check for specific line item mentions
    const allLineItems = [
      ...(financialData.statements?.pnl || []),
      ...(financialData.statements?.balance || []),
      ...(financialData.statements?.cashflow || [])
    ];
    
    const mentionedItems = allLineItems.filter(item => 
      questionLower.includes(item.name.toLowerCase())
    );
    
    // If specific line items mentioned, include their full data
    if (mentionedItems.length > 0) {
      console.log('Specific line items mentioned:', mentionedItems.map(item => item.name));
      
      // Group mentioned items by statement type
      mentionedItems.forEach(item => {
        if (financialData.statements?.pnl?.some(pnlItem => pnlItem.name === item.name)) {
          if (!relevantStatements.pnl) relevantStatements.pnl = [];
          relevantStatements.pnl.push(item);
        }
        if (financialData.statements?.balance?.some(balItem => balItem.name === item.name)) {
          if (!relevantStatements.balance) relevantStatements.balance = [];
          relevantStatements.balance.push(item);
        }
        if (financialData.statements?.cashflow?.some(cfItem => cfItem.name === item.name)) {
          if (!relevantStatements.cashflow) relevantStatements.cashflow = [];
          relevantStatements.cashflow.push(item);
        }
      });
    }
    
    // Determine which statements are relevant based on question keywords
    if (questionLower.includes('revenue') || questionLower.includes('sales') || 
        questionLower.includes('income') || questionLower.includes('profit') ||
        questionLower.includes('expense') || questionLower.includes('cost') ||
        questionLower.includes('p&l') || questionLower.includes('profit and loss')) {
      relevantStatements.pnl = financialData.statements?.pnl || [];
    }
    
    if (questionLower.includes('asset') || questionLower.includes('liability') || 
        questionLower.includes('equity') || questionLower.includes('balance sheet') ||
        questionLower.includes('balance')) {
      relevantStatements.balance = financialData.statements?.balance || [];
    }
    
    if (questionLower.includes('cash') || questionLower.includes('flow') ||
        questionLower.includes('operating') || questionLower.includes('investing') ||
        questionLower.includes('financing') || questionLower.includes('cash flow')) {
      relevantStatements.cashflow = financialData.statements?.cashflow || [];
    }
    
    // If no specific statements identified, include all
    if (Object.keys(relevantStatements).length === 0) {
      relevantStatements.pnl = financialData.statements?.pnl || [];
      relevantStatements.balance = financialData.statements?.balance || [];
      relevantStatements.cashflow = financialData.statements?.cashflow || [];
    }
    
    dataToSend = {
      statements: relevantStatements,
      dateColumns: financialData.dateColumns || [],
      forecastSettings: financialData.forecastSettings || {}
    };
    
    console.log('Relevant statements for question:', Object.keys(relevantStatements));
    
    const prompt = `You are a financial analysis assistant. Here is the current financial forecast data from the user's financial statements:

${JSON.stringify(dataToSend, null, 2)}

User Question: ${message}

IMPORTANT: The user is currently viewing the ${dataToSend.activeTab || 'monthly'} tab. All data provided corresponds to this view.

Instructions:
- For specific value requests (like "revenue for December 2025"), look in the dateValues object for each line item
- Each line item has a "dateValues" object that maps dates to values (e.g., "Dec 31, 2025": 125000)
- For trend analysis, analyze the forecastValues array over time
- Be concise and direct - don't ask for additional data
- If you can't find a specific value, say "Value not found in the data"
- Format currency values properly (e.g., $125,000)
- Remember: You're analyzing ${dataToSend.activeTab || 'monthly'} data

Please provide a helpful response based on the financial forecast data provided.`;

    // Call OpenAI API with retry logic for rate limiting
    console.log('Making OpenAI API call...');
    console.log('API Key (first 10 chars):', OPENAI_API_KEY.substring(0, 10) + '...');
    
    // Use GPT-4 for larger datasets (better context handling)
    const modelToUse = JSON.stringify(dataToSend).length > 20000 ? 'gpt-4' : 'gpt-3.5-turbo';
    console.log('Using model:', modelToUse);
    
    let openaiResponse;
    let retryCount = 0;
    const maxRetries = 3;
    
    while (retryCount < maxRetries) {
      try {
        openaiResponse = await axios.post(OPENAI_API_URL, {
          model: modelToUse,
          messages: [
            {
              role: 'system',
              content: 'You are a direct financial analysis assistant. When users ask for specific values, provide the exact number from the data. Be concise and factual. For example: "Services revenue for December 2025: $125,000" or "Value not found in the data".'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          max_tokens: 1000,
          temperature: 0.7
        }, {
          headers: {
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
          }
        });
        break; // Success, exit retry loop
      } catch (error) {
        if (error.response?.status === 429 && retryCount < maxRetries - 1) {
          retryCount++;
          const waitTime = Math.pow(2, retryCount) * 1000; // Exponential backoff
          console.log(`Rate limited, retrying in ${waitTime}ms (attempt ${retryCount}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        } else {
          throw error; // Re-throw if not rate limit or max retries reached
        }
      }
    }
    
    console.log('OpenAI API response received');

    const aiResponse = openaiResponse.data.choices[0].message.content;

    res.status(200).json({
      success: true,
      response: aiResponse
    });

  } catch (error) {
    console.error('OpenAI API error:', error.response?.data || error.message);
    console.error('Full error:', error);
    console.error('Error stack:', error.stack);
    
    // Return more detailed error information
    res.status(500).json({
      success: false,
      error: 'Failed to process request with OpenAI API',
      details: error.message,
      type: error.name,
      stack: error.stack?.substring(0, 500) // Truncate stack trace
    });
  }
};