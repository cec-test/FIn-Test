'use strict';

/**
 * App state: base actuals used for forecasts.
 * Replace via CSV upload to drive forecasts from your own numbers.
 */
let sampleData = {};
let uploadedLineItems = {
  pnl: [],
  balance: [],
  cashflow: []
};
let hasUploadedData = false;
let dateColumns = [];
let forecastCache = { pnl: {}, balance: {}, cashflow: {} };

// Subheader overrides (manual toggles)
const SUBHEADER_OVERRIDES_KEY = 'subheader_overrides_v1';
function loadSubheaderOverrides() {
  try {
    const raw = localStorage.getItem(SUBHEADER_OVERRIDES_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (_) {
    return {};
  }
}
function saveSubheaderOverrides(map) {
  try { localStorage.setItem(SUBHEADER_OVERRIDES_KEY, JSON.stringify(map)); } catch (_) {}
}
function overrideKey(statementKey, name) {
  return `${statementKey}::${(name || '').toLowerCase()}`;
}
function isSubheaderOverridden(statementKey, name) {
  const map = loadSubheaderOverrides();
  return !!map[overrideKey(statementKey, name)];
}
function setSubheaderOverride(statementKey, name, value) {
  const map = loadSubheaderOverrides();
  const key = overrideKey(statementKey, name);
  if (value) map[key] = true; else delete map[key];
  saveSubheaderOverrides(map);
}

/**
 * Date parsing and aggregation helpers
 */
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function parseHeaderToYearMonth(header) {
  if (!header) return null;
  const trimmed = String(header).trim();
  // Try MMM YYYY
  const mmm = MONTHS_SHORT.findIndex(m => new RegExp(`^${m}\\s+\\d{4}$`, 'i').test(trimmed));
  if (mmm >= 0) {
    const year = Number(trimmed.replace(/[^0-9]/g, '').slice(-4));
    return { year, month: mmm };
  }
  // Try YYYY-MM or YYYY/MM
  let match = trimmed.match(/^(\d{4})[-\/](\d{1,2})$/);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    return { year, month };
  }
  // Try MM/DD/YYYY or M/D/YYYY
  match = trimmed.match(/^(\d{1,2})[\/](\d{1,2})[\/](\d{4})$/);
  if (match) {
    const month = Number(match[1]) - 1;
    const year = Number(match[3]);
    return { year, month };
  }
  // Fallback: Date.parse
  const d = new Date(trimmed);
  if (!isNaN(d.getTime())) {
    return { year: d.getFullYear(), month: d.getMonth() };
  }
  return null;
}

function buildParsedDateColumns() {
  return (dateColumns || []).map(h => ({ header: h, ym: parseHeaderToYearMonth(h) })).filter(x => !!x.ym);
}

function aggregateActuals(statementKey, actualValues) {
  const parsed = buildParsedDateColumns();
  const byQuarter = new Map();
  const byYear = new Map();

  parsed.forEach((d, idx) => {
    const { year, month } = d.ym;
    const q = Math.floor(month / 3) + 1; // 1..4
    const qKey = `${year}-Q${q}`;
    const yKey = `${year}`;
    const value = Number(actualValues[idx] ?? 0);
    // Quarterly aggregate
    if (!byQuarter.has(qKey)) byQuarter.set(qKey, { year, q, months: [], values: [] });
    const qEntry = byQuarter.get(qKey);
    qEntry.months.push(month);
    qEntry.values.push(value);
    // Yearly aggregate
    if (!byYear.has(yKey)) byYear.set(yKey, { year, months: [], values: [] });
    const yEntry = byYear.get(yKey);
    yEntry.months.push(month);
    yEntry.values.push(value);
  });

  // Build outputs
  const toQuarterOutputs = () => {
    const labels = [];
    const values = [];
    const notes = [];
    Array.from(byQuarter.values()).sort((a,b) => a.year - b.year || a.q - b.q).forEach(entry => {
      const monthsInQ = entry.months.length;
      const endMonth = (entry.q * 3) - 1; // 2,5,8,11
      const label = `${MONTHS_SHORT[endMonth]} ${entry.year}`;
      labels.push(label);
      
      let val;
      if (statementKey === 'balance') {
        // Balance sheet: take last available month in quarter
        const lastIdx = entry.months.reduce((acc, m, idx) => (m > entry.months[acc] ? idx : acc), 0);
        val = entry.values[lastIdx] ?? 0;
      } else {
        // P&L, Cashflow: sum
        val = entry.values.reduce((s, v) => s + (Number(v) || 0), 0);
      }
      values.push(val);
      
      let note = '';
      if (monthsInQ < 3) {
        note = `Partial actuals (${monthsInQ}/3 months)`;
      }
      notes.push(note);
    });
    return { labels, values, notes };
  };

  const toYearOutputs = () => {
    const labels = [];
    const values = [];
    const notes = [];
    Array.from(byYear.values()).sort((a,b) => a.year - b.year).forEach(entry => {
      const monthsInY = entry.months.length;
      const label = `Dec ${entry.year}`;
      labels.push(label);
      
      let val;
      if (statementKey === 'balance') {
        // take last available month in year
        const lastIdx = entry.months.reduce((acc, m, idx) => (m > entry.months[acc] ? idx : acc), 0);
        val = entry.values[lastIdx] ?? 0;
      } else {
        // sum all months
        val = entry.values.reduce((s, v) => s + (Number(v) || 0), 0);
      }
      values.push(val);
      
      let note = '';
      if (monthsInY < 12) {
        note = `Partial actuals (${monthsInY}/12 months)`;
      }
      notes.push(note);
    });
    return { labels, values, notes };
  };

  return { toQuarterOutputs, toYearOutputs };
}

/**
 * Default data + helpers
 */
function initializeDefaultDateColumns(monthCount = 6) {
  const result = [];
  const now = new Date();
  for (let i = monthCount - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setMonth(d.getMonth() - i);
    result.push(d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }));
  }
  return result;
}

function buildDefaultSampleData() {
  const defaults = {
    pnl: [
      { name: 'Revenue', actualValues: [120000, 130000, 135000, 150000, 155000, 165000] },
      { name: 'Cost of Goods Sold Expense', actualValues: [60000, 64000, 65000, 72000, 73000, 78000] },
      { name: 'Operating Expenses', actualValues: [30000, 31000, 32000, 34000, 35000, 36000] },
      { name: 'Other Income', actualValues: [2000, 2500, 2100, 2300, 2400, 2600] }
    ],
    balance: [
      { name: 'Cash', actualValues: [80000, 82000, 90000, 95000, 98000, 105000] },
      { name: 'Accounts Receivable', actualValues: [15000, 16000, 17000, 20000, 21000, 23000] },
      { name: 'Inventory', actualValues: [10000, 10500, 11000, 11500, 12000, 12500] },
      { name: 'Accounts Payable', actualValues: [12000, 13000, 14000, 15000, 16000, 17000] }
    ],
    cashflow: [
      { name: 'Operating Cash Flow', actualValues: [15000, 16000, 17500, 18000, 19000, 21000] },
      { name: 'Investing Cash Flow', actualValues: [-5000, -2000, -3000, -2500, -4000, -3500] },
      { name: 'Financing Cash Flow', actualValues: [0, 0, 5000, 0, 0, 0] }
    ]
  };

  ['pnl', 'balance', 'cashflow'].forEach(key => {
    defaults[key] = defaults[key].map(item => ({
      ...item,
      actual: item.actualValues[item.actualValues.length - 1],
      statement: key
    }));
  });

  return defaults;
}

/**
 * Formatting
 */
const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0
});

function formatCurrency(amount, isPlaceholder = false) {
  const formatted = currencyFormatter.format(Math.round(amount));
  return isPlaceholder ? formatted + ' *' : formatted;
}

/**
 * Tabs
 */
function showTab(tabName, clickedBtn) {
  const contents = document.querySelectorAll('.tab-content');
  contents.forEach(content => content.classList.remove('active'));

  const tabs = document.querySelectorAll('.tab');
  tabs.forEach(tab => tab.classList.remove('active'));

  const selectedContent = document.getElementById(tabName);
  if (selectedContent) selectedContent.classList.add('active');

  if (clickedBtn) clickedBtn.classList.add('active');
}

/**
 * Control growth rate input based on method selection
 */
function toggleGrowthRateInput() {
  const method = document.getElementById('forecastMethod')?.value;
  const growthRateInput = document.getElementById('customGrowthRate');
  const scurveControls = document.getElementById('scurve-controls');

  if (growthRateInput) {
    if (method === 'custom' || method === 'exponential' || method === 'logarithmic' || method === 'rolling' || method === 'scurve') {
      growthRateInput.disabled = false;  // Enable for all user-controlled methods
    } else {
      growthRateInput.disabled = true;   // Disable for any remaining automatic methods
    }
  }

  // Show/hide S-curve specific controls
  if (scurveControls) {
    if (method === 'scurve') {
      scurveControls.style.display = 'block';
      calculateSCurveDefaults(); // Calculate smart defaults when shown
    } else {
      scurveControls.style.display = 'none';
    }
  }
}

/**
 * Get seasonal multiplier for a given month and pattern, adjusted for time period
 */
function getSeasonalMultiplier(month, pattern, strength, periodType = 'monthly') {
  if (pattern === 'none') return 1.0;
  
  const strengthFactor = strength / 100;
  
  // Define seasonal patterns (base multipliers)
  const patterns = {
    retail: [0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.2, 1.1, 1.0, 1.2, 1.4, 1.8], // Q4 peak
    saas: [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0], // Steady
    construction: [0.5, 0.6, 0.8, 1.0, 1.2, 1.4, 1.3, 1.2, 1.0, 0.8, 0.6, 0.5], // Summer peak
    custom: [
      parseFloat(document.getElementById('jan-mult')?.value) || 0.8,
      parseFloat(document.getElementById('feb-mult')?.value) || 0.9,
      parseFloat(document.getElementById('mar-mult')?.value) || 1.0,
      parseFloat(document.getElementById('apr-mult')?.value) || 1.1,
      parseFloat(document.getElementById('may-mult')?.value) || 1.2,
      parseFloat(document.getElementById('jun-mult')?.value) || 1.3,
      parseFloat(document.getElementById('jul-mult')?.value) || 1.2,
      parseFloat(document.getElementById('aug-mult')?.value) || 1.1,
      parseFloat(document.getElementById('sep-mult')?.value) || 1.0,
      parseFloat(document.getElementById('oct-mult')?.value) || 0.9,
      parseFloat(document.getElementById('nov-mult')?.value) || 1.1,
      parseFloat(document.getElementById('dec-mult')?.value) || 1.5
    ]
  };
  
  const baseMultiplier = patterns[pattern] ? patterns[pattern][month] : 1.0;
  
  // Apply period-specific seasonality reduction
  let periodMultiplier = 1.0;
  if (periodType === 'monthly') {
    periodMultiplier = 1.0; // Full seasonality for monthly
  } else if (periodType === 'quarterly') {
    periodMultiplier = 0.5; // Reduced seasonality for quarterly (averages out over 3 months)
  } else if (periodType === 'yearly') {
    periodMultiplier = 0.0; // No seasonality for annual (averages out over 12 months)
  }
  
  // Apply strength factor and period multiplier
  const seasonalEffect = (baseMultiplier - 1.0) * strengthFactor * periodMultiplier;
  return 1.0 + seasonalEffect;
}

/**
 * Calculate smart defaults for S-curve parameters
 */
function calculateSCurveDefaults() {
  const growthRate = parseFloat(document.getElementById('customGrowthRate')?.value) || 5;
  const periods = parseInt(document.getElementById('forecastPeriods')?.value) || 12;
  
  // Calculate Max Value: Last Actual × (1 + Growth Rate)^Total Periods
  const annualRate = growthRate / 100;
  const maxValueMultiplier = Math.pow(1 + annualRate, periods);
  
  // Get last actual value (we'll use a reasonable default if not available)
  const lastActual = 100000; // Default for calculation
  const calculatedMaxValue = lastActual * maxValueMultiplier;
  
  // Calculate Midpoint: Total Forecast Periods × 0.4
  const calculatedMidpoint = Math.round(periods * 0.4);
  
  // Set the default values
  const maxValueInput = document.getElementById('scurveMaxValue');
  const midpointInput = document.getElementById('scurveMidpoint');
  
  if (maxValueInput && !maxValueInput.value) {
    maxValueInput.value = Math.round(calculatedMaxValue);
  }
  
  if (midpointInput && !midpointInput.value) {
    midpointInput.value = calculatedMidpoint;
  }
}

/**
 * Check if a period index represents a mixed period (actuals + forecasts)
 */
function generateMixedPeriodTooltip(index, periodType, actualLabels) {
  const forecastMethod = document.getElementById('forecastMethod')?.value || 'custom';
  const growthRate = parseFloat(document.getElementById('customGrowthRate')?.value) || 5;
  
  let tooltip = '';
  
  if (periodType === 'quarterly') {
    const quarterMonths = getQuarterMonths(index, actualLabels);
    const actualMonths = quarterMonths.filter(month => actualLabels.includes(month));
    const forecastMonths = quarterMonths.filter(month => !actualLabels.includes(month));
    
    tooltip = `MIXED PERIOD BREAKDOWN:\n`;
    tooltip += `Actual Months: ${actualMonths.join(', ')}\n`;
    tooltip += `Forecast Months: ${forecastMonths.join(', ')}\n`;
    tooltip += `\nCALCULATION METHOD:\n`;
    tooltip += `Method: ${getMethodDisplayName(forecastMethod)}\n`;
    if (forecastMethod === 'custom') {
      tooltip += `Growth Rate: ${growthRate}%\n`;
    }
    tooltip += `\nNOTE: This hybrid total is used as the baseline for subsequent forecasts.`;
  }
  
  if (periodType === 'yearly') {
    const yearMonths = getYearMonths(index, actualLabels);
    const actualMonths = yearMonths.filter(month => actualLabels.includes(month));
    const forecastMonths = yearMonths.filter(month => !actualLabels.includes(month));
    
    tooltip = `MIXED PERIOD BREAKDOWN:\n`;
    tooltip += `Actual Months: ${actualMonths.join(', ')}\n`;
    tooltip += `Forecast Months: ${forecastMonths.join(', ')}\n`;
    tooltip += `\nCALCULATION METHOD:\n`;
    tooltip += `Method: ${getMethodDisplayName(forecastMethod)}\n`;
    if (forecastMethod === 'custom') {
      tooltip += `Growth Rate: ${growthRate}%\n`;
    }
    tooltip += `\nNOTE: This hybrid total is used as the baseline for subsequent forecasts.`;
  }
  
  return tooltip;
}

