const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// OpenAI API configuration
const OPENAI_API_KEY = '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';
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

// Chat endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { message, financialData } = req.body;
    
    if (!message) {
      return res.status(400).json({ 
        success: false, 
        error: 'Message is required' 
      });
    }

    // Prepare the prompt with financial context
    const prompt = `You are a financial analysis assistant. Here is the current financial data:

${financialData}

User Question: ${message}

Please provide a helpful response based on the financial data provided.`;

    // Call OpenAI API
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

    const aiResponse = openaiResponse.data.choices[0].message.content;

    res.json({
      success: true,
      response: aiResponse
    });

  } catch (error) {
    console.error('OpenAI API error:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to process request with OpenAI API'
    });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Backend server is running' });
});

module.exports = app;