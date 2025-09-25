/**
 * Smart Balance Sheet Forecasting Engine
 * Generates balance sheet forecasts based on P&L drivers and historical relationships
 */

/**
 * Balance Sheet Line Item Configuration
 * Defines how each balance sheet item should be calculated
 */
const BALANCE_SHEET_DRIVERS = {
  // === ASSETS ===
  'cash': {
    type: 'calculated', // Calculated as plug to balance sheet or from cash flow
    category: 'current_assets',
    method: 'cash_flow_driven',
    description: 'Calculated from operating cash flow and financing activities'
  },
  'accounts_receivable': {
    type: 'revenue_driven',
    category: 'current_assets', 
    method: 'days_sales_outstanding',
    driver: 'revenue',
    defaultDays: 30,
    description: 'Driven by revenue and collection period (DSO)'
  },
  'inventory': {
    type: 'expense_driven',
    category: 'current_assets',
    method: 'days_inventory_outstanding', 
    driver: 'cost_of_goods_sold',
    defaultDays: 45,
    description: 'Driven by COGS and inventory turnover (DIO)'
  },
  'prepaid_expenses': {
    type: 'revenue_percentage',
    category: 'current_assets',
    method: 'percentage_of_revenue',
    driver: 'revenue',
    defaultPercentage: 1.0, // 1% of revenue
    description: 'Typically 1-2% of revenue'
  },
  'property_plant_equipment': {
    type: 'depreciation_driven',
    category: 'fixed_assets',
    method: 'capex_depreciation',
    depreciation: 'depreciation_expense',
    capexPercent: 3.0, // 3% of revenue for new capex
    description: 'Previous balance + CapEx - Depreciation'
  },
  'intangible_assets': {
    type: 'revenue_percentage',
    category: 'fixed_assets', 
    method: 'percentage_of_revenue',
    driver: 'revenue',
    defaultPercentage: 2.0,
    description: 'Technology/IP investments, typically 2-5% of revenue'
  },
  'investments': {
    type: 'manual_growth',
    category: 'other_assets',
    method: 'growth_rate',
    defaultGrowthRate: 5.0,
    description: 'Investment portfolio growth'
  },

  // === LIABILITIES ===
  'accounts_payable': {
    type: 'expense_driven',
    category: 'current_liabilities',
    method: 'days_payable_outstanding',
    driver: 'operating_expenses',
    defaultDays: 30,
    description: 'Driven by operating expenses and payment terms (DPO)'
  },
  'accrued_expenses': {
    type: 'expense_percentage',
    category: 'current_liabilities',
    method: 'percentage_of_expenses',
    driver: 'total_expenses',
    defaultPercentage: 5.0, // 5% of total expenses
    description: 'Accrued but unpaid expenses'
  },
  'short_term_debt': {
    type: 'manual_input',
    category: 'current_liabilities',
    method: 'user_defined',
    description: 'User defines debt schedule and repayments'
  },
  'deferred_revenue': {
    type: 'revenue_percentage',
    category: 'current_liabilities',
    method: 'percentage_of_revenue', 
    driver: 'revenue',
    defaultPercentage: 8.0, // 8% for SaaS/subscription businesses
    description: 'Advance payments from customers'
  },
  'long_term_debt': {
    type: 'manual_input',
    category: 'long_term_liabilities',
    method: 'user_defined',
    description: 'User defines debt schedule and terms'
  },
  'deferred_tax_liability': {
    type: 'tax_driven',
    category: 'long_term_liabilities',
    method: 'tax_calculation',
    driver: 'pre_tax_income',
    description: 'Based on book vs tax timing differences'
  },

  // === EQUITY ===
  'common_stock': {
    type: 'manual_input',
    category: 'equity',
    method: 'user_defined',
    description: 'Share issuances defined by user'
  },
  'retained_earnings': {
    type: 'net_income_driven',
    category: 'equity',
    method: 'accumulated_earnings',
    driver: 'net_income',
    description: 'Previous balance + Net Income - Dividends'
  },
  'additional_paid_in_capital': {
    type: 'manual_input',
    category: 'equity', 
    method: 'user_defined',
    description: 'Stock issuances above par value'
  }
};

/**
 * Balance Sheet Category Mappings
 * Helps organize and validate balance sheet structure
 */