function getMethodDisplayName(method) {
  switch (method) {
    case 'custom': return 'Linear Growth';
    case 'exponential': return 'Exponential Growth';
    case 'logarithmic': return 'Logarithmic Growth';
    case 'scurve': return 'S-Curve Growth';
    case 'rolling': return 'Rolling Average';
    default: return 'Linear Growth';
  }
}

function getQuarterMonths(quarterIndex, actualLabels) {
  const months = [];
  const startMonth = quarterIndex * 3;
  
  for (let i = 0; i < 3; i++) {
    const monthIndex = startMonth + i;
    if (monthIndex < actualLabels.length) {
      months.push(actualLabels[monthIndex]);
    }
  }
  
  return months;
}

function getYearMonths(yearIndex, actualLabels) {
  const months = [];
  const startMonth = yearIndex * 12;
  
  for (let i = 0; i < 12; i++) {
    const monthIndex = startMonth + i;
    if (monthIndex < actualLabels.length) {
      months.push(actualLabels[monthIndex]);
    }
  }
  
  return months;
}

/**
 * Get display name for forecast method
 */
function getMethodDisplayName(method) {
  switch (method) {
    case 'custom': return 'Linear Growth';
    case 'exponential': return 'Exponential Growth';
    case 'logarithmic': return 'Logarithmic Growth';
    case 'scurve': return 'S-Curve Growth';
    case 'rolling': return 'Rolling Average';
    default: return 'Linear Growth';
  }
}

/**
 * Get the months for a specific quarter index
 */
function getQuarterMonths(quarterIndex, actualLabels) {
  const months = [];
  const startMonth = quarterIndex * 3;
  
  for (let i = 0; i < 3; i++) {
    const monthIndex = startMonth + i;
    if (monthIndex < actualLabels.length) {
      months.push(actualLabels[monthIndex]);
    }
  }
  
  return months;
}

/**
 * Get the months for a specific year index
 */
function getYearMonths(yearIndex, actualLabels) {
  const months = [];
  const startMonth = yearIndex * 12;
  
  for (let i = 0; i < 12; i++) {
    const monthIndex = startMonth + i;
    if (monthIndex < actualLabels.length) {
      months.push(actualLabels[monthIndex]);
    }
  }
  
  return months;
}

/**
 * Get forecast values for an item based on current forecast settings
 */
function getForecastValuesForItem(item, periods) {
  const actualValues = item.actualValues || [];
  const forecastMethod = document.getElementById('forecastMethod')?.value || 'custom';
  const growthRate = parseFloat(document.getElementById('customGrowthRate')?.value) || 5;
  
  const forecastValues = [];
  
  // Calculate growth rates based on method
  let revGrowth, expGrowth;
  
  // Convert annual growth rate to period-specific rates for all methods
  const annualRate = growthRate / 100;
  const annualExpRate = (growthRate * 0.8) / 100;
  
  // For monthly calculations, convert annual to monthly
  revGrowth = annualRate / 12;  // Monthly rate
  expGrowth = annualExpRate / 12;  // Monthly rate
  
  // Determine if this is revenue or expense item
  const isRevenueItem = /\b(revenue|sales|income)\b/i.test(item.name);
  const growthRateToUse = isRevenueItem ? revGrowth : expGrowth;
  
  const lastActual = actualValues[actualValues.length - 1] || 0;
  
  // Get seasonality settings
  const seasonalPattern = document.getElementById('seasonalPattern')?.value || 'none';
  const seasonalStrength = parseFloat(document.getElementById('seasonalStrength')?.value) || 50;
  
  for (let i = 0; i < periods; i++) {
    let baseForecastValue;
    
    if (forecastMethod === 'exponential') {
      // Exponential growth: Value = Previous × (1 + Monthly Rate)^periods
      baseForecastValue = lastActual * Math.pow(1 + growthRateToUse, i + 1);
    } else if (forecastMethod === 'logarithmic') {
      // Logarithmic growth: Value = Base × ln(periods + 1) × Monthly Rate
      baseForecastValue = lastActual * Math.log(i + 2) * growthRateToUse;
    } else if (forecastMethod === 'scurve') {
      // S-curve growth: Only apply to "Total Revenue" items
      const isTotalRevenue = /\btotal.*revenue\b/i.test(item.name);
      if (isTotalRevenue) {
        // S-curve growth: Value = Max × (1 / (1 + e^(-k × (periods - midpoint))))
        const maxValue = parseFloat(document.getElementById('scurveMaxValue')?.value) || (lastActual * Math.pow(1 + growthRateToUse * 12, periods));
        const midpoint = parseFloat(document.getElementById('scurveMidpoint')?.value) || Math.round(periods * 0.4);
        const k = growthRateToUse * 2; // Growth constant derived from growth rate
        const exponent = -k * ((i + 1) - midpoint);
        baseForecastValue = maxValue * (1 / (1 + Math.exp(exponent)));
      } else {
        // For non-total revenue items, use linear growth
        baseForecastValue = lastActual + (lastActual * growthRateToUse * (i + 1));
      }
    } else if (forecastMethod === 'rolling') {
      // Rolling average + growth: Historical Average + (Historical Average × Monthly Rate × Period)
      const historicalAverage = actualValues.reduce((sum, val) => sum + val, 0) / actualValues.length;
      baseForecastValue = historicalAverage + (historicalAverage * growthRateToUse * (i + 1));
    } else if (forecastMethod === 'custom') {
      // Linear growth: Value = Previous + (Previous × Monthly Rate × Period)
      baseForecastValue = lastActual + (lastActual * growthRateToUse * (i + 1));
    } else {
      // Fallback to exponential
      baseForecastValue = lastActual * Math.pow(1 + growthRateToUse, i + 1);
    }
    
    // Apply seasonality
    const forecastMonth = (i + 1) % 12; // Month index (0-11)
    const seasonalMultiplier = getSeasonalMultiplier(forecastMonth, seasonalPattern, seasonalStrength, 'monthly');
    const forecastValue = baseForecastValue * seasonalMultiplier;
    
    forecastValues.push(forecastValue);
  }
  
  return forecastValues;
}

/**
 * Generate dynamic table headers based on periods
 */
function generateForecastHeaders(periods, periodType, forecastStartFrom) {
  const headers = [];
  const startDate = new Date(forecastStartFrom);
  
  if (periodType === 'quarterly') {
    // forecast headers as quarter-end months
    let d = new Date(startDate);
    for (let i = 0; i < periods; i++) {
      const month = d.getMonth();
      const qEndMonth = month + (2 - (month % 3)); // move to end of this quarter
      const qEnd = new Date(d.getFullYear(), qEndMonth, 1);
      headers.push(`${MONTHS_SHORT[qEnd.getMonth()]} ${qEnd.getFullYear()}`);
      d = new Date(qEnd.getFullYear(), qEnd.getMonth() + 1, 1);
    }
  } else if (periodType === 'yearly') {
    let y = startDate.getFullYear();
    for (let i = 0; i < periods; i++) {
      headers.push(`Dec ${y + i}`);
    }
  }
  
  return headers;
}

function generateTableHeaders(periods, periodType, actualLabels, forecastStartFrom) {
  const headers = ['Item'];
  // Add actual labels
  (actualLabels || []).forEach(l => headers.push(l));
  // Forecast labels starting after last actual
  const start = forecastStartFrom || new Date();
  const startDate = new Date(start);
  if (periodType === 'monthly') {
    for (let i = 0; i < periods; i++) {
      const d = new Date(startDate);
      d.setMonth(d.getMonth() + i);
      headers.push(d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }));
    }
  } else if (periodType === 'quarterly') {
    // forecast headers as quarter-end months
    let d = new Date(startDate);
    for (let i = 0; i < periods; i++) {
      const month = d.getMonth();
      const qEndMonth = month + (2 - (month % 3)); // move to end of this quarter
      const qEnd = new Date(d.getFullYear(), qEndMonth, 1);
      headers.push(`${MONTHS_SHORT[qEnd.getMonth()]} ${qEnd.getFullYear()}`);
      d = new Date(qEnd.getFullYear(), qEnd.getMonth() + 1, 1);
    }
  } else if (periodType === 'yearly') {
    let y = startDate.getFullYear();
    for (let i = 0; i < periods; i++) {
      headers.push(`Dec ${y + i}`);
    }
  }
  return headers;
}

/**
 * Create dynamic table structure
 * statementKey must be one of: 'pnl' | 'balance' | 'cashflow'
 * scope must be one of: 'combined' | 'monthly' | 'quarterly' | 'yearly'
 */
