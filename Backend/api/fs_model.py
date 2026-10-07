"""Financial-statement model shared by the Reports module.

The layout follows the audited statements in the "FS ... Mapping YE2025" workbooks
(Ali Al-Dowayan Holding consolidated, ADD SPF, Tazayud):
  * every ledger main account is mapped to one statement LINE (code below) and an optional NOTE line;
  * the mapping comes from the workbooks' "TB25 Dec" sheets (FSLI + Note columns) and, for accounts that
    are not in a workbook, from the Aldowayan chart-of-accounts ranges (RULES).
Amounts in dw.fact_gl are debit +, credit -.  Asset lines show the balance, equity / liability lines and
income-statement lines show -balance (so income is positive and costs negative, as in the signed FS).
"""
import re

# kind: H = heading, L = line (accounts map here), T = total (sum of other codes)
IS_LAYOUT = [
    ("H", "H_REV", "Revenues"),
    ("L", "REV_RENT", "Rental income"),
    ("L", "REV_INV", "Revenue from sales of inventory properties"),
    ("L", "REV_PROJ", "Revenue from projects"),
    ("L", "REV_FL", "Gain on derecognition of finance lease"),
    ("T", "TOT_REV", "Total revenues", ["REV_RENT", "REV_INV", "REV_PROJ", "REV_FL"]),
    ("L", "COS_RENT", "Cost of rental"),
    ("L", "COS_INV", "Cost of sold inventory properties"),
    ("L", "COS_OTH", "Other direct costs"),
    ("T", "TOT_COS", "Direct costs", ["COS_RENT", "COS_INV", "COS_OTH"]),
    ("T", "GP", "Gross profit", ["TOT_REV", "TOT_COS"]),
    ("H", "H_EXP", "Expenses"),
    ("L", "GA", "General and administrative expenses"),
    ("L", "SM", "Selling and marketing expenses"),
    ("L", "ECL", "Provision for expected credit loss"),
    ("L", "OI", "Other income"),
    ("L", "IS_OTH", "Other operating items (not mapped)"),
    ("T", "OP", "Operating profit", ["GP", "GA", "SM", "ECL", "OI", "IS_OTH"]),
    ("L", "OIN", "Other income, net"),
    ("L", "UNR", "Unrealized profit from investments"),
    ("L", "SUB", "Share in result of a subsidiary"),
    ("L", "FIN_INC", "Finance income"),
    ("L", "FIN_COST", "Finance costs"),
    ("T", "PBZ", "Profit before zakat", ["OP", "OIN", "UNR", "SUB", "FIN_INC", "FIN_COST"]),
    ("L", "ZAKAT", "Zakat"),
    ("T", "PFY", "Profit for the year", ["PBZ", "ZAKAT"]),
    ("H", "H_OCI", "Other comprehensive income"),
    ("L", "OCI_NR", "Items that will not be reclassified to profit or loss"),
    ("L", "OCI_EOSB", "Remeasurement gain / (loss) on employee terminal benefits"),
    ("T", "TOT_OCI", "Other comprehensive income for the year", ["OCI_NR", "OCI_EOSB"]),
    ("T", "TCI", "Total comprehensive income for the year", ["PFY", "TOT_OCI"]),
]

