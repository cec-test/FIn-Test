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
  // Update P&L and Cash Flow using existing logic
  ['pnl', 'cashflow'].forEach(statementType => {
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
  
  // Update Balance Sheet using smart calculation engine
  updateBalanceSheetForecasts(periods);
  
  // Update Cash Flow statement
  updateCashFlowForecasts(periods);
}

/**
 * Update Balance Sheet forecasts using the calculation engine
 */
function updateBalanceSheetForecasts(periods) {
  // Only use balance sheet engine if we have classifications and mappings
  if (Object.keys(balanceSheetClassifications).length === 0) {
    console.log('No balance sheet classifications available, skipping smart forecasting');
    return;
  }
  
  console.log('Updating balance sheet forecasts using calculation engine...');
  
  // Create calculation engine with hierarchy
  const engine = new BalanceSheetCalculationEngine(
    pnlMappings,
    balanceSheetClassifications, 
    balanceSheetAssumptions,
    balanceSheetHierarchy
  );
  
  // Track previous values for period-to-period calculations
  // Seed with last actual values from uploaded data
  const previousValues = getLastActualBalanceSheet();
  
  // Generate forecasts for each period
  for (let i = 0; i < periods; i++) {
    // Get P&L forecast data for this period
    const pnlForecastData = getPnLForecastDataForPeriod(i);
    
    // Calculate balance sheet values for this period
    const balanceSheetResults = engine.calculateForecastedValues(i, pnlForecastData, previousValues);
    
    // Update the UI with calculated values
    Object.keys(balanceSheetResults).forEach(itemName => {
      const result = balanceSheetResults[itemName];
      const safeName = itemName.toLowerCase().replace(/\s+/g, '');
      
      // Update monthly, quarterly, yearly views
      ['monthly', 'quarterly', 'yearly'].forEach(periodType => {
        const forecastKey = `${periodType}-balance-${safeName}-${i}`;
        document.querySelectorAll(`[data-forecast-key="${forecastKey}"]`).forEach(cell => {
          if (result.method === 'not_forecasted') {
            // Subheaders and totals show empty
            updateElement(cell.id, '');
          } else {
            updateElement(cell.id, formatCurrency(result.value, !hasUploadedData));
            // Add tooltip with calculation details
            cell.title = `${result.method}: ${result.note}`;
          }
        });
      });
      
      // Store for next period calculations
      previousValues[itemName] = result;
    });
  }
  
  console.log('Balance sheet forecasts updated successfully');
}

/**
 * Initialize cash flow statement structure
 */
function initializeCashFlowStructure() {
  // Create standard cash flow line items if not already in uploadedLineItems
  if (!uploadedLineItems.cashflow || uploadedLineItems.cashflow.length === 0) {
    console.log('💰 Initializing cash flow statement structure...');
    
    uploadedLineItems.cashflow = [
      // Operating Activities
      { name: 'OPERATING ACTIVITIES', actualValues: [], isSubheader: true },
      { name: 'Net Income', actualValues: [] },
      { name: 'Depreciation & Amortization', actualValues: [] },
      { name: 'Increase in Accounts Receivable', actualValues: [] },
      { name: 'Increase in Inventory', actualValues: [] },
      { name: 'Increase in Accounts Payable', actualValues: [] },
      { name: 'Increase in Accrued Expenses', actualValues: [] },
      { name: 'Increase in Prepaid Expenses', actualValues: [] },
      { name: 'Increase in Deferred Revenue', actualValues: [] },
      { name: 'Cash from Operating Activities', actualValues: [], isTotal: true },
      
      // Investing Activities
      { name: 'INVESTING ACTIVITIES', actualValues: [], isSubheader: true },
      { name: 'Capital Expenditures', actualValues: [] },
      { name: 'Cash from Investing Activities', actualValues: [], isTotal: true },
      
      // Financing Activities
      { name: 'FINANCING ACTIVITIES', actualValues: [], isSubheader: true },
      { name: 'Dividends Paid', actualValues: [] },
      { name: 'Proceeds from Debt Issuance', actualValues: [] },
      { name: 'Debt Repayments', actualValues: [] },
      { name: 'Proceeds from Stock Issuance', actualValues: [] },
      { name: 'Cash from Financing Activities', actualValues: [], isTotal: true },
      
      // Reconciliation
      { name: 'Net Change in Cash', actualValues: [], isTotal: true },
      { name: 'Beginning Cash', actualValues: [] },
      { name: 'Ending Cash', actualValues: [], isTotal: true }
    ];
    
    console.log('✅ Cash flow structure initialized with standard line items');
  }
}

/**
 * Update Cash Flow forecasts using the calculation engine
 */
function updateCashFlowForecasts(periods) {
  // Check if we have required data
  if (Object.keys(balanceSheetClassifications).length === 0) {
    console.log('No balance sheet data available, skipping cash flow forecasting');
    return;
  }
  
  // Initialize cash flow structure if needed
  initializeCashFlowStructure();
  
  console.log('💰 Updating cash flow forecasts using calculation engine...');
  
  // Detect critical items for cash flow
  const criticalBS = detectCriticalBalanceSheetItems(uploadedLineItems.balance || []);
  const criticalPnL = detectCriticalPnLItems(uploadedLineItems.pnl || []);
  const criticalItems = { ...criticalBS, ...criticalPnL };
  
  // Track balance sheet values for period-to-period comparison
  const balanceSheetByPeriod = [];
  
  // First, we need to get balance sheet values for each period
  // (these were calculated in updateBalanceSheetForecasts)
  for (let i = 0; i < periods; i++) {
    const periodBS = {};
    
    Object.keys(balanceSheetClassifications).forEach(itemName => {
      const safeName = itemName.toLowerCase().replace(/\s+/g, '');
      const forecastKey = `monthly-balance-${safeName}-${i}`;
      const cell = document.querySelector(`[data-forecast-key="${forecastKey}"]`);
      
      if (cell) {
        // Extract value from cell (parse currency)
        const cellText = cell.textContent;
        const value = parseCurrencyToNumber(cellText);
        periodBS[itemName] = { value };
      }
    });
    
    balanceSheetByPeriod.push(periodBS);
  }
  
  // Generate cash flow for each period
  for (let i = 0; i < periods; i++) {
    // Get P&L forecast data
    const pnlForecastData = getPnLForecastDataForPeriod(i);
    
    // Get current and previous balance sheet
    const bsCurrent = balanceSheetByPeriod[i] || {};
    const bsPrevious = i > 0 ? balanceSheetByPeriod[i - 1] : getLastActualBalanceSheet();
    
    // Create cash flow engine
    const cfEngine = new CashFlowCalculationEngine(
      pnlForecastData,
      bsCurrent,
      bsPrevious,
      criticalItems,
      balanceSheetAssumptions
    );
    
    // Calculate cash flow
    const cashFlowResults = cfEngine.calculateCashFlow(i);
    
    // Update UI with cash flow values
    updateCashFlowUI(cashFlowResults, i);
    
    // Store for reference
    cashFlowForecasts.monthly[i] = cashFlowResults;
  }
  
  console.log('✅ Cash flow forecasts updated successfully');
}

/**
 * Get last actual balance sheet values (for period 0 previous comparison)
 */
function getLastActualBalanceSheet() {
  const lastActual = {};
  
  if (!uploadedLineItems.balance) return lastActual;
  
  uploadedLineItems.balance.forEach(item => {
    if (item.actualValues && item.actualValues.length > 0) {
      // Get last non-null actual value
      const lastValue = lastNonNull(item.actualValues);
      if (lastValue !== null) {
        lastActual[item.name] = { value: lastValue };
      }
    }
  });
  
  return lastActual;
}

/**
 * Update cash flow UI with calculated values
 */
function updateCashFlowUI(cashFlowResults, periodIndex) {
  console.log(`Updating Cash Flow UI for period ${periodIndex}...`);
  
  // Build structured cash flow line items for display
  const allLineItems = buildCashFlowLineItems(cashFlowResults);
  
  // Update each line item in the UI
  allLineItems.forEach(lineItem => {
    const safeName = lineItem.name.toLowerCase().replace(/\s+/g, '');
    
    ['monthly', 'quarterly', 'yearly'].forEach(periodType => {
      const forecastKey = `${periodType}-cashflow-${safeName}-${periodIndex}`;
      const cells = document.querySelectorAll(`[data-forecast-key="${forecastKey}"]`);
      
      cells.forEach(cell => {
        updateElement(cell.id, formatCurrency(lineItem.value, false));
        if (lineItem.note) {
          cell.title = lineItem.note;
        }
      });
    });
  });
  
  console.log(`✅ Cash Flow UI updated for period ${periodIndex}`);
}

/**
 * Build structured line items for cash flow display
 */
function buildCashFlowLineItems(cashFlowResults) {
  const lineItems = [];
  
  // OPERATING ACTIVITIES SECTION
  lineItems.push({
    name: 'OPERATING ACTIVITIES',
    value: 0,
    isSubheader: true,
    note: ''
  });
  
  // Add all operating activity line items
  cashFlowResults.operating.lineItems.forEach(item => {
    lineItems.push(item);
  });
  
  // Operating subtotal
  lineItems.push({
    name: 'Cash from Operating Activities',
    value: cashFlowResults.operating.total,
    isTotal: true,
    note: 'Total operating cash flow'
  });
  
  // INVESTING ACTIVITIES SECTION
  lineItems.push({
    name: 'INVESTING ACTIVITIES',
    value: 0,
    isSubheader: true,
    note: ''
  });
  
  // Add all investing activity line items
  cashFlowResults.investing.lineItems.forEach(item => {
    lineItems.push(item);
  });
  
  // Investing subtotal
  lineItems.push({
    name: 'Cash from Investing Activities',
    value: cashFlowResults.investing.total,
    isTotal: true,
    note: 'Total investing cash flow'
  });
  
  // FINANCING ACTIVITIES SECTION
  lineItems.push({
    name: 'FINANCING ACTIVITIES',
    value: 0,
    isSubheader: true,
    note: ''
  });
  
  // Add all financing activity line items
  cashFlowResults.financing.lineItems.forEach(item => {
    lineItems.push(item);
  });
  
  // Financing subtotal
  lineItems.push({
    name: 'Cash from Financing Activities',
    value: cashFlowResults.financing.total,
    isTotal: true,
    note: 'Total financing cash flow'
  });
  
  // NET CHANGE AND RECONCILIATION
  lineItems.push({
    name: 'Net Change in Cash',
    value: cashFlowResults.netChange,
    isTotal: true,
    note: 'Operating + Investing + Financing'
  });
  
  lineItems.push({
    name: 'Beginning Cash',
    value: cashFlowResults.beginningCash,
    note: 'Cash at start of period'
  });
  
  lineItems.push({
    name: 'Ending Cash',
    value: cashFlowResults.endingCash,
    isTotal: true,
    note: cashFlowResults.reconciles ? '✅ Ties to Balance Sheet' : `⚠️ Difference: $${cashFlowResults.reconciliationDifference.toLocaleString()}`
  });
  
  return lineItems;
}

/**
 * Helper: Parse currency string to number
 */
function parseCurrencyToNumber(str) {
  if (!str || str === '' || str === '-') return 0;
  
  // Remove currency symbols, commas, spaces
  const cleaned = str.replace(/[$,\s]/g, '');
  
  // Handle parentheses for negative numbers
  if (cleaned.includes('(') && cleaned.includes(')')) {
    return -parseFloat(cleaned.replace(/[()]/g, '')) || 0;
  }
  
  return parseFloat(cleaned) || 0;
}

/**
 * Get P&L forecast data for a specific period
 */
function getPnLForecastDataForPeriod(periodIndex) {
  const pnlData = {};
  
  // Extract P&L values from the current forecast tables
  const pnlItems = uploadedLineItems.pnl || [];
  
  pnlItems.forEach(item => {
    if (!item.actualValues || item.actualValues.length === 0) return;
    
    // Get forecasted values using existing P&L logic
    const forecastValues = getForecastValuesForItem(item, periodIndex + 1);
    if (forecastValues && forecastValues.length > periodIndex) {
      pnlData[item.name] = forecastValues[periodIndex];
    }
  });
  
  console.log(`P&L forecast data for period ${periodIndex}:`, pnlData);
  return pnlData;
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
      console.log('📁 Parsing CSV...');
      const data = parseCSVToObject(reader.result);
      console.log('Parsed data:', data);
      
      // Determine optimal forecasting strategy
      const strategyResult = determineForecastingStrategy(data);
      console.log(`🎯 Strategy selected: ${strategyResult.forecastingStrategy}`);
      console.log(`   ${strategyResult.description}`);
      
      // Process based on strategy
      if (strategyResult.forecastingStrategy === 'integrated_pnl_bs') {
        console.log('🔗 Full integration mode: Using P&L-driven formulas');
        await processIntegratedForecasting(data);
      } else if (strategyResult.forecastingStrategy === 'balance_sheet_only') {
        console.log('📊 Balance sheet only mode: Using growth patterns');
        await processBalanceSheetOnly(data);
      } else if (strategyResult.forecastingStrategy === 'pnl_only') {
        console.log('💼 P&L only mode');
        applyActualsFromObject(data);
      } else {
        console.warn('⚠️ No valid data found');
        console.error('Strategy result:', strategyResult);
        alert('Please upload a valid financial statement CSV file');
        return;
      }
      
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
 * Storage for balance sheet hierarchy (intelligent totals structure)
 */
let balanceSheetHierarchy = null;

/**
 * Storage for P&L to Balance Sheet mappings
 */
let pnlMappings = {};

/**
 * Storage for available data context
 */
let availableDataContext = {
  hasPnL: false,
  hasBalanceSheet: false,
  hasCashFlow: false,
  forecastingStrategy: 'unknown'
};

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
 * Auto-detect special balance sheet item types with enhanced intelligence
 */
function autoDetectSpecialTypes(balanceSheetItems) {
  return balanceSheetItems.map((item, index) => {
    const name = item.name.toLowerCase();
    const hasValues = item.actualValues && item.actualValues.some(val => val !== null && val !== undefined && val !== '');
    
    // Enhanced total detection patterns
    const totalPatterns = [
      /\btotal\b/i,
      /\bsum\b/i,
      /\bsubtotal\b/i,
      /\bgrand total\b/i,
      /^total\s+/i
    ];
    const isTotal = totalPatterns.some(pattern => pattern.test(item.name));
    
    // Auto-detect subheaders (no values or all blank, and not a total)
    const isSubheader = !hasValues && !isTotal;
    
    // Store original position for hierarchy building
    return {
      ...item,
      autoDetectedType: isTotal ? 'calculated_total' : isSubheader ? 'subheader' : 'line_item',
      hasValues: hasValues,
      originalIndex: index
    };
  });
}

/**
 * Build intelligent hierarchy tree from balance sheet structure
 * This is the MAGIC that makes the system truly intelligent
 */
function buildBalanceSheetHierarchy(balanceSheetItems) {
  console.log('🧠 Building intelligent balance sheet hierarchy...');
  
  const hierarchy = {
    items: [],
    totals: {},
    tree: {},
    relationships: []
  };
  
  // Step 1: Identify all items with their types
  const processedItems = autoDetectSpecialTypes(balanceSheetItems);
  
  // Step 2: Separate totals from detail items
  const totals = processedItems.filter(item => item.autoDetectedType === 'calculated_total');
  const details = processedItems.filter(item => item.autoDetectedType === 'line_item');
  const subheaders = processedItems.filter(item => item.autoDetectedType === 'subheader');
  
  console.log(`Found ${totals.length} totals, ${details.length} detail items, ${subheaders.length} subheaders`);
  
  // Step 3: For each total, find its children (items that should sum to it)
  totals.forEach(total => {
    const children = findChildrenForTotal(total, processedItems);
    
    // Validate: do children sum to total? (from actuals)
    const validation = validateTotalCalculation(total, children);
    
    hierarchy.totals[total.name] = {
      name: total.name,
      index: total.originalIndex,
      children: children.map(child => child.name),
      childrenDetails: children,
      validated: validation.isValid,
      expectedValue: validation.expectedValue,
      actualValue: validation.actualValue,
      confidence: validation.confidence
    };
    
    console.log(`Total "${total.name}": ${children.length} children, validated: ${validation.isValid}, confidence: ${validation.confidence}`);
  });
  
  // Step 4: Build tree structure (nested totals)
  hierarchy.tree = buildNestedTree(processedItems, hierarchy.totals);
  
  // Step 5: Store all items for reference
  hierarchy.items = processedItems;
  
  console.log('✅ Hierarchy built successfully:', hierarchy);
  return hierarchy;
}

/**
 * Find children for a total line by analyzing position and relationships
 */
function findChildrenForTotal(total, allItems) {
  const totalIndex = total.originalIndex;
  const children = [];
  
  // Strategy: Find all detail items between this total and the previous total (or start of section)
  let startIndex = 0;
  
  // Find the previous total or subheader
  for (let i = totalIndex - 1; i >= 0; i--) {
    const item = allItems[i];
    if (item.autoDetectedType === 'calculated_total' || item.autoDetectedType === 'subheader') {
      startIndex = i + 1;
      break;
    }
  }
  
  // Collect all line items and nested totals between start and this total
  for (let i = startIndex; i < totalIndex; i++) {
    const item = allItems[i];
    if (item.autoDetectedType === 'line_item' || item.autoDetectedType === 'calculated_total') {
      children.push(item);
    }
  }
  
  return children;
}

/**
 * Validate that a total equals the sum of its children (using actuals)
 */
function validateTotalCalculation(total, children) {
  // Get the first actual value from total
  const totalValue = total.actualValues && total.actualValues.find(v => v !== null && v !== undefined && v !== '');
  
  if (totalValue === null || totalValue === undefined || totalValue === '') {
    return {
      isValid: false,
      expectedValue: null,
      actualValue: null,
      confidence: 0
    };
  }
  
  // Sum children's first actual values
  let childrenSum = 0;
  let validChildren = 0;
  
  children.forEach(child => {
    const childValue = child.actualValues && child.actualValues.find(v => v !== null && v !== undefined && v !== '');
    if (childValue !== null && childValue !== undefined && childValue !== '') {
      childrenSum += parseFloat(childValue) || 0;
      validChildren++;
    }
  });
  
  const totalValueNum = parseFloat(totalValue) || 0;
  const difference = Math.abs(totalValueNum - childrenSum);
  const percentDiff = totalValueNum !== 0 ? (difference / Math.abs(totalValueNum)) * 100 : 0;
  
  // Validation thresholds
  const isValid = percentDiff < 5; // Within 5% is considered valid
  const confidence = Math.max(0, Math.min(1, 1 - (percentDiff / 100)));
  
  return {
    isValid,
    expectedValue: childrenSum,
    actualValue: totalValueNum,
    difference,
    percentDiff,
    confidence,
    validChildren
  };
}

/**
 * Build nested tree structure for multi-level totals
 */
function buildNestedTree(items, totalsMap) {
  const tree = {};
  
  // Find grand totals (totals that aren't children of other totals)
  const grandTotals = Object.keys(totalsMap).filter(totalName => {
    const total = totalsMap[totalName];
    // Check if this total appears as a child of another total
    const isChild = Object.values(totalsMap).some(otherTotal => 
      otherTotal.name !== totalName && otherTotal.children.includes(totalName)
    );
    return !isChild;
  });
  
  console.log('Grand totals (top-level):', grandTotals);
  
  // Build tree recursively for each grand total
  grandTotals.forEach(grandTotalName => {
    tree[grandTotalName] = buildTreeNode(grandTotalName, totalsMap);
  });
  
  return tree;
}

/**
 * Recursively build a tree node
 */
function buildTreeNode(totalName, totalsMap) {
  const total = totalsMap[totalName];
  if (!total) return null;
  
  const node = {
    name: totalName,
    children: []
  };
  
  // Process each child
  total.children.forEach(childName => {
    if (totalsMap[childName]) {
      // Child is also a total - recurse
      node.children.push(buildTreeNode(childName, totalsMap));
    } else {
      // Child is a detail item - add as leaf
      node.children.push({ name: childName, isLeaf: true });
    }
  });
  
  return node;
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
 * Process integrated P&L + Balance Sheet forecasting (Full Power Mode)
 */
async function processIntegratedForecasting(data) {
  console.log('🔗 Processing integrated P&L + Balance Sheet forecasting...');
  
  // Detect critical items using pattern matching (NO AI needed for most cases)
  const criticalBS = detectCriticalBalanceSheetItems(data.balance || []);
  const criticalPnL = detectCriticalPnLItems(data.pnl || []);
  
  // Auto-create simplified classifications for critical items only
  balanceSheetClassifications = createSimplifiedClassifications(criticalBS, data.balance || []);
  
  // Auto-create mappings between critical BS and P&L items
  const autoMappings = createAutomaticMappings(criticalBS, criticalPnL);
  
  // Show simplified confirmation UI for mappings
  await showMappingConfirmation(autoMappings, criticalBS, criticalPnL, data);
  
  // Build hierarchy for totals
  balanceSheetHierarchy = buildBalanceSheetHierarchy(data.balance || []);
  
  // Apply actuals and we're done!
  applyActualsFromObject(data);
  
  console.log('✅ Integrated forecasting ready - using P&L-driven formulas for critical items');
}

/**
 * Process balance sheet only forecasting (Growth Rate Mode)
 */
async function processBalanceSheetOnly(data) {
  console.log('📊 Processing balance sheet only forecasting...');
  
  // Detect critical items (still useful for special handling)
  const criticalBS = detectCriticalBalanceSheetItems(data.balance || []);
  
  // Create growth-based classifications (no P&L needed)
  balanceSheetClassifications = createGrowthBasedClassifications(criticalBS, data.balance || []);
  
  // No P&L mappings needed
  pnlMappings = {};
  
  // Build hierarchy for totals
  balanceSheetHierarchy = buildBalanceSheetHierarchy(data.balance || []);
  
  // Apply actuals
  applyActualsFromObject(data);
  
  console.log('✅ Balance sheet forecasting ready - using historical growth patterns');
}

/**
 * Create simplified classifications for critical items + growth for others
 */
function createSimplifiedClassifications(criticalBS, allBalanceSheetItems) {
  console.log('🎯 Creating simplified classifications...');
  
  const classifications = {};
  
  allBalanceSheetItems.forEach(item => {
    const itemName = item.name;
    
    // Check if this is a critical item
    if (criticalBS.cash && criticalBS.cash.name === itemName) {
      classifications[itemName] = {
        originalName: itemName,
        category: 'cash',
        method: 'balancing_plug',
        confidence: 0.95,
        autoDetected: true
      };
    } else if (criticalBS.accountsReceivable && criticalBS.accountsReceivable.name === itemName) {
      classifications[itemName] = {
        originalName: itemName,
        category: 'accounts_receivable',
        method: 'days_sales_outstanding',
        confidence: 0.95,
        autoDetected: true
      };
    } else if (criticalBS.inventory && criticalBS.inventory.name === itemName) {
      classifications[itemName] = {
        originalName: itemName,
        category: 'inventory',
        method: 'days_inventory_outstanding',
        confidence: 0.95,
        autoDetected: true
      };
    } else if (criticalBS.accountsPayable && criticalBS.accountsPayable.name === itemName) {
      classifications[itemName] = {
        originalName: itemName,
        category: 'accounts_payable',
        method: 'days_payable_outstanding',
        confidence: 0.95,
        autoDetected: true
      };
    } else if (criticalBS.retainedEarnings && criticalBS.retainedEarnings.name === itemName) {
      classifications[itemName] = {
        originalName: itemName,
        category: 'retained_earnings',
        method: 'accumulated_earnings',
        confidence: 0.95,
        autoDetected: true
      };
    } else if (criticalBS.ppe && criticalBS.ppe.name === itemName) {
      classifications[itemName] = {
        originalName: itemName,
        category: 'property_plant_equipment',
        method: 'capex_depreciation',
        confidence: 0.95,
        autoDetected: true
      };
    } else if (criticalBS.commonStock && criticalBS.commonStock.name === itemName) {
      classifications[itemName] = {
        originalName: itemName,
        category: 'common_stock',
        method: 'static_value',
        confidence: 0.95,
        autoDetected: true
      };
    } else if (item.autoDetectedType === 'calculated_total') {
      // Total lines
      classifications[itemName] = {
        originalName: itemName,
        category: 'calculated_total',
        method: 'hierarchical_sum',
        confidence: 1.0,
        autoDetected: true
      };
    } else if (item.autoDetectedType === 'subheader') {
      // Subheaders
      classifications[itemName] = {
        originalName: itemName,
        category: 'subheader',
        method: 'none',
        confidence: 1.0,
        autoDetected: true
      };
    } else {
      // Everything else: use growth rate
      classifications[itemName] = {
        originalName: itemName,
        category: 'other_asset_or_liability',
        method: 'growth_rate',
        confidence: 0.7,
        autoDetected: true,
        note: 'Using historical growth rate'
      };
    }
  });
  
  console.log(`✅ Created ${Object.keys(classifications).length} classifications`);
  console.log(`   Critical items: ${Object.keys(criticalBS).filter(k => criticalBS[k] && k !== 'otherItems').length}`);
  console.log(`   Other items (growth rate): ${criticalBS.otherItems.length}`);
  
  return classifications;
}

/**
 * Create growth-based classifications (for balance sheet only mode)
 */
function createGrowthBasedClassifications(criticalBS, allBalanceSheetItems) {
  console.log('📈 Creating growth-based classifications...');
  
  const classifications = {};
  
  allBalanceSheetItems.forEach(item => {
    const itemName = item.name;
    
    // Critical items get special handling even without P&L
    if (criticalBS.cash && criticalBS.cash.name === itemName) {
      classifications[itemName] = {
        originalName: itemName,
        category: 'cash',
        method: 'balancing_plug',
        confidence: 0.95,
        autoDetected: true
      };
    } else if (criticalBS.retainedEarnings && criticalBS.retainedEarnings.name === itemName) {
      classifications[itemName] = {
        originalName: itemName,
        category: 'retained_earnings',
        method: 'growth_rate', // Without P&L, just grow it
        confidence: 0.95,
        autoDetected: true
      };
    } else if (criticalBS.commonStock && criticalBS.commonStock.name === itemName) {
      classifications[itemName] = {
        originalName: itemName,
        category: 'common_stock',
        method: 'static_value',
        confidence: 0.95,
        autoDetected: true
      };
    } else if (item.autoDetectedType === 'calculated_total') {
      classifications[itemName] = {
        originalName: itemName,
        category: 'calculated_total',
        method: 'hierarchical_sum',
        confidence: 1.0,
        autoDetected: true
      };
    } else if (item.autoDetectedType === 'subheader') {
      classifications[itemName] = {
        originalName: itemName,
        category: 'subheader',
        method: 'none',
        confidence: 1.0,
        autoDetected: true
      };
    } else {
      // Everything else: use growth rate based on historical data
      classifications[itemName] = {
        originalName: itemName,
        category: 'other_asset_or_liability',
        method: 'growth_rate',
        confidence: 0.8,
        autoDetected: true,
        note: 'Using historical growth pattern'
      };
    }
  });
  
  console.log(`✅ Created ${Object.keys(classifications).length} growth-based classifications`);
  
  return classifications;
}

/**
 * Create automatic mappings between critical BS and P&L items
 */
function createAutomaticMappings(criticalBS, criticalPnL) {
  console.log('🔗 Creating automatic P&L mappings...');
  
  const mappings = {};
  
  // AR → Revenue
  if (criticalBS.accountsReceivable && criticalPnL.revenue) {
    mappings[criticalBS.accountsReceivable.name] = {
      balanceSheetItem: criticalBS.accountsReceivable.name,
      balanceSheetCategory: 'accounts_receivable',
      pnlDriver: criticalPnL.revenue.name,
      confidence: 0.95,
      method: 'days_sales_outstanding',
      autoMapped: true
    };
    console.log(`✅ Auto-mapped: ${criticalBS.accountsReceivable.name} → ${criticalPnL.revenue.name}`);
  }
  
  // Inventory → COGS
  if (criticalBS.inventory && criticalPnL.cogs) {
    mappings[criticalBS.inventory.name] = {
      balanceSheetItem: criticalBS.inventory.name,
      balanceSheetCategory: 'inventory',
      pnlDriver: criticalPnL.cogs.name,
      confidence: 0.95,
      method: 'days_inventory_outstanding',
      autoMapped: true
    };
    console.log(`✅ Auto-mapped: ${criticalBS.inventory.name} → ${criticalPnL.cogs.name}`);
  }
  
  // AP → Operating Expenses
  if (criticalBS.accountsPayable && criticalPnL.operatingExpenses) {
    mappings[criticalBS.accountsPayable.name] = {
      balanceSheetItem: criticalBS.accountsPayable.name,
      balanceSheetCategory: 'accounts_payable',
      pnlDriver: criticalPnL.operatingExpenses.name,
      confidence: 0.95,
      method: 'days_payable_outstanding',
      autoMapped: true
    };
    console.log(`✅ Auto-mapped: ${criticalBS.accountsPayable.name} → ${criticalPnL.operatingExpenses.name}`);
  }
  
  // Retained Earnings → Net Income
  if (criticalBS.retainedEarnings && criticalPnL.netIncome) {
    mappings[criticalBS.retainedEarnings.name] = {
      balanceSheetItem: criticalBS.retainedEarnings.name,
      balanceSheetCategory: 'retained_earnings',
      pnlDriver: criticalPnL.netIncome.name,
      confidence: 0.95,
      method: 'accumulated_earnings',
      autoMapped: true
    };
    console.log(`✅ Auto-mapped: ${criticalBS.retainedEarnings.name} → ${criticalPnL.netIncome.name}`);
  }
  
  // PPE → Revenue (for CapEx) + Depreciation
  if (criticalBS.ppe) {
    mappings[criticalBS.ppe.name] = {
      balanceSheetItem: criticalBS.ppe.name,
      balanceSheetCategory: 'property_plant_equipment',
      pnlDriver: criticalPnL.revenue?.name || 'revenue',
      pnlDriverDepreciation: criticalPnL.depreciation?.name || null,
      confidence: 0.9,
      method: 'capex_depreciation',
      autoMapped: true
    };
    console.log(`✅ Auto-mapped: ${criticalBS.ppe.name} → Revenue (CapEx) + Depreciation`);
  }
  
  console.log(`✅ Created ${Object.keys(mappings).length} automatic mappings`);
  
  return mappings;
}

/**
 * Show simplified mapping confirmation UI
 */
async function showMappingConfirmation(autoMappings, criticalBS, criticalPnL, data) {
  return new Promise((resolve) => {
    console.log('📋 Showing mapping confirmation UI...');
    
    // Create overlay
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0,0,0,0.8);
      z-index: 10000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    `;
    
    // Create modal
    const modal = document.createElement('div');
    modal.style.cssText = `
      background: white;
      border-radius: 12px;
      max-width: 700px;
      width: 100%;
      max-height: 80vh;
      overflow-y: auto;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    `;
    
    // Build mapping rows
    const mappingRows = Object.keys(autoMappings).map(bsItem => {
      const mapping = autoMappings[bsItem];
      const pnlOptions = buildPnLOptions(data.pnl || [], mapping.pnlDriver);
      
      return `
        <div style="display: flex; align-items: center; gap: 15px; padding: 12px; border-bottom: 1px solid #e9ecef;">
          <div style="flex: 1;">
            <strong style="color: #2c3e50;">${bsItem}</strong>
            <div style="font-size: 0.85rem; color: #6c757d;">${mapping.balanceSheetCategory.replace(/_/g, ' ')}</div>
          </div>
          <div style="color: #3498db; font-size: 1.2rem;">→</div>
          <div style="flex: 1;">
            <select id="mapping-${bsItem.replace(/\s+/g, '-')}" style="width: 100%; padding: 8px; border: 2px solid #dee2e6; border-radius: 6px; font-size: 0.9rem;">
              ${pnlOptions}
            </select>
          </div>
          <div style="color: ${mapping.confidence > 0.9 ? '#27ae60' : '#f39c12'}; font-size: 0.85rem; font-weight: 600;">
            ${(mapping.confidence * 100).toFixed(0)}%
          </div>
        </div>
      `;
    }).join('');
    
    modal.innerHTML = `
      <div style="padding: 30px;">
        <h2 style="color: #2c3e50; margin-bottom: 10px;">🎯 Confirm P&L Mappings</h2>
        <p style="color: #6c757d; margin-bottom: 25px;">
          We auto-detected ${Object.keys(autoMappings).length} key balance sheet items and their P&L drivers. 
          Review and confirm or adjust as needed.
        </p>
        
        <div style="background: #f8f9fa; border-radius: 8px; padding: 15px; margin-bottom: 20px;">
          ${mappingRows.length > 0 ? mappingRows : '<p style="color: #6c757d;">No critical items detected. Balance sheet will use growth rates.</p>'}
        </div>
        
        <div style="background: #e3f2fd; border: 1px solid #2196f3; border-radius: 8px; padding: 15px; margin-bottom: 20px;">
          <div style="font-size: 0.9rem; color: #1976d2;">
            <strong>ℹ️ Note:</strong> Other balance sheet items (${(data.balance?.length || 0) - Object.keys(autoMappings).length}) will use simple growth rates. 
            This keeps setup fast while maintaining accuracy for the most important items.
          </div>
        </div>
        
        <div style="display: flex; gap: 12px; justify-content: flex-end;">
          <button id="confirmMappingsBtn" style="
            background: #3498db;
            color: white;
            border: none;
            padding: 12px 30px;
            border-radius: 8px;
            font-size: 1rem;
            font-weight: 600;
            cursor: pointer;
          ">
            ✓ Confirm & Continue
          </button>
        </div>
      </div>
    `;
    
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    
    // Handle confirm
    document.getElementById('confirmMappingsBtn').addEventListener('click', () => {
      // Collect any user changes to mappings
      Object.keys(autoMappings).forEach(bsItem => {
        const selectId = `mapping-${bsItem.replace(/\s+/g, '-')}`;
        const select = document.getElementById(selectId);
        if (select) {
          const selectedPnL = select.value;
          if (selectedPnL && autoMappings[bsItem]) {
            autoMappings[bsItem].pnlDriver = selectedPnL;
            autoMappings[bsItem].userOverride = select.value !== autoMappings[bsItem].pnlDriver;
          }
        }
      });
      
      // Store the final mappings
      pnlMappings = autoMappings;
      console.log('✅ Mappings confirmed:', pnlMappings);
      
      overlay.remove();
      resolve();
    });
  });
}

/**
 * Build dropdown options for P&L items
 */
function buildPnLOptions(pnlItems, selectedItem) {
  const options = ['<option value="">-- Select P&L Driver --</option>'];
  
  pnlItems.forEach(item => {
    // Skip totals and subheaders for cleaner dropdown
    const isTotal = /\btotal\b/i.test(item.name);
    const hasValues = item.actualValues && item.actualValues.some(v => v !== null && v !== undefined && v !== '');
    
    if (hasValues || isTotal) {
      const selected = item.name === selectedItem ? 'selected' : '';
      options.push(`<option value="${item.name}" ${selected}>${item.name}</option>`);
    }
  });
  
  return options.join('');
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
      
      // Build intelligent hierarchy from balance sheet structure
      balanceSheetHierarchy = buildBalanceSheetHierarchy(balanceSheetItems);
      console.log('🎯 Balance sheet hierarchy built:', balanceSheetHierarchy);
      
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
 * Balance Sheet Assumptions Storage
 */
let balanceSheetAssumptions = {
  dso: 30,           // Days Sales Outstanding
  dpo: 30,           // Days Payable Outstanding
  dio: 45,           // Days Inventory Outstanding
  depreciationRate: 10, // Annual depreciation rate %
  capexPercentage: 3,   // CapEx as % of revenue
  dividendPolicy: 0,    // Dividend policy as % of net income
  cashTarget: 30,       // Minimum cash buffer in days
  accruedExpensesPercentage: 5,  // Accrued expenses as % of total expenses
  prepaidExpensesPercentage: 1,  // Prepaid expenses as % of revenue
  workingCapitalGrowth: 5 // Growth rate for misc items %
};

/**
 * Default Balance Sheet Assumptions (for reset)
 */
const DEFAULT_BS_ASSUMPTIONS = {
  dso: 30,
  dpo: 30,
  dio: 45,
  depreciationRate: 10,
  capexPercentage: 3,
  dividendPolicy: 0,
  cashTarget: 30,
  accruedExpensesPercentage: 5,
  prepaidExpensesPercentage: 1,
  workingCapitalGrowth: 5
};

/**
 * Calculate totals from hierarchy
 */
function calculateTotalsFromHierarchy(forecastedValues, hierarchy) {
  if (!hierarchy || !hierarchy.totals) {
    console.warn('No hierarchy available for calculating totals');
    return {};
  }
  
  const calculatedTotals = {};
  
  // Calculate each total based on its children
  Object.keys(hierarchy.totals).forEach(totalName => {
    const totalInfo = hierarchy.totals[totalName];
    let sum = 0;
    
    totalInfo.children.forEach(childName => {
      // Check if child is also a total (nested)
      if (calculatedTotals[childName] !== undefined) {
        sum += calculatedTotals[childName];
      } 
      // Otherwise it's a detail item
      else if (forecastedValues[childName]) {
        sum += forecastedValues[childName].value || 0;
      }
    });
    
    calculatedTotals[totalName] = sum;
    console.log(`Calculated total "${totalName}" = $${sum.toLocaleString()} from ${totalInfo.children.length} children`);
  });
  
  return calculatedTotals;
}

/**
 * Identify key balance sheet totals from hierarchy
 */
function identifyKeyBalanceSheetTotals(hierarchy) {
  if (!hierarchy || !hierarchy.totals) {
    return { totalAssets: null, totalLiabilities: null, totalEquity: null };
  }
  
  const totals = Object.keys(hierarchy.totals);
  
  // Pattern matching for key totals
  const totalAssets = totals.find(name => 
    /total.*assets?$/i.test(name) || /^assets?.*total/i.test(name)
  );
  
  const totalLiabilities = totals.find(name => 
    /total.*liabilit/i.test(name) || /^liabilit.*total/i.test(name)
  );
  
  const totalEquity = totals.find(name => 
    /total.*equity/i.test(name) || 
    /^equity.*total/i.test(name) || 
    /stockholder.*equity/i.test(name) ||
    /shareholder.*equity/i.test(name)
  );
  
  console.log('🎯 Identified key totals:', { totalAssets, totalLiabilities, totalEquity });
  
  return { totalAssets, totalLiabilities, totalEquity };
}

/**
 * Calculate cash needed to balance the balance sheet
 * This is the MAGIC that makes Assets = Liabilities + Equity
 */
function calculateBalancingCash(forecastedValues, calculatedTotals, hierarchy, classifications) {
  console.log('💰 Calculating balancing cash...');
  
  // Identify key totals
  const keyTotals = identifyKeyBalanceSheetTotals(hierarchy);
  
  if (!keyTotals.totalLiabilities || !keyTotals.totalEquity) {
    console.warn('⚠️ Cannot balance - missing Total Liabilities or Total Equity');
    return null;
  }
  
  // Get Total Liabilities + Total Equity
  const totalLiabilities = calculatedTotals[keyTotals.totalLiabilities] || 0;
  const totalEquity = calculatedTotals[keyTotals.totalEquity] || 0;
  const totalLiabilitiesAndEquity = totalLiabilities + totalEquity;
  
  console.log(`Total Liabilities: $${totalLiabilities.toLocaleString()}`);
  console.log(`Total Equity: $${totalEquity.toLocaleString()}`);
  console.log(`Total Liabilities + Equity: $${totalLiabilitiesAndEquity.toLocaleString()}`);
  
  // Sum all non-cash assets
  let nonCashAssets = 0;
  Object.keys(forecastedValues).forEach(itemName => {
    const classification = classifications[itemName];
    const value = forecastedValues[itemName];
    
    // Skip if it's cash, a total, or a subheader
    if (!classification || !value) return;
    if (classification.category === 'cash') return;
    if (classification.category === 'calculated_total') return;
    if (classification.category === 'subheader') return;
    
    // Check if this is an asset (not liability or equity)
    const isAsset = !isLiabilityOrEquityCategory(classification.category);
    
    if (isAsset) {
      nonCashAssets += value.value || 0;
    }
  });
  
  console.log(`Non-cash assets: $${nonCashAssets.toLocaleString()}`);
  
  // Calculate cash needed to balance
  const cashNeeded = totalLiabilitiesAndEquity - nonCashAssets;
  
  console.log(`✅ Cash needed to balance: $${cashNeeded.toLocaleString()}`);
  console.log(`   Formula: ($${totalLiabilitiesAndEquity.toLocaleString()} Liab+Equity) - ($${nonCashAssets.toLocaleString()} Other Assets)`);
  
  return {
    value: Math.max(0, cashNeeded), // Don't allow negative cash
    method: 'balancing_plug',
    note: `Balancing plug: ($${totalLiabilitiesAndEquity.toLocaleString()} L+E) - ($${nonCashAssets.toLocaleString()} other assets)`,
    totalLiabilitiesAndEquity,
    nonCashAssets,
    isBalanced: true
  };
}

/**
 * Helper: Check if a category is a liability or equity
 */
function isLiabilityOrEquityCategory(category) {
  const liabilityEquityCategories = [
    'accounts_payable',
    'accrued_expenses',
    'short_term_debt',
    'deferred_revenue',
    'accrued_payroll',
    'long_term_debt',
    'deferred_tax_liabilities',
    'common_stock',
    'retained_earnings',
    'additional_paid_in_capital',
    'treasury_stock'
  ];
  
  return liabilityEquityCategories.includes(category);
}

/**
 * ADAPTIVE INTELLIGENCE SYSTEM
 * Detects what data is available and chooses optimal forecasting strategy
 */

/**
 * Detect critical balance sheet items using smart pattern matching (NO AI)
 * This replaces the need for full AI classification
 */
function detectCriticalBalanceSheetItems(balanceSheetItems) {
  console.log('🔍 Detecting critical balance sheet items using pattern matching...');
  
  const detected = {
    cash: null,
    accountsReceivable: null,
    inventory: null,
    accountsPayable: null,
    retainedEarnings: null,
    ppe: null,
    commonStock: null,
    otherItems: []
  };
  
  balanceSheetItems.forEach(item => {
    const name = item.name.toLowerCase().trim();
    const originalName = item.name;
    
    // Cash detection (high confidence patterns)
    if (!detected.cash && (
      name === 'cash' ||
      name === 'cash and cash equivalents' ||
      name.includes('cash') && !name.includes('flow') && !name.includes('operating')
    )) {
      detected.cash = { name: originalName, confidence: 0.95, item: item };
      console.log(`✅ Detected Cash: "${originalName}"`);
      return;
    }
    
    // Accounts Receivable (high confidence patterns)
    if (!detected.accountsReceivable && (
      name === 'accounts receivable' ||
      name === 'receivables' ||
      name === 'a/r' ||
      name === 'ar' ||
      name === 'trade receivables' ||
      name.includes('accounts') && name.includes('receivable')
    )) {
      detected.accountsReceivable = { name: originalName, confidence: 0.95, item: item };
      console.log(`✅ Detected Accounts Receivable: "${originalName}"`);
      return;
    }
    
    // Inventory (high confidence patterns)
    if (!detected.inventory && (
      name === 'inventory' ||
      name === 'inventories' ||
      name === 'stock' ||
      name === 'merchandise inventory' ||
      name.includes('inventory') && !name.includes('reserve')
    )) {
      detected.inventory = { name: originalName, confidence: 0.95, item: item };
      console.log(`✅ Detected Inventory: "${originalName}"`);
      return;
    }
    
    // Accounts Payable (high confidence patterns)
    if (!detected.accountsPayable && (
      name === 'accounts payable' ||
      name === 'payables' ||
      name === 'a/p' ||
      name === 'ap' ||
      name === 'trade payables' ||
      name.includes('accounts') && name.includes('payable')
    )) {
      detected.accountsPayable = { name: originalName, confidence: 0.95, item: item };
      console.log(`✅ Detected Accounts Payable: "${originalName}"`);
      return;
    }
    
    // Retained Earnings (high confidence patterns)
    if (!detected.retainedEarnings && (
      name === 'retained earnings' ||
      name === 'accumulated earnings' ||
      name === 'retained deficit' ||
      name.includes('retained') && name.includes('earning')
    )) {
      detected.retainedEarnings = { name: originalName, confidence: 0.95, item: item };
      console.log(`✅ Detected Retained Earnings: "${originalName}"`);
      return;
    }
    
    // Property, Plant & Equipment (high confidence patterns)
    if (!detected.ppe && (
      name === 'ppe' ||
      name === 'pp&e' ||
      name === 'property, plant and equipment' ||
      name === 'property, plant & equipment' ||
      name === 'fixed assets' ||
      name.includes('property') && name.includes('equipment') ||
      name === 'net ppe'
    )) {
      detected.ppe = { name: originalName, confidence: 0.95, item: item };
      console.log(`✅ Detected PPE: "${originalName}"`);
      return;
    }
    
    // Common Stock (high confidence patterns)
    if (!detected.commonStock && (
      name === 'common stock' ||
      name === 'share capital' ||
      name === 'capital stock' ||
      name.includes('common') && name.includes('stock')
    )) {
      detected.commonStock = { name: originalName, confidence: 0.95, item: item };
      console.log(`✅ Detected Common Stock: "${originalName}"`);
      return;
    }
    
    // Everything else goes to "other items"
    if (item.autoDetectedType !== 'calculated_total' && item.autoDetectedType !== 'subheader') {
      detected.otherItems.push({ name: originalName, item: item });
    }
  });
  
  console.log(`🎯 Critical items detected: ${Object.keys(detected).filter(k => detected[k] && k !== 'otherItems').length}/7`);
  console.log(`📋 Other items (will use growth rates): ${detected.otherItems.length}`);
  
  return detected;
}

/**
 * Detect critical P&L items using smart pattern matching (NO AI)
 */
function detectCriticalPnLItems(pnlItems) {
  console.log('🔍 Detecting critical P&L items using pattern matching...');
  
  const detected = {
    revenue: null,
    cogs: null,
    operatingExpenses: null,
    netIncome: null,
    depreciation: null,
    otherItems: []
  };
  
  pnlItems.forEach(item => {
    const name = item.name.toLowerCase().trim();
    const originalName = item.name;
    
    // Revenue detection (prioritize "total" revenue)
    if (!detected.revenue && (
      name === 'total revenue' ||
      name === 'revenue' ||
      name === 'total sales' ||
      name === 'sales' ||
      name === 'net revenue' ||
      name.includes('total') && name.includes('revenue')
    )) {
      detected.revenue = { name: originalName, confidence: 0.95, item: item };
      console.log(`✅ Detected Revenue: "${originalName}"`);
      return;
    }
    
    // COGS detection
    if (!detected.cogs && (
      name === 'cost of goods sold' ||
      name === 'cogs' ||
      name === 'cost of sales' ||
      name === 'total cost of goods sold' ||
      name.includes('cost') && name.includes('goods')
    )) {
      detected.cogs = { name: originalName, confidence: 0.95, item: item };
      console.log(`✅ Detected COGS: "${originalName}"`);
      return;
    }
    
    // Operating Expenses detection
    if (!detected.operatingExpenses && (
      name === 'operating expenses' ||
      name === 'total operating expenses' ||
      name === 'opex' ||
      name === 'sg&a' ||
      name === 'selling, general and administrative' ||
      name.includes('operating') && name.includes('expense')
    )) {
      detected.operatingExpenses = { name: originalName, confidence: 0.95, item: item };
      console.log(`✅ Detected Operating Expenses: "${originalName}"`);
      return;
    }
    
    // Net Income detection
    if (!detected.netIncome && (
      name === 'net income' ||
      name === 'net profit' ||
      name === 'net earnings' ||
      name === 'profit after tax' ||
      name === 'bottom line' ||
      name.includes('net') && (name.includes('income') || name.includes('profit'))
    )) {
      detected.netIncome = { name: originalName, confidence: 0.95, item: item };
      console.log(`✅ Detected Net Income: "${originalName}"`);
      return;
    }
    
    // Depreciation detection
    if (!detected.depreciation && (
      name === 'depreciation' ||
      name === 'depreciation expense' ||
      name === 'depreciation and amortization' ||
      name === 'd&a' ||
      name.includes('depreciation')
    )) {
      detected.depreciation = { name: originalName, confidence: 0.95, item: item };
      console.log(`✅ Detected Depreciation: "${originalName}"`);
      return;
    }
    
    // Other items
    if (item.autoDetectedType !== 'calculated_total' && item.autoDetectedType !== 'subheader') {
      detected.otherItems.push({ name: originalName, item: item });
    }
  });
  
  console.log(`🎯 Critical P&L items detected: ${Object.keys(detected).filter(k => detected[k] && k !== 'otherItems').length}/5`);
  
  return detected;
}

/**
 * Determine optimal forecasting strategy based on available data
 */
function determineForecastingStrategy(uploadedData) {
  console.log('🧠 Determining optimal forecasting strategy...');
  console.log('Uploaded data structure:', {
    pnl: uploadedData.pnl ? uploadedData.pnl.length : 0,
    balance: uploadedData.balance ? uploadedData.balance.length : 0,
    cashflow: uploadedData.cashflow ? uploadedData.cashflow.length : 0
  });
  
  const hasPnL = uploadedData.pnl && uploadedData.pnl.length > 0;
  const hasBalanceSheet = uploadedData.balance && uploadedData.balance.length > 0;
  const hasCashFlow = uploadedData.cashflow && uploadedData.cashflow.length > 0;
  
  console.log(`Data detection: P&L=${hasPnL}, BS=${hasBalanceSheet}, CF=${hasCashFlow}`);
  
  // Update global context
  availableDataContext.hasPnL = hasPnL;
  availableDataContext.hasBalanceSheet = hasBalanceSheet;
  availableDataContext.hasCashFlow = hasCashFlow;
  
  let strategy = 'unknown';
  let description = '';
  let usesFormulas = false;
  let requiresMapping = false;
  
  if (hasPnL && hasBalanceSheet) {
    strategy = 'integrated_pnl_bs';
    description = '🎯 Full Integration: P&L-driven balance sheet formulas for maximum accuracy';
    usesFormulas = true;
    requiresMapping = true;
  } else if (hasBalanceSheet && !hasPnL) {
    strategy = 'balance_sheet_only';
    description = '📊 Balance Sheet Only: Using historical growth patterns (no P&L needed)';
    usesFormulas = false;
    requiresMapping = false;
  } else if (hasPnL && !hasBalanceSheet) {
    strategy = 'pnl_only';
    description = '💼 P&L Only: Forecasting income statement';
    usesFormulas = false;
    requiresMapping = false;
  } else {
    strategy = 'no_data';
    description = '⚠️ No Data: Please upload financial statements';
    usesFormulas = false;
    requiresMapping = false;
  }
  
  availableDataContext.forecastingStrategy = strategy;
  availableDataContext.description = description;
  availableDataContext.usesFormulas = usesFormulas;
  availableDataContext.requiresMapping = requiresMapping;
  
  console.log(`✅ Strategy: ${strategy}`);
  console.log(`   ${description}`);
  console.log(`   Uses formulas: ${usesFormulas}, Requires mapping: ${requiresMapping}`);
  
  return availableDataContext;
}

/**
 * Balance Sheet Calculation Engine
 */
class BalanceSheetCalculationEngine {
  constructor(pnlMappings, balanceSheetClassifications, assumptions, hierarchy = null) {
    this.pnlMappings = pnlMappings;
    this.classifications = balanceSheetClassifications;
    this.assumptions = assumptions;
    this.hierarchy = hierarchy;
  }

  /**
   * Calculate forecasted balance sheet values
   */
  calculateForecastedValues(periodIndex, pnlForecastData, previousBalanceSheetValues = {}) {
    const results = {};
    
    console.log(`Calculating balance sheet for period ${periodIndex}:`, pnlForecastData);
    
    // Step 1: Calculate detail items (skip totals and subheaders for now)
    Object.keys(this.classifications).forEach(itemName => {
      const classification = this.classifications[itemName];
      const mapping = this.pnlMappings[itemName];
      
      // Skip subheaders and totals - they'll be calculated from hierarchy
      if (classification.category === 'subheader') {
        results[itemName] = { value: 0, method: 'subheader', note: 'Section header' };
        return;
      }
      
      if (classification.category === 'calculated_total') {
        // Placeholder - will be calculated from hierarchy
        results[itemName] = { value: 0, method: 'pending_total_calculation', note: 'Will be calculated from children' };
        return;
      }
      
      // Calculate based on category and method
      const calculatedValue = this.calculateLineItem(
        itemName, 
        classification, 
        mapping, 
        pnlForecastData, 
        previousBalanceSheetValues,
        periodIndex
      );
      
      results[itemName] = calculatedValue;
    });
    
    // Step 2: Calculate totals using intelligent hierarchy (first pass without cash)
    let calculatedTotals = {};
    if (this.hierarchy && this.hierarchy.totals) {
      console.log('🧠 Calculating preliminary totals from hierarchy...');
      calculatedTotals = calculateTotalsFromHierarchy(results, this.hierarchy);
      
      // Update results with calculated totals (preliminary)
      Object.keys(calculatedTotals).forEach(totalName => {
        results[totalName] = {
          value: calculatedTotals[totalName],
          method: 'hierarchical_sum',
          note: `Sum of ${this.hierarchy.totals[totalName].children.length} children`,
          children: this.hierarchy.totals[totalName].children,
          validated: this.hierarchy.totals[totalName].validated
        };
      });
      
      console.log('✅ Preliminary totals calculated:', calculatedTotals);
    } else {
      console.warn('⚠️ No hierarchy available - totals will be $0');
    }
    
    // Step 3: Calculate balancing cash (makes Assets = Liabilities + Equity)
    const balancingCash = calculateBalancingCash(results, calculatedTotals, this.hierarchy, this.classifications);
    
    if (balancingCash) {
      // Find cash item and update it
      const cashItems = Object.keys(this.classifications).filter(itemName => 
        this.classifications[itemName].category === 'cash'
      );
      
      if (cashItems.length > 0) {
        const cashItemName = cashItems[0];
        results[cashItemName] = balancingCash;
        console.log(`💰 Updated cash "${cashItemName}" to balancing value: $${balancingCash.value.toLocaleString()}`);
        
        // Step 4: Recalculate totals with balanced cash
        if (this.hierarchy && this.hierarchy.totals) {
          console.log('🔄 Recalculating totals with balanced cash...');
          const finalTotals = calculateTotalsFromHierarchy(results, this.hierarchy);
          
          // Update results with final balanced totals
          Object.keys(finalTotals).forEach(totalName => {
            results[totalName] = {
              value: finalTotals[totalName],
              method: 'hierarchical_sum',
              note: `Sum of ${this.hierarchy.totals[totalName].children.length} children (balanced)`,
              children: this.hierarchy.totals[totalName].children,
              validated: this.hierarchy.totals[totalName].validated,
              isBalanced: true
            };
          });
          
          console.log('✅ Final balanced totals:', finalTotals);
          
          // Verify balance
          const keyTotals = identifyKeyBalanceSheetTotals(this.hierarchy);
          if (keyTotals.totalAssets && keyTotals.totalLiabilities && keyTotals.totalEquity) {
            const totalAssets = finalTotals[keyTotals.totalAssets] || 0;
            const totalLiabilities = finalTotals[keyTotals.totalLiabilities] || 0;
            const totalEquity = finalTotals[keyTotals.totalEquity] || 0;
            const totalLiabEquity = totalLiabilities + totalEquity;
            const difference = Math.abs(totalAssets - totalLiabEquity);
            
            console.log(`🎯 Balance Check: Assets=$${totalAssets.toLocaleString()}, Liab+Equity=$${totalLiabEquity.toLocaleString()}, Diff=$${difference.toLocaleString()}`);
            
            if (difference < 1) {
              console.log('✅ BALANCE SHEET BALANCED! Assets = Liabilities + Equity');
            } else {
              console.warn(`⚠️ Balance sheet not perfectly balanced. Difference: $${difference.toLocaleString()}`);
            }
          }
        }
      } else {
        console.warn('⚠️ No cash item found - cannot balance balance sheet');
      }
    } else {
      console.warn('⚠️ Could not calculate balancing cash');
    }
    
    console.log(`Balance sheet calculations for period ${periodIndex}:`, results);
    return results;
  }

  /**
   * Calculate individual line item based on its classification and method
   */
  calculateLineItem(itemName, classification, mapping, pnlData, previousValues, periodIndex) {
    const category = classification.category;
    const method = classification.method;
    
    try {
      switch (category) {
        case 'accounts_receivable':
          return this.calculateAccountsReceivable(mapping, pnlData);
          
        case 'inventory':
          return this.calculateInventory(mapping, pnlData);
          
        case 'accounts_payable':
          return this.calculateAccountsPayable(mapping, pnlData);
          
        case 'accrued_expenses':
          return this.calculateAccruedExpenses(mapping, pnlData);
          
        case 'retained_earnings':
          return this.calculateRetainedEarnings(mapping, pnlData, previousValues[itemName]);
          
        case 'property_plant_equipment':
          return this.calculatePPE(mapping, pnlData, previousValues[itemName]);
          
        case 'prepaid_expenses':
          return this.calculatePrepaidExpenses(mapping, pnlData);
          
        case 'deferred_revenue':
          return this.calculateDeferredRevenue(mapping, pnlData);
          
        case 'cash':
          return this.calculateCash(pnlData, previousValues); // Special balancing item
        
        case 'other_asset_or_liability':
          return this.calculateDefaultGrowth(itemName, previousValues[itemName]);
        
        case 'common_stock':
          return this.calculateStaticValue(itemName, previousValues[itemName]);
          
        default:
          return this.calculateDefaultGrowth(itemName, previousValues[itemName]);
      }
    } catch (error) {
      console.error(`Error calculating ${itemName}:`, error);
      return {
        value: previousValues[itemName]?.value || 0,
        method: 'error_fallback',
        note: `Calculation failed: ${error.message}`
      };
    }
  }

  /**
   * Accounts Receivable = (Revenue / 365) * DSO
   */
  calculateAccountsReceivable(mapping, pnlData) {
    if (!mapping || !mapping.pnlDriver) {
      return { value: 0, method: 'no_pnl_driver', note: 'No P&L driver mapped' };
    }
    
    const revenue = this.getPnLValue(mapping.pnlDriver, pnlData);
    if (revenue === null) {
      return { value: 0, method: 'pnl_value_not_found', note: `P&L driver "${mapping.pnlDriver}" not found` };
    }
    
    const dso = this.assumptions.dso;
    const arValue = (revenue / 365) * dso;
    
    return {
      value: Math.max(0, arValue), // Don't allow negative AR
      method: 'days_sales_outstanding',
      note: `${revenue.toLocaleString()} revenue / 365 * ${dso} DSO`,
      driver: mapping.pnlDriver,
      driverValue: revenue
    };
  }

  /**
   * Inventory = (COGS / 365) * DIO
   */
  calculateInventory(mapping, pnlData) {
    if (!mapping || !mapping.pnlDriver) {
      return { value: 0, method: 'no_pnl_driver', note: 'No P&L driver mapped' };
    }
    
    const cogs = this.getPnLValue(mapping.pnlDriver, pnlData);
    if (cogs === null) {
      return { value: 0, method: 'pnl_value_not_found', note: `P&L driver "${mapping.pnlDriver}" not found` };
    }
    
    const dio = this.assumptions.dio;
    const inventoryValue = (cogs / 365) * dio;
    
    return {
      value: Math.max(0, inventoryValue),
      method: 'days_inventory_outstanding',
      note: `${cogs.toLocaleString()} COGS / 365 * ${dio} DIO`,
      driver: mapping.pnlDriver,
      driverValue: cogs
    };
  }

  /**
   * Accounts Payable = (Operating Expenses / 365) * DPO
   */
  calculateAccountsPayable(mapping, pnlData) {
    if (!mapping || !mapping.pnlDriver) {
      return { value: 0, method: 'no_pnl_driver', note: 'No P&L driver mapped' };
    }
    
    const opex = this.getPnLValue(mapping.pnlDriver, pnlData);
    if (opex === null) {
      return { value: 0, method: 'pnl_value_not_found', note: `P&L driver "${mapping.pnlDriver}" not found` };
    }
    
    const dpo = this.assumptions.dpo;
    const apValue = (opex / 365) * dpo;
    
    return {
      value: Math.max(0, apValue),
      method: 'days_payable_outstanding',
      note: `${opex.toLocaleString()} OpEx / 365 * ${dpo} DPO`,
      driver: mapping.pnlDriver,
      driverValue: opex
    };
  }

  /**
   * Accrued Expenses = Total Expenses * Percentage
   */
  calculateAccruedExpenses(mapping, pnlData) {
    if (!mapping || !mapping.pnlDriver) {
      return { value: 0, method: 'no_pnl_driver', note: 'No P&L driver mapped' };
    }
    
    const expenses = this.getPnLValue(mapping.pnlDriver, pnlData);
    if (expenses === null) {
      return { value: 0, method: 'pnl_value_not_found', note: `P&L driver "${mapping.pnlDriver}" not found` };
    }
    
    const percentage = this.assumptions.accruedExpensesPercentage;
    const accruedValue = expenses * (percentage / 100);
    
    return {
      value: Math.max(0, accruedValue),
      method: 'percentage_of_expenses',
      note: `${expenses.toLocaleString()} expenses * ${percentage}%`,
      driver: mapping.pnlDriver,
      driverValue: expenses
    };
  }

  /**
   * Retained Earnings = Previous + Net Income - Dividends
   */
  calculateRetainedEarnings(mapping, pnlData, previousValue) {
    const netIncome = this.getPnLValue(mapping?.pnlDriver || 'net income', pnlData) || 0;
    const dividendPercentage = this.assumptions.dividendPolicy / 100;
    const dividends = netIncome * dividendPercentage;
    const previousRE = previousValue?.value || 0;
    
    const newRE = previousRE + netIncome - dividends;
    
    return {
      value: newRE,
      method: 'accumulated_earnings',
      note: `${previousRE.toLocaleString()} + ${netIncome.toLocaleString()} - ${dividends.toLocaleString()} (${this.assumptions.dividendPolicy}% of NI)`,
      driver: mapping?.pnlDriver || 'net income',
      driverValue: netIncome
    };
  }

  /**
   * Property, Plant & Equipment = Previous + CapEx - Depreciation
   */
  calculatePPE(mapping, pnlData, previousValue) {
    const revenue = this.getPnLValue('total revenue', pnlData) || this.getPnLValue('revenue', pnlData) || 0;
    const capex = revenue * (this.assumptions.capexPercentage / 100);
    const depreciation = this.getPnLValue('depreciation', pnlData) || 
                        (previousValue?.value || 0) * (this.assumptions.depreciationRate / 100 / 12); // Monthly depreciation
    const previousPPE = previousValue?.value || 0;
    
    const newPPE = Math.max(0, previousPPE + capex - depreciation);
    
    return {
      value: newPPE,
      method: 'capex_depreciation',
      note: `${previousPPE.toLocaleString()} + ${capex.toLocaleString()} CapEx - ${depreciation.toLocaleString()} Depreciation`,
      driver: 'revenue + depreciation',
      driverValue: revenue
    };
  }

  /**
   * Prepaid Expenses = Revenue * Percentage
   */
  calculatePrepaidExpenses(mapping, pnlData) {
    const revenue = this.getPnLValue(mapping?.pnlDriver || 'total revenue', pnlData) || 0;
    const percentage = this.assumptions.prepaidExpensesPercentage;
    const prepaidValue = revenue * (percentage / 100);
    
    return {
      value: Math.max(0, prepaidValue),
      method: 'percentage_of_revenue',
      note: `${revenue.toLocaleString()} revenue * ${percentage}%`,
      driver: mapping?.pnlDriver || 'revenue',
      driverValue: revenue
    };
  }

  /**
   * Deferred Revenue = Revenue * Percentage (advance payments)
   */
  calculateDeferredRevenue(mapping, pnlData) {
    const revenue = this.getPnLValue(mapping?.pnlDriver || 'total revenue', pnlData) || 0;
    const percentage = 8; // 8% of revenue for SaaS/subscription - could be configurable
    const deferredValue = revenue * (percentage / 100);
    
    return {
      value: Math.max(0, deferredValue),
      method: 'percentage_of_revenue',
      note: `${revenue.toLocaleString()} revenue * ${percentage}%`,
      driver: mapping?.pnlDriver || 'revenue',
      driverValue: revenue
    };
  }

  /**
   * Cash = Balancing item (calculated via balancing logic, not here)
   */
  calculateCash(pnlData, allBalanceSheetValues) {
    // Cash is now calculated as a balancing plug in the main calculation loop
    // This method is kept for backward compatibility but shouldn't be called
    console.warn('⚠️ calculateCash called - should use balancing logic instead');
    
    return {
      value: 0,
      method: 'pending_balance',
      note: 'Cash will be calculated as balancing plug',
      driver: 'balance_sheet_balancing',
      driverValue: 0
    };
  }

  /**
   * Default growth for unclassified items
   */
  calculateDefaultGrowth(itemName, previousValue) {
    const growthRate = this.assumptions.workingCapitalGrowth / 100 / 12; // Monthly growth
    const previousVal = previousValue?.value || 0;
    const newValue = previousVal * (1 + growthRate);
    
    return {
      value: newValue,
      method: 'growth_rate',
      note: `${previousVal.toLocaleString()} * ${(this.assumptions.workingCapitalGrowth)}% annual growth`,
      driver: 'growth assumption',
      driverValue: growthRate
    };
  }
  
  /**
   * Static value for items that don't change (like Common Stock)
   */
  calculateStaticValue(itemName, previousValue) {
    const value = previousValue?.value || 0;
    
    return {
      value: value,
      method: 'static_value',
      note: `Carried forward from previous period`,
      driver: 'none',
      driverValue: value
    };
  }

  /**
   * Helper: Get P&L value by name (fuzzy matching)
   */
  getPnLValue(pnlItemName, pnlData) {
    if (!pnlItemName || !pnlData) return null;
    
    // Try exact match first
    if (pnlData[pnlItemName] !== undefined) {
      return Number(pnlData[pnlItemName]) || 0;
    }
    
    // Try fuzzy matching
    const searchTerm = pnlItemName.toLowerCase();
    const matchingKey = Object.keys(pnlData).find(key => 
      key.toLowerCase().includes(searchTerm) || 
      searchTerm.includes(key.toLowerCase())
    );
    
    if (matchingKey) {
      return Number(pnlData[matchingKey]) || 0;
    }
    
    console.warn(`P&L value not found: "${pnlItemName}" in`, Object.keys(pnlData));
    return null;
  }
}

/**
 * Storage for cash flow forecasts
 */
let cashFlowForecasts = {
  monthly: [],
  quarterly: [],
  yearly: []
};

/**
 * Cash Flow Calculation Engine
 * Generates cash flow statements from P&L and Balance Sheet data
 */
class CashFlowCalculationEngine {
  constructor(pnlData, balanceSheetCurrent, balanceSheetPrevious, criticalItems, assumptions) {
    this.pnlData = pnlData;
    this.bsCurrent = balanceSheetCurrent;
    this.bsPrevious = balanceSheetPrevious;
    this.criticalItems = criticalItems;
    this.assumptions = assumptions;
  }

  /**
   * Main entry point: Calculate complete cash flow for a period
   */
  calculateCashFlow(periodIndex) {
    console.log(`💰 Calculating cash flow for period ${periodIndex}...`);
    
    // Step 1: Operating activities
    const operating = this.calculateOperatingActivities();
    
    // Step 2: Investing activities  
    const investing = this.calculateInvestingActivities();
    
    // Step 3: Financing activities
    const financing = this.calculateFinancingActivities();
    
    // Step 4: Net change and reconciliation
    const netChange = operating.total + investing.total + financing.total;
    
    const cashItemName = this.criticalItems.cash?.name || 'Cash';
    const beginningCash = this.bsPrevious[cashItemName]?.value || 0;
    const endingCash = this.bsCurrent[cashItemName]?.value || 0;
    const calculatedEndingCash = beginningCash + netChange;
    const reconciliationDifference = endingCash - calculatedEndingCash;
    
    const reconciles = Math.abs(reconciliationDifference) < 1;
    
    if (reconciles) {
      console.log(`✅ Cash flow reconciles! Beginning: $${beginningCash.toLocaleString()}, Net Change: $${netChange.toLocaleString()}, Ending: $${endingCash.toLocaleString()}`);
    } else {
      console.warn(`⚠️ Cash flow doesn't reconcile. Difference: $${reconciliationDifference.toLocaleString()}`);
    }
    
    return {
      operating,
      investing,
      financing,
      netChange,
      beginningCash,
      endingCash,
      calculatedEndingCash,
      reconciliationDifference,
      reconciles
    };
  }

  /**
   * Calculate operating activities section
   */
  calculateOperatingActivities() {
    console.log('📊 Calculating operating activities...');
    
    const lineItems = [];
    let runningTotal = 0;
    
    // 1. Start with Net Income
    const netIncome = this.getPnLValue(this.criticalItems.netIncome?.name || 'net income');
    runningTotal += netIncome;
    lineItems.push({
      name: 'Net Income',
      value: netIncome,
      note: 'From P&L statement',
      isSubtotal: false
    });
    
    // 2. Add back non-cash expenses
    const depreciation = this.getPnLValue(this.criticalItems.depreciation?.name || 'depreciation');
    if (depreciation !== 0) {
      runningTotal += depreciation;
      lineItems.push({
        name: 'Depreciation & Amortization',
        value: depreciation,
        note: 'Non-cash expense added back',
        isSubtotal: false
      });
    }
    
    // 3. Changes in Working Capital
    const wcChanges = this.calculateWorkingCapitalChanges();
    
    // Add each working capital change
    wcChanges.forEach(change => {
      runningTotal += change.value;
      lineItems.push(change);
    });
    
    // 4. Calculate total
    const total = runningTotal;
    
    console.log(`✅ Operating CF: $${total.toLocaleString()} (Net Income: $${netIncome.toLocaleString()}, WC Changes: $${(total - netIncome - depreciation).toLocaleString()})`);
    
    return {
      netIncome,
      depreciation,
      workingCapitalChanges: wcChanges,
      lineItems,
      total,
      details: {
        startingPoint: netIncome,
        nonCashAdjustments: depreciation,
        workingCapitalImpact: total - netIncome - depreciation
      }
    };
  }

  /**
   * Calculate changes in working capital items
   */
  calculateWorkingCapitalChanges() {
    const changes = [];
    
    // Accounts Receivable
    if (this.criticalItems.accountsReceivable) {
      const arChange = this.getBalanceSheetChange(this.criticalItems.accountsReceivable.name);
      if (arChange.change !== 0) {
        changes.push({
          name: `${arChange.increase ? 'Increase' : 'Decrease'} in Accounts Receivable`,
          value: -arChange.change, // Negative of increase (increase in AR = cash outflow)
          note: `AR ${arChange.increase ? 'increased' : 'decreased'} by $${Math.abs(arChange.change).toLocaleString()}`,
          rawChange: arChange.change,
          isSubtotal: false
        });
      }
    }
    
    // Inventory
    if (this.criticalItems.inventory) {
      const invChange = this.getBalanceSheetChange(this.criticalItems.inventory.name);
      if (invChange.change !== 0) {
        changes.push({
          name: `${invChange.increase ? 'Increase' : 'Decrease'} in Inventory`,
          value: -invChange.change, // Negative of increase (increase in inventory = cash outflow)
          note: `Inventory ${invChange.increase ? 'increased' : 'decreased'} by $${Math.abs(invChange.change).toLocaleString()}`,
          rawChange: invChange.change,
          isSubtotal: false
        });
      }
    }
    
    // Accounts Payable
    if (this.criticalItems.accountsPayable) {
      const apChange = this.getBalanceSheetChange(this.criticalItems.accountsPayable.name);
      if (apChange.change !== 0) {
        changes.push({
          name: `${apChange.increase ? 'Increase' : 'Decrease'} in Accounts Payable`,
          value: apChange.change, // Positive as-is (increase in AP = cash inflow)
          note: `AP ${apChange.increase ? 'increased' : 'decreased'} by $${Math.abs(apChange.change).toLocaleString()}`,
          rawChange: apChange.change,
          isSubtotal: false
        });
      }
    }
    
    // Detect and handle other working capital items automatically
    const otherWCItems = this.detectOtherWorkingCapitalItems();
    otherWCItems.forEach(item => {
      const change = this.getBalanceSheetChange(item.name);
      if (change.change !== 0) {
        // Determine if asset or liability based on typical patterns
        const isAsset = item.isAsset;
        const cashImpact = isAsset ? -change.change : change.change;
        
        changes.push({
          name: `${change.increase ? 'Increase' : 'Decrease'} in ${item.displayName}`,
          value: cashImpact,
          note: `${item.displayName} ${change.increase ? 'increased' : 'decreased'} by $${Math.abs(change.change).toLocaleString()}`,
          rawChange: change.change,
          isSubtotal: false
        });
      }
    });
    
    const totalWCImpact = changes.reduce((sum, c) => sum + c.value, 0);
    console.log(`Working capital changes: ${changes.length} items, total impact: $${totalWCImpact.toLocaleString()}`);
    
    return changes;
  }

  /**
   * Detect other working capital items beyond the critical ones
   */
  detectOtherWorkingCapitalItems() {
    const otherItems = [];
    
    // Look for common working capital items we haven't classified as "critical"
    Object.keys(this.bsCurrent).forEach(itemName => {
      const nameLower = itemName.toLowerCase();
      
      // Prepaid Expenses (current asset)
      if (nameLower.includes('prepaid') && !this.criticalItems.prepaidExpenses) {
        otherItems.push({
          name: itemName,
          displayName: itemName,
          isAsset: true,
          category: 'prepaid_expenses'
        });
      }
      
      // Accrued Expenses (current liability)
      if (nameLower.includes('accrued') && nameLower.includes('expense')) {
        otherItems.push({
          name: itemName,
          displayName: itemName,
          isAsset: false,
          category: 'accrued_expenses'
        });
      }
      
      // Deferred Revenue (current liability)
      if (nameLower.includes('deferred') && nameLower.includes('revenue')) {
        otherItems.push({
          name: itemName,
          displayName: itemName,
          isAsset: false,
          category: 'deferred_revenue'
        });
      }
    });
    
    return otherItems;
  }

  /**
   * Calculate investing activities section
   */
  calculateInvestingActivities() {
    console.log('🏗️ Calculating investing activities...');
    
    const lineItems = [];
    let total = 0;
    
    // 1. Capital Expenditures
    // Get CapEx from PPE calculation or estimate from revenue
    let capex = 0;
    
    if (this.criticalItems.ppe) {
      const ppeChange = this.getBalanceSheetChange(this.criticalItems.ppe.name);
      const depreciation = this.getPnLValue(this.criticalItems.depreciation?.name || 'depreciation');
      
      // CapEx = Δ PPE + Depreciation
      // (because PPE(end) = PPE(begin) + CapEx - Depreciation)
      capex = ppeChange.change + depreciation;
      
      if (capex > 0) {
        total -= capex; // CapEx is cash outflow (negative)
        lineItems.push({
          name: 'Capital Expenditures',
          value: -capex,
          note: `PPE increased by $${ppeChange.change.toLocaleString()}, Depreciation: $${depreciation.toLocaleString()}`,
          isSubtotal: false
        });
      }
    } else {
      // Fallback: estimate CapEx as % of revenue
      const revenue = this.getPnLValue(this.criticalItems.revenue?.name || 'revenue');
      capex = revenue * (this.assumptions.capexPercentage / 100);
      
      if (capex > 0) {
        total -= capex;
        lineItems.push({
          name: 'Capital Expenditures',
          value: -capex,
          note: `Estimated as ${this.assumptions.capexPercentage}% of revenue`,
          isSubtotal: false
        });
      }
    }
    
    // 2. Future: Acquisitions, Asset Sales (placeholders for now)
    
    console.log(`✅ Investing CF: $${total.toLocaleString()} (CapEx: $${capex.toLocaleString()})`);
    
    return {
      capex: -capex,
      acquisitions: 0,
      assetSales: 0,
      lineItems,
      total,
      details: {
        capitalExpenditures: capex
      }
    };
  }

  /**
   * Calculate financing activities section
   */
  calculateFinancingActivities() {
    console.log('💼 Calculating financing activities...');
    
    const lineItems = [];
    let total = 0;
    
    // 1. Dividends (from retained earnings calculation)
    let dividends = 0;
    if (this.criticalItems.retainedEarnings) {
      const netIncome = this.getPnLValue(this.criticalItems.netIncome?.name || 'net income');
      const dividendPercentage = this.assumptions.dividendPolicy / 100;
      dividends = netIncome * dividendPercentage;
      
      if (dividends > 0) {
        total -= dividends; // Dividends are cash outflow (negative)
        lineItems.push({
          name: 'Dividends Paid',
          value: -dividends,
          note: `${this.assumptions.dividendPolicy}% of net income ($${netIncome.toLocaleString()})`,
          isSubtotal: false
        });
      }
    }
    
    // 2. Debt Changes (calculate from balance sheet)
    const debtChange = this.calculateDebtChanges();
    if (debtChange.netChange !== 0) {
      total += debtChange.netChange;
      
      if (debtChange.netChange > 0) {
        lineItems.push({
          name: 'Proceeds from Debt Issuance',
          value: debtChange.netChange,
          note: `Net increase in debt`,
          isSubtotal: false
        });
      } else {
        lineItems.push({
          name: 'Debt Repayments',
          value: debtChange.netChange,
          note: `Net decrease in debt`,
          isSubtotal: false
        });
      }
    }
    
    // 3. Equity Changes (calculate from balance sheet)
    if (this.criticalItems.commonStock) {
      const equityChange = this.getBalanceSheetChange(this.criticalItems.commonStock.name);
      if (equityChange.change !== 0) {
        total += equityChange.change;
        lineItems.push({
          name: equityChange.increase ? 'Proceeds from Stock Issuance' : 'Stock Repurchase',
          value: equityChange.change,
          note: `Common stock ${equityChange.increase ? 'increased' : 'decreased'} by $${Math.abs(equityChange.change).toLocaleString()}`,
          isSubtotal: false
        });
      }
    }
    
    console.log(`✅ Financing CF: $${total.toLocaleString()} (Dividends: -$${dividends.toLocaleString()}, Debt: $${debtChange.netChange.toLocaleString()})`);
    
    return {
      debtIssuance: Math.max(0, debtChange.netChange),
      debtRepayment: Math.min(0, debtChange.netChange),
      dividends: -dividends,
      equityIssuance: 0,
      lineItems,
      total,
      details: {
        dividendsPaid: dividends,
        netDebtChange: debtChange.netChange
      }
    };
  }

  /**
   * Calculate changes in debt (short-term + long-term)
   */
  calculateDebtChanges() {
    let totalDebtChange = 0;
    const debtItems = [];
    
    // Detect debt items from balance sheet
    Object.keys(this.bsCurrent).forEach(itemName => {
      const nameLower = itemName.toLowerCase();
      
      // Short-term debt patterns
      if (nameLower.includes('short') && nameLower.includes('debt') ||
          nameLower.includes('short') && nameLower.includes('loan') ||
          nameLower.includes('current') && nameLower.includes('debt')) {
        const change = this.getBalanceSheetChange(itemName);
        totalDebtChange += change.change;
        debtItems.push({ name: itemName, change: change.change });
      }
      
      // Long-term debt patterns
      if (nameLower.includes('long') && nameLower.includes('debt') ||
          nameLower.includes('long') && nameLower.includes('loan') ||
          nameLower === 'debt' ||
          nameLower === 'notes payable' ||
          nameLower.includes('bonds payable')) {
        const change = this.getBalanceSheetChange(itemName);
        totalDebtChange += change.change;
        debtItems.push({ name: itemName, change: change.change });
      }
    });
    
    console.log(`Debt changes: ${debtItems.length} debt items, net change: $${totalDebtChange.toLocaleString()}`);
    
    return {
      netChange: totalDebtChange,
      items: debtItems
    };
  }

  /**
   * Helper: Get balance sheet change for an item
   */
  getBalanceSheetChange(itemName) {
    if (!itemName) {
      return { current: 0, previous: 0, change: 0, increase: false, decrease: false };
    }
    
    const currentValue = this.bsCurrent[itemName]?.value || 0;
    const previousValue = this.bsPrevious[itemName]?.value || 0;
    const change = currentValue - previousValue;
    
    return {
      current: currentValue,
      previous: previousValue,
      change: change,
      increase: change > 0,
      decrease: change < 0
    };
  }

  /**
   * Helper: Get P&L value by name (with fuzzy matching)
   */
  getPnLValue(itemName) {
    if (!itemName || !this.pnlData) return 0;
    
    // Try exact match
    if (this.pnlData[itemName] !== undefined) {
      return Number(this.pnlData[itemName]) || 0;
    }
    
    // Try fuzzy matching
    const searchTerm = itemName.toLowerCase();
    const matchingKey = Object.keys(this.pnlData).find(key => 
      key.toLowerCase().includes(searchTerm) || 
      searchTerm.includes(key.toLowerCase())
    );
    
    if (matchingKey) {
      return Number(this.pnlData[matchingKey]) || 0;
    }
    
    return 0;
  }
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

/**
 * Switch configuration tabs
 */
function switchConfigTab(tabName) {
  console.log(`Switching to config tab: ${tabName}`);
  
  // Hide all panels
  document.querySelectorAll('.config-panel').forEach(panel => {
    panel.classList.remove('active');
  });
  
  // Remove active from all tabs
  document.querySelectorAll('.config-tab').forEach(tab => {
    tab.classList.remove('active');
  });
  
  // Show selected panel
  const selectedPanel = document.getElementById(`${tabName}-config`);
  if (selectedPanel) {
    selectedPanel.classList.add('active');
  }
  
  // Highlight selected tab
  const selectedTab = document.querySelector(`[data-config-tab="${tabName}"]`);
  if (selectedTab) {
    selectedTab.classList.add('active');
  }
  
  // Save preference
  localStorage.setItem('activeConfigTab', tabName);
}

/**
 * Initialize configuration tabs
 */
function initializeConfigTabs() {
  // Restore last active tab or default to 'model'
  const savedTab = localStorage.getItem('activeConfigTab') || 'model';
  
  // Add click handlers to all config tabs
  document.querySelectorAll('.config-tab').forEach(tab => {
    tab.addEventListener('click', function() {
      const tabName = this.getAttribute('data-config-tab');
      switchConfigTab(tabName);
    });
  });
  
  // Set initial active tab (already set in HTML to 'model', but respect saved preference)
  if (savedTab !== 'model') {
    switchConfigTab(savedTab);
  }
  
  console.log(`Initialized config tabs, active tab: ${savedTab}`);
}

/**
 * Initialize sidebar toggle functionality
 */
function initializeSidebarToggle() {
  const sidebar = document.getElementById('sidebar');
  const toggleBtn = document.getElementById('sidebarToggleBtn');
  
  if (!sidebar || !toggleBtn) {
    console.warn('Sidebar toggle elements not found');
    return;
  }
  
  // Restore sidebar state from localStorage (default: expanded)
  const sidebarState = localStorage.getItem('sidebarCollapsed');
  const isCollapsed = sidebarState === 'true';
  
  if (isCollapsed) {
    sidebar.classList.add('collapsed');
    toggleBtn.title = 'Expand sidebar';
  }
  
  // Toggle button click handler
  toggleBtn.addEventListener('click', () => {
    const isCurrentlyCollapsed = sidebar.classList.contains('collapsed');
    
    if (isCurrentlyCollapsed) {
      // Expand
      sidebar.classList.remove('collapsed');
      toggleBtn.title = 'Collapse sidebar';
      localStorage.setItem('sidebarCollapsed', 'false');
    } else {
      // Collapse
      sidebar.classList.add('collapsed');
      toggleBtn.title = 'Expand sidebar';
      localStorage.setItem('sidebarCollapsed', 'true');
    }
    
    console.log(`Sidebar ${isCurrentlyCollapsed ? 'expanded' : 'collapsed'}`);
  });
  
  // Keyboard shortcut: Ctrl+B to toggle sidebar
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'b') {
      e.preventDefault();
      toggleBtn.click();
    }
  });
  
  // Icon strip click handlers (when collapsed)
  const iconModel = document.getElementById('collapsedModel');
  const iconPnL = document.getElementById('collapsedPnL');
  const iconBalance = document.getElementById('collapsedBalance');
  const iconCash = document.getElementById('collapsedCash');
  const iconScenarios = document.getElementById('collapsedScenarios');
  
  // Model Config icon
  iconModel?.addEventListener('click', () => {
    sidebar.classList.remove('collapsed');
    toggleBtn.title = 'Collapse sidebar';
    localStorage.setItem('sidebarCollapsed', 'false');
    switchConfigTab('model');
  });
  
  // Tab icons - expand AND switch to that tab
  iconPnL?.addEventListener('click', () => {
    sidebar.classList.remove('collapsed');
    toggleBtn.title = 'Collapse sidebar';
    localStorage.setItem('sidebarCollapsed', 'false');
    switchConfigTab('pnl');
  });
  
  iconBalance?.addEventListener('click', () => {
    sidebar.classList.remove('collapsed');
    toggleBtn.title = 'Collapse sidebar';
    localStorage.setItem('sidebarCollapsed', 'false');
    switchConfigTab('balance');
  });
  
  iconCash?.addEventListener('click', () => {
    sidebar.classList.remove('collapsed');
    toggleBtn.title = 'Collapse sidebar';
    localStorage.setItem('sidebarCollapsed', 'false');
    switchConfigTab('cashflow');
  });
  
  iconScenarios?.addEventListener('click', () => {
    sidebar.classList.remove('collapsed');
    toggleBtn.title = 'Collapse sidebar';
    localStorage.setItem('sidebarCollapsed', 'false');
    switchConfigTab('scenarios');
  });
  
  console.log('✅ Sidebar toggle initialized');
}