function createDynamicTable(containerId, statementKey, periodType, scope) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const periods = parseInt(document.getElementById('forecastPeriods')?.value) || 12;
  // Build actuals aggregation
  let actualLabels = [];
  let noteByIndex = [];
  // Determine actual values template from first item
  const sampleItems = uploadedLineItems[statementKey] || [];
  const firstItem = sampleItems[0];
  let aggregatedPerItem = new Map();
  if (periodType === 'monthly') {
    actualLabels = (dateColumns || []).slice();
    noteByIndex = new Array(actualLabels.length).fill('');
    sampleItems.forEach(item => {
      aggregatedPerItem.set(item.name, { actuals: (item.actualValues || []).slice(), notes: noteByIndex });
    });
  } else if (periodType === 'quarterly' || periodType === 'yearly') {
    sampleItems.forEach(item => {
      const agg = aggregateActuals(statementKey, item.actualValues || []);
      const out = periodType === 'quarterly' ? agg.toQuarterOutputs() : agg.toYearOutputs();
      aggregatedPerItem.set(item.name, { actuals: out.values, notes: out.notes, labels: out.labels });
    });
    // Use labels/notes from first item if present, else compute from dateColumns
    if (firstItem && aggregatedPerItem.get(firstItem.name)) {
      const ref = aggregatedPerItem.get(firstItem.name);
      actualLabels = ref.labels || [];
      noteByIndex = ref.notes || [];
    }
  }

  // Forecast start date is after the last actual label
  let forecastStartFrom = new Date();
  const parsedActuals = buildParsedDateColumns();
  if (parsedActuals.length > 0) {
    const last = parsedActuals[parsedActuals.length - 1].ym;
    forecastStartFrom = new Date(last.year, last.month + 1, 1);
  }
  
  // For quarterly/yearly, don't add forecast headers here - they're handled by aggregation
  let headers;
  if (periodType === 'quarterly' || periodType === 'yearly') {
    headers = ['Item', ...actualLabels];
  } else {
    headers = generateTableHeaders(periods, periodType, actualLabels, forecastStartFrom);
  }

  const statementHeaderLabel =
    statementKey === 'pnl' ? 'P&L' :
    statementKey === 'balance' ? 'Balance Sheet' :
    'Cash Flow';

  const tableId = `${scope}${statementKey}table`;

  let tableHTML = `
    <div class="statement-section">
      <div class="statement-header">${statementHeaderLabel}</div>
      <div class="table-container">
        <div class="table-wrapper">
          <table id="${tableId}">
            <thead>
              <tr>
  `;

  headers.forEach((header, index) => {
    let className = '';
    if (index === 0) {
      className = '';
    } else if (index <= actualLabels.length) {
      className = 'actual';
    } else {
      className = 'forecast';
    }
    let noteHtml = '';
    if (className === 'actual' && noteByIndex[index - 1]) {
      const note = noteByIndex[index - 1];
      if (note.includes('Partial actuals')) {
        noteHtml = ` <span class="note-badge" title="${note}">•</span>`;
      }
    }
    tableHTML += `<th class="${className}">${header}${noteHtml}</th>`;
  });
  
  // Add forecast headers for quarterly/yearly tabs
  if (periodType === 'quarterly' || periodType === 'yearly') {
    // Calculate forecast start date based on the last aggregated period
    let forecastStartFromAggregated = new Date();
    if (actualLabels.length > 0) {
      const lastActualLabel = actualLabels[actualLabels.length - 1];
      // Parse the last actual label to get the date
      const lastDate = parseHeaderToYearMonth(lastActualLabel);
      if (lastDate) {
        if (periodType === 'quarterly') {
          // Start forecast from the next quarter
          const nextQuarterMonth = lastDate.month + 3;
          const nextQuarterYear = lastDate.year + Math.floor(nextQuarterMonth / 12);
          forecastStartFromAggregated = new Date(nextQuarterYear, nextQuarterMonth % 12, 1);
        } else if (periodType === 'yearly') {
          // Start forecast from the next year
          forecastStartFromAggregated = new Date(lastDate.year + 1, 0, 1);
        }
      }
    }
    
    const forecastHeaders = generateForecastHeaders(periods, periodType, forecastStartFromAggregated);
    forecastHeaders.forEach(header => {
      tableHTML += `<th class="forecast">${header}</th>`;
    });
  }

  tableHTML += `
            </tr>
          </thead>
          <tbody>
  `;

  // Add rows for each line item
  const lineItems = uploadedLineItems[statementKey] || [];
  lineItems.forEach((item) => {
    const isTotal = /\btotal\b/i.test(item.name);
    const heuristicSubheader = (!item.actualValues || item.actualValues.length === 0) && !isTotal;
    const manualSubheader = isSubheaderOverridden(statementKey, item.name);
    const isSubheader = manualSubheader || heuristicSubheader;
    const rowClass = isTotal ? 'total-row' : '';
    const nameCellClass = 'metric-name';
    tableHTML += `
      <tr class="${rowClass}">
        <td class="${nameCellClass}">
          ${item.name}
          <label style="margin-left:8px; font-weight:400; font-size:0.8rem; color:#6c757d;">
            <input type="checkbox" class="toggle-subheader" data-statement="${statementKey}" data-name="${item.name.replace(/"/g, '&quot;')}" ${isSubheader ? 'checked' : ''} /> Subheader
          </label>
        </td>
    `;

    // Add historical actual values (aggregated per period type)
    let actualsForItem = [];
    if (periodType === 'monthly') {
      actualsForItem = (item.actualValues || []).slice();
    } else {
      const agg = aggregatedPerItem.get(item.name);
      actualsForItem = agg ? (agg.actuals || []) : [];
    }
            actualsForItem.forEach((value, index) => {
              const display = isSubheader ? '' : formatCurrency(value);
              const tooltip = '';
              
              // For quarterly/yearly, all aggregated columns are actuals
              let columnClass = 'number actual';
              
              tableHTML += `<td class="${columnClass}" title="${tooltip}">${display}</td>`;
            });

    // Add forecast columns
    const forecastPeriods = periods;
    const safeName = item.name.toLowerCase().replace(/\s+/g, '');
    for (let i = 0; i < forecastPeriods; i++) {
      const forecastKey = `${periodType}-${statementKey}-${safeName}-${i}`;
      const scopedId = `${scope}-${forecastKey}`;
      const defaultVal = isSubheader ? '' : '$0';
      tableHTML += `<td class="number forecast" id="${scopedId}" data-forecast-key="${forecastKey}">${defaultVal}</td>`;
    }

    tableHTML += `</tr>`;
  });

  tableHTML += `
          </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  container.innerHTML = tableHTML;
}

/**
 * Forecast controls
 */
function updateForecast() {
  const method = document.getElementById('forecastMethod')?.value ?? 'custom';
  const growthRate = parseFloat(document.getElementById('customGrowthRate')?.value) || 0;
  const periods = parseInt(document.getElementById('forecastPeriods')?.value) || 12;

  const methodLabel =
    method === 'custom' ? 'Custom Growth' :
    method === 'rolling' ? 'Rolling Average' :
    '3-Month Average';

  const settingsEl = document.getElementById('currentSettings');
  if (settingsEl) settingsEl.textContent = `${methodLabel} at ${growthRate}% for ${periods} periods`;

  let revGrowth = growthRate / 100;  // Annual rate
  let expGrowth = (growthRate * 0.8) / 100;  // Annual rate
  
  // All methods now use the user's growth rate input

  // Update all forecast views with dynamic periods
  updateDynamicForecasts(revGrowth, expGrowth, periods);
  
  // Refresh insights when forecasts change
  setTimeout(() => {
    calculateInsights();
  }, 500);
}

/**
 * Dynamic forecast calculations for all line items
 */
function updateDynamicForecasts(revGrowth, expGrowth, periods) {
  // Update each statement type
  ['pnl', 'balance', 'cashflow'].forEach(statementType => {
    const lineItems = uploadedLineItems[statementType] || [];
    
    lineItems.forEach(item => {
      // Skip subheaders entirely
      if (item.isSubheader) return;
      // Calculate growth rate for this item
      let itemGrowth = revGrowth;
      if (statementType === 'pnl' && item.name.toLowerCase().includes('expense')) {
        itemGrowth = expGrowth;
      }
      
      // Use the most recent actual value as base
      const baseMonthly = lastNonNull(item.actualValues);
      const baseValue = (typeof baseMonthly === 'number') ? baseMonthly : (item.actual ?? 0);

      // Compute roll-up bases for quarterly and yearly
      let baseQuarterly = baseValue;
      let baseYearly = baseValue;
      if (item.actualValues && item.actualValues.length > 0) {
        const agg = aggregateActuals(statementType, item.actualValues);
        const qo = agg.toQuarterOutputs();
        const yo = agg.toYearOutputs();
        if (qo.values && qo.values.length > 0) baseQuarterly = qo.values[qo.values.length - 1];
        if (yo.values && yo.values.length > 0) baseYearly = yo.values[yo.values.length - 1];
      }
      
      // Update forecast columns
      const safeName = item.name.toLowerCase().replace(/\s+/g, '');
      for (let i = 0; i < periods; i++) {
        // separate keys per periodType to avoid cross-period contamination
        const forecastKeyMonthly = `monthly-${statementType}-${safeName}-${i}`;
        const forecastKeyQuarterly = `quarterly-${statementType}-${safeName}-${i}`;
        const forecastKeyYearly = `yearly-${statementType}-${safeName}-${i}`;
        
        // Get seasonality settings
        const seasonalPattern = document.getElementById('seasonalPattern')?.value || 'none';
        const seasonalStrength = parseFloat(document.getElementById('seasonalStrength')?.value) || 50;
        
        // Calculate base forecasts
        const mForecast = baseValue * Math.pow(1 + itemGrowth, i + 1);
        const qForecast = baseQuarterly * Math.pow(1 + itemGrowth, i + 1);
        const yForecast = baseYearly * Math.pow(1 + itemGrowth, i + 1);
        
        // Apply seasonality based on period type
        const forecastMonth = (i + 1) % 12; // Month index (0-11)
        const seasonalMultiplierMonthly = getSeasonalMultiplier(forecastMonth, seasonalPattern, seasonalStrength, 'monthly');
        const seasonalMultiplierQuarterly = getSeasonalMultiplier(forecastMonth, seasonalPattern, seasonalStrength, 'quarterly');
        const seasonalMultiplierYearly = getSeasonalMultiplier(forecastMonth, seasonalPattern, seasonalStrength, 'yearly');
        
        // Apply seasonality and clamp for non-negative constraints
        const clamp = (v) => (/total/i.test(item.name) ? Math.max(v, 0) : v);
        const mForecastSeasonal = clamp(mForecast * seasonalMultiplierMonthly);
        const qForecastSeasonal = clamp(qForecast * seasonalMultiplierQuarterly);
        const yForecastSeasonal = clamp(yForecast * seasonalMultiplierYearly);
        
        // Update monthly
        document.querySelectorAll(`[data-forecast-key="${forecastKeyMonthly}"]`).forEach(cell => {
          updateElement(cell.id, formatCurrency(mForecastSeasonal, !hasUploadedData));
        });
        // Update quarterly based on base of rolled-up last quarter
        document.querySelectorAll(`[data-forecast-key="${forecastKeyQuarterly}"]`).forEach(cell => {
          updateElement(cell.id, formatCurrency(qForecastSeasonal, !hasUploadedData));
        });
        // Update yearly based on base of rolled-up last year
        document.querySelectorAll(`[data-forecast-key="${forecastKeyYearly}"]`).forEach(cell => {
          updateElement(cell.id, formatCurrency(yForecastSeasonal, !hasUploadedData));
        });
      }
    });
  });
}

function lastNonNull(arr) {
  if (!arr || arr.length === 0) return null;
  for (let i = arr.length - 1; i >= 0; i--) {
    const v = arr[i];
    if (v !== null && typeof v !== 'undefined') return Number(v);
  }
  return null;
}

function updateElement(id, text, value = null) {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = text;
    if (value !== null) {
      el.classList.toggle('positive', value >= 0);
      el.classList.toggle('negative', value < 0);
    }
  }
}

/**
 * Enhanced CSV Upload handling for the user's actual format
 */
function parseCSVToObject(text) {
  const raw = text.replace(/^\uFEFF/, '');
  const lines = raw.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) throw new Error('CSV must include a header row and at least one data row');

  const delimiter = detectDelimiter(lines[0]);
  const headerFields = parseCsvLine(lines[0], delimiter);
  dateColumns = headerFields.slice(1).map(col => col.replace(/"/g, ''));

  const data = { pnl: [], balance: [], cashflow: [] };
  let currentStatement = null;

  const normalizeKey = (s) => s.toLowerCase().replace(/[^a-z]/g, '');
  const statementMap = new Map([
    ['pl', 'pnl'],
    ['pandl', 'pnl'],
    ['profitandloss', 'pnl'],
    ['incomestatement', 'pnl'],
    ['balancesheet', 'balance'],
    ['bs', 'balance'],
    ['cashflows', 'cashflow'],
    ['cashflow', 'cashflow'],
    ['statementofcashflows', 'cashflow']
  ]);

  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i], delimiter).map(v => v.replace(/"/g, ''));
    if (values.length === 0) continue;

    const firstColumn = (values[0] || '').trim();
    const key = normalizeKey(firstColumn);

    if (statementMap.has(key)) {
      currentStatement = statementMap.get(key);
      continue;
    }

    // Keep totals and subtotals; only skip empty structural separators
    if (!firstColumn) {
      continue;
    }

    if (!currentStatement || !data[currentStatement]) {
      if (/revenue|sales|cogs|expense|income/i.test(firstColumn)) currentStatement = 'pnl';
      else if (/cash|receivable|inventory|payable|asset|liabilit|equity/i.test(firstColumn)) currentStatement = 'balance';
      else if (/operating|investing|financing/i.test(firstColumn)) currentStatement = 'cashflow';
      else continue;
    }

    const lineItemName = firstColumn;
    const actualValues = [];
    for (let j = 1; j < values.length && j < dateColumns.length + 1; j++) {
      actualValues.push(toNumberOrZero(values[j]));
    }

    // Always include the line item, even if all zeros, so nothing is dropped
    data[currentStatement].push({
      name: lineItemName,
      actual: actualValues.length ? actualValues[actualValues.length - 1] : 0,
      actualValues: actualValues,
      statement: currentStatement
    });
  }

  if (data.pnl.length === 0 && data.balance.length === 0 && data.cashflow.length === 0) {
    throw new Error('Could not detect any statement data. Ensure your CSV includes sections like P&L, Balance Sheet, or Cashflows.');
  }

  return data;
}

function toNumberOrZero(v) {
  if (v == null || v === '') return 0;
  const n = Number(String(v).replace(/[\$,]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function detectDelimiter(headerLine) {
  const candidates = [',', ';', '\t'];
  let best = ',';
  let bestCount = -1;
  candidates.forEach(d => {
    const count = (headerLine.match(new RegExp(escapeRegExp(d), 'g')) || []).length;
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  });
  return best;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseCsvLine(line, delimiter) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === delimiter) {
        fields.push(current);
        current = '';
      } else {
        current += char;
      }
    }
  }
  fields.push(current);
  return fields.map(v => v.trim());
}

function applyActualsFromObject(data) {
  // Clear existing data
  uploadedLineItems = { pnl: [], balance: [], cashflow: [] };
  sampleData = {};
  
  // Process each statement type
  Object.keys(data).forEach(statementType => {
    if (['pnl', 'profit', 'income'].includes(statementType)) {
      uploadedLineItems.pnl = data[statementType] || [];
    } else if (['balance', 'balancesheet'].includes(statementType)) {
      uploadedLineItems.balance = data[statementType] || [];
    } else if (['cashflow', 'cash'].includes(statementType)) {
      uploadedLineItems.cashflow = data[statementType] || [];
    }
  });
  
  hasUploadedData = true;
  
  // Rebuild all tables with dynamic structure
  rebuildAllTables();
  
  // Recompute forecasts
  updateForecast();
}

function rebuildAllTables() {
  const periods = parseInt(document.getElementById('forecastPeriods')?.value) || 12;
  
  // Rebuild each tab's tables
  createDynamicTable('monthlyPnlContainer', 'pnl', 'monthly', 'monthly');
  createDynamicTable('monthlyBalanceContainer', 'balance', 'monthly', 'monthly');
  createDynamicTable('monthlyCashflowContainer', 'cashflow', 'monthly', 'monthly');
  
  createDynamicTable('quarterlyPnlContainer', 'pnl', 'quarterly', 'quarterly');
  createDynamicTable('quarterlyBalanceContainer', 'balance', 'quarterly', 'quarterly');
  createDynamicTable('quarterlyCashflowContainer', 'cashflow', 'quarterly', 'quarterly');
  
  createDynamicTable('yearlyPnlContainer', 'pnl', 'yearly', 'yearly');
  createDynamicTable('yearlyBalanceContainer', 'balance', 'yearly', 'yearly');
  createDynamicTable('yearlyCashflowContainer', 'cashflow', 'yearly', 'yearly');
}

async function handleActualsUpload(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      console.log('Parsing CSV...');
      const data = parseCSVToObject(reader.result);
      console.log('Parsed data:', data);
      
      // Run AI classification on balance sheet items
      await processBalanceSheetClassification(data);
      
      applyActualsFromObject(data);
    } catch (e) {
      console.error('CSV parsing error:', e);
      alert('Failed to parse CSV: ' + e.message);
    }
  };
  reader.readAsText(file);
}

/**
 * Export functions
 */
// Combined export removed

function exportPeriodData(period) {
  const tables = [`${period}pnltable`, `${period}balancetable`, `${period}cashflowtable`];
  exportMultipleTables(tables, `${period}_3_statement_forecast`);
}

function exportMultipleTables(tableIds, filename) {
  let csvContent = '';
  
  tableIds.forEach((tableId, index) => {
    const table = document.getElementById(tableId);
    if (table) {
      if (index > 0) csvContent += '\n\n';
      const label = labelFromTableId(tableId);
      csvContent += `${label}\n`;
      
      const rows = Array.from(table.rows);
      csvContent += rows.map(row => {
        return Array.from(row.cells)
          .map(cell => '"' + cell.textContent.replace(/"/g, '""') + '"')
          .join(',');
      }).join('\n');
    }
  });

  const blob = new Blob([csvContent], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function labelFromTableId(tableId) {
  const scope = tableId.startsWith('combined') ? 'Combined' :
    tableId.startsWith('monthly') ? 'Monthly' :
    tableId.startsWith('quarterly') ? 'Quarterly' :
    tableId.startsWith('yearly') ? 'Yearly' : 'Unknown';
  const type = tableId.includes('pnl') ? 'P&L' :
    tableId.includes('balance') ? 'Balance Sheet' :
    tableId.includes('cashflow') ? 'Cash Flow' : 'Statement';
  return `${type} - ${scope}`;
}

// Expose functions globally
window.exportPeriodData = exportPeriodData;

/**
 * Insights calculations
 */
function calculateInsights() {
  console.log('calculateInsights called, hasUploadedData:', hasUploadedData);
  
  // Check if we have uploaded data
  if (!hasUploadedData) {
    console.log('No uploaded data, showing blank insights');
    displayBlankInsights();
    return;
  }
  
  console.log('Calculating insights with uploaded data');
  
  // Calculate insights for each period type
  ['monthly', 'quarterly', 'yearly'].forEach(periodType => {
    const largestChanges = calculateLargestChangesForPeriod(periodType);
    const anomalousItems = calculateAnomalousItemsForPeriod(periodType);
    
    displayLargestChangesForPeriod(periodType, largestChanges);
    displayAnomalousItemsForPeriod(periodType, anomalousItems);
  });
  
  // Populate line item dropdowns
  populateLineItemDropdowns();
}

function displayBlankInsights() {
  console.log('displayBlankInsights called');
  
  // Update all period-specific containers
  ['monthly', 'quarterly', 'yearly'].forEach(periodType => {
    const largestChangesContainer = document.getElementById(`${periodType}LargestChanges`);
    const anomalousItemsContainer = document.getElementById(`${periodType}AnomalousItems`);
    const lineChartContainer = document.getElementById(`${periodType}LineChart`);
    
    if (largestChangesContainer) {
      largestChangesContainer.innerHTML = '<div class="loading">Upload a Financial Statement for Insights</div>';
    }
    
    if (anomalousItemsContainer) {
      anomalousItemsContainer.innerHTML = '<div class="loading">Upload a Financial Statement for Insights</div>';
    }
    
    if (lineChartContainer) {
      lineChartContainer.innerHTML = '<div class="loading">Upload a Financial Statement for Insights</div>';
    }
  });
}

function calculateLargestChanges() {
  const changes = [];
  
  // Analyze all statement types
  ['pnl', 'balance', 'cashflow'].forEach(statementType => {
    const lineItems = uploadedLineItems[statementType] || [];
    
    lineItems.forEach(item => {
      if (!item.actualValues || item.actualValues.length === 0) return;
      
      // Get last actual value
      const lastActual = lastNonNull(item.actualValues);
      if (lastActual === null || lastActual === 0) return;
      
      // Get furthest forecast value (simplified - using the last forecast period)
      const periods = parseInt(document.getElementById('forecastPeriods')?.value) || 12;
      const growthRate = parseFloat(document.getElementById('customGrowthRate')?.value) || 5;
      
      // Calculate forecast value
      let itemGrowth = growthRate / 100;  // Annual rate
      if (statementType === 'pnl' && item.name.toLowerCase().includes('expense')) {
        itemGrowth = (growthRate * 0.8) / 100;  // Annual rate
      }
      
      // Convert to monthly rate for calculation
      itemGrowth = itemGrowth / 12;
      
      const furthestForecast = lastActual * Math.pow(1 + itemGrowth, periods);
      const percentChange = ((furthestForecast - lastActual) / Math.abs(lastActual)) * 100;
      
      // Get the date of the last actual value
      const lastActualIndex = item.actualValues.lastIndexOf(lastActual);
      const lastActualDate = dateColumns[lastActualIndex] || `Period ${lastActualIndex + 1}`;
      
      // Calculate forecast date (last actual + forecast periods)
      const forecastDate = `Forecast +${periods} periods`;
      
      changes.push({
        name: item.name,
        statement: statementType,
        lastActual: lastActual,
        furthestForecast: furthestForecast,
        percentChange: percentChange,
        isPositive: percentChange > 0,
        lastActualDate: lastActualDate,
        forecastDate: forecastDate
      });
    });
  });
  
  // Sort by absolute percent change and return top 3
  return changes
    .sort((a, b) => Math.abs(b.percentChange) - Math.abs(a.percentChange))
    .slice(0, 3);
}


function calculateTrend(values) {
  if (values.length < 2) return 0;
  const first = values[0];
  const last = values[values.length - 1];
  return (last - first) / first;
}

function calculateVolatility(values) {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
  const stdDev = Math.sqrt(variance);
  return stdDev / Math.abs(mean);
}

function displayLargestChanges(changes) {
  const container = document.getElementById('largestChanges');
  if (!container) return;
  
  if (changes.length === 0) {
    container.innerHTML = '<div class="loading">No significant changes detected</div>';
    return;
  }
  
  container.innerHTML = changes.map(change => {
    const changeClass = change.isPositive ? 'positive' : 'negative';
    const changeSymbol = change.isPositive ? '+' : '';
    const statementLabel = change.statement === 'pnl' ? 'P&L' : 
                          change.statement === 'balance' ? 'Balance' : 'Cash Flow';
    
    return `
      <div class="insight-item ${changeClass}">
        <div class="insight-label">${change.name}</div>
        <div class="insight-value">
          ${statementLabel}: ${changeSymbol}${change.percentChange.toFixed(1)}%
          <br>From ${formatCurrency(change.lastActual)} (${change.lastActualDate}) to ${formatCurrency(change.furthestForecast)} (${change.forecastDate})
        </div>
      </div>
    `;
  }).join('');
}


/**
 * Period-specific insights calculations
 */
function calculateLargestChangesForPeriod(periodType) {
  const changes = [];
  
  // Analyze all statement types
  ['pnl', 'balance', 'cashflow'].forEach(statementType => {
    const lineItems = uploadedLineItems[statementType] || [];
    
    lineItems.forEach(item => {
      if (!item.actualValues || item.actualValues.length === 0) return;
      
      // Get aggregated data for this period type
      let actualsForItem = [];
      let labels = [];
      
      if (periodType === 'monthly') {
        actualsForItem = (item.actualValues || []).slice();
        labels = (dateColumns || []).slice();
      } else {
        const agg = aggregateActuals(statementType, item.actualValues || []);
        const out = periodType === 'quarterly' ? agg.toQuarterOutputs() : agg.toYearOutputs();
        actualsForItem = out.values || [];
        labels = out.labels || [];
      }
      
      if (actualsForItem.length === 0) return;
      
      // Get last actual value
      const lastActual = lastNonNull(actualsForItem);
      if (lastActual === null || lastActual === 0) return;
      
      // Get furthest forecast value
      const periods = parseInt(document.getElementById('forecastPeriods')?.value) || 12;
      const growthRate = parseFloat(document.getElementById('customGrowthRate')?.value) || 5;
      
      // Calculate forecast value
      let itemGrowth = growthRate / 100;  // Annual rate
      if (statementType === 'pnl' && item.name.toLowerCase().includes('expense')) {
        itemGrowth = (growthRate * 0.8) / 100;  // Annual rate
      }
      
      // Convert to monthly rate for calculation
      itemGrowth = itemGrowth / 12;
      
      const furthestForecast = lastActual * Math.pow(1 + itemGrowth, periods);
      const percentChange = ((furthestForecast - lastActual) / Math.abs(lastActual)) * 100;
      
      // Get the date of the last actual value
      const lastActualIndex = actualsForItem.lastIndexOf(lastActual);
      const lastActualDate = labels[lastActualIndex] || `Period ${lastActualIndex + 1}`;
      
      // Calculate forecast date
      const forecastDate = `Forecast +${periods} periods`;
      
      changes.push({
        name: item.name,
        statement: statementType,
        lastActual: lastActual,
        furthestForecast: furthestForecast,
        percentChange: percentChange,
        isPositive: percentChange > 0,
        lastActualDate: lastActualDate,
        forecastDate: forecastDate,
        lastActualDateType: 'Actual',
        forecastDateType: 'Forecast'
      });
    });
  });
  
  // Sort by absolute percent change and return top 3
  return changes
    .sort((a, b) => Math.abs(b.percentChange) - Math.abs(a.percentChange))
    .slice(0, 3);
}

function calculateAnomalousItemsForPeriod(periodType) {
  const anomalies = [];
  const threshold = parseFloat(document.getElementById(`${periodType}AnomalyThreshold`)?.value) || 30;
  
  ['pnl', 'balance', 'cashflow'].forEach(statementType => {
    const lineItems = uploadedLineItems[statementType] || [];
    
    lineItems.forEach(item => {
      if (!item.actualValues || item.actualValues.length < 2) return;
      
      // Get aggregated data for this period type
      let actualsForItem = [];
      let labels = [];
      
      if (periodType === 'monthly') {
        actualsForItem = (item.actualValues || []).slice();
        labels = (dateColumns || []).slice();
      } else {
        const agg = aggregateActuals(statementType, item.actualValues || []);
        const out = periodType === 'quarterly' ? agg.toQuarterOutputs() : agg.toYearOutputs();
        actualsForItem = out.values || [];
        labels = out.labels || [];
      }
      
      if (actualsForItem.length < 2) return;
      
      const values = actualsForItem.filter(v => v !== null && v !== undefined);
      if (values.length < 2) return;
      
      // Check for period-to-period changes above threshold
      for (let i = 1; i < values.length; i++) {
        const currentValue = values[i];
        const previousValue = values[i - 1];
        
        if (previousValue === 0) continue; // Avoid division by zero
        
        const percentChange = Math.abs((currentValue - previousValue) / Math.abs(previousValue)) * 100;
        
        if (percentChange >= threshold) {
          // Get the dates for this change
          const currentDateIndex = i;
          const previousDateIndex = i - 1;
          const currentDateLabel = labels[currentDateIndex] || `Period ${currentDateIndex + 1}`;
          const previousDateLabel = labels[previousDateIndex] || `Period ${previousDateIndex + 1}`;
          
          anomalies.push({
            name: item.name,
            statement: statementType,
            currentValue: currentValue,
            previousValue: previousValue,
            percentChange: percentChange,
            isIncrease: currentValue > previousValue,
            currentDate: currentDateLabel,
            previousDate: previousDateLabel,
            anomalyType: 'period_change'
          });
        }
      }
    });
  });
  
  // Sort by percent change and return all anomalies
  return anomalies
    .sort((a, b) => b.percentChange - a.percentChange);
}

function displayLargestChangesForPeriod(periodType, changes) {
  const container = document.getElementById(`${periodType}LargestChanges`);
  if (!container) return;
  
  if (changes.length === 0) {
    container.innerHTML = '<div class="loading">No significant changes detected</div>';
    return;
  }
  
  container.innerHTML = changes.map(change => {
    const changeClass = change.isPositive ? 'positive' : 'negative';
    const changeSymbol = change.isPositive ? '+' : '';
    const statementLabel = change.statement === 'pnl' ? 'P&L' : 
                          change.statement === 'balance' ? 'Balance' : 'Cash Flow';
    
    return `
      <div class="insight-item ${changeClass}">
        <div class="insight-label">${change.name}</div>
        <div class="insight-value">
          ${statementLabel}: ${changeSymbol}${change.percentChange.toFixed(1)}%
          <br>From ${formatCurrency(change.lastActual)} on ${change.lastActualDate} (${change.lastActualDateType}) to ${formatCurrency(change.furthestForecast)} on ${change.forecastDate} (${change.forecastDateType})
        </div>
      </div>
    `;
  }).join('');
}

function displayAnomalousItemsForPeriod(periodType, anomalies) {
  const container = document.getElementById(`${periodType}AnomalousItems`);
  if (!container) return;
  
  if (anomalies.length === 0) {
    container.innerHTML = '<div class="loading">No anomalies detected</div>';
    return;
  }
  
  container.innerHTML = anomalies.map(anomaly => {
    const statementLabel = anomaly.statement === 'pnl' ? 'P&L' : 
                          anomaly.statement === 'balance' ? 'Balance' : 'Cash Flow';
    const changeSymbol = anomaly.isIncrease ? '+' : '-';
    const changeClass = anomaly.isIncrease ? 'positive' : 'negative';
    
    return `
      <div class="insight-item anomaly ${changeClass}">
        <div class="insight-label">${anomaly.name}</div>
        <div class="insight-value">
          ${statementLabel}: ${changeSymbol}${anomaly.percentChange.toFixed(1)}% change
          <br>From ${formatCurrency(anomaly.previousValue)} on ${anomaly.previousDate} (Actual) to ${formatCurrency(anomaly.currentValue)} on ${anomaly.currentDate} (Actual)
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Line chart functionality
 */
