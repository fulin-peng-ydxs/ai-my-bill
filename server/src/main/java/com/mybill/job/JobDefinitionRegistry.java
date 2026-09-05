package com.mybill.job;

import org.springframework.stereotype.Component;

import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Component
public final class JobDefinitionRegistry {
    private final Map<String, JobDefinition> definitions;

    public JobDefinitionRegistry(List<JobDefinition> values) {
        Map<String, JobDefinition> indexed = new LinkedHashMap<>();
        values.stream().sorted(java.util.Comparator.comparing(JobDefinition::jobType)).forEach(definition -> {
            if (definition.jobType() == null || !definition.jobType().matches("[A-Z][A-Z0-9_]{0,63}")
                    || definition.scope() == null || definition.maxAttempts() < 1 || definition.maxAttempts() > 20
                    || indexed.putIfAbsent(definition.jobType(), definition) != null) {
                throw new IllegalStateException("invalid or duplicate job definition");
            }
        });
        definitions = Map.copyOf(indexed);
    }

    public JobDefinition require(String type) {
        JobDefinition definition = definitions.get(type);
        if (definition == null) throw new IllegalArgumentException("unknown job type");
        return definition;
    }

    public JobDefinition find(String type) { return definitions.get(type); }
    public Collection<String> types() { return definitions.keySet(); }
}