const BALANCE_SHEET_CATEGORIES = {
  current_assets: ['cash', 'accounts_receivable', 'inventory', 'prepaid_expenses'],
  fixed_assets: ['property_plant_equipment', 'intangible_assets'],
  other_assets: ['investments', 'goodwill'],
  current_liabilities: ['accounts_payable', 'accrued_expenses', 'short_term_debt', 'deferred_revenue'],
  long_term_liabilities: ['long_term_debt', 'deferred_tax_liability'],
  equity: ['common_stock', 'retained_earnings', 'additional_paid_in_capital']
};

/**
 * Smart Balance Sheet Calculation Engine
 */
class BalanceSheetEngine {
  constructor(pnlData, historicalBalanceSheet, assumptions = {}) {
    this.pnlData = pnlData; // Forecasted P&L data
    this.historicalBS = historicalBalanceSheet; // Historical balance sheet actuals
    this.assumptions = this.buildDefaultAssumptions(assumptions);
    this.forecastedBS = {};
  }

  /**
   * Build default assumptions from historical data
   */
  buildDefaultAssumptions(userAssumptions = {}) {
    const defaults = {};
    
    // Calculate historical ratios for intelligent defaults
    Object.keys(BALANCE_SHEET_DRIVERS).forEach(lineItem => {
      const config = BALANCE_SHEET_DRIVERS[lineItem];
      const historicalValues = this.getHistoricalValues(lineItem);
      
      switch (config.type) {
        case 'revenue_driven':
        case 'expense_driven':
          defaults[lineItem] = this.calculateHistoricalDays(lineItem, config);
          break;
        case 'revenue_percentage':
        case 'expense_percentage':
          defaults[lineItem] = this.calculateHistoricalPercentage(lineItem, config);
          break;
        default:
          defaults[lineItem] = config.defaultPercentage || config.defaultDays || config.defaultGrowthRate || 0;
      }
    });

    return { ...defaults, ...userAssumptions };
  }

  /**
   * Calculate historical Days Sales Outstanding, Days Inventory Outstanding, etc.
   */
  calculateHistoricalDays(lineItem, config) {
    const bsValues = this.getHistoricalValues(lineItem);
    const driverValues = this.getPnLDriverValues(config.driver);
    
    if (!bsValues.length || !driverValues.length) {
      return config.defaultDays || 30;
    }

    // Calculate average days over historical period
    const days = [];
    const minLength = Math.min(bsValues.length, driverValues.length);
    
    for (let i = 0; i < minLength; i++) {
      if (driverValues[i] > 0) {
        // Days = (Balance Sheet Item / Driver) * 365
        const daysPeriod = (bsValues[i] / (driverValues[i] / 12)) * 365; // Assuming monthly data
        if (daysPeriod > 0 && daysPeriod < 365) { // Reasonable bounds
          days.push(daysPeriod);
        }
      }
    }

    return days.length > 0 ? days.reduce((a, b) => a + b) / days.length : config.defaultDays;
  }

  /**
   * Calculate historical percentage relationships
   */
  calculateHistoricalPercentage(lineItem, config) {
    const bsValues = this.getHistoricalValues(lineItem);
    const driverValues = this.getPnLDriverValues(config.driver);
    
    if (!bsValues.length || !driverValues.length) {
      return config.defaultPercentage || 5.0;
    }

    const percentages = [];
    const minLength = Math.min(bsValues.length, driverValues.length);
    
    for (let i = 0; i < minLength; i++) {
      if (driverValues[i] > 0) {
        const percentage = (bsValues[i] / driverValues[i]) * 100;
        if (percentage >= 0 && percentage <= 50) { // Reasonable bounds
          percentages.push(percentage);
        }
      }
    }

    return percentages.length > 0 ? percentages.reduce((a, b) => a + b) / percentages.length : config.defaultPercentage;
  }

  /**
   * Generate forecasted balance sheet
   */
  generateForecast(periods) {
    const forecast = {};
    
    // Initialize with historical starting point
    const lastHistoricalPeriod = this.getLastHistoricalPeriod();
    
    for (let period = 0; period < periods; period++) {
      forecast[period] = {};
      
      // Calculate each balance sheet line item
      Object.keys(BALANCE_SHEET_DRIVERS).forEach(lineItem => {
        forecast[period][lineItem] = this.calculateLineItem(lineItem, period, forecast, lastHistoricalPeriod);
      });
      
      // Ensure balance sheet balances
      forecast[period] = this.balanceSheet(forecast[period]);
    }

    return forecast;
  }

