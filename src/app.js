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
 * Create dynamic table structure - SIMPLIFIED VERSION WITH SLIDER ONLY
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
      <div class="table-container" style="width: 100%; max-width: 100vw; overflow-x: auto; overflow-y: hidden; border: 1px solid #dee2e6;">
        <table id="${tableId}" style="min-width: 1200px; border-collapse: collapse;">
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
    tableHTML += `<th class="${className}" style="padding: 8px 12px; border: 1px solid #ddd; white-space: nowrap; min-width: 100px;">${header}${noteHtml}</th>`;
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
    const heuristicSubheader = (!item.actualValues || item.actualValues.length === 0) && !isTotal;
    const manualSubheader = isSubheaderOverridden(statementKey, item.name);
    const isSubheader = manualSubheader || heuristicSubheader;
    const rowClass = isTotal ? 'total-row' : '';
    const nameCellClass = 'metric-name';
    tableHTML += `
      <tr class="${rowClass}">
        <td class="${nameCellClass}" style="padding: 8px 12px; border: 1px solid #ddd; white-space: nowrap; position: sticky; left: 0; background: white; z-index: 2; min-width: 200px;">
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
    actualsForItem.forEach(value => {
      const display = isSubheader ? '' : formatCurrency(value);
      tableHTML += `<td class="number actual" style="padding: 8px 12px; border: 1px solid #ddd; text-align: right; white-space: nowrap; background: #e3f2fd;">${display}</td>`;
    });

    // Add forecast columns
    const forecastPeriods = periods;
    const safeName = item.name.toLowerCase().replace(/\s+/g, '');
    for (let i = 0; i < forecastPeriods; i++) {
      const forecastKey = `${periodType}-${statementKey}-${safeName}-${i}`;
      const scopedId = `${scope}-${forecastKey}`;
      const defaultVal = isSubheader ? '' : '$0';
      tableHTML += `<td class="number forecast" id="${scopedId}" data-forecast-key="${forecastKey}" style="padding: 8px 12px; border: 1px solid #ddd; text-align: right; white-space: nowrap; background: #f3e5f5;">${defaultVal}</td>`;
    }

    tableHTML += `</tr>`;
  });

  tableHTML += `
          </tbody>
        </table>
      </div>
      <div class="table-slider" style="padding: 10px; background: #f8f9fa; border: 1px solid #dee2e6; border-top: none;">
        <input type="range" min="0" max="100" value="0" style="width: 100%; height: 6px; background: #dee2e6; border-radius: 3px; outline: none; cursor: pointer;" aria-label="Scroll table horizontally" />
        <div style="display: flex; justify-content: space-between; font-size: 12px; color: #6c757d; margin-top: 4px;">
          <span>Start</span>
          <span>Scroll to navigate table</span>
          <span>End</span>
        </div>
      </div>
    </div>
  `;

  container.innerHTML = tableHTML;
  
  // Setup ONLY the slider functionality
  const tc = container.querySelector('.table-container');
  const sliderContainer = container.querySelector('.table-slider');
  const slider = sliderContainer?.querySelector('input[type="range"]');
  
  if (tc && slider) {
    // Function to update slider position based on table scroll
    const updateSlider = () => {
      const maxScroll = Math.max(tc.scrollWidth - tc.clientWidth, 0);
      if (maxScroll <= 1) {
        slider.disabled = true;
        sliderContainer.style.opacity = '0.5';
      } else {
        slider.disabled = false;
        sliderContainer.style.opacity = '1';
        const ratio = tc.scrollLeft / maxScroll;
        slider.value = String(Math.round(ratio * 100));
      }
    };

    // Function to scroll table based on slider position
    const updateTableScroll = () => {
      const val = Number(slider.value) || 0;
      const maxScroll = Math.max(tc.scrollWidth - tc.clientWidth, 0);
      tc.scrollLeft = (val / 100) * maxScroll;
    };

    // Event listeners
    slider.addEventListener('input', updateTableScroll);
    tc.addEventListener('scroll', updateSlider);
    
    // Handle window resize
    const resizeObserver = new ResizeObserver(updateSlider);
    resizeObserver.observe(tc);
    
    // Initial update
    setTimeout(updateSlider, 100); // Small delay to ensure table is rendered
    
    console.log(`Table setup complete for ${containerId}:`, {
      tableWidth: tc.scrollWidth,
      containerWidth: tc.clientWidth,
      canScroll: tc.scrollWidth > tc.clientWidth
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
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\  if (data.pnl.length === 0 && data.balance.length === 0 && data.cashflow.length === 0) {');
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
 * Inject required CSS for slider functionality
 */
function injectSliderCSS() {
  if (!document.getElementById('table-scroll-styles')) {
    const styleSheet = document.createElement('style');
    styleSheet.id = 'table-scroll-styles';
    styleSheet.innerHTML = `
      .table-container {
        scroll-behavior: smooth;
      }

      .table-slider input[type="range"] {
        appearance: none;
        -webkit-appearance: none;
      }

      .table-slider input[type="range"]::-webkit-slider-thumb {
        appearance: none;
        -webkit-appearance: none;
        width: 20px;
        height: 20px;
        background: #007bff;
        border-radius: 50%;
        cursor: pointer;
        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
      }

      .table-slider input[type="range"]::-webkit-slider-track {
        height: 6px;
        background: #dee2e6;
        border-radius: 3px;
      }

      .table-slider input[type="range"]::-moz-range-thumb {
        width: 20px;
        height: 20px;
        background: #007bff;
        border-radius: 50%;
        cursor: pointer;
        border: none;
        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
      }

      .table-slider input[type="range"]::-moz-range-track {
        height: 6px;
        background: #dee2e6;
        border-radius: 3px;
        border: none;
      }
    `;
    document.head.appendChild(styleSheet);
  }
}

/**
 * Boot
 */
document.addEventListener('DOMContentLoaded', function () {
  console.log('DOM loaded, initializing...');
  
  // Inject CSS for slider functionality
  injectSliderCSS();
  
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
  // Force monthly tab active by default
  showTab('monthly', document.querySelector('.tabs .tab[data-tab="monthly"]'));
  rebuildAllTables();
  updateForecast();
  
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
});
