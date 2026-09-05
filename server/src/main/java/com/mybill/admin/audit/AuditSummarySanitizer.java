package com.mybill.admin.audit;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.Set;
import java.util.Iterator;

/** 递归移除敏感键，并且只保留真实变化的顶层白名单字段。 */
@Component
public final class AuditSummarySanitizer {
    private static final Set<String> SENSITIVE_KEYS = Set.of(
            "password", "passphrase", "token", "secret", "credential", "authorization",
            "cookie", "session", "latitude", "longitude", "coordinates", "preciseaddress");
    private static final int MAX_DEPTH = 6;
    private static final int MAX_CHILDREN = 50;
    private static final int MAX_NODES = 256;
    private static final int MAX_TEXT = 200;
    private final ObjectMapper mapper;

    public AuditSummarySanitizer(ObjectMapper mapper) { this.mapper = mapper; }

    public Map<String, Object> changedFields(AuditPolicy policy, AuditEvent event) {
        ObjectNode changes = JsonNodeFactory.instance.objectNode();
        int[] remainingNodes = {MAX_NODES};
        policy.allowedFields().stream().sorted().forEach(field -> {
            JsonNode before = sanitize(mapper.valueToTree(event.before().get(field)), 0, remainingNodes);
            JsonNode after = sanitize(mapper.valueToTree(event.after().get(field)), 0, remainingNodes);
            if (!before.equals(after)) {
                ObjectNode change = changes.putObject(field);
                change.set("before", before);
                change.set("after", after);
            }
        });
        return mapper.convertValue(Map.of("changes", changes), mapper.getTypeFactory()
                .constructMapType(Map.class, String.class, Object.class));
    }

    static boolean isSensitiveKey(String key) {
        if (key == null || key.isBlank()) return true;
        String normalized = key.replaceAll("[^A-Za-z]", "").toLowerCase();
        return SENSITIVE_KEYS.stream().anyMatch(normalized::contains);
    }

    private JsonNode sanitize(JsonNode value, int depth, int[] remainingNodes) {
        if (value == null || value.isMissingNode() || value.isNull()) return JsonNodeFactory.instance.nullNode();
        if (remainingNodes[0]-- <= 0) throw new IllegalArgumentException("audit summary exceeds node limit");
        if (depth >= MAX_DEPTH) throw new IllegalArgumentException("audit summary exceeds depth limit");
        if (value.isTextual()) {
            String text = value.textValue();
            if (text.length() > MAX_TEXT) throw new IllegalArgumentException("audit summary text is too long");
            return JsonNodeFactory.instance.textNode(text);
        }
        if (value.isObject()) {
            ObjectNode result = JsonNodeFactory.instance.objectNode();
            int count = 0;
            Iterator<Map.Entry<String, JsonNode>> entries = value.properties().iterator();
            while (entries.hasNext()) {
                Map.Entry<String, JsonNode> entry = entries.next();
                if (!isSensitiveKey(entry.getKey())) {
                    if (++count > MAX_CHILDREN) throw new IllegalArgumentException("audit summary has too many fields");
                    result.set(entry.getKey(), sanitize(entry.getValue(), depth + 1, remainingNodes));
                }
            }
            return result;
        }
        if (value.isArray()) {
            if (value.size() > MAX_CHILDREN) throw new IllegalArgumentException("audit summary array is too large");
            ArrayNode result = JsonNodeFactory.instance.arrayNode();
            for (int index = 0; index < value.size(); index++) {
                result.add(sanitize(value.get(index), depth + 1, remainingNodes));
            }
            return result;
        }
        return value.isValueNode() ? value.deepCopy() : JsonNodeFactory.instance.textNode("[unsupported]");
    }
}
