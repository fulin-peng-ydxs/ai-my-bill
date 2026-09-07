package com.mybill.ledger;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class ExportCsvWriterTest {
    @Test void protectsSpreadsheetFormulaPrefixesWithoutChangingOrdinaryText() {
        assertThat(ExportCsvWriter.safeText("=SUM(A1:A2)")).isEqualTo("'=SUM(A1:A2)");
        assertThat(ExportCsvWriter.safeText("+cmd|' /C calc'!A0")).startsWith("'");
        assertThat(ExportCsvWriter.safeText("-1+2")).isEqualTo("'-1+2");
        assertThat(ExportCsvWriter.safeText("@malicious")).isEqualTo("'@malicious");
        assertThat(ExportCsvWriter.safeText("  =SUM(A1:A2)")).isEqualTo("'  =SUM(A1:A2)");
        assertThat(ExportCsvWriter.safeText("\n@malicious")).isEqualTo("'\n@malicious");
        assertThat(ExportCsvWriter.safeText("普通备注")).isEqualTo("普通备注");
        assertThat(ExportCsvWriter.safeText(null)).isEmpty();
    }
}
