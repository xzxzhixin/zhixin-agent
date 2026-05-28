# 中心服务

中心服务是致心智能体的唯一事实源，负责维护智能体、会话、项目、任务、记忆、供应商、运行环境和扩展能力状态。

## 首版接口

- `GET /health`：健康检查。
- `GET /directories`：中心目录映射。
- `GET /providers`：供应商配置列表，不返回 API Key 明文。
- `GET /runtimes`：运行环境配置列表，包含 Node.js、Python、Java、Maven、Git 模板。

## 配置

- `ZHIXIN_CENTER_PORT`：中心服务端口，默认 `8866`。
- `ZHIXIN_CENTER_DIR`：中心目录路径，默认使用用户主目录下的 `中心`。