/**
 * Initialize floating chat functionality
 */
function initializeFloatingChat() {
  const chatBubble = document.getElementById('chatBubble');
  const chatWidget = document.getElementById('chatWidget');
  const minimizeBtn = document.getElementById('chatMinimizeBtn');
  
  if (!chatBubble || !chatWidget || !minimizeBtn) {
    console.warn('Floating chat elements not found');
    return;
  }
  
  // Restore chat state from localStorage
  const chatState = localStorage.getItem('chatWidgetOpen');
  const isOpen = chatState === 'true';
  
  if (isOpen) {
    chatWidget.classList.add('open');
    chatBubble.style.display = 'none';
  }
  
  // Bubble click - expand chat
  chatBubble.addEventListener('click', () => {
    chatWidget.classList.add('open');
    chatBubble.style.display = 'none';
    localStorage.setItem('chatWidgetOpen', 'true');
    
    // Focus input
    const chatInput = document.getElementById('chatInput');
    if (chatInput) {
      setTimeout(() => chatInput.focus(), 300);
    }
  });
  
  // Minimize button - collapse to bubble
  minimizeBtn.addEventListener('click', () => {
    chatWidget.classList.remove('open');
    chatBubble.style.display = 'flex';
    localStorage.setItem('chatWidgetOpen', 'false');
  });
  
  // Show pulse on first visit
  const hasSeenChat = localStorage.getItem('hasSeenChat');
  if (!hasSeenChat) {
    chatBubble.classList.add('pulse');
    localStorage.setItem('hasSeenChat', 'true');
    
    // Remove pulse after 5 seconds
    setTimeout(() => {
      chatBubble.classList.remove('pulse');
    }, 5000);
  }
  
  console.log('✅ Floating chat initialized');
}

