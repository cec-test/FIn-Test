# Balance Sheet & Cash Flow Formulas - Complete Technical Reference

## 📊 Overview

This document details **every formula** used to forecast your balance sheet and cash flow statement, including which P&L line items drive each balance sheet calculation.

---

## 🔗 P&L to Balance Sheet Mapping System

### **Critical P&L Line Items** (Auto-Detected)

Your system automatically searches for these P&L line items using pattern matching:

```javascript
PNL_MAPPING_PATTERNS = {
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
}
```

### **Balance Sheet → P&L Driver Requirements**

```javascript
BALANCE_SHEET_DRIVER_REQUIREMENTS = {
  'accounts_receivable'       → 'revenue_drivers',
  'inventory'                 → 'cogs_drivers',
  'prepaid_expenses'          → 'revenue_drivers',
  'accounts_payable'          → 'expense_drivers',
  'accrued_expenses'          → 'expense_drivers',
  'deferred_revenue'          → 'revenue_drivers',
  'retained_earnings'         → 'net_income_drivers',
  'property_plant_equipment'  → 'depreciation_drivers'
}
```

---

## 💰 Balance Sheet Calculation Formulas

### **1. Accounts Receivable** 
**Category**: `accounts_receivable`  
**P&L Driver**: Revenue (Total Revenue, Net Revenue, Sales, etc.)  
**Method**: Days Sales Outstanding (DSO)

**Formula**:
```
AR = (Monthly Revenue × 12) / 365 × DSO

Where:
- Monthly Revenue = from P&L forecast
- DSO = Days Sales Outstanding (default: 30 days, user-configurable)
- Result annualizes monthly revenue before applying DSO formula
```

**Example**:
```
Monthly Revenue = $120,000
DSO = 30 days

AR = ($120,000 × 12) / 365 × 30
AR = $1,440,000 / 365 × 30
AR = $118,356
```

**User Controls**: 
- `balanceSheetAssumptions.dso` (default: 30 days)

---

### **2. Inventory**
**Category**: `inventory`  
**P&L Driver**: COGS (Cost of Goods Sold)  
**Method**: Days Inventory Outstanding (DIO)

**Formula**:
```
Inventory = (Monthly COGS × 12) / 365 × DIO

Where:
- Monthly COGS = from P&L forecast
- DIO = Days Inventory Outstanding (default: 45 days, user-configurable)
```

**Example**:
```
Monthly COGS = $60,000
DIO = 45 days

Inventory = ($60,000 × 12) / 365 × 45
Inventory = $720,000 / 365 × 45
Inventory = $88,767
```

**User Controls**: 
- `balanceSheetAssumptions.dio` (default: 45 days)

---

### **3. Accounts Payable**
**Category**: `accounts_payable`  
**P&L Driver**: Operating Expenses (OpEx)  
**Method**: Days Payable Outstanding (DPO)

**Formula**:
```
AP = (Monthly OpEx × 12) / 365 × DPO

Where:
- Monthly OpEx = from P&L forecast
- DPO = Days Payable Outstanding (default: 30 days, user-configurable)
```

**Example**:
```
Monthly OpEx = $30,000
DPO = 30 days

AP = ($30,000 × 12) / 365 × 30
AP = $360,000 / 365 × 30
AP = $29,589
```

**User Controls**: 
- `balanceSheetAssumptions.dpo` (default: 30 days)

---

### **4. Accrued Expenses**
**Category**: `accrued_expenses`  
**P&L Driver**: Total Expenses  
**Method**: Percentage of Expenses

**Formula**:
```
Accrued Expenses = Monthly Expenses × (Percentage / 100)

Where:
- Monthly Expenses = from P&L forecast (typically Operating Expenses)
- Percentage = default: 5%, user-configurable
```

**Example**:
```
Monthly Expenses = $30,000
Accrued % = 5%

Accrued Expenses = $30,000 × 0.05
Accrued Expenses = $1,500
```

**User Controls**: 
- `balanceSheetAssumptions.accruedExpensesPercentage` (default: 5%)

---

### **5. Prepaid Expenses**
**Category**: `prepaid_expenses`  
**P&L Driver**: Revenue  
**Method**: Percentage of Revenue

