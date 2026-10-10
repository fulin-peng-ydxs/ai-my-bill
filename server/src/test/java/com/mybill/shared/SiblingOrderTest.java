package com.mybill.shared;

import org.junit.jupiter.api.Test;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class SiblingOrderTest {
    private final UUID a = UUID.randomUUID();
    private final UUID b = UUID.randomUUID();
    private final UUID c = UUID.randomUUID();
    private final UUID d = UUID.randomUUID();

    @Test
    void insertsAcrossHiddenSiblingsAndRepeatingTheRequestIsANoop() {
        var ids = new ArrayList<>(List.of(a, b, c, d));
        assertThat(SiblingOrder.move(ids, a, d, false)).isTrue();
        assertThat(ids).containsExactly(b, c, d, a);
        assertThat(SiblingOrder.move(ids, a, d, false)).isFalse();
        assertThat(SiblingOrder.move(ids, a, b, true)).isTrue();
        assertThat(ids).containsExactly(a, b, c, d);
        assertThat(SiblingOrder.move(ids, a, a, true)).isFalse();
    }

    @Test
    void preservesSingleStepCompatibilityAndBoundaries() {
        var ids = new ArrayList<>(List.of(a, b, c));
        assertThat(SiblingOrder.move(ids, a, null, true)).isFalse();
        assertThat(SiblingOrder.move(ids, c, null, false)).isFalse();
        assertThat(SiblingOrder.move(ids, b, null, true)).isTrue();
        assertThat(ids).containsExactly(b, a, c);
        assertThat(SiblingOrder.move(ids, b, null, false)).isTrue();
        assertThat(ids).containsExactly(a, b, c);
    }

    @Test
    void rejectsForeignAnchorsWithoutChangingTheSequence() {
        var ids = new ArrayList<>(List.of(a, b));
        assertThatThrownBy(() -> SiblingOrder.move(ids, a, c, true)).isInstanceOf(IllegalArgumentException.class);
        assertThat(ids).containsExactly(a, b);
    }
}
