# npc-preview-extension

## 更新日志

### v1.0.1

- 修复手机端悬浮按钮轻微触摸抖动被误判为拖拽，导致无法稳定打开 NPC 可视化面板的问题。
- 统一悬浮按钮的触摸打开逻辑为 Pointer Events，保留 click 作为桌面与键盘兜底入口。
