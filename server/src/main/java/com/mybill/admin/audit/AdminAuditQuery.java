package com.mybill.admin.audit;

import java.time.Instant;

record AdminAuditQuery(String administrator, String action, String object, AuditResult result,
                       Instant startAt, int limit, int offset) { }
