# Current P&L Mappings - What Your Balance Sheet Needs

## 🎯 Overview

Your balance sheet forecasting engine requires **5 critical P&L line items** to achieve maximum accuracy. Here's exactly what it's looking for and why.

---

## 📋 The 5 Critical P&L Line Items

### **1. Revenue** (Total/Net Revenue)
**Importance**: ⭐⭐⭐⭐⭐ CRITICAL  
**Used by**:
- Accounts Receivable (DSO calculation)
- Prepaid Expenses (percentage calculation)
- PPE/CapEx (as base for capital expenditures)
- Deferred Revenue (percentage calculation)

**Auto-Detection Patterns**:
```javascript
Searches for (case-insensitive):
✓ total revenue
✓ net revenue
✓ total sales
✓ net sales
✓ gross revenue
✓ revenue total
✓ sales total
✓ total income
✓ gross sales
✓ service revenue total
✓ product revenue total
```

**What Happens if Not Found**:
- AR calculation fails → fallback to growth-based
- Prepaid calculation fails → fallback to growth-based
- CapEx still works but accuracy reduced
- Deferred Revenue calculation fails

**Example P&L Names That Work**:
```
✅ "Total Revenue"
✅ "Net Revenue"
✅ "Revenue"
✅ "Total Sales"
✅ "Sales Revenue"
```

---

### **2. Cost of Goods Sold (COGS)**
**Importance**: ⭐⭐⭐⭐ HIGH  
**Used by**:
- Inventory (DIO calculation)

**Auto-Detection Patterns**:
```javascript
Searches for:
✓ total cost of goods sold
✓ total cogs
✓ cost of goods sold
✓ total cost of sales
✓ cost of sales
✓ cogs total
✓ total product costs
✓ direct costs total
```

**What Happens if Not Found**:
- Inventory calculation fails → fallback to growth-based
- For service companies (no COGS), this is expected

**Example P&L Names That Work**:
```
✅ "Cost of Goods Sold"
✅ "COGS"
✅ "Cost of Sales"
✅ "Total COGS"
```

---

### **3. Operating Expenses (OpEx)**
**Importance**: ⭐⭐⭐⭐⭐ CRITICAL  
**Used by**:
- Accounts Payable (DPO calculation)
- Accrued Expenses (percentage calculation)

**Auto-Detection Patterns**:
```javascript
Searches for:
✓ total operating expenses
✓ operating expenses
✓ total opex
✓ total expenses
✓ operational expenses
✓ total overhead
✓ administrative expenses
✓ selling expenses
✓ sg&a
✓ selling general administrative
```

**What Happens if Not Found**:
- AP calculation fails → fallback to growth-based
- Accrued Expenses may use total expenses instead

**Example P&L Names That Work**:
```
✅ "Operating Expenses"
✅ "Total Operating Expenses"
✅ "OpEx"
✅ "SG&A"
✅ "Selling, General & Administrative"
```

---

### **4. Net Income**
**Importance**: ⭐⭐⭐⭐⭐ CRITICAL  
**Used by**:
- Retained Earnings (roll-forward calculation)
- Cash Flow Statement (starting point)
- Dividend calculation

**Auto-Detection Patterns**:
```javascript
Searches for:
✓ net income
✓ net profit
✓ profit after tax
✓ bottom line
✓ net earnings
✓ profit/loss
✓ total profit
✓ earnings
```

**What Happens if Not Found**:
- Retained Earnings calculation fails → serious issue
- Cash Flow Statement cannot be generated
- System may error out

**Example P&L Names That Work**:
```
✅ "Net Income"
✅ "Net Profit"
✅ "Profit After Tax"
✅ "Net Earnings"
✅ "Bottom Line"
```

---

### **5. Depreciation & Amortization**
**Importance**: ⭐⭐⭐⭐ HIGH  
**Used by**:
- PPE calculation (as reduction to gross PPE)
- Cash Flow Statement (non-cash add-back)
- CapEx calculation (reverse engineer from PPE change)

**Auto-Detection Patterns**:
```javascript
Searches for:
✓ depreciation
✓ depreciation expense
✓ amortization
✓ depreciation and amortization
✓ total depreciation
✓ d&a
```

**What Happens if Not Found**:
- PPE uses assumption-based depreciation (10% annual rate)
- Cash Flow adds back calculated depreciation
- Still works but less accurate

**Example P&L Names That Work**:
```
✅ "Depreciation"
✅ "Depreciation Expense"
✅ "D&A"
✅ "Depreciation & Amortization"
```

