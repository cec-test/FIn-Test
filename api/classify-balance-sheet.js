const axios = require('axios');

// OpenAI API configuration
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

/**
 * Balance Sheet Line Item Classification Categories
 */
const CLASSIFICATION_CATEGORIES = {
  // Current Assets
  'cash': {
    standardName: 'Cash and Cash Equivalents',
    driver: 'calculated',
    method: 'cash_flow_balancing',
    category: 'current_assets'
  },
  'accounts_receivable': {
    standardName: 'Accounts Receivable',
    driver: 'revenue',
    method: 'days_sales_outstanding',
    category: 'current_assets'
  },
  'inventory': {
    standardName: 'Inventory',
    driver: 'cost_of_goods_sold',
    method: 'days_inventory_outstanding',
    category: 'current_assets'
  },
  'prepaid_expenses': {
    standardName: 'Prepaid Expenses',
    driver: 'revenue',
    method: 'percentage_of_revenue',
    category: 'current_assets'
  },
  'short_term_investments': {
    standardName: 'Short-term Investments',
    driver: 'manual',
    method: 'growth_rate',
    category: 'current_assets'
  },
  
  // Fixed Assets
  'property_plant_equipment': {
    standardName: 'Property, Plant & Equipment',
    driver: 'depreciation',
    method: 'capex_depreciation',
    category: 'fixed_assets'
  },
  'intangible_assets': {
    standardName: 'Intangible Assets',
    driver: 'revenue',
    method: 'percentage_of_revenue',
    category: 'fixed_assets'
  },
  'goodwill': {
    standardName: 'Goodwill',
    driver: 'manual',
    method: 'static_value',
    category: 'fixed_assets'
  },
  
  // Other Assets
  'long_term_investments': {
    standardName: 'Long-term Investments',
    driver: 'manual',
    method: 'growth_rate',
    category: 'other_assets'
  },
  'deferred_tax_assets': {
    standardName: 'Deferred Tax Assets',
    driver: 'pre_tax_income',
    method: 'tax_calculation',
    category: 'other_assets'
  },
  
  // Current Liabilities
  'accounts_payable': {
    standardName: 'Accounts Payable',
    driver: 'operating_expenses',
    method: 'days_payable_outstanding',
    category: 'current_liabilities'
  },
  'accrued_expenses': {
    standardName: 'Accrued Expenses',
    driver: 'total_expenses',
    method: 'percentage_of_expenses',
    category: 'current_liabilities'
  },
  'short_term_debt': {
    standardName: 'Short-term Debt',
    driver: 'manual',
    method: 'debt_schedule',
    category: 'current_liabilities'
  },
  'deferred_revenue': {
    standardName: 'Deferred Revenue',
    driver: 'revenue',
    method: 'percentage_of_revenue',
    category: 'current_liabilities'
  },
  'accrued_payroll': {
    standardName: 'Accrued Payroll',
    driver: 'payroll_expenses',
    method: 'percentage_of_payroll',
    category: 'current_liabilities'
  },
  
  // Long-term Liabilities
  'long_term_debt': {
    standardName: 'Long-term Debt',
    driver: 'manual',
    method: 'debt_schedule',
    category: 'long_term_liabilities'
  },
  'deferred_tax_liabilities': {
    standardName: 'Deferred Tax Liabilities',
    driver: 'pre_tax_income',
    method: 'tax_calculation',
    category: 'long_term_liabilities'
  },
  
  // Equity
  'common_stock': {
    standardName: 'Common Stock',
    driver: 'manual',
    method: 'equity_schedule',
    category: 'equity'
  },
  'retained_earnings': {
    standardName: 'Retained Earnings',
    driver: 'net_income',
    method: 'accumulated_earnings',
    category: 'equity'
  },
  'additional_paid_in_capital': {
    standardName: 'Additional Paid-in Capital',
    driver: 'manual',
    method: 'equity_schedule',
    category: 'equity'
  },
  'treasury_stock': {
    standardName: 'Treasury Stock',
    driver: 'manual',
    method: 'equity_schedule',
    category: 'equity'
  }
};

/**
 * Create AI prompt for balance sheet classification
 */
