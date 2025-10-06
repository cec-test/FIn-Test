# Quick Reference: Balance Sheet Formulas

## 📊 P&L → Balance Sheet Mappings (At a Glance)

```
┌─────────────────────────────────────────────────────────────────────┐
│                         P&L STATEMENT                                │
├─────────────────────────────────────────────────────────────────────┤
│  Revenue                  ──────┐                                   │
│  COGS                     ──────┼───┐                               │
│  Operating Expenses       ──────┼───┼───┐                           │
│  Depreciation            ──────┼───┼───┼───┐                       │
│  Net Income              ──────┼───┼───┼───┼───┐                   │
└─────────────────────────────────┼───┼───┼───┼───┼───────────────────┘
                                  │   │   │   │   │
                                  ▼   ▼   ▼   ▼   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      BALANCE SHEET                                   │
├──────────────────────┬──────────────────────────────────────────────┤
│ ASSETS               │ LIABILITIES & EQUITY                         │
├──────────────────────┼──────────────────────────────────────────────┤
│ Current Assets:      │ Current Liabilities:                         │
│                      │                                              │
│  Cash .............. │  Accounts Payable ◄─── OpEx (DPO)          │
│    (balancing plug)  │  Accrued Expenses ◄─── Expenses (%)         │
│                      │  Deferred Revenue ◄─── Revenue (%)          │
│  AR ◄─── Revenue     │                                              │
│       (DSO formula)  │ Long-term Liabilities:                       │
│                      │  [Growth-based]                              │
│  Inventory ◄─── COGS │                                              │
│       (DIO formula)  │ Equity:                                      │
│                      │                                              │
│  Prepaid ◄─── Rev(%) │  Common Stock (static)                      │
│                      │  Retained Earnings ◄─── Net Income          │
│ Fixed Assets:        │       (rollforward with dividends)           │
│                      │                                              │
│  PPE ◄─── Rev + Depr │                                              │
│      (CapEx - Depr)  │                                              │
└──────────────────────┴──────────────────────────────────────────────┘
```

---

## 💰 The 11 Core Formulas

### **Working Capital (Driver-Based)**

```
1. Accounts Receivable
   AR = (Revenue_monthly × 12) / 365 × DSO
   Default DSO: 30 days

2. Inventory  
   Inv = (COGS_monthly × 12) / 365 × DIO
   Default DIO: 45 days

3. Accounts Payable
   AP = (OpEx_monthly × 12) / 365 × DPO
   Default DPO: 30 days

4. Accrued Expenses
   Accrued = Total_Expenses × 5%
   Default: 5%

5. Prepaid Expenses
   Prepaid = Revenue × 1%
   Default: 1%
```

### **Long-term Assets (Driver-Based)**

```
6. Property, Plant & Equipment
   PPE(t) = PPE(t-1) + CapEx - Depreciation
   
   Where:
   CapEx = (Revenue_monthly × 12) × 3% / 12
   Depreciation = P&L value OR PPE(t-1) × 10% / 12
   
   Defaults: CapEx 3% of revenue, Depreciation 10% annual
```

### **Liabilities (Driver-Based)**

```
7. Deferred Revenue
   Deferred = Revenue × 8%
   Default: 8% (SaaS model)
```

### **Equity (Driver-Based)**

```
8. Retained Earnings
   RE(t) = RE(t-1) + Net_Income - Dividends
   
   Where:
   Dividends = Net_Income × Dividend_Policy%
   Default: 0%
```

### **Static Items**

```
9. Common Stock
   Common_Stock(t) = Common_Stock(t-1)
   (No change unless manually adjusted)
```

### **Growth-Based (Fallback)**

```
10. Other Assets/Liabilities
    Value(t) = Value(t-1) × (1 + 5%/12)
    Default: 5% annual growth
```

### **Balancing**

```
11. Cash (THE MAGIC FORMULA)
    Cash = Total_Liabilities + Total_Equity - Sum(All_Other_Assets)
    
    This ensures: Assets = Liabilities + Equity
```

---

## 💸 Cash Flow Statement (3-Step Process)

### **Operating Activities**
```
Net Income                              (from P&L)
+ Depreciation                          (add back non-cash)
- Increase in AR                        (↑AR = cash out)
- Increase in Inventory                 (↑Inv = cash out)
+ Increase in AP                        (↑AP = cash in)
+ Increase in Accrued Expenses          (↑Accrued = cash in)
- Increase in Prepaid Expenses          (↑Prepaid = cash out)
= Operating Cash Flow
```

### **Investing Activities**
```
- Capital Expenditures                  CapEx = ΔPPE + Depreciation
- Acquisitions                          (future)
+ Asset Sales                           (future)
= Investing Cash Flow
```

### **Financing Activities**
```
- Dividends Paid                        Net_Income × Dividend%
+ Debt Issuance (or - Repayment)       ΔDebt
+ Stock Issuance (or - Repurchase)     ΔCommon_Stock
= Financing Cash Flow
```

### **Reconciliation**
```
Beginning Cash
+ Operating CF
+ Investing CF
+ Financing CF
= Ending Cash (should match Balance Sheet Cash)
```

---

## 🎛️ Default Settings (All User-Configurable)