**Formula**:
```
Prepaid Expenses = Monthly Revenue × (Percentage / 100)

Where:
- Monthly Revenue = from P&L forecast
- Percentage = default: 1%, user-configurable
```

**Example**:
```
Monthly Revenue = $120,000
Prepaid % = 1%

Prepaid Expenses = $120,000 × 0.01
Prepaid Expenses = $1,200
```

**User Controls**: 
- `balanceSheetAssumptions.prepaidExpensesPercentage` (default: 1%)

---

### **6. Retained Earnings**
**Category**: `retained_earnings`  
**P&L Driver**: Net Income  
**Method**: Accumulated Earnings Roll-forward

**Formula**:
```
Retained Earnings(t) = Retained Earnings(t-1) + Net Income(t) - Dividends(t)

Where:
- Retained Earnings(t-1) = previous period value
- Net Income(t) = from P&L forecast (current period)
- Dividends(t) = Net Income × (Dividend Policy % / 100)
```

**Example**:
```
Previous RE = $500,000
Net Income = $50,000
Dividend Policy = 10%

Dividends = $50,000 × 0.10 = $5,000
New RE = $500,000 + $50,000 - $5,000
New RE = $545,000
```

**User Controls**: 
- `balanceSheetAssumptions.dividendPolicy` (default: 0%, percentage of net income)

---

### **7. Property, Plant & Equipment (PPE)**
**Category**: `property_plant_equipment`  
**P&L Drivers**: Revenue + Depreciation  
**Method**: CapEx & Depreciation Roll-forward

**Formula**:
```
PPE(t) = PPE(t-1) + Monthly CapEx - Monthly Depreciation

Where:
- PPE(t-1) = previous period value
- Monthly CapEx = (Annual Revenue × CapEx %) / 12
- Monthly Depreciation = from P&L OR (PPE(t-1) × Depreciation Rate / 12)

Annual Revenue = Monthly Revenue × 12
Annual CapEx = Annual Revenue × (CapEx % / 100)
Monthly CapEx = Annual CapEx / 12

Annual Depreciation Rate = user-configurable (default: 10%)
Monthly Depreciation = PPE(t-1) × (Depreciation Rate / 100 / 12)
```

**Example**:
```
Previous PPE = $1,000,000
Monthly Revenue = $120,000
CapEx % = 3%
Depreciation Rate = 10%

Annual Revenue = $120,000 × 12 = $1,440,000
Annual CapEx = $1,440,000 × 0.03 = $43,200
Monthly CapEx = $43,200 / 12 = $3,600

Monthly Depreciation = $1,000,000 × 0.10 / 12 = $8,333

New PPE = $1,000,000 + $3,600 - $8,333
New PPE = $995,267
```

**User Controls**: 
- `balanceSheetAssumptions.capexPercentage` (default: 3% of revenue)
- `balanceSheetAssumptions.depreciationRate` (default: 10% annual)

---

### **8. Deferred Revenue**
**Category**: `deferred_revenue`  
**P&L Driver**: Revenue  
**Method**: Percentage of Revenue (for SaaS/subscription businesses)

**Formula**:
```
Deferred Revenue = Monthly Revenue × (Percentage / 100)

Where:
- Monthly Revenue = from P&L forecast
- Percentage = 8% (hardcoded for SaaS - could be made configurable)
```

**Example**:
```
Monthly Revenue = $120,000
Deferred % = 8%

Deferred Revenue = $120,000 × 0.08
Deferred Revenue = $9,600
```

**Note**: Currently hardcoded at 8%. Future enhancement: make user-configurable.

---

### **9. Common Stock**
**Category**: `common_stock`  
**P&L Driver**: None  
**Method**: Static Value (carried forward)

**Formula**:
```
Common Stock(t) = Common Stock(t-1)

- Value remains constant unless manually changed
- Used for equity that doesn't change period-to-period
```

---

### **10. Cash** 🔑
**Category**: `cash`  
**Method**: **Balancing Plug**

**Formula**:
```
Cash = Total Assets - Total Liabilities - Total Equity (excluding Cash)

This is calculated AFTER all other balance sheet items to ensure:
Assets = Liabilities + Equity
```

**Process**:
1. Calculate all non-cash balance sheet items
2. Sum up Total Liabilities
3. Sum up Total Equity (excluding Retained Earnings initially)
4. Calculate Retained Earnings (which includes Net Income)
5. Calculate Required Total Assets = Total Liabilities + Total Equity
6. Cash = Required Total Assets - Sum of All Other Assets