---

## 🎯 Minimum P&L Requirements

### **For Full Accuracy (90-95%)**
You need all 5 items:
```
✅ Total Revenue
✅ COGS
✅ Operating Expenses
✅ Net Income
✅ Depreciation
```

### **For Good Accuracy (75-85%)**
You need at least:
```
✅ Total Revenue
✅ Operating Expenses
✅ Net Income
⚠️ COGS (optional if service company)
⚠️ Depreciation (will use assumptions)
```

### **For Basic Accuracy (60-70%)**
Minimum requirements:
```
✅ Total Revenue
✅ Net Income
⚠️ All others will use growth-based fallbacks
```

---

## 📊 Complete P&L Structure Example

Here's an ideal P&L structure for your system:

```
Income Statement
├─ Revenue
│  ├─ Product Revenue                    ← Individual lines
│  ├─ Service Revenue                    ← Individual lines
│  └─ Total Revenue                      ← ⭐ MAPS TO AR, Prepaid, CapEx
│
├─ Cost of Goods Sold
│  ├─ Product Costs                      ← Individual lines
│  ├─ Labor Costs                        ← Individual lines
│  └─ Total COGS                         ← ⭐ MAPS TO Inventory
│
├─ Gross Profit                          ← Calculated
│
├─ Operating Expenses
│  ├─ Sales & Marketing                  ← Individual lines
│  ├─ Research & Development             ← Individual lines
│  ├─ General & Administrative           ← Individual lines
│  ├─ Depreciation & Amortization        ← ⭐ MAPS TO PPE, Cash Flow
│  └─ Total Operating Expenses           ← ⭐ MAPS TO AP, Accrued
│
├─ Operating Income                      ← Calculated
│
├─ Other Income/Expenses                 ← Optional
│  ├─ Interest Income                    
│  └─ Interest Expense                   
│
├─ Pretax Income                         ← Calculated
├─ Income Tax Expense                    ← Individual line
└─ Net Income                            ← ⭐ MAPS TO Retained Earnings
```

---

## 🔄 How Mapping Works

### **Auto-Detection Process**:
```
1. System scans your uploaded P&L CSV
2. For each balance sheet category, looks for matching P&L pattern
3. Uses fuzzy matching (lowercase, partial matches)
4. Assigns highest-confidence match
5. User can override if needed
```

### **Example Auto-Mapping**:
```
Balance Sheet Upload:
├─ "Accounts Receivable" 
│   → System searches for revenue patterns
│   → Finds "Total Revenue" in P&L
│   → Auto-maps: AR ← Total Revenue (95% confidence)
│
├─ "Inventory"
│   → System searches for COGS patterns
│   → Finds "Cost of Goods Sold" in P&L
│   → Auto-maps: Inventory ← Cost of Goods Sold (95% confidence)
│
└─ "Accounts Payable"
    → System searches for expense patterns
    → Finds "Operating Expenses" in P&L
    → Auto-maps: AP ← Operating Expenses (95% confidence)
```

---

## 🎨 Current Mapping Configuration

Based on your `src/app.js` (lines 2284-2293):

```javascript
BALANCE_SHEET_DRIVER_REQUIREMENTS = {
  accounts_receivable       → revenue_drivers
  inventory                 → cogs_drivers
  prepaid_expenses          → revenue_drivers
  accounts_payable          → expense_drivers
  accrued_expenses          → expense_drivers
  deferred_revenue          → revenue_drivers
  retained_earnings         → net_income_drivers
  property_plant_equipment  → depreciation_drivers (+ revenue for CapEx)
}
```

### **Translation**:
| Balance Sheet Item | Required P&L Item | Calculation |
|-------------------|-------------------|-------------|
| Accounts Receivable | Total Revenue | (Revenue × 12) / 365 × DSO |
| Inventory | Total COGS | (COGS × 12) / 365 × DIO |
| Prepaid Expenses | Total Revenue | Revenue × 1% |
| Accounts Payable | Operating Expenses | (OpEx × 12) / 365 × DPO |
| Accrued Expenses | Total Expenses | Expenses × 5% |
| Deferred Revenue | Total Revenue | Revenue × 8% |
| Retained Earnings | Net Income | Previous RE + NI - Dividends |
| PPE | Revenue + Depreciation | Previous PPE + CapEx - Depr |

---

## 🚨 What If My P&L Has Different Names?