function populateLineItemDropdowns() {
  const allLineItems = [];
  
  // Collect all line items from all statement types
  ['pnl', 'balance', 'cashflow'].forEach(statementType => {
    const lineItems = uploadedLineItems[statementType] || [];
    lineItems.forEach(item => {
      if (item.actualValues && item.actualValues.length > 0) {
        allLineItems.push({
          name: item.name,
          statement: statementType,
          actualValues: item.actualValues
        });
      }
    });
  });
  
  // Populate dropdowns for each period type
  ['monthly', 'quarterly', 'yearly'].forEach(periodType => {
    for (let i = 1; i <= 3; i++) {
      const select = document.getElementById(`${periodType}LineItem${i}`);
      if (select) {
        // Clear existing options except the first one
        select.innerHTML = '<option value="">Select line item ' + i + '</option>';
        
        // Add all line items
        allLineItems.forEach(item => {
          const option = document.createElement('option');
          option.value = `${item.statement}::${item.name}`;
          option.textContent = `${item.statement.toUpperCase()}: ${item.name}`;
          select.appendChild(option);
        });
        
        // Add change listener
        select.addEventListener('change', () => updateLineChart(periodType));
      }
    }
  });
}

function updateLineChart(periodType) {
  const chartContainer = document.getElementById(`${periodType}LineChart`);
  if (!chartContainer) return;
  
  // Get selected line items
  const selectedItems = [];
  for (let i = 1; i <= 3; i++) {
    const select = document.getElementById(`${periodType}LineItem${i}`);
    if (select && select.value) {
      const [statementType, itemName] = select.value.split('::');
      const lineItem = uploadedLineItems[statementType]?.find(item => item.name === itemName);
      if (lineItem) {
        selectedItems.push({
          name: itemName,
          statement: statementType,
          actualValues: lineItem.actualValues || []
        });
      }
    }
  }
  
  if (selectedItems.length === 0) {
    chartContainer.innerHTML = '<div class="loading">Select line items to display chart</div>';
    return;
  }
  
  // Generate chart data
  const chartData = generateChartData(periodType, selectedItems);
  
  // Create SVG chart
  createSVGChart(chartContainer, chartData, periodType);
}

