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

// RapidAPI configuration
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
const RAPIDAPI_HOST = 'openai-api.p.rapidapi.com';
const RAPIDAPI_URL = 'https://openai-api.p.rapidapi.com/v1/chat/completions';

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

    // Call RapidAPI OpenAI proxy
    const response = await axios.post(RAPIDAPI_URL, {
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
        'X-RapidAPI-Key': RAPIDAPI_KEY,
        'X-RapidAPI-Host': RAPIDAPI_HOST,
        'Content-Type': 'application/json'
      }
    });

    const aiResponse = response.data.choices[0].message.content;

    res.json({
      success: true,
      response: aiResponse
    });

  } catch (error) {
    console.error('Error calling RapidAPI OpenAI proxy:', error);
    
    if (error.response) {
      console.error('RapidAPI Error:', error.response.data);
      res.status(500).json({ 
        error: 'RapidAPI OpenAI proxy error', 
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