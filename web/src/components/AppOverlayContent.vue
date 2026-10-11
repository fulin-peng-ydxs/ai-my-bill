<script lang="ts">
import { defineComponent, type VNode } from 'vue'

/** 保留当前 VNode 树至退场结束，不复制 DOM、表单状态或快照中的敏感字段。 */
export default defineComponent({
  props: { frozen: Boolean },
  setup(props, { slots }) {
    let content: VNode[] | undefined
    return () => {
      if (!props.frozen || !content) content = slots.default?.()
      return content
    }
  },
})
</script>
