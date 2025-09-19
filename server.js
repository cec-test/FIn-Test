const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// OpenAI API configuration
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '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';
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

// Chat endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { message, financialData } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
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
      console.error('OpenAI API Error:', error.response.data);
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