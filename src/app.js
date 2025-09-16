'use strict';

/**
 * App state: base actuals used for forecasts.
 * Replace via CSV upload to drive forecasts from your own numbers.
 */
let sampleData = {
  revenue: 385007,
  expenses: 285669,
  netIncome: 99338,
  cash: 2010,
  assets: 22700,
  equity: 478179
};

let hasUploadedData = false;

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

  // Update all forecast views
  updateCombinedForecasts(revGrowth, expGrowth);
  updateMonthlyForecasts(revGrowth, expGrowth);
  updateQuarterlyForecasts(revGrowth, expGrowth);
  updateYearlyForecasts(revGrowth, expGrowth);
}

/**
 * Forecast calculators for different periods
 */
function updateCombinedForecasts(revGrowth, expGrowth) {
  for (let i = 1; i <= 3; i++) {
    const revForecast = sampleData.revenue * Math.pow(1 + revGrowth, i);
    const expForecast = sampleData.expenses * Math.pow(1 + expGrowth, i);
    const niForecast = revForecast - expForecast;

    updateElement(`crev${i}`, formatCurrency(revForecast, !hasUploadedData));
    updateElement(`cexp${i}`, formatCurrency(expForecast, !hasUploadedData));
    updateElement(`cni${i}`, formatCurrency(niForecast, !hasUploadedData), niForecast);

    // Balance Sheet
    const cashBalance = sampleData.cash + (sampleData.netIncome * Math.pow(1 + revGrowth, i));
    const assetsForecast = sampleData.assets * Math.pow(1 + revGrowth * 0.6, i) + (cashBalance - sampleData.cash);
    const equityForecast = sampleData.equity + (cashBalance - sampleData.cash);

    updateElement(`ccash${i}`, formatCurrency(cashBalance, !hasUploadedData));
    updateElement(`cassets${i}`, formatCurrency(assetsForecast, !hasUploadedData));
    updateElement(`cequity${i}`, formatCurrency(equityForecast, !hasUploadedData));

    // Cash Flow
    const ocfForecast = niForecast * 1.1;
    updateElement(`ccfni${i}`, formatCurrency(niForecast, !hasUploadedData));
    updateElement(`cocf${i}`, formatCurrency(ocfForecast, !hasUploadedData));
    updateElement(`cfcf${i}`, formatCurrency(ocfForecast, !hasUploadedData));
    updateElement(`cncc${i}`, formatCurrency(niForecast, !hasUploadedData));
  }
}

function updateMonthlyForecasts(revGrowth, expGrowth) {
  for (let i = 1; i <= 5; i++) {
    const revForecast = sampleData.revenue * Math.pow(1 + revGrowth, i);
    const expForecast = sampleData.expenses * Math.pow(1 + expGrowth, i);
    const niForecast = revForecast - expForecast;

    updateElement(`mrev${i}`, formatCurrency(revForecast, !hasUploadedData));
    updateElement(`mexp${i}`, formatCurrency(expForecast, !hasUploadedData));
    updateElement(`mni${i}`, formatCurrency(niForecast, !hasUploadedData), niForecast);

    // Balance Sheet
    const cashBalance = sampleData.cash + (sampleData.netIncome * Math.pow(1 + revGrowth, i));
    const assetsForecast = sampleData.assets * Math.pow(1 + revGrowth * 0.6, i) + (cashBalance - sampleData.cash);
    const equityForecast = sampleData.equity + (cashBalance - sampleData.cash);

    updateElement(`mcash${i}`, formatCurrency(cashBalance, !hasUploadedData));
    updateElement(`massets${i}`, formatCurrency(assetsForecast, !hasUploadedData));
    updateElement(`mequity${i}`, formatCurrency(equityForecast, !hasUploadedData));

    // Cash Flow
    const ocfForecast = niForecast * 1.1;
    updateElement(`mcfni${i}`, formatCurrency(niForecast, !hasUploadedData));
    updateElement(`mocf${i}`, formatCurrency(ocfForecast, !hasUploadedData));
    updateElement(`mfcf${i}`, formatCurrency(ocfForecast, !hasUploadedData));
    updateElement(`mncc${i}`, formatCurrency(niForecast, !hasUploadedData));
  }
}

function updateQuarterlyForecasts(revGrowth, expGrowth) {
  for (let i = 1; i <= 3; i++) {
    // Quarterly = 3x monthly growth
    const quarterlyRevGrowth = revGrowth * 3;
    const quarterlyExpGrowth = expGrowth * 3;
    
    const revForecast = sampleData.revenue * Math.pow(1 + quarterlyRevGrowth, i);
    const expForecast = sampleData.expenses * Math.pow(1 + quarterlyExpGrowth, i);
    const niForecast = revForecast - expForecast;

    updateElement(`qrev${i}`, formatCurrency(revForecast, !hasUploadedData));
    updateElement(`qexp${i}`, formatCurrency(expForecast, !hasUploadedData));
    updateElement(`qni${i}`, formatCurrency(niForecast, !hasUploadedData), niForecast);

    // Balance Sheet
    const cashBalance = sampleData.cash + (sampleData.netIncome * Math.pow(1 + quarterlyRevGrowth, i));
    const assetsForecast = sampleData.assets * Math.pow(1 + quarterlyRevGrowth * 0.6, i) + (cashBalance - sampleData.cash);
    const equityForecast = sampleData.equity + (cashBalance - sampleData.cash);

    updateElement(`qcash${i}`, formatCurrency(cashBalance, !hasUploadedData));
    updateElement(`qassets${i}`, formatCurrency(assetsForecast, !hasUploadedData));
    updateElement(`qequity${i}`, formatCurrency(equityForecast, !hasUploadedData));

    // Cash Flow
    const ocfForecast = niForecast * 1.1;
    updateElement(`qcfni${i}`, formatCurrency(niForecast, !hasUploadedData));
    updateElement(`qocf${i}`, formatCurrency(ocfForecast, !hasUploadedData));
    updateElement(`qfcf${i}`, formatCurrency(ocfForecast, !hasUploadedData));
    updateElement(`qncc${i}`, formatCurrency(niForecast, !hasUploadedData));
  }
}