function generateChartData(periodType, selectedItems) {
  const data = {
    labels: [],
    datasets: []
  };
  
  // Generate labels based on period type
  if (periodType === 'monthly') {
    data.labels = (dateColumns || []).slice();
  } else {
    // For quarterly/yearly, we need to get aggregated labels
    const firstItem = selectedItems[0];
    if (firstItem && firstItem.actualValues.length > 0) {
      const agg = aggregateActuals(firstItem.statement, firstItem.actualValues);
      const out = periodType === 'quarterly' ? agg.toQuarterOutputs() : agg.toYearOutputs();
      data.labels = out.labels || [];
    }
  }
  
  // Generate datasets for each selected item
  const colors = ['#3498db', '#e74c3c', '#27ae60'];
  
  selectedItems.forEach((item, index) => {
    let values = [];
    
    if (periodType === 'monthly') {
      values = (item.actualValues || []).slice();
    } else {
      const agg = aggregateActuals(item.statement, item.actualValues || []);
      const out = periodType === 'quarterly' ? agg.toQuarterOutputs() : agg.toYearOutputs();
      values = out.values || [];
    }
    
    data.datasets.push({
      label: `${item.statement.toUpperCase()}: ${item.name}`,
      values: values,
      color: colors[index % colors.length]
    });
  });
  
  return data;
}

function createSVGChart(container, data, periodType) {
  const width = 400;
  const height = 180;
  const padding = 40;
  const chartWidth = width - padding * 2;
  const chartHeight = height - padding * 2;
  
  // Clear container
  container.innerHTML = '';
  
  // Create SVG
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  svg.style.background = 'white';
  
  // Find min/max values across all datasets
  let minValue = Infinity;
  let maxValue = -Infinity;
  
  data.datasets.forEach(dataset => {
    dataset.values.forEach(value => {
      if (value !== null && value !== undefined) {
        minValue = Math.min(minValue, value);
        maxValue = Math.max(maxValue, value);
      }
    });
  });
  
  if (minValue === Infinity || maxValue === -Infinity) {
    container.innerHTML = '<div class="loading">No data available for chart</div>';
    return;
  }
  
  // Add some padding to the value range
  const valueRange = maxValue - minValue;
  const paddedMin = minValue - valueRange * 0.1;
  const paddedMax = maxValue + valueRange * 0.1;
  const paddedRange = paddedMax - paddedMin;
  
  // Helper function to convert value to y coordinate
  const valueToY = (value) => {
    if (value === null || value === undefined) return null;
    return padding + chartHeight - ((value - paddedMin) / paddedRange) * chartHeight;
  };
  
  // Helper function to convert index to x coordinate
  const indexToX = (index) => {
    return padding + (index / (data.labels.length - 1)) * chartWidth;
  };
  
  // Draw axes
  const xAxis = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  xAxis.setAttribute('x1', padding);
  xAxis.setAttribute('y1', padding + chartHeight);
  xAxis.setAttribute('x2', padding + chartWidth);
  xAxis.setAttribute('y2', padding + chartHeight);
  xAxis.setAttribute('stroke', '#ddd');
  xAxis.setAttribute('stroke-width', '1');
  svg.appendChild(xAxis);
  
  const yAxis = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  yAxis.setAttribute('x1', padding);
  yAxis.setAttribute('y1', padding);
  yAxis.setAttribute('x2', padding);
  yAxis.setAttribute('y2', padding + chartHeight);
  yAxis.setAttribute('stroke', '#ddd');
  yAxis.setAttribute('stroke-width', '1');
  svg.appendChild(yAxis);
  
  // Draw lines for each dataset
  data.datasets.forEach(dataset => {
    const pathData = [];
    let hasValidData = false;
    
    dataset.values.forEach((value, index) => {
      const x = indexToX(index);
      const y = valueToY(value);
      
      if (y !== null) {
        if (hasValidData) {
          pathData.push(`L ${x} ${y}`);
        } else {
          pathData.push(`M ${x} ${y}`);
          hasValidData = true;
        }
      }
    });
    
    if (hasValidData) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', pathData.join(' '));
      path.setAttribute('stroke', dataset.color);
      path.setAttribute('stroke-width', '2');
      path.setAttribute('fill', 'none');
      svg.appendChild(path);
      
      // Add dots for data points
      dataset.values.forEach((value, index) => {
        const x = indexToX(index);
        const y = valueToY(value);
        
        if (y !== null) {
          const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          circle.setAttribute('cx', x);
          circle.setAttribute('cy', y);
          circle.setAttribute('r', '3');
          circle.setAttribute('fill', dataset.color);
          svg.appendChild(circle);
        }
      });
    }
  });
  
  // Add labels
  data.labels.forEach((label, index) => {
    if (index % Math.ceil(data.labels.length / 6) === 0) { // Show every nth label to avoid crowding
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', indexToX(index));
      text.setAttribute('y', height - 5);
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('font-size', '10');
      text.setAttribute('fill', '#666');
      text.textContent = label.length > 8 ? label.substring(0, 8) + '...' : label;
      svg.appendChild(text);
    }
  });
  
  container.appendChild(svg);
}

/**
 * Balance Sheet Classification System
 */
async function classifyBalanceSheetItems(lineItems) {
  try {
    console.log('Classifying balance sheet items:', lineItems);
    
    // Backend API endpoint - automatically detect if running locally or on Vercel
    const BACKEND_URL = window.location.hostname === 'localhost' 
      ? 'http://localhost:3001/api/classify-balance-sheet'
      : `${window.location.origin}/api/classify-balance-sheet`;
    
    const response = await fetch(BACKEND_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        lineItems: lineItems
      })
    });
    
    console.log('Classification response status:', response.status);
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      console.error('Classification error response:', errorData);
      throw new Error(`Classification API error: ${response.status} - ${errorData.details || errorData.error || 'Unknown error'}`);
    }
    
    const data = await response.json();
    
    if (data.success) {
      console.log('Classification successful:', data);
      return data.classifications;
    } else {
      throw new Error(data.error || 'Unknown classification error');
    }
    
  } catch (error) {
    console.error('Error classifying balance sheet items:', error);
    throw error;
  }
}

/**
 * Test the balance sheet classification system
 */
function testBalanceSheetClassification() {
  const testItems = [
    'Cash and Cash Equivalents',
    'Accounts Receivable - Net',
    'Customer A/R',
    'Inventory',
    'Prepaid Expenses',
    'Property, Plant & Equipment',
    'PP&E - Net',
    'Intangible Assets',
    'Accounts Payable',
    'Trade Payables',
    'Accrued Expenses',
    'Short-term Debt',
    'Deferred Revenue',
    'Long-term Debt',
    'Common Stock',
    'Retained Earnings'
  ];
  
  classifyBalanceSheetItems(testItems)
    .then(results => {
      console.log('✅ Classification Test Results:');
      console.table(results);
      
      // Show results in a more readable format
      results.forEach(result => {
        const confidence = (result.confidence * 100).toFixed(1);
        console.log(`📊 "${result.originalName}" → ${result.standardName} (${confidence}% confidence)`);
        console.log(`   Driver: ${result.driver}, Method: ${result.method}, Category: ${result.categoryInfo}`);
      });
    })
    .catch(error => {
      console.error('❌ Classification Test Failed:', error);
    });
}

// Expose test function globally for easy testing
window.testBalanceSheetClassification = testBalanceSheetClassification;

/**
 * Storage for balance sheet classifications
 */
let balanceSheetClassifications = {};

/**
 * Storage for P&L to Balance Sheet mappings
 */
let pnlMappings = {};

/**
 * P&L Pattern Recognition for Smart Mapping
 */
const PNL_MAPPING_PATTERNS = {
  revenue_drivers: [
    'total revenue', 'net revenue', 'total sales', 'net sales', 
    'gross revenue', 'revenue total', 'sales total', 'total income',
    'gross sales', 'service revenue total', 'product revenue total'
  ],
  cogs_drivers: [
    'total cost of goods sold', 'total cogs', 'cost of goods sold',
    'total cost of sales', 'cost of sales', 'cogs total',
    'total product costs', 'direct costs total'
  ],
  expense_drivers: [
    'total operating expenses', 'operating expenses', 'total opex',
    'total expenses', 'operational expenses', 'total overhead',
    'administrative expenses', 'selling expenses'
  ],
  net_income_drivers: [
    'net income', 'net profit', 'profit after tax', 'bottom line',
    'net earnings', 'profit/loss', 'total profit', 'earnings'
  ],
  depreciation_drivers: [
    'depreciation', 'depreciation expense', 'amortization',
    'depreciation and amortization', 'total depreciation'
  ]
};

/**
 * Balance Sheet to P&L Driver Requirements
 */
const BALANCE_SHEET_DRIVER_REQUIREMENTS = {
  'accounts_receivable': 'revenue_drivers',
  'inventory': 'cogs_drivers', 
  'prepaid_expenses': 'revenue_drivers',
  'accounts_payable': 'expense_drivers',
  'accrued_expenses': 'expense_drivers',
  'deferred_revenue': 'revenue_drivers',
  'retained_earnings': 'net_income_drivers',
  'property_plant_equipment': 'depreciation_drivers'
};

/**
 * Auto-detect special balance sheet item types
 */
function autoDetectSpecialTypes(balanceSheetItems) {
  return balanceSheetItems.map(item => {
    const name = item.name.toLowerCase();
    const hasValues = item.actualValues && item.actualValues.some(val => val !== null && val !== undefined && val !== '');
    
    // Auto-detect totals
    const isTotal = /\btotal\b/i.test(item.name);
    
    // Auto-detect subheaders (no values or all blank)
    const isSubheader = !hasValues;
    
    return {
      ...item,
      autoDetectedType: isTotal ? 'calculated_total' : isSubheader ? 'subheader' : 'line_item',
      hasValues: hasValues
    };
  });
}

/**
 * Smart P&L Structure Analysis and Mapping
 */
function analyzePnLStructure(pnlItems) {
  console.log('Analyzing P&L structure for mapping...', pnlItems);
  
  const analysis = {
    totals: [],
    lineItems: [],
    mappings: {}
  };
  
  // Identify totals vs line items in P&L
  pnlItems.forEach(item => {
    const name = item.name.toLowerCase();
    const hasValues = item.actualValues && item.actualValues.some(val => val !== null && val !== undefined && val !== '');
    const isTotal = /\btotal\b/i.test(item.name);
    
    if (isTotal || hasValues) {
      analysis.totals.push({
        ...item,
        normalizedName: name,
        isTotal: isTotal
      });
    } else {
      analysis.lineItems.push(item);
    }
  });
  
  console.log('P&L Analysis:', analysis);
  return analysis;
}

/**
 * Find best P&L driver match for balance sheet item
 */
function findPnLDriverMatch(balanceSheetCategory, pnlAnalysis) {
  const requiredDriverType = BALANCE_SHEET_DRIVER_REQUIREMENTS[balanceSheetCategory];
  if (!requiredDriverType) {
    return { match: null, confidence: 0, alternatives: [] };
  }
  
  const patterns = PNL_MAPPING_PATTERNS[requiredDriverType];
  if (!patterns) {
    return { match: null, confidence: 0, alternatives: [] };
  }
  
  let bestMatch = null;
  let bestConfidence = 0;
  const alternatives = [];
  
  // Search through P&L totals for best match
  pnlAnalysis.totals.forEach(pnlItem => {
    const itemName = pnlItem.normalizedName;
    
    // Calculate confidence based on pattern matching
    let confidence = 0;
    
    patterns.forEach((pattern, index) => {
      const patternScore = 1.0 - (index * 0.1); // Prefer earlier patterns
      
      if (itemName.includes(pattern)) {
        // Exact substring match
        confidence = Math.max(confidence, patternScore * 0.9);
      } else {
        // Fuzzy matching for partial matches
        const words = pattern.split(' ');
        const matchedWords = words.filter(word => itemName.includes(word));
        if (matchedWords.length > 0) {
          const wordMatchRatio = matchedWords.length / words.length;
          confidence = Math.max(confidence, patternScore * wordMatchRatio * 0.7);
        }
      }
    });
    
    // Boost confidence for "total" items
    if (pnlItem.isTotal) {
      confidence *= 1.2;
    }
    
    // Add to alternatives if confidence > 0.3
    if (confidence > 0.3) {
      alternatives.push({
        item: pnlItem,
        confidence: confidence
      });
    }
    
    // Track best match
    if (confidence > bestConfidence) {
      bestMatch = pnlItem;
      bestConfidence = confidence;
    }
  });
  
  // Sort alternatives by confidence
  alternatives.sort((a, b) => b.confidence - a.confidence);
  
  return {
    match: bestMatch,
    confidence: bestConfidence,
    alternatives: alternatives.slice(0, 5) // Top 5 alternatives
  };
}

/**
 * Generate P&L mappings for all balance sheet items
 */
function generatePnLMappings(balanceSheetClassifications, pnlItems) {
  console.log('Generating P&L mappings...');
  
  const pnlAnalysis = analyzePnLStructure(pnlItems);
  const mappings = {};
  
  Object.keys(balanceSheetClassifications).forEach(itemName => {
    const classification = balanceSheetClassifications[itemName];
    
    // Skip non-forecastable items
    if (classification.category === 'subheader' || classification.category === 'calculated_total') {
      return;
    }
    
    // Find best P&L driver match
    const matchResult = findPnLDriverMatch(classification.category, pnlAnalysis);
    
    mappings[itemName] = {
      balanceSheetItem: itemName,
      balanceSheetCategory: classification.category,
      pnlDriver: matchResult.match ? matchResult.match.name : null,
      pnlDriverOriginal: matchResult.match || null,
      confidence: matchResult.confidence,
      alternatives: matchResult.alternatives,
      method: classification.method,
      userOverride: false
    };
    
    console.log(`Mapped "${itemName}" → "${matchResult.match?.name}" (${(matchResult.confidence * 100).toFixed(0)}% confidence)`);
  });
  
  return mappings;
}