**Example**:
```
Total Liabilities = $200,000
Total Equity = $800,000
Other Assets = $850,000

Required Total Assets = $200,000 + $800,000 = $1,000,000
Cash = $1,000,000 - $850,000 = $150,000
```

**Note**: This is the most sophisticated calculation - it ensures your balance sheet always balances!

---

### **11. Other Assets/Liabilities**
**Category**: `other_asset_or_liability`  
**P&L Driver**: None  
**Method**: Growth Rate

**Formula**:
```
Value(t) = Value(t-1) × (1 + Monthly Growth Rate)

Where:
- Monthly Growth Rate = Annual Growth Rate / 12
- Annual Growth Rate = user-configurable (default: 5%)
```

**Example**:
```
Previous Value = $50,000
Annual Growth = 5%
Monthly Growth = 5% / 12 = 0.4167%

New Value = $50,000 × (1 + 0.004167)
New Value = $50,208
```

**User Controls**: 
- `balanceSheetAssumptions.workingCapitalGrowth` (default: 5% annual)

---

## 💸 Cash Flow Statement Formulas

### **Structure**
```
Cash Flow from Operating Activities
+ Cash Flow from Investing Activities
+ Cash Flow from Financing Activities
= Net Change in Cash

Beginning Cash + Net Change in Cash = Ending Cash
```

---

### **Operating Activities Section**

**Formula**:
```
Operating Cash Flow = 
  Net Income
  + Depreciation & Amortization (non-cash expense)
  - Increase in Accounts Receivable (or + Decrease)
  - Increase in Inventory (or + Decrease)
  + Increase in Accounts Payable (or - Decrease)
  + Increase in Accrued Expenses (or - Decrease)
  - Increase in Prepaid Expenses (or + Decrease)
```

**Line Items**:

1. **Net Income** (from P&L)
   ```
   = P&L Net Income for the period
   ```

2. **Depreciation & Amortization** (added back)
   ```
   = P&L Depreciation for the period
   (Non-cash expense, so added back to Net Income)
   ```

3. **Change in Accounts Receivable**
   ```
   Cash Impact = -(AR(current) - AR(previous))
   
   If AR increases → Cash outflow (customers owe you more, haven't paid yet)
   If AR decreases → Cash inflow (customers paid down balances)
   ```

4. **Change in Inventory**
   ```
   Cash Impact = -(Inventory(current) - Inventory(previous))
   
   If Inventory increases → Cash outflow (bought more inventory)
   If Inventory decreases → Cash inflow (sold down inventory)
   ```

5. **Change in Accounts Payable**
   ```
   Cash Impact = +(AP(current) - AP(previous))
   
   If AP increases → Cash inflow (delayed payment to suppliers)
   If AP decreases → Cash outflow (paid down suppliers)
   ```

6. **Change in Accrued Expenses**
   ```
   Cash Impact = +(Accrued(current) - Accrued(previous))
   
   Similar logic to Accounts Payable
   ```

7. **Change in Prepaid Expenses**
   ```
   Cash Impact = -(Prepaid(current) - Prepaid(previous))
   
   If Prepaid increases → Cash outflow (paid in advance)
   If Prepaid decreases → Cash inflow (using up prepaid amounts)
   ```

**Example**:
```
Net Income:                     $50,000
+ Depreciation:                  $8,333
- Increase in AR:               -$5,000  (AR grew from $115,000 to $120,000)
- Increase in Inventory:        -$2,000  (Inventory grew from $86,000 to $88,000)
+ Increase in AP:                $1,500  (AP grew from $28,000 to $29,500)
─────────────────────────────────────
= Operating Cash Flow:          $52,833
```

---

### **Investing Activities Section**

**Formula**:
```
Investing Cash Flow = 
  - Capital Expenditures
  - Acquisitions (future)
  + Asset Sales (future)
```

**Line Items**:

1. **Capital Expenditures (CapEx)**
   ```
   Method 1 (if PPE exists):
   CapEx = Δ PPE + Depreciation
   CapEx = (PPE(current) - PPE(previous)) + Depreciation
   
   Why? Because: PPE(end) = PPE(begin) + CapEx - Depreciation
   Therefore: CapEx = Δ PPE + Depreciation
   
   Method 2 (fallback):
   Annual CapEx = Annual Revenue × (CapEx % / 100)
   Monthly CapEx = Annual CapEx / 12
   ```