document.addEventListener('DOMContentLoaded', function () {
  console.log('DOM loaded, initializing...');
  console.log('JavaScript is running!');
  
  // Initialize configuration tabs
  initializeConfigTabs();
  
  // Initialize sidebar toggle
  initializeSidebarToggle();
  
  // Initialize floating chat
  initializeFloatingChat();
  
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
  
  // Seasonal preset patterns
  const seasonalPresets = {
    none: [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0],
    retail: [0.8, 0.9, 1.0, 1.0, 1.0, 1.0, 0.9, 0.9, 0.9, 1.1, 1.3, 1.5],
    saas: [1.0, 1.0, 1.0, 1.05, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 0.95],
    construction: [0.7, 0.8, 0.9, 1.1, 1.2, 1.3, 1.3, 1.2, 1.1, 1.0, 0.9, 0.8],
    custom: [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0]
  };
  
  const monthInputIds = ['jan-mult', 'feb-mult', 'mar-mult', 'apr-mult', 'may-mult', 'jun-mult', 
                         'jul-mult', 'aug-mult', 'sep-mult', 'oct-mult', 'nov-mult', 'dec-mult'];
  
  seasonalPatternEl?.addEventListener('change', function() {
    const selectedPattern = this.value;
    const multipliersContainer = document.getElementById('seasonal-multipliers');
    
    // Show/hide multipliers grid
    if (multipliersContainer) {
      if (selectedPattern === 'none') {
        multipliersContainer.style.display = 'none';
      } else {
        multipliersContainer.style.display = 'block';
        
        // Load preset values into the grid
        const presetValues = seasonalPresets[selectedPattern] || seasonalPresets.custom;
        monthInputIds.forEach((id, index) => {
          const input = document.getElementById(id);
          if (input) {
            input.value = presetValues[index];
          }
        });
        
        console.log(`Loaded ${selectedPattern} seasonal pattern:`, presetValues);
      }
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

  // Balance Sheet Assumptions Controls
  const bsControls = {
    dso: document.getElementById('bsDSO'),
    dpo: document.getElementById('bsDPO'),
    dio: document.getElementById('bsDIO'),
    depreciationRate: document.getElementById('bsDepreciationRate'),
    capexPercentage: document.getElementById('bsCapexPercentage'),
    dividendPolicy: document.getElementById('bsDividendPolicy'),
    cashTarget: document.getElementById('bsCashTarget'),
    accruedExpenses: document.getElementById('bsAccruedExpenses'),
    prepaidExpenses: document.getElementById('bsPrepaidExpenses')
  };

  // Update balanceSheetAssumptions when controls change
  Object.keys(bsControls).forEach(key => {
    const element = bsControls[key];
    if (element) {
      element.addEventListener('change', function() {
        const value = parseFloat(this.value) || 0;
        
        // Map UI field names to assumption object keys
        const assumptionKey = {
          'dso': 'dso',
          'dpo': 'dpo',
          'dio': 'dio',
          'depreciationRate': 'depreciationRate',
          'capexPercentage': 'capexPercentage',
          'dividendPolicy': 'dividendPolicy',
          'cashTarget': 'cashTarget',
          'accruedExpenses': 'accruedExpensesPercentage',
          'prepaidExpenses': 'prepaidExpensesPercentage'
        }[key];
        
        balanceSheetAssumptions[assumptionKey] = value;
        console.log(`Updated ${assumptionKey} to ${value}`);
        
        // Optionally auto-update forecast (user can also click "Run Forecasts")
        // For now, user must click "Run Forecasts" to see changes
      });
    }
  });

  // Reset to defaults button
  const bsResetBtn = document.getElementById('bsResetBtn');
  bsResetBtn?.addEventListener('click', function() {
    // Reset all controls to default values
    Object.keys(DEFAULT_BS_ASSUMPTIONS).forEach(key => {
      balanceSheetAssumptions[key] = DEFAULT_BS_ASSUMPTIONS[key];
    });
    
    // Update UI
    if (bsControls.dso) bsControls.dso.value = DEFAULT_BS_ASSUMPTIONS.dso;
    if (bsControls.dpo) bsControls.dpo.value = DEFAULT_BS_ASSUMPTIONS.dpo;
    if (bsControls.dio) bsControls.dio.value = DEFAULT_BS_ASSUMPTIONS.dio;
    if (bsControls.depreciationRate) bsControls.depreciationRate.value = DEFAULT_BS_ASSUMPTIONS.depreciationRate;
    if (bsControls.capexPercentage) bsControls.capexPercentage.value = DEFAULT_BS_ASSUMPTIONS.capexPercentage;
    if (bsControls.dividendPolicy) bsControls.dividendPolicy.value = DEFAULT_BS_ASSUMPTIONS.dividendPolicy;
    if (bsControls.cashTarget) bsControls.cashTarget.value = DEFAULT_BS_ASSUMPTIONS.cashTarget;
    if (bsControls.accruedExpenses) bsControls.accruedExpenses.value = DEFAULT_BS_ASSUMPTIONS.accruedExpensesPercentage;
    if (bsControls.prepaidExpenses) bsControls.prepaidExpenses.value = DEFAULT_BS_ASSUMPTIONS.prepaidExpensesPercentage;
    
    console.log('Balance sheet assumptions reset to defaults');
    
    // Show confirmation
    const originalText = bsResetBtn.textContent;
    bsResetBtn.textContent = '✓ Reset Complete';
    bsResetBtn.style.background = '#27ae60';
    setTimeout(() => {
      bsResetBtn.textContent = originalText;
      bsResetBtn.style.background = '';
    }, 1500);
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

  // Balance sheet help - show individual explanations
  const bsHelpContent = {
    'DSO': {
      title: 'DSO (Days Sales Outstanding)',
      explanation: 'Average number of days it takes to collect payment from customers after a sale. Lower is better for cash flow. Typical range: 30-60 days.'
    },
    'DPO': {
      title: 'DPO (Days Payable Outstanding)',
      explanation: 'Average number of days you take to pay suppliers. Higher means you hold onto cash longer. Typical range: 30-45 days.'
    },
    'DIO': {
      title: 'DIO (Days Inventory Outstanding)',
      explanation: 'Average number of days inventory sits before being sold. Lower is better (less cash tied up). Typical range: 30-90 days depending on industry.'
    },
    'Depreciation Rate': {
      title: 'Depreciation Rate',
      explanation: 'Annual percentage rate at which fixed assets lose value. Used to calculate depreciation expense and PPE. Typical range: 5-20% depending on asset type.'
    },
    'CapEx % of Revenue': {
      title: 'CapEx % of Revenue',
      explanation: 'Capital expenditures (investments in fixed assets) as a percentage of revenue. Reflects growth and maintenance needs. Typical range: 2-10%.'
    },
    'Dividend Policy': {
      title: 'Dividend Policy',
      explanation: 'Percentage of net income paid to shareholders as dividends. Affects retained earnings and cash flow. Typical range: 0-50% (growth companies often pay 0%).'
    },
    'Cash Target': {
      title: 'Cash Target',
      explanation: 'Minimum cash buffer measured in days of operating expenses. Used for cash management and balancing. Typical range: 15-60 days.'
    },
    'Accrued Expenses': {
      title: 'Accrued Expenses',
      explanation: 'Expenses incurred but not yet paid, as percentage of total expenses. Affects liabilities and cash flow timing. Typical range: 3-10%.'
    },
    'Prepaid Expenses': {
      title: 'Prepaid Expenses',
      explanation: 'Expenses paid in advance, as percentage of revenue. Affects assets and cash flow timing. Typical range: 0.5-3%.'
    }
  };

  // Add click handlers to BS info icons
  document.querySelectorAll('.bs-info-icon').forEach(icon => {
    icon.addEventListener('click', function(e) {
      e.preventDefault();
      
      // Get the label text before the icon
      const label = this.parentElement.querySelector('span:first-child');
      const labelText = label ? label.textContent.trim() : '';
      
      const helpInfo = bsHelpContent[labelText];
      
      if (helpInfo) {
        // Create simple alert-style modal
        const alertContent = `${helpInfo.title}\n\n${helpInfo.explanation}`;
        alert(alertContent);
      }
    });
  });

  // Run forecast button
  runBtn?.addEventListener('click', function() {
    console.log('Run Forecast clicked');
    updateForecast();
  });

  // Upload
  const fileEl = document.getElementById('actualsFile');
  const uploadStatus = document.getElementById('uploadStatus');
  
  fileEl?.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) {
      console.log('File uploaded:', file.name);
      
      // Update status display
      if (uploadStatus) {
        uploadStatus.textContent = `✓ ${file.name}`;
        uploadStatus.classList.add('has-file');
      }
      
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