  /**
   * Calculate individual balance sheet line item
   */
  calculateLineItem(lineItem, period, forecast, lastHistorical) {
    const config = BALANCE_SHEET_DRIVERS[lineItem];
    const assumption = this.assumptions[lineItem];
    const pnlPeriodData = this.pnlData[period] || {};
    
    switch (config.type) {
      case 'revenue_driven':
        return this.calculateRevenueDriven(lineItem, config, assumption, pnlPeriodData);
        
      case 'expense_driven':
        return this.calculateExpenseDriven(lineItem, config, assumption, pnlPeriodData);
        
      case 'revenue_percentage':
        return this.calculateRevenuePercentage(lineItem, config, assumption, pnlPeriodData);
        
      case 'expense_percentage':
        return this.calculateExpensePercentage(lineItem, config, assumption, pnlPeriodData);
        
      case 'depreciation_driven':
        return this.calculateDepreciationDriven(lineItem, config, assumption, pnlPeriodData, period, forecast);
        
      case 'net_income_driven':
        return this.calculateNetIncomeDriven(lineItem, config, period, forecast, lastHistorical);
        
      case 'calculated':
        return this.calculateCash(period, forecast, lastHistorical);
        
      case 'manual_growth':
        return this.calculateManualGrowth(lineItem, config, assumption, period, lastHistorical);
        
      case 'manual_input':
      default:
        return this.getManualInput(lineItem, period) || this.getLastValue(lineItem, period, lastHistorical);
    }
  }

  /**
   * Revenue-driven calculations (e.g., Accounts Receivable)
   */
  calculateRevenueDriven(lineItem, config, assumption, pnlData) {
    const revenue = this.findPnLValue(pnlData, 'revenue') || 0;
    const days = assumption || config.defaultDays;
    
    // Balance = (Revenue / 365) * Days
    return (revenue / 365) * days;
  }

  /**
   * Expense-driven calculations (e.g., Accounts Payable, Inventory)
   */
  calculateExpenseDriven(lineItem, config, assumption, pnlData) {
    const driverValue = this.findPnLValue(pnlData, config.driver) || 0;
    const days = assumption || config.defaultDays;
    
    // Balance = (Driver / 365) * Days
    return (driverValue / 365) * days;
  }

  /**
   * Revenue percentage calculations (e.g., Prepaid Expenses)
   */
  calculateRevenuePercentage(lineItem, config, assumption, pnlData) {
    const revenue = this.findPnLValue(pnlData, 'revenue') || 0;
    const percentage = assumption || config.defaultPercentage;
    
    return revenue * (percentage / 100);
  }

  /**
   * Expense percentage calculations (e.g., Accrued Expenses)
   */
  calculateExpensePercentage(lineItem, config, assumption, pnlData) {
    const totalExpenses = this.findPnLValue(pnlData, 'total_expenses') || 
                          this.findPnLValue(pnlData, 'operating_expenses') || 0;
    const percentage = assumption || config.defaultPercentage;
    
    return totalExpenses * (percentage / 100);
  }

  /**
   * Depreciation-driven calculations (e.g., PPE)
   */
  calculateDepreciationDriven(lineItem, config, assumption, pnlData, period, forecast) {
    const previousValue = period === 0 ? 
      this.getLastHistoricalValue(lineItem) : 
      forecast[period - 1][lineItem];
    
    const revenue = this.findPnLValue(pnlData, 'revenue') || 0;
    const capex = revenue * ((assumption || config.capexPercent) / 100);
    const depreciation = this.findPnLValue(pnlData, 'depreciation') || (previousValue * 0.1); // 10% default
    
    return Math.max(0, previousValue + capex - depreciation);
  }

  /**
   * Net income driven calculations (e.g., Retained Earnings)
   */
  calculateNetIncomeDriven(lineItem, config, period, forecast, lastHistorical) {
    const previousValue = period === 0 ? 
      this.getLastHistoricalValue(lineItem) : 
      forecast[period - 1][lineItem];
    
    const netIncome = this.findPnLValue(this.pnlData[period], 'net_income') || 0;
    const dividends = this.assumptions.dividends || 0;
    
    return previousValue + netIncome - dividends;
  }