BS_LAYOUT = [
    ("H", "H_ASSETS", "Assets"),
    ("H", "H_NCA", "Non-current assets"),
    ("L", "ROU", "Right of use assets"),
    ("L", "PPE", "Property and equipment"),
    ("L", "INV_SUB", "Investment in a subsidiary"),
    ("L", "IP", "Investment properties"),
    ("L", "INV_RE", "Investments in share in real estate projects"),
    ("L", "NIFL_NC", "Net investment in finance lease"),
    ("L", "EQ_COST", "Equity instruments measured at cost less impairment"),
    ("L", "NCA_OTH", "Other non-current assets (not mapped)"),
    ("T", "TOT_NCA", "Total non-current assets", ["ROU", "PPE", "INV_SUB", "IP", "INV_RE", "NIFL_NC", "EQ_COST", "NCA_OTH"]),
    ("H", "H_CA", "Current assets"),
    ("L", "INV_PROP", "Inventory properties / projects under development"),
    ("L", "NIFL_C", "Net investment in finance lease - current"),
    ("L", "EQ_FV", "Equity instruments measured at fair value through profit or loss"),
    ("L", "CONTRACT", "Contract assets"),
    ("L", "AR", "Trade receivables"),
    ("L", "DUE_FROM", "Amounts due from a related party"),
    ("L", "PREPAY", "Prepayments and other receivables"),
    ("L", "ZAKAT_A", "Zakat receivable"),
    ("L", "RCASH", "Restricted cash"),
    ("L", "CASH", "Cash and cash equivalents"),
    ("L", "CA_OTH", "Other current assets (not mapped)"),
    ("T", "TOT_CA", "Total current assets",
     ["INV_PROP", "NIFL_C", "EQ_FV", "CONTRACT", "AR", "DUE_FROM", "PREPAY", "ZAKAT_A", "RCASH", "CASH", "CA_OTH"]),
    ("T", "TA", "Total assets", ["TOT_NCA", "TOT_CA"]),
    ("H", "H_EL", "Equity and liabilities"),
    ("H", "H_EQ", "Equity"),
    ("L", "SHARE", "Share capital"),
    ("L", "CONTRIB", "Contribution from shareholders"),
    ("L", "STAT_RES", "Statutory and other reserves"),
    ("L", "RE", "Retained earnings"),
    ("L", "EQ_OTH", "Other equity / opening balance accounts (not mapped)"),
    ("T", "TOT_EQ", "Total equity", ["SHARE", "CONTRIB", "STAT_RES", "RE", "EQ_OTH"]),
    ("H", "H_NCL", "Non-current liabilities"),
    ("L", "EOSB", "Employee terminal benefits"),
    ("L", "TL_NC", "Term loans"),
    ("L", "TP_NC", "Trade payables / retention - non-current"),
    ("L", "LEASE_NC", "Lease liabilities - non-current portion"),
    ("L", "NCL_OTH", "Other non-current liabilities (not mapped)"),
    ("T", "TOT_NCL", "Total non-current liabilities", ["EOSB", "TL_NC", "TP_NC", "LEASE_NC", "NCL_OTH"]),
    ("H", "H_CL", "Current liabilities"),
    ("L", "TL_C", "Term loan - current portion"),
    ("L", "LEASE_C", "Lease liabilities - current portion"),
    ("L", "TP", "Trade payables"),
    ("L", "DUE_TO", "Due to related party"),
    ("L", "ACCR", "Accrued expenses and other liabilities"),
    ("L", "ZAKAT_L", "Provision for zakat"),
    ("L", "CL_OTH", "Other current liabilities (not mapped)"),
    ("T", "TOT_CL", "Total current liabilities", ["TL_C", "LEASE_C", "TP", "DUE_TO", "ACCR", "ZAKAT_L", "CL_OTH"]),
    ("T", "TL", "Total liabilities", ["TOT_NCL", "TOT_CL"]),
    ("T", "TEL", "Total equity and liabilities", ["TOT_EQ", "TL"]),
]

IS_LINES = {r[1] for r in IS_LAYOUT if r[0] == "L"}
BS_LINES = {r[1] for r in BS_LAYOUT if r[0] == "L"}
ASSET_LINES = {c for c in BS_LINES if BS_LAYOUT.index(next(r for r in BS_LAYOUT if r[1] == c))
               < BS_LAYOUT.index(next(r for r in BS_LAYOUT if r[1] == "TA"))}
LABEL = {r[1]: r[2] for r in IS_LAYOUT + BS_LAYOUT}


def statement_of(line: str) -> str:
    return "IS" if line in IS_LINES else "BS"


def sign_of(line: str) -> int:
    """Multiplier from ledger balance (debit +) to the number shown on the statement."""
    return 1 if line in ASSET_LINES else -1


