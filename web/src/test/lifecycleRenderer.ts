import { createRenderer } from 'vue'

// 无浏览器的宿主只负责 Vue 生命周期，原生 top layer/触摸另由实际页面验证。
export interface HostNode { children: HostNode[]; parent?: HostNode }
export const renderer = createRenderer<HostNode, HostNode>({
  createElement: () => ({ children: [] }), createText: () => ({ children: [] }), createComment: () => ({ children: [] }),
  insert: (node, parent, anchor) => {
    if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1)
    node.parent = parent
    const index = anchor ? parent.children.indexOf(anchor) : -1
    if (index >= 0) parent.children.splice(index, 0, node)
    else parent.children.push(node)
  },
  remove: node => { if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1) },
  setText: () => {}, setElementText: () => {}, patchProp: () => {}, parentNode: node => node.parent ?? null,
  nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
})