/**
 * Process balance sheet classification during CSV upload
 */
async function processBalanceSheetClassification(data) {
  try {
    console.log('Processing balance sheet classification...');
    
    // Extract balance sheet line items
    const balanceSheetItems = data.balance || [];
    if (balanceSheetItems.length === 0) {
      console.log('No balance sheet items found to classify');
      return;
    }
    
    // Auto-detect special types (totals, subheaders)
    const itemsWithDetection = autoDetectSpecialTypes(balanceSheetItems);
    console.log('Items with auto-detection:', itemsWithDetection);
    
    // Only send line items (not totals/subheaders) to AI for classification
    const lineItemsOnly = itemsWithDetection.filter(item => item.autoDetectedType === 'line_item');
    const lineItemNames = lineItemsOnly.map(item => item.name);
    
    console.log('Line items to classify with AI:', lineItemNames);
    console.log('Auto-detected totals:', itemsWithDetection.filter(item => item.autoDetectedType === 'calculated_total').map(item => item.name));
    console.log('Auto-detected subheaders:', itemsWithDetection.filter(item => item.autoDetectedType === 'subheader').map(item => item.name));
    
    // Show loading indicator
    showClassificationLoading();
    
    try {
      let aiClassifications = [];
      
      // Only run AI classification if we have actual line items
      if (lineItemNames.length > 0) {
        aiClassifications = await classifyBalanceSheetItems(lineItemNames);
        console.log('AI classifications received:', aiClassifications);
      }
      
      // Combine AI classifications with auto-detected items
      const allClassifications = itemsWithDetection.map(item => {
        if (item.autoDetectedType === 'calculated_total') {
          return {
            originalName: item.name,
            category: 'calculated_total',
            standardName: item.name,
            driver: 'calculated',
            method: 'sum_of_components',
            confidence: 1.0,
            categoryInfo: 'calculated_total',
            autoDetected: true
          };
        } else if (item.autoDetectedType === 'subheader') {
          return {
            originalName: item.name,
            category: 'subheader',
            standardName: item.name,
            driver: 'none',
            method: 'display_only',
            confidence: 1.0,
            categoryInfo: 'subheader',
            autoDetected: true
          };
        } else {
          // Find AI classification for this line item
          const aiClassification = aiClassifications.find(ai => ai.originalName === item.name);
          return aiClassification || {
            originalName: item.name,
            category: 'unknown',
            standardName: item.name,
            driver: 'manual',
            method: 'growth_rate',
            confidence: 0.1,
            categoryInfo: 'unknown',
            autoDetected: false
          };
        }
      });
      
      // Store classifications
      balanceSheetClassifications = {};
      allClassifications.forEach(classification => {
        balanceSheetClassifications[classification.originalName] = classification;
      });
      
      // Show classification review UI
      await showClassificationReview(allClassifications);
      
      // Generate P&L mappings after classification is complete
      if (Object.keys(balanceSheetClassifications).length > 0 && data.pnl) {
        console.log('Generating P&L mappings...');
        pnlMappings = generatePnLMappings(balanceSheetClassifications, data.pnl);
        
        // Show P&L mapping review UI
        await showPnLMappingReview(pnlMappings, data.pnl);
      }
      
    } catch (error) {
      console.error('Classification failed:', error);
      // Continue without classification if AI fails
      alert('AI classification failed, continuing with standard forecasting. Error: ' + error.message);
    }
    
  } catch (error) {
    console.error('Error in processBalanceSheetClassification:', error);
    // Don't block the upload process if classification fails
  }
}

/**
 * Show loading indicator during classification
 */
function showClassificationLoading() {
  // Create or update loading overlay
  let overlay = document.getElementById('classificationOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'classificationOverlay';
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0,0,0,0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    `;
    document.body.appendChild(overlay);
  }
  
  overlay.innerHTML = `
    <div style="background: white; padding: 30px; border-radius: 10px; text-align: center; box-shadow: 0 10px 30px rgba(0,0,0,0.3);">
      <div style="font-size: 1.2rem; color: #2c3e50; margin-bottom: 15px;">🤖 AI Classification in Progress</div>
      <div style="color: #6c757d; margin-bottom: 20px;">Analyzing your balance sheet line items...</div>
      <div style="width: 200px; height: 4px; background: #e9ecef; border-radius: 2px; overflow: hidden;">
        <div style="width: 100%; height: 100%; background: linear-gradient(90deg, #3498db, #2ecc71); animation: loading 2s infinite;"></div>
      </div>
    </div>
    <style>
      @keyframes loading {
        0% { transform: translateX(-100%); }
        100% { transform: translateX(100%); }
      }
    </style>
  `;
}

/**
 * Show classification review UI for user confirmation
 */
async function showClassificationReview(classifications) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('classificationOverlay');
    if (!overlay) return resolve();
    
    // Group classifications by type
    const autoDetectedTotals = classifications.filter(c => c.category === 'calculated_total');
    const autoDetectedSubheaders = classifications.filter(c => c.category === 'subheader');
    const lineItems = classifications.filter(c => c.category !== 'calculated_total' && c.category !== 'subheader');
    
    // Create dropdown options for all categories
    const categoryOptions = `
      <option value="accounts_receivable">Accounts Receivable</option>
      <option value="inventory">Inventory</option>
      <option value="cash">Cash and Cash Equivalents</option>
      <option value="prepaid_expenses">Prepaid Expenses</option>
      <option value="property_plant_equipment">Property, Plant & Equipment</option>
      <option value="intangible_assets">Intangible Assets</option>
      <option value="accounts_payable">Accounts Payable</option>
      <option value="accrued_expenses">Accrued Expenses</option>
      <option value="short_term_debt">Short-term Debt</option>
      <option value="deferred_revenue">Deferred Revenue</option>
      <option value="long_term_debt">Long-term Debt</option>
      <option value="common_stock">Common Stock</option>
      <option value="retained_earnings">Retained Earnings</option>
      <option value="calculated_total">📊 Calculated Total</option>
      <option value="subheader">📋 Subheader (Display Only)</option>
      <option value="unknown">❓ Unknown/Manual</option>
    `;
    
    overlay.innerHTML = `
      <div style="background: white; padding: 30px; border-radius: 10px; max-width: 900px; max-height: 85vh; overflow-y: auto; box-shadow: 0 10px 30px rgba(0,0,0,0.3);">
        <div style="font-size: 1.5rem; color: #2c3e50; margin-bottom: 10px;">🎯 AI Balance Sheet Classification</div>
        <div style="color: #6c757d; margin-bottom: 20px;">
          Review and modify AI classifications. All items can be changed using the dropdowns below.
        </div>
        
        ${autoDetectedTotals.length > 0 ? `
          <div style="margin-bottom: 25px;">
            <h4 style="color: #8e44ad; margin-bottom: 10px;">📊 Auto-Detected Totals (Calculated Sums)</h4>
            <div style="background: #f8f4ff; padding: 15px; border-radius: 6px; border-left: 4px solid #8e44ad;">
              ${autoDetectedTotals.map(c => `
                <div style="margin-bottom: 12px; padding: 8px; background: white; border-radius: 4px; display: flex; align-items: center; justify-content: space-between;">
                  <div>
                    <strong>"${c.originalName}"</strong> → Calculated Total
                    <br><span style="color: #6c757d; font-size: 0.8rem;">Will be sum of component items</span>
                  </div>
                  <select id="classification_${c.originalName.replace(/[^a-zA-Z0-9]/g, '_')}" style="padding: 4px 8px; border: 1px solid #ddd; border-radius: 4px; min-width: 200px;">
                    <option value="calculated_total" selected>📊 Calculated Total</option>
                    ${categoryOptions}
                  </select>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}
        
        ${autoDetectedSubheaders.length > 0 ? `
          <div style="margin-bottom: 25px;">
            <h4 style="color: #34495e; margin-bottom: 10px;">📋 Auto-Detected Subheaders (No Values)</h4>
            <div style="background: #f8f9fa; padding: 15px; border-radius: 6px; border-left: 4px solid #34495e;">
              ${autoDetectedSubheaders.map(c => `
                <div style="margin-bottom: 12px; padding: 8px; background: white; border-radius: 4px; display: flex; align-items: center; justify-content: space-between;">
                  <div>
                    <strong>"${c.originalName}"</strong> → Subheader
                    <br><span style="color: #6c757d; font-size: 0.8rem;">Display only, no forecasting</span>
                  </div>
                  <select id="classification_${c.originalName.replace(/[^a-zA-Z0-9]/g, '_')}" style="padding: 4px 8px; border: 1px solid #ddd; border-radius: 4px; min-width: 200px;">
                    <option value="subheader" selected>📋 Subheader (Display Only)</option>
                    ${categoryOptions}
                  </select>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}
        
        ${lineItems.length > 0 ? `
          <div style="margin-bottom: 25px;">
            <h4 style="color: #2c3e50; margin-bottom: 10px;">💼 Line Items (Individual Forecasting)</h4>
            <div style="background: #f8f9fa; padding: 15px; border-radius: 6px; border-left: 4px solid #3498db;">
              ${lineItems.map(c => {
                const confidenceColor = c.confidence >= 0.8 ? '#27ae60' : c.confidence >= 0.5 ? '#f39c12' : '#e74c3c';
                const confidenceIcon = c.confidence >= 0.8 ? '✅' : c.confidence >= 0.5 ? '⚠️' : '❗';
                
                return `
                  <div style="margin-bottom: 12px; padding: 8px; background: white; border-radius: 4px; display: flex; align-items: center; justify-content: space-between;">
                    <div>
                      <strong>"${c.originalName}"</strong> → ${c.standardName}
                      <span style="color: ${confidenceColor};">${confidenceIcon} ${(c.confidence * 100).toFixed(0)}%</span>
                      <br><span style="color: #6c757d; font-size: 0.8rem;">Method: ${c.method}, Driver: ${c.driver}</span>
                    </div>
                    <select id="classification_${c.originalName.replace(/[^a-zA-Z0-9]/g, '_')}" style="padding: 4px 8px; border: 1px solid #ddd; border-radius: 4px; min-width: 200px;">
                      <option value="${c.category}" selected>${c.standardName} (${(c.confidence * 100).toFixed(0)}%)</option>
                      ${categoryOptions}
                    </select>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        ` : ''}
        
        <div style="text-align: center; margin-top: 25px;">
          <button id="acceptClassifications" style="background: #3498db; color: white; border: none; padding: 12px 24px; border-radius: 6px; cursor: pointer; font-size: 1rem; margin-right: 10px;">
            Accept Classifications
          </button>
          <button id="skipClassifications" style="background: #95a5a6; color: white; border: none; padding: 12px 24px; border-radius: 6px; cursor: pointer; font-size: 1rem;">
            Skip AI (Use Standard)
          </button>
        </div>
      </div>
    `;
    
    // Add event listeners
    document.getElementById('acceptClassifications').addEventListener('click', () => {
      // Update classifications based on user changes for ALL items
      classifications.forEach(c => {
        const selectId = `classification_${c.originalName.replace(/[^a-zA-Z0-9]/g, '_')}`;
        const select = document.getElementById(selectId);
        if (select) {
          const newCategory = select.value;
          if (newCategory !== c.category) {
            console.log(`User changed "${c.originalName}" from ${c.category} to ${newCategory}`);
            balanceSheetClassifications[c.originalName].category = newCategory;
            balanceSheetClassifications[c.originalName].confidence = 1.0; // User override = 100% confidence
            
            // Update method and driver based on new category
            const categoryInfo = getCategoryInfo(newCategory);
            if (categoryInfo) {
              balanceSheetClassifications[c.originalName].standardName = categoryInfo.standardName;
              balanceSheetClassifications[c.originalName].driver = categoryInfo.driver;
              balanceSheetClassifications[c.originalName].method = categoryInfo.method;
            }
          }
        }
      });
      
      overlay.remove();
      console.log('Final classifications:', balanceSheetClassifications);
      resolve();
    });
    
    document.getElementById('skipClassifications').addEventListener('click', () => {
      balanceSheetClassifications = {}; // Clear classifications
      overlay.remove();
      console.log('User skipped AI classification');
      resolve();
    });
  });
}

/**
 * Get category information for user overrides
 */
function getCategoryInfo(category) {
  const categoryMap = {
    'accounts_receivable': { standardName: 'Accounts Receivable', driver: 'revenue', method: 'days_sales_outstanding' },
    'inventory': { standardName: 'Inventory', driver: 'cost_of_goods_sold', method: 'days_inventory_outstanding' },
    'cash': { standardName: 'Cash and Cash Equivalents', driver: 'calculated', method: 'cash_flow_balancing' },
    'prepaid_expenses': { standardName: 'Prepaid Expenses', driver: 'revenue', method: 'percentage_of_revenue' },
    'property_plant_equipment': { standardName: 'Property, Plant & Equipment', driver: 'depreciation', method: 'capex_depreciation' },
    'intangible_assets': { standardName: 'Intangible Assets', driver: 'revenue', method: 'percentage_of_revenue' },
    'accounts_payable': { standardName: 'Accounts Payable', driver: 'operating_expenses', method: 'days_payable_outstanding' },
    'accrued_expenses': { standardName: 'Accrued Expenses', driver: 'total_expenses', method: 'percentage_of_expenses' },
    'short_term_debt': { standardName: 'Short-term Debt', driver: 'manual', method: 'debt_schedule' },
    'deferred_revenue': { standardName: 'Deferred Revenue', driver: 'revenue', method: 'percentage_of_revenue' },
    'long_term_debt': { standardName: 'Long-term Debt', driver: 'manual', method: 'debt_schedule' },
    'common_stock': { standardName: 'Common Stock', driver: 'manual', method: 'equity_schedule' },
    'retained_earnings': { standardName: 'Retained Earnings', driver: 'net_income', method: 'accumulated_earnings' },
    'calculated_total': { standardName: 'Calculated Total', driver: 'calculated', method: 'sum_of_components' },
    'subheader': { standardName: 'Subheader', driver: 'none', method: 'display_only' },
    'unknown': { standardName: 'Unknown', driver: 'manual', method: 'growth_rate' }
  };
  
  return categoryMap[category];
}

