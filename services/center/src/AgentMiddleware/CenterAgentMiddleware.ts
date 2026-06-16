import {
    createMiddleware,
    type AgentMiddleware,
} from "langchain";

/** CenterAgentMiddlewareDefinition：LangChain 中间件定义，类型从官方 createMiddleware 推导，避免手写外部协议。 */
export type CenterAgentMiddlewareDefinition = Parameters<typeof createMiddleware>[0];

/**
 * CenterAgentMiddleware：中心服务 Agent 中间件抽象基类。
 *
 * @remarks
 * LangChain 官方 `AgentMiddleware` 是类型接口，真实运行时实例必须由 `createMiddleware` 生成，
 * 这样才能带上官方中间件品牌字段。项目业务中间件继承本类，统一返回官方 `AgentMiddleware`。
 */
export abstract class CenterAgentMiddleware {
    /**
     * create：创建 Deep Agents 可消费的官方 AgentMiddleware 实例。
     *
     * @returns LangChain 官方 AgentMiddleware 实例。
     */
    public create(): AgentMiddleware {
        return createMiddleware(this.createDefinition());
    }

    /**
     * createDefinition：由子类提供中间件定义。
     *
     * @returns LangChain createMiddleware 参数对象。
     */
    protected abstract createDefinition(): CenterAgentMiddlewareDefinition;
}