```javascript
┌─────────────────────────────────────────────────┐
│ Working Capital Assumptions                     │
├─────────────────────────────────────────────────┤
│ DSO (Days Sales Outstanding)          30 days  │
│ DPO (Days Payable Outstanding)         30 days  │
│ DIO (Days Inventory Outstanding)       45 days  │
├─────────────────────────────────────────────────┤
│ Fixed Asset Assumptions                         │
├─────────────────────────────────────────────────┤
│ Annual Depreciation Rate               10%      │
│ CapEx as % of Annual Revenue           3%       │
├─────────────────────────────────────────────────┤
│ Policy Assumptions                              │
├─────────────────────────────────────────────────┤
│ Dividend Policy (% of Net Income)      0%       │
│ Minimum Cash Buffer                    30 days  │
├─────────────────────────────────────────────────┤
│ Accrual Assumptions                             │
├─────────────────────────────────────────────────┤
│ Accrued Expenses (% of Expenses)       5%       │
│ Prepaid Expenses (% of Revenue)        1%       │
├─────────────────────────────────────────────────┤
│ Growth Assumptions (Fallback)                   │
├─────────────────────────────────────────────────┤
│ Working Capital Growth Rate            5%/year  │
└─────────────────────────────────────────────────┘
```

---

## 🔍 P&L Line Item Detection Patterns

The system automatically searches for these variations:

```
Revenue:
  ✓ total revenue, net revenue, total sales, net sales
  ✓ gross revenue, revenue total, sales total
  ✓ total income, gross sales

COGS:
  ✓ cost of goods sold, total cogs, cogs
  ✓ cost of sales, total cost of sales

Operating Expenses:
  ✓ operating expenses, total opex, opex
  ✓ total expenses, operational expenses
  ✓ selling general administrative, sg&a

Net Income:
  ✓ net income, net profit, net earnings
  ✓ profit after tax, bottom line, earnings

Depreciation:
  ✓ depreciation, depreciation expense
  ✓ amortization, depreciation and amortization, d&a
```

---

## ⚡ Quick Examples

### Example 1: Calculate AR
```
Given:
- Monthly Revenue = $120,000
- DSO = 30 days

Calculation:
AR = ($120,000 × 12) / 365 × 30
AR = $1,440,000 / 365 × 30
AR = $118,356
```

### Example 2: Calculate Inventory
```
Given:
- Monthly COGS = $60,000
- DIO = 45 days

Calculation:
Inventory = ($60,000 × 12) / 365 × 45
Inventory = $720,000 / 365 × 45
Inventory = $88,767
```

### Example 3: Calculate PPE
```
Given:
- Previous PPE = $1,000,000
- Monthly Revenue = $120,000
- CapEx % = 3%
- Depreciation Rate = 10%

Calculation:
Annual Revenue = $120,000 × 12 = $1,440,000
Annual CapEx = $1,440,000 × 3% = $43,200
Monthly CapEx = $43,200 / 12 = $3,600

Monthly Depreciation = $1,000,000 × 10% / 12 = $8,333

New PPE = $1,000,000 + $3,600 - $8,333 = $995,267
```

### Example 4: Calculate Retained Earnings
```
Given:
- Previous RE = $500,000
- Net Income = $50,000
- Dividend Policy = 10%

Calculation:
Dividends = $50,000 × 10% = $5,000
New RE = $500,000 + $50,000 - $5,000 = $545,000
```

### Example 5: Calculate Operating Cash Flow
```
Given:
- Net Income = $50,000
- Depreciation = $8,333
- AR increased by $5,000
- Inventory increased by $2,000
- AP increased by $1,500

Calculation:
Operating CF = $50,000 + $8,333 - $5,000 - $2,000 + $1,500
Operating CF = $52,833
```

---

## 🚨 Common Mistakes to Avoid

❌ **DON'T** use annual revenue directly in DSO formula  
✅ **DO** annualize monthly revenue first: `(Revenue_monthly × 12) / 365 × DSO`

❌ **DON'T** forget to divide by 12 for monthly CapEx  
✅ **DO** calculate annual CapEx first, then divide: `(Annual_Revenue × CapEx%) / 12`

❌ **DON'T** calculate cash before other items  
✅ **DO** calculate cash last as the balancing plug

❌ **DON'T** forget to add back depreciation in cash flow  
✅ **DO** add depreciation to net income (it's non-cash)

❌ **DON'T** ignore the sign on working capital changes  
✅ **DO** remember: ↑Assets = cash OUT, ↑Liabilities = cash IN

---

## 📍 Where to Find in Code

| Component | File | Lines |
|-----------|------|-------|
| Balance Sheet Engine | `src/app.js` | 4749-5200 |
| Cash Flow Engine | `src/app.js` | 5215-5650 |
| P&L Mapping Patterns | `src/app.js` | 2255-2293 |
| Balance Sheet Assumptions | `src/app.js` | 3582-3617 |
| Default Settings | `src/app.js` | 3598-3617 |

---

**Pro Tip**: All formulas are in `BalanceSheetCalculationEngine` class and `CashFlowCalculationEngine` class!

---

**Last Updated**: 2025-10-06  
**For detailed explanations**: See `BALANCE_SHEET_FORMULAS_AND_MAPPINGS.md`
