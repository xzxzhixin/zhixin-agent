import {
    type AgentMiddleware,
    MIDDLEWARE_BRAND,
} from "langchain";

/**
 * CenterAgentMiddleware：中心服务 Agent 中间件抽象基类。
 *
 * @remarks
 * 业务中间件直接 new 出实例交给 Deep Agents。基类只提供 LangChain 官方中间件品牌字段，
 * 具体 afterModel、wrapToolCall、wrapModelCall 等钩子由子类像 Java 实现接口一样直接声明。
 */
export abstract class CenterAgentMiddleware implements AgentMiddleware {
    /** MIDDLEWARE_BRAND：LangChain 官方中间件品牌字段，避免实例被误判为普通对象。 */
    public readonly [MIDDLEWARE_BRAND] = true;

    /** name：Deep Agents 用于识别、过滤和诊断的中间件名称。 */
    public name = "CenterAgentMiddleware";

    /** stateSchema：中间件状态 schema；当前中心服务中间件不扩展状态时保持未定义。 */
    public stateSchema: AgentMiddleware["stateSchema"];

    /** contextSchema：中间件上下文 schema；当前中心服务使用闭包上下文时保持未定义。 */
    public contextSchema: AgentMiddleware["contextSchema"];

    /** tools：中间件附加工具；当前中心服务中间件不在这里注入工具。 */
    public tools: AgentMiddleware["tools"];

    /** streamTransformers：流式转换器；当前中心服务不在中间件层改写流式输出。 */
    public streamTransformers: AgentMiddleware["streamTransformers"];

    /** wrapToolCall：工具调用包装钩子，由子类定义安装。 */
    public wrapToolCall: AgentMiddleware["wrapToolCall"];

    /** wrapModelCall：模型调用包装钩子，由子类定义安装。 */
    public wrapModelCall: AgentMiddleware["wrapModelCall"];

    /** beforeAgent：Agent 开始前钩子，由子类定义安装。 */
    public beforeAgent: AgentMiddleware["beforeAgent"];

    /** beforeModel：模型调用前钩子，由子类定义安装。 */
    public beforeModel: AgentMiddleware["beforeModel"];

    /** afterModel：模型调用后钩子，由子类定义安装。 */
    public afterModel: AgentMiddleware["afterModel"];

    /** afterAgent：Agent 结束后钩子，由子类定义安装。 */
    public afterAgent: AgentMiddleware["afterAgent"];
}