# ---------------------------------------------------------------- chart-of-accounts ranges (fallback) ----
# (account prefix, line). Longest matching prefix wins. Based on the Aldowayan COA (7-digit accounts).
RULES = [
    ("1111", "CASH"), ("1112", "CASH"), ("1113", "CASH"), ("1115", "CASH"), ("1114", "RCASH"), ("111", "CASH"),
    ("112", "EQ_FV"), ("1131", "AR"), ("1132", "DUE_FROM"), ("113", "PREPAY"), ("114", "PREPAY"),
    ("115", "INV_PROP"), ("116", "CONTRACT"), ("1171", "ROU"), ("117", "CA_OTH"), ("11", "CA_OTH"),
    ("1217", "ROU"), ("1219", "NIFL_NC"), ("121", "PPE"), ("122", "INV_PROP"), ("123", "IP"), ("124", "PPE"),
    ("1251", "INV_SUB"), ("1252", "INV_RE"), ("1253", "EQ_COST"), ("12", "NCA_OTH"),
    ("2111", "TP"), ("2112", "TP"), ("2113", "TP"), ("2114", "TP_NC"), ("2115", "DUE_TO"),
    ("212", "ACCR"), ("214", "ACCR"), ("2151", "LEASE_C"), ("2152", "TL_C"), ("217", "ACCR"), ("21", "CL_OTH"),
    ("2211", "EOSB"), ("2221", "TL_NC"), ("22", "NCL_OTH"),
    ("3111", "SHARE"), ("3112", "CONTRIB"), ("3121", "RE"), ("3122", "STAT_RES"), ("3123", "RE"),
    ("315", "STAT_RES"), ("3", "EQ_OTH"),
    ("4111", "REV_RENT"), ("4113", "REV_RENT"), ("4112", "REV_INV"), ("412", "REV_PROJ"), ("4216", "REV_FL"),
    ("4211", "UNR"), ("4213", "UNR"), ("4217", "FIN_INC"), ("42", "OI"), ("4", "REV_RENT"),
    ("5111", "COS_RENT"), ("5112", "COS_INV"), ("511", "COS_OTH"), ("5171", "FIN_COST"), ("516", "SM"),
    ("514", "GA"), ("515", "GA"), ("517", "GA"), ("5", "GA"),
    ("6", "OCI_NR"), ("9", "EQ_OTH"),
]


def rule_line(account: str, name: str = "") -> str:
    a, n = str(account), (name or "").lower()
    if "zakat" in n:
        return "ZAKAT" if a[:1] in "56" else ("ZAKAT_A" if a[:1] == "1" else "ZAKAT_L")
    if a[:1] == "5" and ("expected credit" in n or "doubtful" in n):
        return "ECL"
    if a[:1] == "2" and "lease" in n:
        return "LEASE_NC" if a.startswith("22") else "LEASE_C"
    if a[:1] == "6" and ("remeasurement" in n or "employee" in n or "eosb" in n):
        return "OCI_EOSB"
    if a == "4213003" or "dividend" in n:
        return "OIN"
    best = None
    for p, line in RULES:
        if a.startswith(p) and (best is None or len(p) > len(best[0])):
            best = (p, line)
    if best:
        return best[1]
    return "CA_OTH" if a[:1] == "1" else "CL_OTH" if a[:1] == "2" else "IS_OTH"


# ---------------------------------------------------------------- workbook FSLI names -> line ----
def _norm(s) -> str:
    return re.sub(r"\s+", " ", str(s or "")).strip().lower().replace("’", "'")


