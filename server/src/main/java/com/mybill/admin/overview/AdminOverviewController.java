package com.mybill.admin.overview;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/admin/overview")
public class AdminOverviewController {
    private final AdminOverviewService service;

    AdminOverviewController(AdminOverviewService service) {
        this.service = service;
    }

    @GetMapping
    AdminOverviewContracts.AdminOverview overview() {
        return service.overview();
    }
}
