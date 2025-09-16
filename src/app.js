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
      notes.push(monthsInQ < 3 ? `Partial actuals (${monthsInQ}/3 months)` : '');
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
        val = entry.values.reduce((s, v) => s + (Number(v) || 0), 0);
      }
      values.push(val);
      notes.push(monthsInY < 12 ? `Partial actuals (${monthsInY}/12 months)` : '');
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
  
  if (growthRateInput) {
    if (method === 'custom') {
      growthRateInput.disabled = false;
    } else {
      growthRateInput.disabled = true;
    }
  }
}

/**
 * Generate dynamic table headers based on periods
 */
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
  const headers = generateTableHeaders(periods, periodType, actualLabels, forecastStartFrom);

  const statementHeaderLabel =
    statementKey === 'pnl' ? 'P&L' :
    statementKey === 'balance' ? 'Balance Sheet' :
    'Cash Flow';

  const tableId = `${scope}${statementKey}table`;

  let tableHTML = `
    <div class="statement-section">
      <div class="statement-header">${statementHeaderLabel}</div>
      <div class="table-container">
        <table id="${tableId}">
          <thead>
            <tr>
  `;

  headers.forEach((header, index) => {
    let className = '';
    if (index === 0) {
      className = '';
    } else if (index <= (actualLabels.length)) {
      className = 'actual';
    } else {
      className = 'forecast';
    }
    let noteHtml = '';
    if (className === 'actual' && noteByIndex[index - 1]) {
      noteHtml = ` <span class="note-badge" title="${noteByIndex[index - 1]}">•</span>`;
    }
    tableHTML += `<th class="${className}">${header}${noteHtml}</th>`;
  });

  tableHTML += `
            </tr>
          </thead>
          <tbody>
  `;

  // Add rows for each line item
  const lineItems = uploadedLineItems[statementKey] || [];
  lineItems.forEach((item) => {
    const isTotal = /\btotal\b/i.test(item.name);
    const isSubheader = (!item.actualValues || item.actualValues.length === 0) && !isTotal;
    const rowClass = isTotal ? 'total-row' : '';
    const nameCellClass = 'metric-name';
    tableHTML += `
      <tr class="${rowClass}">
        <td class="${nameCellClass}">${item.name}</td>
    `;

    // Add historical actual values (aggregated per period type)
    let actualsForItem = [];
    if (periodType === 'monthly') {
      actualsForItem = (item.actualValues || []).slice();
    } else {
      const agg = aggregatedPerItem.get(item.name);
      actualsForItem = agg ? (agg.actuals || []) : [];
    }
    actualsForItem.forEach(value => {
      const display = isSubheader ? '' : formatCurrency(value);
      tableHTML += `<td class="number actual">${display}</td>`;
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
  `;

  container.innerHTML = tableHTML;
  // Add scroll hint element and toggle based on overflow
  const tc = container.querySelector('.table-container');
  if (tc) {
    const hint = document.createElement('div');
    hint.className = 'scroll-hint';
    hint.textContent = 'Scroll →';
    tc.appendChild(hint);
    const updateHint = () => {
      if (tc.scrollWidth > tc.clientWidth + 4) tc.classList.add('is-clipped'); else tc.classList.remove('is-clipped');
    };
    updateHint();
    const ro = new ResizeObserver(updateHint);
    ro.observe(tc);
    tc.addEventListener('scroll', () => {
      if (tc.scrollLeft > 10) tc.classList.remove('is-clipped'); else updateHint();
    });
  }
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

  let revGrowth = growthRate / 100;
  let expGrowth = (growthRate * 0.8) / 100;

  if (method === 'rolling') {
    revGrowth = 0.03;
    expGrowth = 0.02;
  } else if (method === 'threemonth') {
    revGrowth = 0.02;
    expGrowth = 0.015;
  }

  // Update all forecast views with dynamic periods
  updateDynamicForecasts(revGrowth, expGrowth, periods);
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
        // Non-negative constraints: totals/expenses shouldn't flip sign unintentionally
        const clamp = (v) => (/total/i.test(item.name) ? Math.max(v, 0) : v);
        const mForecast = clamp(baseValue * Math.pow(1 + itemGrowth, i + 1));
        const qForecast = clamp(baseQuarterly * Math.pow(1 + itemGrowth, i + 1));
        const yForecast = clamp(baseYearly * Math.pow(1 + itemGrowth, i + 1));
        // Update monthly
        document.querySelectorAll(`[data-forecast-key="${forecastKeyMonthly}"]`).forEach(cell => {
          updateElement(cell.id, formatCurrency(mForecast, !hasUploadedData));
        });
        // Update quarterly based on base of rolled-up last quarter
        document.querySelectorAll(`[data-forecast-key="${forecastKeyQuarterly}"]`).forEach(cell => {
          updateElement(cell.id, formatCurrency(qForecast, !hasUploadedData));
        });
        // Update yearly based on base of rolled-up last year
        document.querySelectorAll(`[data-forecast-key="${forecastKeyYearly}"]`).forEach(cell => {
          updateElement(cell.id, formatCurrency(yForecast, !hasUploadedData));
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

function handleActualsUpload(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      console.log('Parsing CSV...');
      const data = parseCSVToObject(reader.result);
      console.log('Parsed data:', data);
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
 * Boot
 */
document.addEventListener('DOMContentLoaded', function () {
  console.log('DOM loaded, initializing...');
  
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
});