FSLI = {
    "cash and cash equivalents": "CASH", "cash and cash equivalent": "CASH", "restricted cash": "RCASH",
    "trade receivable": "AR", "trade receivables": "AR", "contract assets": "CONTRACT",
    "amounts due to the owner": "DUE_TO", "due to related party": "DUE_TO",
    "amounts due from a related party": "DUE_FROM", "prepayments and other receivables": "PREPAY",
    "projects under development": "INV_PROP", "inventory properties": "INV_PROP",
    "retention payable": "TP_NC", "accrued expenses and other liabilities": "ACCR",
    "employees' defined benefits liabilities": "EOSB", "share capital": "SHARE", "retained earnings": "RE",
    "equity": "EQ_OTH", "additional equity contributions": "CONTRIB",
    "equity instruments measured at fair value through profit or loss": "EQ_FV",
    "equity instruments measured at cost less impairment": "EQ_COST",
    "right of use assets": "ROU", "property and equipment": "PPE", "investment properties": "IP",
    "investment in a subsidiary": "INV_SUB", "unearned finance income": "NIFL_NC",
    "net investment in finance lease": "NIFL_NC",
    "general and administrative expenses": "GA", "selling and marketing expenses": "SM",
    "provision for expected credit loss": "ECL", "other income": "OI", "other income, net": "OIN",
    "unrealized profit from investment": "UNR", "finance income": "FIN_INC", "finance costs": "FIN_COST",
    "zakat expense": "ZAKAT", "sale of investment properties cost": "COS_INV",
    "eosb oci": "OCI_EOSB", "(loss) gain on remeasurement of employee benefit obligations": "OCI_EOSB", "oci": "OCI_NR",
}
NOTE_REVENUE = {"rental income": "REV_RENT", "gain on sale of inventory properties": "REV_INV",
                "revenue from sales of inventory properties": "REV_INV",
                "gain on derecognition of finance lease": "REV_FL"}


def line_from_workbook(account: str, name: str, fsli: str, note: str) -> str:
    a, f, n = str(account), _norm(fsli), _norm(note)
    if f == "revenue":
        return NOTE_REVENUE.get(n) or (rule_line(a, name) if a[:1] == "4" else "REV_RENT")
    if f == "cost of sales":
        return "COS_RENT" if a.startswith("5111") else "COS_INV"
    if f == "trade payable" or f == "trade payables":
        return "TP_NC" if a.startswith("2114") or a.startswith("22") else "TP"
    if f == "provision for zakat":
        return "ZAKAT_A" if a[:1] == "1" else "ZAKAT_L"
    if f == "term loan":
        return "TL_NC" if a.startswith("22") else "TL_C"
    if f == "lease liabilities":
        return "LEASE_NC" if a.startswith("22") else "LEASE_C"
    if f == "share in result of a subsidiary":
        return "SUB" if a[:1] in "45" else "INV_SUB"
    if f in FSLI:
        return FSLI[f]
    return rule_line(a, name)


def compute(layout, values: dict) -> dict:
    """values: {line_code: shown amount}. Returns values for every L and T code of the layout."""
    out = {c: values.get(c, 0.0) for k, c, *_ in layout if k == "L"}
    for row in layout:
        if row[0] == "T":
            out[row[1]] = sum(out.get(c, 0.0) for c in row[3])
    return out


