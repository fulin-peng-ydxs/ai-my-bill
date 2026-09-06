# T1-T10 整改浏览器验证记录

- 执行时间：2026-09-06（Asia/Shanghai）
- 浏览器：Codex in-app Chromium，真实前后端与 PostgreSQL 联调
- CSS 视口：534 × 1804；属于 `≤833px` 移动布局。历史 390px 截图位于忽略目录且已不存在，本记录不把它们当作当前可复核证据；360/390px 最终逐页矩阵仍由 T25 执行。
- 账号：临时合成 `audit-user` / `audit-admin`，数据只写入项目隔离开发库；验证后精确删除账号、租户、会话、偏好、字典、商品、合并留痕、默认项及审计记录，复查残留计数为 `0|0`。

## 已执行交互

1. 普通用户在“记一笔”切换为收入，刷新后仍为收入，证明 T10 服务端最近类型已保存并恢复。
2. 普通用户打开“我的/外观”，切换夜晚模式并确认即时生效。
3. 普通用户直接访问 `/admin`，URL 保持不变并显示“无权访问此页面”；DOM 中不存在“用户管理”页面标题，受限视图没有挂载。
4. 管理员进入用户操作抽屉，确认不存在“申请注销账号”入口。
5. 管理员新增默认支出分类，确认“只影响此后创建的用户”的 T9 页面与成功反馈可达。
6. 普通用户新增两个商品，完成影响预览、危险确认和实际合并。
7. 普通用户新增单位触发 Toast；测得 Toast 底边 `1719px`、底部导航顶边 `1735px`，无重叠；计算样式 `box-shadow: none`，页面 `scrollWidth=534px` 等于视口宽度。
8. 浏览器控制台只有 Vite 连接 debug 日志，无 warning/error。

## 截图与 SHA-256

| 文件 | 说明 | SHA-256 |
| --- | --- | --- |
| `t7-admin-no-deletion.jpg` | 管理员用户页 | `5ed980af9f6f2798a591749c4be1e8a765f0288e4426daca089419a733a85e09` |
| `t7-actions-no-deletion.jpg` | 用户操作抽屉无注销入口 | `d0175be29a60ffa35ad7218793e54cb55f86d82ec7f3b08bd5cffc29492847b7` |
| `t9-default-created-toast.jpg` | 默认字典新增成功 | `a18ed8aa559cf3dad03a22034bc035b047a49d945f83883c510e629f3501c529` |
| `t9-product-merge-confirm.jpg` | 商品合并影响与二次确认 | `6b0c6c3556c567ac0bad0ef0807a4700cd7479c030affb59cdcc0a9b0832c3fc` |
| `t10-entry.jpg` | T10 记一笔入口 | `c23c8aee26faa791dbf5676e947b8b59c16359ff326441e006fddfb5287b055c` |
| `t10-income-restored.jpg` | 收入类型刷新恢复 | `2172e6540ec7075d3cb51dcfe972e655ad4c951e09753f5017f2ab0e0c08e6bd` |
| `t10-profile-dark.jpg` | 偏好与夜晚模式 | `e8c13de556f158f6910b2f13cfcb5f79c5398c92f15d065311e1be5d2167366f` |
| `user-admin-permission.jpg` | 普通用户原位 permission 状态 | `04e15c90be42a02b46785b2258e1616595e4eec812e47034bd651631f8f48f41` |
| `mobile-toast-above-nav.jpg` | Toast 位于底部导航上方 | `bf5d98e2dfce8c751bebc4d7bfe6f637f1f074ba5a79ddfc7df52f3eba82f188` |
