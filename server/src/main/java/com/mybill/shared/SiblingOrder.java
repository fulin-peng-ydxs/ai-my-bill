package com.mybill.shared;

import java.util.List;
import java.util.UUID;

/** 在已锁定的同级序列内插入；拖动使用锚点，旧调用仍可单步移动。 */
public final class SiblingOrder {
    private SiblingOrder() { }

    public static boolean move(List<UUID> ordered, UUID id, UUID anchor, boolean before) {
        int current = ordered.indexOf(id);
        if (current < 0) throw new IllegalArgumentException("Source is not a sibling");
        if (anchor == null) {
            int destination = current + (before ? -1 : 1);
            if (destination < 0 || destination >= ordered.size()) return false;
            anchor = ordered.get(destination);
        }
        int target = ordered.indexOf(anchor);
        if (target < 0) throw new IllegalArgumentException("Target is not a sibling");
        if (id.equals(anchor)) return false;
        int destination = target + (before ? 0 : 1) - (current < target ? 1 : 0);
        if (current == destination) return false;
        ordered.remove(current);
        ordered.add(destination, id);
        return true;
    }
}