# ---------------------------------------------------------------- cash flow (indirect method) ----
# Built from the movement of every balance-sheet line between two dates plus the income statement, so the
# net change always equals the change in cash when the balance sheet balances.
CF_LAYOUT = [
    ("H", "H_OP", "Cash flows from operating activities"),
    ("L", "CF_PBZ", "Profit before zakat"),
    ("H", "H_NONCASH", "Adjustments for non-cash items"),
    ("L", "CF_DEP", "Depreciation and amortisation"),
    ("L", "CF_UNR", "Unrealized gains on investments"),
    ("L", "CF_SUB", "Share in result of a subsidiary"),
    ("L", "CF_OCI", "Other comprehensive income (non-cash)"),
    ("T", "CF_OPWC", "Operating cash flow before working capital changes", ["CF_PBZ", "CF_DEP", "CF_UNR", "CF_SUB", "CF_OCI"]),
    ("H", "H_WC", "Changes in working capital"),
    ("L", "CF_INV", "Inventory properties / projects under development"),
    ("L", "CF_CONTRACT", "Contract assets"),
    ("L", "CF_AR", "Trade receivables"),
    ("L", "CF_DUEFROM", "Amounts due from related parties"),
    ("L", "CF_PREPAY", "Prepayments and other receivables"),
    ("L", "CF_TP", "Trade payables and retentions"),
    ("L", "CF_DUETO", "Due to related parties"),
    ("L", "CF_ACCR", "Accrued expenses and other liabilities"),
    ("L", "CF_EOSB", "Employee terminal benefits"),
    ("L", "CF_WCOTH", "Other working capital items"),
    ("T", "CF_GEN", "Cash generated from operations",
     ["CF_OPWC", "CF_INV", "CF_CONTRACT", "CF_AR", "CF_DUEFROM", "CF_PREPAY", "CF_TP", "CF_DUETO", "CF_ACCR", "CF_EOSB", "CF_WCOTH"]),
    ("L", "CF_ZAKAT", "Zakat paid"),
    ("T", "CF_NET_OP", "Net cash from operating activities", ["CF_GEN", "CF_ZAKAT"]),
    ("H", "H_INVEST", "Cash flows from investing activities"),
    ("L", "CF_CAPEX", "Additions to property, investment properties and right-of-use assets"),
    ("L", "CF_INVEST", "Investments in subsidiaries, projects and equity instruments"),
    ("L", "CF_FINLEASE", "Net investment in finance lease"),
    ("L", "CF_RCASH", "Restricted cash"),
    ("T", "CF_NET_INV", "Net cash used in investing activities", ["CF_CAPEX", "CF_INVEST", "CF_FINLEASE", "CF_RCASH"]),
    ("H", "H_FIN", "Cash flows from financing activities"),
    ("L", "CF_LOANS", "Term loans (net)"),
    ("L", "CF_LEASES", "Lease liabilities (net)"),
    ("L", "CF_EQUITY", "Contributions, dividends and other equity movements"),
    ("T", "CF_NET_FIN", "Net cash from financing activities", ["CF_LOANS", "CF_LEASES", "CF_EQUITY"]),
    ("T", "CF_NET", "Net change in cash and cash equivalents", ["CF_NET_OP", "CF_NET_INV", "CF_NET_FIN"]),
    ("L", "CF_BEGIN", "Cash and cash equivalents at the beginning of the period"),
    ("T", "CF_END", "Cash and cash equivalents at the end of the period", ["CF_NET", "CF_BEGIN"]),
]


def cash_flow(bs_now: dict, bs_start: dict, is_ytd: dict, dep: float) -> tuple[dict, float]:
    """bs_* = shown balance-sheet line values (computed totals included), is_ytd = shown income-statement values
    for the period, dep = depreciation charged in the period (positive). Returns (line values, check)."""
    g = lambda c: bs_now.get(c, 0.0) - bs_start.get(c, 0.0)          # noqa: E731  increase of a line
    i = lambda c: is_ytd.get(c, 0.0)                                   # noqa: E731
    v = {
        "CF_PBZ": i("PBZ"), "CF_DEP": dep, "CF_UNR": -i("UNR"), "CF_SUB": -i("SUB"), "CF_OCI": i("TOT_OCI"),
        "CF_INV": -g("INV_PROP"), "CF_CONTRACT": -g("CONTRACT"), "CF_AR": -g("AR"), "CF_DUEFROM": -g("DUE_FROM"),
        "CF_PREPAY": -g("PREPAY"),
        "CF_TP": g("TP") + g("TP_NC"), "CF_DUETO": g("DUE_TO"), "CF_ACCR": g("ACCR"), "CF_EOSB": g("EOSB"),
        "CF_WCOTH": -g("CA_OTH") + g("CL_OTH") + g("NCL_OTH"),
        "CF_ZAKAT": i("ZAKAT") + g("ZAKAT_L") - g("ZAKAT_A"),
        "CF_CAPEX": -(g("PPE") + g("IP") + g("ROU") + g("NCA_OTH")) - dep,
        "CF_INVEST": -(g("INV_SUB") + g("INV_RE") + g("EQ_COST") + g("EQ_FV")) + i("UNR") + i("SUB"),
        "CF_FINLEASE": -(g("NIFL_NC") + g("NIFL_C")),
        "CF_RCASH": -g("RCASH"),
        "CF_LOANS": g("TL_NC") + g("TL_C"),
        "CF_LEASES": g("LEASE_NC") + g("LEASE_C"),
        "CF_EQUITY": g("SHARE") + g("CONTRIB") + g("STAT_RES") + g("EQ_OTH") + g("RE") - i("TCI"),
        "CF_BEGIN": bs_start.get("CASH", 0.0),
    }
    out = compute(CF_LAYOUT, v)
    return out, out["CF_END"] - bs_now.get("CASH", 0.0)
