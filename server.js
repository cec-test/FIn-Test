const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// OpenAI API configuration
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

// Validate API key on startup
if (!OPENAI_API_KEY) {
  console.error('❌ WARNING: OPENAI_API_KEY environment variable is not set!');
  console.error('Please set OPENAI_API_KEY in your .env file or Vercel environment variables');
} else {
  console.log('✅ OpenAI API key loaded successfully');
  console.log(`Key preview: ${OPENAI_API_KEY.substring(0, 10)}...${OPENAI_API_KEY.substring(OPENAI_API_KEY.length - 4)}`);
}

// Chat endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { message, financialData } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Check if API key is available
    if (!OPENAI_API_KEY) {
      console.error('API key missing when trying to make chat request');
      return res.status(500).json({ 
        error: 'OpenAI API key not configured',
        details: 'Please set OPENAI_API_KEY in environment variables'
      });
    }

    // Prepare the financial context
    let financialContext = '';
    if (financialData) {
      financialContext = `\n\nFinancial Data Context:\n${JSON.stringify(financialData, null, 2)}`;
    }

    // Create the prompt for OpenAI
    const systemPrompt = `You are a financial analysis assistant. You help users understand their financial data, including actuals and forecasts. You can answer questions about trends, patterns, and provide insights based on the financial data provided.${financialContext}`;

    // Call OpenAI API
    const response = await axios.post(OPENAI_API_URL, {
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: systemPrompt
        },
        {
          role: 'user',
          content: message
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

    const aiResponse = response.data.choices[0].message.content;

    res.json({
      success: true,
      response: aiResponse
    });

  } catch (error) {
    console.error('Error calling OpenAI API:', error);
    
    if (error.response) {
      console.error('OpenAI API Error Response:', error.response.data);
      console.error('OpenAI API Status:', error.response.status);
      
      // Check for common API key issues
      if (error.response.status === 401) {
        return res.status(500).json({ 
          error: 'Invalid or expired OpenAI API key', 
          details: error.response.data,
          hint: 'Please check your OPENAI_API_KEY in Vercel environment variables or .env file'
        });
      }
      
      res.status(500).json({ 
        error: 'OpenAI API error', 
        details: error.response.data 
      });
    } else {
      res.status(500).json({ 
        error: 'Internal server error', 
        details: error.message 
      });
    }
  }
});

// Balance sheet classification endpoint
app.post('/api/classify-balance-sheet', require('./api/classify-balance-sheet'));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Financial Analysis Backend is running' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Financial Analysis Backend running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
});

module.exports = app;