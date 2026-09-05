package com.mybill.persistence.model;

import jakarta.persistence.Version;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/** T2 持久化语义契约：可编辑的收支记录必须由 JPA 执行版本校验。 */
class PersistenceMappingContractTest {

    @Test
    void ledgerAndAdjustmentVersionsUseOptimisticLocking() throws NoSuchFieldException {
        assertThat(LedgerEntryEntity.class.getDeclaredField("version").isAnnotationPresent(Version.class)).isTrue();
        assertThat(ExpenseAdjustmentEntity.class.getDeclaredField("version").isAnnotationPresent(Version.class)).isTrue();
    }
}