/**
 * Show P&L mapping review UI for user confirmation
 */
async function showPnLMappingReview(mappings, pnlItems) {
  return new Promise((resolve) => {
    // Create overlay if it doesn't exist
    let overlay = document.getElementById('classificationOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'classificationOverlay';
      overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      `;
      document.body.appendChild(overlay);
    }
    
    const mappingEntries = Object.values(mappings);
    const highConfidenceMappings = mappingEntries.filter(m => m.confidence >= 0.7);
    const lowConfidenceMappings = mappingEntries.filter(m => m.confidence < 0.7);
    
    // Create dropdown options from P&L items
    const pnlOptions = pnlItems
      .filter(item => item.actualValues && item.actualValues.some(val => val !== null && val !== undefined && val !== ''))
      .map(item => `<option value="${item.name}">${item.name}</option>`)
      .join('');
    
    overlay.innerHTML = `
      <div style="background: white; padding: 30px; border-radius: 10px; max-width: 1000px; max-height: 85vh; overflow-y: auto; box-shadow: 0 10px 30px rgba(0,0,0,0.3);">
        <div style="font-size: 1.5rem; color: #2c3e50; margin-bottom: 10px;">🔗 P&L Driver Mapping</div>
        <div style="color: #6c757d; margin-bottom: 20px;">
          Review how balance sheet items connect to P&L drivers for forecasting calculations.
        </div>
        
        ${highConfidenceMappings.length > 0 ? `
          <div style="margin-bottom: 25px;">
            <h4 style="color: #27ae60; margin-bottom: 10px;">✅ High Confidence Mappings</h4>
            <div style="background: #f8fff8; padding: 15px; border-radius: 6px; border-left: 4px solid #27ae60;">
              ${highConfidenceMappings.map(mapping => `
                <div style="margin-bottom: 12px; padding: 8px; background: white; border-radius: 4px; display: flex; align-items: center; justify-content: space-between;">
                  <div style="flex: 1;">
                    <strong>"${mapping.balanceSheetItem}"</strong> → <strong style="color: #27ae60;">"${mapping.pnlDriver}"</strong>
                    <span style="color: #27ae60; font-size: 0.9rem;">(${(mapping.confidence * 100).toFixed(0)}% confidence)</span>
                    <br><span style="color: #6c757d; font-size: 0.8rem;">Method: ${mapping.method}</span>
                  </div>
                  <select id="mapping_${mapping.balanceSheetItem.replace(/[^a-zA-Z0-9]/g, '_')}" style="padding: 4px 8px; border: 1px solid #ddd; border-radius: 4px; min-width: 250px;">
                    <option value="${mapping.pnlDriver}" selected>${mapping.pnlDriver} (${(mapping.confidence * 100).toFixed(0)}%)</option>
                    ${pnlOptions}
                    <option value="">❌ No P&L Driver (Manual Entry)</option>
                  </select>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}
        
        ${lowConfidenceMappings.length > 0 ? `
          <div style="margin-bottom: 25px;">
            <h4 style="color: #f39c12; margin-bottom: 10px;">⚠️ Lower Confidence Mappings (Please Review)</h4>
            <div style="background: #fffaf0; padding: 15px; border-radius: 6px; border-left: 4px solid #f39c12;">
              ${lowConfidenceMappings.map(mapping => `
                <div style="margin-bottom: 15px; padding: 10px; background: white; border-radius: 4px; border: 1px solid #e9ecef;">
                  <div style="margin-bottom: 8px;">
                    <strong>"${mapping.balanceSheetItem}"</strong> → 
                    ${mapping.pnlDriver ? `<strong style="color: #f39c12;">"${mapping.pnlDriver}"</strong> <span style="color: #f39c12;">(${(mapping.confidence * 100).toFixed(0)}% confidence)</span>` : '<span style="color: #e74c3c;">No Match Found</span>'}
                    <br><span style="color: #6c757d; font-size: 0.8rem;">
                      Method: ${mapping.method}
                      ${mapping.alternatives.length > 0 ? ` | Alternatives: ${mapping.alternatives.slice(0, 2).map(alt => alt.item.name).join(', ')}` : ''}
                    </span>
                  </div>
                  <select id="mapping_${mapping.balanceSheetItem.replace(/[^a-zA-Z0-9]/g, '_')}" style="padding: 4px 8px; border: 1px solid #ddd; border-radius: 4px; width: 100%;">
                    ${mapping.pnlDriver ? `<option value="${mapping.pnlDriver}" selected>${mapping.pnlDriver} (${(mapping.confidence * 100).toFixed(0)}%)</option>` : ''}
                    ${mapping.alternatives.map(alt => `
                      <option value="${alt.item.name}">${alt.item.name} (${(alt.confidence * 100).toFixed(0)}%)</option>
                    `).join('')}
                    ${pnlOptions}
                    <option value="">❌ No P&L Driver (Manual Entry)</option>
                  </select>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}
        
        ${mappingEntries.length === 0 ? `
          <div style="text-align: center; color: #6c757d; padding: 20px;">
            <div style="font-size: 1.1rem; margin-bottom: 10px;">No Balance Sheet Items to Map</div>
            <div style="font-size: 0.9rem;">All items are subheaders or totals.</div>
          </div>
        ` : ''}
        
        <div style="text-align: center; margin-top: 25px;">
          <button id="acceptMappings" style="background: #3498db; color: white; border: none; padding: 12px 24px; border-radius: 6px; cursor: pointer; font-size: 1rem; margin-right: 10px;">
            Accept P&L Mappings
          </button>
          <button id="skipMappings" style="background: #95a5a6; color: white; border: none; padding: 12px 24px; border-radius: 6px; cursor: pointer; font-size: 1rem;">
            Skip P&L Mapping
          </button>
        </div>
      </div>
    `;
    
    // Add event listeners
    document.getElementById('acceptMappings').addEventListener('click', () => {
      // Update mappings based on user changes
      mappingEntries.forEach(mapping => {
        const selectId = `mapping_${mapping.balanceSheetItem.replace(/[^a-zA-Z0-9]/g, '_')}`;
        const select = document.getElementById(selectId);
        if (select) {
          const newPnLDriver = select.value;
          if (newPnLDriver !== mapping.pnlDriver) {
            console.log(`User changed P&L mapping for "${mapping.balanceSheetItem}" from "${mapping.pnlDriver}" to "${newPnLDriver}"`);
            pnlMappings[mapping.balanceSheetItem].pnlDriver = newPnLDriver;
            pnlMappings[mapping.balanceSheetItem].confidence = 1.0; // User override = 100% confidence
            pnlMappings[mapping.balanceSheetItem].userOverride = true;
          }
        }
      });
      
      overlay.remove();
      console.log('Final P&L mappings:', pnlMappings);
      resolve();
    });
    
    document.getElementById('skipMappings').addEventListener('click', () => {
      pnlMappings = {}; // Clear mappings
      overlay.remove();
      console.log('User skipped P&L mapping');
      resolve();
    });
  });
}

/**
 * Chat functionality
 */
let chatHistory = [];

async function sendChatMessage() {
  const input = document.getElementById('chatInput');
  const sendBtn = document.getElementById('sendChatBtn');
  const messagesContainer = document.getElementById('chatMessages');
  
  if (!input || !sendBtn || !messagesContainer) return;
  
  const message = input.value.trim();
  if (!message) return;
  
  // Disable input while processing
  input.disabled = true;
  sendBtn.disabled = true;
  sendBtn.textContent = 'Sending...';
  
  // Add user message to chat
  addChatMessage('user', message);
  input.value = '';
  
  try {
    // Prepare financial data context
    const financialContext = prepareFinancialContext();
    
    console.log('Financial context being sent:', financialContext);
    console.log('Financial context JSON:', JSON.stringify(financialContext, null, 2));
    console.log('Has uploaded data:', Object.keys(uploadedLineItems).length > 0);
    console.log('Uploaded line items:', uploadedLineItems);
    
    // Call OpenAI API
    const response = await callOpenAI(message, financialContext);
    
    // Add assistant response
    addChatMessage('assistant', response);
    
  } catch (error) {
    console.error('Chat error:', error);
    addChatMessage('assistant', 'Sorry, I encountered an error processing your request. Please try again.');
  } finally {
    // Re-enable input
    input.disabled = false;
    sendBtn.disabled = false;
    sendBtn.textContent = 'Send';
  }
}

function addChatMessage(sender, content) {
  const messagesContainer = document.getElementById('chatMessages');
  if (!messagesContainer) return;
  
  const messageDiv = document.createElement('div');
  messageDiv.className = `chat-message ${sender}`;
  
  const contentDiv = document.createElement('div');
  contentDiv.className = 'message-content';
  contentDiv.textContent = content;
  
  messageDiv.appendChild(contentDiv);
  messagesContainer.appendChild(messageDiv);
  
  // Smooth scroll to bottom
  setTimeout(() => {
    messagesContainer.scrollTo({
      top: messagesContainer.scrollHeight,
      behavior: 'smooth'
    });
  }, 100);
  
  // Store in history
  chatHistory.push({ sender, content });
}

function prepareFinancialContext() {
  try {
    // Determine which tab is currently active
    const activeTab = getActiveTab();
    console.log('Active tab for chat analysis:', activeTab);
    
    const context = {
      statements: {},
      dateColumns: dateColumns || [],
      activeTab: activeTab,
      forecastSettings: {
        method: document.getElementById('forecastMethod')?.value || 'custom',
        growthRate: parseFloat(document.getElementById('customGrowthRate')?.value) || 5,
        periods: parseInt(document.getElementById('forecastPeriods')?.value) || 12,
        scurveMaxValue: parseFloat(document.getElementById('scurveMaxValue')?.value) || 0,
        scurveMidpoint: parseFloat(document.getElementById('scurveMidpoint')?.value) || 0,
        seasonalPattern: document.getElementById('seasonalPattern')?.value || 'none',
        seasonalStrength: parseFloat(document.getElementById('seasonalStrength')?.value) || 50
      }
    };
  
  // Extract data from forecast tables if they exist, otherwise use uploaded data
  ['pnl', 'balance', 'cashflow'].forEach(statementType => {
    const tableData = [];
    
    // Try to find the table in the currently active tab
    const activeTable = document.querySelector(`#${activeTab} .${statementType}-table tbody`) || 
                       document.querySelector(`#${activeTab} .${statementType}-table`);
    
    if (activeTable) {
      console.log(`Reading ${statementType} data from ${activeTab} forecast table`);
      const rows = activeTable.querySelectorAll('tr');
      
      rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length > 0) {
          const itemName = cells[0].textContent.trim();
          const values = Array.from(cells).slice(1).map(cell => {
            const text = cell.textContent.trim();
            // Parse numbers, handling currency symbols and commas
            const num = parseFloat(text.replace(/[$,]/g, ''));
            return isNaN(num) ? 0 : num;
          });
          
          if (itemName && values.length > 0) {
            // Create a mapping of dates to values for easier AI understanding
            const dateValueMap = {};
            context.dateColumns.forEach((date, index) => {
              if (values[index] !== undefined) {
                dateValueMap[date] = values[index];
              }
            });
            
            tableData.push({
              name: itemName,
              forecastValues: values,
              lastValue: values[values.length - 1] || 0,
              dateValues: dateValueMap
            });
          }
        }
      });
    } else {
      console.log(`No forecast table found for ${statementType}, using uploaded data`);
      // Use uploaded data with forecast calculations
      const lineItems = uploadedLineItems[statementType] || [];
      lineItems.forEach(item => {
        // Calculate forecast values using current settings
        const actualValues = item.actualValues || [];
        const lastActual = actualValues[actualValues.length - 1] || 0;
        const annualGrowthRate = context.forecastSettings.growthRate / 100;
        const monthlyGrowthRate = annualGrowthRate / 12;  // Convert annual to monthly
        const periods = context.forecastSettings.periods;
        
        // Forecast calculation based on method
        const forecastValues = [];
        const method = context.forecastSettings.method || 'custom';
        
        // Get seasonality settings
        const seasonalPattern = context.forecastSettings.seasonalPattern || 'none';
        const seasonalStrength = context.forecastSettings.seasonalStrength || 50;
        
        for (let i = 0; i < periods; i++) {
          let baseForecastValue;
          
          if (method === 'exponential') {
            // Exponential growth: Value = Previous × (1 + Monthly Rate)^periods
            baseForecastValue = lastActual * Math.pow(1 + monthlyGrowthRate, i + 1);
          } else if (method === 'logarithmic') {
            // Logarithmic growth: Value = Base × ln(periods + 1) × Monthly Rate
            baseForecastValue = lastActual * Math.log(i + 2) * monthlyGrowthRate;
          } else if (method === 'scurve') {
            // S-curve growth: Only apply to "Total Revenue" items
            const isTotalRevenue = /\btotal.*revenue\b/i.test(item.name);
            if (isTotalRevenue) {
              // S-curve growth: Value = Max × (1 / (1 + e^(-k × (periods - midpoint))))
              const maxValue = parseFloat(document.getElementById('scurveMaxValue')?.value) || (lastActual * Math.pow(1 + monthlyGrowthRate * 12, periods));
              const midpoint = parseFloat(document.getElementById('scurveMidpoint')?.value) || Math.round(periods * 0.4);
              const k = monthlyGrowthRate * 2; // Growth constant derived from growth rate
              const exponent = -k * ((i + 1) - midpoint);
              baseForecastValue = maxValue * (1 / (1 + Math.exp(exponent)));
            } else {
              // For non-total revenue items, use linear growth
              baseForecastValue = lastActual + (lastActual * monthlyGrowthRate * (i + 1));
            }
          } else if (method === 'rolling') {
            // Rolling average + growth: Historical Average + (Historical Average × Monthly Rate × Period)
            const historicalAverage = actualValues.reduce((sum, val) => sum + val, 0) / actualValues.length;
            baseForecastValue = historicalAverage + (historicalAverage * monthlyGrowthRate * (i + 1));
          } else if (method === 'custom') {
            // Linear growth: Value = Previous + (Previous × Monthly Rate × Period)
            baseForecastValue = lastActual + (lastActual * monthlyGrowthRate * (i + 1));
          } else {
            // Fallback to exponential
            baseForecastValue = lastActual * Math.pow(1 + monthlyGrowthRate, i + 1);
          }
          
          // Apply seasonality
          const forecastMonth = (i + 1) % 12; // Month index (0-11)
          const seasonalMultiplier = getSeasonalMultiplier(forecastMonth, seasonalPattern, seasonalStrength, activeTab);
          const forecastValue = baseForecastValue * seasonalMultiplier;
          
          forecastValues.push(forecastValue);
        }
        
        const allValues = [...actualValues, ...forecastValues];
        
        // Create date-value mapping for AI
        const dateValueMap = {};
        context.dateColumns.forEach((date, index) => {
          if (allValues[index] !== undefined) {
            dateValueMap[date] = allValues[index];
          }
        });
        
        tableData.push({
          name: item.name,
          forecastValues: allValues,
          lastValue: allValues[allValues.length - 1] || 0,
          dateValues: dateValueMap
        });
      });
    }
    
    context.statements[statementType] = tableData;
  });
  
  console.log('Prepared financial context from forecast data:', context);
  console.log('Statement types:', Object.keys(context.statements));
  console.log('P&L items:', context.statements.pnl?.length || 0);
  console.log('Balance items:', context.statements.balance?.length || 0);
  console.log('Cashflow items:', context.statements.cashflow?.length || 0);
  
  // Debug: Show actual data being sent
  console.log('Sample P&L data:', context.statements.pnl?.slice(0, 3));
  console.log('Date columns:', context.dateColumns);
  
  return context;
  } catch (error) {
    console.error('Error in prepareFinancialContext:', error);
    // Return minimal context to prevent complete failure
    return {
      statements: { pnl: [], balance: [], cashflow: [] },
      dateColumns: [],
      activeTab: 'monthly',
      forecastSettings: { 
        method: 'custom', 
        growthRate: 5, 
        periods: 12,
        scurveMaxValue: 0,
        scurveMidpoint: 0,
        seasonalPattern: 'none',
        seasonalStrength: 50
      }
    };
  }
}

