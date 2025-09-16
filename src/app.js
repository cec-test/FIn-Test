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
function generateTableHeaders(periods, periodType) {
  const headers = ['Item'];
  
  // Add all historical date columns first
  if (dateColumns && dateColumns.length > 0) {
    dateColumns.forEach(date => {
      headers.push(date);
    });
  }
  
  // Then add forecast periods
  if (periodType === 'monthly') {
    for (let i = 0; i < periods; i++) {
      const date = new Date();
      date.setMonth(date.getMonth() + i);
      headers.push(date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }));
    }
  } else if (periodType === 'quarterly') {
    const quarters = Math.ceil(periods / 3);
    for (let i = 0; i < quarters; i++) {
      const quarter = (i % 4) + 1;
      const year = new Date().getFullYear() + Math.floor(i / 4);
      headers.push(`Q${quarter} ${year}`);
    }
  } else if (periodType === 'yearly') {
    const years = Math.ceil(periods / 12);
    for (let i = 0; i < years; i++) {
      headers.push(`${new Date().getFullYear() + i}`);
    }
  }
  
  return headers;
}

/**
 * Create dynamic table structure
 */
function createDynamicTable(containerId, statementType, periodType) {
  const container = document.getElementById(containerId);
  if (!container) return;
  
  const periods = parseInt(document.getElementById('forecastPeriods')?.value) || 12;
  const headers = generateTableHeaders(periods, periodType);
  
  let tableHTML = `
    <div class="statement-section">
      <div class="statement-header">${statementType}</div>
      <div class="table-container">
        <table id="${statementType.toLowerCase().replace(/\s+/g, '')}Table">
          <thead>
            <tr>
  `;
  
  headers.forEach((header, index) => {
    let className = '';
    if (index === 0) {
      className = ''; // Item column
    } else if (dateColumns && index <= dateColumns.length) {
      className = 'actual'; // Historical data columns
    } else {
      className = 'forecast'; // Forecast columns
    }
    tableHTML += `<th class="${className}">${header}</th>`;
  });
  
  tableHTML += `
            </tr>
          </thead>
          <tbody>
  `;
  
  // Add rows for each line item
  const lineItems = uploadedLineItems[statementType.toLowerCase().replace(/\s+/g, '')] || [];
  lineItems.forEach((item, index) => {
    tableHTML += `
      <tr>
        <td class="metric-name">${item.name}</td>
    `;
    
    // Add historical actual values
    if (item.actualValues && item.actualValues.length > 0) {
      item.actualValues.forEach(value => {
        tableHTML += `<td class="number actual">${formatCurrency(value)}</td>`;
      });
    }
    
    // Add forecast columns
    const forecastPeriods = periods;
    for (let i = 0; i < forecastPeriods; i++) {
      const cellId = `${statementType.toLowerCase().replace(/\s+/g, '')}${item.name.toLowerCase().replace(/\s+/g, '')}${i}`;
      tableHTML += `<td class="number forecast" id="${cellId}">$0</td>`;
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
      // Calculate growth rate for this item
      let itemGrowth = revGrowth;
      if (statementType === 'pnl' && item.name.toLowerCase().includes('expense')) {
        itemGrowth = expGrowth;
      } else if (statementType === 'balance' && item.name.toLowerCase().includes('cash')) {
        // Cash grows with net income
        itemGrowth = revGrowth;
      }
      
      // Use the most recent actual value as base
      const baseValue = item.actualValues && item.actualValues.length > 0 ? 
        item.actualValues[item.actualValues.length - 1] : item.actual;
      
      // Update forecast columns
      for (let i = 0; i < periods; i++) {
        const cellId = `${statementType}${item.name.toLowerCase().replace(/\s+/g, '')}${i}`;
        const forecast = baseValue * Math.pow(1 + itemGrowth, i + 1);
        updateElement(cellId, formatCurrency(forecast, !hasUploadedData));
      }
    });
  });
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
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) throw new Error('CSV must have at least a header and one data row');
  
  // Parse the header row to get date columns
  const headerRow = lines[0].split(',');
  dateColumns = headerRow.slice(1).map(col => col.trim().replace(/"/g, ''));
  
  const data = {
    pnl: [],
    balance: [],
    cashflow: []
  };
  
  let currentStatement = null;
  
  // Process each data row
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim().replace(/"/g, ''));
    if (values.length < 2) continue;
    
    const firstColumn = values[0].trim();
    
    // Check if this is a statement header
    if (firstColumn === 'P&L' || firstColumn === 'Balance Sheet' || firstColumn === 'Cashflows') {
      currentStatement = firstColumn.toLowerCase().replace(/\s+/g, '');
      if (currentStatement === 'p&l') currentStatement = 'pnl';
      continue;
    }
    
    // Skip empty rows or section headers
    if (!firstColumn || firstColumn === '' || firstColumn.includes('Assets') || firstColumn.includes('Liabilities') || firstColumn.includes('Equity')) {
      continue;
    }
    
    // This is a line item
    if (currentStatement && firstColumn) {
      const lineItemName = firstColumn;
      const actualValues = [];
      
      // Extract values from date columns
      for (let j = 1; j < values.length && j < dateColumns.length + 1; j++) {
        const value = toNumberOrZero(values[j]);
        actualValues.push(value);
      }
      
      // Only add if we have actual values
      if (actualValues.some(v => v !== 0)) {
        data[currentStatement].push({
          name: lineItemName,
          actual: actualValues[actualValues.length - 1], // Use most recent value
          actualValues: actualValues,
          statement: currentStatement
        });
      }
    }
  }
  
  return data;
}

function toNumberOrZero(v) {
  if (v == null || v === '') return 0;
  const n = Number(String(v).replace(/[\$,]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function applyActualsFromObject(data) {
  // Clear existing data
  uploadedLineItems = { pnl: [], balance: [], cashflow: [] };
  sampleData = {};
  
  // Process each statement type
  Object.keys(data).forEach(statementType => {
    if (['pnl', 'profit', 'income'].includes(statementType)) {
      uploadedLineItems.pnl = data[statementType];
    } else if (['balance', 'balancesheet'].includes(statementType)) {
      uploadedLineItems.balance = data[statementType];
    } else if (['cashflow', 'cash'].includes(statementType)) {
      uploadedLineItems.cashflow = data[statementType];
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
  createDynamicTable('combinedPnlContainer', 'P&L', 'monthly');
  createDynamicTable('combinedBalanceContainer', 'Balance Sheet', 'monthly');
  createDynamicTable('combinedCashflowContainer', 'Cash Flow', 'monthly');
  
  createDynamicTable('monthlyPnlContainer', 'P&L', 'monthly');
  createDynamicTable('monthlyBalanceContainer', 'Balance Sheet', 'monthly');
  createDynamicTable('monthlyCashflowContainer', 'Cash Flow', 'monthly');
  
  createDynamicTable('quarterlyPnlContainer', 'P&L', 'quarterly');
  createDynamicTable('quarterlyBalanceContainer', 'Balance Sheet', 'quarterly');
  createDynamicTable('quarterlyCashflowContainer', 'Cash Flow', 'quarterly');
  
  createDynamicTable('yearlyPnlContainer', 'P&L', 'yearly');
  createDynamicTable('yearlyBalanceContainer', 'Balance Sheet', 'yearly');
  createDynamicTable('yearlyCashflowContainer', 'Cash Flow', 'yearly');
}

function handleActualsUpload(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = parseCSVToObject(reader.result);
      applyActualsFromObject(data);
    } catch (e) {
      alert('Failed to parse CSV: ' + e.message);
    }
  };
  reader.readAsText(file);
}

/**
 * Export functions
 */
function exportCombinedData() {
  const tables = ['combinedpnltable', 'combinedbalancetable', 'combinedcashflowtable'];
  exportMultipleTables(tables, 'combined_3_statement_model');
}

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
      csvContent += `Statement ${index + 1}\n`;
      
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

// Expose functions globally
window.exportCombinedData = exportCombinedData;
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

  // Periods change handler - rebuild tables when periods change
  periodsEl?.addEventListener('change', function() {
    if (hasUploadedData) {
      rebuildAllTables();
      updateForecast();
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
  
  console.log('Initialization complete');
});