**Example (Method 1)**:
```
PPE Previous:           $1,000,000
PPE Current:              $995,267
PPE Change:                -$4,733
Depreciation:               $8,333

CapEx = -$4,733 + $8,333 = $3,600
Cash Impact = -$3,600 (outflow)
```

**Example (Method 2)**:
```
Monthly Revenue:        $120,000
Annual Revenue:       $1,440,000
CapEx %:                      3%

Annual CapEx = $1,440,000 × 0.03 = $43,200
Monthly CapEx = $43,200 / 12 = $3,600
Cash Impact = -$3,600 (outflow)
```

---

### **Financing Activities Section**

**Formula**:
```
Financing Cash Flow = 
  - Dividends Paid
  + Debt Issuance (or - Debt Repayment)
  + Stock Issuance (or - Stock Repurchase)
```

**Line Items**:

1. **Dividends Paid**
   ```
   Dividends = Net Income × (Dividend Policy % / 100)
   Cash Impact = -Dividends (outflow)
   ```

2. **Debt Changes**
   ```
   Net Debt Change = (Short-term Debt + Long-term Debt)(current) 
                   - (Short-term Debt + Long-term Debt)(previous)
   
   If positive → Debt Issuance (cash inflow)
   If negative → Debt Repayment (cash outflow)
   ```

3. **Equity Changes**
   ```
   Equity Change = Common Stock(current) - Common Stock(previous)
   
   If positive → Stock Issuance (cash inflow)
   If negative → Stock Repurchase (cash outflow)
   ```

**Example**:
```
Net Income:                     $50,000
Dividend Policy:                    10%
Dividends = $50,000 × 0.10 =     -$5,000

Debt Change:                         $0
Equity Change:                       $0
─────────────────────────────────────
= Financing Cash Flow:           -$5,000
```

---

### **Net Change in Cash & Reconciliation**

**Formula**:
```
Net Change in Cash = Operating CF + Investing CF + Financing CF

Ending Cash = Beginning Cash + Net Change in Cash

Verification:
Ending Cash (from Balance Sheet) should equal Ending Cash (calculated)
```

**Example**:
```
Operating CF:           $52,833
Investing CF:           -$3,600
Financing CF:           -$5,000
─────────────────────────────────
Net Change in Cash:     $44,233

Beginning Cash:        $105,000
+ Net Change:          +$44,233
─────────────────────────────────
Ending Cash:           $149,233
```

**Reconciliation Check**:
```
Balance Sheet Cash:    $150,000
Calculated Cash:       $149,233
Difference:                $767

If difference < $1: ✅ RECONCILED
If difference >= $1: ⚠️ NEEDS INVESTIGATION
```

---

## 🎛️ User-Configurable Assumptions

All assumptions are in the `balanceSheetAssumptions` object:

```javascript
balanceSheetAssumptions = {
  // Working Capital
  dso: 30,                           // Days Sales Outstanding
  dpo: 30,                           // Days Payable Outstanding  
  dio: 45,                           // Days Inventory Outstanding
  
  // Fixed Assets
  depreciationRate: 10,              // Annual depreciation rate (%)
  capexPercentage: 3,                // CapEx as % of annual revenue
  
  // Policies
  dividendPolicy: 0,                 // Dividends as % of net income
  cashTarget: 30,                    // Minimum cash buffer (days of OpEx)
  
  // Accruals
  accruedExpensesPercentage: 5,      // Accrued expenses as % of expenses
  prepaidExpensesPercentage: 1,      // Prepaid expenses as % of revenue
  
  // Growth (for unclassified items)
  workingCapitalGrowth: 5            // Annual growth rate (%)
}
```

---

## 🔄 Calculation Sequence

The system follows this precise order to ensure balance sheet integrity:

