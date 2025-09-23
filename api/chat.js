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
    console.log('Financial data length:', financialData ? financialData.length : 'undefined');
    console.log('Financial data type:', typeof financialData);
    console.log('Financial data keys:', financialData ? Object.keys(financialData) : 'undefined');
    console.log('Financial data sample:', JSON.stringify(financialData, null, 2).substring(0, 1000) + '...');

    // Prepare the prompt with financial context
    const prompt = `You are a financial analysis assistant. Here is the current financial forecast data from the user's financial statements:

${financialData}

User Question: ${message}

Please provide a helpful response based on the financial forecast data provided. Focus on analyzing the trends, patterns, and insights from the forecasted financial statements. Do not ask for additional data - analyze what has been provided.`;

    // Call OpenAI API
    console.log('Making OpenAI API call...');
    console.log('API Key (first 10 chars):', OPENAI_API_KEY.substring(0, 10) + '...');
    
    const openaiResponse = await axios.post(OPENAI_API_URL, {
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'You are a helpful financial analysis assistant. Provide clear, actionable insights based on the provided financial data.'
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
    
    console.log('OpenAI API response received');

    const aiResponse = openaiResponse.data.choices[0].message.content;

    res.status(200).json({
      success: true,
      response: aiResponse
    });

  } catch (error) {
    console.error('OpenAI API error:', error.response?.data || error.message);
    console.error('Full error:', error);
    
    // Return more detailed error information
    res.status(500).json({
      success: false,
      error: 'Failed to process request with OpenAI API',
      details: error.message,
      type: error.name
    });
  }
};