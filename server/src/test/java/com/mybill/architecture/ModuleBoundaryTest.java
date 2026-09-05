package com.mybill.architecture;

import com.mybill.MyBillApplication;
import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.lang.ArchRule;

import static com.tngtech.archunit.library.dependencies.SlicesRuleDefinition.slices;

/**
 * 防止领域包形成循环依赖；更细的跨模块入口规则随真实模块在对应阶段补齐。
 */
@AnalyzeClasses(packagesOf = MyBillApplication.class, importOptions = ImportOption.DoNotIncludeTests.class)
class ModuleBoundaryTest {

    @ArchTest
    static final ArchRule MODULES_MUST_BE_FREE_OF_CYCLES = slices()
            .matching("com.mybill.(*)..")
            .should().beFreeOfCycles()
            .because("领域模块必须保持可独立演进，shared 只提供稳定公共合同");
}
