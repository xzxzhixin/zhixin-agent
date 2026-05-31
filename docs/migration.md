# 新版工程迁移说明

## 迁移边界

新版新增开发使用英文职责目录：

```text
apps
services
packages
plugins
assets
scripts
```

旧版中文目录仅作为历史实现参考：

```text
桌面端
Web端
中心服务
共享
IDEA_SDK
界面图标
```

新增业务能力、共享协议、中心服务、统一前端、桌面壳和插件能力必须进入新版目录。旧目录中的代码只能按计划迁移，不能继续扩展。

## 资源迁移

应用图标迁移到：

```text
assets/app-icon/图标.png
```

界面过程图标迁移到：

```text
assets/ui-icons/mcp-call.svg
assets/ui-icons/file-read.svg
assets/ui-icons/file-write.svg
assets/ui-icons/file-delete.svg
```

保留旧资源用于历史代码运行。后续新版前端和桌面壳只引用 `assets` 下资源。
