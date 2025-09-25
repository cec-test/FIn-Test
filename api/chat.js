const axios = require('axios');

// OpenAI API configuration
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

// Smart question analysis functions
function analyzeQuestion(question) {
  const q = question.toLowerCase();
  
  return {
    type: getQuestionType(q),
    intent: getQuestionIntent(q),
    entities: extractEntities(q),
    timeframe: extractTimeframe(q),
    comparison: getComparisonType(q),
    aggregation: getAggregationType(q)
  };
}

function getQuestionType(q) {
  if (q.includes('trend') || q.includes('trending') || q.includes('over time')) return 'trend';
  if (q.includes('biggest') || q.includes('largest') || q.includes('highest')) return 'max';
  if (q.includes('smallest') || q.includes('lowest') || q.includes('minimum')) return 'min';
  if (q.includes('compare') || q.includes('vs') || q.includes('versus')) return 'compare';
  if (q.includes('what is') || q.includes('what\'s') || q.includes('value')) return 'value';
  if (q.includes('how much') || q.includes('total') || q.includes('sum')) return 'sum';
  if (q.includes('average') || q.includes('mean')) return 'average';
  return 'general';
}

function getQuestionIntent(q) {
  if (q.includes('revenue') || q.includes('sales') || q.includes('income')) return 'revenue';
  if (q.includes('expense') || q.includes('cost') || q.includes('operating')) return 'expense';
  if (q.includes('profit') || q.includes('net income')) return 'profit';
  if (q.includes('asset') || q.includes('liability') || q.includes('equity')) return 'balance';
  if (q.includes('cash') || q.includes('flow')) return 'cashflow';
  return 'general';
}

function extractEntities(q) {
  const entities = [];
  const words = q.split(/\s+/);
  
  // Look for specific line item names
  words.forEach(word => {
    if (word.length > 3 && !['what', 'how', 'when', 'where', 'which', 'the', 'and', 'or', 'for', 'in', 'at', 'to'].includes(word)) {
      entities.push(word);
    }
  });
  
  return entities;
}

function extractTimeframe(q) {
  if (q.includes('2024') || q.includes('2025') || q.includes('2026')) return 'specific_year';
  if (q.includes('january') || q.includes('february') || q.includes('march') || 
      q.includes('april') || q.includes('may') || q.includes('june') ||
      q.includes('july') || q.includes('august') || q.includes('september') ||
      q.includes('october') || q.includes('november') || q.includes('december')) return 'specific_month';
  if (q.includes('q1') || q.includes('q2') || q.includes('q3') || q.includes('q4')) return 'quarter';
  if (q.includes('monthly') || q.includes('month')) return 'monthly';
  if (q.includes('quarterly') || q.includes('quarter')) return 'quarterly';
  if (q.includes('annual') || q.includes('yearly') || q.includes('year')) return 'yearly';
  return 'all';
}

function getComparisonType(q) {
  if (q.includes('vs') || q.includes('versus') || q.includes('compared to')) return 'comparison';
  if (q.includes('bigger') || q.includes('smaller') || q.includes('higher') || q.includes('lower')) return 'relative';
  return 'none';
}

function getAggregationType(q) {
  if (q.includes('total') || q.includes('sum')) return 'sum';
  if (q.includes('average') || q.includes('mean')) return 'average';
  if (q.includes('biggest') || q.includes('largest')) return 'max';
  if (q.includes('smallest') || q.includes('lowest')) return 'min';
  return 'none';
}

function selectRelevantData(financialData, analysis) {
  const result = {
    statements: {},
    dateColumns: financialData.dateColumns || [],
    forecastSettings: financialData.forecastSettings || {},
    analysis: analysis
  };
  
  // Determine which statement types are needed
  const neededStatements = new Set();
  
  if (analysis.intent === 'revenue' || analysis.intent === 'expense' || analysis.intent === 'profit') {
    neededStatements.add('pnl');
  }
  if (analysis.intent === 'balance') {
    neededStatements.add('balance');
  }
  if (analysis.intent === 'cashflow') {
    neededStatements.add('cashflow');
  }
  if (analysis.intent === 'general') {
    neededStatements.add('pnl'); // Default to P&L for general questions
  }
  
  // Select relevant data based on question type
  neededStatements.forEach(statementType => {
    const allItems = financialData.statements?.[statementType] || [];
    
    if (analysis.type === 'value' && analysis.entities.length > 0) {
      // For specific value questions, find exact matches
      result.statements[statementType] = allItems.filter(item => 
        analysis.entities.some(entity => 
          item.name.toLowerCase().includes(entity.toLowerCase())
        )
      );
    } else if (analysis.type === 'trend' && analysis.intent !== 'general') {
      // For trend questions, include items related to the intent
      result.statements[statementType] = allItems.filter(item => {
        const name = item.name.toLowerCase();
        if (analysis.intent === 'revenue') {
          return name.includes('revenue') || name.includes('sales') || name.includes('income');
        } else if (analysis.intent === 'expense') {
          return name.includes('expense') || name.includes('cost') || name.includes('operating');
        } else if (analysis.intent === 'profit') {
          return name.includes('profit') || name.includes('income') || name.includes('net');
        }
        return true;
      });
    } else if (analysis.type === 'max' || analysis.type === 'min') {
      // For biggest/smallest questions, include all items of the relevant type
      if (analysis.intent === 'revenue') {
        result.statements[statementType] = allItems.filter(item => 
          item.name.toLowerCase().includes('revenue') || 
          item.name.toLowerCase().includes('sales') ||
          item.name.toLowerCase().includes('income')
        );
      } else if (analysis.intent === 'expense') {
        result.statements[statementType] = allItems.filter(item => 
          item.name.toLowerCase().includes('expense') || 
          item.name.toLowerCase().includes('cost') ||
          item.name.toLowerCase().includes('operating')
        );
      } else {
        result.statements[statementType] = allItems;
      }
    } else {
      // For general questions, include all items
      result.statements[statementType] = allItems;
    }
    
    // Limit data size - take only first 15 items if still too many
    if (result.statements[statementType].length > 15) {
      result.statements[statementType] = result.statements[statementType].slice(0, 15);
    }
  });
  
  return result;
}

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

    // Smart data filtering based on question analysis
    const questionAnalysis = analyzeQuestion(message);
    console.log('Question analysis:', questionAnalysis);
    
    let dataToSend = selectRelevantData(financialData, questionAnalysis);
    
    console.log('Selected data size:', JSON.stringify(dataToSend).length, 'characters');
    console.log('Selected statements:', Object.keys(dataToSend.statements));
    
    const prompt = `You are a financial analysis assistant. Here is the current financial forecast data from the user's financial statements:

${JSON.stringify(dataToSend, null, 2)}

User Question: ${message}

Question Analysis: ${JSON.stringify(questionAnalysis, null, 2)}

IMPORTANT: The user is currently viewing the ${dataToSend.activeTab || 'monthly'} tab. All data provided corresponds to this view.

Instructions:
- For specific value requests (like "revenue for December 2025"), look in the dateValues object for each line item
- Each line item has a "dateValues" object that maps dates to values (e.g., "Dec 31, 2025": 125000)
- For trend analysis, analyze the forecastValues array over time
- For "biggest/smallest" questions, compare values across line items
- For comparison questions, analyze multiple items together
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