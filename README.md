# 3-Statement Financial Model

A professional financial forecasting platform that provides comprehensive financial statement modeling with dynamic forecasting capabilities.

## Features

- **Three Financial Statements**: P&L, Balance Sheet, and Cash Flow
- **Multiple Time Periods**: Monthly, Quarterly, and Yearly forecasts
- **CSV Data Import**: Upload your own financial data
- **Dynamic Forecasting**: Multiple forecasting methods (Custom Growth, Rolling Average, 3-Month Average)
- **Responsive Design**: Works on desktop, tablet, and mobile devices
- **Slider-based Navigation**: Smooth horizontal scrolling through large datasets
- **Export Functionality**: Download forecasts as CSV files

## Live Demo

Visit the live application: [https://cec-test.github.io/FIn-Test/](https://cec-test.github.io/FIn-Test/)

## Local Development

1. Clone the repository:
   ```bash
   git clone https://github.com/cec-test/FIn-Test.git
   cd FIn-Test
   ```

2. Start a local server:
   ```bash
   python3 -m http.server 8000
   ```

3. Open your browser and navigate to `http://localhost:8000`

## Deployment

This project is automatically deployed to GitHub Pages when changes are pushed to the main branch.

### Manual Deployment Steps:

1. Ensure your changes are in the `docs/` directory
2. Push to the main branch
3. GitHub Actions will automatically build and deploy

### File Structure:
```
├── index.html          # Main application file
├── src/
│   └── app.js         # Application JavaScript
├── docs/              # GitHub Pages deployment directory
│   ├── index.html     # Copy of main application
│   └── src/
│       └── app.js     # Copy of application JavaScript
└── .github/
    └── workflows/
        └── deploy-pages.yml  # GitHub Actions deployment
```

## Usage

1. **Upload Data**: Use the CSV upload feature to import your financial data
2. **Configure Forecast**: Select forecasting method and parameters
3. **Run Forecast**: Click "Run Forecasts" to generate projections
4. **Navigate**: Use the horizontal slider to scroll through periods
5. **Export**: Download results using the export buttons

## CSV Format

Your CSV should include:
- First column: Line item names
- Subsequent columns: Historical data by period
- Section headers: "P&L", "Balance Sheet", "Cash Flow"

## Browser Support

- Chrome/Chromium 60+
- Firefox 55+
- Safari 12+
- Edge 79+

## License

MIT License - see LICENSE file for details.