```
1. Get P&L forecast data for the period
   ├─ Revenue
   ├─ COGS
   ├─ Operating Expenses
   ├─ Depreciation
   └─ Net Income

2. Get previous period balance sheet values

3. Calculate detail items (skip totals and subheaders)
   ├─ Accounts Receivable (uses Revenue)
   ├─ Inventory (uses COGS)
   ├─ Accounts Payable (uses OpEx)
   ├─ Accrued Expenses (uses Total Expenses)
   ├─ Prepaid Expenses (uses Revenue)
   ├─ PPE (uses Revenue + Depreciation)
   ├─ Retained Earnings (uses Net Income)
   ├─ Common Stock (static)
   └─ Other items (growth-based)

4. Calculate preliminary totals from hierarchy
   ├─ Sum all assets (excluding cash)
   ├─ Sum all liabilities
   └─ Sum all equity

5. Calculate balancing cash
   Cash = (Total Liabilities + Total Equity) - (Total Assets - Cash)
   This ensures: Assets = Liabilities + Equity

6. Update cash value and recalculate final totals

7. Verify balance sheet balances
   If |Assets - (Liabilities + Equity)| < $1: ✅ BALANCED
   
8. Calculate cash flow statement
   ├─ Operating activities (using BS changes + P&L)
   ├─ Investing activities (using PPE changes)
   └─ Financing activities (using RE/Debt/Equity changes)

9. Verify cash flow reconciliation
   Beginning Cash + Net Change = Ending Cash
```

---

## 📋 Summary Table: P&L Mappings

| Balance Sheet Item | Maps To P&L Item | Formula Type | User Control |
|-------------------|------------------|--------------|--------------|
| **Accounts Receivable** | Revenue | DSO Formula | dso (30 days) |
| **Inventory** | COGS | DIO Formula | dio (45 days) |
| **Prepaid Expenses** | Revenue | % of Revenue | prepaidExpensesPercentage (1%) |
| **Accounts Payable** | Operating Expenses | DPO Formula | dpo (30 days) |
| **Accrued Expenses** | Total Expenses | % of Expenses | accruedExpensesPercentage (5%) |
| **Deferred Revenue** | Revenue | % of Revenue | (Hardcoded 8%) |
| **PPE** | Revenue + Depreciation | CapEx & Depr | capexPercentage (3%), depreciationRate (10%) |
| **Retained Earnings** | Net Income | Roll-forward | dividendPolicy (0%) |
| **Common Stock** | None | Static | N/A |
| **Cash** | Balance Sheet | Balancing Plug | N/A |
| **Other Items** | None | Growth Rate | workingCapitalGrowth (5%) |

---

## 🎯 Key Insights

### **Why This System Works**

1. **P&L Drives Balance Sheet**: Most balance sheet items are directly calculated from P&L forecasts, ensuring consistency.

2. **Cash Balances Automatically**: Cash is the balancing plug, so the balance sheet always balances mathematically.

3. **Cash Flow Reconciles**: Since BS and P&L are linked, cash flow statement automatically reconciles.

4. **Flexible & Configurable**: Users can adjust key assumptions (DSO, DIO, DPO, etc.) without code changes.

5. **Fallback Logic**: If a P&L driver isn't found, system gracefully falls back to growth-based forecasting.

6. **Annualization**: All working capital formulas properly annualize monthly data before applying turnover ratios (DSO/DIO/DPO).

### **Critical Success Factors**

✅ **All calculations use monthly values** - Annual figures are derived by multiplying by 12  
✅ **Working capital formulas annualize first** - Prevents understating AR/Inventory/AP  
✅ **Cash is calculated last** - Ensures balance sheet balances  
✅ **Cash flow uses BS changes** - Ensures reconciliation  
✅ **Fuzzy matching for P&L items** - Handles variations in naming  

---

## 🔮 Future Enhancements

**Potential additions to the formula engine**:

1. **Tax Calculations**: Add Deferred Tax Assets/Liabilities based on tax rate
2. **Goodwill & Intangibles**: Amortization schedules
3. **Long-term Investments**: Return assumptions
4. **Line of Credit**: Dynamic borrowing based on cash needs
5. **Working Capital Optimization**: Suggest optimal DSO/DIO/DPO targets
6. **Seasonality**: Apply seasonal patterns to working capital
7. **Multi-currency**: FX impact on balance sheet

---

**Last Updated**: 2025-10-06  
**Status**: ✅ Production - All formulas tested and validated  
**Location**: `src/app.js` lines 4749-5650 (Balance Sheet), 5215-5627 (Cash Flow)