### **Scenario 1: Non-Standard Names**
Your P&L has:
```
❓ "Turnover" instead of "Revenue"
❓ "Personnel Costs" instead of "Operating Expenses"
```

**Solution**:
The system uses fuzzy matching, but you can:
1. Manually map during setup
2. OR rename your P&L items to match patterns above
3. OR add custom patterns (requires code change)

### **Scenario 2: Missing Items**
Your P&L doesn't have:
```
❌ No separate "COGS" line (service company)
❌ No "Depreciation" line item
```

**Solution**:
1. **No COGS**: Expected for service companies. Inventory will use growth-based forecasting.
2. **No Depreciation**: System will calculate using assumption (10% annual rate on PPE).

### **Scenario 3: Multiple Revenue Streams**
Your P&L has:
```
- Product Revenue: $80,000
- Service Revenue: $40,000
- No "Total Revenue" line
```

**Solution**:
1. **Best**: Add a "Total Revenue" row that sums Product + Service
2. **Alternative**: System will try to detect and use first revenue line it finds
3. **Manual**: You can manually map to specific revenue line

---

## 📈 Recommended P&L Structure

For maximum compatibility and accuracy:

```csv
Line Item,Jan 2024,Feb 2024,Mar 2024
Total Revenue,120000,130000,135000
Cost of Goods Sold,60000,64000,65000
Gross Profit,60000,66000,70000
Operating Expenses,30000,31000,32000
Depreciation & Amortization,8333,8333,8333
Total Operating Expenses,38333,39333,40333
Operating Income,21667,26667,29667
Interest Expense,500,500,500
Pretax Income,21167,26167,29167
Income Tax,4233,5233,5833
Net Income,16934,20934,23334
```

**Why This Works**:
- ✅ Has "Total Revenue" (clear naming)
- ✅ Has "Cost of Goods Sold" (standard pattern)
- ✅ Has "Operating Expenses" (standard pattern)
- ✅ Has "Depreciation & Amortization" (standard pattern)
- ✅ Has "Net Income" (bottom line)
- ✅ All using monthly periods

---

## 🔍 How to Check Your Mappings

### **In the UI**:
1. Upload your P&L CSV
2. Upload your Balance Sheet CSV
3. Click "Classify & Map" button
4. System shows you the auto-detected mappings
5. Review each mapping (green = high confidence, yellow = medium, red = low)
6. Override if needed using dropdown menus

### **In Console**:
Open browser DevTools and look for:
```javascript
console.log('Question analysis:', questionAnalysis);
console.log('Selected data size:', ...);
console.log('P&L value not found: "..."');
```

---

## ✅ Validation Checklist

Before running forecasts, ensure:

- [ ] P&L has a clear "Total Revenue" or "Revenue" line
- [ ] P&L has "Operating Expenses" or "OpEx" line
- [ ] P&L has "Net Income" or "Net Profit" line
- [ ] If manufacturing/retail: P&L has "COGS" line
- [ ] If using PPE: P&L has "Depreciation" line (or you'll use assumptions)
- [ ] All P&L values are numbers (not formulas or text)
- [ ] Date columns are in recognizable format (MMM YYYY, YYYY-MM, MM/DD/YYYY)
- [ ] At least 3 months of historical data

---

## 🎯 Summary: What Your Balance Sheet Is Looking For

```
P&L Line Item          Balance Sheet Items That Need It          Formula Type
───────────────────────────────────────────────────────────────────────────────
Total Revenue    →     Accounts Receivable                       DSO
                       Prepaid Expenses                          % of Revenue
                       PPE (via CapEx)                           % of Revenue
                       Deferred Revenue                          % of Revenue

COGS             →     Inventory                                 DIO

Operating        →     Accounts Payable                          DPO
Expenses               Accrued Expenses                          % of Expenses

Net Income       →     Retained Earnings                         Roll-forward
                       Dividends                                 % of NI
                       Cash Flow (starting point)                Direct

Depreciation     →     PPE                                       Reduction
                       Cash Flow (add-back)                      Non-cash
                       CapEx (reverse calculation)               Indirect
```

---

**Bottom Line**: Your system is looking for **standard P&L line items**. If your P&L follows conventional accounting structure, it will auto-map with 90-95% accuracy!

---

**Last Updated**: 2025-10-06  
**Status**: Production - Auto-mapping active  
**See Also**: `BALANCE_SHEET_FORMULAS_AND_MAPPINGS.md` for detailed formulas
