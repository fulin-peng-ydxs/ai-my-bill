/** 离线账本应用服务的本地数据契约；由调用者与 SQLite 服务共同维护，不生成 HTTP 路径或身份 DTO。 */
export interface LedgerContracts {
  DailyTemplateSummary: {
            /** Format: uuid */
            id: string;
            entryType: LedgerContracts["EntryType"];
            displayName: string;
            amount: LedgerContracts["Money"];
            contextName: string;
            /** Format: date-time */
            lastUsedAt: string;
        };
  DailyTemplateSelection: {
            /** Format: uuid */
            id: string;
            entryType: LedgerContracts["EntryType"];
            displayName: string;
            /** Format: uuid */
            productId?: string | null;
            productName?: string | null;
            /** Format: uuid */
            primaryCategoryId?: string | null;
            primaryCategoryName?: string | null;
            /** Format: uuid */
            secondaryCategoryId?: string | null;
            secondaryCategoryName?: string | null;
            /** Format: uuid */
            unitId?: string | null;
            unitName?: string | null;
            unitPrice?: LedgerContracts["UnitPrice"] | null;
            quantity?: LedgerContracts["Quantity"] | null;
            paidAmount?: LedgerContracts["Money"] | null;
            /** Format: uuid */
            fundingChannelId?: string | null;
            fundingChannelName?: string | null;
            /** Format: uuid */
            purchaseChannelId?: string | null;
            purchaseChannelName?: string | null;
            /** Format: uuid */
            locationLabelId?: string | null;
            locationLabelName?: string | null;
            incomeName?: string | null;
            /** Format: uuid */
            payerId?: string | null;
            payerName?: string | null;
            /** Format: uuid */
            incomeCategoryId?: string | null;
            incomeCategoryName?: string | null;
            incomeAmount?: LedgerContracts["Money"] | null;
            unavailableFields: ("productId" | "primaryCategoryId" | "secondaryCategoryId" | "unitId" | "fundingChannelId" | "purchaseChannelId" | "locationLabelId" | "payerId" | "incomeCategoryId")[];
        };
  DailyTemplateList: {
            items: LedgerContracts["DailyTemplateSummary"][];
        };
  EntryType: "EXPENSE" | "INCOME";
  CreateExpenseAdjustmentRequest: {
            adjustmentType: LedgerContracts["ExpenseAdjustmentType"];
            amount: LedgerContracts["Money"];
            occurredAt: LedgerContracts["BusinessDateTime"];
            note?: LedgerContracts["Note"];
        };
  ExpenseAdjustmentResponse: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            originalExpenseId: string;
            originalExpenseTitle: string;
            adjustmentType: LedgerContracts["ExpenseAdjustmentType"];
            amount: LedgerContracts["Money"];
            occurredAt: LedgerContracts["BusinessDateTime"];
            /** Format: date */
            businessDate: string;
            status: LedgerContracts["ExpenseAdjustmentStatus"];
            note?: LedgerContracts["Note"];
            originalPaidAmount: LedgerContracts["Money"];
            effectiveAdjustmentAmount: LedgerContracts["Money"];
            netExpenseAmount: LedgerContracts["Money"];
            fullyAdjusted: boolean;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
            /** Format: int64 */
            version: number;
        };
  ExpenseAdjustmentType: "REFUND" | "REIMBURSEMENT";
  CreateExpenseRequest: {
            /** Format: uuid */
            productId: string;
            /** Format: uuid */
            primaryCategoryId: string;
            /** Format: uuid */
            secondaryCategoryId?: string;
            /** Format: uuid */
            unitId: string;
            unitPrice: LedgerContracts["UnitPrice"];
            quantity: LedgerContracts["Quantity"];
            paidAmount: LedgerContracts["Money"];
            /** Format: uuid */
            fundingChannelId: string;
            /** Format: uuid */
            purchaseChannelId?: string;
            /** Format: uuid */
            locationLabelId?: string;
            occurredAt: LedgerContracts["BusinessDateTime"];
            note?: LedgerContracts["Note"];
        };
  ExpenseResponse: {
            /** Format: uuid */
            id: string;
            occurredAt: LedgerContracts["BusinessDateTime"];
            /** Format: date */
            businessDate: string;
            /** Format: uuid */
            productId: string;
            productName: string;
            /** Format: uuid */
            primaryCategoryId: string;
            primaryCategoryName: string;
            /** Format: uuid */
            secondaryCategoryId?: string;
            secondaryCategoryName?: string;
            /** Format: uuid */
            unitId: string;
            unitName: string;
            unitPrice: LedgerContracts["UnitPrice"];
            quantity: LedgerContracts["Quantity"];
            calculatedAmount: LedgerContracts["Money"];
            paidAmount: LedgerContracts["Money"];
            /** @description 当前有效退款/报销合计；编辑时实付金额不得低于该值。 */
            effectiveAdjustmentAmount: LedgerContracts["Money"];
            /** Format: uuid */
            fundingChannelId: string;
            fundingChannelName: string;
            /** Format: uuid */
            purchaseChannelId?: string;
            purchaseChannelName?: string;
            /** Format: uuid */
            locationLabelId?: string;
            locationLabelName?: string;
            note?: LedgerContracts["Note"];
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
            /** Format: int64 */
            version: number;
        };
  UpdateExpenseRequest: {
            /** Format: int64 */
            version: number;
            entry: LedgerContracts["CreateExpenseRequest"];
        };
  ProductSuggestion: {
            /** Format: uuid */
            id: string;
            name: string;
            /** Format: uuid */
            primaryCategoryId?: string;
            primaryCategoryName?: string;
            /** Format: uuid */
            secondaryCategoryId?: string;
            secondaryCategoryName?: string;
            /** Format: uuid */
            unitId?: string;
            unitName?: string;
            lastUnitPrice?: LedgerContracts["UnitPrice"];
            /** Format: uuid */
            fundingChannelId?: string;
            fundingChannelName?: string;
            /** Format: uuid */
            purchaseChannelId?: string;
            purchaseChannelName?: string;
        };
  ProductSuggestions: {
            items: LedgerContracts["ProductSuggestion"][];
        };
  ExportStatus: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED" | "EXPIRED";
  ExportResponse: {
            /** Format: uuid */
            id: string;
            scope: LedgerContracts["ExportScope"];
            status: LedgerContracts["ExportStatus"];
            /** Format: int64 */
            rowCount: number;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            expiresAt: string;
            errorMessage?: string;
            downloadUrl?: string;
        };
  CreateIncomeRequest: {
            incomeName: string;
            /** Format: uuid */
            payerId: string;
            /** Format: uuid */
            incomeCategoryId: string;
            amount: LedgerContracts["Money"];
            /** Format: uuid */
            fundingChannelId: string;
            occurredAt: LedgerContracts["BusinessDateTime"];
            note?: LedgerContracts["Note"];
        };
  IncomeResponse: {
            /** Format: uuid */
            id: string;
            occurredAt: LedgerContracts["BusinessDateTime"];
            /** Format: date */
            businessDate: string;
            incomeName: string;
            /** Format: uuid */
            payerId: string;
            payerName: string;
            /** Format: uuid */
            incomeCategoryId: string;
            incomeCategoryName: string;
            amount: LedgerContracts["Money"];
            /** Format: uuid */
            fundingChannelId: string;
            fundingChannelName: string;
            note?: LedgerContracts["Note"];
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
            /** Format: int64 */
            version: number;
        };
  UpdateIncomeRequest: {
            /** Format: int64 */
            version: number;
            entry: LedgerContracts["CreateIncomeRequest"];
        };
  LedgerItem: {
            /** Format: uuid */
            id: string;
            entryType: LedgerContracts["LedgerItemType"];
            /** Format: date-time */
            occurredAt: string;
            /** Format: date */
            businessDate: string;
            title: string;
            categoryName: string;
            counterpartyName: string;
            fundingChannelName: string;
            amount: LedgerContracts["Money"];
            note?: LedgerContracts["Note"];
            /** Format: date-time */
            createdAt: string;
            adjustmentType: LedgerContracts["ExpenseAdjustmentType"] | null;
            /** Format: uuid */
            originalExpenseId: string | null;
            effectiveAdjustmentAmount: LedgerContracts["Money"] | null;
            netExpenseAmount: LedgerContracts["Money"] | null;
            fullyAdjusted: boolean;
            /** Format: int64 */
            version: number;
            /** @enum {string} */
            lifecycleStatus: "ACTIVE" | "EFFECTIVE" | "TRASHED";
            /** Format: date-time */
            deletedAt?: string;
            /** Format: date-time */
            purgeAfter?: string;
            remainingDays?: number;
            linkedAdjustmentCount: number;
        };
  LedgerPage: {
            items: LedgerContracts["LedgerItem"][];
            /** @description hasMore=true 时返回。 */
            nextCursor?: string;
            hasMore: boolean;
        };
  LedgerEntryTypeFilter: "ALL" | "EXPENSE" | "INCOME" | "ADJUSTMENT" | "EXPENSE_FLOW";
  LedgerDateRange: "TODAY" | "THIS_WEEK" | "THIS_MONTH" | "LAST_MONTH" | "THIS_YEAR" | "CUSTOM";
  LedgerLifecycleFilter: "ACTIVE" | "TRASHED";
  ExpenseTimeBand: "NIGHT" | "MORNING" | "AFTERNOON" | "EVENING";
  LedgerLifecycleResponse: {
            /** Format: uuid */
            id: string;
            entryType: LedgerContracts["LedgerItemType"];
            /** @enum {string} */
            lifecycleStatus: "ACTIVE" | "EFFECTIVE" | "TRASHED";
            /** Format: date-time */
            deletedAt?: string;
            /** Format: date-time */
            purgeAfter?: string;
            /** Format: int64 */
            version: number;
            linkedAdjustmentCount: number;
        };
  ReportScope: "ALL" | "EXPENSE" | "INCOME";
  ReportSummary: {
            totalIncome: LedgerContracts["ReportAmount"];
            grossExpense: LedgerContracts["ReportAmount"];
            adjustmentAmount: LedgerContracts["ReportAmount"];
            netExpense: LedgerContracts["ReportAmount"];
            balance: LedgerContracts["ReportAmount"];
            /** Format: int64 */
            matchingItemCount: number;
            dataPoints: LedgerContracts["ReportDataPoint"][];
        };
  TimeReport: {
            grain: LedgerContracts["ReportTimeGrain"];
            /** Format: date */
            startDate: string;
            /** Format: date */
            endDate: string;
            buckets: LedgerContracts["TimeBucket"][];
            comparisons: LedgerContracts["MetricComparison"][];
        };
  ReportTimeGrain: "DAY" | "WEEK" | "MONTH" | "QUARTER" | "YEAR";
  ReportTimeMetric: "TOTAL_INCOME" | "GROSS_EXPENSE" | "ADJUSTMENT" | "NET_EXPENSE" | "BALANCE";
  ExpenseReport: {
            dimension: LedgerContracts["ExpenseReportDimension"];
            measureLabel: string;
            points: LedgerContracts["ExpenseReportPoint"][];
            truncated: boolean;
            qualityRule?: LedgerContracts["ExpenseQualityRule"];
        };
  ExpenseReportDimension: "CATEGORY" | "PRODUCT" | "FUNDING_CHANNEL" | "PURCHASE_CHANNEL" | "LOCATION" | "HABIT" | "PRICE" | "FREQUENCY" | "QUALITY";
  IncomeReport: {
            dimension: LedgerContracts["IncomeReportDimension"];
            measureLabel: string;
            points: LedgerContracts["IncomeReportPoint"][];
            truncated: boolean;
        };
  IncomeReportDimension: "CATEGORY" | "FUNDING_CHANNEL" | "PAYER" | "NAME" | "FREQUENCY";
  ReportDataPoint: {
            label: string;
            /** @enum {string} */
            value: "INCOME" | "EXPENSE" | "ADJUSTMENT";
            amount: LedgerContracts["ReportAmount"];
            /** Format: int64 */
            itemCount: number;
        };
  DictionaryType: "product" | "expense-category" | "unit" | "funding-channel" | "purchase-channel" | "location" | "income-category" | "payer";
  PreferenceResponse: {
            /** Format: uuid */
            defaultFundingChannelId?: string | null;
            defaultFundingChannelName?: string;
            ledgerDefaultRange: LedgerContracts["LedgerDefaultRange"];
            reportDefaultRange: LedgerContracts["ReportDefaultRange"];
            themeMode: LedgerContracts["ThemeMode"];
            recentEntryType: LedgerContracts["EntryType"];
            /** Format: date-time */
            updatedAt: string;
        };
  PreferenceRequest: {
            /** Format: uuid */
            defaultFundingChannelId?: string | null;
            ledgerDefaultRange: LedgerContracts["LedgerDefaultRange"];
            reportDefaultRange: LedgerContracts["ReportDefaultRange"];
            themeMode: LedgerContracts["ThemeMode"];
            recentEntryType: LedgerContracts["EntryType"];
        };
  LedgerDefaultRange: "TODAY" | "THIS_WEEK" | "THIS_MONTH";
  ReportDefaultRange: "THIS_WEEK" | "THIS_MONTH" | "LAST_MONTH" | "THIS_YEAR";
  DictionaryItem: {
            /** Format: uuid */
            id: string;
            type: LedgerContracts["DictionaryType"];
            name: string;
            status: LedgerContracts["DictionaryStatus"];
            sortOrder: number;
            /** Format: uuid */
            parentId?: string;
            parentName?: string;
            referenced: boolean;
        };
  DictionaryPage: {
            items: LedgerContracts["DictionaryItem"][];
            /** Format: int64 */
            total: number;
            page: number;
            size: number;
        };
  DictionaryStatus: "ACTIVE" | "INACTIVE";
  DictionarySummaries: {
            items: LedgerContracts["DictionarySummary"][];
        };
  ProductMergePreview: {
            source: LedgerContracts["ProductIdentity"];
            target: LedgerContracts["ProductIdentity"];
            /** Format: int64 */
            affectedLedgerEntries: number;
            affectedTemplates: number;
            templateConflict: boolean;
        };
  ProductMergeResult: {
            /** Format: uuid */
            mergeEventId: string;
            impact: LedgerContracts["ProductMergePreview"];
        };
  Money: string;
  UnitPrice: string;
  Quantity: string;
  BusinessDateTime: string;
  Note: string;
  ExpenseAdjustmentStatus: "EFFECTIVE" | "REVOKED" | "TRASHED" | "SOURCE_FROZEN";
  ExportScope: "CURRENT_FILTERS" | "ALL_DATA";
  LedgerItemType: "EXPENSE" | "INCOME" | "ADJUSTMENT";
  ReportAmount: string;
  TimeBucket: {
            /** Format: date */
            startDate: string;
            /** Format: date */
            endDate: string;
            label: string;
            totalIncome: LedgerContracts["ReportAmount"];
            grossExpense: LedgerContracts["ReportAmount"];
            adjustmentAmount: LedgerContracts["ReportAmount"];
            netExpense: LedgerContracts["ReportAmount"];
            balance: LedgerContracts["ReportAmount"];
            cumulativeIncome: LedgerContracts["ReportAmount"];
            cumulativeGrossExpense: LedgerContracts["ReportAmount"];
            cumulativeAdjustmentAmount: LedgerContracts["ReportAmount"];
            cumulativeNetExpense: LedgerContracts["ReportAmount"];
            cumulativeBalance: LedgerContracts["ReportAmount"];
            /** Format: int64 */
            incomeCount: number;
            /** Format: int64 */
            expenseCount: number;
            /** Format: int64 */
            adjustmentCount: number;
            /** Format: int64 */
            itemCount: number;
        };
  MetricComparison: {
            metric: LedgerContracts["ReportTimeMetric"];
            currentAmount: LedgerContracts["ReportAmount"];
            periodOverPeriod: LedgerContracts["PeriodComparison"];
            yearOverYear: LedgerContracts["PeriodComparison"];
        };
  ExpenseReportPoint: {
            group: string;
            label: string;
            value: string;
            amount: LedgerContracts["ReportAmount"];
            /** Format: int64 */
            itemCount: number;
            sharePercent?: string;
            detail?: string;
            warning?: string;
            /** Format: uuid */
            entryId?: string;
            /** Format: date */
            drillStartDate?: string;
            /** Format: date */
            drillEndDate?: string;
        };
  ExpenseQualityRule: {
            /** @enum {string} */
            version: "expense-quality-v1";
            priceWindowDays: number;
            minimumPriceSamples: number;
            highPriceMultiplier: string;
            duplicateWindowMinutes: number;
        };
  IncomeReportPoint: {
            group: string;
            label: string;
            value: string;
            amount: LedgerContracts["ReportAmount"];
            /** Format: int64 */
            itemCount: number;
            sharePercent?: string;
            detail?: string;
        };
  ThemeMode: "SYSTEM" | "LIGHT" | "DARK";
  DictionarySummary: {
            type: LedgerContracts["DictionaryType"];
            /** Format: int64 */
            total: number;
            /** Format: int64 */
            active: number;
        };
  ProductIdentity: {
            /** Format: uuid */
            id: string;
            name: string;
        };
  PeriodComparison: {
            /** Format: date */
            startDate: string;
            /** Format: date */
            endDate: string;
            amount?: LedgerContracts["ReportAmount"];
            changePercent?: string;
            unavailableReason?: string;
        };
}