function getActiveTab() {
  try {
    // Check which tab is currently active
    const tabs = ['monthly', 'quarterly', 'yearly', 'insights'];
    
    for (const tab of tabs) {
      const tabElement = document.querySelector(`#${tab}.tab-content.active`);
      if (tabElement) {
        console.log(`Found active tab: ${tab}`);
        return tab;
      }
    }
    
    // Fallback: check tab buttons
    const activeTabButton = document.querySelector('.tab.active');
    if (activeTabButton) {
      const tabId = activeTabButton.getAttribute('data-tab');
      console.log(`Found active tab from button: ${tabId}`);
      return tabId || 'monthly';
    }
    
    // Default to monthly if nothing found
    console.log('No active tab found, defaulting to monthly');
    return 'monthly';
  } catch (error) {
    console.error('Error in getActiveTab:', error);
    return 'monthly';
  }
}

async function callOpenAI(question, financialContext) {
  // Backend API endpoint - automatically detect if running locally or on Vercel
  const BACKEND_URL = window.location.hostname === 'localhost' 
    ? 'http://localhost:3001/api/chat'
    : `${window.location.origin}/api/chat`;
  
  console.log('Calling API at:', BACKEND_URL);
  console.log('Current location:', window.location.href);
  
  try {
    const response = await fetch(BACKEND_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: question,
        financialData: financialContext
      })
    });
    
    console.log('Response status:', response.status);
    console.log('Response ok:', response.ok);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      console.error('Backend error response:', errorData);
      throw new Error(`Backend API error: ${response.status} - ${errorData.details || errorData.error || 'Unknown error'}`);
    }

    const data = await response.json();
    
    if (data.success) {
      return data.response;
    } else {
      throw new Error(data.error || 'Unknown error');
    }
  } catch (error) {
    console.error('Error calling backend:', error);
    return 'Sorry, I encountered an error while processing your request. Please make sure the backend server is running and try again.';
  }
}

/**
 * Boot
 */
// Custom tooltip functionality
function initializeCustomTooltips() {
  document.addEventListener('mouseover', function(e) {
    if (e.target.classList.contains('mixed-period-indicator')) {
      showCustomTooltip(e.target);
    }
  });
  
  document.addEventListener('mouseout', function(e) {
    if (e.target.classList.contains('mixed-period-indicator')) {
      hideCustomTooltip();
    }
  });
}

function showCustomTooltip(element) {
  // Remove any existing tooltip
  hideCustomTooltip();
  
  const tooltipContent = element.getAttribute('data-tooltip');
  if (!tooltipContent) return;
  
  const tooltip = document.createElement('div');
  tooltip.className = 'custom-tooltip';
  tooltip.textContent = tooltipContent;
  
  document.body.appendChild(tooltip);
  
  // Position the tooltip
  const rect = element.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();
  
  tooltip.style.left = (rect.left + rect.width / 2 - tooltipRect.width / 2) + 'px';
  tooltip.style.top = (rect.bottom + 10) + 'px';
  
  // Show with animation
  setTimeout(() => {
    tooltip.classList.add('show');
  }, 10);
}

function hideCustomTooltip() {
  const existingTooltip = document.querySelector('.custom-tooltip');
  if (existingTooltip) {
    existingTooltip.remove();
  }
}

document.addEventListener('DOMContentLoaded', function () {
  console.log('DOM loaded, initializing...');
  console.log('JavaScript is running!');
  
  // Initialize custom tooltips
  initializeCustomTooltips();
  
  // Simple test - count all elements
  const allElements = document.querySelectorAll('*');
  console.log('Total elements on page:', allElements.length);
  
  // Test if we can find any elements
  const forecastBtn = document.getElementById('runForecastBtn');
  console.log('Forecast button found:', !!forecastBtn);
  
  // Test if we can find the containers
  const chatContainer = document.getElementById('chatMessages');
  const insightsContainer = document.getElementById('insightsContainer');
  console.log('Chat container found:', !!chatContainer);
  console.log('Insights container found:', !!insightsContainer);
  
  // Test if we can find the debug elements
  const debugElements = document.querySelectorAll('[style*="background: red"], [style*="background: blue"]');
  console.log('Debug elements found:', debugElements.length);
  
  // Test if we can find the controls containers
  const controlsContainers = document.querySelectorAll('.controls');
  console.log('Controls containers found:', controlsContainers.length);
  
  // List all control containers
  controlsContainers.forEach((container, index) => {
    const title = container.querySelector('h3');
    console.log(`Control container ${index}:`, title ? title.textContent : 'No title');
  });
  
  // Tabs
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', function() {
      const tabName = this.getAttribute('data-tab');
      console.log('Tab clicked:', tabName);
      showTab(tabName, this);
    });
  });

  // Controls
  const methodEl = document.getElementById('forecastMethod');
  const rateEl = document.getElementById('customGrowthRate');
  const periodsEl = document.getElementById('forecastPeriods');
  const runBtn = document.getElementById('runForecastBtn');

  // Method change handler
  methodEl?.addEventListener('change', function() {
    toggleGrowthRateInput();
  });

  // Periods change handler - always rebuild tables when periods change
  periodsEl?.addEventListener('change', function() {
    rebuildAllTables();
    updateForecast();
  });
  
  // Growth rate change handler - rebuild tables for updated forecasts
  const growthRateEl = document.getElementById('customGrowthRate');
  growthRateEl?.addEventListener('change', function() {
    rebuildAllTables();
    updateForecast();
  });

  // S-curve controls change handlers
  const scurveMaxValueEl = document.getElementById('scurveMaxValue');
  const scurveMidpointEl = document.getElementById('scurveMidpoint');
  
  scurveMaxValueEl?.addEventListener('change', function() {
    rebuildAllTables();
    updateForecast();
  });
  
  scurveMidpointEl?.addEventListener('change', function() {
    rebuildAllTables();
    updateForecast();
  });

  // Seasonality controls change handlers
  const seasonalPatternEl = document.getElementById('seasonalPattern');
  const seasonalStrengthEl = document.getElementById('seasonalStrength');
  const seasonalStrengthValueEl = document.getElementById('seasonalStrengthValue');
  const customSeasonalEl = document.getElementById('custom-seasonal');
  
  seasonalPatternEl?.addEventListener('change', function() {
    // Show/hide custom seasonal controls
    if (customSeasonalEl) {
      customSeasonalEl.style.display = this.value === 'custom' ? 'block' : 'none';
    }
    rebuildAllTables();
    updateForecast();
  });
  
  seasonalStrengthEl?.addEventListener('input', function() {
    if (seasonalStrengthValueEl) {
      seasonalStrengthValueEl.textContent = this.value + '%';
    }
    rebuildAllTables();
    updateForecast();
  });
  
  // Custom seasonal multiplier change handlers
  const seasonalInputs = ['jan-mult', 'feb-mult', 'mar-mult', 'apr-mult', 'may-mult', 'jun-mult', 
                         'jul-mult', 'aug-mult', 'sep-mult', 'oct-mult', 'nov-mult', 'dec-mult'];
  seasonalInputs.forEach(id => {
    const input = document.getElementById(id);
    input?.addEventListener('change', function() {
      rebuildAllTables();
      updateForecast();
    });
  });

  // Forecast method help modal handlers
  const helpButton = document.getElementById('forecastMethodHelp');
  const modal = document.getElementById('forecastMethodModal');
  const closeModal = document.getElementById('closeModal');

  helpButton?.addEventListener('click', function() {
    modal.style.display = 'block';
  });

  closeModal?.addEventListener('click', function() {
    modal.style.display = 'none';
  });

  // Close modal when clicking outside of it
  window.addEventListener('click', function(event) {
    if (event.target === modal) {
      modal.style.display = 'none';
    }
  });

  // Seasonal pattern help modal handlers
  const seasonalHelpButton = document.getElementById('seasonalPatternHelp');
  const seasonalModal = document.getElementById('seasonalPatternModal');
  const closeSeasonalModal = document.getElementById('closeSeasonalModal');

  seasonalHelpButton?.addEventListener('click', function() {
    seasonalModal.style.display = 'block';
  });

  closeSeasonalModal?.addEventListener('click', function() {
    seasonalModal.style.display = 'none';
  });

  // Close seasonal modal when clicking outside of it
  window.addEventListener('click', function(event) {
    if (event.target === seasonalModal) {
      seasonalModal.style.display = 'none';
    }
  });

  // Run forecast button
  runBtn?.addEventListener('click', function() {
    console.log('Run Forecast clicked');
    updateForecast();
  });

  // Upload
  const fileEl = document.getElementById('actualsFile');
  fileEl?.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) {
      console.log('File uploaded:', file.name);
      handleActualsUpload(file);
    }
  });

  // Initial setup
  toggleGrowthRateInput();
  // If no uploaded data, seed defaults so UI is populated
  if (!hasUploadedData) {
    dateColumns = initializeDefaultDateColumns(6);
    uploadedLineItems = buildDefaultSampleData();
  }
  // Force monthly tab active by default
  showTab('monthly', document.querySelector('.tabs .tab[data-tab="monthly"]'));
  rebuildAllTables();
  updateForecast();
  
  // Enhance horizontal scrolling with mouse wheel
  document.addEventListener('wheel', function(e) {
    const container = e.target && (e.target.closest && e.target.closest('.table-container'));
    if (container && container.scrollWidth > container.clientWidth) {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        container.scrollLeft += e.deltaY;
        e.preventDefault();
      }
    }
  }, { passive: false });
  
  console.log('Initialization complete');
  
  // Delegate manual subheader toggle
  document.body.addEventListener('change', function(e) {
    const target = e.target;
    if (target && target.classList && target.classList.contains('toggle-subheader')) {
      const statement = target.getAttribute('data-statement');
      const name = target.getAttribute('data-name');
      setSubheaderOverride(statement, name, target.checked);
      rebuildAllTables();
      updateForecast();
    }
  });
  
  // Chat functionality
  const chatInput = document.getElementById('chatInput');
  const sendChatBtn = document.getElementById('sendChatBtn');
  
  if (sendChatBtn) {
    sendChatBtn.addEventListener('click', sendChatMessage);
  }
  
  if (chatInput) {
    chatInput.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') {
        sendChatMessage();
      }
    });
  }
  
  // Insights functionality
  const refreshInsightsBtn = document.getElementById('refreshInsightsBtn');
  if (refreshInsightsBtn) {
    refreshInsightsBtn.addEventListener('click', calculateInsights);
  }
  
  // Individual anomaly threshold change handlers
  ['monthly', 'quarterly', 'yearly'].forEach(periodType => {
    const thresholdInput = document.getElementById(`${periodType}AnomalyThreshold`);
    if (thresholdInput) {
      thresholdInput.addEventListener('change', () => {
        // Only recalculate anomalies for this specific period
        const anomalousItems = calculateAnomalousItemsForPeriod(periodType);
        displayAnomalousItemsForPeriod(periodType, anomalousItems);
      });
    }
  });
  
  // Calculate initial insights
  setTimeout(() => {
    console.log('Attempting to calculate insights...');
    const chatContainer = document.getElementById('chatMessages');
    const insightsContainer = document.getElementById('insightsContainer');
    console.log('Chat container found:', !!chatContainer);
    console.log('Insights container found:', !!insightsContainer);
    
    // Test if we can find the debug elements
    const debugElements = document.querySelectorAll('[style*="background: red"], [style*="background: blue"]');
    console.log('Debug elements found:', debugElements.length);
    
    // Test if we can find the controls containers
    const controlsContainers = document.querySelectorAll('.controls');
    console.log('Controls containers found:', controlsContainers.length);
    
    calculateInsights();
  }, 1000);
});
