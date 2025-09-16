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
    const assetsForecast = sampleData.assets * Math.pow(1 + revGrowth
