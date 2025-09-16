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

/**
 * Formatting
 */
const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0
});

function formatCurrency(amount) {
  return currencyFormatter.format(Math.round(amount));
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

  updatePnLForecasts(revGrowth, expGrowth);
  updateBalanceForecasts(revGrowth);
  updateCashFlowForecasts(revGrowth, expGrowth);
}

/**
 * Forecast calculators
 */
function updatePnLForecasts(revGrowth, expGrowth) {
  for (let i = 1; i <= 3; i++) {
    const revForecast = sampleData.revenue * Math.pow(1 + revGrowth, i);
    const expForecast = sampleData.expenses * Math.pow(1 + expGrowth, i);
    const niForecast = revForecast - expForecast;

    const revEl = document.getElementById(`rev${i}`);
    const expEl = document.getElementById(`exp${i}`);
    const niEl = document.getElementById(`ni${i}`);

    if (revEl) revEl.textContent = formatCurrency(revForecast);
    if (expEl) expEl.textContent = formatCurrency(expForecast);
    if (niEl) {
      niEl.textContent = formatCurrency(niForecast);
      niEl.classList.toggle('positive', niForecast >= 0);
      niEl.classList.toggle('negative', niForecast < 0);
    }
  }
}

function updateBalanceForecasts(growth) {
  let cashBalance = sampleData.cash;

  for (let i = 1; i <= 3; i++) {
    const netIncomeForPeriod = sampleData.netIncome * Math.pow(1 + growth, i);
    cashBalance += netIncomeForPeriod;

    const assetsForecast =
      sampleData.assets * Math.pow(1 + growth * 0.6, i) + (cashBalance - sampleData.cash);
    const equityForecast = sampleData.equity + (cashBalance - sampleData.cash);

    const cashEl = document.getElementById(`cash${i}`);
    const assetsEl = document.getElementById(`assets${i}`);
    const equityEl = document.getElementById(`equity${i}`);

    if (cashEl) cashEl.textContent = formatCurrency(cashBalance);
    if (assetsEl) assetsEl.textContent = formatCurrency(assetsForecast);
    if (equityEl) equityEl.textContent = formatCurrency(equityForecast);
  }
}

function updateCashFlowForecasts(revGrowth, expGrowth) {
  for (let i = 1; i <= 3; i++) {
    const revForecast = sampleData.revenue * Math.pow(1 + revGrowth, i);
    const expForecast = sampleData.expenses * Math.pow(1 + expGrowth, i);
    const niForecast = revForecast - expForecast;
    const ocfForecast = niForecast * 1.1; // simple uplift

    const cfniEl = document.getElementById(`cfni${i}`);
    const ocfEl = document.getElementById(`ocf${i}`);
    const fcfEl = document.getElementById(`fcf${i}`);
    const nccEl = document.getElementById(`ncc${i}`);

    if (cfniEl) cfniEl.textContent = formatCurrency(niForecast);
    if (ocfEl) ocfEl.textContent = formatCurrency(ocfForecast);
    if (fcfEl) fcfEl.textContent = formatCurrency(ocfForecast);
    if (nccEl) nccEl.textContent = formatCurrency(niForecast);
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

  // Take first data row
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

  // Update Actual cells in the visible tables to reflect uploaded values
  const fmt = formatCurrency;

  // P&L actuals
  const pnlTbody = document.querySelector('#pnlTable tbody');
  if (pnlTbody) {
    const revActual = pnlTbody.querySelector('tr:nth-child(1) td.actual');
    const expActual = pnlTbody.querySelector('tr:nth-child(2) td.actual');
    const niActual = pnlTbody.querySelector('tr:nth-child(3) td.actual');

    if (revActual) revActual.textContent = fmt(sampleData.revenue);
    if (expActual) expActual.textContent = fmt(sampleData.expenses);
    if (niActual) {
      niActual.textContent = fmt(sampleData.netIncome);
      niActual.classList.toggle('positive', sampleData.netIncome >= 0);
      niActual.classList.toggle('negative', sampleData.netIncome < 0);
    }
  }

  // Balance actuals
  const balTbody = document.querySelector('#balanceTable tbody');
  if (balTbody) {
    const cashActual = balTbody.querySelector('tr:nth-child(1) td.actual');
    const assetsActual = balTbody.querySelector('tr:nth-child(2) td.actual');
    const equityActual = balTbody.querySelector('tr:nth-child(3) td.actual');

    if (cashActual) cashActual.textContent = fmt(sampleData.cash);
    if (assetsActual) assetsActual.textContent = fmt(sampleData.assets);
    if (equityActual) equityActual.textContent = fmt(sampleData.equity);
  }

  // Cash Flow actuals (Net Income)
  const cfTbody = document.querySelector('#cashflowTable tbody');
  if (cfTbody) {
    const cfniActual = cfTbody.querySelector('tr:nth-child(1) td.actual');
    if (cfniActual) cfniActual.textContent = fmt(sampleData.netIncome);
  }

  // Recompute forecasts from new base
  updateForecast();
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
 * CSV Export (used by existing buttons with onclick or can be wired below)
 */
function exportData(statementType) {
  const tableId = statementType + 'Table';
  const table = document.getElementById(tableId);
  if (!table) {
    alert('No data to export');
    return;
  }
  const rows = Array.from(table.rows);
  const csvContent = rows.map(row => {
    return Array.from(row.cells)
      .map(cell => '"' + cell.textContent.replace(/"/g, '""') + '"')
      .join(',');
  }).join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${statementType}_forecast.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Expose exportData globally if buttons use inline onclick
window.exportData = exportData;

/**
 * Boot
 */
document.addEventListener('DOMContentLoaded', function () {
  // Tabs
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => showTab(btn.getAttribute('data-tab'), btn));
  });

  // Controls
  const methodEl = document.getElementById('forecastMethod');
  const rateEl = document.getElementById('customGrowthRate');
  const periodsEl = document.getElementById('forecastPeriods');

  methodEl?.addEventListener('change', updateForecast);
  rateEl?.addEventListener('change', updateForecast);
  periodsEl?.addEventListener('change', updateForecast);

  // Upload
  const fileEl = document.getElementById('actualsFile');
  fileEl?.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) handleActualsUpload(file);
  });

  // Initial render
  updateForecast();
});