function updateYearlyForecasts(revGrowth, expGrowth) {
  for (let i = 1; i <= 3; i++) {
    // Yearly = 12x monthly growth
    const yearlyRevGrowth = revGrowth * 12;
    const yearlyExpGrowth = expGrowth * 12;
    
    const revForecast = sampleData.revenue * Math.pow(1 + yearlyRevGrowth, i);
    const expForecast = sampleData.expenses * Math.pow(1 + yearlyExpGrowth, i);
    const niForecast = revForecast - expForecast;

    updateElement(`yrev${i}`, formatCurrency(revForecast, !hasUploadedData));
    updateElement(`yexp${i}`, formatCurrency(expForecast, !hasUploadedData));
    updateElement(`yni${i}`, formatCurrency(niForecast, !hasUploadedData), niForecast);

    // Balance Sheet
    const cashBalance = sampleData.cash + (sampleData.netIncome * Math.pow(1 + yearlyRevGrowth, i));
    const assetsForecast = sampleData.assets * Math.pow(1 + yearlyRevGrowth * 0.6, i) + (cashBalance - sampleData.cash);
    const equityForecast = sampleData.equity + (cashBalance - sampleData.cash);

    updateElement(`ycash${i}`, formatCurrency(cashBalance, !hasUploadedData));
    updateElement(`yassets${i}`, formatCurrency(assetsForecast, !hasUploadedData));
    updateElement(`yequity${i}`, formatCurrency(equityForecast, !hasUploadedData));

    // Cash Flow
    const ocfForecast = niForecast * 1.1;
    updateElement(`ycfni${i}`, formatCurrency(niForecast, !hasUploadedData));
    updateElement(`yocf${i}`, formatCurrency(ocfForecast, !hasUploadedData));
    updateElement(`yfcf${i}`, formatCurrency(ocfForecast, !hasUploadedData));
    updateElement(`yncc${i}`, formatCurrency(niForecast, !hasUploadedData));
  }
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
 * CSV Upload handling
 */
function parseCSVToObject(text) {
  const [headerLine, ...rows] = text.trim().split(/\r?\n/);
  if (!headerLine) throw new Error('Missing header row');
  const headers = headerLine.split(',').map(h => h.trim().toLowerCase());
  if (!rows.length) throw new Error('No data rows found');

  const first = rows[0].split(',').map(x => x.trim());
  const obj = {};
  headers.forEach((h, i) => { obj[h] = first[i]; });
  return obj;
}

function toNumberOrZero(v) {
  if (v == null || v === '') return 0;
  const n = Number(String(v).replace(/[\$,]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function applyActualsFromObject(o) {
  const next = {
    revenue: toNumberOrZero(o.revenue ?? o.totalrevenue),
    expenses: toNumberOrZero(o.expenses ?? o.operatingexpenses),
    netIncome: toNumberOrZero(o.netincome),
    cash: toNumberOrZero(o.cash ?? o.cashbalance),
    assets: toNumberOrZero(o.assets ?? o.totalassets),
    equity: toNumberOrZero(o.equity ?? o.totalequity)
  };

  sampleData = {
    revenue: next.revenue || sampleData.revenue,
    expenses: next.expenses || sampleData.expenses,
    netIncome: next.netIncome || sampleData.netIncome,
    cash: next.cash || sampleData.cash,
    assets: next.assets || sampleData.assets,
    equity: next.equity || sampleData.equity
  };

  hasUploadedData = true;

  // Update Actual cells in all tables
  updateActualCells();

  // Recompute forecasts from new base
  updateForecast();
}

function updateActualCells() {
  const fmt = amount => formatCurrency(amount, false);

  // Update all actual cells across all tables
  const actualCells = document.querySelectorAll('td.actual');
  actualCells.forEach(cell => {
    const text = cell.textContent;
    if (text.includes('Revenue') || text.includes('$385')) {
      cell.textContent = fmt(sampleData.revenue);
    } else if (text.includes('Expenses') || text.includes('$285')) {
      cell.textContent = fmt(sampleData.expenses);
    } else if (text.includes('Net Income') || text.includes('$99')) {
      cell.textContent = fmt(sampleData.netIncome);
      cell.classList.toggle('positive', sampleData.netIncome >= 0);
      cell.classList.toggle('negative', sampleData.netIncome < 0);
    } else if (text.includes('Cash') || text.includes('$2,010')) {
      cell.textContent = fmt(sampleData.cash);
    } else if (text.includes('Assets') || text.includes('$22,700')) {
      cell.textContent = fmt(sampleData.assets);
    } else if (text.includes('Equity') || text.includes('$478')) {
      cell.textContent = fmt(sampleData.equity);
    }
  });
}

function handleActualsUpload(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const obj = parseCSVToObject(reader.result);
      applyActualsFromObject(obj);
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
  const tables = ['combinedPnlTable', 'combinedBalanceTable', 'combinedCashflowTable'];
  exportMultipleTables(tables, 'combined_3_statement_model');
}

function exportPeriodData(period) {
  const tables = [`${period}PnlTable`, `${period}BalanceTable`, `${period}CashflowTable`];
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
  
  // Tabs - Fix the event listener issue
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
  toggleGrowthRateInput(); // Set initial state
  updateForecast(); // Initial render
  
  console.log('Initialization complete');
});