  /**
   * Cash calculation (balancing item)
   */
  calculateCash(period, forecast, lastHistorical) {
    // For now, use a simple model. In full implementation, would use cash flow statement
    const previousCash = period === 0 ? 
      this.getLastHistoricalValue('cash') : 
      forecast[period - 1]['cash'];
    
    const netIncome = this.findPnLValue(this.pnlData[period], 'net_income') || 0;
    const workingCapitalChange = this.calculateWorkingCapitalChange(period, forecast);
    
    return previousCash + netIncome - workingCapitalChange;
  }

  /**
   * Manual growth calculations
   */
  calculateManualGrowth(lineItem, config, assumption, period, lastHistorical) {
    const previousValue = period === 0 ? 
      this.getLastHistoricalValue(lineItem) : 
      this.getLastCalculatedValue(lineItem, period);
    
    const growthRate = (assumption || config.defaultGrowthRate) / 100;
    return previousValue * (1 + growthRate / 12); // Monthly growth
  }

  /**
   * Balance the balance sheet by adjusting cash
   */
  balanceSheet(periodData) {
    const totalAssets = this.sumCategory(periodData, ['current_assets', 'fixed_assets', 'other_assets']);
    const totalLiabilities = this.sumCategory(periodData, ['current_liabilities', 'long_term_liabilities']);
    const totalEquity = this.sumCategory(periodData, ['equity']);
    
    const imbalance = totalAssets - (totalLiabilities + totalEquity);
    
    // Adjust cash to balance
    if (imbalance !== 0) {
      periodData['cash'] = (periodData['cash'] || 0) - imbalance;
    }
    
    return periodData;
  }

  /**
   * Helper Methods
   */
  getHistoricalValues(lineItem) {
    return this.historicalBS[lineItem] || [];
  }

  getPnLDriverValues(driver) {
    // Look for driver in P&L data
    return this.pnlData.map(period => this.findPnLValue(period, driver)).filter(v => v !== null);
  }

  findPnLValue(pnlPeriod, searchTerm) {
    if (!pnlPeriod || typeof pnlPeriod !== 'object') return null;
    
    // Try exact match first
    if (pnlPeriod[searchTerm]) return pnlPeriod[searchTerm];
    
    // Try fuzzy matching
    const keys = Object.keys(pnlPeriod);
    const match = keys.find(key => 
      key.toLowerCase().includes(searchTerm.toLowerCase()) ||
      searchTerm.toLowerCase().includes(key.toLowerCase())
    );
    
    return match ? pnlPeriod[match] : null;
  }

  getLastHistoricalValue(lineItem) {
    const values = this.getHistoricalValues(lineItem);
    return values.length > 0 ? values[values.length - 1] : 0;
  }

  sumCategory(periodData, categories) {
    let sum = 0;
    categories.forEach(category => {
      BALANCE_SHEET_CATEGORIES[category].forEach(lineItem => {
        sum += periodData[lineItem] || 0;
      });
    });
    return sum;
  }

  calculateWorkingCapitalChange(period, forecast) {
    // Simplified working capital change calculation
    if (period === 0) return 0;
    
    const currentWC = (forecast[period]['accounts_receivable'] || 0) + 
                      (forecast[period]['inventory'] || 0) - 
                      (forecast[period]['accounts_payable'] || 0);
    
    const previousWC = (forecast[period - 1]['accounts_receivable'] || 0) + 
                       (forecast[period - 1]['inventory'] || 0) - 
                       (forecast[period - 1]['accounts_payable'] || 0);
    
    return currentWC - previousWC;
  }

  getLastHistoricalPeriod() {
    // Get the last period from historical data
    const lastPeriod = {};
    Object.keys(BALANCE_SHEET_DRIVERS).forEach(lineItem => {
      lastPeriod[lineItem] = this.getLastHistoricalValue(lineItem);
    });
    return lastPeriod;
  }

  getManualInput(lineItem, period) {
    // Hook for user-defined inputs (debt schedules, equity transactions, etc.)
    return this.assumptions[`${lineItem}_schedule`] ? 
           this.assumptions[`${lineItem}_schedule`][period] : null;
  }

  getLastValue(lineItem, period, lastHistorical) {
    return period === 0 ? lastHistorical[lineItem] : 0;
  }

  getLastCalculatedValue(lineItem, period) {
    // For multi-period calculations
    return this.forecastedBS[period - 1] ? this.forecastedBS[period - 1][lineItem] : 0;
  }
}

/**
 * Export the engine and configuration
 */
export { BalanceSheetEngine, BALANCE_SHEET_DRIVERS, BALANCE_SHEET_CATEGORIES };