function createClassificationPrompt(lineItems) {
  const categoriesDescription = Object.keys(CLASSIFICATION_CATEGORIES)
    .map(key => `${key}: ${CLASSIFICATION_CATEGORIES[key].standardName}`)
    .join('\n');

  return `You are a financial statement analysis expert. Classify these balance sheet line items into the most appropriate category.

AVAILABLE CATEGORIES:
${categoriesDescription}

INSTRUCTIONS:
1. For each line item, identify the MOST LIKELY category from the list above
2. Provide a confidence score (0.0 to 1.0) based on how certain you are
3. If the line item doesn't clearly fit any category, use your best judgment and lower the confidence
4. Consider common variations (e.g., "A/R" = accounts_receivable, "PP&E" = property_plant_equipment)
5. Look for keywords that indicate the nature of the item

LINE ITEMS TO CLASSIFY:
${lineItems.map((item, index) => `${index + 1}. "${item}"`).join('\n')}

Respond with ONLY a valid JSON array in this exact format:
[
  {
    "originalName": "line item name exactly as provided",
    "category": "category_key_from_list_above",
    "confidence": 0.95
  }
]

Do not include any other text or explanation, just the JSON array.`;
}

/**
 * Process AI classification response and enrich with metadata
 */
function enrichClassificationResults(aiResponse, originalLineItems) {
  try {
    const classifications = JSON.parse(aiResponse);
    
    return classifications.map((item, index) => {
      const categoryInfo = CLASSIFICATION_CATEGORIES[item.category];
      
      if (!categoryInfo) {
        console.warn(`Unknown category: ${item.category} for item: ${item.originalName}`);
        // Fallback to manual classification
        return {
          originalName: item.originalName,
          category: 'unknown',
          standardName: item.originalName,
          driver: 'manual',
          method: 'growth_rate',
          confidence: 0.1,
          categoryInfo: 'unknown'
        };
      }

      return {
        originalName: item.originalName,
        category: item.category,
        standardName: categoryInfo.standardName,
        driver: categoryInfo.driver,
        method: categoryInfo.method,
        confidence: item.confidence,
        categoryInfo: categoryInfo.category,
        suggested: true // Indicates this came from AI, not user override
      };
    });
  } catch (error) {
    console.error('Error parsing AI classification response:', error);
    console.error('Raw response:', aiResponse);
    
    // Fallback: return all items as unknown
    return originalLineItems.map(item => ({
      originalName: item,
      category: 'unknown',
      standardName: item,
      driver: 'manual',
      method: 'growth_rate',
      confidence: 0.1,
      categoryInfo: 'unknown',
      suggested: false
    }));
  }
}

/**
 * Main API endpoint
 */
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
    console.log('Balance sheet classification request received');
    console.log('Request body:', req.body);

    // Check if API key is available
    if (!OPENAI_API_KEY) {
      console.error('OpenAI API key not found in environment variables');
      return res.status(500).json({
        success: false,
        error: 'OpenAI API key not configured'
      });
    }

    const { lineItems } = req.body;

    if (!lineItems || !Array.isArray(lineItems) || lineItems.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'lineItems array is required and must not be empty'
      });
    }

    console.log('Classifying line items:', lineItems);

    // Create the classification prompt
    const prompt = createClassificationPrompt(lineItems);
    console.log('Generated prompt length:', prompt.length);

    // Call OpenAI API
    console.log('Making OpenAI API call for classification...');
    
    const openaiResponse = await axios.post(OPENAI_API_URL, {
      model: 'gpt-4', // Use GPT-4 for better accuracy
      messages: [
        {
          role: 'system',
          content: 'You are a financial statement analysis expert. You classify balance sheet line items with high precision. Always respond with valid JSON only.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: 2000,
      temperature: 0.1 // Low temperature for consistent results
    }, {
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('OpenAI API response received');
    const aiClassification = openaiResponse.data.choices[0].message.content;
    console.log('Raw AI response:', aiClassification);

    // Process and enrich the classification results
    const enrichedResults = enrichClassificationResults(aiClassification, lineItems);
    
    console.log('Classification completed successfully');
    console.log('Results:', enrichedResults);

    res.status(200).json({
      success: true,
      classifications: enrichedResults,
      metadata: {
        totalItems: lineItems.length,
        highConfidence: enrichedResults.filter(r => r.confidence >= 0.8).length,
        mediumConfidence: enrichedResults.filter(r => r.confidence >= 0.5 && r.confidence < 0.8).length,
        lowConfidence: enrichedResults.filter(r => r.confidence < 0.5).length
      }
    });

  } catch (error) {
    console.error('Balance sheet classification error:', error.response?.data || error.message);
    console.error('Full error:', error);
    
    res.status(500).json({
      success: false,
      error: 'Failed to classify balance sheet items',
      details: error.message
    });
  }
};